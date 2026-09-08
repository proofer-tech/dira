/** 터미널 pty 입출력 통로 (DESIGN.md §11-1). Server Action이 아니라 라우트인 이유는
 *  스트리밍 응답이다 — 액션은 청크로 못 흐른다(§11 결정 4 — 터미널은 폴링에 안 든다,
 *  자기 스트림 하나가 그 자리다).
 *
 *  `id`는 pty id(=터미널 탭 id, `crypto.randomUUID()`) — `transcript.ts`의 `UUID_RE`와 같은
 *  정규식이지만 그 파일을 안 부른다: 그 모듈은 `~/.claude/projects`를 훑는 fs 코드를 물고 있어
 *  가져오면 Next의 파일 추적(NFT)이 이 라우트 하나 때문에 프로젝트 전체를 훑은 것으로 오판한다
 *  (실측 — `pnpm build` 경고). uuid 형식 검사 한 줄에 그 값을 치를 이유가 없다.
 *  **프로젝트 소유권을 다시 확인하지 않는다** — pty id는 무작위라 다른 프로젝트 화면에서 추측해
 *  칠 수 없고, `lib/pty.ts` 자체가 파일시스템에 안 닿는다(신뢰 경계가 `home-sessions.json`의
 *  `cwd` 쪽에 이미 있다 — 그 값은 `openTerminal` 액션이 `listCheckouts`로 검증한 값만 받는다). */
import { killPty, subscribePty, writePty } from "@/lib/pty";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function validId(params: Promise<{ id: string }>): Promise<string | null> {
  const { id } = await params;
  return UUID_RE.test(id) ? id : null;
}

/** 출력 스트림 — 연결 즉시 지금까지의 화면(backlog)을 흘려보내고, 그 뒤로는 실시간 청크다.
 *  pty가 없으면(다른 서버 프로세스에서 열렸다 — 재시작 등) 빈 스트림으로 바로 닫는다.
 *  **재접속을 안 만든다**(§11 결정 2) — 이 GET은 pty가 있으면 무조건 잇는다, 화면이 그걸
 *  "다시 연결"로 쓰지 않는 것은 클라이언트 쪽 규칙이다(`restartTerminal` 액션이 죽은 탭을
 *  살리는 유일한 경로다 — §11-1 §개정 뒤로는 TerminalPanel이 살아 있는 탭이면 마운트 즉시
 *  이 GET을 연다, 죽은 탭만 `다시 열기`를 거친다). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await validId(params);
  if (!id) return new Response("bad id", { status: 400 });

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const sub = subscribePty(id, (chunk) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // 구독자가 이미 정리된 뒤 — cancel()이 늦게 온 경우
        }
      });
      if (!sub) {
        controller.close();
        return;
      }
      if (sub.backlog) controller.enqueue(enc.encode(sub.backlog));
      unsubscribe = sub.unsubscribe;
      if (!sub.alive) controller.close();
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 입력 — xterm의 `onData` 청크를 그대로 문다. 본문은 바이트 그대로(JSON이 아니다) —
 *  이스케이프를 한 번 더 인코딩/디코딩할 이유가 없다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await validId(params);
  if (!id) return new Response("bad id", { status: 400 });
  const data = await req.text();
  return Response.json({ ok: writePty(id, data) });
}

/** 탭을 닫을 때 - `SIGTERM` 하나(§11-1 결정 4). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await validId(params);
  if (!id) return new Response("bad id", { status: 400 });
  return Response.json({ ok: killPty(id) });
}
