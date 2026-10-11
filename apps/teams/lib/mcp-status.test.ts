import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readMcpStatus } from "./mcp-status.ts";

test("readMcpStatus - 파일 없음 / pid 죽음 / 살아 있음 세 갈래와 HTTP 연결 설정 모양", () => {
  const d = mkdtempSync(path.join(tmpdir(), "mcps-"));
  const f = path.join(d, "mcp.json");
  assert.deepEqual(readMcpStatus(f), { state: "none" });
  writeFileSync(f, JSON.stringify({ url: "http://127.0.0.1:9/mcp", token: "tok", pid: 4242, started_at: "x" }));
  assert.deepEqual(readMcpStatus(f, () => false), { state: "dead" });
  const s = readMcpStatus(f, (pid) => pid === 4242);
  assert.equal(s.state, "alive");
  if (s.state === "alive") {
    assert.equal(s.url, "http://127.0.0.1:9/mcp");
    assert.deepEqual(JSON.parse(s.httpConfig), {
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer tok" },
    });
  }
  writeFileSync(f, "{깨짐");
  assert.deepEqual(readMcpStatus(f), { state: "none" });
  // 진짜 pid 판정: 이 프로세스는 산 것이다
  writeFileSync(f, JSON.stringify({ url: "u", token: "t", pid: process.pid }));
  assert.equal(readMcpStatus(f).state, "alive");
});
