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

/** FAB 아이콘 키 (§P527). 주 액션이 있으면 그 `CreateAction`의 아이콘, 없으면 `plus`다. */
export function fabIconKey(surface: Surface): CreateAction | "plus" {
  return fabPlan(surface).primary ?? "plus";
}

/** §P551 결정 1 - 순번 k(1부터)가 부르는 것. 1은 FAB 자체(`primary`, 없으면 다이얼 펼치기),
 *  2부터 `dial[k-2]`다. 항목이 없으면 `null`이다. */
export type FabSlot = { kind: "fab"; primary: CreateAction | null } | { kind: "dial"; action: CreateAction };

export function fabSlot(surface: Surface, k: number): FabSlot | null {
  const { primary, dial } = fabPlan(surface);
  if (k === 1) return { kind: "fab", primary };
  const action = Number.isInteger(k) && k >= 2 ? dial[k - 2] : undefined;
  return action ? { kind: "dial", action } : null;
}

/** §P551 결정 2-3 - `⌘N` 코드 상태 전이. 상태는 `armed`(⌘을 쥔 채 N을 눌렀다) 하나뿐이다. */
export type ChordEvent = { type: "down" | "up"; key: string; mod: boolean; repeat: boolean };
export type ChordResult = {
  armed: boolean;
  /** 실행할 순번. `null`이면 실행 없음 */
  run: number | null;
  /** 참이면 호출자가 `preventDefault`/`stopPropagation`을 한다. 거짓이면 그 키는 원래대로 처리된다 */
  consume: boolean;
};

const isMod = (key: string) => key === "Meta" || key === "Control";

export function chordStep(armed: boolean, e: ChordEvent): ChordResult {
  const pass = (a: boolean): ChordResult => ({ armed: a, run: null, consume: false });
  if (!armed) {
    // 시작은 ⌘을 쥔 N 한 번뿐이다. 반복은 코드를 열지 않는다.
    if (e.type === "down" && e.mod && e.key.toLowerCase() === "n") {
      return { armed: !e.repeat, run: null, consume: true };
    }
    return pass(false);
  }
  if (e.type === "up") {
    // ⌘을 떼면 숫자 없이 끝난 것이다 -> 1번. 그 밖의 keyup은 코드와 상관없다.
    return isMod(e.key) ? { armed: false, run: 1, consume: false } : pass(true);
  }
  if (e.key.toLowerCase() === "n") return { armed: true, run: null, consume: true };
  if (/^[0-9]$/.test(e.key) && e.mod) return { armed: false, run: Number(e.key), consume: true };
  // 조합자만 눌린 것은 다른 키가 아니다. 그 밖의 키는 실행 없이 코드를 끝내고 원래대로 간다.
  return isMod(e.key) || e.key === "Shift" || e.key === "Alt" ? pass(true) : pass(false);
}
