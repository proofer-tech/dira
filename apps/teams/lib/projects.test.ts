import { test } from "node:test";
import assert from "node:assert";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// 진짜 레지스트리(~/.config/dira/gui-projects.json)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  addProject,
  createPersona,
  createSquad,
  deletePersona,
  deleteSquad,
  getProject,
  isMultiTokenAllowed,
  listPersonas,
  listSquads,
  multiplayPath,
  multitokenPath,
  hasPushSh,
  ontologyInWorktree,
  readGateDirty,
  readMultiplay,
  readSummary,
  readProjects,
  registryPath,
  removeProject,
  saveSquadMembers,
  saveSquadRules,
  savePersona,
  setMultiplayEnabled,
  setMultitoken,
  setPersonaColor,
  slugify,
  squadNames,
  squadsDir,
  renameProject,
  reorderProjects,
  resolveConfig,
  usingDefault,
  validateOntologyInput,
} = await import("./projects.ts");
const { filterTickets, listTickets } = await import("./queue.ts");
const {
  decodeHash,
  elapsedSuffix,
  expandTilde,
  personaDotClass,
  projectPath,
  relativeUnder,
  PERSONA_COLORS,
} = await import("./urls.ts");

const roots: string[] = [];
process.on("exit", () => {
  roots.forEach((r) => rmSync(r, { recursive: true, force: true }));
  rmSync(LOCAL, { recursive: true, force: true });
});

/** `<프로젝트>/.dira` 모양의 큐를 만든다. workers는 {이름: 파일 내용}. */
function newQueue(workers: Record<string, string> | null): string {
  const proj = mkdtempSync(path.join(tmpdir(), "fst-proj-"));
  roots.push(proj);
  const root = path.join(proj, ".dira");
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
  assert.strictEqual(c.ontology, path.join(root, "ontology"));
  assert.deepStrictEqual(c.assumed.sort(), ["cwd", "done", "inProgress", "ontology", "personas", "protocols"]);
  assert.deepStrictEqual(c.conflicts, []);
  assert.deepStrictEqual(c.unresolved, []); // 못 읽은 라인이 없다 = 해석 실패도 없다
});

test("resolveConfig — 워커 0개(디렉터리도 없음)", async () => {
  const root = newQueue(null);
  const c = await resolveConfig({ root });
  assert.strictEqual(c.personas, path.join(root, "personas"));
  assert.strictEqual(c.assumed.length, 6);
});

