/** 워커 파일·락·crontab 판정 (DESIGN.md §워커 상태 판정 · §4).
 *
 *  crontab은 **그 프로젝트의 워커 줄만** 쓴다(제약 4, `44f876aa`로 뒤집힘): 변경은 순수 함수
 *  `cronRegister`/`cronUnregister`가 텍스트로 계산하고 `registerCron`/`unregisterCron`이
 *  `crontab -`의 stdin으로 준다. 실패하면 `cronRegisterCmd`/`cronUnregisterCmd`의 복사 명령으로
 *  되돌아간다 — 그래서 그 둘은 남아 있다.
 *  상태 전이(reap·unassign)는 여기서 다시 구현하지 않는다 — `lib/engine.ts`가 워커를 부른다. */
import { createHash } from "node:crypto";
import { chmod, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cache } from "react";
import { NAME_RE, expandHome, resolveWithin, shellPath, shellValue } from "./paths.ts";
import type { Ticket } from "./queue.ts";

export type WorkerStatus = "running" | "idle" | "stopped" | "stale";

/** 작업 디렉터리 결함 3종 (DESIGN.md §4 표). **`status`에 5번째 값을 만들지 않는다** — 결함은
 *  락·crontab의 사실과 직교한 축이다(사람이 도중에 트리를 지우면 `running` + 결함이다). */
export type WorkerDefectKind = "missing-cwd" | "missing-link" | "shared-cwd";

/** `detail`은 판정에 **실제로 쓴 경로·워커 이름**이다. 결함 이름과 "그래서 무슨 일이
 *  일어나나"는 화면이 붙인다(§4 표와 같은 단어를 쓰게 한 자리에 둔다). */
export type WorkerDefect = { kind: WorkerDefectKind; detail: string };

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
  /** 공통 컨텍스트 `source` 줄이 있는가. false면 이 워커는 공통을 못 받는다 (§4-1) */
  commonSource: boolean;
  /** `TICKET_CWD` (셸 없이 읽은 절대경로). null = 줄이 없다 → 엔진 기본값은 루트의 부모다 */
  cwd: string | null;
  /** 작업 디렉터리 결함 (§4). **0개가 정상이고 그때 화면은 아무것도 늘지 않는다** */
  defects: WorkerDefect[];
  /** 사람이 결함을 고치는 준비 명령. 결함이 있을 때만 채운다 — §4 생성의 3줄과 같은 함수다 */
  worktree?: { cmds: string[]; reason?: string };
};

/** tick.sh 46행. 워커가 덮어쓰지 않으면 실제로 이게 돈다 — "기본값"이라고 얼버무리지 않는다. */
const DEFAULT_ENGINE =
  'claude -p "{prompt}" --session-id "{sid}" --dangerously-skip-permissions --output-format json';

/** tick.sh와 **같이** 조립한다:
 *  `${TICKET_LOCAL:-~/.config/dira}/run/<이름>-<sha1(<workers 절대경로>/<이름>)[:8]>.lock`
 *
 *  `TICKET_LOCAL`은 프로젝트별이 아니라 머신 전역이라 모든 프로젝트의 락이 한 디렉터리에 섞인다.
 *  해시에 workers 절대경로가 들어 있어 이름이 같은 `w1`끼리도 충돌하지 않는다. 그래서 반대로
 *  **락 디렉터리에서 워커를 역추적하지 않고** 워커 파일 목록에서 락을 찾는다.
 *
 *  여기 들어가는 `<이름>`은 파일 stem이 아니라 **실효 `TICKET_NAME`**이다(tick.sh 37·87행). */
