/** `home/pty/[id]` GET 응답을 읽는 순수 로직 (DESIGN.md §11-1 §개정) — `TerminalPanel`이 DOM에
 *  닿기 전에 판정부터 끝낸다. 세 갈래: 200이 아니면 본문을 한 글자도 안 읽고 끊김, 한 바이트도
 *  못 받고 스트림이 끝나도 끊김(pty가 서버 메모리에 없을 때 라우트가 내는 빈 스트림), 그
 *  둘 다 아니면 정상(`onChunk`로 청크를 흘려보낸다). `signal`이 이미 끊겼다면(언마운트로
 *  `AbortController.abort()`) 읽기 중 던진 에러를 끊김이 아니라 `"aborted"`로 가른다 —
 *  다른 탭으로 옮겼다 돌아와도 정상 화면이 그대로 떠야 한다(§11 결정 2). */
export type PtyStreamOutcome = "ok" | "disconnected" | "aborted";

export async function readPtyStream(
  res: Response,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<PtyStreamOutcome> {
  if (!res.ok) return "disconnected";
  const reader = res.body?.getReader();
  if (!reader) return "disconnected";
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      onChunk(decoder.decode(value, { stream: true }));
    }
  } catch {
    return signal?.aborted ? "aborted" : "disconnected";
  }
  return bytes === 0 ? "disconnected" : "ok";
}
