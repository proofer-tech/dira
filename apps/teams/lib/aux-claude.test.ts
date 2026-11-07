import { test } from "node:test";
import assert from "node:assert";
import { auxClaudeArgs, auxClaudeEnv, parseAuxOutput } from "./aux-claude.ts";

test("auxClaudeArgs - P554 결정 1의 플래그를 모두 낸다", () => {
  const a = auxClaudeArgs("haiku");
  assert.strictEqual(a[0], "-p");
  assert.strictEqual(a[a.indexOf("--model") + 1], "haiku");
  assert.strictEqual(a[a.indexOf("--output-format") + 1], "json");
  assert.strictEqual(a[a.indexOf("--tools") + 1], "");
  assert.strictEqual(a[a.indexOf("--setting-sources") + 1], "");
  for (const f of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) assert.ok(a.includes(f), f);
  assert.ok(!a.includes("--dangerously-skip-permissions"));
});

test("auxClaudeArgs - skip한 플래그는 값까지 빠진다", () => {
  const a = auxClaudeArgs("haiku", ["--setting-sources"]);
  assert.ok(!a.includes("--setting-sources"));
  assert.strictEqual(a[a.indexOf("--tools") + 1], "");
  assert.ok(a.includes("--strict-mcp-config"));
});

test("auxClaudeEnv - MAX_THINKING_TOKENS=0, 추가 환경 보존", () => {
  const e = auxClaudeEnv({ X: "1" });
  assert.strictEqual(e.MAX_THINKING_TOKENS, "0");
  assert.strictEqual(e.X, "1");
});

test("parseAuxOutput - result를 꺼내고 오류 봉투는 던진다", () => {
  assert.strictEqual(parseAuxOutput('{"result":"hi"}'), "hi");
  assert.throws(() => parseAuxOutput('{"is_error":true,"result":"x"}'));
  assert.throws(() => parseAuxOutput("not json"));
});
