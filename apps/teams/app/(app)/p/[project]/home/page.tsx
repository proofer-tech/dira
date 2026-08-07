/** 프로젝트 홈 `/p/<project>/home` — 질의 에이전트 (DESIGN.md §7 · §비주얼 §24).
 *
 *  **서버가 트랜스크립트를 읽어 동기로 그린다**(§24 다섯 상태 — 스켈레톤 0 · `loading.tsx` 0).
 *  가짜 높이가 먼저 서면 마운트 직후의 자동 스크롤이 그 위치로 한 번 튄다(§13과 같은 판단).
 *  그래서 이 파일이 하는 일은 `pollHome` **한 번**이고 나머지는 전부 `<HomeUI>`다 —
 *  화면이 아는 전부가 그 한 응답이라 첫 렌더와 폴링이 같은 함수를 쓴다.
 *
 *  **예외가 하나 있다: 온보딩 예시 앞의 두 문장**(§비주얼 §24). 저건 폴링 응답에 안 실리고
 *  (`listWorkers`가 `crontab -l`을 물어서 500ms마다 프로세스가 뜬다) 이 서버 렌더에서 한 번
 *  계산돼 굳는다 — 예시는 고쳐 쓰라고 있는 입력칸의 내용이지 상태 표시가 아니다.
 *
 *  대화의 출처는 `~/.claude/projects/…`의 트랜스크립트다 — Next 캐시가 모르는 파일이고
 *  세션이 GUI 밖에서 append한다. 프리렌더하면 빌드 시점 대화가 굳는다. */
import { notFound } from "next/navigation";
import { HomeUI } from "@/components/home-ui";
import { pollHome } from "@/lib/home-agent";
import { getProject } from "@/lib/projects";
import { exampleWorkers, listWorkers } from "@/lib/workers";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ project: string }> }) {
  const { project: id } = await params;
  // 셸(`layout.tsx`)이 이미 `notFound()`를 하지만 이 페이지도 자기 인자를 자기가 확인한다 —
  // 등록 안 된 id가 `home-sessions.json`의 키로 흘러가는 자리를 하나도 안 남긴다(actions와 같은 선).
  const project = await getProject(id);
  if (!project) notFound();

  // 온보딩 예시 앞의 둘(§비주얼 §24) — **이 서버 렌더 한 번**이 그 이름들을 정한다.
  // 폴링에 안 싣는 이유와 `HomeChunk.workers`가 출처가 아닌 이유는 `exampleWorkers` 머리 주석.
  // 조사는 `워커`라는 낱말이 받는다(`<이름> 워커는`) — 이름에 `이/가`를 직접 붙이면 읽는 소리로
  // 갈리고, 워커 이름은 `NAME_RE`라 코드가 그걸 맞힐 수 없다(§24).
  const [active, other] = exampleWorkers(await listWorkers(project.root));

  return (
    <HomeUI
      project={id}
      initial={await pollHome(id, null, 0)}
      examples={
        active ? [`${active} 워커는 지금 무슨 일을 하고 있나`, `${other} 워커는 어떤 엔진으로 도나`] : []
      }
    />
  );
}
