import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 토큰(~/.config/dira/oauth-token)을 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { normalizeToken, readAuth, saveToken, tokenPath } = await import("./auth.ts");

test("tokenPath — TICKET_LOCAL을 존중하고 레지스트리와 같은 디렉터리다", () => {
  assert.strictEqual(tokenPath(), path.join(LOCAL, "oauth-token"));
});

test("readAuth — 파일이 없으면 savedAt이 null", async () => {
  assert.strictEqual((await readAuth()).savedAt, null);
});

test("saveToken — 개행 없이 쓰고, 다시 읽으면 있음으로 나오고, 권한이 0600", async () => {
  await saveToken(normalizeToken("  sk-ant-oat01-abc\n"));

  const raw = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
  assert.strictEqual(raw, "sk-ant-oat01-abc"); // 엔진이 `tr -d '\r\n'`으로 읽는 한 줄
  assert.strictEqual(statSync(tokenPath()).mode & 0o777, 0o600);

  const s = await readAuth();
  assert.match(s.savedAt!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("saveToken — 재발급이 기존 파일의 느슨한 권한을 0600으로 되돌린다", async () => {
  writeFileSync(tokenPath(), "old", { mode: 0o644 });
  await saveToken("sk-ant-oat01-new");
  assert.strictEqual(statSync(tokenPath()).mode & 0o777, 0o600);
});

test("normalizeToken — 비었거나 안에 공백이 있으면 거부, 접두사로는 거르지 않는다", () => {
  assert.throws(() => normalizeToken("   \n "), /비어 있습니다/);
  assert.throws(() => normalizeToken("sk-ant oat"), /공백/);
  assert.throws(() => normalizeToken("sk-ant\noat"), /공백/);
  // 형식은 우리 것이 아니다 — 접두사가 달라도 통과한다(§0-4)
  assert.strictEqual(normalizeToken(" whatever-the-cli-gives "), "whatever-the-cli-gives");
});
