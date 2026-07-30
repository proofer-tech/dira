/** 워커 파일·락·crontab 판정 (DESIGN.md §워커 상태 판정 · §4).
 *
 *  crontab은 **읽기 전용**이다(제약 4): `crontab -l`을 파싱해 현황만 보고, 등록·해제는
 *  `cronRegisterCmd`/`cronUnregisterCmd`가 만든 명령어를 사람이 복사해 실행한다.
 *  상태 전이(reap·unassign)도 여기서 다시 구현하지 않는다 — `lib/engine.ts`가 워커를 부른다. */
import { createHash } from "node:crypto";
import { chmod, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NAME_RE, expandHome, resolveWithin, shellPath, shellValue } from "./paths.ts";
import type { Ticket } from "./queue.ts";

export type WorkerStatus = "running" | "idle" | "stopped" | "stale";

export type Worker = {
  /** 파일 stem. 액션(생성·삭제·reap)이 가리키는 이름이다 */
  name: string;
  path: string;
  status: WorkerStatus;
  /** crontab에 이 파일 경로가 있는가 */
  cron: boolean;
  lockPid: number | null;
  /** 지금 물고 있는 티켓 해시 (`.wip` 티켓의 `owner:` 역추적) */
  holding: string | null;
  /** TICKET_ENGINE (표시용). 워커에 없으면 tick.sh의 기본값 */
  engine: string;
  /** runner.log에서 이 워커의 마지막 줄 */
  lastLog: string | null;
  /** TICKET_CONTEXT 항목(경로·설명·존재 여부) 또는 못 읽은 사유 */
  context: WorkerContext;
};

/** tick.sh 46행. 워커가 덮어쓰지 않으면 실제로 이게 돈다 — "기본값"이라고 얼버무리지 않는다. */
const DEFAULT_ENGINE =
  'claude -p "{prompt}" --session-id "{sid}" --dangerously-skip-permissions --output-format json';

/** tick.sh와 **같이** 조립한다:
 *  `${TICKET_LOCAL:-~/.config/fs-tickets}/run/<이름>-<sha1(<workers 절대경로>/<이름>)[:8]>.lock`
 *
 *  `TICKET_LOCAL`은 테넌트별이 아니라 머신 전역이라 모든 테넌트의 락이 한 디렉터리에 섞인다.
 *  해시에 workers 절대경로가 들어 있어 이름이 같은 `w1`끼리도 충돌하지 않는다. 그래서 반대로
 *  **락 디렉터리에서 워커를 역추적하지 않고** 워커 파일 목록에서 락을 찾는다.
 *
 *  여기 들어가는 `<이름>`은 파일 stem이 아니라 **실효 `TICKET_NAME`**이다(tick.sh 37·87행). */
export function lockPath(workersDir: string, name: string): string {
  const local = process.env.TICKET_LOCAL || path.join(homedir(), ".config", "fs-tickets");
  const h = createHash("sha1").update(path.join(workersDir, name)).digest("hex").slice(0, 8);
  return path.join(expandHome(local), "run", `${name}-${h}.lock`);
}

/** 락은 디렉터리다(`mkdir`가 원자적 획득). 안의 `pid` 파일이 소유 프로세스다. */
async function lockOf(dir: string): Promise<{ held: boolean; pid: number | null }> {
  const held = await stat(dir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!held) return { held: false, pid: null };
  const raw = await readFile(path.join(dir, "pid"), "utf8").catch(() => "");
  const pid = Number.parseInt(raw.trim(), 10);
  return { held: true, pid: Number.isInteger(pid) && pid > 0 ? pid : null };
}

/** `kill -0`. EPERM은 남의 프로세스지만 **살아 있다**는 뜻이다. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 한글 경로 비교는 **반드시** 양쪽을 맞춰야 한다(`queue.ts`와 같은 이유):
 *  macOS `crontab -l`은 사람이 넣은 줄을 NFC로 그대로 주는데 `realpath()`는 같은 경로를
 *  NFD(자모 분해)로 돌려주는 파일시스템이 있다(구글 드라이브 마운트). 정규화 없이 비교하면
 *  cron에 등록돼 도는 워커가 `stopped` + `미등록`으로 뜨고, 화면이 권하는 등록 명령을 실행하면
 *  **중복 cron 줄**이 생긴다. */