export function lockPath(workersDir: string, name: string): string {
  const local = process.env.TICKET_LOCAL || path.join(homedir(), ".config", "dira");
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

/** **요청당 1회**. 셸이 전환기 카운트를 위해 등록된 프로젝트 전부에 `listWorkers`를 돌리므로
 *  이게 없으면 한 화면에 `crontab -l` 프로세스가 프로젝트 수만큼 뜬다(§성능 예산: 요청당
 *  서브프로세스 0~1회).
 *
 *  `cache()`의 수명은 **요청 하나**다 — 프로세스 전역이 아니다. 그래서 사람이 crontab을 고치면
 *  다음 요청(보드 5초 폴링·`revalidatePath`·새로고침)이 다시 읽는다. 프로세스 전역 캐시였다면
 *  워커 화면이 계속 거짓말을 한다 — 그게 원래 캐시를 안 넣었던 이유고, 그 조건이 여기서 지켜진다.
 *
 *  쓰기 경로는 `crontabForWrite`가 따로 읽는다(캐시 대상이 아니다) — 렌더 때 읽은 값 위에 쓰면
 *  그 사이 남의 변경을 되돌린다. */
const crontabText = cache(async (): Promise<string> => {
  try {
    const { stdout } = await promisify(execFile)("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // crontab 없음·비어 있음 = 등록된 워커 없음
  }
});

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

/** 주석 처리된 블록(`# TICKET_CONTEXT=(`)에 걸리지 않게 줄 처음에 앵커한다.
 *
 *  배열 이름이 인자인 이유는 공통 컨텍스트 파일이다(§4-1): 그 파일의 파싱 대상은
 *  `TICKET_CONTEXT_COMMON`이고 같은 파일에 `TICKET_CONTEXT` 대입이 하나 더 있다(병합 2줄) —
 *  이름을 나누지 않으면 "할당이 2개입니다"로 자기 파일을 거부한다. 문법·거부 규칙은 하나다. */
const contextOpen = (arr: string) =>
  new RegExp(`^[ \\t]*(?:export[ \\t]+)?${arr}(\\+?)=\\(`, "gm");

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
export function parseContextBlock(text: string, arr = "TICKET_CONTEXT"): ContextBlock {
  const opens = [...text.matchAll(contextOpen(arr))];
  if (opens.length === 0) return { ok: false, reason: `${arr}=( … ) 블록이 없습니다` };
  if (opens.length > 1) {
    return {
      ok: false,
      reason: `${arr} 할당이 ${opens.length}개입니다 — 어느 쪽이 실효인지 GUI가 정하지 않습니다`,
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
export function renderContextBlock(
  items: { path: string; desc: string }[],
  arr = "TICKET_CONTEXT",
): string {
  if (items.length === 0) return `${arr}=()`;
  const lines = items.map((it) => `  "${it.path}${it.desc ? `|${it.desc}` : ""}"`);
  return `${arr}=(\n${lines.join("\n")}\n)`;
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
 *  문자열일 뿐이므로 `resolveWithin`을 걸지 않고 `stat`으로 존재만 본다 — 엔진의 `[ -e ]`와 같다.
 *
 *  `cwds`가 **여럿**인 자리는 공통 컨텍스트다(§4-1: 항목 하나를 워커 N개가 각자 자기
 *  `TICKET_CWD`로 편다). 그때는 전원 일치일 때만 단정한다 — 갈리면 `null`(`확인 못 했습니다`)이고
 *  `resolved`도 `$TICKET_CWD`를 편 척하지 않는다. 한 워커의 사실을 전원의 사실로 그리면
 *  같은 화면의 워커 카드와 반대 판정이 나온다(`6e3dcd79`). */
async function withExistence(
  items: { path: string; desc: string }[],
  cwds: string[],
): Promise<ContextItem[]> {
  return Promise.all(
    items.map(async (it) => {
      const paths = [...new Set(cwds.map((c) => expandVars(it.path, c)))];
      // 후보가 갈리면 한 값으로 못 보여준다 — `$TICKET_CWD`는 그대로 두고 `$HOME`만 편다.
      const resolved = paths.length === 1 ? paths[0] : expandVars(it.path, "$TICKET_CWD");
      if (/\$[A-Za-z_{]/.test(paths[0])) {
        return { ...it, resolved, exists: null }; // 못 편 변수가 남았다 — 없다고 단정하지 않는다
      }
      const found = await Promise.all(
        paths.map((p) =>
          stat(p).then(
            () => true,
            () => false,
          ),
        ),
      );
      return {
        ...it,
        resolved,
        exists: found.every(Boolean) ? true : found.some(Boolean) ? null : false,
      };
    }),
  );
}

/** 워커 하나의 컨텍스트. `text`를 이미 읽었으면 넘겨서 재읽기를 아낀다. */
async function contextOf(root: string, text: string, cwd: string | null): Promise<WorkerContext> {
  const b = parseContextBlock(text);
  if (!b.ok) return b;
  // tick.sh 39행: TICKET_CWD 기본값은 루트의 부모다.
  return { ok: true, items: await withExistence(b.items, [cwd ?? path.dirname(root)]) };
}

/** **원자적 교체.** cron이 1분마다 워커 파일을 실행하고 bash는 스크립트를 조금씩 읽는다 —
 *  제자리 덮어쓰기 중에 tick이 걸리면 반쪽 스크립트가 실행된다. rename은 원자적이라
 *  그 순간의 tick은 이전 파일이나 새 파일 중 하나를 온전히 본다.
 *  `mode`를 받는 이유: 워커 파일의 755를 잃지 않고, 새로 만드는 파일은 호출자가 정한다. */
async function atomicWrite(file: string, text: string, mode: number): Promise<void> {
  const tmp = `${file}.gui-${process.pid}.tmp`;
  await writeFile(tmp, text, { flag: "wx", mode });
  await rename(tmp, file).catch(async (e) => {
    await unlink(tmp).catch(() => {});
    throw e;
  });
}

/** 블록 구간을 새 항목으로 갈고 → 다시 읽어 같은지 확인하고 → 원자적으로 쓴다.
 *  워커 파일과 공통 파일이 **같은 경로를 쓴다**(§4-1: 자기검증·rename을 복붙하지 않는다). */
async function writeBlock(
  file: string,
  text: string,
  span: { start: number; end: number },
  clean: { path: string; desc: string }[],
  arr: string,
  mode: number,
): Promise<string> {
  const next = text.slice(0, span.start) + renderContextBlock(clean, arr) + text.slice(span.end);
  // 자기 검증: 쓴 것을 다시 읽어 같은 항목이 나오는지 본다. 이스케이프가 틀리면 여기서 멈춘다.
  const back = parseContextBlock(next, arr);
  if (!back.ok || JSON.stringify(back.items) !== JSON.stringify(clean)) {
    throw new Error(
      `쓴 블록을 다시 읽었을 때 항목이 달라집니다(${back.ok ? "내용 불일치" : back.reason}). 쓰지 않았습니다.`,
    );
  }
  await atomicWrite(file, next, mode);
  return next;
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
  const next = await writeBlock(
    file,
    text,
    b,
    clean,
    "TICKET_CONTEXT",
    (await stat(file)).mode & 0o777,
  );
  const { cwd } = parseWorkerFile(next);
  return { ok: true, items: await withExistence(clean, [cwd ?? path.dirname(root)]) };
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

// ── 공통 컨텍스트 `<루트>/context.sh` (DESIGN.md §4-1) ──────────────────────
//
// 워커 5개가 같은 3항목을 각자 복사해 들고 있던 것을 사본 하나로 만든다. 엔진은 무수정이다 —
// 셸 파일 하나 + 워커 파일의 `source` 한 줄이고, 새 엔진 변수도 새 프로토콜도 없다.

const COMMON_FILE = "context.sh";
/** 엔진 변수가 아니다. 이 파일 안에서만 쓴다 — 그래서 `TICKET_CONTEXT`와 이름이 갈려야 한다. */
const COMMON_ARR = "TICKET_CONTEXT_COMMON";

/** §4-1의 고정 문구. 처음 쓸 때만 들어가고 그 뒤로는 위 블록만 치환된다.
 *  병합 2줄이 **공통을 워커 자기 항목 앞에** 놓는다(`${arr[@]+"…"}` = set -u에서 미정의 배열을
 *  안전하게 전개하는 tick.sh 44·147행의 관용구. bash 3.2에서 빈 배열도 통한다 — 테스트가 확인). */
const COMMON_TEMPLATE = `# 공통 참조 컨텍스트 — 워커 전원이 source한다. GUI 워커 화면(§4-1)이 위 블록을 치환한다.
# ${COMMON_ARR}은 엔진 변수가 아니다(이 파일 안에서만 쓴다).
${COMMON_ARR}=()
# 공통을 워커 자기 항목 **앞에** 끼운다. \${arr[@]+"…"}는 set -u에서 미정의 배열을 안전하게
# 전개하는 관용구다(bash 3.2 포함 — tick.sh 44·147행과 같은 idiom).
TICKET_CONTEXT=(
  \${${COMMON_ARR}[@]+"\${${COMMON_ARR}[@]}"}
  \${TICKET_CONTEXT[@]+"\${TICKET_CONTEXT[@]}"}
)
`;

/** 워커 파일이 공통 파일을 `.` 하는 한 줄 (§4-1). 블록 **아래**에 들어간다 —
 *  위에 두면 워커의 `TICKET_CONTEXT=(`가 공통을 덮어쓴다(`=`는 대입이다). */
export function commonSourceLine(root: string): string {
  return `. ${dq(path.join(root, COMMON_FILE))}   # 공통 컨텍스트를 최상단에 끼운다`;
}

/** ponytail: `context.sh`를 `.` 하는 줄이면 무엇이든 있는 것으로 본다(경로 비교를 안 한다).
 *  다른 큐의 `context.sh`를 가리키는 줄까지 통과시키는 것이 천장이다 — 그런 워커가 생기면
 *  경로까지 비교한다(그때는 NFC 정규화와 `$HOME` 전개가 같이 필요하다). */
const commonSourceRe = /^[ \t]*(?:\.|source)[ \t]+[^\n]*context\.sh/m;

/** 공통 항목의 `$TICKET_CWD`를 펼 후보들. **공통을 실제로 `source`하는 워커의 값만** 본다 —
 *  못 받는 워커의 cwd로 판정하면 카드가 남의 사실을 말한다. 하나도 없으면 tick.sh 39행 기본값.
 *  ponytail: 워커 파일을 여기서 한 번 더 읽는다(프로젝트당 한 자릿수 파일). `listWorkers`와
 *  합치려면 `Worker`에 cwd를 싣고 호출자 셋을 다 고쳐야 한다 — 느려지면 그때 한다. */
async function commonCwds(root: string): Promise<string[]> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh"));
  const out = new Set<string>();
  for (const n of names) {
    const text = await readFile(path.join(dir, n), "utf8").catch(() => "");
    if (commonSourceRe.test(text)) out.add(parseWorkerFile(text).cwd ?? path.dirname(root));
  }
  return out.size ? [...out] : [path.dirname(root)];
}

/** `<루트>/context.sh`의 공통 항목. **파일이 없으면 0개다 — 오류가 아니다**(§4-1). */
export async function readCommonContext(root: string): Promise<WorkerContext> {
  const file = path.join(root, COMMON_FILE);
  let text: string | null = null;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // 없음 = 공통 0개(빈 상태 카드). 권한·EISDIR은 사유를 넘긴다 — 0개라고 우기지 않는다.
    if (err.code !== "ENOENT") {
      return { ok: false, reason: `${COMMON_FILE}를 읽을 수 없습니다: ${err.message}` };
    }
  }
  if (text === null) return { ok: true, items: [] };
  const b = parseContextBlock(text, COMMON_ARR);
  if (!b.ok) return b;
  // 기준 cwd는 **공통을 받는 워커 전원의 `TICKET_CWD`**다. 루트의 부모(tick.sh 39행 기본값)로
  // 단정하면 워커가 그 값을 덮어쓴 큐에서 있는 파일을 `없음`으로 그린다(`6e3dcd79`).
  return { ok: true, items: await withExistence(b.items, await commonCwds(root)) };
}

/** 공통 항목 치환. 파일이 없으면 §4-1 고정 문구(주석 + 병합 2줄)까지 새로 만든다.
 *  자기검증·원자적 rename은 `writeContext`와 같은 `writeBlock`을 쓴다. */
export async function writeCommonContext(
  root: string,
  items: { path: string; desc: string }[],
): Promise<WorkerContext> {
  const file = path.join(root, COMMON_FILE);
  let text: string | null = null;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  // 있는 파일은 블록만 갈린다 — 병합 2줄은 처음 쓸 때 넣은 뒤 다시 만지지 않는 고정 문구다.
  const base = text ?? COMMON_TEMPLATE;
  const b = parseContextBlock(base, COMMON_ARR);
  if (!b.ok) {
    throw new Error(
      `${COMMON_FILE}의 ${COMMON_ARR} 블록을 GUI가 안전하게 고칠 수 없습니다: ${b.reason}. 파일을 손으로 편집하세요.`,
    );
  }
  const clean = items.map(cleanItem);
  // 실행 파일이 아니다(워커가 `.` 한다). 있던 파일의 mode는 사람이 정한 것이니 잃지 않는다.
  const mode = text === null ? 0o644 : (await stat(file)).mode & 0o777;
  await writeBlock(file, base, b, clean, COMMON_ARR, mode);
  return { ok: true, items: await withExistence(clean, await commonCwds(root)) };
}

/** `source` 줄을 워커 파일에 넣는다. 삽입 위치는 추측하지 않는다 —
 *  `parseContextBlock`이 주는 `end`(닫는 `)`) **바로 다음 줄**이다.
 *  이미 있으면 `false`(no-op), 넣었으면 `true`. */
export async function applyCommonSource(root: string, name: string): Promise<boolean> {
  const file = await workerFile(root, name);
  const text = await readFile(file, "utf8");
  if (commonSourceRe.test(text)) return false;
  const b = parseContextBlock(text);
  if (!b.ok) {
    throw new Error(
      `${name}.sh에 source 줄을 넣을 자리를 GUI가 짚을 수 없습니다: ${b.reason}. 파일을 손으로 편집하세요.`,
    );
  }
  const rest = text.slice(b.end);
  const next =
    text.slice(0, b.end) +
    "\n" +
    commonSourceLine(root) +
    (rest.startsWith("\n") ? rest : "\n" + rest);
  // 자기 검증: 줄을 넣었는데 블록 항목이 달라지면 엉뚱한 라인을 밟은 것이다.
  const back = parseContextBlock(next);
  if (
    !back.ok ||
    JSON.stringify(back.items) !== JSON.stringify(b.items) ||
    !commonSourceRe.test(next)
  ) {
    throw new Error("줄을 넣은 뒤 파일이 예상과 달라집니다. 쓰지 않았습니다.");
  }
  await atomicWrite(file, next, (await stat(file)).mode & 0o777); // 755를 잃지 않는다
  return true;
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

// ── 작업 디렉터리 결함 (§4) ─────────────────────────────────────────────────
//
// 셋 다 **락을 만들지 않는다** — 그래서 이 판정이 없으면 깨진 워커가 `idle`로 뜨고, 사람이 보는
// 것은 "멀쩡한데 일을 안 가져간다"이며 단서는 runner.log 마지막 줄뿐이다(실사고 §4-2).

/** 워커별 결함 배열(입력과 같은 순서). `realpath`가 판정의 근거다:
 *  - 심링크 판정은 `<cwd>/.dira`가 **큐 루트로 풀리는가**다. `ln -s` 함정이 만드는
 *    `.dira/.dira`는 존재하는 디렉터리라서 존재 확인만으로는 통과한다(실사고 `bf4d8878`).
 *  - 공유 판정도 `realpath` 키로 본다 — 표기·심링크가 달라도 같은 트리면 같은 트리다.
 *
 *  ponytail: 워커 수만큼 stat·realpath 2번이다(한 자릿수). 목록이 커지면 요청 단위 캐시. */
async function cwdDefects(root: string, ws: { name: string; cwd: string }[]): Promise<WorkerDefect[][]> {
  const queue = nfc(await realpath(root).catch(() => root));
  // 못 풀리는 경로(없는 디렉터리)는 문자열로 비교한다 — 없는 트리를 둘이 공유하는 것도 공유다.
  const keys = await Promise.all(ws.map((w) => realpath(w.cwd).then(nfc, () => nfc(w.cwd))));
  const byKey = new Map<string, string[]>();
  keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), ws[i].name]));

  return Promise.all(
    ws.map(async ({ name, cwd }, i) => {
      const out: WorkerDefect[] = [];
      const isDir = await stat(cwd).then((s) => s.isDirectory(), () => false);
      if (!isDir) {
        out.push({ kind: "missing-cwd", detail: `${cwd} 가 없거나 디렉터리가 아닙니다.` });
      } else {
        // 트리 자체가 없으면 심링크를 따로 말하지 않는다 — 원인은 하나고 명령도 같다.
        const link = path.join(cwd, ".dira");
        const to = await realpath(link).then(nfc, () => null);
        if (to === null) out.push({ kind: "missing-link", detail: `${link} 가 없습니다.` });
        else if (to !== queue) {
          out.push({ kind: "missing-link", detail: `${link} 가 큐 루트가 아니라 ${to} 로 풀립니다.` });
        }
      }
      const others = (byKey.get(keys[i]) ?? []).filter((n) => n !== name);
      if (others.length > 0) {
        out.push({ kind: "shared-cwd", detail: `${others.join("·")}와 같은 경로입니다: ${cwd}` });
      }
      return out;
    }),
  );
}

// ── 목록 ────────────────────────────────────────────────────────────────────

/** 프로젝트의 워커 전부. 이름 순.
 *
 *  | status | 판정 |
 *  |---|---|
 *  | running | 락 있음 + pid 생존 |
 *  | stale | 락 있음 + pid 죽음(또는 pid 파일이 없다 — tick.sh도 이걸 회수 대상으로 본다) |
 *  | idle | 락 없음 + crontab 등록됨 |
 *  | stopped | 락 없음 + crontab 미등록 |
 *
 *  ponytail: `holding`은 **호출자가 이미 읽은 티켓 목록**에서 찾는다 — 큐를 두 번 읽지 않으려고.
 *  프로젝트 목록·전환기 요약은 holding을 안 쓰므로 안 넘긴다(그때는 항상 null이다). */
export async function listWorkers(root: string, tickets: Ticket[] = []): Promise<Worker[]> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".sh"))
    .sort();
  if (names.length === 0) return [];

  const [cronRaw, logs] = await Promise.all([crontabText(), lastLogByWorker(dir)]);
  const cron = nfc(cronRaw);
  const out: Worker[] = [];
  // 결함 판정에 워커 파일 텍스트가 다시 필요하다(준비 명령의 엔진 레포 경로) — 두 번 읽지 않는다.
  const texts: string[] = [];
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
      // 이 줄이 없는 워커는 공통을 못 받는다 — 화면이 경고 + `공통 적용`을 띄운다(§4-1).
      commonSource: commonSourceRe.test(text),
      cwd: parsed.cwd,
      defects: [], // 공유 판정이 목록 전체를 봐야 하므로 행을 다 만든 뒤에 채운다
    });
    texts.push(text);
  }

  // tick.sh 39행: TICKET_CWD 줄이 없는 워커의 실효 cwd는 루트의 부모다(contextOf와 같은 기준).
  const eff = out.map((w) => ({ name: w.name, cwd: w.cwd ?? path.dirname(root) }));
  const defects = await cwdDefects(root, eff);
  defects.forEach((d, i) => {
    if (d.length === 0) return; // 결함 0개인 워커는 아무것도 늘지 않는다
    out[i].defects = d;
    // 명령 문자열은 §4 생성과 **같은 함수**에서 나온다 — 두 자리가 다른 걸 보여주면 안 된다.
    out[i].worktree = worktreeCmds(root, out[i].name, texts[i], `${out[i].name}.sh`);
  });
  return out;
}

