import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 데스크톱 쪽은 자기 tsconfig로 검사된다 - 정적 import로 이 패키지의 tsc에 끌어들이지 않는다.
const desk = (f: string) => import(new URL(`../../desktop/${f}`, import.meta.url).href);
type Cipher = { isEncryptionAvailable(): boolean; encryptString(p: string): Buffer; decryptString(c: Buffer): string };
import { callEnvBridge, callEnvBridgeFull, callVercelBridge, codeAfterList, pickVercelView, rowMarkKey, validateEnvName, validateEnvValue, vercelLineKey } from "./project-env.ts";

const SECRET = "s3cr3t-유니크-값";
const env = { DIRA_ENV_BRIDGE_URL: "http://x", DIRA_ENV_BRIDGE_SECRET: "tok" };
const reply = (b: unknown) => (async () => ({ ok: true, json: async () => b })) as unknown as typeof fetch;

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

test("VC-6 - Vercel 줄의 상태 다섯과 후보 선택이 응답에서 정해진다", () => {
  const key = (b: unknown, busy = false) => vercelLineKey(pickVercelView(b), busy);
  assert.equal(key({ state: "unlinked", source: "cli" }), "unlinked");
  assert.equal(key({ state: "unlinked" }, true), "connecting");
  assert.equal(key({ state: "connected", source: "cli", project: { name: "web", teamId: "team_1", projectId: "p", path: "x" } }), "connected");
  assert.equal(key({ state: "login_required" }), "login");
  assert.equal(key({ error: "io" }), "error");
  assert.equal(key({ state: "choose", candidates: [{ projectId: "a", name: "A", teamId: null }] }), "choose");
  assert.deepEqual(pickVercelView({ state: "connected", token: SECRET, project: { name: "web", teamId: null, token: SECRET } }), { state: "connected", name: "web", teamId: null });
  assert.ok(!JSON.stringify(pickVercelView({ state: "choose", candidates: [{ projectId: "a", name: "A", token: SECRET }] })).includes(SECRET));
});

test("VC-6 - 변수 행의 표시 다섯(맞음 반영 대기 충돌 Vercel에만 있음 가져오지 않음)과 값 없는 목록 파싱", async () => {
  const item = (kind: string, side?: string) => ({ name: "A", updatedAt: "t", revision: "1", sync: { kind, side }, value: SECRET });
  const body = {
    items: [item("synced"), item("pending"), item("conflict", "vercel"), item("reenter")],
    vercelOnly: [{ name: "S", kind: "vercel_only", value: SECRET }, { name: "VERCEL_URL", kind: "skipped", reason: "vercel_system" }],
    vercel: { lastSyncAt: "2026-10-11T00:00:00Z", deployPending: true },
  };
  const r = await callEnvBridgeFull(tmpdir(), { op: "list" }, reply(body), env) as { ok: true; data: { items: Parameters<typeof rowMarkKey>[0][]; vercelOnly: Parameters<typeof rowMarkKey>[0][] } };
  assert.equal(r.ok, true);
  const marks = [...r.data.items, ...r.data.vercelOnly].map(rowMarkKey);
  assert.deepEqual(marks, ["synced", "pending", "conflict", "reenter", "vercelOnly", "skipped"]);
  assert.ok(!JSON.stringify(r).includes(SECRET));
  // 연결 전 응답(sync 필드 없음)은 표시가 없다
  const plain = await callEnvBridge(tmpdir(), { op: "list" }, reply({ items: [{ name: "A", updatedAt: "t", revision: "1" }] }), env);
  assert.equal(rowMarkKey((plain as { data: { sync?: never }[] }).data[0] as never), null);
});

test("Vercel 브리지 호출 - 경로와 본문, 설정이 없으면 null", async () => {
  assert.equal(await callVercelBridge("/r", { op: "status" }, reply({}), {}), null);
  let seen = "";
  const f = (async (u: string, init: RequestInit) => { seen = `${init.method ?? "GET"} ${u} ${init.body ?? ""}`; return { status: 200, json: async () => ({ ok: true }) }; }) as unknown as typeof fetch;
  await callVercelBridge(tmpdir(), { op: "token", token: null }, f, env);
  assert.match(seen, /^POST http:\/\/x\/env\/v1\/vercel\/token \{"token":null,"project":/);
});
