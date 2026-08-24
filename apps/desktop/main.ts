// dira 데스크톱 셸. 하는 일은 일곱이다 — Next standalone 서버를 자식으로 띄우고(번들의 엔진을
// 그 전에 userData로 꺼내 `DIRA_ENGINE`으로 넘긴다, 못박는 것 8), 창이 그것을 열고,
// 창을 닫아도 메뉴바에 남고(N1), 답변 대기 티켓이 새로 생기면 알리고(N2), 화면이 부르면
// 네이티브 경로 다이얼로그를 띄우고(N3), 로그인 시 자동 실행을 켜고 끄고(N4), 큐에 일이 남아
// 있으면 잠자기를 막고(N6 — 유휴도 뚜껑도), 1시간마다 새 버전을 찾아 받아두고 창이 보이면
// 토스트로, 아니면 OS 알림으로 알린다(U1·U2·U3 — 설치는 다음 실행 때).
// 스펙: ../../docs/DESIGN.md §데스크톱 앱 ("못박는 것" 1~8, N1~N6) · §릴리스 · 자동 업데이트
// (R5~R8) · §표면이 창 안으로 들어온다 (T1~T7).
import { app, BrowserWindow, Menu, MenuItem, Notification, Tray, dialog, ipcMain, nativeImage, shell } from "electron";
// 이름 가져오기(`import { autoUpdater }`)가 아닌 이유: electron-updater는 CJS이고 그 이름을
// `Object.defineProperty(exports, ...)`의 getter로 단다 — cjs-module-lexer가 못 보는 형태라
// ESM 이름 가져오기가 `SyntaxError`로 죽는다. 기본 가져오기는 `module.exports` 그 자체다.
import updater from "electron-updater";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "./release-notes.ts";
import { decideRevive, isExternalDeath } from "./revive.ts";

/** 패키징하면 standalone 산출물이 통째로 `Contents/Resources/server/`에 들어간다
 *  (package.json `build.extraResources`). 소스에서 돌 때는 `apps/teams` 옆이다. */
const SERVER = process.env.DIRA_SERVER_JS
  ? fileURLToPath(new URL(process.env.DIRA_SERVER_JS, import.meta.url))
  : app.isPackaged
    ? join(process.resourcesPath, "server", "server.js")
    : fileURLToPath(new URL("../teams/.next/standalone/server.js", import.meta.url));
/** main.ts 옆이다. **패키징 목록(package.json `build.files`)에 같이 실어야 한다** — 빠지면
 *  `.app`에서만 피커 버튼이 조용히 사라진다(브라우저와 구분이 안 된다). */
const PRELOAD = fileURLToPath(new URL("preload.cjs", import.meta.url));
const READY_TIMEOUT_MS = 30_000;
/** 배경 폴링이다 — 보드의 5초(§아키텍처)와 다른 값인 것이 맞다 (§데스크톱 앱 N2). */
const POLL_MS = 30_000;

let child: ChildProcess | null = null;
let stderr = "";
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
/** **서버가 준비된 뒤에만** 값이 있다 — `second-instance`가 그 전에 올 수 있어서 모듈
 *  스코프다. 준비 전의 오리진을 담아두면 두 번째 실행이 아직 안 듣는 포트로 창을 연다. */
let readyOrigin: string | null = null;
/** 렌더러 사망(`render-process-gone`)이나 로드 실패(`did-fail-load`)를 겪은 뒤 `true`다.
 *  창 자체는 파괴되지 않은 채로 내용만 죽는 경우(못박는 것 9)를 `win.isDestroyed()`가
 *  못 보므로 따로 든다. 창을 새로 열거나 되살릴 때 `false`로 되돌아간다. */
let contentDead = false;
/** `killServer()`가 자식을 죽이기 **직전**에 그 자식을 여기 적어 둔다. 자식의 `exit`가 이
 *  참조와 같은 것이면 우리가 벌인 일이고, 다르면(`null`이거나 다른 자식) 밖에서 죽은
 *  것이다(못박는 것 9 — `isExternalDeath`). */
let killedIntentionally: ChildProcess | null = null;

/** OS가 준 빈 포트. 7331 고정은 브라우저의 계약이고 창은 자기 서버를 알고 있다 (못박는 것 1). */
function freePort(): Promise<number> {
  // ponytail: listen(0) → close → 그 번호를 자식에게 넘긴다. 닫고 넘기는 사이가 이론상 경쟁
  // 구간이지만 로컬 1회 실행이라 실측 충돌이 없다. 부딪히면 자식 exit를 잡아 재시도.
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** **Finder·Dock에서 띄운 `.app`에는 PATH가 없다.** LaunchServices가 준 환경에 그 값이 아예
 *  없어서 launchd 기본값(`/usr/bin:/bin:/usr/sbin:/sbin`)이 되고, 그러면 서버가 부르는
 *  `claude`(`~/.local/bin`)가 안 보여 §0-4 층 ②가 종료 코드 127로 죽는다(`bcf66f01`).
 *  터미널에서 띄운 `pnpm dev`는 셸 PATH를 물려받아 멀쩡했기 때문에 여태 안 보였다.
 *
 *  **경로 목록을 여기 하드코딩하지 않고 사람의 로그인 셸에게 묻는다** — 어디에 깔았는지는 그
 *  셸만 안다(`~/.local/bin`·homebrew·nvm·mise…). `-i`가 있는 이유는 zsh가 `.zshrc`를
 *  대화형일 때만 읽어서다. `printf %s`라 PATH에 개행이 없고, 셸 시작 배너가 앞에 끼어도
 *  **마지막 줄**이 값이다. 물려받은 PATH와 합쳐 앞을 사람 것으로 세운다.
 *  ponytail: 앱 기동에 한 번. 5초 안에 답이 없거나 셸이 없으면 물려받은 값 그대로 간다. */
function userPath(): string {
  const inherited = (process.env.PATH ?? "").split(":");
  let asked: string[] = [];
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf %s "$PATH"'], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    asked = (out.split("\n").pop() ?? "").split(":");
  } catch (e) {
    console.error(`[dira] 로그인 셸 PATH를 못 읽었습니다: ${(e as Error).message}`);
  }
  // 절대경로만 남긴다 — 셸이 뱉은 배너 조각이 PATH에 들어가지 않게
  return [...new Set([...asked, ...inherited].filter((p) => p.startsWith("/")))].join(":");
}

/** 자식을 띄울 실행파일. Electron 자신을 노드로 돌리는 것은 그대로지만 **`process.execPath`가
 *  아니다** — `.app/Contents/MacOS/dira`로 띄우면 LaunchServices가 그 자식을 같은 번들의 앱
 *  인스턴스로 등록해 창을 안 만드는 **빈 독 타일**이 하나 더 생긴다(`lsappinfo`가 `type="Foreground"`
 *  `!cgsConnection`으로 찍는다, `e59ceae4`). Helper 번들은 `Info.plist`에 `LSUIElement`가 서 있어
 *  타일을 안 만든다 — Electron이 자기 유틸리티 프로세스를 그것으로 띄우는 이유다 (못박는 것 7).
 *  바이너리는 같은 것이라 `ELECTRON_RUN_AS_NODE`도 못박는 것 3도 그대로다. */
