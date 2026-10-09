/** `env-store.ts` + `env-bridge.ts` - 가짜 암호화기와 임시 디렉터리로 돈다(ENV-1 ENV-2 저장 쪽). */
import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { get } from "node:http";
import path from "node:path";
import { createEnvBridge, deriveToken } from "./env-bridge.ts";
import { createEnvStore, EnvError, resolveProject, type Cipher } from "./env-store.ts";

const tmps: string[] = [];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "envs-"));
  tmps.push(d);
  return d;
};

/** 평문을 뒤집어 앞에 표지를 붙인다 - 파일에 평문이 그대로 있으면 안 된다는 검사가 의미를 갖는 정도. */
function fakeCipher(state = { available: true, fail: false }): Cipher & { state: typeof state } {
  return {
    state,
    isEncryptionAvailable: () => state.available,
    encryptString(p) {
      if (state.fail) throw new Error("keychain locked");
      return Buffer.from("E1:" + Buffer.from(p, "utf8").reverse().toString("latin1"), "latin1");
    },
    decryptString(c) {
      const s = c.toString("latin1");
      if (!s.startsWith("E1:")) throw new Error("bad");
      return Buffer.from(s.slice(3), "latin1").reverse().toString("utf8");
    },
  };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as EnvError).code;
  }
  return "ok";
};

function project() {
  const root = path.join(tmp(), "q", ".dira");
  mkdirSync(path.join(root, "tickets"), { recursive: true });
  return root;
}

test("저장 폴더 0700 파일 0600이고 재시작(새 store) 뒤에도 복호화된다", async () => {
  const dir = path.join(tmp(), "env"), root = project(), cipher = fakeCipher();
  const SECRET = "시험값-ENV2-\n줄바꿈";
  await createEnvStore({ dir, cipher }).create(root, "TOKEN_A", SECRET);
  assert.strictEqual(statSync(dir).mode & 0o777, 0o700);
  const files = readdirSync(dir);
  assert.strictEqual(files.length, 1); // 임시 파일 잔해 없음
  assert.strictEqual(statSync(path.join(dir, files[0])).mode & 0o777, 0o600);
  assert.ok(!readFileSync(path.join(dir, files[0]), "utf8").includes("ENV2")); // 평문 없음
  const after = createEnvStore({ dir, cipher });
  assert.deepStrictEqual(await after.resolveForRun(root, ["TOKEN_A"]), { TOKEN_A: SECRET });
});

test("프로젝트 식별 - 워크트리의 .dira 심링크는 같은 저장소, 다른 프로젝트는 분리", async () => {
  const dir = path.join(tmp(), "env"), a = project(), b = project();
  const wt = path.join(tmp(), "wt");
  mkdirSync(wt);
  symlinkSync(a, path.join(wt, ".dira"));
  const s = createEnvStore({ dir, cipher: fakeCipher() });
  await s.create(a, "K", "va");
  await s.create(b, "K", "vb");
  assert.deepStrictEqual(await s.resolveForRun(path.join(wt, ".dira"), ["K"]), { K: "va" });
  assert.deepStrictEqual(await s.resolveForRun(b, ["K"]), { K: "vb" });
  assert.strictEqual((await resolveProject(path.join(wt, ".dira"))).key, (await resolveProject(a)).key);
  for (const bad of ["rel/path", "", 5, path.join(a, "nope"), "/x\0y"]) {
    assert.strictEqual(await code(s.list(bad)), "bad_project");
  }
});

