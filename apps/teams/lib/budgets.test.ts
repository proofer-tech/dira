import { test } from "node:test";
import assert from "node:assert";
import { budgetLabel, byteLength, squadBlockBytes, SQUAD_BLOCK_MAX_BYTES } from "./budgets.ts";

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

// `50fd4b34` — en 화면에서 꼬리 문구가 한글 `초과`를 그대로 흘리던 회귀.
test("budgetLabel — locale을 en으로 주면 꼬리도 영어다", () => {
  assert.equal(budgetLabel(5_387, 5_000, "en"), "5,387 / 5,000 B over");
});

// tick.sh:736-788이 실제로 조립하는 블록과 문자 그대로 맞는지 - 엔진에 로케일이 없어 이
// 블록은 늘 한국어라 `squadBlockBytes` 자체도 locale을 안 받는다(`50fd4b34`).
test("squadBlockBytes — tick.sh 스쿼드 블록과 문자 그대로 맞는다", () => {
  const bytes = squadBlockBytes("myteam", [
    { name: "alice", role: "리더" },
    { name: "bob", role: "" },
  ]);
  const expected = ["===== 스쿼드 myteam =====", "alice (리더) - 리더", "bob - ", "===== 스쿼드 끝 ====="].join(
    "\n",
  );
  assert.equal(bytes, byteLength(expected));
  assert.equal(SQUAD_BLOCK_MAX_BYTES, 1_500);
});