function nodeBin(): string {
  const exe = basename(process.execPath); // 패키징 "dira" · 소스 "Electron"
  const helper = join(process.execPath, "..", "..", "Frameworks", `${exe} Helper.app`, "Contents", "MacOS", `${exe} Helper`);
  // Helper 이름은 productName에서 나온다. 규약이 바뀌어 없어지면 타일 하나를 지고 그냥 뜬다
  return existsSync(helper) ? helper : process.execPath;
}

/** 못박는 것 8 — **엔진은 번들에 들어가고, 쓰이기 전에 번들 밖으로 나온다.** §0-3 스캐폴딩이
 *  읽는 넷(`tick.sh` · `tickets.py` · `templates/` · `worker.sh.example`)이 `Resources/engine/`에
 *  있고, 그것을 userData로 복사한 뒤 경로를 `DIRA_ENGINE`으로 서버에 넘긴다.
 *
 *  **번들 안 경로를 넘기지 않는 이유**는 `w1.sh`의 `. "<엔진>/tick.sh"`가 그 값을 그대로 물기
 *  때문이다 — `.app` 안을 가리키면 그 워커는 앱을 지우는 순간 죽는다. 복사본이 앱보다 오래
 *  살아야 해서 자리가 userData다.
 *
 *  판정은 마커 파일 한 줄(앱 버전)이다. 엔진은 읽기 전용이라 덮어써도 잃을 것이 없다.
 *  소스에서 돌 때는 아무것도 하지 않는다 — 서버 cwd 상위 2단계가 진짜 레포고 그게 최신이다.
 *  ponytail: 실패하면 로그만 남기고 env 없이 간다. 그러면 `engineRepo()`가 종전 유도로 가서
 *  `새로 만들기`가 자기 거부 문구를 낸다 — 앱 기동 전체를 여기서 죽일 이유가 없다. */
function extractEngine(): string | null {
  if (!app.isPackaged) return null;
  const dst = join(app.getPath("userData"), "engine");
  const stamp = join(dst, ".version");
  try {
    if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== app.getVersion()) {
      rmSync(dst, { recursive: true, force: true });
      cpSync(join(process.resourcesPath, "engine"), dst, { recursive: true });
      writeFileSync(stamp, app.getVersion());
      console.log(`[dira] 엔진을 꺼냈습니다 → ${dst} (v${app.getVersion()})`);
    }
    return dst;
  } catch (e) {
    console.error(`[dira] 엔진을 꺼내지 못했습니다: ${(e as Error).message}`);
    return null;
  }
}

/** §0-11 자격값 — **레포에 없다.** `release.yml`이 GitHub Actions 시크릿 둘을 빌드 때 이 파일로
 *  떨어뜨리고(`.gitignore`에 있다) 패키징 목록(package.json `build.files`)이 `.app` 안으로 나른다.
 *  main은 값을 보기만 하고 전송은 서버가 한다(`apps/teams/lib/analytics.ts`).
 *
 *  **없으면 없는 채로 간다.** 그것이 `pnpm dev`와 손으로 빌드한 `.app`의 정상 상태다 — 자격값이
 *  없으면 서버가 아무것도 안 보내서(§0-11) 우리 세션이 통계를 오염시키지 않는다. 그래서 실패를
 *  로그로도 안 남긴다: 없는 것이 정상인 값에 매번 에러 줄이 뜨면 진짜 에러가 묻힌다.
 *  **짝일 때만 넘긴다** — 한쪽만 있으면 서버는 어차피 안 보낸다(둘 다 있어야가 그쪽 계약이다).
 *  ponytail: 키 둘짜리 JSON 하나. `.env` 파서도 번들 치환 스텝도 들이지 않는다. */
function gaCredentials(): Record<string, string> {
  try {
    const o: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("ga.json", import.meta.url)), "utf8"));
    const { GA_MEASUREMENT_ID: id, GA_API_SECRET: secret } = (o ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || typeof secret !== "string" || !id || !secret) return {};
    console.log(`[dira] GA 자격값을 실었습니다 — ${id}`); // 시크릿은 안 찍는다
    return { GA_MEASUREMENT_ID: id, GA_API_SECRET: secret };
  } catch {
    return {};
  }
}

function startServer(port: number): ChildProcess {
  const engine = extractEngine();
  // node 바이너리가 PATH에 있다고 가정하지 않는다 — Electron 자신을 노드로 돌린다.
  const proc = spawn(nodeBin(), [SERVER], {
    env: {
      ...process.env,
      PATH: userPath(),
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ...(engine ? { DIRA_ENGINE: engine } : {}),
      // §0-11 — 이 셋이 통계의 전부다. **버전을 넘기는 것이 곧 셸 판정이다**(`shellParams()`:
      // 값이 있으면 `desktop`, 없으면 `browser`). 손으로 적지 않는다 — package.json이 정본이다.
      DIRA_APP_VERSION: app.getVersion(),
      ...gaCredentials(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (b) => (stderr += b));
  proc.stdout?.on("data", (b) => process.stdout.write(b));
  proc.on("error", (e) => (stderr += `${e.message}\n`));
  // 못박는 것 9 — 자식이 죽는 것을 본다. `killServer()`가 먼저 지운 것(정상 종료·재시작
  // 중 정리)이면 `killedIntentionally`가 이 자식을 가리키고 있어 조용히 넘어간다. 그 참조가
  // 다르면 밖에서(`kill -9` 등) 죽은 것이라 정리만 하고 되살리기는 다음 `showWindow()`가 맡는다.
  proc.on("exit", (code, signal) => {
    const external = isExternalDeath(proc, killedIntentionally);
    killedIntentionally = null;
    if (external) {
      console.log(`[dira] 자식 서버가 밖에서 죽었습니다 (code ${code ?? signal ?? "?"}) — 되살리기 대상입니다`);
      killServer();
    }
  });
  return proc;
}

/** 준비 판정은 HTTP다 — stdout의 `Ready` 문자열은 버전마다 바뀌고 깨져도 조용하다 (못박는 것 2). */
async function waitForReady(origin: string, proc: ChildProcess): Promise<string | null> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return `서버 프로세스가 준비되기 전에 종료했습니다 (code ${proc.exitCode ?? proc.signalCode})`;
    }
    try {
      await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) });
      return null;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return `${READY_TIMEOUT_MS / 1000}초 안에 ${origin}/ 가 응답하지 않았습니다`;
}

function killServer() {
  if (child && child.exitCode === null) {
    killedIntentionally = child; // 이 자식의 `exit`는 우리가 벌인 일이다 — 밖에서 죽은 것이 아니다
    child.kill("SIGTERM");
  }
  child = null;
  holdSleep(false); // N6의 caffeinate도 여기서 놓는다 — `-w`는 크래시용이고 정상 경로가 아니다
}

/** 실패 화면. §비주얼 §6 에러 3요소 — 무엇이 실패했는지 · 원인 원문 · 다음 행동. */
function showFailure(reason: string) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cmd = `cd ${dirname(SERVER)} && PORT=7332 node ${basename(SERVER)}`;
  const html = `<!doctype html><meta charset="utf-8"><title>dira</title>
<style>
  :root { color-scheme: light dark }
  body { font: 13px/1.6 -apple-system, sans-serif; margin: 0; padding: 32px; }
  h1 { font-size: 15px; margin: 0 0 4px }
  p { margin: 0 0 16px; opacity: .7 }
  pre { font: 11px/1.5 ui-monospace, monospace; background: color-mix(in srgb, currentColor 8%, transparent);
        padding: 12px; border-radius: 6px; white-space: pre-wrap; max-height: 40vh; overflow: auto }
</style>
<h1>dira 서버를 띄우지 못했습니다</h1>
<p>${esc(reason)}</p>
<pre>${esc(stderr.trim() || "(서버가 stderr에 아무것도 쓰지 않았습니다)")}</pre>
<p>직접 띄워서 원인을 봅니다:</p>
<pre>${esc(cmd)}</pre>`;
  const win = new BrowserWindow({ width: 720, height: 520, title: "dira" });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/** 창은 자기가 띄운 오리진만 연다 (못박는 것 4). 이 창은 fs를 만지는 서버 바로 앞이다. */
