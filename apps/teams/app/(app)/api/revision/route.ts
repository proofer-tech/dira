/** 보드 이른 갱신의 정수 하나 (DESIGN.md §아키텍처 §보드 갱신 · §데스크톱 앱 N2 형제 셋 자리).
 *
 *  `BoardPolling`이 250ms마다 여기를 묻는다. 응답은 메모리 안 정수라 **큐를 안 읽는다**
 *  (`listTickets` 0회) — 이 라우트의 비용이 0인 것이 250ms 주기를 가능하게 한다.
 *
 *  `/api/awaiting`·`/api/work`·`/api/gate`(등록 프로젝트 전부, Electron main용)와 달리
 *  화면 자신이 부르는 라우트라 프로젝트 하나만 본다 — `project` 쿼리가 그 하나를 가리킨다.
 *  못 찾은/빈 `project`는 조용히 `{ rev: 0 }`(보드 페이지가 이미 그 전에 404를 낸다 —
 *  여기 오는 건 신뢰 경계 입력이라 존재를 다시 검증할 뿐 에러를 내지 않는다). */
import { getProject } from "@/lib/projects";
import { boardRevision } from "@/lib/board-revision";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("project") ?? "";
  const project = await getProject(id);
  return Response.json({ rev: project ? boardRevision(project.root) : 0 });
}
