"use server";

/** 홈 대화의 서버 액션 셋 — 묻기 · 폴링 · 새 대화 (DESIGN.md §7 · §비주얼 §24).
 *
 *  **큐 파일을 하나도 안 건드린다.** 다른 화면의 `actions.ts`가 티켓·워커·프로토콜 파일을 쓰는
 *  자리인 것과 반대다(§7 — 질문이 티켓으로 들어가지 않고 답이 티켓으로 나오지 않는다).
 *  여기서 나가는 쓰기는 `$TICKET_LOCAL/home-sessions.json`의 **대화 목록**뿐이다(§대화가 여럿이다).
 *
 *  판정과 실행은 전부 `lib/home-session.ts`다 — 이 파일은 프로젝트 검증 + 위임이 전부다
 *  (`sendInterject`가 `lib/interject.ts`에 대해 갖는 관계와 같다).
 *
 *  **`revalidatePath`를 부르지 않는다.** 대화의 출처는 트랜스크립트 파일이고 그건 Next 캐시가
 *  모르는 것이라 폴링이 직접 읽는다. 티켓도 레지스트리도 안 바뀌므로 다시 그릴 화면이 없다. */
import path from "node:path";
import { verifyAttachments, withAttachments } from "@/lib/attachments";
import { listEpics, refreshKnownRefs } from "@/lib/epics";
import {
  findByContent,
  findByName,
  listExplorerDir,
  openExplorerFile,
  saveExplorerFile,
  type ExplorerFile,
  type ExplorerListing,
  type FindContentResult,
  type FindNameResult,
  type SaveResult,
} from "@/lib/explorer";
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";
import type { RefIndex } from "@/lib/markdown-refs";
import { openWithinApp, type OpenResult } from "@/lib/paths";
import { listTickets } from "@/lib/queue";
import {
  closeHomeTab,
  createSchedule as createScheduleRow,
  deleteSchedule as deleteScheduleRow,
  focusTab as focusHomeTab,
  newConversation,
  openFileTab,
  openTerminalTab,
  pollHome,
  readScheduleViews,
  readSessionId,
  setFileTabUnsaved,
  startAsk,
  stopAsk,
  switchConversation,
  type Answer,
  type HomeChunk,
  type ScheduleView,
} from "@/lib/home-session";
import { explorerRoot, getProject, resolveConfig, type Project } from "@/lib/projects";
import { killPty, openPty, ptyStatuses, restartPty, type PtyStatus } from "@/lib/pty";
import {
  commitStaged,
  listCheckouts,
  listRemoteBranches,
  pullCheckout,
  pushCheckout,
  readStatus,
  resolveCheckout,
  setUpstream,
  stageAll,
  stageFile,
  unstageFile,
  type Checkout,
  type GitStatus,
} from "@/lib/source-control";

/** 등록된 프로젝트인가. **클라이언트가 준 id는 신뢰 경계 밖이다** — 여기서 걸러야 등록 안 된
 *  값이 `home-sessions.json`의 키가 되지 않는다(경로가 되는 값은 그 파일의 **값**이고 그쪽
 *  관문은 `sessionIdOf` 하나다 — §7). */
async function required(projectId: string, locale: Locale = DEFAULT_LOCALE) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`${t(locale, "home.action.unknownProjectPrefix")} ${projectId}`);
  return project;
}

/** 질문 하나를 띄운다. 돌려주는 것은 **실패뿐**이고(`null` = 시작했다) 답의 도착은 폴링이 알려 준다.
 *  이미 도는 질문이 있으면 `busy`로 거절한다(§24 실패 ④) — 기다리게 하지 않는다. */
