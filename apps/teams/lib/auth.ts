/** Claude 장기 토큰 — 상태 읽기 · 저장 (DESIGN.md §0-4).
 *
 *  **엔진은 한 줄도 안 고친다**(제약 1). 여기가 하는 일은 `tick.sh:52-54`가 이미 정한 계약을
 *  따라 쓰는 것뿐이다 — 경로 `$TICKET_LOCAL/oauth-token`, 내용은 **개행 없는 한 줄**, 권한 `0600`.
 *  `.authwarn`은 건드리지 않는다: 엔진이 "이미 한 번 경고했다"를 적어 두는 자기 파일이고,
 *  토큰이 생기면 61행 조건이 먼저 꺼져 다시 보지 않는다(§0-4). */
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { registryPath } from "./projects.ts";

/** 레지스트리와 **같은 디렉터리**다(엔진의 `$LOCAL`). 규칙을 두 벌로 적지 않으려고
 *  `registryPath()`에서 파생시킨다 — `TICKET_LOCAL` 존중도 거기 한 곳에만 있다. */
export function tokenPath(): string {
  return path.join(path.dirname(registryPath()), "oauth-token");
}

export type AuthStatus = {
  path: string;
  /** 파일이 없으면 `null`. 있으면 mtime을 CLI `list`와 같은 표기로.
   *  **유효한지는 판정하지 않는다** — 다음 디스패치에서 드러난다(§0-4). */
  savedAt: string | null;
};

export async function readAuth(): Promise<AuthStatus> {
  const p = tokenPath();
  const s = await stat(p).catch(() => null);
  return { path: p, savedAt: s?.isFile() ? when(s.mtime) : null };
}

/** 붙여 넣은 값을 저장할 형태로 만든다. 못 쓰면 사유를 던진다.
 *
 *  **검증은 "비어 있지 않다 · 공백과 개행이 없다"까지다.** 접두사(`sk-ant-oat…`)로 거르지
 *  않는다 — 그 형식은 우리 것이 아니고 바뀌면 멀쩡한 토큰을 GUI가 거부한다(§0-4).
 *  바깥 공백은 떨어낸다: 복사하면 줄바꿈이 딸려 오고 엔진도 `tr -d '\r\n'`으로 지운다. */
export function normalizeToken(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("토큰이 비어 있습니다.");
  if (/\s/.test(t)) throw new Error("토큰 안에 공백·줄바꿈이 있습니다. 한 줄만 붙여 넣어 주세요.");
  return t;
}

/** 덮어쓴다 — 토큰은 하나뿐이라 이력을 남길 자리가 없다(§0-4 재발급 항).
 *  `writeFile`의 `mode`는 **새로 만들 때만** 먹는다. 재발급이 기존 파일에 쓰면 그때 권한이
 *  안 바뀌므로 `chmod`를 따로 부른다 — 0600은 이 파일의 요건이다. */
export async function saveToken(token: string): Promise<void> {
  const p = tokenPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, token, { mode: 0o600 });
  await chmod(p, 0o600);
}

// ── ② 발급 — `claude setup-token`을 GUI가 pty로 몬다 (§0-4) ─────────────────

/** pty 한 덩어리를 **사람이 읽을 줄**로 바꾼다. 출력이 Ink TUI라 낱말 사이가 공백이 아니라
 *  커서 이동(`Opening\x1b[12Gbrowser`)이다 — 통째로 걷어내면 `Openingbrowser`가 된다.
 *  그래서 **가로 이동만 공백 한 칸으로 바꾸고** 나머지 escape를 지운다.
 *
 *  덩어리가 아니라 **누적 원문 전체**를 받는다. 매 폴링마다 다시 계산하는 대신 청크 경계에서
 *  잘린 escape를 이어 붙이는 상태를 안 들고 다니려는 것이다(원문은 수 KB고 120초 뒤 끝난다).
 *  ponytail: 이동 폭(`[46G`)을 공백 하나로 접는다 — 진행 로그지 터미널 재현이 아니다.
 *  배너 아스키아트를 지우는 것도 이 규칙이다(글자·숫자가 없는 줄은 버린다). */
