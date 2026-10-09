import { strict as assert } from "node:assert";
import test from "node:test";
import { callEnvBridge, validateEnvName, validateEnvValue } from "./project-env.ts";

const SECRET = "s3cr3t-유니크-값";
const env = { DIRA_ENV_BRIDGE_URL: "http://x", DIRA_ENV_BRIDGE_TOKEN: "tok" };
const reply = (b: unknown) => (async () => ({ json: async () => b })) as unknown as typeof fetch;

test("이름 검증", () => {
  assert.equal(validateEnvName("API_KEY"), null);
  assert.equal(validateEnvName("1A"), "invalid-name");
  assert.equal(validateEnvName("a-b"), "invalid-name");
  for (const n of ["PATH", "LD_PRELOAD", "DYLD_X", "TICKET_ROOT", "DIRA_X", "NODE_OPTIONS"]) {
    assert.equal(validateEnvName(n), "reserved", n);
  }
  assert.equal(validateEnvName("PATHX"), null);
});

test("값 검증", () => {
  assert.equal(validateEnvValue(""), null);
  assert.equal(validateEnvValue("a\nb"), null);
  assert.equal(validateEnvValue("a\0"), "invalid-value");
  assert.equal(validateEnvValue("가".repeat(21846)), "invalid-value");
});

test("연결 설정이 없으면 unavailable", async () => {
  assert.deepEqual(await callEnvBridge("/r", { op: "list" }, reply({}), {}), { ok: false, code: "unavailable" });
});

test("응답에서 세 필드만 고르고 오류는 고정 코드다", async () => {
  const ok = await callEnvBridge("/r", { op: "list" },
    reply({ ok: true, items: [{ name: "A", updatedAt: "t", revision: "1", value: SECRET }] }), env);
  assert.ok(ok.ok && !JSON.stringify(ok).includes(SECRET));
  const bad = await callEnvBridge("/r", { op: "create", name: "A", value: SECRET },
    reply({ ok: false, code: "duplicate", message: SECRET }), env);
  assert.deepEqual(bad, { ok: false, code: "duplicate" });
  const odd = await callEnvBridge("/r", { op: "list" }, reply({ ok: false, code: SECRET }), env);
  assert.deepEqual(odd, { ok: false, code: "unavailable" });
});

test("fetch 실패와 계약 위반은 unavailable", async () => {
  const boom = (async () => { throw new Error(SECRET); }) as unknown as typeof fetch;
  assert.deepEqual(await callEnvBridge("/r", { op: "list" }, boom, env), { ok: false, code: "unavailable" });
  assert.deepEqual(await callEnvBridge("/r", { op: "list" }, reply({ ok: true }), env), { ok: false, code: "unavailable" });
});
