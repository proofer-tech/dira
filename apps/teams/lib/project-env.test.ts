import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 데스크톱 쪽은 자기 tsconfig로 검사된다 - 정적 import로 이 패키지의 tsc에 끌어들이지 않는다.
const desk = (f: string) => import(new URL(`../../desktop/${f}`, import.meta.url).href);
type Cipher = { isEncryptionAvailable(): boolean; encryptString(p: string): Buffer; decryptString(c: Buffer): string };
import { callEnvBridge, codeAfterList, validateEnvName, validateEnvValue } from "./project-env.ts";

const SECRET = "s3cr3t-유니크-값";
const env = { DIRA_ENV_BRIDGE_URL: "http://x", DIRA_ENV_BRIDGE_SECRET: "tok" };
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

test("fetch 실패와 계약 위반은 unavailable", async () => {
  const boom = (async () => { throw new Error(SECRET); }) as unknown as typeof fetch;
  assert.deepEqual(await callEnvBridge(tmpdir(), { op: "list" }, boom, env), { ok: false, code: "unavailable" });
  assert.deepEqual(await callEnvBridge(tmpdir(), { op: "list" }, reply({ items: 1 }), env), { ok: false, code: "unavailable" });
});

/** 실물 브리지(`apps/desktop`)와 직접 붙는다 - 가짜 fetch가 아니라 같은 계약을 두 쪽이 지키는지 고정한다. */
test("실물 브리지와의 왕복: 추가 - 교체 - 삭제와 오류 코드", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "envp-"));
  const root = path.join(dir, ".dira");
  mkdirSync(root);
  let corrupt = false;
  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (p) => Buffer.from(p, "utf8"),
    decryptString: (c) => c.toString("utf8"),
  };
  const { createEnvStore } = await desk("env-store.ts");
  const { createEnvBridge } = await desk("env-bridge.ts");
  const store = createEnvStore({ dir: path.join(dir, "store"), cipher });
  const { server, port } = await createEnvBridge({ store, secret: "sec" }).listen();
  const e = { DIRA_ENV_BRIDGE_URL: `http://127.0.0.1:${port}`, DIRA_ENV_BRIDGE_SECRET: "sec" };
  try {
    const call = (op: Parameters<typeof callEnvBridge>[1], env = e) => callEnvBridge(root, op, fetch, env);
    assert.deepEqual(await call({ op: "list" }), { ok: true, data: [] });
    const c = await call({ op: "create", name: "API_KEY", value: SECRET });
    assert.ok(c.ok && !Array.isArray(c.data) && c.data.name === "API_KEY" && !JSON.stringify(c).includes(SECRET));
    const rev = (c as { ok: true; data: { revision: string } }).data.revision;
    assert.deepEqual(await call({ op: "create", name: "API_KEY", value: "x" }), { ok: false, code: "duplicate" });
    assert.deepEqual(await call({ op: "replace", name: "API_KEY", value: "y", expectedRevision: "0" }), { ok: false, code: "conflict" });
    assert.deepEqual(await call({ op: "replace", name: "NOPE", value: "y", expectedRevision: "1" }), { ok: false, code: "not-found" });
    assert.deepEqual(await call({ op: "create", name: "1A", value: "y" }), { ok: false, code: "invalid-name" });
    assert.deepEqual(await call({ op: "create", name: "PATH", value: "y" }), { ok: false, code: "reserved" });
    assert.deepEqual(await call({ op: "create", name: "BIG", value: "a".repeat(70000) }), { ok: false, code: "invalid-value" });
    const r = await call({ op: "replace", name: "API_KEY", value: "y", expectedRevision: rev });
    assert.ok(r.ok);
    const l = await call({ op: "list" });
    assert.ok(l.ok && Array.isArray(l.data) && l.data.length === 1);
    assert.deepEqual(await call({ op: "list" }, { ...e, DIRA_ENV_BRIDGE_SECRET: "wrong" }), { ok: false, code: "unavailable" });
    const d = await call({ op: "delete", name: "API_KEY", expectedRevision: (r as { data: { revision: string } }).data.revision });
    assert.ok(d.ok);
    assert.deepEqual(await call({ op: "list" }), { ok: true, data: [] });
    // 손상: 저장 파일을 깨뜨리면 corrupt가 그대로 화면 코드로 간다.
    for (const f of readdirSync(path.join(dir, "store"))) writeFileSync(path.join(dir, "store", f), "garbage");
    corrupt = true;
    assert.deepEqual(await call({ op: "list" }), { ok: false, code: "corrupt" });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(corrupt);
});

test("codeAfterList - 충돌 뒤 재읽기는 안내를 남기고 평소 읽기와 성공한 변경 뒤에는 안내가 없다", () => {
  assert.equal(codeAfterList("conflict", true), "conflict");
  assert.equal(codeAfterList("not-found", true), "not-found");
  assert.equal(codeAfterList("conflict", false), null);
  assert.equal(codeAfterList(null, false), null);
});
