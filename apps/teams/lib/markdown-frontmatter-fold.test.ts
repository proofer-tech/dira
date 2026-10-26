import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultCollapsed, foldInfos } from "./markdown-frontmatter-fold.ts";
import { insertRow, parseFrontmatterHead, updateRow } from "./markdown-frontmatter-rows.ts";

const pairs = (n: number) => Array.from({ length: n }, (_, i) => `    k${i}: v\n`).join("");
const HEAD = `---
type: 문서
links:
  dependsOn:
${pairs(8)}  feeds:
${pairs(2)}  assigns:
    - a: x
      role: r
---
`;

test("하위 행 수와 요약 종류", () => {
  const rows = parseFrontmatterHead(HEAD).rows;
  const f = foldInfos(rows);
  assert.equal(f[0].descendants, 0);
  assert.equal(f[1].descendants, 15);
  assert.equal(f[1].children, 3);
  assert.equal(f[1].childrenAreItems, false);
  assert.equal(f[2].descendants, 8);
  const assigns = rows.findIndex((r) => r.key === "assigns");
  assert.equal(f[assigns].childrenAreItems, true);
  assert.equal(f[assigns].children, 1);
});

test("기본 접힘은 8개 이상인 행만", () => {
  const rows = parseFrontmatterHead(HEAD).rows;
  const f = foldInfos(rows);
  const c = defaultCollapsed(rows);
  assert.ok(c.has(f[1].id)); // links: 하위 행 전체가 8 이상
  assert.ok(c.has(f[2].id)); // dependsOn: 정확히 8
  const feeds = rows.findIndex((r) => r.key === "feeds");
  assert.ok(!c.has(f[feeds].id));
});

test("행을 고치거나 더해도 앞쪽 행의 식별자가 유지된다", () => {
  const rows = parseFrontmatterHead(HEAD).rows;
  const before = foldInfos(rows).map((f) => f.id);
  const typed = updateRow(rows, 0, { key: "kind", value: "x" });
  assert.deepEqual(foldInfos(typed).map((f) => f.id), before);
  const added = insertRow(rows, rows.length, { key: "z", value: "", shape: "pair" });
  assert.deepEqual(foldInfos(added).map((f) => f.id).slice(0, rows.length), before);
});
