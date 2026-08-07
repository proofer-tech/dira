/** 답변 대기 티켓 — 등록된 프로젝트 전부 (DESIGN.md §데스크톱 앱 N2 · 못박는 것 5).
 *
 *  **판정을 여기서 다시 쓰지 않는다.** `isAwaiting` 하나를 부르는 것이 이 라우트의 전부고,
 *  Electron main은 큐를 직접 읽지 않고 이걸 물어본다 — main이 판정을 복제하면 제약 3이
 *  GUI↔`tickets.py`에서 막은 거짓말이 main↔GUI에서 다시 난다.
 *
 *  화면이 쓰지 않는 유일한 라우트다(앱의 나머지는 서버 컴포넌트가 직접 `lib/`를 부른다).
 *  깨진 레지스트리는 삼키지 않는다 — `readProjects`가 던지면 500이고, main이 그걸 로그로 남긴다.
 *  못 읽는 큐(경로가 사라진 프로젝트)는 `listTickets`가 이미 빈 목록으로 답한다. */
import { readProjects, resolveConfig } from "@/lib/projects";
import { isAwaiting, listTickets } from "@/lib/queue";

export async function GET() {
  const projects = await readProjects();
  const found = await Promise.all(
    projects.map(async (p) => {
      const tickets = await listTickets(p.root, await resolveConfig(p));
      // 링크는 `stem`이다(§식별자). `hash`는 표시값이라 알림 본문에만 쓴다.
      return tickets
        .filter(isAwaiting)
        .map((t) => ({ project: p.id, stem: t.stem, hash: t.hash, title: t.title }));
    }),
  );
  return Response.json(found.flat());
}
