// dira 데스크톱 셸. 하는 일은 다섯이다 — Next standalone 서버를 자식으로 띄우고(번들의 엔진을
// 그 전에 userData로 꺼내 `DIRA_ENGINE`으로 넘긴다, 못박는 것 8), 창이 그것을 열고,
// 창을 닫아도 메뉴바에 남고(N1), 답변 대기 티켓이 새로 생기면 알리고(N2), 화면이 부르면
// 네이티브 경로 다이얼로그를 띄우고(N3), 로그인 시 자동 실행을 켜고 끈다(N4).
// 스펙: ../../docs/DESIGN.md §데스크톱 앱 (특히 "못박는 것" 1~8, N1·N2·N3·N4).
import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } from "electron";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (b) => (stderr += b));
  proc.stdout?.on("data", (b) => process.stdout.write(b));
  proc.on("error", (e) => (stderr += `${e.message}\n`));
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
  if (child && child.exitCode === null) child.kill("SIGTERM");
  child = null;
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
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "dira",
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: PRELOAD },
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
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  win.loadURL(origin);
  return win;
}

// ── N2 답변 대기 알림 ───────────────────────────────────────────────────────
//
// 판정은 서버가 한다(못박는 것 5) — main은 `GET /api/awaiting`를 물어보고 **직전 집합과의
// 차집합만** 알린다. 켠 직후 첫 응답은 조용히 씨를 뿌린다: 앱을 켤 때마다 밀린 알림이 쏟아지면
// 그 알림은 다음 주에 꺼진다.

type Awaiting = { project: string; stem: string; hash: string; title: string };

/** `null` = 아직 씨를 안 뿌렸다. 빈 집합(`답변 대기 0건`)과 다른 상태다 — 섞으면 첫 응답이
 *  0건인 큐에서 두 번째 응답의 새 티켓을 놓치거나, 반대로 첫 응답을 통째로 알린다. */
let seen: Set<string> | null = null;

