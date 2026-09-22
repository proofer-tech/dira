/** 터미널 줄에서 가로챌 URL을 찾는 순수 함수 (DESIGN.md §11-15 결정 3) —
 *  `terminal-panel.tsx`의 `registerLinkProvider`가 이 값으로 `ILink` 범위를 만든다. 정규식만
 *  여기 두는 이유는 그 파일이 JSX라 `pnpm test`의 직접 대상이 아니라서다(`terminal-search.ts`와
 *  같은 축 — 순수 로직과 xterm 배선을 가른다).
 *
 *  스킴은 `http` · `https`만 잡는다(결정 3 — 앱 창 클릭 리스너와 같은 경계). 꼬리의 구두점
 *  (`.` `,` `)` 등)은 URL이 아니라 문장 부호일 확률이 높아 떼어낸다 — 흔한 링크 감지 관용구고
 *  `@xterm/addon-web-links`도 같은 문제를 겪는다. */
export const TERMINAL_LINK_REGEX = /https?:\/\/[^\s<>"']+/g;

/** 줄 하나에서 찾은 링크 한 개 — `start`는 0-based 문자 인덱스, `text`는 꼬리 구두점을 뗀
 *  URL이다. */
export type TerminalLinkMatch = { start: number; text: string };

export function findTerminalLinks(line: string): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];
  for (const m of line.matchAll(TERMINAL_LINK_REGEX)) {
    const start = m.index ?? 0;
    const trimmed = m[0].replace(/[),.;:!?]+$/, "");
    if (trimmed) matches.push({ start, text: trimmed });
  }
  return matches;
}
