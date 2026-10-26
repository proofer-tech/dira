/** 홈 우측 아래 FAB의 표면별 규칙 (DESIGN.md §P526 결정 3-5). 순수 함수 하나다 -
 *  어떤 표면에서 무엇이 주 액션이고 다이얼에 무엇이 펼쳐지는지만 정한다. */
import type { Surface } from "./tabs.ts";

/** 새로 만들기 넷. 값은 그 액션이 속한 표면이다. */
export type CreateAction = "session" | "schedules" | "terminal" | "browser";

/** 다이얼 순서 = `SURFACES` 순서(FAB에서 가까운 쪽부터). */
const ORDER: CreateAction[] = ["session", "schedules", "terminal", "browser"];

/** 주 액션이 `null`이면(`scm` - `explorer`) 누르면 다이얼이 펼친다. 다이얼은 주 액션을 뺀 나머지다. */
export function fabPlan(surface: Surface): { primary: CreateAction | null; dial: CreateAction[] } {
  const primary = ORDER.find((a) => a === surface) ?? null;
  return { primary, dial: ORDER.filter((a) => a !== primary) };
}
