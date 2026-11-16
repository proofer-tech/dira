/** 알림을 띄운 팔로우를 끈다 (DESIGN.md §P564 결정 3). 없는 항목이어도 200이다. */
import { ackFollow } from "@/lib/follows";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.project !== "string" || typeof body.stem !== "string") {
    return Response.json({ error: "project and stem required" }, { status: 400 });
  }
  await ackFollow(body.project, body.stem);
  return Response.json({ ok: true });
}