test("resolveConfig — $HOME 치환, 루트 밖 페르소나, 한글 접미사", async () => {
  const root = newQueue({
    "w1.sh": [
      "#!/bin/bash",
      '# TICKET_PERSONAS="$HOME/주석은/무시된다"',
      'TICKET_PERSONAS="$HOME/Projects/dira/docs/personas"',
      "TICKET_PROTOCOLS=${HOME}/Projects/dira/docs/protocols",
      'TICKET_INPROGRESS="-진행중"',
      "export TICKET_DONE='-완료'   # 작은따옴표 + 꼬리 주석",
      "",
    ].join("\n"),
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.personas, path.join(homedir(), "Projects/dira/docs/personas"));
  assert.strictEqual(c.protocols, path.join(homedir(), "Projects/dira/docs/protocols"));
  assert.strictEqual(c.inProgress, "-진행중");
  assert.strictEqual(c.done, "-완료");
  assert.deepStrictEqual(c.assumed, ["cwd", "ontology"]); // cwd·ontology만 워커에 없다
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
  assert.deepStrictEqual(c.assumed.sort(), ["done", "inProgress", "ontology", "protocols"]);
  assert.ok(usingDefault(c, "personas") && usingDefault(c, "done")); // 다른 화면은 둘을 안 가른다
});

test("resolveConfig — 명령 치환·백틱·상대경로는 실효값이 되지 않는다 (ce40243f)", async () => {
  const root = newQueue({
    "w1.sh": [
      'TICKET_PERSONAS="$(id -un)"', // 명령 치환 — 셸을 안 돌리니 원문이 남는다
      "TICKET_PROTOCOLS=`whoami`", // 백틱도 같다
      "TICKET_CWD=../wt/w1", // 절대경로가 아니다 → 서버 cwd(apps/teams/) 기준으로 풀린다
      "TICKET_INPROGRESS=.wip", // 경로가 아닌 키는 상대여도 정상값이다
      "",
    ].join("\n"),
  });
  const c = await resolveConfig({ root });
  // 셋 다 기본값을 쓴다 — 원문이 기준 디렉터리가 되면 apps/teams/ 밑에 쓴다
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
  assert.deepStrictEqual(c.assumed, ["done", "ontology"]); // 있는데 못 읽은 것은 assumed가 아니다
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

// ── TICKET_ONTOLOGY (DESIGN.md §5-3 §온톨로지 자리를 워커가 재정의한다) ────────

test("resolveConfig — TICKET_ONTOLOGY 재정의: 큐 밖 절대경로를 그대로 쓴다", async () => {
  const root = newQueue({ "w1.sh": 'TICKET_ONTOLOGY="$HOME/vault/ontology"\n' });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.ontology, path.join(homedir(), "vault/ontology"));
  assert.ok(!c.assumed.includes("ontology"));
  assert.ok(!ontologyInWorktree(root, c.ontology)); // 큐 밖 절대경로 = 안전
});

test("resolveConfig — TICKET_ONTOLOGY 상대경로는 해석 실패(기본값 + unresolved)", async () => {
  const root = newQueue({ "w1.sh": "TICKET_ONTOLOGY=../vault\n" });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.ontology, path.join(root, "ontology")); // 기본값을 쓴다
  assert.deepStrictEqual(c.unresolved, [
    { key: "ontology", raw: "TICKET_ONTOLOGY=../vault", worker: "w1" },
  ]);
  assert.ok(!c.assumed.includes("ontology")); // 값은 있었다 — 없는 것과 다른 사실이다
});

test("resolveConfig — TICKET_ONTOLOGY 워커끼리 값이 갈리면 conflicts", async () => {
  const root = newQueue({
    "w1.sh": 'TICKET_ONTOLOGY="$HOME/vault-a"\n',
    "w2.sh": 'TICKET_ONTOLOGY="$HOME/vault-b"\n',
  });
  const c = await resolveConfig({ root });
  assert.strictEqual(c.ontology, path.join(homedir(), "vault-a")); // 첫 워커 값
  assert.deepStrictEqual(c.conflicts, [
    {
      key: "ontology",
      byWorker: { w1: path.join(homedir(), "vault-a"), w2: path.join(homedir(), "vault-b") },
    },
  ]);
});

test("resolveConfig — TICKET_ONTOLOGY가 워커 워크트리 안이면 ontologyInWorktree가 경고한다", async () => {
  const root = newQueue({ "w1.sh": "" });
  const insideWorktree = path.join(root, "worktrees", "w1", "ontology");
  const c = await resolveConfig({ root });
  assert.ok(!ontologyInWorktree(root, c.ontology)); // 기본값(<큐 루트>/ontology) — 안전
  assert.ok(ontologyInWorktree(root, insideWorktree)); // 워커 워크트리 — 경고
  assert.ok(ontologyInWorktree(root, path.join(path.dirname(root), "ontology-copy"))); // 주 체크아웃의 추적 트리 — 경고
  assert.ok(!ontologyInWorktree(root, path.join(homedir(), "vault"))); // 큐 밖 — 안전
});

// ── validateOntologyInput (§5-3 §온톨로지 자리를 워커가 재정의한다 §결정 2, 티켓 cd662a73) ──
// `root`를 realpath로 정규화한 뒤 쓴다 — 등록된 프로젝트의 root는 이미 그렇다(addProject가
// 등록 시점에 realpath한다). 안 하면 macOS의 $TMPDIR(`/var` → `/private/var` 심링크)에서
// 입력 쪽만 realpath되어 경계 비교가 갈린다.

test("validateOntologyInput — 절대경로 + 실재 + 워크트리 밖: realpath를 돌려준다", async () => {
  const root = realpathSync(newQueue({ "w1.sh": "" }));
  const vault = mkdtempSync(path.join(tmpdir(), "fst-vault-"));
  roots.push(vault);
  assert.strictEqual(await validateOntologyInput(root, vault), realpathSync(vault));
});

test("validateOntologyInput — 상대경로는 거절", async () => {
  const root = realpathSync(newQueue({ "w1.sh": "" }));
  await assert.rejects(validateOntologyInput(root, "../vault"), /절대경로여야 합니다/);
});

test("validateOntologyInput — 없는 디렉터리는 거절", async () => {
  const root = realpathSync(newQueue({ "w1.sh": "" }));
  await assert.rejects(
    validateOntologyInput(root, path.join(root, "no-such-dir")),
    /실재하는 디렉터리가 아닙니다/,
  );
});

test("validateOntologyInput — 워커 워크트리 안이면 거절", async () => {
  const root = realpathSync(newQueue({ "w1.sh": "" }));
  const inside = path.join(root, "worktrees", "w1", "ontology");
  mkdirSync(inside, { recursive: true });
  await assert.rejects(validateOntologyInput(root, inside), /git 작업 트리 안입니다/);
});

test("validateOntologyInput — 주 체크아웃의 추적 트리 직하도 거절", async () => {
  const root = realpathSync(newQueue({ "w1.sh": "" }));
  const inside = path.join(path.dirname(root), "ontology-copy");
  mkdirSync(inside, { recursive: true });
  await assert.rejects(validateOntologyInput(root, inside), /git 작업 트리 안입니다/);
});

test("validateOntologyInput — en 로케일이면 영어 문구", async () => {
  const root = realpathSync(newQueue({ "w1.sh": "" }));
  await assert.rejects(validateOntologyInput(root, "../vault", "en"), /Must be an absolute path/);
});

// ── 레지스트리 ──────────────────────────────────────────────────────────────

test("레지스트리 — 등록 검증 4종", async () => {
  assert.deepStrictEqual(await readProjects(), []); // 파일 없음 = 온보딩

  const root = newQueue({ "w1.sh": "" });
  // 한글 이름은 슬러그가 빈다 -> 자동으로 지어내지 않고 거부한다(URL 조각을 직접 받는다)
  assert.strictEqual(slugify("스트림"), "");
  assert.strictEqual(slugify("dira 자체!!"), "dira");
  await assert.rejects(() => addProject("스트림", root), { code: "needId" });

  const t = await addProject("스트림", root, "stream");
  // 저장되는 root는 realpath된 것이다(macOS의 /tmp -> /private/tmp)
  assert.strictEqual(t.root, await import("node:fs/promises").then((fs) => fs.realpath(root)));
  assert.strictEqual(t.id, "stream");
  assert.strictEqual((await getProject(t.id))!.name, "스트림");

  // 실패 문구는 사용자에게 그대로 보인다(DESIGN.md §7 문구 표) — code로 필드 귀속까지 검사한다.
  // 1. 디렉터리 존재
  await assert.rejects(() => addProject("x", path.join(root, "없는디렉터리")), {
    code: "root",
    message: /없습니다\. 절대경로가 맞는지, 마운트가 연결돼 있는지/,
  });
  // 2. tickets/ 또는 workers/
  const empty = mkdtempSync(path.join(tmpdir(), "fst-empty-"));
  roots.push(empty);
  await assert.rejects(() => addProject("x", empty), { code: "root", message: /tickets\/도/ });
  // 3. root 중복 — 폼이 링크를 붙이므로 그 프로젝트를 실어 보낸다
  await assert.rejects(() => addProject("다른 이름", root), (e: unknown) => {
    const err = e as { code: string; message: string; dup: { id: string } };
    assert.strictEqual(err.code, "dupRoot");
    assert.match(err.message, /이미 스트림으로 등록돼 있습니다/);
    assert.strictEqual(err.dup.id, "stream");
    return true;
  });
  // 4. id 중복 — 이름에서 나온 슬러그든 손으로 넣은 것이든 다시 검증한다
  const other = newQueue({ "w1.sh": "" });
  await assert.rejects(() => addProject("x", other, t.id), {
    code: "dupId",
    message: /URL 조각 stream가 이미 쓰이고 있습니다/,
  });
  await assert.rejects(() => addProject("스트림", other, "대문자ID"), { code: "badId" });
  await assert.rejects(() => addProject("스트림", other, "a".repeat(41)), { code: "badId" });

  // 절대경로 아님
  await assert.rejects(() => addProject("x", "relative/path"), {
    code: "root",
    message: /절대경로/,
  });
  await assert.rejects(() => addProject("  ", root), { code: "name" });
});

/** §0-19 — 등록도 생성과 같은 줄을 단다. `scaffold`는 별도 테스트(scaffold.test.ts)가 있으니
 *  여기서는 등록 경로(`addProject`)만 검증한다. */
test("addProject — .dira의 형제 .gitignore에 .dira 한 줄을 단다, 두 번째는 안 갈린다", async () => {
  const root = newQueue({ "w1.sh": "" });
  const project = path.dirname(root);

  await addProject("gi", root, "gi");
  const gitignore = path.join(project, ".gitignore");
  assert.strictEqual(readFileSync(gitignore, "utf8"), ".dira\n");

  // 같은 프로젝트를 다시 등록하면 dupRoot로 거부되지만, .gitignore는 이미 멱등이라 안 갈린다.
  await assert.rejects(() => addProject("gi2", root), { code: "dupRoot" });
  assert.strictEqual(readFileSync(gitignore, "utf8"), ".dira\n");
});

/** 쓰기가 막힌 디렉터리 — §0-19 네 갈래 넷째. 이 한 줄이 등록을 막는 사유가 되면 안 된다. */
test("addProject — 프로젝트 디렉터리 쓰기 금지(chmod 500)여도 등록은 성공한다", async (t) => {
  const root = newQueue({ "w1.sh": "" });
  const project = path.dirname(root);
  chmodSync(project, 0o500);
  t.after(() => chmodSync(project, 0o700)); // roots[] 정리(rmSync)가 쓰기 권한을 필요로 한다

  await addProject("막힌 곳", root, "blocked");
  assert.strictEqual((await getProject("blocked"))!.name, "막힌 곳");
  assert.ok(!existsSync(path.join(project, ".gitignore"))); // 쓰기가 실패했으니 파일도 없다
});

test("addProject — vendored 큐(CORE.md 있음)는 등록 시 엔진 코어로 미러링된다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  const engine = mkdtempSync(path.join(tmpdir(), "fst-engine-"));
  roots.push(engine);
  writeFileSync(path.join(engine, "tick.sh"), "");
  mkdirSync(path.join(engine, "protocols"));
  writeFileSync(path.join(engine, "protocols", "CORE.md"), "엔진 코어\n");
  process.env.DIRA_ENGINE = engine;

  const root = newQueue({ "w1.sh": "" });
  mkdirSync(path.join(root, "protocols"));
  writeFileSync(path.join(root, "protocols", "CORE.md"), "낡은 사본\n");

  await addProject("미러", root, "mirror-test");
  assert.strictEqual(readFileSync(path.join(root, "protocols", "CORE.md"), "utf8"), "엔진 코어\n");
});

