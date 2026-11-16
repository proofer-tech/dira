/** 팔로우 중인데 끝난 티켓 (DESIGN.md §P564 결정 3). 판정은 `lib/follows.ts`, main은 알림만 띄운다.
 *  큐에서 사라진 팔로우는 이 호출이 목록에서 지운다. */
import { continuedOf, listTickets } from "@/lib/queue";
import { doneFollows } from "@/lib/follows";
import { getProject, resolveConfig } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    await doneFollows(async (id) => {
      const p = await getProject(id);
      if (!p) return null;
      const tickets = await listTickets(p.root, await resolveConfig(p));
      return {
        name: p.name,
        tickets: new Map(
          tickets.map((t) => [t.stem, { done: t.state === "done", hash: t.hash, title: t.title, continued: continuedOf(t) }]),
        ),
      };
    }),
  );
}
