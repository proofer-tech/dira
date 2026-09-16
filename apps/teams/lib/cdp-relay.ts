/** `cdp/[hash]` 라우트가 쓰는 순수 로직 (DESIGN.md §11-11 결정 1-2-3). fs·네트워크 I/O는
 *  전부 라우트가 하고, 여기는 그 결과를 판정하거나 클라이언트가 받은 스트림을 읽는 순수 함수만
 *  둔다 - 선례는 `lib/pty-stream.ts`다.
 *
 *  **클라이언트가 보낸 CDP 메서드 이름을 그대로 실어 나르지 않는다**(결정 3) -
 *  `toCdpInputCommand`가 아는 `type` 값만 통과하고, 통과한 값에 라우트 코드가 직접 박은 메서드
 *  이름(`Input.dispatchMouseEvent`/`Input.dispatchKeyEvent`)을 붙인다. */

const HASH_RE = /^[0-9a-f]{8}$/;

export function isValidCdpHash(hash: string): boolean {
  return HASH_RE.test(hash);
}

/** `browser.sh`의 `_existing_port()`가 읽는 것과 같은 경로(결정 1). */
export function browserPortPath(hash: string, tmpDir = "/tmp"): string {
  return `${tmpDir}/qa-${hash}/chrome-profile/DevToolsActivePort`;
}

/** `DevToolsActivePort` 파일의 원문에서 포트를 읽는다 - 첫 줄이 포트다. 파일이 없으면(`null`)
 *  그 티켓은 지금 브라우저를 안 쥔 것이다(결정 1) - 라우트가 404로 옮긴다. */
export function portFromDevToolsFile(raw: string | null): number | null {
  if (!raw) return null;
  const line = raw.split("\n")[0]?.trim();
  if (!line) return null;
  const port = Number(line);
  return Number.isInteger(port) && port > 0 ? port : null;
}

const MOUSE_TYPES = new Set(["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]);
const KEY_TYPES = new Set(["keyDown", "keyUp", "rawKeyDown", "char"]);

export type CdpInputCommand = {
  method: "Input.dispatchMouseEvent" | "Input.dispatchKeyEvent";
  params: Record<string, unknown>;
};

/** POST 본문 -> CDP 입력 커맨드. 아는 `type`(CDP 자신의 이벤트 타입 값) 밖은 전부 `null`이고
 *  라우트가 400으로 옮긴다 - 이 화이트리스트 밖으로는 어떤 메서드도 못 나간다(결정 3). */
export function toCdpInputCommand(body: unknown): CdpInputCommand | null {
  if (!body || typeof body !== "object") return null;
  const { type } = body as Record<string, unknown>;
  if (typeof type !== "string") return null;
  const params = body as Record<string, unknown>;
  if (MOUSE_TYPES.has(type)) return { method: "Input.dispatchMouseEvent", params };
  if (KEY_TYPES.has(type)) return { method: "Input.dispatchKeyEvent", params };
  return null;
}

export type CdpFrameOutcome = "ok" | "disconnected" | "aborted";

/** GET 응답(`text/event-stream`)을 읽는다 - `data:` 줄 하나가 프레임 하나(base64 JPEG 그대로,
 *  결정 2). 청크 경계가 줄 중간에서 끊겨도 버퍼에 남겨 다음 청크와 이어 붙인다. `readPtyStream`과
 *  같은 세 갈래(`ok`/`disconnected`/`aborted`)를 쓴다. */
export async function readCdpFrameStream(
  res: Response,
  onFrame: (base64Jpeg: string) => void,
  signal?: AbortSignal,
): Promise<CdpFrameOutcome> {
  if (!res.ok) return "disconnected";
  const reader = res.body?.getReader();
  if (!reader) return "disconnected";
  const decoder = new TextDecoder();
  let buf = "";
  let frames = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        frames++;
        onFrame(line.slice(5).trimStart());
      }
    }
  } catch {
    return signal?.aborted ? "aborted" : "disconnected";
  }
  return frames === 0 ? "disconnected" : "ok";
}