test("projectPath — 전환은 같은 화면 종류를 유지한다", () => {
  assert.strictEqual(projectPath("/p/a/workers", "b"), "/p/b/workers");
  assert.strictEqual(projectPath("/p/a", "b"), "/p/b");
  assert.strictEqual(projectPath("/p/a/", "b"), "/p/b");
  assert.strictEqual(projectPath("/p/a/protocols/AGENTS.md", "b"), "/p/b/protocols/AGENTS.md");
  assert.strictEqual(projectPath("/p/a/personas", "b"), "/p/b/personas");
  // 해시는 프로젝트마다 독립이다 — 옮겨 붙이면 없는 티켓을 열게 되므로 보드로 떨어뜨린다
  assert.strictEqual(projectPath("/p/a/tickets/7b3e0c62", "b"), "/p/b");
  // 프로젝트 스코프가 아닌 곳(프로젝트 목록)에서 골랐으면 그 프로젝트의 보드로
  assert.strictEqual(projectPath("/", "b"), "/p/b");
});

/** a606dd0e — 보드는 `encodeURIComponent(t.hash)`로 링크를 걸고 Next는 세그먼트를 인코딩된
 *  원문으로 넘긴다. 이 왕복이 깨지면 한글 해시가 전부 404다. */
test("decodeHash — 보드가 인코딩한 해시를 그대로 되돌린다", () => {
  for (const h of ["7b3e0c62", "re-6544fd23", "순수한글", "한글파일명", "두 단어", "a+b"]) {
    assert.strictEqual(decodeHash(encodeURIComponent(h)), h, h);
  }
  // 인코딩이 깨진 URL은 던지지 않는다 — 없는 해시로 흘러가 404가 된다(500이 아니다)
  assert.strictEqual(decodeHash("%zz"), "%zz");
});

