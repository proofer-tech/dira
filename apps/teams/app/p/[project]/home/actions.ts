"use server";

/** 홈 대화의 서버 액션 셋 — 묻기 · 폴링 · 새 대화 (DESIGN.md §7 · §비주얼 §24).
 *
 *  **큐 파일을 하나도 안 건드린다.** 다른 화면의 `actions.ts`가 티켓·워커·프로토콜 파일을 쓰는
 *  자리인 것과 반대다(§7 — 질문이 티켓으로 들어가지 않고 답이 티켓으로 나오지 않는다).
 *  여기서 나가는 쓰기는 `$TICKET_LOCAL/home-sessions.json`의 **한 줄**뿐이다.
 *
 *  판정과 실행은 전부 `lib/home-agent.ts`다 — 이 파일은 프로젝트 검증 + 위임이 전부다
 *  (`sendInterject`가 `lib/interject.ts`에 대해 갖는 관계와 같다).
 *
 *  **`revalidatePath`를 부르지 않는다.** 대화의 출처는 트랜스크립트 파일이고 그건 Next 캐시가
 *  모르는 것이라 폴링이 직접 읽는다. 티켓도 레지스트리도 안 바뀌므로 다시 그릴 화면이 없다. */
import {
  clearSessionId,
  pollHome,
  startAsk,
  type Answer,
  type HomeChunk,
} from "@/lib/home-agent";
import { getProject } from "@/lib/projects";

/** 등록된 프로젝트인가. **클라이언트가 준 id는 신뢰 경계 밖이다** — 여기서 걸러야 등록 안 된
 *  값이 `home-sessions.json`의 키가 되지 않는다(경로가 되는 값은 그 파일의 **값**이고 그쪽
 *  관문은 `sessionIdOf` 하나다 — §7). */
async function required(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return project;
}

/** 질문 하나를 띄운다. 돌려주는 것은 **실패뿐**이고(`null` = 시작했다) 답의 도착은 폴링이 말한다.
 *  이미 도는 질문이 있으면 `busy`로 거절한다(§24 실패 ④) — 기다리게 하지 않는다. */
export async function askHome(projectId: string, question: string): Promise<Answer | null> {
  try {
    return await startAsk(await required(projectId), question);
  } catch (e) {
    // 여기 오는 건 프로젝트 조회가 던진 것뿐이다(§24 표에 항이 없다) — `other`다.
    return { ok: false, reason: "other", output: (e as Error).message, sessionId: "", resumed: false };
  }
}

/** 답이 도는 동안만 도는 폴링(§7 — 홈은 5초 폴링을 하지 않는다). 화면이 아는 전부가 이 응답이다.
 *  못 읽는 큐·사라진 프로젝트는 **빈 대화 + 멈춤**으로 물러난다 — 있지도 않은 것을 2초마다 다시
 *  묻지 않는다(`tailSession`과 같은 선). */
export async function pollHomeAnswer(
  projectId: string,
  sessionId: string | null,
  offset: number,
): Promise<HomeChunk> {
  try {
    await required(projectId);
    return await pollHome(projectId, sessionId, offset);
  } catch {
    return { sessionId: null, turns: [], offset: 0, reset: true, running: false, failed: null };
  }
}

/** `새 대화` — **session id 한 줄을 지우는 게 전부다**(§7). 옛 트랜스크립트는 안 지운다
 *  (`~/.claude`는 남의 디렉터리다). 도는 중에 못 부르게 막는 것은 화면이다(§24 — `aria-disabled`);
 *  여기서 다시 막지 않는 이유는 막을 대상이 파일이 아니라 **떠 있는 프로세스**라서다. 그건
 *  이 앱에 없는 취소 버튼의 일이고(§7), 이 함수가 하는 일은 다음 질문이 새 세션이 되게 하는 것뿐이다. */
export async function clearHome(projectId: string): Promise<void> {
  await clearSessionId((await required(projectId)).id);
}
