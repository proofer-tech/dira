/** `vercel-sync.ts` - VC-3, VC-4, VC-5 (가짜 Vercel env API). */
import assert from "node:assert";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createEnvStore } from "./env-store.ts";
import { createVercelLink } from "./vercel-link.ts";
import { createVercelSync } from "./vercel-sync.ts";

const TOK = "tok_SECRETTOKEN";
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (p: string) => Buffer.from([...Buffer.from(p)].map((b) => b ^ 0x5a)),
  decryptString: (c: Buffer) => Buffer.from([...c].map((b) => b ^ 0x5a)).toString(),
};
type R = { id: string; key: string; type: string; target: string[]; gitBranch?: string; value: string; updatedAt: number };

const x_deploys: Record<string, unknown>[] = [];
async function setup() {
  let clock = 1_000_000, n = 0;
  const recs: R[] = [];
  let down = false;
  const add = (key: string, type: string, target: string[], value: string, gitBranch?: string) =>
    recs.push({ id: `env_${++n}`, key, type, target, value, gitBranch, updatedAt: ++clock });
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const send = (s: number, b: unknown) => { res.writeHead(s); res.end(JSON.stringify(b)); };
      if (down) return req.socket.destroy();
      if (req.headers.authorization !== `Bearer ${TOK}`) return send(403, {});
      const b = body ? JSON.parse(body) : {};
      if (u.pathname === "/v2/user") return send(200, {});
      if (u.pathname === "/v6/deployments") return send(200, { deployments: [{ uid: "dpl_1", name: "prj" }] });
      if (u.pathname === "/v13/deployments") { x_deploys.push(b); return send(200, {}); }
      if (u.pathname === "/v9/projects/prj") return send(200, { id: "prj", name: "prj" });
      if (u.pathname === "/v10/projects/prj/env" && req.method === "GET") {
        return send(200, { envs: recs.map((r) => ({ ...r, value: r.type === "plain" ? r.value : "ENC" })) });
      }
      if (u.pathname === "/v10/projects/prj/env" && req.method === "POST") {
        const dup = recs.find((r) => r.key === b.key && !r.gitBranch && r.target.some((t) => b.target.includes(t)));
        if (dup) { Object.assign(dup, { value: b.value, type: b.type, updatedAt: ++clock }); return send(200, dup); }
        add(b.key, b.type, b.target, b.value);
        return send(200, {});
      }
      const m = /^\/v\d+\/projects\/prj\/env\/(.+)$/.exec(u.pathname);
      const r = m && recs.find((x) => x.id === m[1]);
      if (!r) return send(404, {});
      if (req.method === "GET") return send(200, { value: r.value });
      if (req.method === "DELETE") { recs.splice(recs.indexOf(r), 1); return send(200, {}); }
      Object.assign(r, b, { updatedAt: ++clock });
      return send(200, r);
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const t = mkdtempSync(path.join(tmpdir(), "vcs-"));
  const api = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const auth = path.join(t, "auth.json");
  writeFileSync(auth, JSON.stringify({ token: TOK }));
  mkdirSync(path.join(t, "proj", ".vercel"), { recursive: true });
  writeFileSync(path.join(t, "proj", ".vercel", "project.json"), JSON.stringify({ projectId: "prj", orgId: "user_1" }));
  mkdirSync(path.join(t, "proj", ".dira"));
  const root = path.join(t, "proj", ".dira");
  // dira 시계도 가짜로 두어 "늦은 쪽" 판정을 정한다.
  let dclock = Date.parse("2026-10-11T00:00:00Z");
  const dir = path.join(t, "store");
  const store = createEnvStore({ dir, cipher, now: () => new Date((dclock += 1000)) });
  const link = createVercelLink({ dir, cipher, api, authPaths: [auth] });
  const logs: string[] = [];
  const sync = createVercelSync({ dir, store, link, now: () => new Date(dclock) });
  assert.strictEqual((await link.connect(root)).state, "connected");
  // 시계 규칙: Vercel updatedAt(ms)은 dira 시계보다 항상 과거로 둔다 - 테스트가 dclock으로 늦은 쪽을 정한다.
  const vnew = () => (clock = dclock + 10_000_000);
  // 저장소가 쓰는 임시 시계 기준으로 Vercel 레코드를 만들 때 쓴다.
  return { srv, recs, add, root, store, sync, dir, logs, link, down: (x: boolean) => (down = x), vnew, dnow: () => dclock, setClock: (x: number) => (clock = x) };
}