function openWindow(origin: string): BrowserWindow {
  contentDead = false; // 새로 여는 창이라 아직 아무것도 안 죽었다
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "dira",
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: PRELOAD },
  });

  // 못박는 것 9 — 창은 안 파괴됐는데 내용만 죽는 두 경로. `win.isDestroyed()`가 못 보므로
  // 이 플래그로 든다 — 다음 `showWindow()`가 되살리기로 갈지 이것으로 가른다.
  win.webContents.on("render-process-gone", (_e, details) => {
    contentDead = true;
    console.log(`[dira] 렌더러가 죽었습니다 (${details.reason}) — 되살리기 대상입니다`);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame) return; // iframe·서브리소스는 안 본다 — 이 창의 본문이 죽은 것만 본다
    contentDead = true;
    console.log(`[dira] 로드에 실패했습니다 (${code} ${description}) — 되살리기 대상입니다`);
  });

  const external = (url: string) => {
    const u = URL.parse(url);
    if (u && (u.protocol === "http:" || u.protocol === "https:")) shell.openExternal(url);
  };

  win.webContents.on("will-navigate", (e, url) => {
    if (url === origin || url.startsWith(`${origin}/`)) return;
    e.preventDefault();
    external(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url); // 새 창은 무조건 거부한다. 밖으로 가는 것만 기본 브라우저로 보낸다
    return { action: "deny" };
  });

  // N1 — 빨간 버튼은 앱을 끝내지 않고 창을 숨긴다. 파괴하지 않으므로 `열기`가 이미 그려진
  // 보드를 그대로 되돌린다(다시 로드하면 그 시점부터 콜드 스타트다). 종료 경로에서만 통과시킨다.
  //
  // 전체 화면 창을 그대로 숨기면 macOS가 그 Space를 남긴다 — 검은 화면 하나가 그대로 선다.
  // 벗고 **나서** 숨긴다. `setFullScreen(false)` 직후는 아직 애니메이션 중이라 같은 증상이라
  // `leave-full-screen`을 기다린다. `once` — `on`이면 닫을 때마다 쌓인다.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => win.hide());
      win.setFullScreen(false);
    } else win.hide();
  });

  win.loadURL(origin);
  return win;
}

// ── N2 답변 대기 알림 + 디스패치 보류 알림 ──────────────────────────────────
//
// 판정은 서버가 한다(못박는 것 5) — main은 `GET /api/awaiting`·`GET /api/gate`를 물어보고
// **직전 집합과의 차집합만** 알린다. 켠 직후 첫 응답은 조용히 씨를 뿌린다: 앱을 켤 때마다 밀린
// 알림이 쏟아지면 그 알림은 다음 주에 꺼진다. 둘 다 같은 30초 타이머를 나눠 쓴다(`boot()`) —
// `setInterval`을 하나 더 만들지 않는다.

type Awaiting = { project: string; projectName: string; stem: string; hash: string; title: string };
type GateItem = { project: string; tree: string; count: number; at: string };

/** `null` = 아직 씨를 안 뿌렸다. 빈 집합(`답변 대기 0건`)과 다른 상태다 — 섞으면 첫 응답이
 *  0건인 큐에서 두 번째 응답의 새 티켓을 놓치거나, 반대로 첫 응답을 통째로 알린다. */
let seen: Set<string> | null = null;

function notify(item: Awaiting, origin: string) {
  const n = new Notification({
    title: "답변 대기",
    body: `${item.title || item.hash} — ${item.projectName}`,
  });
  n.on("click", () => {
    const url = `${origin}/p/${encodeURIComponent(item.project)}/tickets/${encodeURIComponent(item.stem)}`;
    if (!win || win.isDestroyed()) win = openWindow(origin);
    win.loadURL(url);
    win.show();
    win.focus();
  });
  n.on("show", () => console.log(`[dira] 알림 → ${item.project}/${item.stem}`));
  n.show();
}

/** 폴링 실패는 삼키되 로그로 남긴다 — 서버가 죽었거나 응답이 깨져도 앱은 계속 산다.
 *  `Array.isArray`까지가 신뢰 경계다: 응답이 배열이 아니면 아래 루프가 던져 앱이 죽는다. */
