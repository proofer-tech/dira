import { test } from "node:test";
import assert from "node:assert";
import { receive } from "./error-report-intake.ts";

const ok = { v: 1, install_id: "abc", source: "server", kind: "uncaught", message: "boom", at: "2026-10-21T10:00:00Z" };
const post = (b: string) => new Request("http://x/api/error-report", { method: "POST", body: b });

test("모양 검사 - JSON 아님 - 큰 본문 - 필수 키 누락은 400", async () => {
  const put = async () => assert.fail("쓰면 안 된다");
  assert.strictEqual((await receive(post("not json"), put)).status, 400);
  assert.strictEqual((await receive(post("[]"), put)).status, 400);
  assert.strictEqual((await receive(post(JSON.stringify({ ...ok, message: "x".repeat(256 * 1024) })), put)).status, 400);
  for (const k of ["v", "install_id", "source", "kind", "message"]) {
    const { [k]: _, ...rest } = ok as Record<string, unknown>;
    assert.strictEqual((await receive(post(JSON.stringify(rest)), put)).status, 400, k);
  }
});

test("토큰이 있으면 Blob 경로에 쓰고 202", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "t";
  try {
    const calls: [string, string][] = [];
    const res = await receive(post(JSON.stringify({ ...ok, install_id: "../evil" })), async (p, b) => void calls.push([p, b]));
    assert.strictEqual(res.status, 202);
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0][0], /^error-reports\/2026-10-21\/[^/]+-2026-10-21T10:00:00Z-[a-z0-9]+\.json$/);
    assert.ok(!calls[0][0].includes(".."));
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
});

test("토큰이 없으면 console.error로 찍고 202", async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const orig = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const res = await receive(post(JSON.stringify(ok)), async () => assert.fail("쓰면 안 된다"));
    assert.strictEqual(res.status, 202);
    assert.ok(String(logged[0]?.[1]).includes("boom"));
  } finally {
    console.error = orig;
  }
});
