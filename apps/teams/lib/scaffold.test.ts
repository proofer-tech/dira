import { test } from "node:test";
import assert from "node:assert";
import { chmod, cp, mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  engineRepo,
  ensureDenyCurrentBranch,
  ensureGitignoreLine,
  fillPlaceholders,
  preflight,
  scaffold,
} from "./scaffold.ts";
import { cronLine, dispatchGateSourceLine, parseContextBlock, selfHealSourceLine } from "./workers.ts";

/** §0-3 스캐폴딩 집합. **이 목록이 계약이다** — 여기 없는 파일을 쓰면 실패한다. */
const SET = [
  ".dira/tickets/",
  ".dira/protocols/AGENTS.md",
  ".dira/protocols/tickets.md",
  ".dira/protocols/ontology.md",
  ".dira/protocols/워크트리.md",
  ".dira/protocols/재디스패치-복구.md",
  ".dira/protocols/push-거부.md",
  ".dira/protocols/세션-종료.md",
  ".dira/protocols/한도.md",
  ".dira/protocols/질문-형식.md",
  ".dira/protocols/회고-예산.md",
  ".dira/protocols/완료-트리거.md",
  ".dira/protocols/cdp.md",
  ".dira/protocols/epics.md",
  ".dira/protocols/CORE.md",
  ".dira/protocols/CORE-TICKETS.md",
  ".dira/protocols/CORE-MEMORY.md",
  ".dira/personas/pm/PROFILE.md",
  ".dira/personas/developer/PROFILE.md",
  ".dira/personas/qa/PROFILE.md",
  ".dira/personas/designer/PROFILE.md",
  ".dira/personas/archive-manager/PROFILE.md",
  ".dira/squads/default/members",
  ".dira/workers/w1.sh",
  ".dira/self-heal.sh",
  ".dira/dispatch-gate.sh",
  ".dira/push.sh",
  ".dira/integration-branch",
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

  // ① 만들어진 파일 목록 = §0-3 집합 + §0-19의 `.gitignore`(specDoc 없이 — ③을 같은 트리에서 본다)
  const first = await scaffold(project, { branch: "main" });
  assert.deepEqual(first.written.sort(), [...SET, ".gitignore"].sort());
  assert.deepEqual(first.skipped, []);
  assert.equal(await readFile(path.join(project, ".gitignore"), "utf8"), ".dira\n");
  // 다음 단계(registerCron·addProject)가 쓰는 값 — 부르는 쪽이 경로를 다시 조립하지 않는다.
  // realpath된 경로다(751e3004) — mkdtemp는 맥에서 `/var`(→ `/private/var`) 아래다.
  assert.equal(first.root, await realpath(path.join(project, ".dira")));
  assert.equal(first.repo, repo.path);

  const agents = path.join(project, ".dira/protocols/AGENTS.md");
  const before = await readFile(agents, "utf8");
  // ② `<프로젝트>`·`<통합 브랜치>`가 하나도 안 남는다
  assert.doesNotMatch(before, /<프로젝트>|<통합 브랜치>/);
  assert.ok(before.includes(project), "치환된 프로젝트 경로가 본문에 있어야 한다");
  assert.ok(before.includes("git rebase main"), "브랜치가 치환돼야 한다");
  // ③ specDoc이 비면 그 자리표시자는 남는다
  assert.match(before, /<프로젝트 스펙 문서>/);

  // ③-1 ontology.md — 자리표시자 없는 파일이라 템플릿과 바이트가 같아야 한다(경로 존재만으론
  // 빈 파일도 통과한다).
  const ontology = await readFile(path.join(project, ".dira/protocols/ontology.md"), "utf8");
  const ontologyTemplate = await readFile(path.join(repo.path, "templates/protocols/ontology.md"), "utf8");
  assert.equal(ontology, ontologyTemplate);

  // (D1) 기본 스쿼드 default — 이름 넷, 역할 칸 없음, 끝이 개행 하나, rules는 안 만든다
  const members = await readFile(path.join(project, ".dira/squads/default/members"), "utf8");
  assert.equal(members, "pm\ndeveloper\nqa\ndesigner\n");
  await assert.rejects(() => stat(path.join(project, ".dira/squads/default/rules")));

  // ⑤ w1.sh — TICKET_CWD가 표준 자리(§워커는 언제나 자기 워크트리에서 일한다 결정 1),
  // tick.sh 절대경로, 755
  const w1 = path.join(project, ".dira/workers/w1.sh");
  const sh = await readFile(w1, "utf8");
  assert.match(sh, CWD_ASSIGN);
  assert.ok(sh.includes(`TICKET_CWD="${path.join(first.root, "worktrees", "w1")}"`), sh.slice(0, 200));
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
  // 워커에 정해지는 경로는 스캐폴딩이 돌려준 root 기준이다(= realpath, 751e3004).
  const heal = path.join(first.root, "self-heal.sh");
  execFileSync("bash", ["-n", heal]);
  // `[ -f ] &&`로 감싼다(§4-16 개정 1 결정 6) — 사이드카는 선택 항목이라 없는 큐에서 이 줄이
  // `No such file`을 쌓는 것이 계약인 적이 없다.
  const healLine = selfHealSourceLine(first.root, repo.path);
  const lines = sh.split("\n");
  const at = lines.findIndex((l) => l === healLine);
  assert.ok(at >= 0, `자가 정리 줄이 없다: ${sh.slice(-300)}`);
  assert.equal(lines[at + 1], `. "${path.join(repo.path, "tick.sh")}"`);

  // ⑧ 통합 게이트(§4-14) — 파일이 같이 생기고, 브랜치가 치환되고, 선행조건 1은 없고,
  // `source` 줄이 `. tick.sh` **바로 위**다(자가 정리보다도 위 — 자가 정리 줄이 그 증거다).
  const gate = path.join(first.root, "dispatch-gate.sh");
  execFileSync("bash", ["-n", gate]);
  const gateText = await readFile(gate, "utf8");
  assert.doesNotMatch(gateText, /<통합 브랜치>/);
  assert.doesNotMatch(gateText, /TICKET_CWD가 비어 있다/);
  const gateLine = dispatchGateSourceLine(first.root);
  const gateAt = lines.findIndex((l) => l === gateLine);
  assert.ok(gateAt >= 0, `통합 게이트 줄이 없다: ${sh.slice(-300)}`);
  assert.equal(lines[gateAt + 1], healLine, `통합 게이트 줄은 자가 정리 줄 바로 위여야 한다: ${sh.slice(-300)}`);
  // 감싼 줄은 경로를 두 번 담는다(`[ -f <p> ] && . <p>`) — 줄 자신이 한 번만 있는지로 잰다
  assert.equal(sh.split(gateLine).length - 1, 1);

  // ⑨ 통합 push 헬퍼(§통합 브랜치가 설정이 된다 결정 4-5) — 브랜치가 치환되고, `master`가 브랜치로
  // 쓰인 자리가 0줄이며, 실행 모드는 워커와 같다.
  const push = path.join(first.root, "push.sh");
  execFileSync("bash", ["-n", push]);
  const pushText = await readFile(push, "utf8");
  assert.doesNotMatch(pushText, /<통합 브랜치>/);
  assert.match(pushText, /_branch="main"/);
  assert.doesNotMatch(pushText, /master/);
  assert.equal((await stat(push)).mode & 0o777, 0o755);

  // ④ 두 번 돌리면 전부 skipped이고 내용이 안 바뀐다
  const second = await scaffold(project, { branch: "other", specDoc: "docs/S.md" });
  assert.deepEqual(second.skipped.sort(), [...SET, ".gitignore"].sort());
  assert.deepEqual(second.written, []);
  assert.equal(await readFile(agents, "utf8"), before);
  assert.equal(await readFile(path.join(project, ".gitignore"), "utf8"), ".dira\n");
  // (D2) 소급 0 — 재실행해도 members 내용이 안 갈린다
  assert.equal(await readFile(path.join(project, ".dira/squads/default/members"), "utf8"), members);
});

