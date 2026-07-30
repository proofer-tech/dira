/** 엔진 호출 — 해시 → 경로를 **엔진에게 물어본다**는 것이 이 파일이 검증하는 전부다.
 *  경로를 조립하면 통과할 수 없는 케이스(접미사 붙은 이름·`re-` 폴백·형식 밖 해시)를 고른다. */
import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findTicket } from "./engine.ts";
import type { Suffixes } from "./queue.ts";

const DEFAULT: Suffixes = { inProgress: ".wip", done: ".done" };
const KO: Suffixes = { inProgress: "-진행중", done: "-완료" };

const root = mkdtempSync(path.join(tmpdir(), "fst-eng-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "tickets"));
const put = (name: string) =>
  writeFileSync(path.join(root, "tickets", name), "---\ntitle: t\n---\n");
put("aaaa1111.md");
put("bbbb2222.wip.md");
put("re-cccc3333.md");
put("dddd4444-완료.md");

test("findTicket — 접미사·`re-` 폴백은 엔진이 판정한다", async () => {
  const t = (n: string) => path.join(root, "tickets", n);
  assert.strictEqual(await findTicket(root, "aaaa1111", DEFAULT), t("aaaa1111.md"));
  assert.strictEqual(await findTicket(root, "bbbb2222", DEFAULT), t("bbbb2222.wip.md"));
  assert.strictEqual(await findTicket(root, "cccc3333", DEFAULT), t("re-cccc3333.md"));
  assert.strictEqual(await findTicket(root, "zzzz9999", DEFAULT), null); // 없는 해시 = 404
  // 접미사는 테넌트별이다: 기본 접미사로는 `-완료`가 이름의 일부라 안 맞고, 한글 접미사로는 맞는다
  assert.strictEqual(await findTicket(root, "dddd4444", DEFAULT), null);
  assert.strictEqual(await findTicket(root, "dddd4444", KO), t("dddd4444-완료.md"));
});

test("findTicket — 형식 밖 해시는 엔진을 부르지도 않는다", async () => {
  for (const bad of ["../../etc/passwd", "AAAA1111", "a/b", "ab", "한글티켓", ""]) {
    assert.strictEqual(await findTicket(root, bad, DEFAULT), null, bad);
  }
});
