/** `vercel-link.ts` - VC-1, VC-2(가짜 Vercel 서버)와 연결 해제. */
import assert from "node:assert";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createVercelLink, normalizeOrigin } from "./vercel-link.ts";

const GOOD = "tok_good_SECRET_1", PASTED = "tok_pasted_SECRET_2";
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (p: string) => Buffer.from([...Buffer.from(p)].map((b) => b ^ 0x5a)),
  decryptString: (c: Buffer) => Buffer.from([...c].map((b) => b ^ 0x5a)).toString(),
};
const PROJS = [
  { id: "prj_a", name: "alpha", link: { org: "me", repo: "one" } },
  { id: "prj_b", name: "beta", link: { org: "me", repo: "two" } },
  { id: "prj_c", name: "gamma", link: { org: "me", repo: "two" } },
];

async function fake() {
  const seen: string[] = [];
  const srv = createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    seen.push(`${req.method} ${u.pathname}`);
    const ok = [GOOD, PASTED].includes((req.headers.authorization ?? "").slice(7));
    const send = (s: number, b: unknown) => { res.writeHead(s); res.end(JSON.stringify(b)); };
    if (!ok) return send(403, {});
    if (u.pathname === "/v2/user") return send(200, { user: { id: "u" } });
    if (u.pathname === "/v2/teams") return send(200, { teams: [] });
    if (u.pathname === "/v9/projects") return send(200, { projects: PROJS });
    const m = /^\/v9\/projects\/(.+)$/.exec(u.pathname);
    const p = m && PROJS.find((x) => x.id === m[1]);
    return p ? send(200, p) : send(404, {});
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { api: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, srv, seen };
}

function proj(t: string, name: string, pj?: string, where = "") {
  const root = path.join(t, name), q = path.join(root, ".dira");
  mkdirSync(q, { recursive: true });
  if (pj) {
    const d = path.join(root, where, ".vercel");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "project.json"), JSON.stringify({ projectId: pj, orgId: "user_1" }));
  }
  return q;
}

test("VC-1 - CLI 로그인 파일만으로 연결되고 없으면 로그인 필요, 붙여넣은 토큰으로 다시 연결되며 토큰은 어디에도 남지 않는다", async () => {
  const { api, srv, seen } = await fake();
  const t = mkdtempSync(path.join(tmpdir(), "vcl-"));
  const auth = path.join(t, "auth.json");
  const q = proj(t, "p1", "prj_a");
  const v = createVercelLink({ dir: path.join(t, "store"), cipher, api, authPaths: [auth] });
  assert.deepStrictEqual(await v.status(q), { state: "login_required" });
  assert.deepStrictEqual(await v.connect(q), { state: "login_required" });
  writeFileSync(auth, JSON.stringify({ token: GOOD }));
  assert.strictEqual((await v.status(q)).state, "unlinked");
  const r = await v.connect(q);
  assert.strictEqual(r.state, "connected");
  assert.strictEqual((await v.status(q)).state, "connected");
  // CLI 파일이 사라지면 다시 로그인 필요, 토큰을 붙여넣으면 연결된다.
  writeFileSync(auth, "{}");
  assert.strictEqual((await v.status(q)).state, "login_required");
  await assert.rejects(v.setToken("tok_bad"), { code: "unauthorized" });
  await v.setToken(PASTED);
  const r2 = await v.connect(q);
  assert.ok(r2.state === "connected" && r2.source === "token");
  // 토큰 문자열이 저장소 파일 어디에도 없다(암호문 포함).
  for (const f of readdirSync(path.join(t, "store"))) {
    const body = readFileSync(path.join(t, "store", f), "latin1");
    assert.ok(!body.includes("SECRET"), f);
  }
  assert.ok(!JSON.stringify([r, r2]).includes("SECRET"));
  // CLI 토큰이 거절되면 붙여넣은 토큰으로 넘어간다.
  writeFileSync(auth, JSON.stringify({ token: "expired" }));
  const r3 = await v.connect(q);
  assert.ok(r3.state === "connected" && r3.source === "token");
  assert.ok(seen.length > 0);
  srv.close();
});

test("VC-2 - project.json이 루트, 하위, 없음(origin 1개)이면 자동 연결하고 없음(2개)이면 후보 목록을 준다", async () => {
  const { api, srv } = await fake();
  const t = mkdtempSync(path.join(tmpdir(), "vcl-"));
  const auth = path.join(t, "auth.json");
  writeFileSync(auth, JSON.stringify({ token: GOOD }));
  const origins: Record<string, string> = {};
  const v = createVercelLink({
    dir: path.join(t, "store"), cipher, api, authPaths: [auth],
    origin: async (cwd) => origins[path.basename(cwd)] ?? null,
  });
  const a = proj(t, "root", "prj_a");
  const b = proj(t, "sub", "prj_b", "apps/teams");
  const c = proj(t, "orig1"); origins.orig1 = "git@github.com:Me/One.git";
  const d = proj(t, "orig2"); origins.orig2 = "https://github.com/me/two";
  const ra = await v.connect(a), rb = await v.connect(b), rc = await v.connect(c), rd = await v.connect(d);
  assert.ok(ra.state === "connected" && ra.project.projectId === "prj_a" && ra.project.path === ".vercel/project.json");
  assert.ok(rb.state === "connected" && rb.project.projectId === "prj_b" && rb.project.path === "apps/teams/.vercel/project.json");
  assert.ok(rc.state === "connected" && rc.project.projectId === "prj_a" && rc.project.path === "origin");
  assert.ok(rd.state === "choose" && rd.candidates.map((x) => x.projectId).join() === "prj_b,prj_c");
  // 목록에서 고르면 연결된다.
  const re = await v.connect(d, "prj_c");
  assert.ok(re.state === "connected" && re.project.projectId === "prj_c");
  assert.strictEqual(normalizeOrigin("git@github.com:Me/One.git"), "me/one");
  srv.close();
});

test("연결 해제 - 상태 파일만 지우고 토큰 보관분과 다른 프로젝트 상태는 남긴다", async () => {
  const { api, srv } = await fake();
  const t = mkdtempSync(path.join(tmpdir(), "vcl-"));
  const auth = path.join(t, "auth.json");
  writeFileSync(auth, JSON.stringify({ token: GOOD }));
  const v = createVercelLink({ dir: path.join(t, "store"), cipher, api, authPaths: [auth] });
  const a = proj(t, "a", "prj_a"), b = proj(t, "b", "prj_b");
  await v.setToken(PASTED);
  await v.connect(a); await v.connect(b);
  assert.deepStrictEqual(await v.disconnect(a), { ok: true });
  assert.strictEqual((await v.status(a)).state, "unlinked");
  assert.strictEqual((await v.status(b)).state, "connected");
  assert.ok(readdirSync(path.join(t, "store")).includes("vercel-token.enc"));
  srv.close();
});