/** §0-19 네 갈래 — 파서 없이 트림-완전일치로만 판정한다. */
test("ensureGitignoreLine — 네 갈래 + 개행 없는 파일 + 실패해도 안 던진다", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));

  // 갈래 1 — 없다 → 만들고 한 줄
  assert.equal(await ensureGitignoreLine(dir), "written");
  assert.equal(await readFile(path.join(dir, ".gitignore"), "utf8"), ".dira\n");

  // 갈래 3 — 있고 `.dira`가 있다 → 아무것도 안 한다(멱등)
  assert.equal(await ensureGitignoreLine(dir), "skipped");
  assert.equal(await readFile(path.join(dir, ".gitignore"), "utf8"), ".dira\n");

  // 갈래 2 — 있고 `.dira`가 없다 → 기존 바이트는 그대로, 맨 끝에 append
  const dir2 = await tmp();
  t.after(() => rm(dir2, { recursive: true, force: true }));
  await writeFile(path.join(dir2, ".gitignore"), "node_modules/\n");
  assert.equal(await ensureGitignoreLine(dir2), "written");
  assert.equal(await readFile(path.join(dir2, ".gitignore"), "utf8"), "node_modules/\n.dira\n");

  // 개행 없이 끝나는 파일 — 개행부터 넣는다(안 그러면 `.vercel.dira` 같은 줄이 생긴다)
  const dir3 = await tmp();
  t.after(() => rm(dir3, { recursive: true, force: true }));
  await writeFile(path.join(dir3, ".gitignore"), "node_modules/");
  assert.equal(await ensureGitignoreLine(dir3), "written");
  assert.equal(await readFile(path.join(dir3, ".gitignore"), "utf8"), "node_modules/\n.dira\n");

  // 갈래 3 변형 — `.dira/`·`/.dira`·`/.dira/` 전부 "있다"다. 한 바이트도 안 갈린다(파서 없이 트림 완전일치)
  for (const line of [".dira/", "/.dira", "/.dira/"]) {
    const d = await tmp();
    t.after(() => rm(d, { recursive: true, force: true }));
    const body = `${line}\n`;
    await writeFile(path.join(d, ".gitignore"), body);
    assert.equal(await ensureGitignoreLine(d), "skipped");
    assert.equal(await readFile(path.join(d, ".gitignore"), "utf8"), body);
  }

  // 갈래 4 — 쓰기가 실패해도 던지지 않는다(권한 없는 디렉터리)
  const dir4 = await tmp();
  t.after(async () => {
    await chmod(dir4, 0o700);
    await rm(dir4, { recursive: true, force: true });
  });
  await chmod(dir4, 0o500);
  assert.equal(await ensureGitignoreLine(dir4), "failed");
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

