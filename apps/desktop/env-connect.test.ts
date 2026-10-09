/** `env-connect.ts` - 등록된 프로젝트마다 연결 파일을 두고 닫을 때 지운다. */
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveToken } from "./env-bridge.ts";
import { resolveProject } from "./env-store.ts";
import { publishConnections, unpublishConnections } from "./env-connect.ts";

test("연결 파일 - 프로젝트마다 0600 파일에 자기 토큰만 두고 워크트리 심링크는 같은 파일로 모이며 닫으면 지운다", async () => {
  const t = mkdtempSync(path.join(tmpdir(), "envc-"));
  const a = path.join(t, "a", ".dira"), b = path.join(t, "b", ".dira");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const wt = path.join(t, "a", "wt"); // 워크트리의 .dira 심링크
  symlinkSync(a, wt);
  writeFileSync(path.join(t, "gui-projects.json"), JSON.stringify({ projects: [{ root: a }, { root: wt }, { root: b }, { root: "/nope/x" }] }));
  const keys = await publishConnections({ local: t, port: 4321, secret: "s" });
  assert.strictEqual(keys.length, 2);
  const dir = path.join(t, "env-bridge");
  assert.strictEqual(statSync(dir).mode & 0o777, 0o700);
  const ka = (await resolveProject(a)).key;
  const f = path.join(dir, `${ka}.json`);
  assert.strictEqual(statSync(f).mode & 0o777, 0o600);
  const c = JSON.parse(readFileSync(f, "utf8"));
  assert.deepStrictEqual(c, { port: 4321, token: deriveToken("s", ka) });
  assert.ok(!readFileSync(f, "utf8").includes('"s"'));
  assert.strictEqual(readdirSync(dir).length, 2);
  unpublishConnections(t);
  assert.strictEqual(readdirSync(dir).length, 0);
});
