"use server";

/** 티켓 **파일**을 바꾸는 서버 액션 — 저장 · 할당 해제 · 삭제.
 *
 *  `app/actions.ts`와 따로 두는 이유: 그쪽은 레지스트리 전용이고 큐 파일을 하나도 건드리지 않는다
 *  (제약 7). 여기는 반대로 큐 파일만 만진다. 화면 폴더에 두는 건 `workers/actions.ts`와 같은 규칙.
 *
 *  **클라이언트가 넘긴 프로젝트·해시는 신뢰 경계 밖이다.** 매 호출마다 다시 검증하고, 경로는
 *  `tickets.py find`로 새로 얻는다 — 화면을 그린 뒤 파일이 잡혔을(claim) 수도 있다.
 *  상태 재확인이 `.wip` 편집을 막는 유일한 장치다(렌더 시점 판정은 이미 낡았다).
 *
 *  여기 오는 `hash`는 **푼 값**이다(페이지가 `decodeHash`로 한 번 푼다). 조회에만 쓴다 —
 *  엔진 인자와 `revalidatePath`는 찾아낸 파일의 `stem`이고(§식별자), URL이라 다시 인코딩한다. */
import { open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics";
import { verifyAttachments, withAttachments } from "@/lib/attachments";
import { writeEpic } from "@/lib/epic";
import { listEpics, refreshKnownRefs, resolveMarkdownRefs } from "@/lib/epics";
import { findTicket, unassign, type UnassignRun } from "@/lib/engine";
import { followup, type FollowupResult } from "@/lib/followup";
import { interject, type InterjectResult } from "@/lib/interject";
import { kickIdleWorker } from "@/lib/kick";
import { mayHaveRefs, type RefIndex } from "@/lib/markdown-refs";
import { isHash, parseAssignment, resolveWithin } from "@/lib/paths";
import { findStream, sessionIdOf, tailEvents, type StreamEvent } from "@/lib/transcript";
import {
  awaitingOf,
  isAwaiting,
  listTickets,
  LOCKED,
  PRIORITY_DEFAULT,
  PRIORITY_MAX,
  PRIORITY_MIN,
  readFm,
  resolveDep,
  stateOf,
  stemOf,
  writeTicket,
  type TicketState,
} from "@/lib/queue";
import { getProject, resolveConfig } from "@/lib/projects";

export type SaveState = { ok?: boolean; error?: string };

type Target = {
  root: string;
  path: string;
  stem: string;
  state: TicketState;
  assigned: boolean;
  sessionId: string | null; // UUID_RE를 통과한 것만. 이 값만 경로가 된다(§2-1 경로 방어)
  inbox: boolean; // 참견 입구가 fm에 있나(§2-2). **경로는 안 내보낸다** — 쓰는 건 서버뿐이다
};

/** 프로젝트·해시 → 지금 이 순간의 파일. 못 찾으면 문장으로 던진다(액션이 결과로 바꾼다).
 *
 *  `stem`은 **찾아낸 파일에서 뽑는다** — 엔진 왕복(`unassign`)과 `revalidatePath`가 쓰는 값이다.
 *  URL 문자열을 그대로 넘기면 `findTicket` 폴백으로 들어온 표시값에서 화면은 뜨는데 엔진 호출만
 *  `티켓을 못 찾음`으로 실패한다(DESIGN.md §식별자). */
async function target(projectId: string, hash: string): Promise<Target> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  const config = await resolveConfig(project);
  const p = await findTicket(project.root, hash, config);
  if (!p) throw new Error(`큐에 없는 티켓입니다: ${hash}`);
  const { fm, end } = readFm(await readFile(p, "utf8"));
  return {
    root: project.root,
    path: p,
    stem: stemOf(p, config),
    state: stateOf(path.basename(p), config),
    assigned: end >= 0 && !!(fm.session_id ?? "").trim().replace(/^["']+|["']+$/g, ""),
    sessionId: end >= 0 ? sessionIdOf(fm) : null,
    inbox: end >= 0 && !!(fm.inbox ?? "").trim().replace(/^["']+|["']+$/g, ""),
  };
}

export type StreamChunk = {
  events: StreamEvent[];
  offset: number;
  live: boolean;
  /** 참견 입구가 있나(§2-2 · §비주얼 §21 — `live`인데 `inbox`가 없으면 폼은 비활성이다).
   *  이 폴링에 얹는 이유는 매 2초 서버가 티켓 fm을 이미 읽고 있기 때문이다 — 화면이 같은 사실을
   *  다른 요청으로 또 묻지 않는다. 나가는 것은 **불리언 하나**고 경로는 안 나간다. */
  inbox: boolean;
  /** 티켓이 `.done`인가 — 폼의 **모드**를 고르는 비트다(§비주얼 §21 `어느 폼을 그리나`).
   *  `live` 하나로는 안 갈린다: `.done`과 열림이 **둘 다 `live === false`**이고 열림엔 이 입구가
   *  없다(§2-2 안 만드는 것 3). `inbox`와 같은 이유로 이 응답에 얹는다 — 상태는 이미 읽었다. */
  done: boolean;
  /** 이 회차에 새로 온 `events`만 훑어 나온 산문 속 해시-P번호 표식의 값(§9 §클라이언트가
   *  폴링하는 자리 — "그 응답이 자기 해석 결과를 같이 싣는다"). `mayHaveRefs`가 그 모양을 한
   *  글자도 못 찾으면(대부분의 회차) 빈 인덱스고 `listTickets`를 다시 안 돈다. */
  refs: RefIndex;
};

const NO_REFS: RefIndex = { tickets: {}, epics: {} };

/** 세션 스트림 폴링 (DESIGN.md §2-1 · §9). 클라이언트가 `offset`을 들고 오면 **그 뒤에 붙은
 *  바이트만** 읽어 사건 + 새 `offset`을 돌려준다. Route Handler를 만들지 않는다 — 서버 fs 접근은
 *  이미 Server Action이 하는 일이고 `app/api/`는 §아키텍처 트리에 없는 새 관례다.
 *
 *  **`session_id`는 클라이언트가 보내는 것을 쓰지 않는다.** 매 호출마다 티켓 fm에서 서버가 읽고
 *  UUID_RE를 통과한 것만 경로가 된다(§경로 방어). 클라이언트가 주는 건 티켓 stem과 offset뿐이고
 *  stem은 다른 액션과 같은 조회(`tickets.py find`)를 지나므로 큐 밖 파일을 가리킬 수 없다.
 *
 *  `live`(= 티켓이 `.wip`)는 **클라이언트가 폴링을 멈출 근거다.** 티켓이 사라졌거나 조회가 실패해도
 *  `live: false`로 물러난다 — 못 찾는 티켓을 2초마다 다시 물을 이유가 없다. 빈 상태(트랜스크립트
 *  없음)도 에러가 아니라 빈 사건 배열이다(§9 "에러로 그리지 않는다"). */
export async function tailSession(
  projectId: string,
  stem: string,
  offset: number,
): Promise<StreamChunk> {
  // 클라이언트가 준 숫자다. `tailEvents`가 파일 크기로 다시 자르지만 NaN·Infinity는 그 비교를
  // 통과해 `Buffer.alloc`까지 간다 — 여기서 정수 아닌 것을 0으로 되돌린다.
  const at = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  try {
    const t = await target(projectId, stem);
    const live = t.state === "wip";
    const inbox = t.inbox;
    const done = t.state === "done";
    if (!t.sessionId) return { events: [], offset: at, live, inbox, done, refs: NO_REFS };
    // 어느 엔진 형식인지는 **파일이 어느 트리에 있나**가 정한다(§4-3 §grok) — 이 폴링이 워커
    // 목록을 읽지 않는 이유다. 2초마다 새로 무는 fs는 종전 그대로 티켓 하나 + 글롭이다.
    const s = await findStream(t.sessionId);
    if (!s) return { events: [], offset: at, live, inbox, done, refs: NO_REFS };
    const chunk = await tailEvents(s.file, at, s.grok);
    // 이 회차의 새 글만 훑는다 — `mayHaveRefs`가 그 모양을 못 찾으면 `listTickets`를 안 돈다
    // (대부분의 회차, §성능 예산). 걸리면 그때만 큐 전체를 다시 읽는다 — 다른 폴링(보드 5초)도
    // 이미 매 회차 fs를 새로 문다, 여기는 걸리는 회차만이라 더 싸다.
    const text = chunk.events.map((e) => e.body).join("\n");
    const refs = mayHaveRefs(text)
      ? await (async () => {
          const project = await getProject(projectId);
          if (!project) return NO_REFS;
          const config = await resolveConfig(project);
          const tickets = await listTickets(project.root, config);
          const epics = await listEpics(project.root, tickets);
          return resolveMarkdownRefs(project.root, projectId, [text], tickets, epics);
        })()
      : NO_REFS;
    return { ...chunk, live, inbox, done, refs };
  } catch {
    return { events: [], offset: at, live: false, inbox: false, done: false, refs: NO_REFS };
  }
}

/** 이미 그려진 표식이 큐가 갈린 회차에 값을 다시 받는 자리(DESIGN.md §아키텍처 §이른 갱신이
 *  붙는 화면 §개정 4, 요구 `de0b759d`). `tailSession`에 안 얹은 이유는 `ticketMtime` 머리말과
 *  같다 — 그 폴은 `noStream`(codex)이거나 세션이 끝나면 멎지만, 표식은 트랜스크립트가 아니라
 *  큐가 근거라 계속 따라가야 한다. 클라이언트가 이미 아는 stem·P번호만 받아 그대로 되돌린다 —
 *  새 큐 조회 통로가 아니라 §9의 해석 하나를 다른 신호(revision)로 다시 부르는 것뿐이다. */
export async function refreshRefs(
  projectId: string,
  known: { tickets: string[]; epics: string[] },
): Promise<RefIndex> {
  if (!known.tickets.length && !known.epics.length) return NO_REFS;
  try {
    const project = await getProject(projectId);
    if (!project) return NO_REFS;
    const config = await resolveConfig(project);
    const tickets = await listTickets(project.root, config);
    const epics = await listEpics(project.root, tickets);
    return refreshKnownRefs(project.root, projectId, tickets, epics, known.tickets, known.epics);
  } catch {
    return NO_REFS;
  }
}

/** 티켓 파일이 바뀌었나 (DESIGN.md §2-4 ③) — `.wip` 상세의 본문이 파일을 따라가는 근거다.
 *  세션이 `## Done when` 상자를 켜거나 `## 결과`·`## 블록`을 덧붙이면 mtime이 움직인다.
 *
 *  **나가는 것은 수 하나와 불리언 하나다.** 본문을 안 실어 보내는 이유: 바뀐 회차에 화면이
 *  `router.refresh()`를 부르면 서버 컴포넌트가 본문·상자·상태 배지를 **한 렌더에** 다시 준다 —
 *  상자만 따로 갱신하는 두 번째 렌더 규칙이 생기지 않는다(§2-4 ③ "본문 전체가 따라간다").
 *  그래서 **안 바뀐 회차의 값이 0이다**: 여기 드는 비용은 readdir + 티켓 파일 하나 + `stat`이고
 *  페이지 재렌더(큐 전체 스캔 + 워커 + 트랜스크립트 조회)는 mtime이 움직인 회차에만 돈다.
 *
 *  **`tailSession`에 얹지 않았다.** 그 폴링은 `codex`에서 아예 안 돈다(트랜스크립트가 없다,
 *  §4-3 표) — 얹으면 codex 워커가 문 티켓의 본문이 안 따라간다. 판정은 여기서도 상태 하나다.
 *
 *  `live`(= `.wip`)는 화면이 폴링을 멈출 근거다 — 못 찾는 티켓을 다시 묻지 않는다. */
export async function ticketMtime(
  projectId: string,
  stem: string,
): Promise<{ mtime: number; live: boolean }> {
  try {
    const t = await target(projectId, stem);
    return { mtime: (await stat(t.path)).mtimeMs, live: t.state === "wip" };
  } catch {
    return { mtime: 0, live: false };
  }
}

/** 참견 보내기 (DESIGN.md §2-2). 스트림 아래 form이 부르는 자리이고, `tailSession`과 같은
 *  이유로 여기 있다 — Route Handler를 만들지 않는다(§아키텍처 트리 무수정).
 *
 *  **판정과 쓰기는 전부 `lib/interject.ts`가 한다.** 여기서 상태를 다시 보지 않는 것은 판정이
 *  두 곳으로 갈리지 않게 하려는 것이다(§2-2 "화면이 들고 있던 값을 믿지 않는다"는 그 함수의 계약).
 *
 *  **`revalidatePath`를 부르지 않는다.** 참견의 도착 확인은 스트림이 한다(§2-2) — 다음 폴링의
 *  `queue-operation` `enqueue` 줄이 그 문장을 데려오고, 티켓 파일은 아무것도 안 바뀐다. */
export async function sendInterject(
  projectId: string,
  stem: string,
  text: string,
  /** 첨부(§8) — 화면이 이미 올려 둔 **경로**만 온다. 바이트는 이 액션을 지나지 않는다.
   *  돌아온 경로가 `attachments/` 아래인지는 서버가 다시 본다(신뢰 경계 — `(board)/actions.ts`와
   *  같은 두 줄이다). 본문 조립은 `withAttachments` 하나고 자리 넷이 그것을 같이 쓴다(§8). */
  attachments: string[] = [],
): Promise<InterjectResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);
    const attached = await verifyAttachments(project, attachments);
    return await interject(project.root, config, stem, withAttachments(text, attached));
  } catch (e) {
    // 여기 오는 건 프로젝트 조회·설정 해석이 던진 것뿐이다(§21 실패 4종에 없다) — `other`다.
    const error = (e as Error).message;
    return { ok: false, reason: "other", error, detail: error };
  }
}

/** 이어받기 (DESIGN.md §2-2 완료 티켓의 참견). 같은 form의 `.done` 모드가 부르는 자리다 —
 *  **Server Action 둘**이고 각자 자기 상태를 다시 본다(모드가 어긋나면 실패 + 사유다).
 *
 *  **판정과 쓰기는 전부 `lib/followup.ts`가 한다**(`sendInterject`와 같은 이유 — 판정이 두 곳으로
 *  갈리면 화면이 거짓말을 한다). 돌려주는 건 새 티켓 stem이고 **이동은 화면이 한다**: 여기서
 *  `redirect`하면 실패 사유를 그릴 자리가 없어진다(발행 다이얼로그와 갈리는 점이다 — 저긴
 *  다이얼로그가 결과를 들고 있다).
 *
 *  `revalidatePath`는 **보드만** 부른다: 원본 티켓 파일은 한 글자도 안 바뀌므로 그 상세는 다시
 *  그릴 것이 없고, 보드에는 새 티켓이 한 줄 뜬다(`createTicket`과 같다). */
export async function sendFollowup(
  projectId: string,
  stem: string,
  text: string,
  /** `sendInterject`와 같은 두 줄이다(§8). 표기가 본문 **끝**이라 `followup`이 첫 줄에서 뽑는
   *  title은 사람이 쓴 글 그대로다 — `createTicket`이 title을 먼저 계산하는 것과 같은 이유다. */
  attachments: string[] = [],
): Promise<FollowupResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);
    const attached = await verifyAttachments(project, attachments);
    const r = await followup(project.root, config, stem, withAttachments(text, attached));
    if (r.ok) {
      revalidatePath(`/p/${projectId}`);
      await kickIdleWorker(project.root); // §4-5 — 이어받기는 **새 열린 티켓 한 장**이다
    }
    return r;
  } catch (e) {
    // 여기 오는 건 프로젝트 조회·설정 해석이 던진 것뿐이다 — 모드 어긋남이 아니므로 `other`다.
    const error = (e as Error).message;
    return { ok: false, reason: "other", error, detail: error };
  }
}

