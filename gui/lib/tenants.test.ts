import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// 진짜 레지스트리(~/.config/fs-tickets/gui-tenants.json)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  addTenant,
  createPersona,
  deletePersona,
  getTenant,
  listPersonas,
  readSummary,
  readTenants,
  registryPath,
  removeTenant,
  savePersona,
  slugify,
  renameTenant,
  reorderTenants,
  resolveConfig,
  usingDefault,
} = await import("./tenants.ts");
const { filterTickets, listTickets } = await import("./queue.ts");
const { tenantPath } = await import("./urls.ts");

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
  assert.deepStrictEqual(c.unresolved, []); // 못 읽은 라인이 없다 = 해석 실패도 없다
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

test("resolveConfig — 해석 불가 변수는 기본값 + unresolved(assumed 아니다)", async () => {
  const root = newQueue({
    "w1.sh":
      'TICKET_CWD="$TICKET_ROOT/../wt/w1"\nTICKET_PERSONAS="$UNSET_VAR/personas"\nTICKET_DONE=\n',
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.cwd, path.dirname(root)); // 셸을 실행하지 않으므로 못 읽는다
  assert.strictEqual(c.personas, path.join(root, "personas"));
  assert.deepStrictEqual(c.cwdByWorker, {}); // 해석 못 한 값은 목록에도 담지 않는다
  // 못 읽은 것은 unresolved에만. 값이 아예 없는 키(done=빈 값, protocols·inProgress=없는 줄)만 assumed.
  assert.deepStrictEqual(c.unresolved, [
    { key: "personas", raw: 'TICKET_PERSONAS="$UNSET_VAR/personas"', worker: "w1" },
    { key: "cwd", raw: 'TICKET_CWD="$TICKET_ROOT/../wt/w1"', worker: "w1" },
  ]);
  assert.deepStrictEqual(c.assumed.sort(), ["done", "inProgress", "protocols"]);
  assert.ok(usingDefault(c, "personas") && usingDefault(c, "done")); // 다른 화면은 둘을 안 가른다
});

test("resolveConfig — 명령 치환·백틱·상대경로는 실효값이 되지 않는다 (ce40243f)", async () => {
  const root = newQueue({
    "w1.sh": [
      'TICKET_PERSONAS="$(id -un)"', // 명령 치환 — 셸을 안 돌리니 원문이 남는다
      "TICKET_PROTOCOLS=`whoami`", // 백틱도 같다
      "TICKET_CWD=../wt/w1", // 절대경로가 아니다 → 서버 cwd(gui/) 기준으로 풀린다
      "TICKET_INPROGRESS=.wip", // 경로가 아닌 키는 상대여도 정상값이다
      "",
    ].join("\n"),
  });
  const c = await resolveConfig({ root });
  // 셋 다 기본값을 쓴다 — 원문이 기준 디렉터리가 되면 gui/ 밑에 쓴다
  assert.strictEqual(c.personas, path.join(root, "personas"));
  assert.strictEqual(c.protocols, path.join(root, "protocols"));
  assert.strictEqual(c.cwd, path.dirname(root));
  assert.deepStrictEqual(c.cwdByWorker, {});
  assert.strictEqual(c.inProgress, ".wip"); // 상대경로 규칙에 휘말리지 않는다
  assert.deepStrictEqual(c.unresolved, [
    { key: "personas", raw: 'TICKET_PERSONAS="$(id -un)"', worker: "w1" },
    { key: "protocols", raw: "TICKET_PROTOCOLS=`whoami`", worker: "w1" },
    { key: "cwd", raw: "TICKET_CWD=../wt/w1", worker: "w1" },
  ]);
  assert.deepStrictEqual(c.assumed, ["done"]); // 있는데 못 읽은 것은 assumed가 아니다
  assert.ok(usingDefault(c, "personas") && usingDefault(c, "protocols")); // 화면에 [해석 실패]
});

test("resolveConfig — 한 워커만 못 읽으면 값은 다른 워커 것 + unresolved에 남는다", async () => {
  const root = newQueue({
    "w1.sh": 'TICKET_PERSONAS="$UNSET_VAR/personas"\n',
    "w2.sh": 'TICKET_PERSONAS="$HOME/p"\n',
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.personas, path.join(homedir(), "p"));
  assert.ok(!c.assumed.includes("personas")); // 기본값을 쓴 게 아니다
  // 엔진은 셸을 실행하므로 w1에 물린 티켓은 우리가 못 본 경로를 쓴다 — 그 사실을 남긴다
  assert.deepStrictEqual(c.unresolved, [
    { key: "personas", raw: 'TICKET_PERSONAS="$UNSET_VAR/personas"', worker: "w1" },
  ]);
});

test("resolveConfig — 워커 2개 값이 갈리면 conflicts + 첫 워커 값", async () => {
  const root = newQueue({
    "w1.sh": 'TICKET_INPROGRESS=".wip"\nTICKET_PERSONAS="$HOME/p"\n',
    "w2.sh": 'TICKET_INPROGRESS="-진행중"\nTICKET_PERSONAS="$HOME/p"\n',
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.inProgress, ".wip");
  assert.deepStrictEqual(c.conflicts, [
    { key: "inProgress", byWorker: { w1: ".wip", w2: "-진행중" } },
  ]);
  assert.strictEqual(c.personas, path.join(homedir(), "p")); // 같은 값은 충돌이 아니다
});

test("resolveConfig — TICKET_CWD가 갈리는 건 정상: conflicts 없음 + cwdByWorker", async () => {
  const root = newQueue({
    "w1.sh": 'TICKET_CWD="$HOME/wt/w1"\n',
    "w2.sh": 'TICKET_CWD="$HOME/wt/w2"\n',
  });
  const c = await resolveConfig({ root });
  assert.deepStrictEqual(c.conflicts, []); // 워커마다 자기 워크트리 = 경고할 예외가 아니다
  assert.deepStrictEqual(c.cwdByWorker, {
    w1: path.join(homedir(), "wt/w1"),
    w2: path.join(homedir(), "wt/w2"),
  });
  assert.strictEqual(c.cwd, path.join(homedir(), "wt/w1")); // 한 경로가 필요한 호출자용
  assert.ok(!c.assumed.includes("cwd"));
});

test("resolveConfig — 워커 하나뿐이어도 cwdByWorker에 담는다", async () => {
  const root = newQueue({ "w1.sh": 'TICKET_CWD="$HOME/wt/w1"\n' });
  const c = await resolveConfig({ root });
  assert.deepStrictEqual(c.cwdByWorker, { w1: path.join(homedir(), "wt/w1") });
});

// ── 레지스트리 ──────────────────────────────────────────────────────────────

test("레지스트리 — 등록 검증 4종", async () => {
  assert.deepStrictEqual(await readTenants(), []); // 파일 없음 = 온보딩

  const root = newQueue({ "w1.sh": "" });
  // 한글 이름은 슬러그가 빈다 -> 자동으로 지어내지 않고 거부한다(URL 조각을 직접 받는다)
  assert.strictEqual(slugify("스트림"), "");
  assert.strictEqual(slugify("fs-tickets 자체!!"), "fs-tickets");
  await assert.rejects(() => addTenant("스트림", root), { code: "needId" });

  const t = await addTenant("스트림", root, "stream");
  // 저장되는 root는 realpath된 것이다(macOS의 /tmp -> /private/tmp)
  assert.strictEqual(t.root, await import("node:fs/promises").then((fs) => fs.realpath(root)));
  assert.strictEqual(t.id, "stream");
  assert.strictEqual((await getTenant(t.id))!.name, "스트림");

  // 실패 문구는 사용자에게 그대로 보인다(DESIGN.md §7 문구 표) — code로 필드 귀속까지 검사한다.
  // 1. 디렉터리 존재
  await assert.rejects(() => addTenant("x", path.join(root, "없는디렉터리")), {
    code: "root",
    message: /없습니다\. 절대경로가 맞는지, 마운트가 연결돼 있는지/,
  });
  // 2. tickets/ 또는 workers/
  const empty = mkdtempSync(path.join(tmpdir(), "fst-empty-"));
  roots.push(empty);
  await assert.rejects(() => addTenant("x", empty), { code: "root", message: /tickets\/도/ });
  // 3. root 중복 — 폼이 링크를 붙이므로 그 테넌트를 실어 보낸다
  await assert.rejects(() => addTenant("다른 이름", root), (e: unknown) => {
    const err = e as { code: string; message: string; dup: { id: string } };
    assert.strictEqual(err.code, "dupRoot");
    assert.match(err.message, /이미 스트림으로 등록돼 있습니다/);
    assert.strictEqual(err.dup.id, "stream");
    return true;
  });
  // 4. id 중복 — 이름에서 나온 슬러그든 손으로 넣은 것이든 다시 검증한다
  const other = newQueue({ "w1.sh": "" });
  await assert.rejects(() => addTenant("x", other, t.id), {
    code: "dupId",
    message: /URL 조각 stream가 이미 쓰이고 있습니다/,
  });
  await assert.rejects(() => addTenant("스트림", other, "대문자ID"), { code: "badId" });
  await assert.rejects(() => addTenant("스트림", other, "a".repeat(41)), { code: "badId" });

  // 절대경로 아님
  await assert.rejects(() => addTenant("x", "relative/path"), {
    code: "root",
    message: /절대경로/,
  });
  await assert.rejects(() => addTenant("  ", root), { code: "name" });
});

test("tenantPath — 전환은 같은 화면 종류를 유지한다", () => {
  assert.strictEqual(tenantPath("/t/a/workers", "b"), "/t/b/workers");
  assert.strictEqual(tenantPath("/t/a", "b"), "/t/b");
  assert.strictEqual(tenantPath("/t/a/", "b"), "/t/b");
  assert.strictEqual(tenantPath("/t/a/protocols/AGENTS.md", "b"), "/t/b/protocols/AGENTS.md");
  assert.strictEqual(tenantPath("/t/a/tickets/new", "b"), "/t/b/tickets/new");
  // 해시는 테넌트마다 독립이다 — 옮겨 붙이면 없는 티켓을 열게 되므로 보드로 떨어뜨린다
  assert.strictEqual(tenantPath("/t/a/tickets/7b3e0c62", "b"), "/t/b");
  // 테넌트 스코프가 아닌 곳(테넌트 목록)에서 골랐으면 그 테넌트의 보드로
  assert.strictEqual(tenantPath("/", "b"), "/t/b");
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

// ── 페르소나 ────────────────────────────────────────────────────────────────
//
// **`<루트>/personas`를 가정하면 틀린다**는 것 자체를 검증한다: 워커가 `TICKET_PERSONAS`를
// 루트 밖으로 돌린 큐를 만들고, 루트 안에는 미끼 페르소나(`wrong`)를 둔다. 가정으로 만든 코드는
// 미끼를 목록에 띄우고 미끼를 편집한다.
test("페르소나 — 재정의된 TICKET_PERSONAS 기준으로 목록·생성·저장·삭제", async () => {
  const root = newQueue({ "w1.sh": "" });
  const outside = path.join(path.dirname(root), "team-personas"); // 루트 밖
  writeFileSync(path.join(root, "workers", "w1.sh"), `TICKET_PERSONAS="${outside}"\n`);
  mkdirSync(path.join(outside, "developer"), { recursive: true });
  writeFileSync(path.join(outside, "developer", "PROFILE.md"), "# Developer\n내 일은…\n");
  mkdirSync(path.join(outside, "qa")); // 디렉터리만 있고 PROFILE.md가 없다
  mkdirSync(path.join(outside, "이름규칙밖")); // 엔진이 못 쓰는 이름 = 목록에 없다
  mkdirSync(path.join(root, "personas", "wrong"), { recursive: true }); // 미끼
  writeFileSync(path.join(root, "personas", "wrong", "PROFILE.md"), "미끼\n");

  const fm = (h: string, p: string, sfx = "") =>
    writeFileSync(
      path.join(root, "tickets", `${h}${sfx}.md`),
      `---\nticket: ${h}\npersona: ${p}\n---\n본문\n`,
    );
  fm("aaaa1111", "developer");
  fm("bbbb2222", "developer", ".wip");
  fm("cccc3333", "designer"); // 디렉터리가 아예 없다 — 엔진의 WARN 케이스

  const config = await resolveConfig({ root });
  assert.strictEqual(config.personas, outside); // 가정이 아니라 해석된 값
  const tickets = await listTickets(root, config);
  const list = await listPersonas(config.personas, tickets);

  assert.deepStrictEqual(
    list.map((p) => p.name),
    ["designer", "developer", "qa"], // 미끼(wrong)도 이름규칙밖도 없다
  );
  // 보드 필터도 **이 목록**을 쓴다(자기 `readdir` 없다). 그래서 선택지에 남는 이름은
  // 프로필이 없어도 고르면 실제로 걸러지고, 이름규칙밖은 애초에 선택지가 아니다.
  assert.deepStrictEqual(
    filterTickets(tickets, { kind: [], persona: ["designer"], status: [], q: "" }).map(
      (t) => t.hash,
    ),
    ["cccc3333"],
  );

  const developer = list.find((p) => p.name === "developer")!;
  assert.match(developer.body!, /^# Developer/);
  assert.deepStrictEqual(developer.refs, { open: 1, wip: 1, total: 2 });
  // 프로필 없는 두 종류: 디렉터리만 있는 것(qa)과 티켓만 부르는 것(designer)
  assert.deepStrictEqual(
    list.filter((p) => p.body === null).map((p) => [p.name, p.refs.total]),
    [
      ["designer", 1],
      ["qa", 0],
    ],
  );

  // 저장 = 없으면 생성. 파일은 **재정의된 디렉터리** 아래에 생긴다
  await savePersona(config.personas, "designer", "# Designer\n");
  assert.strictEqual(
    readFileSync(path.join(outside, "designer", "PROFILE.md"), "utf8"),
    "# Designer\n",
  );
  await createPersona(config.personas, "ops");
  assert.strictEqual(readFileSync(path.join(outside, "ops", "PROFILE.md"), "utf8"), "# ops\n");
  // O_EXCL — 있는 프로필을 덮지 않는다
  await assert.rejects(() => createPersona(config.personas, "ops"), /EEXIST/);

  await deletePersona(config.personas, "qa");
  assert.strictEqual(existsSync(path.join(outside, "qa")), false);
  assert.strictEqual(existsSync(path.join(outside, "developer", "PROFILE.md")), true);
  // 미끼는 처음부터 끝까지 안 건드린다 — 기준 디렉터리가 루트가 아니라는 증거
  assert.strictEqual(readFileSync(path.join(root, "personas", "wrong", "PROFILE.md"), "utf8"), "미끼\n");
});

test("페르소나 — 이름 규칙과 심링크 탈출은 서버에서 거부한다", async () => {
  const root = newQueue({ "w1.sh": "" });
  const dir = path.join(root, "personas");
  mkdirSync(dir, { recursive: true });
  const secret = mkdtempSync(path.join(tmpdir(), "fst-secret-"));
  roots.push(secret);
  writeFileSync(path.join(secret, "PROFILE.md"), "남의 파일\n");

  // 엔진이 이 이름으로 경로를 만든다 — `persona: ../../.ssh`가 프롬프트에 실려 나가는 걸 막는 규칙
  for (const bad of ["../../.ssh", "..", "a/b", "", "이름", "a b"]) {
    await assert.rejects(() => savePersona(dir, bad, "x"), /영문·숫자·_·- 만 됩니다/);
    await assert.rejects(() => deletePersona(dir, bad), /영문·숫자·_·- 만 됩니다/);
  }

  // 이름 규칙을 통과해도 문자열을 믿지 않는다: 심링크는 문자열 비교로 못 막는다
  symlinkSync(secret, path.join(dir, "evil"));
  await assert.rejects(() => savePersona(dir, "evil", "덮어쓰기"), /기준 디렉터리 밖이다/);
  await assert.rejects(() => deletePersona(dir, "evil"), /기준 디렉터리 밖이다/);
  assert.strictEqual(readFileSync(path.join(secret, "PROFILE.md"), "utf8"), "남의 파일\n");
});

test("readSummary — 연결됨은 카운트, 연결 안 됨은 사유 원문 + 카운트 없음", async () => {
  const root = newQueue({ "w1.sh": "" });
  writeFileSync(path.join(root, "tickets", "aaaa1111.md"), "---\nticket: aaaa1111\n---\n");
  writeFileSync(path.join(root, "tickets", "bbbb2222.done.md"), "---\nticket: bbbb2222\n---\n");

  const ok = await readSummary({ root });
  assert.strictEqual(ok.connected, true);
  assert.strictEqual(ok.open, 1); // .done은 열림이 아니다
  assert.deepStrictEqual(ok.workers.map((w) => w.name), ["w1"]);

  // 경로가 사라진 테넌트: 0건이 아니라 "모른다"다(DESIGN.md §4-1)
  const gone = await readSummary({ root: path.join(root, "없는디렉터리") });
  assert.strictEqual(gone.connected, false);
  assert.strictEqual(gone.open, null);
  assert.match(gone.error!, /ENOENT/);
});