/** 경로 피커(§데스크톱 앱 N3)가 고른 절대경로를 입력칸 값으로 바꾸는 규칙. 스펙 파일은
 *  프로젝트 루트 상대이고 워커 컨텍스트는 `$TICKET_CWD` 접두를 되살리는데, 둘 다 이 두 함수가
 *  판정한다. **기준 밖은 절대경로 그대로**가 요건이다 — 피커는 값을 채울 뿐이고 유효성은
 *  서버가 종전대로 본다. `../`로 걸어 나가지 않는 것도 그래서다. */
test("relativeUnder · expandTilde — 기준 아래일 때만 줄인다", () => {
  const home = "/Users/x";
  assert.strictEqual(expandTilde("~/Projects/p", home), "/Users/x/Projects/p");
  assert.strictEqual(expandTilde("~", home), "/Users/x");
  assert.strictEqual(expandTilde("/abs/p", home), "/abs/p"); // 절대경로는 그대로
  assert.strictEqual(expandTilde("~notme/p", home), "~notme/p"); // `~user`는 안 편다

  const base = expandTilde("~/Projects/p", home);
  assert.strictEqual(relativeUnder("/Users/x/Projects/p/docs/D.md", base), "docs/D.md");
  assert.strictEqual(relativeUnder("/Users/x/Projects/p/D.md", base + "/"), "D.md"); // 끝 `/` 무해
  // 기준 밖 · 접두만 같은 형제 · 기준이 빈 값 — 셋 다 절대경로 그대로다
  assert.strictEqual(relativeUnder("/etc/hosts", base), "/etc/hosts");
  assert.strictEqual(relativeUnder("/Users/x/Projects/px/D.md", base), "/Users/x/Projects/px/D.md");
  assert.strictEqual(relativeUnder("/Users/x/D.md", ""), "/Users/x/D.md");
});

/** `답변 대기 · 0일`은 고장으로 읽힌다 — 0이면 경과를 붙이지 않는다(DESIGN.md §2 경과 표시 표). */
test("elapsedSuffix — 0일은 붙지 않는다", () => {
  assert.strictEqual(elapsedSuffix(0), "");
  assert.strictEqual(elapsedSuffix(undefined), "");
  assert.strictEqual(elapsedSuffix(3), " · 3일");
  assert.strictEqual(elapsedSuffix(120), " · 120일");
});

/** 팔레트 8색이 **전부** 클래스를 갖는다 — 하나가 표에서 빠지면 그 색을 고른 페르소나만
 *  조용히 빈 점이 된다(화면은 안 깨지므로 눈으로는 안 걸린다). 조립하지 않고 리터럴로 쓰는
 *  이유(Tailwind 정적 스캔)가 곧 빠뜨릴 수 있다는 뜻이라 여기서 고정한다.
 *  모르는 키·미할당이 빈 점인 것은 에러가 아니라 계약이다(DESIGN.md §비주얼 §12). */
test("personaDotClass — 팔레트 8색 전부 + 모르는 키는 빈 점", () => {
  for (const c of PERSONA_COLORS) assert.strictEqual(personaDotClass(c), `bg-persona-${c}`);
  const empty = "border border-muted-foreground";
  assert.strictEqual(personaDotClass(undefined), empty); // 미할당
  assert.strictEqual(personaDotClass(""), empty);
  assert.strictEqual(personaDotClass("mauve"), empty); // 레지스트리를 손으로 고친 오타
  assert.strictEqual(personaDotClass("toString"), empty); // 프로토타입 키가 새지 않는다
});

test("레지스트리 — 이름 변경 · 순서 변경 · 등록 해제", async () => {
  rmSync(registryPath(), { force: true });
  const a = await addProject("에이", newQueue({ "w1.sh": "" }), "a");
  const b = await addProject("비", newQueue({ "w1.sh": "" }), "b");
  assert.deepStrictEqual((await readProjects()).map((t) => t.id), ["a", "b"]);

  await renameProject("a", "에이 새이름");
  assert.strictEqual((await getProject("a"))!.name, "에이 새이름");

  await reorderProjects(["b", "a"]);
  assert.deepStrictEqual((await readProjects()).map((t) => t.id), ["b", "a"]);

  await removeProject("b");
  assert.deepStrictEqual((await readProjects()).map((t) => t.id), ["a"]);
  // 등록 해제는 레지스트리만 건드린다 — 큐 파일은 그대로다
  assert.deepStrictEqual(await import("node:fs").then((fs) => fs.existsSync(b.root)), true);
  assert.ok(a.root);
});

