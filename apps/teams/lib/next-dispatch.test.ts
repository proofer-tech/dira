import { test } from "node:test";
import assert from "node:assert";
import { secondsLeft, dispatchProgress } from "./next-dispatch.ts";

test("secondsLeft — 주기 [30]에서 벽시계 초 :00 -> 30, :29 -> 1, :31 -> 29 (§1-6 §계산)", () => {
  assert.strictEqual(secondsLeft([30], 0), 30); // :00
  assert.strictEqual(secondsLeft([30], 29_000), 1); // :29
  assert.strictEqual(secondsLeft([30], 31_000), 29); // :31 (다음 :00까지)
});

test("secondsLeft — 주기 [60, 30]이면 최솟값을 낸다", () => {
  assert.strictEqual(secondsLeft([60, 30], 0), 30); // 60 - 0 = 60, 30 - 0 = 30 -> 30
  assert.strictEqual(secondsLeft([60, 30], 31_000), 29); // 60-31%60=29, 30-31%30=29 -> 29
  assert.strictEqual(secondsLeft([60, 30], 45_000), 15); // 60-45=15, 30-15=15 -> 15
});

test("secondsLeft — idle이 0개면 null (뜨는 자리가 아니다, §1-6 §뜨는 조건)", () => {
  assert.strictEqual(secondsLeft([]), null);
});

test("dispatchProgress — :00 / :30 경계에서 몫이 가득(1) -> 1/30로 줄고 다시 가득 찬다", () => {
  assert.deepStrictEqual(dispatchProgress([30], 0), { left: 30, period: 30 }); // :00 가득
  assert.deepStrictEqual(dispatchProgress([30], 29_000), { left: 1, period: 30 }); // :29
  assert.deepStrictEqual(dispatchProgress([30], 30_000), { left: 30, period: 30 }); // :30 다시 가득
  assert.deepStrictEqual(dispatchProgress([60, 30], 45_000), { left: 15, period: 30 }); // 동률이면 짧은 주기
});

test("dispatchProgress — 60초 워커만 있으면 :30에서도 안 감긴다", () => {
  assert.deepStrictEqual(dispatchProgress([60], 30_000), { left: 30, period: 60 });
  assert.deepStrictEqual(dispatchProgress([60], 59_000), { left: 1, period: 60 });
  assert.deepStrictEqual(dispatchProgress([60], 60_000), { left: 60, period: 60 });
});

test("dispatchProgress — idle 0개면 null", () => {
  assert.strictEqual(dispatchProgress([]), null);
});