const nfc = (s: string) => s.normalize("NFC");

// ponytail: 테넌트마다 한 번 부른다(테넌트는 한 자릿수). 캐시하면 사람이 crontab을 고친 걸
// GUI가 못 보므로, 느려지면 요청 단위 캐시를 넣는다.
async function crontabText(): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // crontab 없음·비어 있음 = 등록된 워커 없음
  }
}

// ── 워커 파일 읽기 ──────────────────────────────────────────────────────────

/** 주석 줄(`# TICKET_ENGINE=…`)에 걸리지 않게 줄 처음에 앵커한다. worker.sh.example이 전부
 *  주석 처리된 할당문이라 이 앵커가 없으면 예시 값이 실제 설정으로 보인다. */
const nameAssign = /^[ \t]*(?:export[ \t]+)?TICKET_NAME=(.*)$/gm;
const engineAssign = /^[ \t]*(?:export[ \t]+)?TICKET_ENGINE=\(/m;
const cwdAssign = /^[ \t]*(?:export[ \t]+)?TICKET_CWD=(.*)$/gm;

/** 워커 파일에서 읽는 값. **셸을 실행하지 않는다** — 등록된 경로의 임의 코드가 GUI 권한으로
 *  도는 걸 막는 게 이 함수의 존재 이유다(`shellValue`와 같은 결정). */
function parseWorkerFile(text: string): {
  name: string | null;
  engine: string | null;
  /** 컨텍스트 경로의 `$TICKET_CWD`를 펴는 데만 쓴다(표시·존재 확인용) */
  cwd: string | null;
} {
  let name: string | null = null;
  for (const m of text.matchAll(nameAssign)) name = shellValue(m[1]) ?? name; // 뒤 할당이 이긴다
  let cwd: string | null = null;
  // cwd는 기준 디렉터리다 — 절대경로가 아니면 못 읽은 것으로 본다(`shellPath`, ce40243f).
  for (const m of text.matchAll(cwdAssign)) cwd = shellPath(m[1]) ?? cwd;

  let engine: string | null = null;
  const m = engineAssign.exec(text);
  if (m) {
    const open = m.index + m[0].length;
    const close = text.indexOf(")", open);
    // 닫는 괄호가 없으면 파일이 깨진 것이다 — 추측해서 반쪽을 보여주지 않는다.
    if (close > open) engine = text.slice(open, close).replace(/\\?\s+/g, " ").trim() || null;
  }
  return { name, engine, cwd };
}

// ── TICKET_CONTEXT 블록 (tick.sh 141~153행) ────────────────────────────────
//
// 셸 스크립트를 프로그램이 고치는 자리다. 엉뚱한 라인을 밟으면 워커가 죽고 cron이 조용히
// 실패한다 — 그래서 **아는 모양만 고치고, 나머지는 거부한다**(DESIGN.md §4 컨텍스트 경로 관리).

/** 워커 파일에 그대로 들어가는 한 항목. `path`는 **셸 문자열**이라 `$TICKET_CWD`가 살아 있다 —
 *  덕분에 w1의 설정을 w2로 복사해도 각자 자기 워크트리를 가리킨다. */
export type ContextItem = {
  path: string;
  desc: string;
  /** `$HOME`·`$TICKET_CWD`를 편 결과. 표시·존재 확인용이고 파일에는 안 들어간다 */
  resolved: string;
  /** 엔진의 `[ -e ]`와 같은 판정. null = 못 편 변수가 남아 확인 불가 */
  exists: boolean | null;
};

/** 못 읽으면 편집 UI를 열지 않는다 — 사람이 손으로 고쳐야 한다는 사실과 이유를 넘긴다. */
export type WorkerContext = { ok: true; items: ContextItem[] } | { ok: false; reason: string };

/** 주석 처리된 블록(`# TICKET_CONTEXT=(`)에 걸리지 않게 줄 처음에 앵커한다. */
const contextOpen = /^[ \t]*(?:export[ \t]+)?TICKET_CONTEXT(\+?)=\(/gm;

/** 항목 하나 = 큰따옴표 문자열 · 작은따옴표 문자열 · 맨 낱말. **이 셋 말고는 거부한다.**
 *  `\`·백틱은 아예 안 받는다(다시 쓸 때 이스케이프 의미가 갈린다). 맨 낱말에 글로브 문자를
 *  넣지 않는 이유도 같다 — 셸은 인용 없는 `*`를 펴는데 GUI는 큰따옴표로 다시 쓴다. */
const contextEntry = /^(?:"([^"\\`]*)"|'([^'\\`]*)'|([A-Za-z0-9_/.$:@=+,%{}-]+))/;

function splitEntry(entry: string): { path: string; desc: string } {
  // 엔진과 같이 **첫 `|`**로 가른다(tick.sh 146행 `${entry%%|*}` · `${entry#*|}`).
  const i = entry.indexOf("|");
  return i < 0 ? { path: entry, desc: "" } : { path: entry.slice(0, i), desc: entry.slice(i + 1) };
}

export type ContextBlock =
  | { ok: true; items: { path: string; desc: string }[]; start: number; end: number }
  | { ok: false; reason: string };

/** 워커 파일 텍스트에서 `TICKET_CONTEXT=( … )` 블록을 찾아 항목과 **치환 구간**을 돌려준다.
 *  모양이 조금이라도 예상과 다르면 `ok: false` — 반쪽만 고치는 것보다 거부가 낫다. */
export function parseContextBlock(text: string): ContextBlock {
  const opens = [...text.matchAll(contextOpen)];
  if (opens.length === 0) return { ok: false, reason: "TICKET_CONTEXT=( … ) 블록이 없습니다" };
  if (opens.length > 1) {
    return {
      ok: false,
      reason: `TICKET_CONTEXT 할당이 ${opens.length}개입니다 — 어느 쪽이 실효인지 GUI가 정하지 않습니다`,
    };
  }
  const m = opens[0];
  if (m[1]) return { ok: false, reason: "`+=` 추가 할당입니다" };

  const start = m.index;
  const entries: string[] = [];
  let i = start + m[0].length;
  for (;;) {
    while (i < text.length && " \t\r\n".includes(text[i])) i++;
    if (i >= text.length) return { ok: false, reason: "닫는 `)`가 없습니다" };
    if (text[i] === ")") return { ok: true, items: entries.map(splitEntry), start, end: i + 1 };
    if (text[i] === "#") {
      // 블록 전체를 치환하므로 안의 주석은 사라진다. 지우는 대신 거부한다.
      return { ok: false, reason: "블록 안에 주석이 있습니다" };
    }
    const e = contextEntry.exec(text.slice(i));
    const after = e ? text[i + e[0].length] : undefined;
    // 이어붙이기(`"$X"/y`)도 예상 밖이다 — 항목 하나는 공백이나 `)`로 끝나야 한다.
    if (!e || (after !== undefined && !" \t\r\n)".includes(after))) {
      const snippet = text.slice(i, i + 30).split("\n")[0];
      return { ok: false, reason: `항목으로 읽을 수 없는 부분이 있습니다: ${snippet}` };
    }
    // 큰따옴표 안에서도 `$( )`는 셸이 실행한다. 실행되는 것을 GUI가 다시 쓰지 않는다.
    if (e[0].includes("$(")) {
      return { ok: false, reason: `항목에 명령 치환 $( ) 가 있습니다: ${e[0]}` };
    }
    // 작은따옴표 안의 `$`는 셸이 펴지 않는데 GUI는 큰따옴표로 다시 쓴다 = 의미가 바뀐다.
    if (e[2] !== undefined && e[2].includes("$")) {
      return { ok: false, reason: `작은따옴표 안에 $ 가 있습니다: ${e[0]}` };
    }
    entries.push(e[1] ?? e[2] ?? e[3]);
    i += e[0].length;
  }
}

/** 파일에 들어갈 블록 텍스트. 항상 큰따옴표로 쓴다 — `$TICKET_CWD`는 살리고 공백은 죽인다. */
export function renderContextBlock(items: { path: string; desc: string }[]): string {
  if (items.length === 0) return "TICKET_CONTEXT=()";
  const lines = items.map((it) => `  "${it.path}${it.desc ? `|${it.desc}` : ""}"`);
  return `TICKET_CONTEXT=(\n${lines.join("\n")}\n)`;
}

/** 사용자 입력이 **셸 스크립트 안의 큰따옴표 문자열**이 된다. 여기가 그 신뢰 경계다:
 *  큰따옴표 안에서 특별한 건 `"`·`` ` ``·`\`·`$`뿐이고, `$`만 살려 두고(그게 용도다)
 *  명령 치환 `$( )`는 막는다. 클라이언트 검증은 검증이 아니다 — 이 함수가 서버에서 돈다. */
function cleanItem(raw: { path: string; desc: string }): { path: string; desc: string } {
  const path = raw.path.trim();
  const desc = raw.desc.trim();
  if (!path) throw new Error("경로가 비어 있는 항목이 있습니다.");
  if (path.includes("|")) {
    throw new Error(`경로에 | 는 쓸 수 없습니다(엔진이 첫 | 를 설명 구분자로 씁니다): ${path}`);
  }
  for (const [what, s] of [
    ["경로", path],
    ["설명", desc],
  ] as const) {
    if (/["`\\\r\n]/.test(s)) throw new Error(`${what}에 " \` \\ 개행은 쓸 수 없습니다: ${s}`);
    if (s.includes("$(")) throw new Error(`${what}에 명령 치환 $( ) 는 쓸 수 없습니다: ${s}`);
  }
  return { path, desc };
}

/** 존재 확인용 변수 전개. 셸을 실행하지 않으므로 아는 변수는 이 둘뿐이다. */
function expandVars(v: string, cwd: string): string {
  return v
    .replace(/\$\{TICKET_CWD\}|\$TICKET_CWD(?![A-Za-z0-9_])/g, cwd)
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, homedir());
}

/** 컨텍스트 경로는 **루트 밖을 허용한다**(그게 용도다). 쓰기 대상이 아니라 워커 파일에 들어갈
 *  문자열일 뿐이므로 `resolveWithin`을 걸지 않고 `stat`으로 존재만 본다 — 엔진의 `[ -e ]`와 같다. */
async function withExistence(
  items: { path: string; desc: string }[],
  cwd: string,
): Promise<ContextItem[]> {
  return Promise.all(
    items.map(async (it) => {
      const resolved = expandVars(it.path, cwd);
      return {
        ...it,
        resolved,
        exists: /\$[A-Za-z_{]/.test(resolved)
          ? null // 못 편 변수가 남았다 — 없다고 단정하지 않는다
          : await stat(resolved).then(
              () => true,
              () => false,
            ),
      };
    }),
  );
}

/** 워커 하나의 컨텍스트. `text`를 이미 읽었으면 넘겨서 재읽기를 아낀다. */
async function contextOf(root: string, text: string, cwd: string | null): Promise<WorkerContext> {
  const b = parseContextBlock(text);
  if (!b.ok) return b;
  // tick.sh 39행: TICKET_CWD 기본값은 루트의 부모다.
  return { ok: true, items: await withExistence(b.items, cwd ?? path.dirname(root)) };
}

/** 블록 전체 치환. 모양이 예상과 다르면 **쓰지 않고** 손으로 고치라고 알린다. */
export async function writeContext(
  root: string,
  name: string,
  items: { path: string; desc: string }[],
): Promise<WorkerContext> {
  const file = await workerFile(root, name);
  const text = await readFile(file, "utf8");
  const b = parseContextBlock(text);
  if (!b.ok) {
    throw new Error(
      `${name}.sh의 TICKET_CONTEXT 블록을 GUI가 안전하게 고칠 수 없습니다: ${b.reason}. 파일을 손으로 편집하세요.`,
    );
  }
  const clean = items.map(cleanItem);
  const next = text.slice(0, b.start) + renderContextBlock(clean) + text.slice(b.end);

  // 자기 검증: 쓴 것을 다시 읽어 같은 항목이 나오는지 본다. 이스케이프가 틀리면 여기서 멈춘다.
  const back = parseContextBlock(next);
  if (!back.ok || JSON.stringify(back.items) !== JSON.stringify(clean)) {
    throw new Error(
      `쓴 블록을 다시 읽었을 때 항목이 달라집니다(${back.ok ? "내용 불일치" : back.reason}). 쓰지 않았습니다.`,
    );
  }
  // **원자적 교체.** cron이 1분마다 이 파일을 실행하고 bash는 스크립트를 조금씩 읽는다 —
  // 제자리 덮어쓰기 중에 tick이 걸리면 반쪽 스크립트가 실행된다. rename은 원자적이라
  // 그 순간의 tick은 이전 파일이나 새 파일 중 하나를 온전히 본다.
  const tmp = `${file}.gui-${process.pid}.tmp`;
  await writeFile(tmp, next, { flag: "wx", mode: (await stat(file)).mode & 0o777 }); // 755를 잃지 않는다
  await rename(tmp, file).catch(async (e) => {
    await unlink(tmp).catch(() => {});
    throw e;
  });
  const { cwd } = parseWorkerFile(next);
  return { ok: true, items: await withExistence(clean, cwd ?? path.dirname(root)) };
}

/** 워커 간 복사. 갈라진 컨텍스트는 티켓 결과를 워커에 따라 달라지게 만든다.
 *  `$TICKET_CWD`를 펴지 않고 문자열째로 옮기므로 받는 워커는 자기 워크트리를 가리킨다. */
export async function copyContext(root: string, from: string, to: string): Promise<WorkerContext> {
  if (from === to) throw new Error("같은 워커입니다.");
  const src = await readFile(await workerFile(root, from), "utf8");
  const b = parseContextBlock(src);
  if (!b.ok) {
    throw new Error(`${from}.sh의 TICKET_CONTEXT 블록을 읽을 수 없습니다: ${b.reason}`);
  }
  return writeContext(root, to, b.items);
}

/** runner.log는 워커 전체가 한 파일에 섞여 쌓인다: `2026-07-30 13:19:01 [w3] SKIP …`.
 *  실효 `TICKET_NAME` → 마지막 줄.
 *
 *  ponytail: 파일 전체를 읽고 뒤에서 훑는다. 이 레포 로그가 13KB고 사람이 가끔 지운다.
 *  MB 단위가 되면 뒤에서 N바이트만 읽는 경로로 바꾼다. */
async function lastLogByWorker(workersDir: string): Promise<Record<string, string>> {
  const text = await readFile(path.join(workersDir, "runner.log"), "utf8").catch(() => "");
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\S+ \S+ \[([^\]]+)\] /.exec(lines[i]);
    if (m && !(m[1] in out)) out[m[1]] = lines[i];
  }
  return out;
}