export async function askHome(
  projectId: string,
  question: string,
  /** 첨부(§8) — 화면이 이미 올려 둔 **경로**만 온다(바이트는 이 액션을 안 지난다). 돌아온 경로가
   *  `attachments/` 아래인지는 서버가 다시 본다(신뢰 경계). 조립은 `withAttachments` 하나이고,
   *  그 경로는 홈 세션 cwd(`dirname(root)`) 아래라 `Read`가 그대로 연다(§7 · §8 표). */
  attachments: string[] = [],
  locale: Locale = DEFAULT_LOCALE,
): Promise<Answer | null> {
  try {
    const project = await required(projectId, locale);
    const attached = await verifyAttachments(project, attachments);
    return await startAsk(project, withAttachments(question, attached), locale);
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
      schedules: [], // 〃 — 스케줄도 같은 파일에서 파생된다(§7-2)
      tabs: [], // 〃 — 탭 목록도 같은 파일에서 온다(§11 결정 2)
      activeTab: null,
      turns: [],
      offset: 0,
      reset: true,
      running: false,
      runningSessions: [], // 못 찾은 프로젝트에서 도는 것은 없다(§7 §대화마다 따로 돈다)
      partial: "",
      activity: null, // 못 찾은 프로젝트에는 볼 활동도 없다
      stopped: false,
      failed: null,
      answered: false, // 집어 갈 실행층이 없다 — 여기는 프로젝트 자체를 못 찾은 자리다
      refs: { tickets: {}, epics: {} }, // 〃 — 훑을 글도 없다
      // **여기만 `done`을 손으로 참으로 준다**(`pollDone`은 이걸 거짓이라 볼 것이다 — 답이
      // 안 왔으니까). 저 판정이 기다리는 것은 *도는 답*이고 여기는 물러난 자리라 기다릴 답이
      // 없다. 참을 안 주면 화면이 있지도 않은 프로젝트를 5분 동안 다시 묻는다(머리 주석).
      done: true,
    };
  }
}

/** 이미 그려진 표식이 큐가 갈린 회차에 값을 다시 받는 자리(DESIGN.md §아키텍처 §이른 갱신이
 *  붙는 화면 §개정 4, 요구 `de0b759d`). 홈은 답이 도는 동안만 폴링하지만(머리말) 표식은
 *  트랜스크립트가 아니라 큐가 근거라 대화가 쉬는 동안에도 따라가야 한다 — `tickets/[hash]`
 *  화면의 같은 이름 액션과 로직은 한 벌(`lib/epics.ts refreshKnownRefs`)이고 여기서 다시 안 짓는다. */
export async function refreshRefs(
  projectId: string,
  known: { tickets: string[]; epics: string[] },
): Promise<RefIndex> {
  if (!known.tickets.length && !known.epics.length) return { tickets: {}, epics: {} };
  try {
    const project = await required(projectId);
    const config = await resolveConfig(project);
    const tickets = await listTickets(project.root, config);
    const epics = await listEpics(project.root, tickets);
    return refreshKnownRefs(project.root, projectId, tickets, epics, known.tickets, known.epics);
  } catch {
    return { tickets: {}, epics: {} };
  }
}

/** `중지`(§7 §도는 답을 멈춘다) — 도는 자식에 `SIGTERM`. **답이 사라지지 않는다**: 받은 데까지가
 *  트랜스크립트에 남고 다음 질문은 같은 대화에 `--resume`으로 이어진다(실측 ⑵⑶).
 *  돌려주는 것은 죽일 것이 있었나이고, 상태가 화면에 붙는 것은 그 다음 폴링의 `stopped`다.
 *
 *  **멈추는 것은 지금 보는 대화 하나다**(§7 §대화마다 따로 돈다 — 대화마다 따로 돌므로 프로젝트
 *  단위로 죽이면 남의 대화까지 밟는다). 그 대화가 곧 `current`라 화면이 값을 안 들고 온다 —
 *  버튼은 보는 대화에만 뜨고, 남의 대화를 멈추는 버튼은 안 만든다(가서 누른다). */
