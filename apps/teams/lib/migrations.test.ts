import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LOCAL = mkdtempSync(path.join(tmpdir(), "migrations-local-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));
const root = path.join(LOCAL, "proj", ".dira");
mkdirSync(root, { recursive: true });
writeFileSync(path.join(LOCAL, "gui-projects.json"), JSON.stringify({ projects: [{ id: "p1", name: "p1", root }] }));

const { act, MigrationError } = await import("./migrations.ts");

const code = (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof MigrationError ? e.code : -1));

test("POST는 레지스트리에 없는 key와 경로 문자열을 거절한다", async () => {
  assert.equal(await code(act("retry", "nope")), 404);
  assert.equal(await code(act("skip", root)), 404);
  assert.equal(await code(act("wait", "../../etc")), 404);
  assert.equal(await code(act("retry", 5)), 400);
  assert.equal(await code(act("rm", "p1")), 400);
});

test("wait는 대기 파일의 mtime을 지금으로 바꾼다", async () => {
  assert.equal(await code(act("wait", "p1")), 0);
  const age = Date.now() - statSync(path.join(LOCAL, "run", "migrate-wait-p1")).mtimeMs;
  assert.ok(age < 5000);
});