async function pollAwaiting(origin: string) {
  try {
    const res = await fetch(`${origin}/api/awaiting`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items: unknown = await res.json();
    if (!Array.isArray(items)) throw new Error(`배열이 아닌 응답: ${JSON.stringify(items).slice(0, 200)}`);
    const now = new Map<string, Awaiting>();
    for (const i of items as Awaiting[]) {
      if (i && typeof i.project === "string" && typeof i.stem === "string") {
        now.set(`${i.project}/${i.stem}`, i);
      }
    }
    const first = seen === null;
    if (!first) for (const [key, item] of now) if (!seen!.has(key)) notify(item, origin);
    seen = new Set(now.keys());
    if (first) console.log(`[dira] 답변 대기 ${now.size}건으로 씨를 뿌렸습니다 (알리지 않음)`);
  } catch (e) {
    console.error(`[dira] 답변 대기 폴링 실패: ${(e as Error).message}`);
  }
}

/** N2 둘째 사건. `seen`과 같은 `null` = 씨 안 뿌림 관용구다. 프로젝트당 표식 파일 하나뿐이라
 *  (§4-14 §표식 파일) 키가 `project` 하나다. */
let seenGate: Set<string> | null = null;

function notifyGate(item: GateItem, origin: string) {
  const n = new Notification({
    title: "디스패치 보류",
    body: `${item.project} — 커밋 안 된 변경 ${item.count}건`,
  });
  n.on("click", () => {
    const url = `${origin}/p/${encodeURIComponent(item.project)}`;
    if (!win || win.isDestroyed()) win = openWindow(origin);
    win.loadURL(url);
    win.show();
    win.focus();
  });
  n.on("show", () => console.log(`[dira] 알림 → ${item.project} 게이트 보류`));
  n.show();
}

/** `pollAwaiting`과 같은 신뢰 경계·차집합·씨뿌리기 규칙이다. */
async function pollGate(origin: string) {
  try {
    const res = await fetch(`${origin}/api/gate`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items: unknown = await res.json();
    if (!Array.isArray(items)) throw new Error(`배열이 아닌 응답: ${JSON.stringify(items).slice(0, 200)}`);
    const now = new Map<string, GateItem>();
    for (const i of items as GateItem[]) {
      if (i && typeof i.project === "string") now.set(i.project, i);
    }
    const first = seenGate === null;
    if (!first) for (const [key, item] of now) if (!seenGate!.has(key)) notifyGate(item, origin);
    seenGate = new Set(now.keys());
    if (first) console.log(`[dira] 디스패치 보류 ${now.size}건으로 씨를 뿌렸습니다 (알리지 않음)`);
  } catch (e) {
    console.error(`[dira] 디스패치 보류 폴링 실패: ${(e as Error).message}`);
  }
}

// ── N6 남은 일이 있으면 잠자기 방지 ────────────────────────────────────────
//
// 막는 것은 워커가 아니라 **cron**이다 — 맥이 자면 매분 워커를 띄우는 그것이 안 뜬다.
// 그래서 세는 것이 `진행중`만이 아니라 `대기`이고, 판정은 서버(`GET /api/work`)가 한다.
// 폴링은 N2와 **같은 타이머**다(§데스크톱 앱 N6 — `setInterval`을 하나 더 만들지 않는다).

/** N6 토글의 상태는 이 파일의 **존재 여부** 하나다. U2와 방향이 반대인 것은(있으면 켬)
 *  기본값이 반대라서다 — 배터리를 쓰는 기능이라 사람이 한 번 켜는 것이 맞다. */
function noSleepFlag(): string {
  return join(app.getPath("userData"), "no-sleep");
}

/** assertion을 잡고 있는 `caffeinate` 자식. `null`이면 안 잡았다. **이미 그 상태면 아무것도
 *  안 한다** — 두 번 띄우면 앞의 것이 참조를 잃어 아무도 못 죽인다. */
let sleepProc: ChildProcess | null = null;

function holdSleep(on: boolean) {
  if (on === (sleepProc !== null)) return;
  if (on) {
    // `-i` 유휴 + `-s` 뚜껑. Electron이 부를 수 있는 IOKit assertion은 `NoIdleSleep`·
    // `NoDisplaySleep` 둘뿐이라 뚜껑을 막는 `PreventSystemSleep`에 닿는 갈래가 아예
    // 없다(§뚜껑도 막는다). `-d`는 안 넣는다 — 화면은 그대로 꺼진다.
    // `-w <내 pid>`는 크래시용 그물이다: 내가 죽으면 caffeinate가 스스로 나간다.
    // 정상 종료의 `kill`을 대신하지 않는다 — 둘 다 있어야 고아가 안 남는다.
    // ponytail: `-s`는 배터리에서 무효다(`man caffeinate`). 전원이 천장이고 고칠 것이 아니다.
    sleepProc = spawn("/usr/bin/caffeinate", ["-is", "-w", String(process.pid)]);
    console.log(`[dira] 잠자기를 막습니다 — caffeinate -is (#${sleepProc.pid})`);
  } else {
    console.log(`[dira] 잠자기를 놓습니다 (#${sleepProc!.pid})`);
    sleepProc!.kill();
    sleepProc = null;
  }
}

/** 폴링 실패는 **놓는다**(N6). 잡은 채로 두면 서버가 죽은 뒤에도 맥이 영영 안 자는데 그 상태는
 *  화면이 없어서 아무도 못 본다 — 놓으면 큐가 멈추고 **그건 아침에 보인다.**
 *  토글이 꺼져 있으면 서버에 묻지도 않는다(30초마다 도는 fetch가 30초마다 도는 로그가 된다). */
async function pollWork(origin: string) {
  if (!existsSync(noSleepFlag())) return holdSleep(false);
  try {
    const res = await fetch(`${origin}/api/work`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    // 신뢰 경계. `busy`가 boolean이 아니면 판정이 아니라 사고다 — truthy로 읽지 않는다.
    if (typeof (body as { busy?: unknown })?.busy !== "boolean") {
      throw new Error(`busy가 없는 응답: ${JSON.stringify(body).slice(0, 200)}`);
    }
    holdSleep((body as { busy: boolean }).busy);
  } catch (e) {
    console.error(`[dira] 일 폴링 실패: ${(e as Error).message} — 잠자기를 놓습니다`);
    holdSleep(false);
  }
}

/** N6 토글. 켜면 30초를 안 기다리고 그 자리에서 한 번 묻는다(U2가 켠 직후 한 번 검사하는 그
 *  관용구다). 끄면 `pollWork`의 첫 줄이 바로 놓는다. */
function setNoSleep(on: boolean, origin: string) {
  const flag = noSleepFlag();
  if (on) writeFileSync(flag, "");
  else rmSync(flag, { force: true });
  console.log(`[dira] 남은 일이 있으면 잠자기 방지 ${on ? "켬" : "끔"} — ${flag} ${on ? "만듦" : "지움"}`);
  pollWork(origin);
}

/** N3 경로 피커. main이 하는 일은 다이얼로그를 띄우고 **고른 절대경로 하나**를 돌려주는 것뿐이다
 *  — 상대경로 환산도 검증도 여기 없다(환산은 `lib/urls.ts`, 검증은 서버가 종전대로 한다).
 *  `mode`는 렌더러가 보내는 값이라 두 글자 말고는 받지 않는다. `.dira`가 dotfile이라
 *  `showHiddenFiles`가 없으면 등록할 큐를 아예 고를 수 없다. */
ipcMain.handle("dira:pick-path", async (e, mode: unknown) => {
  // 부른 창에 시트로 붙인다(모듈 최상단의 `win`이 아니라 **보낸 쪽**이다).
  const from = BrowserWindow.fromWebContents(e.sender);
  if (!from || (mode !== "file" && mode !== "directory")) return null;
  const r = await dialog.showOpenDialog(from, {
    properties: [mode === "file" ? "openFile" : "openDirectory", "showHiddenFiles"],
  });
  return r.filePaths[0] ?? null;
});

// ── 릴리스 · 자동 업데이트 (R5·R6·R8·§표면이 창 안으로 들어온다 T1~T7) ──────
//
// 새 화면은 0개다 — `dialog.showMessageBox` 호출이 이 경로에 0건이다(판정 1). 뜨는 자리는
// 창이 보이면 토스트(`dira:update` 이벤트), 아니면 OS 알림 하나다(T1 `surfaceUpdate`).
// **받아두고 종료할 때 적용한다. 몰래 재시작하지 않는다**(R6): 기본 경로는 `autoInstallOnAppQuit`
// 뿐이다. 지금 당장 설치하고 재시작시키는 호출은 U3의 `지금 재시작` 버튼을 눌렀을 때 딱 한 자리에서만
// 난다(요구 `9a04dabc` — 판정은 `grep -c`라 이름을 여기 안 적는다). 이 앱 뒤에는 도는 세션과
// cron 워커가 붙어 있어서 임의 재시작이 못박는 것 3(자식 서버는 앱보다 오래 살지 않는다)을 사람이
// 모르는 시점에 발동시키는데, 사람이 손으로 누른 시점은 이미 아는 시점이고 남는 구멍(무엇이
// 도는지)은 `busy` 확인이 막는다(§재재판정).

const { autoUpdater } = updater;
autoUpdater.autoInstallOnAppQuit = true;

/** R8 — U2의 상태는 이 파일의 **존재 여부** 하나다. N4는 `getLoginItemSettings`로 OS가 값을
 *  갖고 있어서 파일이 없었는데 여기엔 그런 자리가 없다. 값이 하나라 JSON을 파싱하지 않는다 —
 *  파싱 실패라는 상태가 아예 없다. 기본은 켜짐(= 파일 없음)이다.
 *  ponytail: 두 번째 설정이 생기면 그때 settings.json으로 바꾼다. */
function autoUpdateFlag(): string {
  return join(app.getPath("userData"), "no-auto-update");
}

/** 받아둔 버전 — T1 이어붙임(`state`)과 T6(`notes`)의 원본. `null`이면 받아둔 것이 없다.
 *  `notes`는 `releaseNotes()`가 돌려주는 promise를 그대로 들고 있다 — await하지 않는다(T6). */
let pendingUpdate: { version: string; notes: Promise<string> } | null = null;
/** T4 — 직전에 보낸 정수 퍼센트. 다운로드가 안 도는 동안은 `-1`이라 `error`가 그 시점의
 *  실패인지(체크 단계) 다운로드 중 실패인지 이 값으로 가른다. */
let lastPercent = -1;
/** T5 — `지금 재시작`을 한 번 눌러 `busy`라 재확인 토스트를 보낸 상태다. 그 토스트의
 *  `재시작`을 다시 누르면(같은 `restart` 액션) 이번엔 재확인 없이 그대로 `quitAndInstall()`한다.
 *  `취소`는 `later`(T5의 다른 버튼과 같은 액션 — 사실도 같다: 지금 안 하면 다음 종료 때
 *  적용된다)를 불러 이 값을 도로 내린다 — 안 내리면 다음 `지금 재시작` 클릭이 재확인 없이
 *  바로 재시작해버린다(§표면이 창 안으로 들어온다가 금지한 "모르는 사이 재시작"). */
let restartAsked = false;

/** T3 — 1시간 폴링. `boot()`이 `app.isPackaged`일 때만 건다. 받아두면(=`update-downloaded`)
 *  바로 멈춘다 — 다음 tick까지 기다리지 않는다. */
const UPDATE_POLL_MS = 60 * 60 * 1000;
let updateTimer: ReturnType<typeof setInterval> | null = null;

function stopUpdatePolling() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = null;
}

type UpdateDetail =
  | { kind: "progress"; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "message"; text: string }
  | { kind: "confirm" };

/** T1 표면 판정 — 창이 살아 있고 보이면 토스트, 아니면 OS 알림 하나. 알림을 누르면 창이
 *  열린다(T1 — 이어붙임은 렌더러가 붙을 때 `state`를 물어보는 쪽이 만든다).
 *  진행률(T4)과 재확인(T5, 토스트가 떠 있을 때만 나는 값이라 창이 없을 일이 실전에서 없다)은
 *  창이 없으면 그냥 버린다 — 20%에서 30%로 갔다는 사실은 알림 센터에 남길 값이 아니다. */
function surfaceUpdate(detail: UpdateDetail) {
  if (win && !win.isDestroyed() && win.isVisible()) {
    dispatchToWindow("dira:update", "업데이트 알림", { detail, showWindow: false });
    return;
  }
  if (detail.kind !== "downloaded" && detail.kind !== "message") return;
  const body = detail.kind === "downloaded" ? `${detail.version}을 받았습니다` : detail.text;
  const n = new Notification({ title: "dira 업데이트", body });
  n.on("click", () => readyOrigin && showWindow());
  n.show();
}

/** `checkForUpdates()`는 실패할 때 reject와 **`error` 이벤트를 같이** 낸다. `error`는
 *  EventEmitter가 리스너 없으면 던지는 이름이라, 이 한 줄이 없으면 네트워크가 끊긴 것만으로
 *  앱이 죽는다. 다운로드 중 실패도 여기로 온다(그쪽은 await할 자리가 없다) — `lastPercent`가
 *  `-1`보다 크면 다운로드가 돌던 중이었다는 뜻이라 그 진행률 상자를 실패 문구로 갈아 끼운다
 *  (T4). 체크 단계의 실패(다운로드 시작 전)는 여기서 토스트를 안 띄운다 — `checkForUpdate`의
 *  수동 경로가 그쪽을 이미 말한다. */
autoUpdater.on("error", (e) => {
  console.error(`[dira] 업데이트 실패: ${e.message}`);
  if (lastPercent < 0) return;
  lastPercent = -1;
  surfaceUpdate({ kind: "message", text: "업데이트를 받지 못했습니다" });
});

/** T4 — `download-progress`는 초당 수십 번 난다. 정수 퍼센트가 갈릴 때만 보낸다
 *  (한 번의 다운로드에 상한 100번). */
autoUpdater.on("download-progress", (p) => {
  const percent = Math.floor(p.percent);
  if (percent === lastPercent) return;
  lastPercent = percent;
  surfaceUpdate({ kind: "progress", percent });
});

/** `claude`를 **우리가** PATH에서 찾는다 — 셸에게 맡기면 못 찾았을 때 손에 남는 것이 종료 코드
 *  `127`뿐이고 사람은 그 숫자에서 원인을 못 읽는다. `apps/teams/lib/auth.ts:161`이 §0-4에서
 *  같은 판단을 적어 놨다(**import하지 않는다 — 앱 경계를 넘는다**). `.app`에는 PATH가 아예
 *  없어서 물려받은 값이 아니라 `userPath()`를 본다. */
function findClaude(): string | null {
  for (const dir of userPath().split(":")) {
    const p = join(dir, "claude");
    try {
      if (!statSync(p).isFile()) continue; // 디렉터리도 X_OK를 통과한다
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // 없거나 실행 권한이 없다 — 다음 디렉터리
    }
  }
  return null;
}

/** compare API가 쓸 `<owner>/<repo>`. **정본은 `build.publish`인데(R1) 패키징된 package.json에
 *  그 값이 없다** — electron-builder가 `build`·`scripts`·`devDependencies`를 떼고 복사한다
 *  (실측: 번들의 package.json은 8줄이고 `build`가 없다). 런타임에 남는 것은 그 설정을 푼 결과인
 *  `app-update.yml`이고, electron-updater 자신이 피드를 읽는 파일도 그것이다.
 *
 *  사람이 아직 `owner`/`repo`를 안 채웠으면 자리표시자가 그대로 실려 compare가 404를 준다 —
 *  그건 경로 ③(노트 없이 R6 문장)이고 다이얼로그는 그래도 뜬다.
 *  ponytail: 두 값을 정규식으로 집는다. 키 둘 때문에 YAML 파서를 들이지 않는다. */
function publishSlug(): { owner: string; repo: string } {
  try {
    const yml = readFileSync(join(process.resourcesPath, "app-update.yml"), "utf8");
    const pick = (k: string) => yml.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
    return { owner: pick("owner"), repo: pick("repo") };
  } catch (e) {
    console.error(`[dira] app-update.yml을 못 읽었습니다: ${(e as Error).message}`);
    return { owner: "", repo: "" }; // → 404 → 경로 ③
  }
}

/** R7의 두 인자. 던지는 것이 계약이다 — `releaseNotes()`가 잡아서 경로 ②·③으로 떨어뜨린다. */
const releaseIo = {
  async fetchText(url: string) {
    // 인증 헤더가 없다(R1 공개 레포). User-Agent는 GitHub API가 요구하는 값이라 붙인다.
    const r = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `dira/${app.getVersion()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
    return r.text();
  },
  summarize(prompt: string): Promise<string> {
    const bin = findClaude();
    if (!bin) return Promise.reject(new Error("PATH에서 claude를 찾지 못했습니다"));
    return new Promise((resolve, reject) => {
      // ponytail: 60초. 커밋 제목 20줄 요약에 그보다 오래 걸리면 노트를 기다릴 값이 없다 —
      // 목록으로 떨어지는 편이 낫다. 죽인 자식은 `-p`라 pty를 안 물어서 남는 것이 없다.
      execFile(bin, ["-p", prompt], { timeout: 60_000, maxBuffer: 1 << 20 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout),
      );
    });
  },
};

/** "지금 재시작"의 busy 확인 — `pollWork`와 같은 신뢰 경계 처리: 응답 실패이거나 `busy`가
 *  boolean이 아니면 `true`로 친다(모르는 값으로 도는 세션의 서버를 끊지 않는다). */
async function isBusy(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/work`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    const busy = (body as { busy?: unknown })?.busy;
    return typeof busy === "boolean" ? busy : true;
  } catch {
    return true;
  }
}

// R6 — 다 받으면 사실만 말한다. `다음 시작에 적용`(기본)은 종전처럼 아무 일도 안 하고,
// `지금 재시작`은 `busy`를 확인한 뒤에만 재시작한다(요구 `9a04dabc` — §재재판정).
// **토스트 본문 한 줄이 R6의 사실이고 노트는 `notes` 액션으로 딴 곳에서 편다**(R7 — 요약이
// 죽어도 그 한 줄은 이미 떠 있다). `releaseNotes()`를 **await하지 않는다**(T6) — 요약에 최대
// 60초가 걸려 토스트가 그만큼 늦게 뜨면 안 된다. promise는 `pendingUpdate`가 들고 있다가
// `notes` 액션을 누른 시점에 그대로 준다.
autoUpdater.on("update-downloaded", (info) => {
  stopUpdatePolling(); // T3 — 다 받으면 폴링을 멈춘다
  lastPercent = -1;
  restartAsked = false;
  pendingUpdate = { version: info.version, notes: releaseNotes(app.getVersion(), info.version, publishSlug(), releaseIo) };
  surfaceUpdate({ kind: "downloaded", version: info.version });
});

// 맥의 `quitAndInstall()`은 `app.quit()`을 안 거치고 **창을 먼저 닫은 뒤에야**
// `before-quit-for-update`를 낸다(§못박는 것 3 넷째 경로) — 그 이벤트만 듣고 있으면
// `win.on("close")`(N1)가 아직 `quitting === false`인 순간에 먼저 걸려 창을 숨긴다.
// 이벤트 순서에 기대지 않도록 호출 직전, 우리가 재시작을 결정한 바로 그 자리에서 세운다.
function quitAndInstallNow() {
  quitting = true;
  autoUpdater.quitAndInstall();
}

/** T5 — `지금 재시작`. 첫 클릭은 `busy`를 확인해 필요하면 재확인 토스트를 보내고, 그 토스트의
 *  `재시작`(같은 `restart` 액션)은 재확인 없이 바로 `quitAndInstall()`한다. `isBusy()`의 신뢰
 *  경계 처리(응답 실패·boolean 아닌 값 → `true`)는 무수정이다. */
async function handleRestart() {
  if (restartAsked) {
    restartAsked = false;
    quitAndInstallNow();
    return;
  }
  if (readyOrigin && (await isBusy(readyOrigin))) {
    restartAsked = true;
    surfaceUpdate({ kind: "confirm" });
    return;
  }
  quitAndInstallNow();
}

/** U1(`manual`) · 켤 때와 U2를 켠 직후의 배경 검사(`!manual`).
 *
 *  **개발 실행에서는 검사하지 않는다**(R5) — 패키징되지 않은 앱에 걸면 electron-updater가
 *  그 사실로 죽고 그 예외가 기동 경로에 앉는다. 손으로 누른 U1은 그 사실을 다이얼로그로 말한다.
 *
 *  **최신이어도 다이얼로그를 띄운다**(R5 U1). 손으로 누른 명령에 아무 반응이 없으면 사람은
 *  고장으로 읽는다. `owner`/`repo`가 자리표시자인 채로 눌러도 마찬가지다 — 사유가 그 자리에 뜬다
 *  (§배포 "조용히 떨어지지 않는다"와 같은 규칙). */
async function checkForUpdate(manual: boolean) {
  if (!app.isPackaged) {
    const why = "개발 실행(`pnpm dev`)에서는 업데이트를 검사하지 않습니다";
    if (!manual) return console.log(`[dira] ${why}`);
    surfaceUpdate({ kind: "message", text: `${why} — 패키징된 .app에서만 동작합니다 (pnpm dist).` });
    return;
  }
  lastPercent = -1; // 새 체크 주기 — 지난 다운로드의 퍼센트를 들고 있지 않는다
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!manual) return;
    surfaceUpdate({
      kind: "message",
      text: r?.isUpdateAvailable
        ? `${r.updateInfo.version}을 받고 있습니다. 다 받으면 알려드립니다.`
        : `최신 버전입니다 — ${app.name} ${app.getVersion()}`,
    });
  } catch (e) {
    if (!manual) return; // `error` 리스너가 이미 찍었다
    // 404면 electron-updater가 응답 헤더 전부를 message에 붙인다(실측 30줄). 사유는 첫 줄과
    // URL에 다 있고, 나머지는 토스트 한 줄을 못 읽게 만든다 — 전문은 콘솔에 남는다.
    surfaceUpdate({ kind: "message", text: `업데이트를 확인하지 못했습니다: ${(e as Error).message.slice(0, 300)}` });
  }
}

