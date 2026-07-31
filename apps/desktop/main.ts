// dira 데스크톱 셸. 하는 일은 둘이다 — Next standalone 서버를 자식으로 띄우고, 창이 그것을 연다.
// 스펙: ../../docs/DESIGN.md §데스크톱 앱 (특히 "못박는 것" 1~4).
// 트레이·알림·피커·자동 실행은 여기 없다 (abce61c9 · 283dc4c1 · c01e2678 · 00fc34ba).
import { app, BrowserWindow, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(
  new URL(process.env.DIRA_SERVER_JS ?? "../teams/.next/standalone/server.js", import.meta.url),
);
const READY_TIMEOUT_MS = 30_000;

let child: ChildProcess | null = null;
let stderr = "";

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

function startServer(port: number): ChildProcess {
  // node 바이너리가 PATH에 있다고 가정하지 않는다 — Electron 자신을 노드로 돌린다.
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOSTNAME: "127.0.0.1" },
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
function openWindow(origin: string) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "dira",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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

  win.loadURL(origin);
}

app.whenReady().then(async () => {
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
  openWindow(origin);
});

// 자식 서버는 앱보다 오래 살지 않는다 (못박는 것 3). 죽는 경로 전부에 건다.
app.on("before-quit", killServer);
app.on("window-all-closed", () => app.quit()); // 트레이가 없는 동안은 창이 곧 앱이다 (N1이 뒤집는다)
process.on("exit", killServer);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.quit());
