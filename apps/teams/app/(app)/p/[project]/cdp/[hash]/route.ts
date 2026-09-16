/** CDP 릴레이 - 티켓이 쥔 브라우저의 화면을 SSE로 흘리고 입력을 받는다 (DESIGN.md §11-11
 *  결정 2-3). 선례는 `home/pty/[id]/route.ts`(GET 스트림 - POST 입력)와 같은 모양이지만
 *  **DELETE가 없다** - 이 브라우저는 세션이 빌린 슬롯이라, 화면이 탭을 닫으며 release를 부르면
 *  일하고 있는 세션의 브라우저가 죽는다(결정 2). 탭을 닫는 동작은 스트림을 끊는 것까지다.
 *
 *  프로젝트 소유권을 다시 확인하지 않는다 - `hash`는 `^[0-9a-f]{8}$`로 재고(결정 1, 신뢰 경계),
 *  그 값으로 마는 `/tmp/qa-<해시>` 경로는 프로젝트별로 안 갈리는 시스템 전역 자리다.
 *
 *  **릴레이는 CDP 프록시가 아니다**(결정 3) - GET이 아는 것은 screencast 셋뿐이고 POST가 아는
 *  것은 `Input.dispatch*` 둘뿐이다. 클라이언트가 보낸 메서드 이름을 그대로 실어 나르는 줄이
 *  없다 - `toCdpInputCommand`가 그 화이트리스트다. */
import { readFile } from "node:fs/promises";
import {
  browserPortPath,
  isValidCdpHash,
  portFromDevToolsFile,
  toCdpInputCommand,
} from "@/lib/cdp-relay";

async function validHash(params: Promise<{ hash: string }>): Promise<string | null> {
  const { hash } = await params;
  return isValidCdpHash(hash) ? hash : null;
}

async function activePort(hash: string): Promise<number | null> {
  const raw = await readFile(browserPortPath(hash), "utf8").catch(() => null);
  return portFromDevToolsFile(raw);
}

type CdpTarget = { type: string; webSocketDebuggerUrl?: string };

/** `/json`에서 `type`이 `page`인 첫 대상의 `webSocketDebuggerUrl`을 얻는다(결정 2). */
async function pageWsUrl(port: number): Promise<string | null> {
  const res = await fetch(`http://127.0.0.1:${port}/json`).catch(() => null);
  if (!res?.ok) return null;
  const targets = (await res.json().catch(() => null)) as CdpTarget[] | null;
  if (!Array.isArray(targets)) return null;
  return targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
}

/** 화면 스트림 - screencast를 열고 프레임마다 SSE 사건 하나(`data:`의 값이 base64 JPEG 그대로,
 *  결정 2)를 내보낸다. **ACK를 안 보내면 프레임이 서너 장에서 멎는다**(요구 티켓 실측) - 그래서
 *  `screencastFrame`을 받을 때마다 그 자리에서 `screencastFrameAck`를 되보낸다. */
export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const hash = await validHash(params);
  if (!hash) return new Response("bad hash", { status: 400 });
  const port = await activePort(hash);
  if (!port) return new Response("no browser", { status: 404 });
  const wsUrl = await pageWsUrl(port);
  if (!wsUrl) return new Response("no browser", { status: 404 });

  let ws: WebSocket | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let nextId = 1;
      ws = new WebSocket(wsUrl);

      ws.addEventListener("open", () => {
        ws?.send(
          JSON.stringify({
            id: nextId++,
            method: "Page.startScreencast",
            params: { format: "jpeg", quality: 60, maxWidth: 1280 },
          }),
        );
      });

      ws.addEventListener("message", (ev) => {
        if (closed) return;
        let msg: { method?: string; params?: { data?: string; sessionId?: number } };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.method !== "Page.screencastFrame" || !msg.params?.data) return;
        try {
          controller.enqueue(enc.encode(`data: ${msg.params.data}\n\n`));
        } catch {
          // 구독자가 이미 정리된 뒤 - cancel()이 늦게 온 경우
        }
        ws?.send(
          JSON.stringify({
            id: nextId++,
            method: "Page.screencastFrameAck",
            params: { sessionId: msg.params.sessionId },
          }),
        );
      });

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // 이미 취소된 뒤
        }
      };
      ws.addEventListener("close", finish);
      ws.addEventListener("error", finish);
    },
    cancel() {
      closed = true;
      try {
        ws?.send(JSON.stringify({ id: 0, method: "Page.stopScreencast" }));
      } catch {
        // 소켓이 이미 닫힌 뒤
      }
      try {
        ws?.close();
      } catch {
        // 이미 닫힌 뒤
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}

/** CDP는 요청-응답 하나에 소켓 하나면 충분하다 - GET의 화면 스트림과 상태를 공유할 이유가
 *  없다(새 상태 파일 0개, 결정 1). 응답(성공/에러)이 오거나 2초를 넘기면 닫는다. */
function sendCdpCommand(
  wsUrl: string,
  method: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // 이미 닫힌 뒤
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 2000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === id) finish(!msg.error);
      } catch {
        // 무시 - 다른 사건일 수 있다
      }
    });
    ws.addEventListener("error", () => finish(false));
  });
}

/** 입력 - 본문의 `type`으로만 `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` 중 하나를
 *  고른다(결정 3, `toCdpInputCommand`). 그 둘 중 어느 쪽도 아니면 400이다. */
export async function POST(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const hash = await validHash(params);
  if (!hash) return new Response("bad hash", { status: 400 });
  const port = await activePort(hash);
  if (!port) return new Response("no browser", { status: 404 });
  const wsUrl = await pageWsUrl(port);
  if (!wsUrl) return new Response("no browser", { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad body", { status: 400 });
  }
  const cmd = toCdpInputCommand(body);
  if (!cmd) return new Response("bad body", { status: 400 });

  const ok = await sendCdpCommand(wsUrl, cmd.method, cmd.params);
  return Response.json({ ok });
}