/** 워커가 물고 있는 티켓. tick.sh 207행이 `owner`에 `<페르소나> / <TICKET_NAME>-<sid[:8]>`를
 *  쓰므로 거기서 워커 이름을 되짚는다. `.wip` 티켓만 본다 — 끝난 티켓의 owner는 기록이다.
 *
 *  **stem이다** (표시값 `hash`가 아니다): 이 값은 워커 화면이 티켓 상세로 거는 링크가 된다
 *  (DESIGN.md §식별자). 물고 있는 티켓은 항상 `.wip`이라 표시값에 접미사가 붙어 있어
 *  (`<이름>.wip`) 그대로 보여주면 파일 이름도 아니고 URL도 아닌 값이 화면에 남는다. */
function holdingOf(tickets: Ticket[], effName: string): string | null {
  for (const t of tickets) {
    if (t.state !== "wip") continue;
    const owner = t.fm.owner ?? "";
    const i = owner.lastIndexOf(" / ");
    const tail = i < 0 ? owner : owner.slice(i + 3);
    // `<이름>-<8자>`. 이름에 `-`가 들어가도 길이로 갈린다(정규식을 짓지 않는 이유 = 이름이
    // 파일시스템에서 오므로 메타문자가 섞일 수 있다).
    if (tail.length === effName.length + 9 && tail.startsWith(effName + "-")) return t.stem;
  }
  return null;
}