export function ptyLines(raw: string): string[] {
  const text = raw
    // OSC — 색 질의(`\x1b]11;?`)와 하이퍼링크(`\x1b]8;;<URL>`). URL은 눈에 보이는 본문으로도
    // 한 번 더 나오므로 여기서 버려도 로그에서 사라지지 않는다
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;]*[GC]/g, " ") // CHA·CUF = 낱말 사이 간격
    .replace(/\x1b\[[0-9;?>=!]*[ -/]*[@-~]/g, "") // 나머지 CSI
    .replace(/\x1b./g, ""); // ESC 7 · ESC 8 …
  const out: string[] = [];
  for (const seg of text.split("\n")) {
    const line = seg.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z0-9]/.test(line)) continue; // 배너 아스키아트·스피너 프레임
    if (line !== out[out.length - 1]) out.push(line); // Ink가 같은 줄을 다시 그린다
  }
  return out;
}

/** 다이얼로그가 그리는 것 전부. 세션이 없으면 `running: false` + 빈 로그다. */
export type SetupState = {
  running: boolean;
  lines: string[];
  /** 잡아서 저장까지 마쳤다. 층 ①이 이 값으로 바뀐다 */
  savedAt?: string;
  /** 실패 사유. **조용히 실패하지 않는다** — 화면이 이걸 그대로 보여주고 층 ③으로 안내한다 */
  error?: string;
};

/** **pty가 필수다.** 파이프로는 CLI가 첫 화면도 안 그린다(§0-4 실측표 1행).
 *
 *  `cat |`이 있는 이유: macOS `script`는 stdin이 **소켓**이면 `tcgetattr/ioctl: Operation not
 *  supported on socket`으로 즉시 죽는다. Node의 `stdio: "pipe"`가 소켓쌍이라 그냥 물리면 그
 *  경로다(실측). 셸 파이프는 진짜 `pipe(2)`라 `script`가 ENOTTY를 보고 pty를 연다.
 *  **stdin은 열린 채로 둔다**(실측표 2행) — 이 통로가 나중에 코드를 넣는 길이기도 하다.
 *
 *  `stty cols 200`이 있는 이유: 위 경로로 열린 pty는 winsize가 **0×0**이다(실측). 그대로 두면
 *  Ink가 좁게 잡아 토큰이 줄바꿈으로 쪼개진다.
 *
 *  마지막 `echo`가 있는 이유: **CLI가 끝난 것을 프로세스 종료로는 알 수 없다.** `sh`는 파이프라인
 *  두 짝을 다 기다리는데 `cat`은 우리가 stdin을 열어 두는 한 안 끝난다 — 즉시 죽는 스텁으로
 *  15초를 기다려도 `close`도 stdout `end`도 오지 않았다(실측). 그러면 실패 사유가 전부 "120초
 *  타임아웃"으로 뭉개진다. 그래서 **종료를 pty 안에서 한 줄로 실어 보낸다** — 프로세스 트리를
 *  헤집는 것보다 짧고, 종료 코드도 같이 온다. FIFO로 `cat`을 없애는 길은 막혀 있다: macOS는
 *  FIFO의 `tcgetattr`에 ENOTTY가 아니라 EOPNOTSUPP를 줘서 `script`가 그냥 죽는다(실측). */
const EXIT_MARK = "__dira_setup_exit:";
const SETUP_CMD =
  "cat | script -q /dev/null sh -c " +
  `'stty cols 200 rows 50; claude setup-token; echo "${EXIT_MARK}$?"'`;
const SETUP_TIMEOUT_MS = 120_000;
/** 남의 TUI를 긁는 일이라 접두사에 묶인다 — 저장 검증(`normalizeToken`)이 접두사로 거르지
 *  **않는** 것과 축이 다르다. 여기선 화면 잡음 속에서 토큰을 골라낼 표식이 이것뿐이다. */
const TOKEN_RE = /sk-ant-[A-Za-z0-9._-]{20,}/;

// ponytail: 토큰은 머신당 하나라 동시에 몰 이유가 없다 — 세션도 하나다.
let setup: {
  child: ChildProcess;
  raw: string;
  timer: NodeJS.Timeout;
  settled: boolean;
  savedAt?: string;
  error?: string;
} | null = null;

function view(s: NonNullable<typeof setup> | null): SetupState {
  if (!s) return { running: false, lines: [] };
  return {
    running: !s.settled,
    lines: ptyLines(s.raw)
      // 종료 표식은 우리가 심은 것이지 CLI가 사람에게 한 말이 아니다 — 로그에서 뺀다
      .filter((l) => !l.startsWith(EXIT_MARK))
      // CLI는 토큰을 화면에 그대로 찍는다. 여기는 파일이 아니라 **화면**이라 가린다 —
      // 이미 제자리에 저장했으므로 사람이 이 값을 눈으로 옮겨 적을 일이 없다
      .map((l) => l.replace(new RegExp(TOKEN_RE, "g"), "sk-ant-…")),
    savedAt: s.savedAt,
    error: s.error,
  };
}

