import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReport, createLimiter, scrubHome, tailBytes, RAW_MAX_BYTES } from "./error-report.ts";
import { reportError, reportRendererError, resetReportForTest, pushTailForTest } from "./error-report-send.ts";
import { onRequestError } from "../instrumentation.ts";
import { resetSessionForTest } from "./analytics.ts";

const ctx = { installId: "i", sessionId: "s", appVersion: "1", shell: "browser" as const, home: "/Users/kim" };
const base = { source: "server", kind: "uncaught", message: "boom" } as const;

test("홈 경로가 stack - raw - message에서 ~로 바뀐다", () => {
  const r = buildReport(
    { ...base, message: "x /Users/kim/a", stack: "at f (/Users/kim/p/x.ts:1)", raw: "log /Users/kim/y" },
    ctx,
  );
  assert.equal(r.message, "x ~/a");
  assert.equal(r.stack, "at f (~/p/x.ts:1)");
  assert.equal(r.raw, "log ~/y");
  assert.equal(r.v, 1);
  assert.equal(scrubHome("/Users/kimberly", "/Users/kim"), "~berly"); // 접두 일치 그대로(원문 가공 하나뿐)
});

test("raw가 64 KB를 넘으면 앞이 잘린다", () => {
  const raw = "A".repeat(100_000) + "END";
  const out = buildReport({ ...base, raw }, ctx).raw;
  assert.ok(Buffer.byteLength(out) <= RAW_MAX_BYTES);
  assert.ok(out.endsWith("END"));
  const ko = tailBytes("가".repeat(40_000)); // 3바이트 글자 - 중간에서 안 끊긴다
  assert.ok(!ko.includes("�") && Buffer.byteLength(ko) <= RAW_MAX_BYTES);
});

test("같은 지문 3회는 1건, 다른 지문 25건은 20건", () => {
  const ok = createLimiter();
  const r = { source: "server", kind: "uncaught", message: "m", stack: "E\n at a (f:1)" } as const;
  assert.deepEqual([ok(r, 0), ok(r, 1000), ok(r, 2000)], [true, false, false]);
  assert.equal(ok(r, 11 * 60 * 1000), true); // 10분이 지나면 다시
  const ok2 = createLimiter();
  let n = 0;
  for (let i = 0; i < 25; i++) if (ok2({ ...r, message: "m" + i }, i)) n++;
  assert.equal(n, 20);
});

// ── 전송: fetch 모킹 ────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let calls: { url: string; body: Record<string, unknown> }[] = [];
let dir = "";
const env = ["TICKET_LOCAL", "GA_MEASUREMENT_ID", "GA_API_SECRET", "DIRA_ERROR_REPORT_URL"] as const;
const saved: Record<string, string | undefined> = {};

function setup(o: { cred: boolean; enabled?: boolean }) {
  dir = mkdtempSync(path.join(tmpdir(), "err-report-"));
  process.env.TICKET_LOCAL = dir;
  process.env.DIRA_ERROR_REPORT_URL = "http://t.invalid/r";
  if (o.cred) {
    process.env.GA_MEASUREMENT_ID = "G-X";
    process.env.GA_API_SECRET = "s";
  }
  if (o.enabled === false) writeFileSync(path.join(dir, "analytics.json"), '{"enabled":false}');
}

beforeEach(() => {
  for (const k of env) saved[k] = process.env[k];
  for (const k of env) delete process.env[k];
  calls = [];
  resetReportForTest();
  resetSessionForTest();
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
});
const teardown = () => {
  globalThis.fetch = realFetch;
  for (const k of env) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
};

test("자격값이 없거나 enabled:false면 fetch가 한 번도 안 불린다", async () => {
  try {
    setup({ cred: false });
    await reportError({ ...base });
    teardown();
    setup({ cred: true, enabled: false });
    await reportError({ ...base });
    assert.equal(calls.length, 0);
  } finally {
    teardown();
  }
});

test("켜져 있으면 서버 오류와 요청 오류와 렌더러 오류가 source - kind 맞게 한 건씩 나간다", async () => {
  try {
    setup({ cred: true });
    pushTailForTest("log line");
    await reportError({ source: "server", kind: "uncaught", message: "a", stack: "E\n at x (f:1)" });
    await onRequestError(new Error("b"), {}, { routePath: "/p/[project]" });
    await reportRendererError({ kind: "boundary", message: "c", stack: "", raw: "console!" });
    await reportRendererError({ kind: "bogus", message: "d" });
    const got = calls.map((c) => [c.body.source, c.body.kind]);
    assert.deepEqual(got, [
      ["server", "uncaught"],
      ["server", "request_error"],
      ["renderer", "boundary"],
      ["renderer", "uncaught"],
    ]);
    assert.equal(calls[0].url, "http://t.invalid/r");
    assert.equal(calls[0].body.raw, "log line");
    assert.equal(calls[1].body.route, "/p/[project]");
    assert.equal(calls[2].body.raw, "console!");
  } finally {
    teardown();
  }
});

test("전송이 던져도 재제보하지 않고 삼킨다", async () => {
  try {
    setup({ cred: true });
    globalThis.fetch = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    await reportError({ ...base });
    assert.equal(calls.length, 0);
  } finally {
    teardown();
  }
});