/** DESIGN.md §데스크톱 앱 §고정하는 것 8 — 판정은 "`extraResources`가 `engine/`으로 나르는 것만으로
 *  만든 가짜 엔진 레포에 대고 스캐폴딩이 성공하는가"다. 목록을 여기 베끼면 같은 손이 두 벌을
 *  세는 것이라 `apps/desktop/package.json`을 직접 읽는다 — 여섯 번째 읽기가 늘면 이 검사가
 *  먼저 빨개진다. */
test("scaffold — 데스크톱 extraResources만으로 만든 가짜 엔진에서도 성공한다", async (t) => {
  const desktopDir = new URL("../../desktop/", import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", desktopDir), "utf8"));
  const engineEntries = pkg.build.extraResources.filter((e: { from: string; to: string }) =>
    e.to.startsWith("engine/"),
  );
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
  // 셸에 DIRA_ENGINE이 이미 있으면(예: 워커 셸) 기준값이 그 오염된 값이 된다 — 격리하고 복원한다
  const prevEngine = process.env.DIRA_ENGINE;
  delete process.env.DIRA_ENGINE;
  t.after(() => {
    if (prevEngine === undefined) delete process.env.DIRA_ENGINE;
    else process.env.DIRA_ENGINE = prevEngine;
  });

  const derived = engineRepo(); // env 없이 = 지금의 유도(레포 안에서 돌므로 성공한다)
  assert.ok("path" in derived, `유도가 깨졌다: ${JSON.stringify(derived)}`);

  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));

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

// ── receive.denyCurrentBranch (DESIGN.md §통합 브랜치가 설정이 된다 결정 6, 수용조건 4) ──────

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });

function initRepo(dir: string, branch: string): void {
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
}

test("ensureDenyCurrentBranch — 미설정이면 켜고, updateInstead면 skipped, 다른 값이면 안 건드리고 알린다", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  initRepo(dir, "main");

  assert.deepEqual(await ensureDenyCurrentBranch(dir), { status: "written" });
  assert.equal(git(dir, "config", "receive.denyCurrentBranch").trim(), "updateInstead");

  // 멱등 — 이미 그 값이면 다시 쓰지 않는다
  assert.deepEqual(await ensureDenyCurrentBranch(dir), { status: "skipped" });

  // 이미 다른 값이면 안 건드리고 그 값을 그대로 돌려준다
  git(dir, "config", "receive.denyCurrentBranch", "refuse");
  assert.deepEqual(await ensureDenyCurrentBranch(dir), { status: "conflict", value: "refuse" });
  assert.equal(git(dir, "config", "receive.denyCurrentBranch").trim(), "refuse");
});

test("ensureDenyCurrentBranch — git 레포가 아니면 던지지 않고 failed", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await ensureDenyCurrentBranch(dir), { status: "failed" });
});

test("scaffold — <프로젝트> 레포에 updateInstead를 켠다 (수용조건 4)", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  initRepo(dir, "main");

  const made = await scaffold(dir, { branch: "main" });
  assert.equal(made.denyCurrentBranchNote, undefined);
  assert.equal(git(dir, "config", "receive.denyCurrentBranch").trim(), "updateInstead");
});

