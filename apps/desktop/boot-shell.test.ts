import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BG_DARK, BG_LIGHT, readBootLayout } from "./boot-shell.ts";

const dir = mkdtempSync(join(tmpdir(), "bootshell-"));
const put = (s: string) => { const f = join(dir, `${Math.random()}.json`); writeFileSync(f, s); return f; };

test("layout.json이 없으면 기본(라이트)이다", () => {
  const r = readBootLayout(join(dir, "NOPE.json"));
  assert.equal(r.background, BG_LIGHT);
  assert.equal(r.query, "{}");
});
test("깨진 JSON과 배열은 기본이다", () => {
  assert.equal(readBootLayout(put("{oops")).background, BG_LIGHT);
  assert.equal(readBootLayout(put("[1]")).query, "{}");
});
test("다크 + 접힘은 그대로 셸에 넘어간다", () => {
  const r = readBootLayout(put('{"v":1,"theme":"dark","sidebar":{"width":256,"collapsed":true}}'));
  assert.equal(r.background, BG_DARK);
  assert.deepEqual(JSON.parse(r.query).sidebar, { width: 256, collapsed: true });
});