/** U2 토글. 상태는 파일이고 켠 직후에만 한 번 검사한다 — 끄면 U1만 남는다(R5). */
function setAutoUpdate(on: boolean) {
  const flag = autoUpdateFlag();
  if (on) rmSync(flag, { force: true });
  else writeFileSync(flag, "");
  console.log(`[dira] 자동 업데이트 ${on ? "켬" : "끔"} — ${flag} ${on ? "지움" : "만듦"}`);
  if (on) checkForUpdate(false);
}

/** T7 — 오는 길은 채널 하나, 인자는 미리 아는 이름 하나다. 모르는 값은 버린다(못박는 것 4) —
 *  렌더러가 보낸 값이 그대로 호출 인자가 되는 자리를 안 만든다. */
ipcMain.handle("dira:update-action", async (_e, action: unknown) => {
  switch (action) {
    case "state":
      return pendingUpdate ? { version: pendingUpdate.version } : null;
    case "notes":
      return pendingUpdate ? await pendingUpdate.notes : null;
    case "restart":
      await handleRestart();
      return null;
    case "later":
      restartAsked = false; // T5 — 재확인 토스트의 `취소`도 이 액션이다
      return null;
    default:
      return null;
  }
});

// ── N1 트레이 ──────────────────────────────────────────────────────────────