const rec = (recs: R[], key: string) => recs.filter((r) => r.key === key);

test("VC-3 - encrypted는 가져오고 sensitive는 Vercel에만 있음이며 시스템 변수와 예약 이름은 가져오지 않고 가져온 값이 run에 production 값으로 들어간다", async () => {
  const x = await setup();
  x.add("DB_URL", "encrypted", ["production"], "prod-value");
  x.add("DB_URL", "encrypted", ["preview"], "prev-value");
  x.add("API_KEY", "sensitive", ["production", "preview"], "hidden");
  x.add("VERCEL_URL", "plain", ["production"], "x.vercel.app");
  x.add("NODE_OPTIONS", "plain", ["production"], "--x");
  const r = await x.sync.sync(x.root);
  assert.strictEqual(r.ok, true);
  const info = await x.sync.info(x.root);
  assert.deepStrictEqual(info.items.map((i) => [i.name, i.sync?.kind]), [["DB_URL", "synced"]]);
  assert.deepStrictEqual(info.vercelOnly, [
    { name: "API_KEY", kind: "vercel_only" },
    { name: "VERCEL_URL", kind: "skipped", reason: "vercel_system" },
    { name: "NODE_OPTIONS", kind: "skipped", reason: "reserved_name" },
  ].sort((a, b) => 0) as never);
  assert.deepStrictEqual(await x.store.resolveForRun(x.root, ["DB_URL"]), { DB_URL: "prod-value" });
  assert.ok(!JSON.stringify(info).includes("prod-value"));
  x.srv.close();
});

test("VC-4 - dira 추가 교체 삭제가 production+preview sensitive로 생기고 바뀌고 사라지며 development와 브랜치 레코드는 그대로이고 네트워크 실패는 반영 대기 뒤 다음 동기화에서 반영된다", async () => {
  const x = await setup();
  x.add("EXTRA", "encrypted", ["development"], "dev-only");
  x.add("EXTRA", "encrypted", ["production"], "branchy", "feature-x");
  const wrapped = async (fn: () => Promise<unknown>, name: string, del = false) => { await fn(); await x.sync.afterWrite(x.root, name, del); };
  const m = await x.store.create(x.root, "EXTRA", "v1");
  await x.sync.afterWrite(x.root, "EXTRA", false);
  const mine = x.recs.filter((r) => r.key === "EXTRA" && !r.gitBranch && r.type === "sensitive");
  assert.deepStrictEqual(mine.map((r) => [r.target.join("+"), r.value]), [["production+preview", "v1"]]);
  assert.ok(x.recs.some((r) => r.target.join() === "development" && r.value === "dev-only"));
  assert.ok(x.recs.some((r) => r.gitBranch === "feature-x" && r.value === "branchy"));
  // 교체
  const m2 = await x.store.replace(x.root, "EXTRA", "v2", m.revision);
  await x.sync.afterWrite(x.root, "EXTRA", false);
  assert.strictEqual(x.recs.find((r) => r.key === "EXTRA" && r.type === "sensitive")!.value, "v2");
  // 네트워크 실패 -> 반영 대기
  x.down(true);
  const m3 = await x.store.replace(x.root, "EXTRA", "v3", m2.revision);
  await x.sync.afterWrite(x.root, "EXTRA", false);
  assert.strictEqual((await x.sync.info(x.root)).items[0].sync?.kind, "pending");
  assert.strictEqual(x.recs.find((r) => r.key === "EXTRA" && r.type === "sensitive")!.value, "v2");
  x.down(false);
  assert.strictEqual((await x.sync.sync(x.root)).ok, true);
  assert.strictEqual(x.recs.find((r) => r.key === "EXTRA" && r.type === "sensitive")!.value, "v3");
  assert.strictEqual((await x.sync.info(x.root)).items[0].sync?.kind, "synced");
  // 삭제
  await x.store.delete(x.root, "EXTRA", (await x.store.list(x.root))[0].revision);
  await x.sync.afterWrite(x.root, "EXTRA", true);
  assert.deepStrictEqual(x.recs.filter((r) => r.key === "EXTRA").map((r) => r.value).sort(), ["branchy", "dev-only"]);
  assert.ok(m3.revision);
  x.srv.close();
});

