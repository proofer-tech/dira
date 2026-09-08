// 판정이 순수 함수라 electron 없이 분기 전부를 밟는다.
// $ cd apps/desktop && pnpm test
import assert from "node:assert/strict";
import test from "node:test";
import { badgeText, nextCount } from "./dock-badge.ts";

test("badgeText — 답변 대기 2건 + 보류 1건이면 \"3\"", () => {
  assert.equal(badgeText({ awaiting: 2, gate: 1 }), "3");
});

test("badgeText — 둘 다 0건이면 빈 문자열", () => {
  assert.equal(badgeText({ awaiting: 0, gate: 0 }), "");
});

test("nextCount — 실패한 층(null)은 직전 수를 그대로 유지한다", () => {
  assert.equal(nextCount(5, null), 5);
  assert.equal(nextCount(5, 2), 2);
});

test("nextCount — 첫 응답에서도 배지가 그려진다(직전 수 0에서 첫 응답 값으로 간다)", () => {
  assert.equal(nextCount(0, 3), 3);
  assert.equal(badgeText({ awaiting: nextCount(0, 2), gate: nextCount(0, 1) }), "3");
});
