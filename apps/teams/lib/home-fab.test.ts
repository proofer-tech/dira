import { test } from "node:test";
import assert from "node:assert";
import { fabIconKey, fabPlan } from "./home-fab.ts";
import type { Surface } from "./tabs.ts";

test("fabPlan - 표면 여섯의 주 액션과 다이얼", () => {
  const cases: [Surface, string | null, string[]][] = [
    ["session", "session", ["schedules", "terminal", "browser"]],
    ["schedules", "schedules", ["session", "terminal", "browser"]],
    ["terminal", "terminal", ["session", "schedules", "browser"]],
    ["browser", "browser", ["session", "schedules", "terminal"]],
    ["scm", null, ["session", "schedules", "terminal", "browser"]],
    ["explorer", null, ["session", "schedules", "terminal", "browser"]],
  ];
  for (const [s, primary, dial] of cases) {
    assert.deepStrictEqual(fabPlan(s), { primary, dial }, s);
  }
});

test("fabIconKey - 표면별 FAB 아이콘 키", () => {
  const cases: [Surface, string][] = [
    ["session", "session"],
    ["schedules", "schedules"],
    ["terminal", "terminal"],
    ["browser", "browser"],
    ["scm", "plus"],
    ["explorer", "plus"],
  ];
  for (const [s, key] of cases) assert.strictEqual(fabIconKey(s), key, s);
});

import { chordStep, fabSlot, type ChordEvent } from "./home-fab.ts";

test("fabSlot - 순번은 FAB부터 위로 센다", () => {
  assert.deepStrictEqual(fabSlot("session", 1), { kind: "fab", primary: "session" });
  assert.deepStrictEqual(fabSlot("session", 2), { kind: "dial", action: "schedules" });
  assert.deepStrictEqual(fabSlot("session", 4), { kind: "dial", action: "browser" });
  assert.strictEqual(fabSlot("session", 5), null);
  assert.strictEqual(fabSlot("session", 9), null);
  assert.strictEqual(fabSlot("session", 0), null);
  assert.deepStrictEqual(fabSlot("scm", 1), { kind: "fab", primary: null });
  assert.deepStrictEqual(fabSlot("scm", 2), { kind: "dial", action: "session" });
  assert.deepStrictEqual(fabSlot("explorer", 5), { kind: "dial", action: "browser" });
  assert.strictEqual(fabSlot("explorer", 6), null);
});

test("chordStep - ⌘N 코드 전이", () => {
  const ev = (type: "down" | "up", key: string, mod = true, repeat = false): ChordEvent => ({ type, key, mod, repeat });
  // N: 코드 시작, N을 누를 때는 실행하지 않는다
  assert.deepStrictEqual(chordStep(false, ev("down", "n")), { armed: true, run: null, consume: true });
  assert.deepStrictEqual(chordStep(false, ev("down", "N")), { armed: true, run: null, consume: true });
  // ⌘ 없는 N, 코드 밖의 숫자와 keyup은 그대로 지나간다
  assert.deepStrictEqual(chordStep(false, ev("down", "n", false)), { armed: false, run: null, consume: false });
  assert.deepStrictEqual(chordStep(false, ev("down", "1")), { armed: false, run: null, consume: false });
  assert.deepStrictEqual(chordStep(false, ev("up", "Meta", false)), { armed: false, run: null, consume: false });
  // 처음 누른 N의 repeat은 코드를 열지 않는다
  assert.strictEqual(chordStep(false, ev("down", "n", true, true)).armed, false);
  // 코드 중 N repeat은 무시한다
  assert.deepStrictEqual(chordStep(true, ev("down", "n", true, true)), { armed: true, run: null, consume: true });
  // 숫자: 그 순번 실행하고 끝, 키는 표면 전환으로 가지 않는다
  assert.deepStrictEqual(chordStep(true, ev("down", "3")), { armed: false, run: 3, consume: true });
  // ⌘ 떼기: 숫자 없으면 1번
  assert.deepStrictEqual(chordStep(true, ev("up", "Meta", false)), { armed: false, run: 1, consume: false });
  assert.deepStrictEqual(chordStep(true, ev("up", "Control", false)), { armed: false, run: 1, consume: false });
  // N을 뗀 것은 코드와 무관하다
  assert.deepStrictEqual(chordStep(true, ev("up", "n")), { armed: true, run: null, consume: false });
  // 다른 키: 실행 없이 끝나고 원래대로 처리된다
  assert.deepStrictEqual(chordStep(true, ev("down", "k")), { armed: false, run: null, consume: false });
  // 조합자만 눌린 것은 코드를 끊지 않는다
  assert.strictEqual(chordStep(true, ev("down", "Shift")).armed, true);
});
