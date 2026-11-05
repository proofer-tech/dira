// $ cd apps/desktop && pnpm test
import assert from "node:assert/strict";
import test from "node:test";
import { HANG_PROMPT_MS, askedAfterUnresponsive, shouldAskReload, shouldCloseDialogOnResponsive } from "./hang-prompt.ts";

test("shouldAskReload - 5초 넘게 멎었고 아직 안 물었고 창이 보이면 묻는다", () => {
  assert.equal(shouldAskReload({ elapsedMs: HANG_PROMPT_MS, asked: false, visible: true }), true);
});

test("shouldAskReload - 5초 전이면 안 묻는다", () => {
  assert.equal(shouldAskReload({ elapsedMs: HANG_PROMPT_MS - 1, asked: false, visible: true }), false);
});

test("shouldAskReload - 이미 물었으면 안 묻는다", () => {
  assert.equal(shouldAskReload({ elapsedMs: 60000, asked: true, visible: true }), false);
});

test("shouldAskReload - 창이 안 보이면 안 묻는다", () => {
  assert.equal(shouldAskReload({ elapsedMs: 60000, asked: false, visible: false }), false);
});

test("askedAfterUnresponsive - 대화상자가 열려 있으면 asked를 유지해 두 번째가 안 뜬다", () => {
  const asked = askedAfterUnresponsive(true);
  assert.equal(shouldAskReload({ elapsedMs: 60000, asked, visible: true }), false);
});

test("askedAfterUnresponsive - 대화상자가 없으면 asked를 되돌려 다시 물을 수 있다", () => {
  const asked = askedAfterUnresponsive(false);
  assert.equal(shouldAskReload({ elapsedMs: 60000, asked, visible: true }), true);
});

test("shouldCloseDialogOnResponsive - 열려 있을 때만 닫는다", () => {
  assert.equal(shouldCloseDialogOnResponsive(true), true);
  assert.equal(shouldCloseDialogOnResponsive(false), false);
});