export async function stopHome(projectId: string): Promise<boolean> {
  try {
    const sid = await readSessionId((await required(projectId)).id);
    return sid ? stopAsk(sid) : false;
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
 *  이 응답 하나로 갈아 끼운다. 새 대화에는 트랜스크립트가 아직 없으므로 `turns`가 0건이다.
 *
 *  **페르소나 선택도 이 길을 탄다**(§7-4 결정 2). 사람이 `새 대화`를 누르면 기본값 그대로 열리고,
 *  아직 잠기지 않은(턴 0건) 빈 대화에서 셀렉트가 값을 바꾸면 이 함수를 다시 불러 같은 줄의
 *  페르소나만 갈아 끼운다 — `newConversation`이 두 경우를 한 판정으로 묶는다. */
export async function clearHome(projectId: string, persona?: string): Promise<HomeChunk> {
  await newConversation((await required(projectId)).id, persona);
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

/** 우측 탭 줄에서 탭 하나를 닫는다(§11 결정 1). **`switchHome`과 같은 모양이다** — 닫은 뒤
 *  남는 `current`(닫은 탭이 활성이었으면 그다음 탭으로 넘어간 값)를 이 폴링 한 번으로 화면에
 *  돌려준다. `tabId`도 `sessionId`와 같은 신뢰 경계 밖 값이라 관문은 `closeHomeTab` 안의
 *  `sessionIdOf`(파일 읽기 쪽 `parseHome`) 하나다 — 실재 안 하는 값은 조용히 무시된다. */
export async function closeTab(projectId: string, tabId: string): Promise<HomeChunk> {
  try {
    await closeHomeTab((await required(projectId)).id, tabId);
  } catch {
    // 등록이 풀린 프로젝트 — 위 switchHome과 같은 물러남
  }
  return pollHomeAnswer(projectId, null, 0);
}

// ── 터미널 표면 (§11-1, P366-4) ──────────────────────────────────────────────
//
// cwd 후보는 소스 컨트롤과 같은 목록이다(§11-1 결정 3 — "§11-3의 그 목록과 같다") — 새 액션을
// 안 늘리고 위 `scmCheckouts`를 그대로 재사용한다. pty 자체(`lib/pty.ts`)는 파일이 아니라
// 서버 메모리라 여기 세 함수가 하는 일은 그 모듈을 부르고 탭 목록(`home-sessions.json`)을
// 맞추는 것뿐이다 — 입출력은 스트리밍이 필요해 `home/pty/[id]/route.ts`가 대신 진다.

/** `새 터미널` — cwd는 `scmCheckouts`가 낸 체크아웃 하나의 절대경로여야 한다(신뢰 경계:
 *  클라이언트가 고른 값이 임의 경로면 그 디렉터리에서 셸이 뜬다 — `resolveWithin`과 같은 이유로
 *  등록된 체크아웃 목록에 있는 값인지 여기서 다시 잰다). 셸은 사람의 `$SHELL`, 없으면 `/bin/sh`
 *  (§11-1 결정 3 — 우리가 고르지 않는다). */
export async function openTerminal(
  projectId: string,
  cwd: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<HomeChunk | { error: string }> {
  try {
    const project = await required(projectId, locale);
    const checkouts = await listCheckouts(repoOf(project.root));
    if (!checkouts.some((c) => c.path === cwd)) return { error: t(locale, "terminal.invalidCwd") };
    const spawned = openPty(cwd, process.env.SHELL || "/bin/sh");
    if ("error" in spawned) return { error: t(locale, "terminal.limitReached") };
    await openTerminalTab(project.id, spawned.id, cwd);
    return pollHomeAnswer(projectId, null, 0);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** `끊긴` 터미널 탭의 `다시 열기`(§11 결정 2) — **죽은 pty를 되살리는 재접속을 안 만든다**:
 *  남아 있어도 먼저 죽이고 같은 탭 자리에 새 pty를 심는다. `cwd`는 그 탭이 이미 가진 값
 *  그대로 화면이 들고 온다(만든 뒤 안 갈리므로 여기서 다시 검증할 신뢰 경계가 아니다 —
 *  `home-sessions.json`에 그 값을 쓴 것은 위 `openTerminal`이 이미 검증한 뒤였다). */
export async function restartTerminal(
  projectId: string,
  tabId: string,
  cwd: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<HomeChunk | { error: string }> {
  try {
    await required(projectId, locale);
    const spawned = restartPty(tabId, cwd, process.env.SHELL || "/bin/sh");
    if ("error" in spawned) return { error: t(locale, "terminal.limitReached") };
    return pollHomeAnswer(projectId, null, 0);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 탭 줄에서 탭 하나로 포커스만 옮긴다 — `switchHome`과 달리 `current`(대화 스레드)도 새 탭도
 *  안 만든다. 터미널 표면 안의 탭 전환과, 표면을 가로지르는 우측 탭 줄에서 터미널·파일 탭을
 *  누르는 것 둘 다 이 액션 하나를 쓴다(`chat` 탭은 스레드도 같이 옮겨야 해서 `switchHome`이다).
 *  `tabId`가 `null`이면 표식을 비운다(§11-9 결정 3 — `tabForSurface`가 갈 탭을 못 고른 경우). */
export async function focusTabAction(projectId: string, tabId: string | null): Promise<HomeChunk> {
  try {
    await focusHomeTab((await required(projectId)).id, tabId);
  } catch {
    // 등록이 풀린 프로젝트 — 위 switchHome과 같은 물러남
  }
  return pollHomeAnswer(projectId, null, 0);
}

/** 터미널 탭을 닫는다 — pty를 `SIGTERM`으로 죽이고(§11-1 결정 4) 탭 목록에서 뺀다.
 *  파일 쪽 처리는 `chat`과 같은 함수(`closeTab`)를 그대로 쓴다 — 두 벌로 안 적는다. */
export async function closeTerminalTab(projectId: string, tabId: string): Promise<HomeChunk> {
  killPty(tabId);
  return closeTab(projectId, tabId);
}

/** 좌측 목록의 마지막 명령 - 작업중 - 끊김(§11-6 결정 3 · 4) — `터미널` 표면이 열려 있는 동안
 *  5초마다 부른다. `lib/pty.ts`가 `ps`를 한 번만 불러 `ids` 전부를 같이 판정한다. */
export async function terminalStatuses(projectId: string, ids: string[]): Promise<Record<string, PtyStatus>> {
  try {
    await required(projectId);
  } catch {
    return {};
  }
  return ptyStatuses(ids);
}

/** `새 스케줄` 다이얼로그의 `만들기`(§비주얼 §62 (5)). **대화·스레드는 안 건드린다** — 그래서
 *  `pollHomeAnswer`(전체 재폴링)를 안 쓰고 최신 스케줄 목록만 돌려준다: 그걸 쓰면 `sessionId`가
 *  `null`로 강제되어 지금 보던 대화·워커 세션이 튄다(§24 로딩 항이 막으려는 그 점프).
 *  실패(빈 문장·못 읽는 `when`)는 `ok: false`로 낸다 — `epic-sidebar-create.tsx`의 `Failure`와
 *  같은 모양이다. */
export async function createSchedule(
  projectId: string,
  when: string,
  prompt: string,
  locale: Locale = DEFAULT_LOCALE,
  persona?: string,
): Promise<{ ok: true; schedules: ScheduleView[] } | { ok: false; error: string }> {
  try {
    const project = await required(projectId, locale);
    const row = await createScheduleRow(project.id, when, prompt, persona);
    if (!row) return { ok: false, error: t(locale, "home.schedule.invalidWhenOrPrompt") };
    return { ok: true, schedules: await readScheduleViews(project.id) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** `스케줄 삭제`(§비주얼 §62 (4)) — 위와 같은 이유로 스케줄 목록만 돌려준다. `alert-dialog`
 *  확인을 이미 거친 뒤라 실패해도 조용히 물러난다(지울 것이 이미 없으면 그것도 성공과 같다). */
export async function deleteSchedule(projectId: string, id: string): Promise<ScheduleView[]> {
  try {
    const project = await required(projectId);
    await deleteScheduleRow(project.id, id);
    return await readScheduleViews(project.id);
  } catch {
    return [];
  }
}

/** 소스 컨트롤 표면(§11-3). **`repo`는 `project.root`가 아니라 그 부모다** — `root`는
 *  `<프로젝트>/.dira`이고 워크트리는 `<root>/worktrees/<이름>`에 있으므로, `git`이 알아야
 *  하는 프로젝트 루트는 그 부모 디렉터리다(`lib/workers.ts`의 `prepareWorktree`와 같은 계산). */
function repoOf(root: string): string {
  return path.dirname(root);
}

/** 체크아웃 목록(§11-3 결정 1) — 표면을 열 때와 `다시 읽기`를 누를 때만 부른다(§11 결정 4).
 *  못 읽는 프로젝트는 빈 배열로 물러난다 — 폴링 화면들과 같은 물러남 규칙이다. */
export async function scmCheckouts(projectId: string): Promise<Checkout[]> {
  try {
    return await listCheckouts(repoOf((await required(projectId)).root));
  } catch {
    return [];
  }
}

/** `checkoutId`가 신뢰 경계 밖 값이다(클라이언트가 고른 목록 줄) — `resolveCheckout`이 그 값을
 *  실재하는 체크아웃의 절대경로로 바꾼 뒤에만 그 경로에서 git을 부른다. 없으면 `null`. */
export async function scmStatus(projectId: string, checkoutId: string): Promise<GitStatus | null> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    return checkout ? await readStatus(checkout.path) : null;
  } catch {
    return null;
  }
}

/** 파일 하나를 스테이지 - 해제한다(§11-3 결정 2). 성공 여부와 무관하게 최신 status를 다시
 *  읽어 낸다 — 화면이 그 값 하나로 목록을 갈아 끼운다(폴링 응답들과 같은 왕복 한 벌). */
export async function scmStage(projectId: string, checkoutId: string, filePath: string): Promise<GitStatus | null> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return null;
    await stageFile(checkout.path, filePath);
    return await readStatus(checkout.path);
  } catch {
    return null;
  }
}

export async function scmUnstage(
  projectId: string,
  checkoutId: string,
  filePath: string,
): Promise<GitStatus | null> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return null;
    await unstageFile(checkout.path, filePath);
    return await readStatus(checkout.path);
  } catch {
    return null;
  }
}

export async function scmStageAll(projectId: string, checkoutId: string): Promise<GitStatus | null> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return null;
    await stageAll(checkout.path);
    return await readStatus(checkout.path);
  } catch {
    return null;
  }
}

/** 업스트림 후보(§11-3 결정 3) — 셀렉트가 고를 목록. */
export async function scmRemoteBranches(projectId: string, checkoutId: string): Promise<string[]> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    return checkout ? await listRemoteBranches(checkout.path) : [];
  } catch {
    return [];
  }
}

/** 업스트림을 바꾼다. `setUpstream`이 `branch`를 그 체크아웃의 원격 추적 브랜치 목록에서 다시
 *  확인한다 — 화면이 준 값을 그대로 믿지 않는다(신뢰 경계). */
export async function scmSetUpstream(
  projectId: string,
  checkoutId: string,
  branch: string,
): Promise<GitStatus | null> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return null;
    await setUpstream(checkout.path, branch);
    return await readStatus(checkout.path);
  } catch {
    return null;
  }
}

