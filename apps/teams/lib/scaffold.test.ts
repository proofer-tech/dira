import { test } from "node:test";
import assert from "node:assert";
import { cp, mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { engineRepo, fillPlaceholders, preflight, scaffold } from "./scaffold.ts";
import { cronLine, parseContextBlock } from "./workers.ts";

/** §0-3 스캐폴딩 집합. **이 목록이 계약이다** — 여기 없는 파일을 쓰면 실패한다. */
const SET = [
  ".dira/tickets/",
  ".dira/protocols/AGENTS.md",
  ".dira/protocols/tickets.md",
  ".dira/protocols/ontology.md",
  ".dira/protocols/CORE.md",
  ".dira/protocols/CORE-TICKETS.md",
  ".dira/protocols/CORE-MEMORY.md",
  ".dira/personas/pm/PROFILE.md",
  ".dira/personas/developer/PROFILE.md",
  ".dira/personas/qa/PROFILE.md",
  ".dira/personas/designer/PROFILE.md",
  ".dira/personas/archive-manager/PROFILE.md",
  ".dira/workers/w1.sh",
  ".dira/self-heal.sh",
];

/** 활성 `TICKET_CWD` 대입. `# TICKET_CWD=...`(worker.sh.example의 주석)은 안 걸린다 —
 *  `workers.ts`의 `cwdAssign`과 같은 모양이어야 판정이 갈리지 않는다. */
const CWD_ASSIGN = /^[ \t]*(?:export[ \t]+)?TICKET_CWD=/m;

const tmp = () => mkdtemp(path.join(tmpdir(), "scaffold-"));

test("fillPlaceholders — 문자열 그대로 치환, specDoc 비면 안 건드린다", () => {
  const text = "루트 <프로젝트>/.dira · push <통합 브랜치> · 스펙 <프로젝트 스펙 문서> · <프로젝트>";
  assert.equal(
    fillPlaceholders(text, { project: "/p/x", branch: "main", specDoc: "docs/S.md" }),
    "루트 /p/x/.dira · push main · 스펙 docs/S.md · /p/x",
  );
  // 빈 값 · 미지정 둘 다 자리표시자를 남긴다
  for (const specDoc of [undefined, ""]) {
    const out = fillPlaceholders(text, { project: "/p/x", branch: "main", specDoc });
    assert.match(out, /<프로젝트 스펙 문서>/);
    assert.doesNotMatch(out, /<프로젝트>|<통합 브랜치>/);
  }
  // `$&`·`$1`을 해석하지 않는다(치환값이 셸 경로다)
  assert.equal(
    fillPlaceholders("<프로젝트>", { project: "/p/$&a$1", branch: "main" }),
    "/p/$&a$1",
  );
});

test("scaffold — §0-3 집합 그대로, 두 번째는 전부 skipped", async (t) => {
  const repo = engineRepo();
  assert.ok("path" in repo, `엔진 레포를 못 찾았다: ${JSON.stringify(repo)}`);

  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "myproject");

  // ① 만들어진 파일 목록 = §0-3 집합 (specDoc 없이 — ③을 같은 트리에서 본다)
  const first = await scaffold(project, { branch: "main" });
  assert.deepEqual(first.written.sort(), [...SET].sort());
  assert.deepEqual(first.skipped, []);
  // 다음 단계(registerCron·addProject)가 쓰는 값 — 부르는 쪽이 경로를 다시 조립하지 않는다.
  // realpath된 경로다(751e3004) — mkdtemp는 맥에서 `/var`(→ `/private/var`) 아래다.
  assert.equal(first.root, await realpath(path.join(project, ".dira")));
  assert.equal(first.repo, repo.path);

  const agents = path.join(project, ".dira/protocols/AGENTS.md");
  const before = await readFile(agents, "utf8");
  // ② `<프로젝트>`·`<통합 브랜치>`가 하나도 안 남는다
  assert.doesNotMatch(before, /<프로젝트>|<통합 브랜치>/);
  assert.ok(before.includes(project), "치환된 프로젝트 경로가 본문에 있어야 한다");
  assert.ok(before.includes("git push . HEAD:main"), "브랜치가 치환돼야 한다");
  // ③ specDoc이 비면 그 자리표시자는 남는다
  assert.match(before, /<프로젝트 스펙 문서>/);

  // ③-1 ontology.md — 자리표시자 없는 파일이라 템플릿과 바이트가 같아야 한다(경로 존재만으론
  // 빈 파일도 통과한다).
  const ontology = await readFile(path.join(project, ".dira/protocols/ontology.md"), "utf8");
  const ontologyTemplate = await readFile(path.join(repo.path, "templates/protocols/ontology.md"), "utf8");
  assert.equal(ontology, ontologyTemplate);

  // ⑤ w1.sh — 활성 TICKET_CWD 없음, tick.sh 절대경로, 755
  const w1 = path.join(project, ".dira/workers/w1.sh");
  const sh = await readFile(w1, "utf8");
  assert.doesNotMatch(sh, CWD_ASSIGN);
  assert.ok(sh.includes(`. "${path.join(repo.path, "tick.sh")}"`), sh.slice(-200));
  assert.doesNotMatch(sh, /^[ \t]*(?:\.|source)[ \t]+.*\$HOME.*tick\.sh/m);
  assert.equal((await stat(w1)).mode & 0o777, 0o755);
  // ⑥ 컨텍스트 카드가 짚을 실효 블록이 source 줄 **위**에 있다(§0-3, 요구 b2bdfab6).
  //    주석 예시 블록은 남아 있고, 셸로도 성립한다.
  const b = parseContextBlock(sh);
  assert.ok(b.ok, `블록을 못 짚었다: ${JSON.stringify(b)}`);
  assert.equal(b.items.length, 0);
  assert.ok(b.start < sh.indexOf(`. "${path.join(repo.path, "tick.sh")}"`), "블록이 source 위여야");
  assert.match(sh, /^# TICKET_CONTEXT=\(/m);
  execFileSync("bash", ["-n", w1]);

  // ⑦ 자가 정리(§4-4) — 파일이 같이 생기고, `source` 줄이 `. tick.sh` **바로 위**다.
  // 워커에 박히는 경로는 스캐폴딩이 돌려준 root 기준이다(= realpath, 751e3004).
  const heal = path.join(first.root, "self-heal.sh");
  execFileSync("bash", ["-n", heal]);
  const healLine = `. "${heal}" "${path.join(repo.path, "tick.sh")}"`;
  const lines = sh.split("\n");
  const at = lines.findIndex((l) => l.startsWith(healLine));
  assert.ok(at >= 0, `자가 정리 줄이 없다: ${sh.slice(-300)}`);
  assert.equal(lines[at + 1], `. "${path.join(repo.path, "tick.sh")}"`);

  // ④ 두 번 돌리면 전부 skipped이고 내용이 안 바뀐다
  const second = await scaffold(project, { branch: "other", specDoc: "docs/S.md" });
  assert.deepEqual(second.skipped.sort(), [...SET].sort());
  assert.deepEqual(second.written, []);
  assert.equal(await readFile(agents, "utf8"), before);
});

/** §프롬프트 층 결정 8-a — 원본은 `<엔진>/protocols/`, `templates/`에 사본을 두지 않는다. */
test("scaffold — CORE*.md는 엔진 protocols/에서 그대로 복사, templates/에는 사본이 없다", async (t) => {
  const repo = engineRepo();
  assert.ok("path" in repo, `엔진 레포를 못 찾았다: ${JSON.stringify(repo)}`);

  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "myproject");

  await scaffold(project, { branch: "main" });

  const names = (await readdir(path.join(repo.path, "protocols"))).filter((n) => n.startsWith("CORE"));
  assert.ok(names.length > 0);
  for (const name of names) {
    const orig = await readFile(path.join(repo.path, "protocols", name), "utf8");
    const copy = await readFile(path.join(project, ".dira/protocols", name), "utf8");
    assert.equal(copy, orig, `${name}이 원본과 달라야 안 된다`); // 자리표시자 치환 없음
  }

  // templates/에는 사본이 없다 — 정본은 엔진 protocols/ 하나
  await assert.rejects(() => readFile(path.join(repo.path, "templates/protocols", names[0]), "utf8"));
});

