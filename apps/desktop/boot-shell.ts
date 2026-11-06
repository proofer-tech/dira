// 서버보다 먼저 뜨는 스켈레톤 창의 입력을 만든다(P549 결정 5). electron 없이 테스트하도록 경로를 받는다.
import { readFileSync } from "node:fs";

/** 셸 HTML이 쓰는 배경과 같은 값이다(`public/boot-shell.html` `html.dark`). 창 `backgroundColor`가
 *  이 값이어야 셸이 그려지기 전 프레임도 같은 색이다. */
export const BG_LIGHT = "#ffffff";
export const BG_DARK = "#0a0a0a";

/** `userData/layout.json`(P549 결정 4)을 읽는다. 없거나 깨지면 기본(라이트, 펼친 사이드바)이다.
 *  `query`는 셸에 `?l=`로 넘길 JSON 문자열이다 - 셸이 모르는 키는 무시하고 값 검증도 셸이 한다. */
export function readBootLayout(file: string): { background: string; query: string } {
  let l: { theme?: unknown } = {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) l = v;
  } catch { /* 없거나 깨짐 -> 기본 */ }
  return { background: l.theme === "dark" ? BG_DARK : BG_LIGHT, query: JSON.stringify(l) };
}