/** 할당 해제가 막히는 상태는 `.done` **하나**라 Record가 아니다 — `.wip`의 해제는 이 액션의
 *  본래 용도고(죽은 세션 복구), 열린 티켓의 ghost 해제도 살아 있다. 화면의 잠금 `Alert`와 같은
 *  사실을 알려 준다: 막는 것이 아니라 남기는 것이 목적이다. */
const UNASSIGN_LOCKED_DONE =
  "완료 티켓은 할당 해제할 수 없습니다 — 담당 세션 기록(session_id·owner)은 누가 한 일인지를 남기려고 그대로 둡니다.";

const DELETE_LOCKED: Record<"wip" | "done", string> = {
  wip: "진행중 티켓은 삭제할 수 없습니다 — 세션에 할당된 티켓입니다.",
  done: "완료 티켓은 삭제할 수 없습니다 — 이 해시를 deps로 둔 티켓이 영구 대기합니다.",
};

/** frontmatter 값으로 들어갈 한 줄. 개행이 섞이면 frontmatter가 깨져 티켓이 큐에서 사라진다. */
function fmValue(name: string, raw: string): string {
  const v = raw.trim();
  if (/[\r\n]/.test(v)) throw new Error(`${name}에 줄바꿈을 넣을 수 없습니다.`);
  return v;
}

