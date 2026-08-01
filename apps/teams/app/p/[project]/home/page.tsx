/** 프로젝트 홈 `/p/<project>/home` — 질의 에이전트 (DESIGN.md §7 · §비주얼 §24).
 *
 *  **서버가 트랜스크립트를 읽어 동기로 그린다**(§24 다섯 상태 — 스켈레톤 0 · `loading.tsx` 0).
 *  가짜 높이가 먼저 서면 마운트 직후의 자동 스크롤이 그 위치로 한 번 튄다(§13과 같은 판단).
 *  그래서 이 파일이 하는 일은 `pollHome` **한 번**이고 나머지는 전부 `<HomeUI>`다 —
 *  화면이 아는 전부가 그 한 응답이라 첫 렌더와 폴링이 같은 함수를 쓴다.
 *
 *  대화의 출처는 `~/.claude/projects/…`의 트랜스크립트다 — Next 캐시가 모르는 파일이고
 *  세션이 GUI 밖에서 append한다. 프리렌더하면 빌드 시점 대화가 굳는다. */
import { notFound } from "next/navigation";
import { HomeUI } from "@/components/home-ui";
import { pollHome } from "@/lib/home-agent";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ project: string }> }) {
  const { project: id } = await params;
  // 셸(`layout.tsx`)이 이미 `notFound()`를 하지만 이 페이지도 자기 인자를 자기가 확인한다 —
  // 등록 안 된 id가 `home-sessions.json`의 키로 흘러가는 자리를 하나도 안 남긴다(actions와 같은 선).
  if (!(await getProject(id))) notFound();

  return <HomeUI project={id} initial={await pollHome(id, null, 0)} />;
}
