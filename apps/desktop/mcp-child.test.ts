/** `mcp-child.ts` - 재기동 정책과 mcp.json 파일. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mcpJsonPath, mcpStoppedLabel, onMcpExit, removeMcpJson, writeMcpJson } from "./mcp-child.ts";

test("onMcpExit - 60초 안 다섯 번째 죽음에서 멈추고 비운 뒤에는 다시 센다", () => {
  let h: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = onMcpExit(h, 1000 * i);
    assert.equal(r.action, "restart");
    assert.equal(r.delayMs, 1000);
    h = r.history;
  }
  assert.equal(onMcpExit(h, 4000).action, "stop");
  // 수동 재시작: 호출 쪽이 기록을 비운다 -> 다시 1번째부터
  assert.equal(onMcpExit([], 5000).action, "restart");
});

test("onMcpExit - 60초가 지난 죽음은 세지 않는다", () => {
  const r = onMcpExit([0, 1000, 2000, 3000], 61_500);
  assert.equal(r.action, "restart");
  assert.deepEqual(r.history, [2000, 3000, 61_500]);
});

test("mcp.json - 모양과 0600, 다른 pid의 지우기는 무시, 맞는 pid나 무인자는 지운다", () => {
  const t = mkdtempSync(join(tmpdir(), "mcp-"));
  const rec = { url: "http://127.0.0.1:1/mcp", token: "tok", pid: 42, started_at: "2026-10-11T00:00:00Z" };
  writeMcpJson(t, rec);
  const f = mcpJsonPath(t);
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), rec);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  removeMcpJson(t, 7);
  assert.ok(existsSync(f));
  removeMcpJson(t, 42);
  assert.ok(!existsSync(f));
  writeMcpJson(t, rec);
  removeMcpJson(t);
  assert.ok(!existsSync(f));
});

test("트레이 문구는 ko-en 두 벌이다", () => {
  assert.match(mcpStoppedLabel("ko-KR"), /MCP 서버가 멈췄습니다/);
  assert.match(mcpStoppedLabel("en-US"), /MCP server stopped/);
});