/** 트레이 메뉴. **열 때마다 새로 만든다** — 체크 상태의 원본은 OS이고(N4) 앱 안 변수에 담아두면
 *  시스템 설정 → 로그인 항목에서 끈 것이 메뉴에는 켜진 채로 남는다. `setContextMenu`는 메뉴를
 *  한 번 박고 끝이라 그 갱신 자리가 없어서 안 쓴다 — 클릭 때마다 `popUpContextMenu`로 띄운다. */
function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: "열기", click: () => showWindow() },
    { type: "separator" },
    {
      label: "로그인 시 자동 실행",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      // item.checked는 macOS가 이미 뒤집어 놓은 값이다(누른 뒤 상태). 그대로 OS에 되쓴다.
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      // N6. N4 아래·U2 위다. 상태의 원본은 마커 파일이고 **있으면 켬**이다(기본은 꺼짐).
      label: "남은 일이 있으면 잠자기 방지",
      type: "checkbox",
      checked: existsSync(noSleepFlag()),
      // 못박는 것 9 되살리기 뒤에도 지금 오리진(`readyOrigin`)을 본다 — 열 때마다 새로
      // 만드는 메뉴라 트레이가 뜬 뒤 자식이 재시작됐어도 옛 오리진을 들고 있지 않는다.
      click: (item) => setNoSleep(item.checked, readyOrigin!),
    },
    {
      // U2 (R5·R8). N4 옆이고 상태의 원본은 마커 파일이라 여기도 열 때마다 읽는다.
      label: "자동 업데이트",
      type: "checkbox",
      checked: !existsSync(autoUpdateFlag()),
      click: (item) => setAutoUpdate(item.checked),
    },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]);
}

