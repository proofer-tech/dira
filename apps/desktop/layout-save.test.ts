import assert from "node:assert/strict";
import test from "node:test";
import { acceptLayout, LAYOUT_MAX_BYTES } from "./layout-save.ts";

test("acceptLayout - 정상 입력은 통과", () => {
  const j = JSON.stringify({ v: 1, theme: "dark" });
  assert.equal(acceptLayout(j), j);
});
test("acceptLayout - 상한 초과, JSON 아님, 형식 틀림은 버린다", () => {
  assert.equal(acceptLayout(JSON.stringify({ v: 1, pad: "x".repeat(LAYOUT_MAX_BYTES) })), null);
  assert.equal(acceptLayout("{not json"), null);
  assert.equal(acceptLayout("[1]"), null);
  assert.equal(acceptLayout(JSON.stringify({ v: 2 })), null);
  assert.equal(acceptLayout({ v: 1 }), null);
  assert.equal(acceptLayout(null), null);
});