test("레지스트리 — personaColors 왕복 (DESIGN.md §5)", async () => {
  rmSync(registryPath(), { force: true });
  await addProject("색", newQueue({ "w1.sh": "" }), "c");
  const queueBefore = readdirSync(path.join((await getProject("c"))!.root));

  await setPersonaColor("c", "developer", "violet");
  await setPersonaColor("c", "qa", "teal");
  // 파일에서 다시 읽는다 — 메모리 객체가 아니라 왕복을 본다(새로고침 후에도 남는 근거)
  assert.deepStrictEqual((await getProject("c"))!.personaColors, {
    developer: "violet",
    qa: "teal",
  });

  // 덮어쓰기 · 지우기. 빈 맵은 키째 사라진다(한 번도 안 고른 프로젝트와 같아야 한다)
  await setPersonaColor("c", "developer", "pink");
  await setPersonaColor("c", "qa", null);
  assert.deepStrictEqual((await getProject("c"))!.personaColors, { developer: "pink" });
  await setPersonaColor("c", "developer", null);
  assert.strictEqual("personaColors" in (await getProject("c"))!, false);

  // 팔레트 밖 값·이름 규칙 밖은 서버가 거부한다 — 레지스트리에 쓰레기를 넣지 않는다
  await assert.rejects(() => setPersonaColor("c", "developer", "#ff0000"), /팔레트에 없는 색/);
  await assert.rejects(() => setPersonaColor("c", "../x", "pink"), /페르소나 이름이 아닙니다/);
  await assert.rejects(() => setPersonaColor("없는프로젝트", "developer", "pink"), /없는 프로젝트/);

  // 큐에는 아무것도 쓰지 않는다(§5) — 색은 레지스트리 파일 하나가 전부다
  await setPersonaColor("c", "developer", "sky");
  assert.deepStrictEqual(readdirSync(path.join((await getProject("c"))!.root)), queueBefore);
});