/** 저장 — 읽고-고치고-쓰기. 건드리는 frontmatter 키는 title·kind·persona·squad·priority·duedate
 *  여섯뿐이고 나머지(session_id·owner·attempts·pid…)는 엔진 것이라 그대로 둔다.
 *
 *  ponytail: deps는 편집하지 않는다 — 자유 입력은 오타 해시로 영구 대기를 만들어 스펙이 금지한다
 *  (DESIGN.md §3). 검색 가능한 멀티셀렉트가 필요하고 그건 티켓 발행(fb4f2723)이 만든다. */
export async function saveTicket(_prev: SaveState, form: FormData): Promise<SaveState> {
  const projectId = String(form.get("project") ?? "");
  const hash = String(form.get("hash") ?? "");
  try {
    const t = await target(projectId, hash);
    if (t.state !== "open") return { error: LOCKED[t.state] };

    const title = fmValue("제목", String(form.get("title") ?? ""));
    if (!title) return { error: "제목을 입력하세요." };
    const kind = fmValue("kind", String(form.get("kind") ?? ""));
    // §5-5 §할당 입구 둘 — select 값은 `persona:<이름>`/`squad:<이름>` 접두사고, 서버가 쓰는 키는
    // 정확히 하나다. 스쿼드를 고르면 `squad:`를 쓰고 `persona:` 줄을 지운다(반대도 같다) —
    // 아래 `writeTicket`의 `undefined`가 그 줄을 통째로 지운다.
    let assignment: { persona: string; squad: string };
    try {
      assignment = parseAssignment(String(form.get("persona") ?? ""));
    } catch (e) {
      return { error: (e as Error).message };
    }

    // select라 항상 1~5가 오지만, 요청은 손으로도 만들 수 있다 — 범위 밖·정수 아님은 조용히
    // 기본값으로 내린다(§1-3 §값을 넣는 자리 셋. `priority_of`가 어차피 3으로 읽는 값이라
    // 신뢰 경계 위반이 아니다).
    const priorityNum = Number(form.get("priority"));
    const priority = String(
      Number.isInteger(priorityNum) && priorityNum >= PRIORITY_MIN && priorityNum <= PRIORITY_MAX
        ? priorityNum
        : PRIORITY_DEFAULT,
    );

    // `datetime-local`이 오프셋 없는 ISO 8601을 낸다 — 그대로 한 줄이다(§1-4 §값. 새 파서를
    // 안 만든다, 못 읽는 값은 엔진이 WARN + 마감 없음으로 관대하게 받는다). 비우면 **줄 자체를
    // 지운다**(writeTicket의 undefined) — 빈 값으로 두면 duedateOf가 WARN을 낸다.
    const duedateRaw = String(form.get("duedate") ?? "").trim();

    // textarea는 CRLF로 온다(HTML 폼 규격). 그대로 쓰면 파일 전체 줄끝이 갈린다.
    // 구분 빈 줄·끝 개행은 붙이지 않는다 — `writeTicket`이 되씌운다(§2 §원문의 양끝).
    const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n");

    await writeTicket(
      t.path,
      {
        title,
        kind,
        persona: assignment.squad ? undefined : assignment.persona,
        squad: assignment.squad || undefined,
        priority,
        duedate: duedateRaw || undefined,
      },
      body,
    );
    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/p/${projectId}`); // 보드의 title·kind·persona 컬럼
    // §4-5 — 편집으로 persona가 붙거나 deps 한 줄이 빠지면 그 순간 디스패치 가능해진다.
    // "정말 가능해졌나"는 판정하지 않는다(그러면 §큐 판정이 두 벌이다) — 그냥 tick 한 번이다.
    await kickIdleWorker(t.root);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 드래그가 부르는 결과 — `reason`이 §비주얼 §52 ⑤ 실패 한 줄의 세 갈래를 그대로 나른다.
 *  화면은 에러 문자열을 다시 패턴 매칭하지 않는다(판정은 `lib/epic.ts` 하나뿐). */
export type EpicDropResult = { ok: true } | { ok: false; reason: "locked" | "missing" | "other"; error: string };

/** 카드를 에픽에 끌어다 놓는다 (DESIGN.md §에픽 §결정 8) — `saveTicket`이 이미 여는 같은 쓰기에
 *  손잡이가 하나 더 붙는 것이다. **판정·쓰기는 전부 `lib/epic.ts`가 한다**(`sendInterject`와
 *  같은 이유 — 두 곳에서 판정하면 화면이 거짓말을 한다).
 *
 *  `epic`이 빈 문자열이면 `(에픽 없음)`에 놓은 것이고, 이미 그 값이면 `writeEpic`이 파일을
 *  안 건드린다(mtime 불변 — 5초 폴링이 안 갈린 파일을 다시 그리게 하지 않는다).
 *
 *  드래그로 끌리는 것은 `open` 카드뿐이라(§결정 8) 상태 갱신·persona 변화가 없다 —
 *  `saveTicket`과 달리 `kickIdleWorker`를 안 부른다. */
export async function setTicketEpic(
  projectId: string,
  hash: string,
  epic: string,
): Promise<EpicDropResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);
    const r = await writeEpic(project.root, config, hash, epic);
    if (!r.ok) return r;
    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(r.stem)}`);
    revalidatePath(`/p/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "other", error: (e as Error).message };
  }
}

/** 할당 해제 — **엔진에 위임한다**(제약 2). `assigned`가 아니면 부르지 않는다: 이 명령은
 *  진행중 접미사도 떼므로, 할당 안 된 `.wip`에 부르면 세션 없이 잡힌 상태를 사람이 흔드는 셈이다.
 *
 *  `.done`도 거부한다(사람 요구 `8ec6cd6d`). 완료 티켓은 `session_id`를 든 채 완료되므로
 *  `assigned`만 보면 통과하는데, 거기서 이 명령이 하는 일은 `clear`가 담당 세션 기록을 지우는
 *  것뿐이다 — 큐는 그대로고 기록만 없어진다. 화면에서 버튼을 뺐지만(page.tsx) 화면 제약은
 *  검증이 아니다(`deleteTicket`의 `DELETE_LOCKED`와 같은 근거).
 *
 *  `force`는 **사람이 확인 다이얼로그에서 누른 뒤에만** 온다(§2-5). 이 액션은 그 판단을 하지
 *  않는다 — 산 세션인지는 엔진이 종료 코드 `3`으로 답하고, 화면은 그 코드를 보고 묻는다.
 *  `.done`은 여기서 먼저 막히므로 `--force`가 완료 티켓에 닿는 경로가 없다(요구 `8ec6cd6d`). */
export async function unassignTicket(
  projectId: string,
  hash: string,
  force = false,
): Promise<UnassignRun> {
  try {
    const t = await target(projectId, hash);
    if (t.state === "done") {
      return { ok: false, output: UNASSIGN_LOCKED_DONE, worker: null };
    }
    if (!t.assigned) {
      return { ok: false, output: "할당된 티켓이 아닙니다(session_id가 비어 있습니다).", worker: null };
    }
    // URL 문자열이 아니라 **찾아낸 파일의 stem**을 넘긴다 — 엔진 `find`는 파일명만 본다.
    const r = await unassign(t.root, t.stem, force);
    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/p/${projectId}`);
    if (r.ok) await kickIdleWorker(t.root); // §4-5 — `.wip` → 열림. 되돌린 티켓이 바로 다시 물린다
    return r;
  } catch (e) {
    return { ok: false, output: (e as Error).message, worker: null };
  }
}

