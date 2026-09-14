/** 터미널 찾기 바가 쓰는 순수 로직 (P405-2 `0eaf0c50`, §7 §터미널만 엔진이 갈린다) — 데코레이션
 *  색 · `Ctrl+F` 억제 판정 · 건수 표기를 여기 둔다. React도 `@xterm/xterm`도 안 끌고 오는 순수
 *  함수라 `node --test`가 직접 부른다(`terminal-panel.tsx`는 `@xterm/xterm/css/xterm.css` import가
 *  있어 그 경로가 안 통한다 — `home-ui.test.ts`가 소스 글자를 대는 것과 같은 사정, 여긴 로직을
 *  꺼내 그 사정을 아예 없앤다). */

/** `@xterm/addon-search`의 `ISearchOptions["decorations"]`와 같은 모양 — 그 타입을 여기서
 *  다시 끌어오지 않는다(끌어오면 이 파일에 xterm 의존이 생겨 순수 함수로 두는 목적이 흐려진다). */
export type SearchDecorations = {
  matchBackground: string;
  activeMatchBackground: string;
  matchOverviewRuler: string;
  activeMatchColorOverviewRuler: string;
};

/** `--primary`가 지금 앉힌 값 둘(옅은 전체 강조 · 진한 현재 강조)로 데코레이션 넷을 채운다 —
 *  `find-bar.tsx`의 `CSS_RULES` 두 규칙과 같은 값이다(§7 §하이라이트도 ... `--primary` 계열을
 *  그대로 옮긴다). **`ISearchOptions["decorations"]`는 `#RRGGBB` 6자리만 받는다** - `oklch()`나
 *  `color-mix()`를 넘기면 애드온이 조용히 자기 기본 회색으로 물러난다(실측: 헤드리스 CDP로
 *  `Mod+f` 뒤 데코레이션 `<span>`의 `style`을 읽어 잡았다 - 예외도 없이 그냥 다른 색이 뜬다).
 *  그래서 두 값 다 **호출자가 이미 hex로 바꿔 넘긴다**(`terminal-panel.tsx`의 `toHex` - canvas로
 *  구우면 `oklch`·`lab`·`color-mix` 전부 브라우저가 대신 풀어 준다). 애드온에 글자색 자리가
 *  없어 DOM판의 `--primary-foreground`는 못 옮긴다 - ponytail: 배경만 갈린다, 애드온이 글자색을
 *  받으면 그때 더한다. */
export function searchDecorations(primaryHex: string, mutedHex: string): SearchDecorations {
  return {
    matchBackground: mutedHex,
    activeMatchBackground: primaryHex,
    matchOverviewRuler: primaryHex,
    activeMatchColorOverviewRuler: primaryHex,
  };
}

/** `Ctrl+F`(메타 아님)를 xterm이 못 삼키게 막을 키인가(§7 §`Ctrl+F`가 셸로 새면 안 된다) —
 *  리눅스 · 윈도우의 `Mod+f`는 `Ctrl+F`라, 이 판정이 참일 때 `attachCustomKeyEventHandler`가
 *  `false`를 돌려주면 xterm이 그 키를 아무 것도 안 하고(선택도 `onData`도 없다) 이벤트는 그대로
 *  버블링해 `keymap-provider.tsx`의 `window` 리스너가 받는다. 맥의 `⌘F`는 `ctrlKey`가 아니라
 *  이 자리를 안 거친다 — `metaKey` 배제가 그 구분이다. */
export function isShellBoundCtrlF(e: { type: string; ctrlKey: boolean; metaKey: boolean; key: string }): boolean {
  return e.type === "keydown" && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "f";
}

/** 건수 표기 — DOM판(`find-bar.tsx`)의 `${pos + 1}/${hits.length}` · `idle = hits.length === 0`과
 *  같은 계약이다(§30 ③ 빈칸 vs `0/0`). `resultIndex`가 `-1`인 것은 `highlightLimit`을 넘겨
 *  건수만 아는 경우라(애드온 문서) 1로 접는다 — 화면에 순번 없이 건수만 뜨는 것보다 낫다. */
export function resultLabel(
  query: string,
  result: { index: number; count: number } | null,
): { label: string; idle: boolean } {
  const count = result?.count ?? 0;
  if (query === "") return { label: "", idle: count === 0 };
  const idx = result && result.index >= 0 ? result.index + 1 : count > 0 ? 1 : 0;
  return { label: `${idx}/${count}`, idle: count === 0 };
}