/** DESIGN.md §데스크톱 앱 §못박는 것 8 — 판정은 "`extraResources`가 `engine/`으로 나르는 것만으로
 *  만든 가짜 엔진 레포에 대고 스캐폴딩이 성공하는가"다. 목록을 여기 베끼면 같은 손이 두 벌을
 *  세는 것이라 `apps/desktop/package.json`을 직접 읽는다 — 여섯 번째 읽기가 늘면 이 검사가
 *  먼저 빨개진다. */
test("scaffold — 데스크톱 extraResources만으로 만든 가짜 엔진에서도 성공한다", async (t) => {
  const desktopDir = new URL("../../desktop/", import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", desktopDir), "utf8"));
  const engineEntries = pkg.build.extraResources.filter((e) => e.to.startsWith("engine/"));
  assert.ok(engineEntries.length > 0, "engine/으로 나르는 항목이 없다");

  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const { from, to } of engineEntries) {
    await cp(new URL(from, desktopDir), path.join(dir, to), { recursive: true });
  }
  const fakeEngine = path.join(dir, "engine");

  const prevEngine = process.env.DIRA_ENGINE;
  process.env.DIRA_ENGINE = fakeEngine;
  t.after(() => {
    if (prevEngine === undefined) delete process.env.DIRA_ENGINE;
    else process.env.DIRA_ENGINE = prevEngine;
  });
  assert.deepEqual(engineRepo(), { path: fakeEngine });

  const project = path.join(dir, "myproject");
  const result = await scaffold(project, { branch: "main" });
  for (const name of ["CORE.md", "CORE-TICKETS.md", "CORE-MEMORY.md"]) {
    assert.ok(result.written.includes(path.join(".dira/protocols", name)), `${name}이 안 만들어졌다`);
    await stat(path.join(project, ".dira/protocols", name));
  }
});