/** 메뉴바 아이콘. */
function createTray() {
  // 템플릿 이미지 — 색을 갖지 않고 알파만 있다. 라이트/다크 메뉴바를 macOS가 각각 칠한다.
  // @2x는 파일명 규약으로 nativeImage가 알아서 집는다 (trayTemplate@2x.png).
  // 안 보이면 코드도 자산도 아니다: 노치 있는 맥에서 메뉴바가 꽉 차면 macOS가 새 상태 항목을
  // **카메라 하우징 아래 슬롯**에 놓고 거기서는 아무것도 그리지 않는다(setTitle 텍스트조차).
  // 항목·메뉴·클릭은 그대로 동작한다. 메뉴바 항목 하나를 ⌘-드래그로 치우면 나타난다. abce61c9.
  const image = nativeImage.createFromPath(fileURLToPath(new URL("trayTemplate.png", import.meta.url)));
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("dira");
  const popUp = () => tray?.popUpContextMenu(trayMenu());
  tray.on("click", popUp);
  tray.on("right-click", popUp);
}

// ── dira > About dira ───────────────────────────────────────────────────────

/** 새 창도 라우트도 안 만들고 다이얼로그 하나다. `app.showAboutPanel()`이 아닌 이유는 그
 *  패널의 credits가 선택도 클릭도 안 되는 회색 글자여서다 — 주소는 눌러서 열려야 한다(3).
 *  버전은 `app.getVersion()`(= package.json `version`)에서 온다. 손으로 적으면 릴리스마다
 *  두 곳이 갈린다. */
async function showAbout() {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `${app.name} ${app.getVersion()}`,
    detail: "임한솔\nmolmoty@gmail.com\nhttps://hsol.info",
    // macOS는 buttons[0]을 오른쪽 끝에 놓는다. 기본·취소 둘 다 0이라 ⏎·⎋가 그냥 닫는다 —
    // 여는 쪽이 기본이면 다이얼로그를 넘기려던 ⏎가 브라우저를 띄운다.
    buttons: ["닫기", "사이트 열기", "메일 보내기"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) shell.openExternal("https://hsol.info");
  else if (response === 2) shell.openExternal("mailto:molmoty@gmail.com");
}

// ── 메뉴 → 렌더러 (§0-12 `Help > 의견 보내기` · N5 `Edit > 찾기`) ────────────

/** **늘어난 렌더러 노출이 0개다.** preload에 새 API가 없고 `ipcRenderer`도 `fs`도 안 넘어간다
 *  (못박는 것 4) — main이 지금 떠 있는 문서에 이벤트 하나를 던지고 끝이다. 듣는 쪽은
 *  `apps/teams/components/feedback-dialog.tsx` 하나다.
 *
 *  **`loadURL`로 다시 열지 않는다**(§0-12): 쓰던 글·펼친 스트림·필터가 날아간다. 지금 보고 있는
 *  화면 **위에** 다이얼로그가 뜬다 — 화면 이동도 리로드도 없다.
 *
 *  창이 숨어 있으면(N1 — 빨간 버튼은 숨긴다) 먼저 꺼낸다. 안 그러면 안 보이는 창에서 폼이 열린다.
 *  ponytail: 렌더러 크래시로 창이 **파괴된** 뒤 첫 클릭은 신호가 떨어진다(`showWindow`가 창을
 *  다시 만들고, 그 문서는 아직 리스너를 안 걸었다). 한 번 더 누르면 열린다 — 그 경로를 위해
 *  로드 완료·하이드레이션까지 기다리는 배선을 만들 값이 없다.
 *
 *  **이 길이 셋이 되어 함수가 하나다**(N5 — `Edit > 찾기`, §릴리스 — 자동 업데이트 T7). 갈리는
 *  것은 이벤트 이름과 로그 문구뿐이라 세 벌로 두면 위 네 문단의 근거가 한쪽에서만 지켜진다.
 *  **`showWindow()`를 부르는 줄이 인자로 갈린다** — 업데이트(T1)는 창을 안 꺼낸다. 값이 실려도
 *  `Event`가 `CustomEvent`로 남는 것뿐이라 리스너 쪽 코드는 안 갈린다. */
