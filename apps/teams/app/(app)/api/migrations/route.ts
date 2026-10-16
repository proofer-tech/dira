/** 마이그레이션 오버레이의 창구 (DESIGN.md P505 "화면 (오버레이)" API).
 *
 *  GET -> `{status, pending}`: 상태 파일과 `check --all` 결과. 미적용이 있는데 러너가 없으면 띄운다.
 *  POST `{action: "retry"|"skip"|"wait", key}`: `key`는 레지스트리 id(또는 `machine`)뿐이다 -
 *  경로는 서버가 레지스트리에서 찾고 클라이언트가 보낸 경로는 쓰지 않는다. */
import { act, ensureRunner, MigrationError } from "@/lib/migrations";

export async function GET() {
  return Response.json(await ensureRunner());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    await act(String(body?.action), body?.key);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof MigrationError) return Response.json({ error: e.message }, { status: e.code });
    throw e;
  }
}