test("검증 - 이름 예약어 중복 크기 NUL, 빈 값과 줄바꿈 보존", async () => {
  const root = project(), s = createEnvStore({ dir: path.join(tmp(), "e"), cipher: fakeCipher() });
  for (const n of ["1A", "A-B", "", "a b", 7]) assert.strictEqual(await code(s.create(root, n, "v")), "invalid_name");
  for (const n of ["PATH", "HOME", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_X", "TICKET_ID", "DIRA_TOKEN", "BASH_ENV"]) {
    assert.strictEqual(await code(s.create(root, n, "v")), "reserved_name");
  }
  assert.strictEqual(await code(s.create(root, "A", "a\0b")), "invalid_value");
  assert.strictEqual(await code(s.create(root, "A", 1)), "invalid_value");
  assert.strictEqual(await code(s.create(root, "A", "x".repeat(64 * 1024 + 1))), "too_large");
  assert.strictEqual(await code(s.create(root, "A", "가".repeat(21846))), "too_large"); // 바이트 기준
  await s.create(root, "OK64", "x".repeat(64 * 1024));
  await s.create(root, "EMPTY", "");
  await s.create(root, "MULTI", "a\r\nb\n");
  await s.create(root, "OK64".toLowerCase(), "v"); // 대소문자는 다른 이름이다
  assert.strictEqual(await code(s.create(root, "EMPTY", "z")), "duplicate");
  assert.deepStrictEqual(await s.resolveForRun(root, ["EMPTY", "MULTI"]), { EMPTY: "", MULTI: "a\r\nb\n" });
  assert.deepStrictEqual(Object.keys((await s.list(root))[0]).sort(), ["name", "revision", "updatedAt"]);
});

test("revision 충돌과 동시 쓰기 - 잃는 변경이 없다", async () => {
  const root = project(), s = createEnvStore({ dir: path.join(tmp(), "e"), cipher: fakeCipher() });
  await Promise.all(Array.from({ length: 12 }, (_, i) => s.create(root, `V${i}`, `v${i}`)));
  assert.strictEqual((await s.list(root)).length, 12);
  const m = (await s.list(root)).find((x) => x.name === "V0")!;
  const r = await Promise.allSettled([s.replace(root, "V0", "one", m.revision), s.replace(root, "V0", "two", m.revision)]);
  assert.strictEqual(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.strictEqual(await code(s.delete(root, "V0", m.revision)), "conflict");
  const cur = (await s.list(root)).find((x) => x.name === "V0")!;
  await s.delete(root, "V0", cur.revision);
  assert.strictEqual(await code(s.resolveForRun(root, ["V0"])), "not_found");
  assert.strictEqual(await code(s.delete(root, "V0", cur.revision)), "not_found");
  const again = await s.create(root, "V0", "re"); // 삭제 뒤 재생성은 옛 revision과 안 겹친다
  assert.notStrictEqual(again.revision, cur.revision);
  assert.notStrictEqual(again.revision, m.revision);
});

test("잠김 - 평문 대체 없이 실패하고 기존 파일이 그대로다", async () => {
  const dir = path.join(tmp(), "e"), root = project(), state = { available: true, fail: false };
  const s = createEnvStore({ dir, cipher: fakeCipher(state) });
  await s.create(root, "A", "va");
  const f = path.join(dir, readdirSync(dir)[0]);
  const before = readFileSync(f, "utf8");
  state.fail = true;
  assert.strictEqual(await code(s.replace(root, "A", "new", "1")), "locked");
  state.fail = false;
  state.available = false;
  const got = await Promise.all([code(s.list(root)), code(s.create(root, "B", "v")), code(s.resolveForRun(root, ["A"]))]);
  assert.deepStrictEqual(got, ["locked", "locked", "locked"]);
  assert.strictEqual(readFileSync(f, "utf8"), before);
  assert.deepStrictEqual(readdirSync(dir), [path.basename(f)]);
});

test("암호문 손상 - 읽기와 쓰기가 실패하고 파일을 덮어쓰지 않는다", async () => {
  const dir = path.join(tmp(), "e"), root = project(), cipher = fakeCipher();
  const s = createEnvStore({ dir, cipher });
  await s.create(root, "A", "va");
  const f = path.join(dir, readdirSync(dir)[0]);
  const body = JSON.parse(readFileSync(f, "utf8"));
  body.entries[0].cipher = Buffer.from("garbage").toString("base64");
  writeFileSync(f, JSON.stringify(body));
  assert.strictEqual(await code(s.resolveForRun(root, ["A"])), "corrupt");
  writeFileSync(f, "{not json");
  assert.deepStrictEqual(await Promise.all([code(s.list(root)), code(s.create(root, "B", "v"))]), ["corrupt", "corrupt"]);
  assert.strictEqual(readFileSync(f, "utf8"), "{not json");
});

test("저장 실패(디렉터리를 못 만듦) - io 오류이고 값이 오류에 없다", async () => {
  const blocker = path.join(tmp(), "file");
  writeFileSync(blocker, "x");
  const s = createEnvStore({ dir: path.join(blocker, "sub"), cipher: fakeCipher() });
  try {
    await s.create(project(), "A", "SECRET-IO-VALUE");
    assert.fail("던져야 한다");
  } catch (e) {
    assert.strictEqual((e as EnvError).code, "io");
    assert.ok(!String(e).includes("SECRET-IO-VALUE"));
  }
});

// ── 브리지 ────────────────────────────────────────────────────────────────

async function bridge() {
  const dir = path.join(tmp(), "e"), secret = "bridge-secret", logs: string[] = [];
  const store = createEnvStore({ dir, cipher: fakeCipher() });
  const { server, port } = await createEnvBridge({ store, secret, log: (l) => logs.push(l) }).listen();
  const base = `http://127.0.0.1:${port}`;
  const tokenFor = async (root: string) => deriveToken(secret, (await resolveProject(root)).key);
  const call = async (method: string, op: string, root: string, token: string | null, extra: object = {}, headers = {}) => {
    const h: Record<string, string> = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    const url = method === "GET" ? `${base}/env/v1/${op}?project=${encodeURIComponent(root)}` : `${base}/env/v1/${op}`;
    if (method === "POST") h["content-type"] = "application/json";
    const res = await fetch(url, { method, headers: h, body: method === "POST" ? JSON.stringify({ project: root, ...extra }) : undefined });
    return { status: res.status, text: await res.text() };
  };
  return { server, call, tokenFor, logs, dir, store };
}

test("브리지 - 관리 흐름은 메타데이터만 돌려주고 시험 값이 응답 로그 파일에 없다", async () => {
  const b = await bridge(), root = project(), t = await b.tokenFor(root);
  const V = "ENV2-UNIQUE-테스트값";
  try {
    const c = await b.call("POST", "create", root, t, { name: "API_KEY", value: V });
    assert.strictEqual(c.status, 200);
    const meta = JSON.parse(c.text);
    assert.deepStrictEqual(Object.keys(meta).sort(), ["name", "revision", "updatedAt"]);
    const l = await b.call("GET", "list", root, t);
    assert.deepStrictEqual(JSON.parse(l.text).items.map((x: { name: string }) => x.name), ["API_KEY"]);
    const dup = await b.call("POST", "create", root, t, { name: "API_KEY", value: V });
    assert.strictEqual(dup.status, 409);
    const rep = await b.call("POST", "replace", root, t, { name: "API_KEY", value: V + "2", expectedRevision: "stale" });
    assert.strictEqual(rep.status, 409);
    const del = await b.call("POST", "delete", root, t, { name: "API_KEY", expectedRevision: meta.revision });
    assert.strictEqual(del.status, 200);
    const all = [c.text, l.text, dup.text, rep.text, del.text, ...b.logs, ...readdirSync(b.dir).map((f) => readFileSync(path.join(b.dir, f), "utf8"))];
    assert.ok(all.every((s) => !s.includes("ENV2-UNIQUE")));
    assert.ok(b.logs.every((s) => !s.includes(t)));
  } finally {
    b.server.close();
  }
});

test("브리지 - 미인증 다른 프로젝트 경로 탈출 브라우저 요청 값 조회 경로를 거부한다", async () => {
  const b = await bridge(), a = project(), other = project(), ta = await b.tokenFor(a);
  try {
    assert.strictEqual((await b.call("GET", "list", a, null)).status, 401);
    assert.strictEqual((await b.call("GET", "list", a, "wrong")).status, 403);
    assert.strictEqual((await b.call("GET", "list", other, ta)).status, 403); // A의 토큰으로 B
    assert.strictEqual((await b.call("POST", "create", other, ta, { name: "X", value: "v" })).status, 403);
    assert.strictEqual((await b.call("GET", "list", path.join(a, "..", "..", "..", path.basename(path.dirname(path.dirname(other))), "q", ".dira"), ta)).status, 403);
    assert.strictEqual((await b.call("GET", "list", path.join(a, "..", "..", "nope"), ta)).status, 400);
    assert.strictEqual((await b.call("GET", "list", "relative", ta)).status, 400);
    assert.strictEqual((await b.call("GET", "list", a, ta, {}, { origin: "http://evil.example" })).status, 403);
    const port = (b.server.address() as { port: number }).port; // fetch는 Host를 못 바꾼다
    const status = await new Promise((r) =>
      get({ host: "127.0.0.1", port, path: `/env/v1/list?project=${encodeURIComponent(a)}`, headers: { host: "evil.example", authorization: `Bearer ${ta}` } }, (res) => r(res.statusCode)),
    );
    assert.strictEqual(status, 403); // DNS 리바인딩
    for (const op of ["get", "run", "value", "reveal"]) assert.strictEqual((await b.call("GET", op, a, ta)).status, 404);
    assert.strictEqual((await b.call("GET", "list", a, ta)).status, 200);
  } finally {
    b.server.close();
  }
});