// ── 목록 ────────────────────────────────────────────────────────────────────

/** 테넌트의 워커 전부. 이름 순.
 *
 *  | status | 판정 |
 *  |---|---|
 *  | running | 락 있음 + pid 생존 |
 *  | stale | 락 있음 + pid 죽음(또는 pid 파일이 없다 — tick.sh도 이걸 회수 대상으로 본다) |
 *  | idle | 락 없음 + crontab 등록됨 |
 *  | stopped | 락 없음 + crontab 미등록 |
 *
 *  ponytail: `holding`은 **호출자가 이미 읽은 티켓 목록**에서 찾는다 — 큐를 두 번 읽지 않으려고.
 *  테넌트 목록·전환기 요약은 holding을 안 쓰므로 안 넘긴다(그때는 항상 null이다). */
export async function listWorkers(root: string, tickets: Ticket[] = []): Promise<Worker[]> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".sh"))
    .sort();
  if (names.length === 0) return [];

  const [cronRaw, logs] = await Promise.all([crontabText(), lastLogByWorker(dir)]);
  const cron = nfc(cronRaw);
  const out: Worker[] = [];
  for (const file of names) {
    const name = file.slice(0, -3);
    const full = path.join(dir, file);
    const text = await readFile(full, "utf8").catch(() => "");
    const parsed = parseWorkerFile(text);
    // tick.sh 37행: TICKET_NAME 기본값이 파일명이다. 락·로그·owner가 전부 이 값으로 간다.
    const eff = parsed.name ?? name;
    const { held, pid } = await lockOf(lockPath(dir, eff));
    // crontab 한 줄은 인용부호가 붙기도 하므로 절대경로 부분일치로 본다(제약 4: 읽기 전용).
    // `full`은 정규화하지 **않고** 저장한다 — cron 줄에 들어가 셸이 실제로 실행하는 문자열이라
    // 파일시스템이 준 바이트 그대로여야 한다. 정규화는 비교에만 쓴다.
    const inCron = cron.includes(nfc(full));
    out.push({
      name,
      path: full,
      status: held ? (pid && alive(pid) ? "running" : "stale") : inCron ? "idle" : "stopped",
      cron: inCron,
      lockPid: pid,
      holding: holdingOf(tickets, eff),
      engine: parsed.engine ?? DEFAULT_ENGINE,
      lastLog: logs[eff] ?? null,
      context: await contextOf(root, text, parsed.cwd),
    });
  }
  return out;
}

