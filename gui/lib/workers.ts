/** 워커 파일·락·crontab 판정 (DESIGN.md §워커 상태 판정 · §4).
 *
 *  crontab은 **읽기 전용**이다(제약 4): `crontab -l`을 파싱해 현황만 보고, 등록·해제는
 *  `cronRegisterCmd`/`cronUnregisterCmd`가 만든 명령어를 사람이 복사해 실행한다.
 *  상태 전이(reap·unassign)도 여기서 다시 구현하지 않는다 — `lib/engine.ts`가 워커를 부른다. */
import { createHash } from "node:crypto";
import { chmod, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NAME_RE, expandHome, resolveWithin } from "./paths.ts";
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

/** `TICKET_NAME` 값만 벗긴다. tenants.ts의 `shellValue`를 쓰지 않는 이유는 순환 import뿐이다
 *  (tenants.ts → workers.ts). 이름은 `^[A-Za-z0-9_-]+$`라 `$HOME` 치환도 필요 없다. */
function unquote(raw: string): string | null {
  const s = raw.trim().split(/[ \t#]/)[0];
  const v = s.replace(/^["']|["']$/g, "");
  return v || null;
}

/** 워커 파일에서 읽는 값. **셸을 실행하지 않는다** — 등록된 경로의 임의 코드가 GUI 권한으로
 *  도는 걸 막는 게 이 함수의 존재 이유다(tenants.ts §shellValue와 같은 결정). */
function parseWorkerFile(text: string): { name: string | null; engine: string | null } {
  let name: string | null = null;
  for (const m of text.matchAll(nameAssign)) name = unquote(m[1]) ?? name; // 뒤 할당이 이긴다

  let engine: string | null = null;
  const m = engineAssign.exec(text);
  if (m) {
    const open = m.index + m[0].length;
    const close = text.indexOf(")", open);
    // 닫는 괄호가 없으면 파일이 깨진 것이다 — 추측해서 반쪽을 보여주지 않는다.
    if (close > open) engine = text.slice(open, close).replace(/\\?\s+/g, " ").trim() || null;
  }
  return { name, engine };
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
 *  쓰므로 거기서 워커 이름을 되짚는다. `.wip` 티켓만 본다 — 끝난 티켓의 owner는 기록이다. */
function holdingOf(tickets: Ticket[], effName: string): string | null {
  for (const t of tickets) {
    if (t.state !== "wip") continue;
    const owner = t.fm.owner ?? "";
    const i = owner.lastIndexOf(" / ");
    const tail = i < 0 ? owner : owner.slice(i + 3);
    // `<이름>-<8자>`. 이름에 `-`가 들어가도 길이로 갈린다(정규식을 짓지 않는 이유 = 이름이
    // 파일시스템에서 오므로 메타문자가 섞일 수 있다).
    if (tail.length === effName.length + 9 && tail.startsWith(effName + "-")) return t.hash;
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

  const [cron, logs] = await Promise.all([crontabText(), lastLogByWorker(dir)]);
  const out: Worker[] = [];
  for (const file of names) {
    const name = file.slice(0, -3);
    const full = path.join(dir, file);
    const parsed = parseWorkerFile(await readFile(full, "utf8").catch(() => ""));
    // tick.sh 37행: TICKET_NAME 기본값이 파일명이다. 락·로그·owner가 전부 이 값으로 간다.
    const eff = parsed.name ?? name;
    const { held, pid } = await lockOf(lockPath(dir, eff));
    // crontab 한 줄은 인용부호가 붙기도 하므로 절대경로 부분일치로 본다(제약 4: 읽기 전용).
    const inCron = cron.includes(full);
    out.push({
      name,
      path: full,
      status: held ? (pid && alive(pid) ? "running" : "stale") : inCron ? "idle" : "stopped",
      cron: inCron,
      lockPid: pid,
      holding: holdingOf(tickets, eff),
      engine: parsed.engine ?? DEFAULT_ENGINE,
      lastLog: logs[eff] ?? null,
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

export function cronRegisterCmd(worker: Pick<Worker, "path">): string {
  return `(crontab -l 2>/dev/null; echo ${sq(cronLine(worker))}) | crontab -`;
}

/** 이 파일 경로가 들어간 줄을 지운다(`-F` = 경로를 정규식으로 해석하지 않는다). */
export function cronUnregisterCmd(worker: Pick<Worker, "path">): string {
  return `crontab -l | grep -Fv ${sq(worker.path)} | crontab -`;
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