function notify(item: Awaiting, origin: string) {
  const n = new Notification({
    title: "답변 대기",
    body: `${item.title || item.hash} — ${item.project}`,
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

// ── N1 트레이 ──────────────────────────────────────────────────────────────

/** 트레이 메뉴. **열 때마다 새로 만든다** — 체크 상태의 원본은 OS이고(N4) 앱 안 변수에 담아두면
 *  시스템 설정 → 로그인 항목에서 끈 것이 메뉴에는 켜진 채로 남는다. `setContextMenu`는 메뉴를
 *  한 번 박고 끝이라 그 갱신 자리가 없어서 안 쓴다 — 클릭 때마다 `popUpContextMenu`로 띄운다. */
function trayMenu(origin: string): Menu {
  return Menu.buildFromTemplate([
    { label: "열기", click: () => showWindow(origin) },
    { type: "separator" },
    {
      label: "로그인 시 자동 실행",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      // item.checked는 macOS가 이미 뒤집어 놓은 값이다(누른 뒤 상태). 그대로 OS에 되쓴다.
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]);
}

/** 메뉴바 아이콘. */
function createTray(origin: string) {
  // 템플릿 이미지 — 색을 갖지 않고 알파만 있다. 라이트/다크 메뉴바를 macOS가 각각 칠한다.
  // @2x는 파일명 규약으로 nativeImage가 알아서 집는다 (trayTemplate@2x.png).
  // 안 보이면 코드도 자산도 아니다: 노치 있는 맥에서 메뉴바가 꽉 차면 macOS가 새 상태 항목을
  // **카메라 하우징 아래 슬롯**에 놓고 거기서는 아무것도 그리지 않는다(setTitle 텍스트조차).
  // 항목·메뉴·클릭은 그대로 동작한다. 메뉴바 항목 하나를 ⌘-드래그로 치우면 나타난다. abce61c9.
  const image = nativeImage.createFromPath(fileURLToPath(new URL("trayTemplate.png", import.meta.url)));
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("dira");
  const popUp = () => tray?.popUpContextMenu(trayMenu(origin));
  tray.on("click", popUp);
  tray.on("right-click", popUp);
}

// ── 도움말 > 개발자 정보 ────────────────────────────────────────────────────

/** 세 줄이 전부다 — 버전·빌드·라이선스는 여기 안 온다(§도움말 메뉴 4). 새 창도 라우트도 안
 *  만들고 다이얼로그 하나다(2). `app.showAboutPanel()`이 아닌 이유는 그 패널의 credits가
 *  선택도 클릭도 안 되는 회색 글자여서다 — 주소는 눌러서 열려야 한다(3). */
async function showDeveloper() {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: "임한솔",
    detail: "molmoty@gmail.com\nhttps://hsol.info",
    // macOS는 buttons[0]을 오른쪽 끝에 놓는다. 기본·취소 둘 다 0이라 ⏎·⎋가 그냥 닫는다 —
    // 여는 쪽이 기본이면 다이얼로그를 넘기려던 ⏎가 브라우저를 띄운다.
    buttons: ["닫기", "사이트 열기", "메일 보내기"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) shell.openExternal("https://hsol.info");
  else if (response === 2) shell.openExternal("mailto:molmoty@gmail.com");
}

/** **Electron 40 기본 메뉴에 도움말은 아예 없다**(실측: `appmenu` `filemenu` `editmenu`
 *  `viewmenu` `windowmenu` 다섯뿐). 붙일 서브메뉴가 없으니 그 메뉴를 만든다.
 *
 *  ⌘C·⌘V·⌘W·⌘Q는 전부 그 role 항목이 주는 것이라 하나라도 빠뜨리면 증상이 메뉴가 아니라
 *  **웹뷰 입력칸**에서 난다(§도움말 메뉴 1). 그래서 **항목을 손으로 적지 않는다** — 기본 메뉴와
 *  같은 role 매크로 다섯을 그대로 다시 쓰고 여섯 번째만 새것이다. 내용은 Electron이 준다.
 *
 *  `getApplicationMenu()`를 받아 `append`하는 쪽이 더 짧지만 그 Menu는 **항목 추가를 지원하지
 *  않는다**(Electron 문서). 실제로 되긴 되는데 콘솔이
 *  `representedObject is not a WeakPtrToElectronMenuModelAsNSObject`로 도배된다(실측 279줄). */
function installDeveloperItem() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      { label: "도움말", role: "help", submenu: [{ label: "개발자 정보", click: showDeveloper }] },
    ]),
  );
}

function showWindow(origin: string) {
  // 렌더러가 죽어 창이 파괴된 뒤라면 다시 만든다. 서버는 그대로라 포트도 그대로다.
  if (!win || win.isDestroyed()) win = openWindow(origin);
  else win.show();
  win.focus();
}

async function boot() {
  installDeveloperItem(); // 실패 화면만 뜨는 실행에도 메뉴는 있다
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
  createTray(origin);
  app.on("activate", () => showWindow(origin)); // 독 아이콘도 `열기`와 같은 자리로 간다

  await pollAwaiting(origin); // 첫 응답 = 씨 뿌리기
  setInterval(() => pollAwaiting(origin), POLL_MS);
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
    showWindow(readyOrigin);
  });
  app.whenReady().then(boot);
}

// 자식 서버는 앱보다 오래 살지 않는다 (못박는 것 3). 죽는 경로 전부에 건다.
// ⌘Q · 트레이 `종료` · SIGTERM이 전부 여기로 모인다 — `quitting`이 창의 close 가로채기를 푼다.
app.on("before-quit", () => {
  quitting = true;
  killServer();
});
// 트레이가 있으면 창이 없어도 앱이 아니다 (N1). 실패 화면은 트레이가 없어서 그대로 끝난다.
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});
process.on("exit", killServer);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.quit());
