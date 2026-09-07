/** pty 매니저 — `script`가 pty를 준다, 네이티브 모듈 0개 (DESIGN.md §11-1 결정 1·3).
 *
 *  `lib/auth.ts`의 `claude setup-token` 드라이버와 **같은 `cat | script` 관용구**를 쓴다 —
 *  macOS `script`는 stdin이 소켓(Node `stdio: "pipe"`의 실체)이면 즉시 죽으므로, 진짜
 *  `pipe(2)`를 주는 `cat |`을 앞에 문다(그 파일 머리 주석의 실측). 다른 점은 대상이 **한 줄짜리
 *  명령이 아니라 사람의 로그인 셸**이라는 것 — 실행이 끝날 때를 표식으로 잡을 필요가 없다
 *  (§11-1 결정 4 — 탭을 닫아야 `SIGTERM` 하나로 끝난다. `EXIT_MARK` 같은 종료 감지는 여기 없다:
 *  `cat`이 우리 stdin을 쥔 채라 `exit`을 쳐도 파이프라인이 안 끝나고, 이 회차의 수용조건은
 *  "닫으면 죽는다"까지다. ponytail: 사람이 셸 안에서 `exit`을 쳐도 pty가 안 끝난다 — 종료
 *  감지가 필요해지면 auth.ts의 EXIT_MARK 패턴을 가져온다).
 *
 *  **raw는 escape를 안 걷어낸다** — 화면(`@xterm/xterm`)이 ANSI를 직접 그리므로 `auth.ts`의
 *  `ptyLines`(Ink TUI 로그 한 줄용) 같은 후처리가 필요 없다. */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

/** §11-1 결정 3 — 탭 상한 12(`tabs.ts`)와 갈리는 값. 서버 프로세스 전체에서 하나다(프로젝트별이
 *  아니다) — 화면 여러 개를 열어도 이 머신이 무는 셸 프로세스 수는 하나로 잰다. */
export const PTY_LIMIT = 8;

/** 재접속 시 새 구독자에게 먼저 흘려보낼 화면 상태 — 표면을 갈았다 돌아와도 스크롤백이
 *  끊기지 않는다(§11 결정 4 — 터미널은 폴링에 안 들어서 다시 그릴 다른 출처가 없다).
 *  `auth.ts`의 256_000자 상한과 같은 자릿수 — 진행 로그가 아니라 실제 화면이라 좀 더 넉넉히 둔다. */
const BACKLOG_CAP = 512_000;

type PtyEntry = {
  child: ChildProcess;
  cwd: string;
  backlog: string;
  listeners: Set<(chunk: string) => void>;
  exited: boolean;
  /** §11-6 결정 2 — 사람이 마지막으로 엔터를 친 명령. 빈 문자열 = 아직 한 번도 안 쳤다. */
  lastCommand: string;
};

/** **`globalThis`에 심는다 — 모듈 top-level 변수로는 안 된다.** Next가 Server Action과
 *  라우트 핸들러를 각각 다른 번들(다른 module registry)로 묶어서, 같은 프로세스 안에서도
 *  `import "./pty.ts"`가 두 벌 실행된다(실측 - 이 파일 로드 시 콘솔 로그를 심어 확인. 액션
 *  (`openPty`)이 심은 pty를 라우트의 `subscribePty`가 못 찾고 `writePty`도 조용히 `false`를
 *  냈다). `globalThis`는 프로세스 하나에 하나뿐이라 번들이 갈려도 같은 자리를 본다 —
 *  `usage.ts`의 TTL 캐시 등 다른 모듈 싱글턴에는 없던 문제다: 그것들은 액션과 라우트 양쪽에서
 *  동시에 안 쓰인다. */
const g = globalThis as unknown as { __diraPtys?: Map<string, PtyEntry> };
const ptys = (g.__diraPtys ??= new Map<string, PtyEntry>());

function aliveCount(): number {
  let n = 0;
  for (const e of ptys.values()) if (!e.exited) n++;
  return n;
}

/** `stty`로 고정 크기를 준다 — 이 경로로 여는 pty는 winsize가 0x0이다(`auth.ts` 머리 주석과
 *  같은 실측). 창 크기에 맞춰 동적으로 갈지 않는다(§11-1 수용조건 밖) —
 *  ponytail: 고정 120x32, 창 크기 반영이 필요해지면 `resize` 액션 + `stty` 재호출을 얹는다. */
