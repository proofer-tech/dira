/** 새 프로젝트가 페르소나 색을 갖고 태어나는 자리 (DESIGN.md §새 프로젝트의 페르소나가
 *  색을 갖고 태어난다, 결정 2) - 이름에서 유도하지 않고 뽑아서 저장한다.
 *
 *  이름 목록을 `PERSONA_COLORS`(8색)로 채운다. 한 목록 안에서는 서로 다른 색을 주고, 이름이
 *  여덟을 넘으면 그때부터 팔레트를 다시 돌려 쓴다. */
import { PERSONA_COLORS } from "./urls.ts";

export function assignPersonaColors(names: string[]): Record<string, string> {
  const palette = [...PERSONA_COLORS];
  for (let i = palette.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  const colors: Record<string, string> = {};
  names.forEach((name, i) => {
    colors[name] = palette[i % palette.length];
  });
  return colors;
}
