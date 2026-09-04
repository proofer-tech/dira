/** 홈 셸 우측 탭 줄의 순수 규칙 (DESIGN.md §11 결정 1 · §비주얼 §72 ②).
 *
 *  탭 목록의 정본은 `home-sessions.json`의 `tabs`/`activeTab`이고(§11 결정 2), 이 파일은 그
 *  목록에 적용되는 상한 · LRU 닫기 · 저장 안 한 탭 예외를 fs 없이 재는 순수 함수로 낸다 —
 *  `lib/home-agent.ts`(fs를 타는 쪽)가 이 함수들을 부른다. */

/** 탭 한 줄. `kind`는 `chat`·`terminal`이다 — 파일·체크아웃은 P366-6·8이 늘린다.
 *  `unsaved`는 편집 중인 파일 탭이 상한 계산에서 빠지는 자리다(§11 수용조건).
 *  `cwd`는 `terminal` 탭에만 있다(§11-1 결정 3 — 만든 뒤에는 안 갈린다). */
export type Tab = { id: string; kind: "chat" | "terminal"; lastViewed: string; unsaved?: true; cwd?: string };

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