/** 요구사항 답변 — `tickets/<awaiting><done>.md`를 **새로** 만든다 (DESIGN.md §요구사항 레이어).
 *
 *  이 액션이 큐의 잠금을 푸는 유일한 방법이다: `<R>`은 존재하지 않는 dep을 기다리며 열린 채
 *  `select`에서 빠져 있고(결정 3), 그 파일이 생기는 순간 `deps_unmet`이 비어 다시 디스패치된다.
 *  사람이 누를 `다시 큐에` 버튼은 없다 — 답변 파일 생성이 그 버튼이다.
 *
 *  **답변 파일은 처음부터 `.done`으로 태어난다.** 열린 상태로 만들면 페르소나 없는 티켓이 되어
 *  아무 워커에게 디스패치된다. `<R>` 자체는 건드리지 않는다(`awaiting`도 지우지 않는다 — 이력이다).
 *
 *  `.wip`은 `isAwaiting`의 `state === "open"`이 구조적으로 막는다(제약 5). */
export async function answerRequirement(_prev: SaveState, form: FormData): Promise<SaveState> {
  const projectId = String(form.get("project") ?? "");
  const hash = String(form.get("hash") ?? "");
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);
    const file = await findTicket(project.root, hash, config);
    if (!file) throw new Error(`큐에 없는 티켓입니다: ${hash}`);

    // 화면을 그린 뒤 세션이 이 티켓을 잡았거나 다른 창이 이미 답했을 수 있다 — 판정을 다시 한다.
    const tickets = await listTickets(project.root, config);
    const nfc = (s: string) => s.normalize("NFC");
    const t = tickets.find((x) => nfc(x.path) === nfc(file));
    if (!t || !isAwaiting(t)) {
      throw new Error(
        "지금 이 티켓은 답변 대기가 아닙니다 — 이미 답변이 달렸거나 세션이 잡았습니다. 화면을 새로고침해 상태를 확인하세요.",
      );
    }

    const stem = awaitingOf(t);
    // PM 세션이 쓴 값이지만 여기서 파일명이 된다 — 신뢰 경계다(경로 구분자·제어문자·dotfile).
    if (!isHash(stem)) {
      throw new Error(
        `awaiting 값을 파일 이름으로 쓸 수 없습니다: ${stem}. 경로 구분자·제어문자가 없는 이름이어야 합니다 — 요구사항의 frontmatter를 고치세요.`,
      );
    }

    // **`O_EXCL`만으로는 부족하다**: 그건 `<A><done>.md`만 막는다. `<A>.md`가 열린 채로 있으면
    // `_find_stem`이 열린 쪽을 먼저 집어 답을 써도 unmet이 그대로다 = 영구 대기. 판정은 엔진과
    // 같은 조회(`tickets.py find` → `find_any`)로 한다 — 상태 무관하게 그 stem을 찾는다.
    const clash = await findTicket(project.root, stem, config);
    if (clash) {
      throw new Error(
        `${stem} 이름의 티켓이 이미 큐에 있습니다: ${path.basename(clash)}. 그 파일이 있는 한 답변 파일을 만들어도 엔진이 그쪽을 먼저 집어 요구사항이 영구 대기합니다. 그 파일을 확인해 정리하거나, PM에게 다른 awaiting 해시를 받으세요.`,
      );
    }

    // textarea는 CRLF로 온다(HTML 폼 규격).
    const answer = String(form.get("body") ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!answer) throw new Error("답변 내용을 입력하세요.");

    // 라운드 번호 = 이미 달린 답변 수 + 1. 질문 절 번호와 같은 수를 쓴다(§요구사항 왕복 스레드).
    const n =
      t.deps.filter((d) => resolveDep(tickets, d, config)?.kind === "answer").length + 1;

    // 경로를 문자열로 믿지 않는다 — 큐 디렉터리 안인지 확인하고 그 결과로 연다(§경로 방어).
    const answerPath = await resolveWithin(
      path.join(project.root, "tickets"),
      `${stem}${config.done}.md`,
    );
    const text = [
      "---",
      `ticket: ${stem}`,
      `title: 답변 — ${t.stem} #${n}`,
      "kind: answer",
      "---",
      "",
      `## 답변 ${n}`,
      "",
      answer,
      "",
    ].join("\n");

    // 여는 것 자체가 검사다(`wx`) — 위 검사와 생성 사이에 다른 창·세션이 끼어들 수 있다.
    const fh = await open(answerPath, "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `답변 파일이 이미 있습니다: ${path.basename(answerPath)}. 다른 창에서 방금 답했을 수 있습니다 — 새로고침해 스레드를 확인하세요.`,
        );
      }
      throw e;
    });
    try {
      await fh.writeFile(text, "utf8");
    } finally {
      await fh.close();
    }

    // §0-11 — 답변 파일이 실제로 쓰인 뒤다. 파라미터가 없다: 답변 본문도 해시도 안 간다.
    void track("answer_submit", {});

    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/p/${projectId}`); // 배지가 `deps 대기` → `대기`로 바뀐다 = 재큐의 증거
    // §4-5 — 답변 파일이 태어나 `<R>`의 deps가 충족됐다. 그 재큐를 cron이 아니라 지금 문다.
    await kickIdleWorker(project.root);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type DeleteResult = { ok: boolean; message?: string };

/** 삭제 — 파일을 지운다. **열린 티켓만** 지운다: `.wip`은 돌고 있는 세션의 티켓이 사라지면 완료
 *  신고도 못 하고, `.done`은 후행의 `deps`가 그 파일에 걸려 있다(사람 요청 `17e24fbc`, 답변
 *  `432f9c40`). 완료를 정리해야 하면 터미널에서 지운다 — 화면이 대신 눌러주지 않는다. */
export async function deleteTicket(projectId: string, hash: string): Promise<DeleteResult> {
  try {
    const t = await target(projectId, hash);
    if (t.state !== "open") {
      return { ok: false, message: DELETE_LOCKED[t.state] };
    }
    await unlink(t.path);
    revalidatePath(`/p/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