/** `running 1 / idle 1` — 0인 종류는 뺀다. 워커 0개면 `—`(DESIGN.md §7 목록 행). */
export function workerSummary(workers: Worker[]): string {
  const order: WorkerStatus[] = ["running", "stale", "idle", "stopped"];
  const parts = order
    .map((s) => [s, workers.filter((w) => w.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`);
  return parts.length ? parts.join(" / ") : "—";
}

// ── crontab 명령어 (읽기 전용 — 실행은 사람이 한다, 제약 4) ─────────────────

/** 사람이 셸에 붙여 넣을 문자열이다. 경로에 공백·한글·따옴표가 들어 있는 큐가 실제로 있어서
 *  (구글 드라이브 공유 드라이브) 인용을 대충 하면 복사한 명령이 엉뚱한 줄을 만든다. */
const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const dq = (s: string) => `"${s.replace(/(["$`\\])/g, "\\$1")}"`;

/** README §워커와 같은 모양의 cron 한 줄. */
export function cronLine(worker: Pick<Worker, "path">): string {
  const log = path.join(path.dirname(worker.path), "cron.log");
  return `* * * * * ${dq(worker.path)} >> ${dq(log)} 2>&1`;
}

/** `grep -F`는 **바이트로** 비교한다. crontab 줄은 사람이 넣은 NFC인데 `readdir`가 준 경로는
 *  NFD라서(macOS 한글 큐) 한 형태만 주면 한 줄도 못 걸러낸다 — 사람이 해제 명령을 복사해
 *  실행해도 아무 일이 안 일어나는 조용한 실패다. 두 형태를 **둘 다** 패턴으로 준다.
 *  (a622f9e4는 판정만 고쳤다. `worker.path` 자체는 셸이 실행할 문자열이라 정규화하지 않는다.) */
const grepBothForms = (p: string) =>
  [...new Set([p.normalize("NFC"), p.normalize("NFD")])].map((v) => `-e ${sq(v)}`).join(" ");

/** 먼저 지우고 넣는다 — 사람이 두 번 복사해 실행해도 중복 줄이 안 생긴다(미등록일 땐 no-op). */
export function cronRegisterCmd(worker: Pick<Worker, "path">): string {
  const keep = `crontab -l 2>/dev/null | grep -Fv ${grepBothForms(worker.path)}`;
  return `(${keep}; echo ${sq(cronLine(worker))}) | crontab -`;
}

/** 이 파일 경로가 들어간 줄을 지운다(`-F` = 경로를 정규식으로 해석하지 않는다). */
export function cronUnregisterCmd(worker: Pick<Worker, "path">): string {
  return `crontab -l | grep -Fv ${grepBothForms(worker.path)} | crontab -`;
}

/** 워커가 0개인 큐의 **첫 워커**를 손으로 만드는 명령. `<fs-tickets 레포>`는 채워지지 않는다 —
 *  엔진 코드 위치는 워커 파일에만 적혀 있고, 워커가 없으면 GUI가 알 방법이 없다(→ createWorker). */
export function firstWorkerCmd(root: string, name = "w1"): string {
  const dir = sq(path.join(root, "workers"));
  const file = sq(path.join(root, "workers", `${name}.sh`));
  return `mkdir -p ${dir} && cp <fs-tickets 레포>/worker.sh.example ${file} && chmod 755 ${file}`;
}

// ── 생성 · 삭제 ─────────────────────────────────────────────────────────────

/** 이름 검증 + 경로 조립은 **서버에서만** 한다(신뢰 경계). 이름이 규칙을 통과해도 경로를
 *  문자열로 믿지 않고 `resolveWithin`으로 workers/ 안인지 확인한다. */
async function workerFile(root: string, name: string): Promise<string> {
  if (!NAME_RE.test(name)) {
    throw new Error(`워커 이름은 영문·숫자·_·- 만 됩니다: ${name || "(비어 있음)"}`);
  }
  return resolveWithin(path.join(root, "workers"), `${name}.sh`);
}

/** 기존 워커를 템플릿으로 새 워커를 만든다 (DESIGN.md §4 생성).
 *
 *  템플릿이 필요한 이유는 마지막 `. <엔진레포>/tick.sh` 한 줄이다 — 엔진 코드가 어디 있는지는
 *  워커 파일에만 적혀 있고 GUI가 알 방법이 없다. 그래서 **워커 0개인 큐에서는 만들 수 없고**,
 *  화면이 그 사실과 손으로 만드는 법을 알린다. */
export async function createWorker(root: string, name: string): Promise<{ path: string; template: string }> {
  // 템플릿 확인이 먼저다 — workers/가 아예 없는 큐에서 `resolveWithin`의 ENOENT를 먼저 만나면
  // 사용자가 받는 문장이 "경로 없음"이 되어 진짜 이유(템플릿 없음)를 가린다.
  if (!NAME_RE.test(name)) {
    throw new Error(`워커 이름은 영문·숫자·_·- 만 됩니다: ${name || "(비어 있음)"}`);
  }
  const dir = path.join(root, "workers");
  const existing = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh")).sort();
  if (existing.length === 0) {
    throw new Error(
      "템플릿으로 쓸 워커가 없습니다. 첫 워커는 엔진 레포의 worker.sh.example을 복사해 만듭니다.",
    );
  }
  const file = await workerFile(root, name);
  const template = existing[0];
  const text = await readFile(path.join(dir, template), "utf8");
  // O_EXCL. 있는 워커를 덮어쓰면 돌고 있는 cron 줄의 내용이 바뀐다.
  await writeFile(file, text, { flag: "wx" });
  await chmod(file, 0o755);
  return { path: file, template };
}

/** 파일만 지운다. crontab 줄은 사람이 지운다(제약 4) — 화면이 해제 명령어를 같이 보여준다. */
export async function deleteWorker(root: string, name: string): Promise<void> {
  const file = await workerFile(root, name);
  const w = (await listWorkers(root)).find((x) => x.name === name);
  if (!w) throw new Error(`없는 워커입니다: ${name}`);
  // running을 지우면 락과 돌고 있는 세션이 붕 뜬다 — 락은 남고 티켓은 .wip에 갇힌다.
  if (w.status === "running") {
    throw new Error(
      `${name}이(가) 지금 티켓을 물고 있습니다(pid ${w.lockPid ?? "?"}). 끝난 뒤 삭제하세요.`,
    );
  }
  await unlink(file);
}
