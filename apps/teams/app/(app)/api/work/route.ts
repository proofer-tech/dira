/** 일이 남았나 — 등록된 프로젝트 전부 (DESIGN.md §데스크톱 앱 N6).
 *
 *  `/api/awaiting`과 같은 모양이다: **판정을 여기서 다시 쓰지 않고** `statusOf` 하나를 부른다.
 *  main은 큐를 직접 읽지 않고 이걸 물어본다(고정하는 것 5).
 *
 *  `대기`(`open`)·`진행중`(`wip`) 둘만 센다. 나머지 셋이 빠지는 이유는 스펙에 각각 적혀 있다 —
 *  `deps 대기`는 선행이 이미 잡고 있고, `답변 대기`는 사람이 자는 동안 아무도 못 집어 가고,
 *  `할당됨`은 큐에서 영구 제외된 이상 상태다. 넓히면 맥이 영영 안 잔다.
 *
 *  깨진 레지스트리는 삼키지 않는다(500) — main이 그걸 로그로 남기고 assertion을 **놓는다**. */
import { readProjects, resolveConfig } from "@/lib/projects";
import { listTickets, statusOf } from "@/lib/queue";

export async function GET() {
  const projects = await readProjects();
  const busy = await Promise.all(
    projects.map(async (p) => {
      const tickets = await listTickets(p.root, await resolveConfig(p));
      return tickets.some((t) => statusOf(t) === "open" || statusOf(t) === "wip");
    }),
  );
  return Response.json({ busy: busy.includes(true) });
}
