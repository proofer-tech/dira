/** `error-report.ts` - P513-3: 세 사건 본문, 홈 `~` 치환, 자격값 없음 - `enabled:false`면 무전송. */
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as lib from "../teams/lib/error-report.ts";
import { createMainReporter } from "./error-report.ts";

function setup(opts: { configured?: boolean; file?: unknown } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "er-"));
  const analyticsFile = path.join(dir, "analytics.json");
  if (opts.file !== undefined) writeFileSync(analyticsFile, JSON.stringify(opts.file));
  const calls: { url: string; body: any }[] = [];
  const report = createMainReporter({
    lib,
    home: "/Users/kim",
    analyticsFile,
    configured: () => opts.configured ?? true,
    appVersion: "1.2.3",
    sessionId: "s1",
    url: "http://x/api/error-report",
    fetchFn: (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch,
  });
  return { report, calls };
}

test("세 사건이 각자 kind가 맞는 본문으로 나가고 raw의 홈 경로는 ~가 된다", async () => {
  const { report, calls } = setup({ file: { install_id: "iid" } });
  for (const kind of ["child_exit", "renderer_gone", "ready_timeout"] as const) {
    await report({ kind, message: `${kind} 사건`, raw: `stderr 전체\n/Users/kim/app/x.js 오류\nstdoutTail ${kind}` });
  }
  assert.deepEqual(calls.map((c) => c.body.kind), ["child_exit", "renderer_gone", "ready_timeout"]);
  for (const { body } of calls) {
    assert.equal(body.source, "main");
    assert.equal(body.shell, "desktop");
    assert.equal(body.install_id, "iid");
    assert.match(body.raw, /~\/app\/x\.js/);
    assert.ok(!body.raw.includes("/Users/kim"));
    assert.match(body.raw, /stderr 전체/);
    assert.match(body.raw, /stdoutTail/);
  }
});

test("자격값이 없으면 fetch가 불리지 않는다", async () => {
  const { report, calls } = setup({ configured: false, file: {} });
  await report({ kind: "child_exit", message: "m", raw: "r" });
  assert.equal(calls.length, 0);
});

test("analytics.json의 enabled가 false면 fetch가 불리지 않는다", async () => {
  const { report, calls } = setup({ file: { enabled: false } });
  await report({ kind: "child_exit", message: "m", raw: "r" });
  assert.equal(calls.length, 0);
});

test("파일이 없으면 켜진 것으로 본다(통계와 같은 규칙)", async () => {
  const { report, calls } = setup();
  await report({ kind: "child_exit", message: "m", raw: "r" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.install_id, "unknown");
});