/** 목록 행의 워커 줄 — 상태별 묶음(DESIGN.md §비주얼 §7). `running 1 / idle 1` 요약을 대체한다:
 *  같은 모양에 이름을 채워 넣은 것이다.
 *
 *  순서는 §2 워커 4상태 표 순서로 **고정**이고 심각도 순으로 재정렬하지 않는다 — `stale`을 앞으로
 *  당기면 상태 구성이 다른 행끼리 자리가 어긋나 세로로 훑을 수 없다. 없는 상태는 묶음이 없다. */
export function workerGroups(workers: Worker[]): { status: WorkerStatus; names: string[] }[] {
  const order: WorkerStatus[] = ["running", "idle", "stopped", "stale"];
  return order
    .map((status) => ({
      status,
      names: workers.filter((w) => w.status === status).map((w) => w.name),
    }))
    .filter((g) => g.names.length > 0);
}

// ── crontab 명령어 (등록·해제가 실패했을 때 사람이 실행한다, 제약 4) ────────

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

// ── crontab 쓰기 (제약 4 — 그 프로젝트의 워커 줄만) ─────────────────────────
//
// crontab은 **머신 전역**이다: 남의 프로젝트 큐와 사람의 무관한 잡이 같은 파일에 산다.
// 그래서 변경을 텍스트 순수 함수로 계산한다 — 보존을 진짜 crontab 없이 테스트할 수 있어야 한다.

