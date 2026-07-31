import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { engineRepo, fillPlaceholders, preflight, scaffold } from "./scaffold.ts";
import { parseContextBlock } from "./workers.ts";

/** §0-3 스캐폴딩 집합. **이 목록이 계약이다** — 여기 없는 파일을 쓰면 실패한다. */
const SET = [
  ".dira/tickets/",
  ".dira/protocols/AGENTS.md",
  ".dira/protocols/tickets.md",
  ".dira/personas/pm/PROFILE.md",
  ".dira/personas/developer/PROFILE.md",
  ".dira/personas/qa/PROFILE.md",
  ".dira/personas/designer/PROFILE.md",
  ".dira/workers/w1.sh",
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
  // 다음 단계(registerCron·addProject)가 쓰는 값 — 부르는 쪽이 경로를 다시 조립하지 않는다
  assert.equal(first.root, path.join(project, ".dira"));
  assert.equal(first.repo, repo.path);

  const agents = path.join(project, ".dira/protocols/AGENTS.md");
  const before = await readFile(agents, "utf8");
  // ② `<프로젝트>`·`<통합 브랜치>`가 하나도 안 남는다
  assert.doesNotMatch(before, /<프로젝트>|<통합 브랜치>/);
  assert.ok(before.includes(project), "치환된 프로젝트 경로가 본문에 있어야 한다");
  assert.ok(before.includes("git push . HEAD:main"), "브랜치가 치환돼야 한다");
  // ③ specDoc이 비면 그 자리표시자는 남는다
  assert.match(before, /<프로젝트 스펙 문서>/);

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

  // ④ 두 번 돌리면 전부 skipped이고 내용이 안 바뀐다
  const second = await scaffold(project, { branch: "other", specDoc: "docs/S.md" });
  assert.deepEqual(second.skipped.sort(), [...SET].sort());
  assert.deepEqual(second.written, []);
  assert.equal(await readFile(agents, "utf8"), before);
});

test("scaffold — specDoc을 주면 세 번째 자리표시자도 사라진다", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await scaffold(dir, { branch: "master", specDoc: "docs/DESIGN.md" });
  const agents = await readFile(path.join(dir, ".dira/protocols/AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /<프로젝트>|<통합 브랜치>|<프로젝트 스펙 문서>/);
  assert.ok(agents.includes("docs/DESIGN.md"));
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
  assert.match(empty.ok === false ? empty.message : "", /dira 큐가 아닙니다/);

  await mkdir(path.join(root, "tickets"));
  const queue = await preflight(dir);
  assert.equal(queue.ok, false);
  assert.equal(queue.ok === false && queue.queue, true);
  assert.match(queue.ok === false ? queue.message : "", /이미 큐가 있습니다/);
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
