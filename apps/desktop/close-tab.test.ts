import assert from "node:assert/strict";
import test from "node:test";
import { closeTabOutcome } from "./close-tab.ts";

test("closeTabOutcome - 처리됨(false)이면 탭을 닫은 것이다", () => {
  assert.equal(closeTabOutcome(false), "tab");
});
test("closeTabOutcome - 처리 안 됨(true)이면 창을 닫는다", () => {
  assert.equal(closeTabOutcome(true), "window");
});
test("closeTabOutcome - 렌더러 실패면 창을 닫는다", () => {
  assert.equal(closeTabOutcome(new Error("x")), "window");
});