/** 이 워커 파일 경로가 들어간 줄인가. **비교만 NFC로** 한다(`nfc` 주석 · a622f9e4·38eec0d4):
 *  macOS crontab 줄은 사람이 넣은 NFC인데 `readdir`가 준 경로는 NFD인 큐가 있다.
 *  판정은 `listWorkers`의 `cron`(부분일치)·`grep -Fv`와 같아야 한다 — 갈리면 화면이 거짓말을 한다. */
const isWorkerLine = (line: string, workerPath: string) => nfc(line).includes(nfc(workerPath));

/** 줄 단위 필터. `split("\n")`의 마지막 빈 원소가 후행 개행을 들고 있어서 그대로 join하면
 *  남는 줄은 **바이트 그대로**다(재정렬·재인용·주석 삭제·빈 줄 정리 없음). */
export function cronUnregister(text: string, workerPath: string): string {
  return text
    .split("\n")
    .filter((l) => !isWorkerLine(l, workerPath))
    .join("\n");
}

/** 먼저 그 경로의 줄을 다 지우고 한 줄을 넣는다 — 두 번 등록해도 중복 줄이 안 생긴다
 *  (`cronRegisterCmd`와 같은 의미). 줄에 들어가는 경로는 정규화하지 **않는다** — 셸이 실제로
 *  실행할 문자열이라 파일시스템이 준 바이트 그대로여야 한다. */
