import { test } from "node:test";
import assert from "node:assert/strict";
import { closeAction, requestDirty } from "./close-guard.ts";

test("접수 확인 화면은 본문과 첨부가 남아 있어도 dirty가 아니다", () => {
  assert.equal(requestDirty("abc12345", "쓴 글", true), false);
});

test("접수 전에는 본문이나 첨부가 있으면 dirty다", () => {
  assert.equal(requestDirty(null, "쓴 글", false), true);
  assert.equal(requestDirty(null, "", true), true);
  assert.equal(requestDirty(null, "", false), false);
});

test("닫기는 접수 뒤 묻지 않고 접수 전에는 묻는다", () => {
  assert.equal(closeAction(false, requestDirty("abc12345", "쓴 글", false)), "discard");
  assert.equal(closeAction(false, requestDirty(null, "쓴 글", false)), "ask");
  assert.equal(closeAction(true, true), "open");
});
