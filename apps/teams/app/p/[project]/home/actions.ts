"use server";

/** 홈 대화의 서버 액션 셋 — 묻기 · 폴링 · 새 대화 (DESIGN.md §7 · §비주얼 §24).
 *
 *  **큐 파일을 하나도 안 건드린다.** 다른 화면의 `actions.ts`가 티켓·워커·프로토콜 파일을 쓰는
 *  자리인 것과 반대다(§7 — 질문이 티켓으로 들어가지 않고 답이 티켓으로 나오지 않는다).
 *  여기서 나가는 쓰기는 `$TICKET_LOCAL/home-sessions.json`의 **대화 목록**뿐이다(§대화가 여럿이다).
 *
 *  판정과 실행은 전부 `lib/home-agent.ts`다 — 이 파일은 프로젝트 검증 + 위임이 전부다
 *  (`sendInterject`가 `lib/interject.ts`에 대해 갖는 관계와 같다).
 *
 *  **`revalidatePath`를 부르지 않는다.** 대화의 출처는 트랜스크립트 파일이고 그건 Next 캐시가
 *  모르는 것이라 폴링이 직접 읽는다. 티켓도 레지스트리도 안 바뀌므로 다시 그릴 화면이 없다. */
import { verifyAttachments, withAttachments } from "@/lib/attachments";
import {
  newConversation,
  pollHome,
  startAsk,
  stopAsk,
  switchConversation,
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
export async function askHome(
  projectId: string,
  question: string,
  /** 첨부(§8) — 화면이 이미 올려 둔 **경로**만 온다(바이트는 이 액션을 안 지난다). 돌아온 경로가
   *  `attachments/` 아래인지는 서버가 다시 본다(신뢰 경계). 조립은 `withAttachments` 하나이고,
   *  그 경로는 홈 에이전트 cwd(`dirname(root)`) 아래라 `Read`가 그대로 연다(§7 · §8 표). */
  attachments: string[] = [],
): Promise<Answer | null> {
  try {
    const project = await required(projectId);
    const attached = await verifyAttachments(project, attachments);
    return await startAsk(project, withAttachments(question, attached));
  } catch (e) {
    // 여기 오는 건 프로젝트 조회와 첨부 경로 판정이 던진 것뿐이다(§24 표에 항이 없다) — `other`다.
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
    return {
      sessionId: null,
      conversations: [], // 못 읽는 큐 = 열 목록도 없다. 패널이 안 그려진다(§24 0건)
      workers: [], // 〃 — 워커 세션은 그 큐에서 파생된다(§7 좌측 패널)
      turns: [],
      offset: 0,
      reset: true,
      running: false,
      partial: "",
      stopped: false,
      failed: null,
      // **여기만 `done`을 손으로 참으로 준다**(`pollDone`은 이걸 거짓이라 볼 것이다 — 답이
      // 안 왔으니까). 저 판정이 기다리는 것은 *도는 답*이고 여기는 물러난 자리라 기다릴 답이
      // 없다. 참을 안 주면 화면이 있지도 않은 프로젝트를 5분 동안 다시 묻는다(머리 주석).
      done: true,
    };
  }
}

/** `중지`(§7 §도는 답을 멈춘다) — 도는 자식에 `SIGTERM`. **답이 사라지지 않는다**: 받은 데까지가
 *  트랜스크립트에 남고 다음 질문은 같은 대화에 `--resume`으로 이어진다(실측 ⑵⑶).
 *  돌려주는 것은 죽일 것이 있었나이고, 상태가 화면에 붙는 것은 그 다음 폴링의 `stopped`다. */
export async function stopHome(projectId: string): Promise<boolean> {
  try {
    return stopAsk((await required(projectId)).id);
  } catch {
    return false; // 등록이 풀린 프로젝트 — 죽일 것도 말할 것도 없다
  }
}

/** `새 대화` — **목록에 줄을 하나 여는 게 전부다**(§7 §대화가 여럿이다 — 종전은 그 한 줄을
 *  지우는 것이었고 요구 `c5d22429`로 뒤집혔다). 옛 대화도 옛 트랜스크립트도 남는다
 *  (`~/.claude`는 남의 디렉터리다). 도는 중에 못 부르게 막는 것은 화면이다(§24 — `aria-disabled`);
 *  여기서 다시 막지 않는 이유는 막을 대상이 파일이 아니라 **떠 있는 프로세스**라서다. 그건
 *  `중지`의 일이고(§7), 이 함수가 하는 일은 다음 질문이 새 세션이 되게 하는 것뿐이다.
 *
 *  **돌려주는 것은 폴링 한 번**이다(아래 `switchHome`과 같은 모양) — 화면이 새 목록과 빈 스레드를
 *  이 응답 하나로 갈아 끼운다. 새 대화에는 트랜스크립트가 아직 없으므로 `turns`가 0건이다. */
export async function clearHome(projectId: string): Promise<HomeChunk> {
  await newConversation((await required(projectId)).id);
  return pollHomeAnswer(projectId, null, 0);
}

/** 대화 전환(§비주얼 §24 대화 목록) — **`current`를 갈고 그 대화를 읽어 돌려준다.**
 *
 *  **`sessionId`는 신뢰 경계 밖이다**(클라이언트가 고른 줄). 관문은 `switchConversation`이고
 *  그것이 보는 것은 **목록에 있는 줄인가** 하나다 — 없으면 파일을 안 건드리고, 아래 폴링이
 *  지금 대화를 그대로 다시 그린다(화면이 튀지 않는다).
 *
 *  스켈레톤이 없는 이유가 이 한 왕복이다(§24 로딩 항 — 서버가 트랜스크립트를 읽어 통째로 준다).
 *  `sessionId: null`로 폴링하는 것은 **offset을 0부터 다시 세라**는 뜻이다: 갈아탄 대화의 파일은
 *  다른 파일이라 들고 있던 바이트 수가 거기서는 아무 뜻이 없다(`pollHome`의 `reset`). */
export async function switchHome(projectId: string, sessionId: string): Promise<HomeChunk> {
  try {
    await switchConversation((await required(projectId)).id, sessionId);
  } catch {
    // 등록이 풀린 프로젝트 — 갈아 끼울 것이 없다. 아래 폴링이 빈 대화로 물러난다(위와 같은 선)
  }
  return pollHomeAnswer(projectId, null, 0);
}