export function cronRegister(text: string, workerPath: string): string {
  const kept = cronUnregister(text, workerPath);
  // 마지막 줄에 개행이 없으면 넣는다 — 안 그러면 남의 줄에 우리 줄이 이어 붙는다.
  const base = kept === "" || kept.endsWith("\n") ? kept : `${kept}\n`;
  return `${base}${cronLine({ path: workerPath })}\n`;
}

/** 쓰기 직전의 읽기. `crontabText()`와 달리 **모든 실패를 빈 crontab으로 보지 않는다** —
 *  읽기 실패를 "비었다"로 오해하고 그 위에 쓰면 남의 줄이 전부 사라진다. 진짜로 비어 있는
 *  경우(`crontab: no crontab for <user>`)만 빈 문자열이다. */
async function crontabForWrite(): Promise<string> {
  try {
    return (await promisify(execFile)("crontab", ["-l"], { timeout: CRONTAB_TIMEOUT })).stdout;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string; killed?: boolean };
    if (err.killed) throw new Error(timedOut("crontab -l"));
    if (!err.stdout && /no crontab for/i.test(err.stderr ?? "")) return "";
    throw new Error(`crontab -l 실패: ${(err.stderr || err.message).trim()}`);
  }
}

/** **crontab은 응답하지 않을 수 있다.** 실측(2026-07-31): 이 머신에서 `crontab <파일>`도
 *  `crontab -`도 영원히 안 끝난다(읽기는 정상) — macOS가 그 프로세스에 권한을 물으려다 막힌
 *  모양새다. 기다림에 끝이 없으면 화면은 `만드는 중…`에 영원히 갇히고, "등록 실패는 성공 보고를
 *  막지 않는다"(DESIGN.md §0-3 · §4)가 성립하지 않는다. 끊어서 **실패로 만들어야** 그 규약이
 *  산다 — 화면은 사유와 `cronRegisterCmd`를 보여주고 사람이 셸에서 마무리한다.
 *  // ponytail: 고정 10초. 값이 문제가 되면 그때 설정으로 뺀다 */
