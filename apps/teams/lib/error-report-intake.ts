/** 오류 제보 수신 — DESIGN.md §P513 결정 3 - 5. 모양만 본다(인증 없음, 공개 엔드포인트).
 *  `route.ts`는 얇게 두고 판정은 여기서 한다: Next 라우트 파일은 정해진 이름만 export할 수 있어
 *  쓰기 함수를 주입하는 테스트(`error-report-intake.test.ts`)가 라우트 안에 못 들어간다. */
export const MAX_BYTES = 256 * 1024;
const REQUIRED = ["v", "install_id", "source", "kind", "message"] as const;

export type PutFn = (path: string, body: string) => Promise<unknown>;

export async function receive(req: Request, put: PutFn): Promise<Response> {
  // ponytail: 본문을 한 번 다 읽고 길이를 잰다. 256 KB 상한이라 스트리밍 차단까지는 안 간다.
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BYTES) return new Response(null, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return new Response(null, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  if (REQUIRED.some((k) => rec[k] === undefined || rec[k] === null)) {
    return new Response(null, { status: 400 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("error-report", text);
    return new Response(null, { status: 202 });
  }
  // 경로 조각은 신뢰 경계 입력이다 - install_id·at을 그대로 쓰면 `/`나 `..`로 폴더를 벗어난다.
  const safe = (s: unknown) => String(s).replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/\.{2,}/g, "_").slice(0, 64);
  const at = typeof rec.at === "string" && !Number.isNaN(Date.parse(rec.at)) ? rec.at : new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `error-reports/${at.slice(0, 10)}/${safe(rec.install_id)}-${safe(at)}-${rand}.json`;
  try {
    await put(path, text);
  } catch (e) {
    console.error("error-report blob put failed", e, text);
  }
  return new Response(null, { status: 202 });
}