test("scaffold — specDoc을 주면 세 번째 자리표시자도 사라진다", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await scaffold(dir, { branch: "master", specDoc: "docs/DESIGN.md" });
  const agents = await readFile(path.join(dir, ".dira/protocols/AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /<프로젝트>|<통합 브랜치>|<프로젝트 스펙 문서>/);
  assert.ok(agents.includes("docs/DESIGN.md"));
});

/** 751e3004 — `createProject`는 같은 root 문자열로 두 가지를 한다: crontab 줄(`registerCron`)과
 *  레지스트리 등록(`addProject`). `addProject`가 realpath로 저장하므로(DESIGN.md:272) 스캐폴딩이
 *  raw 경로를 돌려주면 두 벌이 되고, `listWorkers`는 registry root로 대조하니 앱이 1분 전에 직접
 *  등록한 w1이 `crontab 미등록`으로 뜬다. 사람이 `재등록`을 누르면 줄이 하나 더 들어가 같은
 *  워커가 1분에 두 번 돈다.
 *
 *  진짜 crontab은 건드리지 않는다 — `cronLine`은 문자열만 만드는 순수 함수다.
 *  진짜 레지스트리도 아니다 — `TICKET_LOCAL`을 임시 디렉터리로 돌린다(`projects.test.ts` 수법). */
test("scaffold — 심링크 낀 경로: crontab 줄의 경로 = 레지스트리 root (751e3004)", async (t) => {
  const dir = await tmp();
  const local = await tmp();
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  t.after(async () => {
    process.env.TICKET_LOCAL = prev;
    await rm(dir, { recursive: true, force: true });
    await rm(local, { recursive: true, force: true });
  });
  // 사람이 치는 경로에 심링크 구간이 하나만 있으면 된다(맥의 `/tmp`·`/var`, 심링크된 홈·마운트).
  await mkdir(path.join(dir, "real"));
  await symlink(path.join(dir, "real"), path.join(dir, "link"));
  const project = path.join(dir, "link", "fx");

  const made = await scaffold(project, { branch: "main" });
  assert.equal(made.root, await realpath(path.join(dir, "real", "fx", ".dira")));

  // 액션이 하는 그대로: 같은 `made.root`로 crontab 줄을 만들고 레지스트리에 등록한다.
  const workerPath = path.join(made.root, "workers", "w1.sh");
  const line = cronLine({ path: workerPath });
  const { addProject } = await import("./projects.ts");
  const saved = await addProject("fx 큐", made.root);

  assert.equal(saved.root, made.root); // 저장된 root = 스캐폴딩이 돌려준 root
  // 워커 화면의 판정(`listWorkers`)은 registry root로 조립한 경로가 crontab 줄에 있는가다.
  assert.ok(line.includes(path.join(saved.root, "workers", "w1.sh")), line);
});

test("scaffold — 상대경로는 서버 cwd에 쓰지 않고 거부한다", async () => {
  await assert.rejects(() => scaffold("relative/path", { branch: "main" }), /절대경로/);
});

test("preflight — .dira 유무와 큐 여부로 갈린다", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.deepEqual(await preflight(dir), { ok: true }); // .dira 없음 → 생성 진행

  const root = path.join(dir, ".dira");
  await mkdir(root);
  const empty = await preflight(dir);
  assert.equal(empty.ok, false);
  assert.equal(empty.ok === false && empty.queue, false);
  assert.match(empty.ok === false ? empty.message : "", /dira 프로젝트가 아닙니다/);

  await mkdir(path.join(root, "tickets"));
  const queue = await preflight(dir);
  assert.equal(queue.ok, false);
  assert.equal(queue.ok === false && queue.queue, true);
  assert.match(queue.ok === false ? queue.message : "", /이미 dira 프로젝트입니다/);
  // 화면이 이 값을 등록 카드에 그대로 넣는다 — `.dira`까지다(입력한 프로젝트 폴더가 아니다)
  assert.equal(queue.ok === false && queue.root, root);

  // `.dira`가 디렉터리가 아니어도 생성으로 새지 않는다
  const dir2 = await tmp();
  t.after(() => rm(dir2, { recursive: true, force: true }));
  await writeFile(path.join(dir2, ".dira"), "");
  const file = await preflight(dir2);
  assert.equal(file.ok, false);
  assert.equal(file.ok === false && file.queue, false);
});