const CRONTAB_TIMEOUT = 10_000;
const timedOut = (cmd: string) =>
  `${cmd}가 10초 안에 응답하지 않아 중단했습니다. 셸에서 직접 실행해 보세요 — 권한을 묻는 창이 떠 있을 수 있습니다.`;

/** **읽기는 쓰기 직전에 한다.** 렌더 때 읽은 값을 재사용하면 그 사이 남의 변경을 되돌린다
 *  (§결정 기록 실측 — 스펙 쓰는 20분 사이에 남의 줄이 하나 줄었다). 창은 좁힐 수 있을 뿐
 *  없앨 수 없다(crontab에 잠금이 없다).
 *
 *  쓰기는 `crontab -`의 **stdin**이다 — `sh -c`도 임시 파일도 아니다(경로에 공백·한글·따옴표가
 *  들어 있는 큐가 실제로 있다). 그리고 **다시 읽어 확인한다**: 종료코드만 보지 않는다.
 *
 *  돌려주는 값은 **crontab이 실제로 바뀌었는가**다. false = 이미 그 상태였다(no-op) — 중단이
 *  "이미 미등록입니다"를 에러가 아니라 사실로 말할 수 있는 근거가 이것뿐이다. */
async function applyCrontab(workerPath: string, want: boolean): Promise<boolean> {
  const before = await crontabForWrite();
  const next = want ? cronRegister(before, workerPath) : cronUnregister(before, workerPath);
  const changed = next !== before;
  if (changed) {
    await new Promise<void>((resolve, reject) => {
      const child = execFile("crontab", ["-"], { timeout: CRONTAB_TIMEOUT }, (err, _out, stderr) => {
        const killed = (err as { killed?: boolean } | null)?.killed;
        if (err) reject(new Error(killed ? timedOut("crontab -") : `crontab - 실패: ${(stderr || err.message).trim()}`));
        else resolve();
      });
      child.stdin!.end(next);
    });
  }
  const after = await crontabForWrite();
  if (after.split("\n").some((l) => isWorkerLine(l, workerPath)) !== want) {
    throw new Error(
      want
        ? "crontab에 썼는데 다시 읽으니 그 줄이 없습니다(쓰기가 조용히 막힌 환경일 수 있습니다)."
        : "crontab에서 뺐는데 다시 읽으니 그 줄이 남아 있습니다.",
    );
  }
  return changed;
}

