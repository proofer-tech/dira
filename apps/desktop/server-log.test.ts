import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendExitLog, prepareReportDir, reportsToDelete, trimLog } from "./server-log.ts";

test("reportsToDelete - 11개면 가장 오래된 1개만 지운다", () => {
  const f = Array.from({ length: 11 }, (_, i) => ({ name: `r${i}`, mtimeMs: i }));
  assert.deepEqual(reportsToDelete(f), ["r0"]);
  assert.deepEqual(reportsToDelete(f.slice(1)), []);
});

test("prepareReportDir - 실제 디렉터리에서 11개가 10개가 된다", () => {
  const d = join(mkdtempSync(join(tmpdir(), "sr-")), "server-reports");
  prepareReportDir(d);
  for (let i = 0; i < 11; i++) {
    const p = join(d, `report.${i}.json`);
    writeFileSync(p, "{}");
    utimesSync(p, 1000 + i, 1000 + i);
  }
  prepareReportDir(d);
  const left = readdirSync(d);
  assert.equal(left.length, 10);
  assert.ok(!left.includes("report.0.json"));
});

test("trimLog - 1 MB 초과면 512 KB 근처만 남고 한도 이하는 그대로", () => {
  const small = Buffer.alloc(1000, "a");
  assert.equal(trimLog(small), small);
  const big = Buffer.from(("x".repeat(99) + "\n").repeat(11000)); // 1.1 MB
  const t = trimLog(big);
  assert.ok(t.length <= 512 * 1024 && t.length > 512 * 1024 - 200, String(t.length));
  assert.ok(t.subarray(0, 99).toString() === "x".repeat(99)); // 줄 경계
});

test("appendExitLog - 한 줄과 꼬리를 덧붙이고 64 KB로 자른다", () => {
  const f = join(mkdtempSync(join(tmpdir(), "sl-")), "server-exit.log");
  appendExitLog(f, "SIGABRT", "A".repeat(100000) + "FATAL ERROR", new Date("2026-11-06T00:00:00Z"));
  const s = readFileSync(f, "utf8");
  assert.ok(s.startsWith("2026-11-06T00:00:00.000Z code=SIGABRT\n"));
  assert.ok(s.includes("FATAL ERROR"));
  assert.ok(s.length < 66000);
});
