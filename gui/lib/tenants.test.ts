import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// 진짜 레지스트리(~/.config/fs-tickets/gui-tenants.json)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  addTenant,
  getTenant,
  readTenants,
  registryPath,
  removeTenant,
  slugify,
  renameTenant,
  reorderTenants,
  resolveConfig,
} = await import("./tenants.ts");

const roots: string[] = [];
process.on("exit", () => {
  roots.forEach((r) => rmSync(r, { recursive: true, force: true }));
  rmSync(LOCAL, { recursive: true, force: true });
});

/** `<프로젝트>/.fs-tickets` 모양의 큐를 만든다. workers는 {이름: 파일 내용}. */
function newQueue(workers: Record<string, string> | null): string {
  const proj = mkdtempSync(path.join(tmpdir(), "fst-proj-"));
  roots.push(proj);
  const root = path.join(proj, ".fs-tickets");
  mkdirSync(path.join(root, "tickets"), { recursive: true });
  if (workers) {
    mkdirSync(path.join(root, "workers"));
    for (const [name, body] of Object.entries(workers)) {
      writeFileSync(path.join(root, "workers", name), body);
    }
  }
  return root;
}

// ── resolveConfig ───────────────────────────────────────────────────────────

test("resolveConfig — 워커에 값 없음: 기본값 + assumed 전부", async () => {
  const root = newQueue({ "w1.sh": "#!/bin/bash\n. tick.sh\n" });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.personas, path.join(root, "personas"));
  assert.strictEqual(c.protocols, path.join(root, "protocols"));
  assert.strictEqual(c.inProgress, ".wip");
  assert.strictEqual(c.done, ".done");
  assert.strictEqual(c.cwd, path.dirname(root));
  assert.deepStrictEqual(c.assumed.sort(), ["cwd", "done", "inProgress", "personas", "protocols"]);
  assert.deepStrictEqual(c.conflicts, []);
});

test("resolveConfig — 워커 0개(디렉터리도 없음)", async () => {
  const root = newQueue(null);
  const c = await resolveConfig({ root });
  assert.strictEqual(c.personas, path.join(root, "personas"));
  assert.strictEqual(c.assumed.length, 5);
});