function shellCmd(shell: string): string {
  return `cat | script -q /dev/null sh -c 'stty cols 120 rows 32; ${shell.replace(/'/g, "'\\''")}'`;
}

function spawnInto(id: string, cwd: string, shell: string): void {
  const child = spawn("sh", ["-c", shellCmd(shell)], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // §11-1 결정 4 — 그룹째 SIGTERM으로 죽인다(`sh`·`cat`·`script`·셸 전부)
    // **`TERM`을 명시한다.** Next 서버 프로세스가 어떻게 떠 있느냐(런처·크론·Electron)에 따라
    // `TERM`이 아예 없을 수 있고, 그러면 셸이 `dumb`으로 물러난다(실측) — `vim`이 전체 화면
    // 모드를 거부하고 `ls --color`가 색을 죽인다. `@xterm/xterm`이 아는 값을 준다.
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const entry: PtyEntry = { child, cwd, backlog: "", listeners: new Set(), exited: false, lastCommand: "" };
  ptys.set(id, entry);

  const feed = (d: Buffer) => {
    const s = d.toString("utf8");
    entry.backlog = (entry.backlog + s).slice(-BACKLOG_CAP);
    for (const l of entry.listeners) l(s);
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed); // 셸 자체의 stderr도 같은 화면에 낸다 — 사람이 볼 곳이 하나다

  const onExit = () => {
    entry.exited = true;
  };
  child.on("exit", onExit);
  child.on("close", onExit);
  child.on("error", onExit);
}

/** 새 pty를 연다. 상한(8)에 걸리면 아무것도 안 만들고 사유를 낸다. */
export function openPty(cwd: string, shell: string): { id: string } | { error: "limit" } {
  if (aliveCount() >= PTY_LIMIT) return { error: "limit" };
  const id = randomUUID();
  spawnInto(id, cwd, shell);
  return { id };
}

/** `끊긴` 탭을 다시 연다(§11 결정 2) — **같은 pty를 되살리지 않는다.** 남아 있으면(사람이
 *  새로고침만 하고 탭을 안 닫은 경우) 먼저 죽이고, 같은 id 자리에 새 pty를 심는다 — 탭(UI 자리)의
 *  정체성은 그대로 두고 안의 프로세스만 간다. */
export function restartPty(id: string, cwd: string, shell: string): { id: string } | { error: "limit" } {
  const existing = ptys.get(id);
  if (existing) killEntry(existing);
  ptys.delete(id);
  if (aliveCount() >= PTY_LIMIT) return { error: "limit" };
  spawnInto(id, cwd, shell);
  return { id };
}

function killEntry(entry: PtyEntry): void {
  if (entry.exited) return;
  try {
    if (entry.child.pid) process.kill(-entry.child.pid, "SIGTERM"); // 그룹째 — §11-1 결정 4
  } catch {
    // 이미 죽었다
  }
  entry.exited = true;
}

/** 탭을 닫을 때 부른다 — `SIGTERM` 하나, `SIGKILL` 사다리가 없다(§11-1 결정 4). */
export function killPty(id: string): boolean {
  const entry = ptys.get(id);
  if (!entry) return false;
  killEntry(entry);
  ptys.delete(id);
  return true;
}

/** 서버 정상 종료 시 열려 있는 pty를 전부 죽인다(§11-1 §개정 — "서버가 죽으면 자식이라 같이
 *  죽는다"는 사실이 아니다. POSIX는 죽은 부모의 자식을 `ppid 1`로 재입양시킬 뿐 안 죽인다). */
export function killAllPtys(): void {
  for (const entry of ptys.values()) killEntry(entry);
}

/** `SIGTERM` · `SIGINT` · 정상 `exit` 셋에서 `killAllPtys`를 부르도록 한 번만 건다. **모듈
 *  top-level이 아니라 이 함수를 통해서만 등록한다** — 이 파일은 Server Action과 라우트 핸들러가
 *  각각 다른 번들로 실어 두 벌 로드된다(위 `ptys` 맵의 실측과 같은 원인). 등록도 `globalThis`
 *  플래그로 지켜야 두 벌이 각각 `process.on`을 걸어 종료 한 번에 `killAllPtys`가 두 번 도는
 *  일이 없다. `SIGKILL`은 핸들러가 돌 기회 자체가 없어 못 덮는다 — 스펙도 덮는다고 안 적는다. */
export function registerShutdownHandlers(): void {
  const gh = globalThis as unknown as { __diraPtyShutdownRegistered?: boolean };
  if (gh.__diraPtyShutdownRegistered) return;
  gh.__diraPtyShutdownRegistered = true;
  const shutdown = () => {
    killAllPtys();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", killAllPtys); // 동기 전용 — killAllPtys는 이미 동기다
}

export function ptyAlive(id: string): boolean {
  const e = ptys.get(id);
  return !!e && !e.exited;
}

/** 테스트 전용 — `kill`이 실제로 OS 프로세스 그룹을 지웠는지 `ps`로 다시 잴 때 쓴다.
 *  화면·액션은 pid를 몰라도 된다(§11-1 — 아는 것은 id뿐이다). */
export function pidOf(id: string): number | undefined {
  return ptys.get(id)?.child.pid;
}

/** 마지막 명령 200자 상한 — 서버 메모리에 무한정 긴 줄이 안 남는다(§11-6 결정 2). */
const LAST_COMMAND_CAP = 200;

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/** OSC(제목·cwd 알림 등) 이스케이프 — `\x1b]...`가 BEL(`\x07`) 또는 `ST`(`\x1b\\`)로 끝난다.
 *  `ANSI_ESCAPE`(CSI, `\x1b[...`)가 이 모양을 안 잡는다 — 커스텀 프롬프트가 매 줄 이걸 찍으면
 *  (실측 - 버그 1) 걷어내지 않은 원문이 그대로 <마지막 명령>에 남아 절대 안 갈린다. */
// eslint-disable-next-line no-control-regex
const OSC_ESCAPE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

/** 대괄호가 없는 2바이트 이스케이프 — DECKPAM/DECKPNM(`\x1b=` · `\x1b>`) 류. `ANSI_ESCAPE`(CSI,
 *  `\x1b[...`)·`OSC_ESCAPE`(`\x1b]...`) 둘 다 `[`나 `]`를 요구해 이 모양은 못 잡는다(8b1d625c
 *  실측 - 이 머신 프롬프트 원문에 `\x1b=`가 그대로 남아 있었다). */
// eslint-disable-next-line no-control-regex
const SHORT_ESCAPE = /\x1b[=>]/g;

/** 화면 기록 한 줄에서 사람이 친 명령을 집는다(§11-6 결정 2) — 단위 테스트가 이 함수 하나를
 *  잰다. ANSI·OSC·짧은 이스케이프를 걷어낸 뒤, 줄 안에 `\r`(개행 없이 커서만 처음으로 되돌리는
 *  재그리기 — zsh 라인 에디터가 키 하나마다 프롬프트째 다시 찍는 셸에서 나온다)이 있으면
 *  **마지막 `\r` 다음만** 남긴다 — 그 앞은 이전 키 입력의 재그리기라 이미 덮어써진 화면이다
 *  (버그 2, 이 티켓 — 이걸 안 자르면 재그리기가 누적돼 200자 상한이 최신 내용 도달 전에
 *  걸린다). 그 뒤 마지막 `$ ` - `% ` - `# ` 뒤를 집고, 셋 중 하나도 없으면 줄 전체다. */
export function extractLastCommand(rawLine: string): string {
  const clean = rawLine.replace(OSC_ESCAPE, "").replace(ANSI_ESCAPE, "").replace(SHORT_ESCAPE, "");
  const redrawn = clean.lastIndexOf("\r") >= 0 ? clean.slice(clean.lastIndexOf("\r") + 1) : clean;
  let cut = -1;
  for (const marker of ["$ ", "% ", "# "]) {
    const idx = redrawn.lastIndexOf(marker);
    if (idx > cut) cut = idx + marker.length;
  }
  const picked = cut >= 0 ? redrawn.slice(cut) : redrawn;
  // 상한을 넘으면 **뒤(최신 쪽)를 남긴다** — 사람이 방금 친 글자는 줄 끝에 있다.
  return picked.length > LAST_COMMAND_CAP ? picked.slice(-LAST_COMMAND_CAP) : picked;
}

/** 사람의 입력 — xterm의 `onData`가 준 문자열을 그대로 stdin에 흘린다(엔터·화살표 등은
 *  xterm이 이미 셸이 기대하는 이스케이프로 바꿔 준다).
 *
 *  **엔터(`\r`)를 보는 순간 `backlog`의 마지막 줄을 <마지막 명령>으로 적는다**(§11-6 결정 2) —
 *  화면 전체를 뒤지지 않는다. 히스토리 화살표·탭 완성으로 채운 명령도 셸이 화면에 에코해 두므로
 *  같은 자리에서 잡힌다. */
export function writePty(id: string, data: string): boolean {
  const entry = ptys.get(id);
  if (!entry || entry.exited) return false;
  if (data.includes("\r")) {
    const lines = entry.backlog.split("\n");
    entry.lastCommand = extractLastCommand(lines[lines.length - 1] ?? "");
  }
  entry.child.stdin?.write(data);
  return true;
}

type ProcRow = { pid: number; ppid: number; comm: string };

const SHELL_NAMES = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh"]);

/** 프로세스 표를 한 번 읽는다 — `ptyStatuses`가 폴링 한 번에 이 함수를 한 번만 부른다
 *  (§11-6 결정 3 — "`ps`는 폴링 한 번에 한 번이다"). */
function readProcessTable(): ProcRow[] {
  try {
    const out = execFileSync("ps", ["-Ao", "pid=,ppid=,comm="], { encoding: "utf8" });
    const rows: ProcRow[] = [];
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
    }
    return rows;
  } catch {
    return [];
  }
}

/** §11-6 결정 3 — <작업중>은 "그 pty의 로그인 셸이 자식 프로세스를 물고 있는가"다. `rootPid`
 *  (`spawnInto`가 연 최상위 `sh`) 아래로 단일 사슬(`sh → cat`·`script` → 로그인 셸)을 훑어
 *  셸류 프로세스를 찾고, 그 셸이 자식을 물고 있으면 참이다. 출력이 온 시각으로 재지 않는다 —
 *  `sleep 30`이 도는 동안에도 이 판정은 그대로 참이다. */
function isWorking(rootPid: number, rows: ProcRow[]): boolean {
  const childrenOf = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const list = childrenOf.get(r.ppid);
    if (list) list.push(r);
    else childrenOf.set(r.ppid, [r]);
  }
  let shellPid: number | null = null;
  const visited = new Set<number>([rootPid]);
  let frontier = childrenOf.get(rootPid) ?? [];
  while (frontier.length > 0) {
    const next: ProcRow[] = [];
    for (const proc of frontier) {
      if (visited.has(proc.pid)) continue;
      visited.add(proc.pid);
      // macOS `ps comm=`은 절대경로를 낸다(`/opt/homebrew/bin/zsh`) — 마지막 조각만 비교한다.
      if (SHELL_NAMES.has(proc.comm.split("/").pop() ?? proc.comm)) shellPid = proc.pid;
      next.push(...(childrenOf.get(proc.pid) ?? []));
    }
    frontier = next;
  }
  if (shellPid === null) return false;
  return (childrenOf.get(shellPid) ?? []).length > 0;
}