/** 프로세스 그룹째 죽인다. `detached`로 띄웠으므로 `-pid`가 그룹이다 — `script`·`cat`·`claude`
 *  셋이라 자식만 죽이면 pty를 문 `claude`가 남아 다음 시도를 막는다(§0-4). */
function kill(s: NonNullable<typeof setup>): void {
  clearTimeout(s.timer);
  try {
    if (s.child.pid) process.kill(-s.child.pid, "SIGKILL");
  } catch {
    // 이미 죽었다
  }
}

function settle(s: NonNullable<typeof setup>, error?: string): void {
  if (s.settled) return;
  s.settled = true;
  s.error = error;
  kill(s);
}

/** 층 ②를 시작한다. 앞선 시도가 남아 있으면 먼저 죽인다 — pty를 두 번 물 수 없다. */
export function startSetup(): SetupState {
  stopSetup();
  const child = spawn("sh", ["-c", SETUP_CMD], { stdio: ["pipe", "pipe", "pipe"], detached: true });
  const s: NonNullable<typeof setup> = {
    child,
    raw: "",
    settled: false,
    timer: setTimeout(
      () => settle(s, `${SETUP_TIMEOUT_MS / 1000}초 안에 토큰을 받지 못했습니다.`),
      SETUP_TIMEOUT_MS,
    ),
  };
  setup = s;

  const feed = (d: Buffer) => {
    if (s.settled) return;
    s.raw = (s.raw + d.toString()).slice(-256_000);
    const m = TOKEN_RE.exec(s.raw);
    if (!m) {
      // 토큰이 먼저다 — 잡았으면 종료 표식이 같은 청크에 있어도 성공이다
      const bye = s.raw.match(new RegExp(`${EXIT_MARK}(\\d+)`));
      if (bye) settle(s, `토큰을 받지 못한 채 끝났습니다 (종료 코드 ${bye[1]}).`);
      return;
    }
    s.settled = true; // 저장은 비동기다 — 다음 청크가 두 번 저장하지 않게 여기서 잠근다
    kill(s);
    saveToken(normalizeToken(m[0]))
      .then(readAuth)
      .then((a) => {
        s.savedAt = a.savedAt ?? undefined;
      })
      .catch((e: Error) => {
        s.error = `토큰을 잡았지만 저장하지 못했습니다: ${e.message}`;
      });
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed); // 같은 로그에 섞는다 — 사람이 볼 곳이 하나다
  child.on("error", (e) => settle(s, `실행하지 못했습니다: ${e.message}`));

  /** 그물이지 주 경로가 아니다. **CLI의 종료는 위 `EXIT_MARK`가 알린다** — 즉시 죽는 스텁으로
   *  재 보니 `close`도 stdout `end`도 15초 동안 오지 않았다: `sh`가 `cat`을 기다리느라 살아
   *  있고, 그 `sh`가 stdout 파이프도 같이 쥐고 있다. 이 둘은 `sh`까지 죽었을 때만 온다. */
  const ended = () => settle(s, "토큰을 받지 못한 채 끝났습니다.");
  child.stdout?.on("end", ended);
  child.on("close", ended); // stdout이 어떤 이유로 안 끝났을 때의 그물
  return view(s);
}

export function pollSetup(): SetupState {
  return view(setup);
}

/** 승인 뒤 브라우저가 주는 코드를 CLI에 넣는다(실측: 마지막 화면이 `Paste code here`다).
 *  `\r`인 이유는 pty에서 Enter가 CR이라서다. */
export function sendSetupCode(code: string): SetupState {
  if (!setup || setup.settled) return view(setup);
  setup.child.stdin?.write(code.trim() + "\r");
  return view(setup);
}

/** 다이얼로그를 닫으면 부른다. **자식을 남기지 않는다**(§0-4). */
export function stopSetup(): void {
  if (setup) kill(setup);
  setup = null;
}

/** CLI `list`와 같은 표기(`%Y-%m-%d %H:%M`). 서버에서 만든다 — 로컬 도구라 서버와 브라우저가
 *  같은 타임존이고, 클라이언트에서 포맷하면 하이드레이션만 시끄러워진다. */
function when(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