test("레지스트리 — 옛 gui-tenants.json을 읽고, 첫 쓰기가 새 파일로 옮긴다", async () => {
  const old = mkdtempSync(path.join(tmpdir(), "fst-old-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = old; // registryPath()는 호출마다 env를 읽는다
  try {
    const root = newQueue({ "w1.sh": "" });
    writeFileSync(
      path.join(old, "gui-tenants.json"),
      JSON.stringify({ version: 1, tenants: [{ id: "a", name: "에이", root }] }),
    );
    // 새 파일이 없으면 옛 파일(배열 키 `tenants`)에서 읽는다
    assert.deepStrictEqual((await readProjects()).map((t) => t.id), ["a"]);
    assert.strictEqual(existsSync(registryPath()), false);

    // 첫 쓰기가 새 파일로 옮겨 담는다 — 그 뒤로는 폴백을 타지 않는다
    await renameProject("a", "에이 둘");
    assert.strictEqual(existsSync(registryPath()), true);
    assert.deepStrictEqual(
      JSON.parse(readFileSync(registryPath(), "utf8")).projects.map((t: { name: string }) => t.name),
      ["에이 둘"],
    );
  } finally {
    process.env.TICKET_LOCAL = prev;
    rmSync(old, { recursive: true, force: true });
  }
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
    filterTickets(tickets, { kind: [], persona: ["designer"], status: [], q: "", epic: null }).map(
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

test("스쿼드 — 목록·생성·저장·삭제, 새 환경변수 없이 root/squads (DESIGN.md §5-5)", async () => {
  const root = newQueue({ "w1.sh": "" });
  const dir = squadsDir({ root });
  assert.strictEqual(dir, path.join(root, "squads")); // TICKET_SQUADS 같은 재정의가 없다

  // 첫 스쿼드를 만들기 전에는 squads/가 없는 게 기본이다 — 목록은 빈 배열이지 예외가 아니다
  assert.deepStrictEqual(await squadNames(dir), []);
  assert.deepStrictEqual(await listSquads(dir), []);

  await createSquad(dir, "frontend");
  assert.strictEqual(readFileSync(path.join(dir, "frontend", "members"), "utf8"), ""); // 빈 파일
  await assert.rejects(() => createSquad(dir, "frontend"), /EEXIST/); // O_EXCL

  // 저장 — 역할이 있으면 `<이름> <역할>`, 없으면 `<이름>` 한 줄, 목록 순서, 끝에 개행 하나
  await saveSquadMembers(dir, "frontend", [
    { name: "developer", role: "프론트를 맡는다" },
    { name: "designer", role: "" },
  ]);
  assert.strictEqual(
    readFileSync(path.join(dir, "frontend", "members"), "utf8"),
    "developer 프론트를 맡는다\ndesigner\n",
  );
  assert.deepStrictEqual(await squadNames(dir), ["frontend"]);
  assert.deepStrictEqual(await listSquads(dir), [
    {
      name: "frontend",
      members: [
        { name: "developer", role: "프론트를 맡는다" },
        { name: "designer", role: "" },
      ],
      rules: "",
    },
  ]);

  // 파서를 안 만든다 — 첫 공백 한 번만 자르고, 양끝 공백·빈 줄은 손으로 쓴 파일에서도 버려진다
  writeFileSync(path.join(dir, "frontend", "members"), "  developer  \n\nqa   프론트 리드  \n");
  assert.deepStrictEqual(
    (await listSquads(dir))[0].members,
    [
      { name: "developer", role: "" },
      { name: "qa", role: "프론트 리드" },
    ],
  );

  // 0개로 저장하면 빈 파일 — "멤버 0"으로 그냥 읽힌다
  await saveSquadMembers(dir, "frontend", []);
  assert.strictEqual(readFileSync(path.join(dir, "frontend", "members"), "utf8"), "");
  assert.deepStrictEqual((await listSquads(dir))[0].members, []);

  // `rules` — 사이드카 둘째. 빈 값으로 저장하면 파일이 없는 상태와 같다(§5-5 §개정)
  assert.strictEqual(existsSync(path.join(dir, "frontend", "rules")), false);
  await saveSquadRules(dir, "frontend", "PR은 작게 쪼갠다.");
  assert.strictEqual(
    readFileSync(path.join(dir, "frontend", "rules"), "utf8"),
    "PR은 작게 쪼갠다.",
  );
  assert.strictEqual((await listSquads(dir))[0].rules, "PR은 작게 쪼갠다.");
  await saveSquadRules(dir, "frontend", "");
  assert.strictEqual(existsSync(path.join(dir, "frontend", "rules")), false);
  assert.strictEqual((await listSquads(dir))[0].rules, "");

  await deleteSquad(dir, "frontend");
  assert.strictEqual(existsSync(path.join(dir, "frontend")), false);
});

test("스쿼드 — 이름 규칙과 심링크 탈출은 서버에서 거부한다", async () => {
  const root = newQueue({ "w1.sh": "" });
  const dir = squadsDir({ root });
  mkdirSync(dir, { recursive: true });
  const secret = mkdtempSync(path.join(tmpdir(), "fst-secret-"));
  roots.push(secret);
  writeFileSync(path.join(secret, "members"), "남의 파일\n");

  for (const bad of ["../../.ssh", "..", "a/b", "", "이름", "a b"]) {
    await assert.rejects(() => createSquad(dir, bad), /영문·숫자·_·- 만 됩니다/);
    await assert.rejects(() => saveSquadMembers(dir, bad, [{ name: "x", role: "" }]), /영문·숫자·_·- 만 됩니다/);
    await assert.rejects(() => deleteSquad(dir, bad), /영문·숫자·_·- 만 됩니다/);
  }

  symlinkSync(secret, path.join(dir, "evil"));
  await assert.rejects(() => saveSquadMembers(dir, "evil", [{ name: "x", role: "" }]), /기준 디렉터리 밖이다/);
  await assert.rejects(() => deleteSquad(dir, "evil"), /기준 디렉터리 밖이다/);
  assert.strictEqual(readFileSync(path.join(secret, "members"), "utf8"), "남의 파일\n");
});

test("readSummary — 연결됨은 카운트, 연결 안 됨은 사유 원문 + 카운트 없음", async () => {
  const root = newQueue({ "w1.sh": "" });
  writeFileSync(
    path.join(root, "tickets", "aaaa1111.md"),
    "---\nticket: aaaa1111\npersona: designer\n---\n", // 디렉터리 없이 티켓만 부르는 이름
  );
  writeFileSync(path.join(root, "tickets", "bbbb2222.done.md"), "---\nticket: bbbb2222\n---\n");

  // 페르소나는 이름 목록뿐이다(§0 표) — 디렉터리 ∪ 티켓 `persona:`, `NAME_RE` 밖은 제외
  mkdirSync(path.join(root, "personas", "developer"), { recursive: true });
  writeFileSync(path.join(root, "personas", "developer", "PROFILE.md"), "# Developer\n");
  mkdirSync(path.join(root, "personas", "qa")); // PROFILE.md 없는 디렉터리도 이름이다
  mkdirSync(path.join(root, "personas", "한글")); // NAME_RE 밖 = 엔진이 안 받는 이름
  writeFileSync(path.join(root, "personas", "README.md"), "디렉터리가 아니다\n");

  // 열린 파일 + session_id = 할당됨. 엔진이 만들지 않는 조합이고 §0-2 배너가 이걸 판정으로 쓴다
  writeFileSync(
    path.join(root, "tickets", "cccc3333.md"),
    "---\nticket: cccc3333\nsession_id: dead-beef\n---\n",
  );
  // .wip은 정상 진행중이다 — session_id가 있어도 배너에 들지 않는다(statusOf가 wip을 준다)
  writeFileSync(
    path.join(root, "tickets", "dddd4444.wip.md"),
    "---\nticket: dddd4444\nsession_id: dead-beef\n---\n",
  );

  // 답변 대기(§0-10 ④) = 열림 + `awaiting`이 미충족 dep이다. 판정은 `isAwaiting` 하나고
  // 여기서 검증하는 것은 `readSummary`가 그걸 `assigned`와 같은 자리에서 거르는가다.
  writeFileSync(
    path.join(root, "tickets", "eeee5555.md"),
    "---\nticket: eeee5555\ndeps: [ffff6666]\nawaiting: ffff6666\n---\n",
  );
  // `잠금 없는 답변 대기`는 종에 안 든다 — `awaiting`만 있고 `deps`가 없다(돌고 있는 티켓이다)
  writeFileSync(
    path.join(root, "tickets", "gggg7777.md"),
    "---\nticket: gggg7777\nawaiting: hhhh8888\n---\n",
  );

  const ok = await readSummary({ root });
  assert.strictEqual(ok.connected, true);
  assert.strictEqual(ok.open, 4); // .done은 열림이 아니다 (.wip도 아니다)
  assert.strictEqual(ok.wip, 1);
  assert.strictEqual(ok.done, 1);
  // 픽스처의 실제 파일 수와 맞는다 — 3종이 큐 전체를 나눠 갖는다
  assert.strictEqual(
    ok.open! + ok.wip! + ok.done!,
    readdirSync(path.join(root, "tickets")).length,
  );
  assert.deepStrictEqual(ok.personas, ["designer", "developer", "qa"]);
  assert.deepStrictEqual(ok.workers.map((w) => w.name), ["w1"]);
  assert.deepStrictEqual(ok.assigned, [{ hash: "cccc3333", stem: "cccc3333" }]);
  // 잠금 없는 `gggg7777`은 빠진다. `mtime`은 배지 경과일의 기준이라 같이 든다(0이 아니다)
  assert.deepStrictEqual(
    ok.awaiting.map((t) => [t.hash, t.stem]),
    [["eeee5555", "eeee5555"]],
  );
  assert.ok(ok.awaiting[0].mtime > 0);

  // 경로가 사라진 프로젝트: 0건이 아니라 "모른다"다(DESIGN.md §4-1)
  const gone = await readSummary({ root: path.join(root, "없는디렉터리") });
  assert.strictEqual(gone.connected, false);
  assert.strictEqual(gone.open, null);
  assert.strictEqual(gone.wip, null);
  assert.strictEqual(gone.done, null);
  assert.deepStrictEqual(gone.personas, []); // 판정 불가 = 빈 배열(사유가 그 자리에 있다)
  assert.deepStrictEqual(gone.assigned, []); // 판정 불가 = 배너·배지가 없다(§0-2)
  assert.deepStrictEqual(gone.awaiting, []); // ④도 같은 규칙이다(§0-10 — 그 자리엔 `연결 안 됨`)
  assert.match(gone.error!, /ENOENT/);
});

/** §0-14 — `readSummary`가 머신 상태 모듈의 값을 그대로 실어 나르는지. 판정 로직(연속 2회 규칙 ·
 *  병합 · 신선도)은 `machine-state.test.ts`가 이미 잰다 — 여기서 재는 것은 **배선**뿐이다: 모듈
 *  스코프에 주입한 값이 `ok.machine`에 그대로 나오면 셸 알림 종 ⑤·⑥이 그 값으로 켜진다는
 *  뜻이다(같은 주입 패턴을 `machine-state.test.ts` 핫리로드 가드 테스트가 쓴다). */
test("readSummary — machine(§0-14)이 모듈 상태를 그대로 실어 나른다 (⑤·⑥ 각 1회)", async () => {
  const root = newQueue({ "w1.sh": "" });
  const g = globalThis as unknown as {
    __diraMachineState?: {
      offline: { offline: boolean; misses: number };
      resume: { from: number; to: number; kind: "slept" | "poweredOff" } | null;
      lastHeartbeatAt: number;
    };
    __diraMachineTimer?: NodeJS.Timeout;
  };
  const savedState = g.__diraMachineState;
  const savedTimer = g.__diraMachineTimer;
  try {
    const now = Date.now();
    // ⑤ 오프라인 켜짐 + ⑥ 복귀 켜짐(신선도 10분 안)을 한 번에 주입한다 — §0-14가 적은 대로
    // 복귀 직후 몇 초는 둘이 동시에 참일 수 있다.
    g.__diraMachineState = {
      offline: { offline: true, misses: 2 },
      resume: { from: now - 60_000, to: now - 1_000, kind: "slept" },
      lastHeartbeatAt: now,
    };
    delete g.__diraMachineTimer; // ensureStarted가 다시 만들게 둔다(하트비트 실제 실행은 없다 — unref)

    const ok = await readSummary({ root });
    assert.equal(ok.machine.offline, true); // ⑤
    assert.deepEqual(ok.machine.resume, { from: now - 60_000, to: now - 1_000, kind: "slept" }); // ⑥

    // 못 읽는 프로젝트에서도 machine은 있다 — 머신이 큐보다 넓다(§0-14)
    const gone = await readSummary({ root: path.join(root, "없는디렉터리") });
    assert.equal(gone.machine.offline, true);
  } finally {
    if (g.__diraMachineTimer) clearInterval(g.__diraMachineTimer);
    g.__diraMachineState = savedState;
    g.__diraMachineTimer = savedTimer;
  }
});

test("멀티플레잉 스위치 — 파일 존재 여부가 값이다, 내용은 안 읽는다 (DESIGN.md §0-18 §스위치)", async () => {
  assert.equal(await readMultiplay(), false); // 새 머신 — 파일 없음이 기본값

  await setMultiplayEnabled(true);
  assert.ok(existsSync(multiplayPath()));
  assert.equal(await readMultiplay(), true);

  await setMultiplayEnabled(false);
  assert.equal(existsSync(multiplayPath()), false);
  assert.equal(await readMultiplay(), false);

  // 두 번째 끄기는 파일이 이미 없어도 에러가 아니다(§0-18 — 계정 삭제와 같은 관용)
  await setMultiplayEnabled(false);
});

test("다중계정 허용 — 세 상태(파일 없음=플래그 / 1 / 0), 판독 불가 내용은 없음과 같다 (DESIGN.md §0-18 §기본값이 된다)", async () => {
  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN; // 잠금 빌드 — 파일 없으면 비허용이 초기값
    assert.equal(await isMultiTokenAllowed(), false);

    await setMultitoken(true);
    assert.equal(readFileSync(multitokenPath(), "utf8"), "1");
    assert.equal(await isMultiTokenAllowed(), true); // 잠금 빌드인데도 파일이 이겼다

    await setMultitoken(false);
    assert.equal(readFileSync(multitokenPath(), "utf8"), "0");
    assert.equal(await isMultiTokenAllowed(), false);

    writeFileSync(multitokenPath(), "garbage"); // 1도 0도 아니면 파일 없음과 같다
    assert.equal(await isMultiTokenAllowed(), false); // 잠금 빌드의 초기값으로 떨어진다

    process.env.DIRA_MULTI_TOKEN = "1"; // 해금 빌드에서도 같은 규칙 — 파일 내용이 이긴다
    assert.equal(await isMultiTokenAllowed(), true); // garbage -> 없음 취급 -> 플래그
    await setMultitoken(false);
    assert.equal(await isMultiTokenAllowed(), false); // 해금 빌드인데도 파일이 껐다
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
    rmSync(multitokenPath(), { force: true });
  }
});

// ── readGateDirty (DESIGN.md §4-14 §표식 파일, 요구 90b7d019) ────────────────

/** `<root>/workers/.gate-dirty`를 직접 쓴다. `newQueue`는 워커 셸 파일용이라 안 쓴다. */
function writeGateFlag(root: string, content: string): void {
  mkdirSync(path.join(root, "workers"), { recursive: true });
  writeFileSync(path.join(root, "workers", ".gate-dirty"), content);
}

test("readGateDirty — 파일이 없으면 null(= 보류 아님)", async () => {
  const root = newQueue(null);
  assert.equal(await readGateDirty(root), null);
});

test("readGateDirty — 정상 표식을 읽는다: 머리 + 나열 줄 = 건수", async () => {
  const root = newQueue(null);
  writeGateFlag(
    root,
    "2026-08-20T06:15:00+09:00 /Users/hsol/Projects/dira\n" +
      "M  apps/teams/lib/projects.ts\n" +
      "?? apps/teams/lib/gate.ts\n",
  );
  assert.deepEqual(await readGateDirty(root), {
    tree: "/Users/hsol/Projects/dira",
    count: 2,
    at: "2026-08-20T06:15:00+09:00",
    paths: ["M  apps/teams/lib/projects.ts", "?? apps/teams/lib/gate.ts"],
    verdicts: [null, null],
  });
});

test("readGateDirty — 경로에 공백이 든 줄이 안 깨진다(첫 공백에서만 가른다)", async () => {
  const root = newQueue(null);
  writeGateFlag(root, "2026-08-20T06:15:00+09:00 /Users/h sol/my project\nM  a b.txt\n");
  assert.deepEqual(await readGateDirty(root), {
    tree: "/Users/h sol/my project",
    count: 1,
    at: "2026-08-20T06:15:00+09:00",
    paths: ["M  a b.txt"],
    verdicts: [null],
  });
});

test("readGateDirty — 마지막 탭 뒤가 판정 두 낱말 중 하나면 그 줄을 판정으로 받고 경로에서 뗀다(결정 1-2)", async () => {
  const root = newQueue(null);
  writeGateFlag(
    root,
    "2026-08-20T06:15:00+09:00 /tree\n" +
      "M  apps/teams/lib/projects.ts\t잔해\n" +
      "?? apps/teams/lib/gate.ts\t사람편집\n" +
      "M  apps/teams/lib/legacy.ts\n", // 판정 칸이 없는 옛 모양 줄도 같이 섞인다
  );
  assert.deepEqual(await readGateDirty(root), {
    tree: "/tree",
    count: 3,
    at: "2026-08-20T06:15:00+09:00",
    paths: [
      "M  apps/teams/lib/projects.ts",
      "?? apps/teams/lib/gate.ts",
      "M  apps/teams/lib/legacy.ts",
    ],
    verdicts: ["잔해", "사람편집", null],
  });
});

test("readGateDirty — 탭은 있는데 뒤가 판정 두 낱말이 아니면 판정 없음이고 줄 전체가 경로다", async () => {
  const root = newQueue(null);
  writeGateFlag(root, "2026-08-20T06:15:00+09:00 /tree\n" + "M  path\twith\ttab\n");
  assert.deepEqual(await readGateDirty(root), {
    tree: "/tree",
    count: 1,
    at: "2026-08-20T06:15:00+09:00",
    paths: ["M  path\twith\ttab"],
    verdicts: [null],
  });
});

test("readGateDirty — 반쯤 쓴 파일은 null이다: 빈 파일 · 머리뿐인 파일 · 시각이 ISO 8601이 아닌 파일", async () => {
  const root = newQueue(null);

  writeGateFlag(root, "");
  assert.equal(await readGateDirty(root), null);

  writeGateFlag(root, "2026-08-20T06:15:00+09:00 /tree\n");
  assert.equal(await readGateDirty(root), null);

  writeGateFlag(root, "그냥어제 /tree\nM  a.txt\n");
  assert.equal(await readGateDirty(root), null);
});

// ── hasPushSh (DESIGN.md §0-10 §전부 잔해일 때만 버튼 하나가 뜬다 결정 3) ───────

test("hasPushSh — <root>/push.sh가 있으면 true, 없으면 false", async () => {
  const root = newQueue(null);
  assert.equal(await hasPushSh(root), false);
  writeFileSync(path.join(root, "push.sh"), "#!/usr/bin/env bash\n");
  assert.equal(await hasPushSh(root), true);
});
