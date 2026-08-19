import { test } from "node:test";
import assert from "node:assert";
import { budgetLabel, byteLength } from "./budgets.ts";

test("byteLength는 UTF-8 바이트다 — 코드 포인트가 아니다(`wc -c`와 같은 값)", () => {
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength("가"), Buffer.byteLength("가")); // 3바이트, 코드포인트로는 1
});

test("budgetLabel — 상한 없으면 `{n} B` 하나뿐이다", () => {
  assert.equal(budgetLabel(42), "42 B");
});

test("budgetLabel — 상한 안이면 `{n} / {상한} B`, 넘으면 뒤에 ` 초과`가 는다", () => {
  assert.equal(budgetLabel(3_496, 3_500), "3,496 / 3,500 B");
  assert.equal(budgetLabel(5_387, 5_000), "5,387 / 5,000 B 초과");
  assert.equal(budgetLabel(5_000, 5_000), "5,000 / 5,000 B"); // 딱 걸치면 안 넘는다
});