/** 이 워커 줄 하나를 crontab에 넣는다(이미 있으면 그 줄을 새로 쓴다). */
export const registerCron = (workerPath: string) => applyCrontab(workerPath, true);
/** 이 워커 줄을 뺀다. 없으면 아무것도 쓰지 않는다. */
export const unregisterCron = (workerPath: string) => applyCrontab(workerPath, false);

/** 워커가 0개인 큐의 **첫 워커**를 손으로 만드는 명령. `<dira 레포>`는 채워지지 않는다 —
 *  엔진 코드 위치는 워커 파일에만 적혀 있고, 워커가 없으면 GUI가 알 방법이 없다(→ createWorker). */
export function firstWorkerCmd(root: string, name = "w1"): string {
  const dir = sq(path.join(root, "workers"));
  const file = sq(path.join(root, "workers", `${name}.sh`));
  return `mkdir -p ${dir} && cp <dira 레포>/worker.sh.example ${file} && chmod 755 ${file}`;
}

// ── 워크트리 (§4-2) ─────────────────────────────────────────────────────────

/** 워커의 작업 디렉터리는 **이름에서 유도한다**(템플릿에서 복사하지 않는다). 두 워커가 같은
 *  트리를 가리키는 값을 GUI가 쓸 수 없어야 한다 — 실사고: `w4`·`w5`가 `w1`의 트리를 물려받아
 *  세 세션이 브랜치 `wt/w1`에 커밋했다(§4-2). */
const worktreePath = (root: string, name: string) => path.join(root, "worktrees", name);

/** `TICKET_CWD` 줄 **하나만** 새 워커 값으로 다시 쓴다. 들여쓰기·`export` 접두는 있던 그대로 —
 *  바뀌는 건 `=` 오른쪽뿐이다. 줄이 아예 없으면(엔진 기본값 = 루트의 부모를 쓰는 워커) 넣는데,
 *  위치는 추측하지 않는다: `#!` 다음 줄, 아니면 맨 앞. */
export function rewriteCwd(text: string, root: string, name: string): string {
  const val = dq(worktreePath(root, name));
  // `.match`는 `/g` 정규식의 lastIndex를 남기지 않는다(`.test`와 다르다 — cwdAssign은 공유다).
  if (text.match(cwdAssign)) {
    return text.replace(cwdAssign, (m, v: string) => m.slice(0, m.length - v.length) + val);
  }
  const lines = text.split("\n");
  lines.splice(lines[0].startsWith("#!") ? 1 : 0, 0, `TICKET_CWD=${val}`);
  return lines.join("\n");
}

