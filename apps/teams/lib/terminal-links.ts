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

/** 버퍼 셀 하나 - xterm `IBufferCell`의 `getChars()` `getWidth()` 값이다. 전각 문자의 뒤 칸은
 *  폭 0, 빈 칸은 `chars`가 ""이고 폭 1이다. */
export type TerminalCell = { chars: string; width: number };

/** 셀 목록을 `translateToString`과 같은 문자열로 바꾼다(빈 칸은 공백, 폭 0 셀은 길이 0).
 *  `findTerminalLinks`에 넣는 문자열과 `linkCellRange`의 기준이 같은 값이 되게 하는 자리다. */
export function cellsToString(cells: TerminalCell[]): string {
  return cells.map((c) => (c.width === 0 ? "" : c.chars || " ")).join("");
}

/** 문자열 구간 `[start, start + length)`를 1-based 셀 열 범위로 바꾼다. `end`는 마지막 글자가
 *  놓인 셀의 열이고 전각이면 그 뒤 칸이다. `cells`는 `cellsToString`으로 문자열을 만든 그 목록. */
export function linkCellRange(
  cells: TerminalCell[],
  start: number,
  length: number,
): { start: number; end: number } {
  let idx = 0;
  let first = 0;
  let last = 0;
  for (let x = 0; x < cells.length; x++) {
    const c = cells[x];
    if (c.width === 0) continue;
    if (idx === start) first = x + 1;
    idx += (c.chars || " ").length;
    if (idx >= start + length) {
      last = x + c.width;
      break;
    }
  }
  return { start: first, end: last };
}
