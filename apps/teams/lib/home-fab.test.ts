import { test } from "node:test";
import assert from "node:assert";
import { fabPlan } from "./home-fab.ts";
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