test("resolveConfig — $HOME 치환, 루트 밖 페르소나, 한글 접미사", async () => {
  const root = newQueue({
    "w1.sh": [
      "#!/bin/bash",
      '# TICKET_PERSONAS="$HOME/주석은/무시된다"',
      'TICKET_PERSONAS="$HOME/Projects/fs-tickets/docs/personas"',
      "TICKET_PROTOCOLS=${HOME}/Projects/fs-tickets/docs/protocols",
      'TICKET_INPROGRESS="-진행중"',
      "export TICKET_DONE='-완료'   # 작은따옴표 + 꼬리 주석",
      "",
    ].join("\n"),
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.personas, path.join(homedir(), "Projects/fs-tickets/docs/personas"));
  assert.strictEqual(c.protocols, path.join(homedir(), "Projects/fs-tickets/docs/protocols"));
  assert.strictEqual(c.inProgress, "-진행중");
  assert.strictEqual(c.done, "-완료");
  assert.deepStrictEqual(c.assumed, ["cwd"]); // cwd만 워커에 없다
});

test("resolveConfig — 해석 불가 변수는 기본값 + assumed(경고 근거)", async () => {
  const root = newQueue({
    "w1.sh": 'TICKET_CWD="$TICKET_ROOT/../wt/w1"\nTICKET_PERSONAS="$UNSET_VAR/personas"\n',
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.cwd, path.dirname(root)); // 셸을 실행하지 않으므로 못 읽는다
  assert.strictEqual(c.personas, path.join(root, "personas"));
  assert.ok(c.assumed.includes("cwd") && c.assumed.includes("personas"));
});

test("resolveConfig — 워커 2개 값이 갈리면 conflicts + 첫 워커 값", async () => {
  const root = newQueue({
    "w1.sh": 'TICKET_CWD="$HOME/wt/w1"\nTICKET_PERSONAS="$HOME/p"\n',
    "w2.sh": 'TICKET_CWD="$HOME/wt/w2"\nTICKET_PERSONAS="$HOME/p"\n',
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.cwd, path.join(homedir(), "wt/w1"));
  assert.deepStrictEqual(c.conflicts, [
    {
      key: "cwd",
      byWorker: { w1: path.join(homedir(), "wt/w1"), w2: path.join(homedir(), "wt/w2") },
    },
  ]);
  assert.strictEqual(c.personas, path.join(homedir(), "p")); // 같은 값은 충돌이 아니다
});

// ── 레지스트리 ──────────────────────────────────────────────────────────────

test("레지스트리 — 등록 검증 4종", async () => {
  assert.deepStrictEqual(await readTenants(), []); // 파일 없음 = 온보딩

  const root = newQueue({ "w1.sh": "" });
  // 한글 이름은 슬러그가 빈다 -> 자동으로 지어내지 않고 거부한다(URL 조각을 직접 받는다)
  assert.strictEqual(slugify("스트림"), "");
  assert.strictEqual(slugify("fs-tickets 자체!!"), "fs-tickets");
  await assert.rejects(() => addTenant("스트림", root), /URL 조각을 직접/);

  const t = await addTenant("스트림", root, "stream");
  // 저장되는 root는 realpath된 것이다(macOS의 /tmp -> /private/tmp)
  assert.strictEqual(t.root, await import("node:fs/promises").then((fs) => fs.realpath(root)));
  assert.strictEqual(t.id, "stream");
  assert.strictEqual((await getTenant(t.id))!.name, "스트림");

  // 1. 디렉터리 존재
  await assert.rejects(() => addTenant("x", path.join(root, "없는디렉터리")), /디렉터리가 없다/);
  // 2. tickets/ 또는 workers/
  const empty = mkdtempSync(path.join(tmpdir(), "fst-empty-"));
  roots.push(empty);
  await assert.rejects(() => addTenant("x", empty), /큐로 보이지 않는다/);
  // 3. root 중복
  await assert.rejects(() => addTenant("다른 이름", root), /같은 큐가 이미 등록/);
  // 4. id 중복 — 이름에서 나온 슬러그든 손으로 넣은 것이든 다시 검증한다
  const other = newQueue({ "w1.sh": "" });
  await assert.rejects(() => addTenant("x", other, t.id), /이미 있다/);
  await assert.rejects(() => addTenant("스트림", other, "대문자ID"), /형식이 틀렸다/);
  await assert.rejects(() => addTenant("스트림", other, "a".repeat(41)), /형식이 틀렸다/);

  // 절대경로 아님
  await assert.rejects(() => addTenant("x", "relative/path"), /절대경로/);
});

test("레지스트리 — 이름 변경 · 순서 변경 · 등록 해제", async () => {
  rmSync(registryPath(), { force: true });
  const a = await addTenant("에이", newQueue({ "w1.sh": "" }), "a");
  const b = await addTenant("비", newQueue({ "w1.sh": "" }), "b");
  assert.deepStrictEqual((await readTenants()).map((t) => t.id), ["a", "b"]);

  await renameTenant("a", "에이 새이름");
  assert.strictEqual((await getTenant("a"))!.name, "에이 새이름");

  await reorderTenants(["b", "a"]);
  assert.deepStrictEqual((await readTenants()).map((t) => t.id), ["b", "a"]);

  await removeTenant("b");
  assert.deepStrictEqual((await readTenants()).map((t) => t.id), ["a"]);
  // 등록 해제는 레지스트리만 건드린다 — 큐 파일은 그대로다
  assert.deepStrictEqual(await import("node:fs").then((fs) => fs.existsSync(b.root)), true);
  assert.ok(a.root);
});