function dispatchToWindow(event: string, what: string, opts: { detail?: unknown; showWindow?: boolean } = {}) {
  if (!readyOrigin) return console.log(`[dira] ${what} — 서버가 아직 준비 중입니다`);
  if (opts.showWindow ?? true) showWindow();
  const detail = opts.detail !== undefined ? `, { detail: ${JSON.stringify(opts.detail)} }` : "";
  win?.webContents
    .executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}${detail}))`)
    .catch((e: Error) => console.error(`[dira] ${what}를 열지 못했습니다: ${e.message}`));
}

const openFeedback = () => dispatchToWindow("dira:feedback", "의견 폼");
/** N5 — 듣는 쪽은 `apps/teams/components/find-bar.tsx`다. **바가 뜨지 않는 화면**
 *  (보드 · 홈 — 그 둘은 `⌘F`가 자기 일을 한다)에서는 그 컴포넌트가 안 서 있어 무동작이다. */
const openFind = () => dispatchToWindow("dira:find", "찾기 바");

/** `About dira`의 click을 잡으려면 **`{ role: "appMenu" }` 한 줄을 항목들로 펼쳐야 한다** —
 *  role `about`은 `app.showAboutPanel()`로 직행해서 가로챌 자리가 없다. 그 한 줄이 지금
 *  ⌘Q·⌘H·`Services`를 통째로 낳고 있어서, 펼치면서 하나라도 빠뜨리면 증상이 메뉴가 아니라
 *  **키보드**에서 난다(⌘Q가 안 먹는다). 그래서 첫 항목만 새것이고 나머지는 전부 role이다 —
 *  항목 내용도 라벨도 Electron이 준다. `filemenu`~`windowmenu` 넷은 매크로 그대로 둔다.
 *
 *  `getApplicationMenu()`를 받아 고치는 쪽이 더 짧지만 그 Menu는 **항목 추가를 지원하지
 *  않는다**(Electron 문서). 실제로 되긴 되는데 콘솔이
 *  `representedObject is not a WeakPtrToElectronMenuModelAsNSObject`로 도배된다(실측 279줄). */
function installAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: showAbout },
        // U1 — `About dira` **바로 아래**가 맥 관례다 (R5).
        { label: "업데이트 확인…", click: () => checkForUpdate(true) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    // §0-12 — `Window` 다음이고 **항목은 하나다**. `About dira`는 위 앱 메뉴 첫 항목 그대로다
    // (여기로 안 옮긴다). 메뉴 이름이 영어인 것은 옆의 role 라벨이 영어로 박혀 있어서고,
    // 우리가 만든 **항목**은 앱 안의 다른 항목들처럼 한글이다(트레이 `열기`·`종료`와 같은 벌).
    { label: "Help", submenu: [{ label: "의견 보내기", click: openFeedback }] },
  ]);

  // N5 — `Edit`은 **매크로 그대로 두고 빌드된 서브메뉴에 항목만 붙인다.** 위 주석의 그 자리다:
  // 펼치다 하나 빠뜨리면 증상이 메뉴가 아니라 키보드에서 난다(⌘Z·⌘X·⌘C·⌘V·⌘A).
  // **accelerator를 등록하지 않고 라벨에 키도 안 적는다** — `⌘F`는 키맵의 값이라(§0-6) main이
  // 그 값을 모르고, 메뉴가 accelerator를 잡으면 keydown이 렌더러에 아예 안 온다.
  // `role`은 Electron이 소문자로 눕힌다(`editmenu`). 못 찾으면 조용히 넘기지 않는다 —
  // 메뉴가 통째로 사라지는 것이 아니라 항목 하나만 없어지는 실패라 로그가 유일한 단서다.
  const edit = menu.items.find((i) => i.role === "editmenu")?.submenu;
  if (edit) {
    edit.append(new MenuItem({ type: "separator" }));
    edit.append(new MenuItem({ label: "찾기", click: openFind }));
  } else console.error("[dira] Edit 메뉴를 못 찾아 `찾기` 항목을 붙이지 못했습니다");

  Menu.setApplicationMenu(menu);
}

/** 못박는 것 9 — 창을 다시 올릴 때마다 무엇이 죽어 있는지 보고 갈린다. 아무것도 안 죽었으면
 *  종전 그대로 보여주기만 한다. 뭔가 죽었으면 서버 생사 하나로 갈린다(`decideRevive`) — 살아
 *  있으면 창만 다시 읽고, 죽어 있으면 자식부터 다시 띄운 뒤 새 오리진으로 창을 읽는다.
 *  되살리기가 실패하면 흰 창을 남기지 않고 못 2의 실패 화면으로 간다. */
async function showWindow() {
  const action = decideRevive({ winDestroyed: !win || win.isDestroyed(), contentDead, serverAlive: child !== null });
  if (action === "show") {
    win!.show();
    win!.focus();
    return;
  }
  console.log(`[dira] 창을 되살립니다 (${action})`);
  contentDead = false;
  let origin = readyOrigin!;
  if (action === "restart-server") {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    child = startServer(port);
    const reason = await waitForReady(origin, child);
    if (reason) {
      killServer();
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      showFailure(reason); // 흰 창을 그대로 두지 않는다
      return;
    }
    readyOrigin = origin;
  }
  if (!win || win.isDestroyed()) win = openWindow(origin);
  else win.loadURL(origin);
  win.show();
  win.focus();
}

async function boot() {
  installAppMenu(); // 실패 화면만 뜨는 실행에도 메뉴는 있다
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  child = startServer(port);
  console.log(`[dira] ${SERVER} → ${origin}`);

  const reason = await waitForReady(origin, child);
  if (reason) {
    killServer();
    showFailure(reason);
    return;
  }
  readyOrigin = origin; // 여기부터 `second-instance`가 창을 열 수 있다
  win = openWindow(origin);
  createTray();
  app.on("activate", () => showWindow()); // 독 아이콘도 `열기`와 같은 자리로 간다

  // U2가 켜져 있으면(기본) 켤 때 한 번 검사해 받아둔다. await하지 않는다 — 네트워크가
  // 기동 경로에 앉으면 안 된다. 실패는 `error` 리스너가 로그로만 남긴다 (R5·R6).
  if (!existsSync(autoUpdateFlag())) checkForUpdate(false);

  // T3 — 새 타이머 하나. N6가 말리는 것은 "같은 주기로 같은 서버를 묻는 폴링 둘"이고
  // 이쪽은 주기(1시간)도 대상(원격 릴리스 피드)도 다르다. 개발 실행은 아예 안 건다.
  if (app.isPackaged) {
    updateTimer = setInterval(() => {
      if (existsSync(autoUpdateFlag())) checkForUpdate(false); // 매 tick U2를 다시 본다
    }, UPDATE_POLL_MS);
  }

  await pollAwaiting(origin); // 첫 응답 = 씨 뿌리기
  await pollGate(origin); // 마찬가지로 첫 응답은 씨 뿌리기
  // 타이머는 하나다 (N6 · N2 둘째 사건) — 같은 30초를 나눠 쓴다.
  setInterval(() => {
    pollAwaiting(origin);
    pollGate(origin);
    pollWork(origin);
  }, POLL_MS);
}

// ── 못박는 것 6 — 인스턴스는 하나다 ────────────────────────────────────────
//
// **서버 spawn·창·트레이보다 먼저 잡는다.** 늦게 잡으면 두 번째 인스턴스는 이미 서버를 띄운
// 뒤고, 포트가 0이라(못박는 것 1) 충돌로 걸리지도 않는다 — 큐를 만지는 서버가 한 벌 더 조용히
// 떴다가 죽는다. 3이 종료 경로에서 막은 것이 시작 경로에서 새는 자리다.
// 락 키는 정하지 않는다 — Electron 기본값(앱 단위)이다.
if (!app.requestSingleInstanceLock()) {
  console.log("[dira] 이미 떠 있습니다 — 첫 번째 인스턴스에 넘기고 종료합니다");
  app.quit();
} else {
  // 두 번째 실행은 트레이 `열기`와 **같은 경로**로 간다. 아무 반응이 없으면 사람은 앱이 안
  // 켜졌다고 읽고 한 번 더 누른다. 서버 준비 전이면 열 오리진이 아직 없다 — 조용히 흘리지
  // 않고 로그를 남긴다. 준비되면 boot()이 어차피 창을 연다.
  app.on("second-instance", () => {
    if (!readyOrigin) {
      console.log("[dira] 두 번째 실행 — 서버 준비 중입니다. 준비되면 창이 열립니다");
      return;
    }
    console.log("[dira] 두 번째 실행 — 첫 번째 창을 엽니다");
    showWindow();
  });
  app.whenReady().then(boot);
}

// 자식 서버는 앱보다 오래 살지 않는다 (못박는 것 3). 죽는 경로 전부에 건다.
// ⌘Q · 트레이 `종료` · SIGTERM이 전부 여기로 모인다 — `quitting`이 창의 close 가로채기를 푼다.
app.on("before-quit", () => {
  quitting = true;
  killServer();
});
// 네 번째 경로 — 내장 autoUpdater의 quitAndInstall()은 macOS에서 창을 먼저 닫고 이 이벤트를
// 내며 app.quit()을 안 거친다. 위 before-quit이 안 떠서 따로 걸지 않으면 창만 내려가고
// quitting도 거짓인 채라 close 가로채기(N1)가 창을 숨겨 앱이 안 죽는다.
app.on("before-quit-for-update", () => {
  quitting = true;
  killServer();
});
// 트레이가 있으면 창이 없어도 앱이 아니다 (N1). 실패 화면은 트레이가 없어서 그대로 끝난다.
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});
process.on("exit", killServer);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.quit());