/** 커밋 - push - pull 셋의 공통 응답 모양(§11-3 결정 4) — `status`는 실행 직후 다시 읽은 값
 *  (성공이든 실패든, 화면이 항상 최신을 본다), `error`는 실패 사유 그대로다(git 자신의 문구 —
 *  화면이 다시 번역하지 않는다). `NO_PUSH_SH`만 예외 — 사유가 아니라 sentinel이라 화면이
 *  자기 낱말로 보여준다(아래 `scmPush`). */
export type ScmResult = { status: GitStatus | null; error: string | null };

/** 커밋(§11-3 결정 4) — 스테이지된 것만, 트레일러 없이 `-m` 하나. 빈 메시지는 git에 보내지
 *  않는다(git도 거절하지만 그 사유는 영문이라 여기서 먼저 거른다). */
export async function scmCommit(projectId: string, checkoutId: string, message: string): Promise<ScmResult> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return { status: null, error: null };
    const trimmed = message.trim();
    if (!trimmed) return { status: await readStatus(checkout.path), error: "EMPTY_MESSAGE" };
    const r = await commitStaged(checkout.path, trimmed);
    return { status: await readStatus(checkout.path), error: r.error };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  }
}

/** push(§11-3 결정 4) — `checkout.isRoot`가 향하는 곳을 가른다(루트 `origin` - 워크트리
 *  통합 브랜치). `pushCheckout`이 `Checkout` 전체를 받는 이유는 `pushSh` 판정이 그 안에 이미
 *  있어서다 — 여기서 파일 존재를 다시 안 본다. */