export type PtyStatus = { lastCommand: string; working: boolean; alive: boolean };

/** 좌측 목록 한 벌 — 마지막 명령 - 작업중 - 끊김을 `ps` 한 번으로 같이 낸다(§11-6 결정 3 · 4).
 *  없는 id는 `alive: false`로 낸다(이미 닫힌 탭). */
export function ptyStatuses(ids: string[]): Record<string, PtyStatus> {
  const rows = readProcessTable();
  const result: Record<string, PtyStatus> = {};
  for (const id of ids) {
    const entry = ptys.get(id);
    if (!entry || entry.exited || !entry.child.pid) {
      result[id] = { lastCommand: entry?.lastCommand ?? "", working: false, alive: false };
      continue;
    }
    result[id] = { lastCommand: entry.lastCommand, working: isWorking(entry.child.pid, rows), alive: true };
  }
  return result;
}

/** 스트림 구독 — GET 라우트가 `ReadableStream.start()` 안에서 부른다. 없는 id면 `null`.
 *  `backlog`는 구독 시작 전까지 쌓인 화면이고, 그 뒤로는 `unsubscribe`를 부를 때까지 실시간
 *  청크가 온다. */
export function subscribePty(
  id: string,
  onChunk: (s: string) => void,
): { backlog: string; alive: boolean; unsubscribe: () => void } | null {
  const entry = ptys.get(id);
  if (!entry) return null;
  entry.listeners.add(onChunk);
  return { backlog: entry.backlog, alive: !entry.exited, unsubscribe: () => entry.listeners.delete(onChunk) };
}