test("VC-5 - Vercel 변경을 가져오고 양쪽 변경은 늦은 쪽을 따르며 충돌을 알리고 Vercel 삭제가 dira 삭제로 전파되고 sensitive 변경은 값 다시 입력 필요가 된다", async () => {
  const x = await setup();
  x.add("A", "encrypted", ["production", "preview"], "a1");
  x.add("B", "encrypted", ["production", "preview"], "b1");
  x.add("C", "encrypted", ["production", "preview"], "c1");
  await x.sync.sync(x.root);
  assert.deepStrictEqual(await x.store.resolveForRun(x.root, ["A", "B", "C"]), { A: "a1", B: "b1", C: "c1" });
  // dira가 쓴 sensitive 키
  await x.store.create(x.root, "S", "s1");
  await x.sync.afterWrite(x.root, "S", false);
  // 1) A: Vercel만 바뀜 -> dira가 따른다
  for (const r of rec(x.recs, "A")) { r.value = "a2"; r.updatedAt += 5; }
  // 2) B: 양쪽 변경, Vercel이 더 늦음
  const bRev = (await x.store.list(x.root)).find((i) => i.name === "B")!.revision;
  await x.store.replace(x.root, "B", "b-dira", bRev);
  for (const r of rec(x.recs, "B")) { r.value = "b-vercel"; r.updatedAt = x.dnow() + 10_000_000; }
  // 3) C: Vercel에서 삭제
  x.recs.splice(0, x.recs.length, ...x.recs.filter((r) => r.key !== "C"));
  // 4) S: Vercel에서 바뀜 (sensitive)
  for (const r of rec(x.recs, "S")) r.updatedAt += 7;
  assert.strictEqual((await x.sync.sync(x.root)).ok, true);
  assert.deepStrictEqual(await x.store.resolveForRun(x.root, ["A", "B", "S"]), { A: "a2", B: "b-vercel", S: "s1" });
  await assert.rejects(x.store.resolveForRun(x.root, ["C"]), { code: "not_found" });
  const info = await x.sync.info(x.root);
  const k = Object.fromEntries(info.items.map((i) => [i.name, i.sync]));
  assert.strictEqual(k.A?.kind, "synced");
  assert.strictEqual(k.B?.kind, "conflict");
  assert.strictEqual(k.B?.side, "vercel");
  assert.strictEqual(k.S?.kind, "reenter");
  assert.strictEqual(k.C, undefined);
  // 값 다시 입력하면 해소
  const sRev = (await x.store.list(x.root)).find((i) => i.name === "S")!.revision;
  await x.store.replace(x.root, "S", "s2", sRev);
  await x.sync.afterWrite(x.root, "S", false);
  assert.strictEqual((await x.sync.info(x.root)).items.find((i) => i.name === "S")!.sync?.kind, "synced");
  // 상태 파일과 응답에 값과 토큰이 없다.
  const sf = readFileSync(path.join(x.dir, readdirSync(x.dir).find((f) => f.startsWith("vercel-sync"))!), "utf8");
  assert.ok(!sf.includes(TOK) && !/a2|b-vercel|s1|s2/.test(sf));
  x.srv.close();
});

test("다시 배포 - 마지막 production 배포를 새로 만들고 배포 대기 표시를 지운다", async () => {
  const x = await setup();
  await x.store.create(x.root, "R", "r1");
  await x.sync.afterWrite(x.root, "R", false);
  assert.strictEqual((await x.sync.info(x.root)).vercel?.deployPending, true);
  assert.deepStrictEqual(await x.sync.redeploy(x.root), { ok: true });
  assert.deepStrictEqual(x_deploys.at(-1), { name: "prj", deploymentId: "dpl_1", target: "production" });
  assert.strictEqual((await x.sync.info(x.root)).vercel?.deployPending, false);
  x.srv.close();
});