export async function scmPush(projectId: string, checkoutId: string): Promise<ScmResult> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return { status: null, error: null };
    const r = await pushCheckout(checkout);
    return { status: await readStatus(checkout.path), error: r.error };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  }
}

/** pull(§11-3 결정 4) — `--ff-only` 하나, 실패 사유를 그대로 낸다. */
export async function scmPull(projectId: string, checkoutId: string): Promise<ScmResult> {
  try {
    const project = await required(projectId);
    const checkout = await resolveCheckout(repoOf(project.root), checkoutId);
    if (!checkout) return { status: null, error: null };
    const r = await pullCheckout(checkout.path);
    return { status: await readStatus(checkout.path), error: r.error };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  }
}

// ── 탐색기 · 편집기(§11-2 결정 1 · 2 · 4, P366-6) ──────────────────────────
//
// 뿌리는 `resolveConfig(project).cwd`(§11 결정 3 — 프로젝트 루트, 기본값 `dirname(project.root)`).
// 판정은 전부 `lib/explorer.ts`다 — 이 파일이 하는 일은 위 액션들과 같은 분담(프로젝트 id →
// 해석된 디렉터리, Error를 직렬화 가능한 결과로).

/** `.md` 리다이렉트 대상 디렉터리 셋 — 티켓은 `<project.root>/tickets`(`lib/queue.ts`와 같은
 *  조립), 페르소나 · 프로토콜은 `resolveConfig`가 해석한 값이다. */