test("scaffold — 이미 다른 값이면 안 건드리고 denyCurrentBranchNote로 알린다 (수용조건 4)", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  initRepo(dir, "main");
  git(dir, "config", "receive.denyCurrentBranch", "refuse");

  const made = await scaffold(dir, { branch: "main" });
  assert.equal(made.denyCurrentBranchNote, "refuse");
  assert.equal(git(dir, "config", "receive.denyCurrentBranch").trim(), "refuse");
});

// ── 통합 push 헬퍼가 통합 브랜치로 간다 (DESIGN.md §통합 브랜치가 설정이 된다, 수용조건 3) ────
//
// **진짜 git 레포**를 만들어 통합 브랜치 `dev`로 push한다 — `master`도 `main`도 새로 생기지
// 않는 것이 이 결함(브랜치 고정)이 고쳐졌다는 증거다.

test("push.sh ship — 통합 브랜치 dev로 커밋이 실리고 master·main은 안 생긴다 (수용조건 3)", async (t) => {
  const project = await tmp();
  t.after(() => rm(project, { recursive: true, force: true }));
  initRepo(project, "dev");
  await writeFile(path.join(project, "README.md"), "# t\n");
  git(project, "add", "-A");
  git(project, "commit", "-qm", "init");

  const made = await scaffold(project, { branch: "dev" });
  assert.equal(git(project, "config", "receive.denyCurrentBranch").trim(), "updateInstead");

  const worktree = path.join(project, "wt1");
  git(project, "worktree", "add", "-q", worktree, "-b", "sess", "dev");
  await writeFile(path.join(worktree, "work.txt"), "hello\n");

  const pushSh = path.join(made.root, "push.sh");
  execFileSync("bash", [pushSh, "ship", "deadbeef", "작업 제목"], { cwd: worktree, encoding: "utf8" });

  const log = git(project, "log", "--oneline", "dev");
  assert.match(log, /작업 제목/);
  const branches = git(project, "branch", "--list")
    .split("\n")
    .map((l) => l.replace(/^[*+]?\s*/, "").trim())
    .filter(Boolean);
  assert.deepEqual(branches.sort(), ["dev", "sess"]); // worktree가 딴 세션 브랜치 하나뿐
  assert.ok(!branches.includes("master"));
  assert.ok(!branches.includes("main"));
});

// ── 첫 워커도 자기 워크트리를 든다 (§워커는 언제나 자기 워크트리에서 일한다 결정 1) ──────
//
// **진짜 git 레포 + 진짜 bash**로 게이트를 한 번 태운다 — 값어치가 그 판정이라 모킹하면
// 검증할 게 안 남는다(§4-14 §없는 워크트리를 게이트가 만든다와 같은 논리).

test("scaffold — w1의 표준 워크트리가 없으면 게이트 첫 tick이 만들고 그 안의 .dira가 큐 루트로 풀린다 (수용조건 1-2)", async (t) => {
  const project = await tmp();
  t.after(() => rm(project, { recursive: true, force: true }));
  initRepo(project, "main");
  await writeFile(path.join(project, "README.md"), "# t\n");
  git(project, "add", "-A");
  git(project, "commit", "-qm", "init"); // worktree add가 HEAD를 못 읽으면 실패한다

  const made = await scaffold(project, { branch: "main" });
  const w1 = await readFile(path.join(made.root, "workers/w1.sh"), "utf8");
  const tree = path.join(made.root, "worktrees", "w1");
  assert.ok(w1.includes(`TICKET_CWD="${tree}"`), w1.slice(0, 200));
  assert.equal(existsSync(tree), false); // 이 티켓이 디렉터리를 만들지 않는다 — 첫 tick의 몫

  const gate = path.join(made.root, "dispatch-gate.sh");
  const worker = path.join(made.root, "workers", "w1.sh");
  const out = execFileSync("bash", ["-c", `. ${JSON.stringify(gate)} tick; echo 끝`, worker], {
    encoding: "utf8",
    env: { ...process.env, TICKET_CWD: tree },
  });
  assert.match(out, /끝/);
  assert.doesNotMatch(out, /GATE/); // 보류 없이 곧장 디스패치로 넘어간다

  assert.equal(statSync(tree).isDirectory(), true);
  assert.equal(readlinkSync(path.join(tree, ".dira")), "../..");
  assert.equal(realpathSync(path.join(tree, ".dira")), await realpath(made.root));
  assert.equal(
    execFileSync("git", ["-C", tree, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim(),
    "wt/w1",
  );
});
