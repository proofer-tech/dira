/** 홈 셸 우측 탭 줄의 순수 규칙 (DESIGN.md §11 결정 1 · §비주얼 §72 ②).
 *
 *  탭 목록의 정본은 `home-sessions.json`의 `tabs`/`activeTab`이고(§11 결정 2), 이 파일은 그
 *  목록에 적용되는 상한 · LRU 닫기 · 저장 안 한 탭 예외를 fs 없이 재는 순수 함수로 낸다 —
 *  `lib/home-session.ts`(fs를 타는 쪽)가 이 함수들을 부른다. */

import { t, DEFAULT_LOCALE, type Locale } from "./i18n.ts";

/** 탭 한 줄. `kind`는 `chat`·`terminal`·`file`이다 — 체크아웃은 P366-8이 늘린다.
 *  `unsaved`는 편집 중인 파일 탭이 상한 계산에서 빠지는 자리다(§11 수용조건). `file` 탭의
 *  `id`는 relPath라 `chat`·`terminal`의 uuid 관문(`home-session.ts parseHome`)을 안 탄다.
 *  `cwd`는 `terminal` 탭에만 있다(§11-1 결정 3 — 만든 뒤에는 안 갈린다). */
export type Tab = { id: string; kind: "chat" | "terminal" | "file"; lastViewed: string; unsaved?: true; cwd?: string };

/** §11 결정 1 — 탭 상한. 넘으면 가장 오래 안 본 탭이 닫힌다. */
export const TAB_LIMIT = 12;

/** 상한을 넘겨서 자동으로 닫을 후보 하나. **저장 안 한 탭은 후보에서 빠진다** — 후보가
 *  하나도 없으면(전부 저장 안 한 탭) `null`을 낸다. 그 자리는 부르는 쪽이 사람에게 물어본다
 *  (이 함수는 묻지 않는다 — 순수 함수라 화면도 다이얼로그도 모른다). */
export function evictionCandidate(tabs: Tab[]): Tab | null {
  if (tabs.length <= TAB_LIMIT) return null;
  const closable = tabs.filter((t) => !t.unsaved);
  if (closable.length === 0) return null;
  return closable.reduce((oldest, t) => (t.lastViewed < oldest.lastViewed ? t : oldest));
}

/** `chat` 탭 하나의 라벨(§비주얼 §72 ② §대화 탭의 이름, 요구 `ee5b04f1`) — 탭이 가리키는 좌측
 *  패널 줄을 `대화` · `워커 세션` · 회차 있는 `스케줄` 순서로 찾아 그 줄과 같은 문자열을 낸다.
 *  뒤 둘은 `conversations`에 줄이 없다(§7 — 결함이 아니라 설계). 셋에 다 없으면(§7 — `.wip`
 *  전부 + `.done` 10건 상한을 넘겨 `워커 세션` 목록에서 빠진 세션) `세션`이다 — 새 i18n 키가
 *  아니라 `sessionStream.session`을 인용한다(`home.surface.agent`는 표면 이름이라 안 쓴다).
 *  제목 없는 대화의 `새 대화`는 §11-8 결정 2가 정한 값을 인용만 한다(그 줄은 이 함수가 새로
 *  정하지 않는다). `title`은 `chat` 탭에만 물으므로 `terminal`·`file` 탭은 부르는 쪽이 따로 푼다.
 *  탭 id가 가리키는 스케줄 줄은 `session_id`로 찾는다 — 회차가 있는 스케줄을 고르면 탭이 그
 *  `session_id`를 연다(`home-ui.tsx` `onPickSchedule`), 스케줄의 `id` 자체가 아니다. */
export function chatTabTitle(
  id: string,
  conversations: { id: string; title: string }[],
  workers: { id: string; title: string }[],
  schedules: { session_id: string; prompt: string }[],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const conv = conversations.find((c) => c.id === id);
  if (conv) return conv.title || t(locale, "home.newConversation");
  const worker = workers.find((w) => w.id === id);
  if (worker) return worker.title;
  const sched = schedules.find((s) => s.session_id === id);
  if (sched) return sched.prompt.split("\n")[0] || sched.prompt;
  return t(locale, "sessionStream.session");
}

/** 탭을 열거나(이미 있으면) 지금 본 것으로 올린다. 상한을 넘기면 **방금 연 탭 자신은 후보에서
 *  빼고** `evictionCandidate`와 같은 규칙(저장 안 한 탭 제외 - 가장 오래 안 본 것)으로 하나를
 *  닫는다 — 안 빼면 막 연 탭이 그 자리에서 곧바로 닫히는 판이 된다(방금 열어 `lastViewed`가
 *  가장 크지만 저장 안 한 탭들 사이에서는 유일한 닫을 수 있는 후보가 되어 버린다).
 *  후보가 없으면(전부 저장 안 함) 상한을 그대로 넘긴 채 낸다 — 자동으로 안 닫는 것이 §11
 *  수용조건의 *저장 안 한 파일 탭은 안 닫는다*다. */
export function openTab(tabs: Tab[], id: string, kind: Tab["kind"], now: string, cwd?: string): Tab[] {
  const next = tabs.some((t) => t.id === id)
    ? tabs.map((t) => (t.id === id ? { ...t, lastViewed: now } : t))
    : [...tabs, { id, kind, lastViewed: now, ...(cwd ? { cwd } : {}) }];
  if (next.length <= TAB_LIMIT) return next;
  const closable = next.filter((t) => !t.unsaved && t.id !== id);
  if (closable.length === 0) return next;
  const victim = closable.reduce((oldest, t) => (t.lastViewed < oldest.lastViewed ? t : oldest));
  return next.filter((t) => t.id !== victim.id);
}

/** 탭 하나를 닫는다 — 열려 있던 항목(예: 대화)이 지워지는 것이 아니라 **목록에서만** 빠진다. */
export function closeTab(tabs: Tab[], id: string): Tab[] {
  return tabs.filter((t) => t.id !== id);
}

/** 남은 탭 중 가장 최근 본 것의 id. 닫은 탭이 `activeTab`이었을 때 다음 활성 탭을 고르는 자리 —
 *  없으면 `null`이다. */
export function mostRecentTab(tabs: Tab[]): string | null {
  if (tabs.length === 0) return null;
  return tabs.reduce((a, b) => (a.lastViewed > b.lastViewed ? a : b)).id;
}

/** 우클릭한 `id` 기준으로 한쪽(`side`)에 그려진 탭들의 id — `home.tabs` 배열 순서가 좌우
 *  기준이다(§11-7 결정 2). 우클릭한 탭 자신과 `unsaved` 파일 탭은 어느 쪽 결과에도 안 든다
 *  (§11-7 결정 3 — 모두 닫기가 저장 안 한 탭은 건너뛴다). */
export function tabsOnSide(tabs: Tab[], id: string, side: "left" | "right"): string[] {
  const at = tabs.findIndex((t) => t.id === id);
  if (at === -1) return [];
  const slice = side === "left" ? tabs.slice(0, at) : tabs.slice(at + 1);
  return slice.filter((t) => !t.unsaved).map((t) => t.id);
}

/** 우클릭한 `id` 하나만 남기고 닫을 id 목록 — 좌우 합집합이다(§11-7 §개정). `tabsOnSide`가 이미
 *  우클릭한 탭 자신과 `unsaved` 탭을 뺀 목록을 내므로 그 결과를 양쪽에서 이어 붙인 것과 같다. */
export function tabsToCloseOthers(tabs: Tab[], id: string): string[] {
  return [...tabsOnSide(tabs, id, "left"), ...tabsOnSide(tabs, id, "right")];
}