async function explorerDirs(project: Project) {
  const config = await resolveConfig(project);
  return {
    cwd: explorerRoot(project),
    ticketsDir: path.join(project.root, "tickets"),
    personasDir: config.personas,
    protocolsDir: config.protocols,
  };
}

export async function listExplorerDirAction(
  projectId: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ExplorerListing> {
  try {
    const { cwd } = await explorerDirs(await required(projectId, locale));
    return await listExplorerDir(cwd, rel, locale);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export async function openExplorerFileAction(
  projectId: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ExplorerFile> {
  try {
    const { cwd, ticketsDir, personasDir, protocolsDir } = await explorerDirs(await required(projectId, locale));
    return await openExplorerFile(cwd, rel, { projectId, ticketsDir, personasDir, protocolsDir }, locale);
  } catch (e) {
    return { kind: "unreadable", reason: (e as Error).message };
  }
}

/** 파일을 열면 표면을 가로지르는 우측 탭 줄에도 탭 하나가 선다(§11 결정 1, P366-6). 내용을
 *  받아 오는 `openExplorerFileAction`과 별개다 — 저건 fs 한 번, 이건 `home-sessions.json` 한 번
 *  (`openTerminal`이 pty 열기와 탭 붙이기를 나누는 것과 같은 결이다). */
export async function openExplorerFileTab(projectId: string, relPath: string): Promise<HomeChunk> {
  try {
    await openFileTab((await required(projectId)).id, relPath);
  } catch {
    // 등록이 풀린 프로젝트 — 위 switchHome과 같은 물러남
  }
  return pollHomeAnswer(projectId, null, 0);
}

/** 편집기의 깨끗함 <-> 더러움 전환에서만 부른다(§11 수용조건 4) — `CodeEditor`의 `dirty` 값이
 *  갈릴 때 그 탭의 `unsaved`를 싣는다. 타이핑마다가 아니다(`lib/home-session.ts setFileTabUnsaved`
 *  머리 주석과 같은 경계). */
export async function setExplorerTabUnsaved(projectId: string, relPath: string, unsaved: boolean): Promise<HomeChunk> {
  try {
    await setFileTabUnsaved((await required(projectId)).id, relPath, unsaved);
  } catch {
    // 등록이 풀린 프로젝트 — 위 switchHome과 같은 물러남
  }
  return pollHomeAnswer(projectId, null, 0);
}

export async function saveExplorerFileAction(
  projectId: string,
  rel: string,
  text: string,
  expectedMtimeMs: number,
  expectedSize: number,
  locale: Locale = DEFAULT_LOCALE,
): Promise<SaveResult> {
  try {
    const { cwd, ticketsDir } = await explorerDirs(await required(projectId, locale));
    return await saveExplorerFile(cwd, rel, text, expectedMtimeMs, expectedSize, ticketsDir, locale);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** 이름 찾기(§11-2 결정 3) — 트리 위 칸이 치는 쪽지 매 글자마다 이 액션을 부른다. */
export async function findByNameAction(
  projectId: string,
  query: string,
  includeWorktrees: boolean,
  locale: Locale = DEFAULT_LOCALE,
): Promise<FindNameResult> {
  try {
    const { cwd } = await explorerDirs(await required(projectId, locale));
    return await findByName(cwd, query, includeWorktrees);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** 내용 찾기(§11-2 결정 3) — 별 탭에서 찾기를 누를 때만 이 액션을 부른다(§11 결정 4 — 폴링에
 *  안 든다). */
export async function findByContentAction(
  projectId: string,
  query: string,
  includeWorktrees: boolean,
  locale: Locale = DEFAULT_LOCALE,
): Promise<FindContentResult> {
  try {
    const { cwd } = await explorerDirs(await required(projectId, locale));
    return await findByContent(cwd, query, includeWorktrees);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** "바깥 앱으로 열기"(§11-2 결정 2 · §10 §자리 다섯 — `protocols/actions.ts openProtocolFileAction`과
 *  같은 모양). 1MB 넘는 파일 · 바이너리에서 뜨는 버튼 하나가 이 액션을 부른다. */
export async function openExplorerFileExternallyAction(
  projectId: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<OpenResult> {
  try {
    const { cwd } = await explorerDirs(await required(projectId, locale));
    return await openWithinApp(cwd, rel, locale);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