/** 워커 파일의 `. "<레포>/tick.sh"` 줄. 엔진 코드 위치는 **워커 파일에만** 적혀 있다. */
export const sourceTick = /^[ \t]*(?:\.|source)[ \t]+(.*tick\.sh["']?)[ \t]*$/m;

/** 그 줄을 **쓰는** 쪽(`lib/scaffold.ts`의 첫 워커). 읽기(`sourceTick`)와 같은 파일에 둬야
 *  두 모양이 갈리지 않는다. */
export const tickSourceLine = (repo: string) => `. ${dq(path.join(repo, "tick.sh"))}`;

/** 워크트리 준비 명령 **2줄 + 검증 1줄**(§4 생성 3항). **GUI는 실행하지 않는다**(§4-2):
 *  `git worktree add`는 큐가 아니라 엔진 레포에 쓰는 체크아웃이고, 그 레포 경로는 워커 파일에서
 *  읽은 추측값이라 §경로 방어의 "등록된 root 안"이 안 걸린다. 못 읽으면 자리표시자를 두고
 *  **사유를 같이** 넘긴다(§6 에러 3요소 — 삼키면 사람이 왜 빈칸인지 모른다).
 *
 *  검증 줄은 장식이 아니다: `.dira`가 이미 있으면 `ln -s`가 실패하는 대신 그 **안쪽에**
 *  링크를 만든다(실사고 `bf4d8878`) — 세션이 미끼 큐를 보고 자기 티켓을 못 찾는다. */
export function worktreeCmds(
  root: string,
  name: string,
  templateText: string,
  templateName: string,
): { cmds: string[]; reason?: string } {
  const dir = worktreePath(root, name);
  const m = sourceTick.exec(templateText);
  const raw = m?.[1] ?? null;
  const repo = raw === null ? null : shellPath(raw);
  const cmds = [
    `git -C ${repo === null ? "<dira 레포>" : sq(path.dirname(expandHome(repo)))} worktree add ${sq(dir)} -b wt/${name}`,
    `ln -s ../.. ${sq(path.join(dir, ".dira"))}`,
    `ls -ld ${sq(path.join(dir, ".dira"))}    # \`l\`로 시작해야 한다`,
  ];
  if (repo !== null) return { cmds };
  return {
    cmds,
    reason:
      raw === null
        ? `${templateName}에 \`. <레포>/tick.sh\` 줄이 없어 엔진 레포 경로를 읽지 못했습니다.`
        : `${templateName}의 tick.sh 경로를 셸 없이 해석할 수 없습니다(\`${raw}\`). $HOME 외의 변수·명령 치환은 GUI가 펴지 않습니다.`,
  };
}

// ── 생성 · 중단 · 삭제 ──────────────────────────────────────────────────────

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
 *  화면이 그 사실과 손으로 만드는 법을 알린다.
 *
 *  복사한 뒤 **`TICKET_CWD` 줄만** 새 이름으로 다시 쓴다(§4-2). 나머지 줄은 손대지 않는다 —
 *  엔진 경로·게이트·컨텍스트가 템플릿에서 와야 하는 이유는 그대로다. */
export async function createWorker(
  root: string,
  name: string,
): Promise<{ path: string; template: string; worktree: { cmds: string[]; reason?: string } }> {
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
  await writeFile(file, rewriteCwd(text, root, name), { flag: "wx" });
  await chmod(file, 0o755);
  return { path: file, template, worktree: worktreeCmds(root, name, text, template) };
}

/** 중단 = **crontab 줄만 뺀다.** 파일도 락도 돌고 있는 세션도 건드리지 않는다 —
 *  물고 있는 티켓은 끝까지 가고 그 다음 tick이 없을 뿐이다(DESIGN.md §4 중단).
 *  false = 이미 미등록이었다(no-op이지 에러가 아니다).
 *
 *  이름은 경로로 조립하지 않는다 — `readdir`가 준 실제 워커 목록에서 찾는다. */
export async function stopWorker(root: string, name: string): Promise<boolean> {
  const w = (await listWorkers(root)).find((x) => x.name === name);
  if (!w) throw new Error(`없는 워커입니다: ${name}`);
  return unregisterCron(w.path);
}

/** crontab 줄을 빼고 파일을 지운다 — **순서가 그렇다**(DESIGN.md §4 삭제). 뒤집으면 그 사이
 *  1분에 cron이 없는 파일을 실행한다. 해제가 실패하면 파일을 남기고 멈춘다: 절반 지워진
 *  상태(파일은 없는데 cron 줄은 남은)를 만들지 않는다. */
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
  // `cronFailed`는 화면이 해제 명령어를 **이 실패에만** 보여주려고 본다. unlink가 실패한
  // 경우에 같은 명령을 권하면 이미 빠진 줄을 다시 빼라는 거짓 안내가 된다.
  await unregisterCron(w.path).catch((e: Error) => {
    throw Object.assign(
      new Error(`crontab에서 ${name} 줄을 빼지 못했습니다: ${e.message} 파일은 지우지 않았습니다.`),
      { cronFailed: true },
    );
  });
  await unlink(file);
}