test("engineRepo — DIRA_ENGINE이 먼저다. 값이 없으면 cwd 유도가 그대로", async (t) => {
  const derived = engineRepo(); // env 없이 = 지금의 유도(레포 안에서 돌므로 성공한다)
  assert.ok("path" in derived, `유도가 깨졌다: ${JSON.stringify(derived)}`);

  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => void delete process.env.DIRA_ENGINE);

  // ① tick.sh가 없는 값 → 거부하고, 사유에 **그 경로**가 담긴다(유도 경로가 아니다)
  process.env.DIRA_ENGINE = dir;
  const bad = engineRepo();
  assert.ok("error" in bad && bad.error.includes(dir), `사유에 경로가 없다: ${JSON.stringify(bad)}`);
  assert.ok("error" in bad && bad.error.includes("DIRA_ENGINE"), "어느 쪽에서 온 값인지 말해야 한다");
  assert.ok("error" in bad && !bad.error.includes(derived.path), "유도 경로가 새면 안 된다");

  // ② tick.sh가 있으면 그 경로다 — 유도를 이긴다
  await writeFile(path.join(dir, "tick.sh"), "");
  assert.deepEqual(engineRepo(), { path: dir });

  // ③ 빈 값·공백은 없는 것과 같다(env를 지웠는데 껍데기가 남는 경우)
  for (const v of ["", "  "]) {
    process.env.DIRA_ENGINE = v;
    assert.deepEqual(engineRepo(), derived);
  }
  delete process.env.DIRA_ENGINE;
  assert.deepEqual(engineRepo(), derived);
});
