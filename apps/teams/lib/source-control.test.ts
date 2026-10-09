/** `lib/source-control.ts` — 진짜 git으로 돌린다(`workers.test.ts`의 `makeRepo`와 같은 근거:
 *  파싱·스테이지·업스트림 판정이 전부 git 자신의 출력이 정본이라 모킹하면 검증할 게 안 남는다). */
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  commitStaged,
  gitResult,
  UNLISTED_UPSTREAM,
  listCheckouts,
  listRemoteBranches,
  parseStatus,
  pullCheckout,
  pushCheckout,
  readStatus,
  resolveCheckout,
  setUpstream,
  stageAll,
  stageFile,
  unstageFile,
  type Checkout,
} from "./source-control.ts";

const tmps: string[] = [];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "scm-repo-"));
  tmps.push(dir);
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

// ── parseStatus ──────────────────────────────────────────────────────────────

test("parseStatus — branch · upstream · ahead/behind 헤더 셋", () => {
  const out = [
    "# branch.oid abc123",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -3",
    "",
  ].join("\n");
  assert.deepStrictEqual(parseStatus(out), {
    branch: "main",
    upstream: "origin/main",
    ahead: 2,
    behind: 3,
    staged: [],
    unstaged: [],
  });
});

test("parseStatus — 고침(M)은 스테이지·작업 트리 두 목록에 각각 갈려 든다", () => {
  // 인덱스도 워크트리도 고쳤다(XY = MM) — 공백이 든 경로도 안 깨진다.
  const out = "1 MM N... 100644 100644 100644 abcd abcd my file.txt";
  const r = parseStatus(out);
  assert.deepStrictEqual(r.staged, [{ path: "my file.txt", code: "M", word: "modified" }]);
  assert.deepStrictEqual(r.unstaged, [{ path: "my file.txt", code: "M", word: "modified" }]);
});

test("parseStatus — 지움(D) · 새 파일(untracked) · 이름 바뀜(R)", () => {
  const out = [
    "1 D. N... 100644 000000 000000 abcd 0000 gone.txt",
    "2 R. N... 100644 100644 100644 abcd abcd R100 new.txt\told.txt",
    "? fresh.txt",
  ].join("\n");
  const r = parseStatus(out);
  assert.deepStrictEqual(r.staged, [
    { path: "gone.txt", code: "D", word: "deleted" },
    { path: "new.txt", code: "R", word: "renamed" },
  ]);
  assert.deepStrictEqual(r.unstaged, [{ path: "fresh.txt", code: "?", word: "new" }]);
});

test("parseStatus — 모르는 코드(충돌 u)는 낱말 없이 코드 그대로 낸다", () => {
  const out = "u UU N... 100644 100644 100644 100644 abcd abcd abcd both.txt";
  const r = parseStatus(out);
  assert.deepStrictEqual(r.unstaged, [{ path: "both.txt", code: "UU", word: null }]);
});

// ── git 왕복 ─────────────────────────────────────────────────────────────────

test("listCheckouts — 워크트리가 0개인 레포에서도 루트 하나는 뜬다 (§4-2)", async () => {
  const repo = makeRepo();
  const list = await listCheckouts(repo);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].isRoot, true);
  assert.strictEqual(list[0].id, "root");
  assert.strictEqual(list[0].branch, "main");
});

test("listCheckouts — 워크트리를 더하면 둘째 줄로 뜨고 id가 디렉터리 이름이다", async () => {
  const repo = makeRepo();
  const wt = path.join(repo, "..", "wt1");
  execFileSync("git", ["-C", repo, "worktree", "add", "-b", "feature", wt], { encoding: "utf8" });
  tmps.push(wt);
  const list = await listCheckouts(repo);
  assert.strictEqual(list.length, 2);
  const worktree = list.find((c) => !c.isRoot)!;
  assert.strictEqual(worktree.id, "wt1");
  assert.strictEqual(worktree.branch, "feature");
});

test("resolveCheckout — 모르는 id는 null이다 (경로를 클라이언트가 못 지어낸다)", async () => {
  const repo = makeRepo();
  assert.strictEqual(await resolveCheckout(repo, "../etc"), null);
  assert.strictEqual((await resolveCheckout(repo, "root"))?.isRoot, true);
});

test("readStatus — 실제 파일 하나를 고치면 작업 트리 목록에 뜬다", async () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "two\n");
  const s = await readStatus(repo);
  assert.strictEqual(s.branch, "main");
  assert.deepStrictEqual(s.staged, []);
  assert.deepStrictEqual(s.unstaged, [{ path: "a.txt", code: "M", word: "modified" }]);
});

test("stageFile · unstageFile — git add와 git restore --staged를 그대로 왕복한다", async () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "two\n");
  await stageFile(repo, "a.txt");
  let s = await readStatus(repo);
  assert.deepStrictEqual(s.staged, [{ path: "a.txt", code: "M", word: "modified" }]);
  assert.deepStrictEqual(s.unstaged, []);

  await unstageFile(repo, "a.txt");
  s = await readStatus(repo);
  assert.deepStrictEqual(s.staged, []);
  assert.deepStrictEqual(s.unstaged, [{ path: "a.txt", code: "M", word: "modified" }]);
});

test("stageAll — 새 파일과 고친 파일을 한 번에 스테이지한다", async () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "two\n");
  writeFileSync(path.join(repo, "b.txt"), "new\n");
  await stageAll(repo);
  const s = await readStatus(repo);
  assert.strictEqual(s.staged.length, 2);
  assert.deepStrictEqual(s.unstaged, []);
});

test("listRemoteBranches · setUpstream — origin/HEAD은 후보에서 빠지고, 목록 밖 값은 거절한다", async () => {
  const upstream = makeRepo();
  const repo = mkdtempSync(path.join(tmpdir(), "scm-clone-"));
  tmps.push(repo);
  rmSync(repo, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", upstream, repo], { encoding: "utf8" });
  execFileSync("git", ["-C", repo, "checkout", "-qb", "topic"], { encoding: "utf8" });

  const remotes = await listRemoteBranches(repo);
  assert.deepStrictEqual(remotes, ["origin/main"]);

  assert.strictEqual(await setUpstream(repo, "origin/does-not-exist"), false);
  assert.strictEqual(await setUpstream(repo, "origin/main"), true);
  const tracked = execFileSync(
    "git",
    ["-C", repo, "rev-parse", "--abbrev-ref", "topic@{upstream}"],
    { encoding: "utf8" },
  ).trim();
  assert.strictEqual(tracked, "origin/main");
  // origin 리모트의 URL은 안 바뀐다(§11-3 결정 3).
  const url = execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  assert.strictEqual(url, upstream);
});

test("gitResult — 스테이지 실패는 git 사유가 error에 들고, 성공이면 error가 null이다 (§0-25 결정 9)", async () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "b.txt"), "new\n");
  const ok = await gitResult(repo, () => stageFile(repo, "b.txt"));
  assert.strictEqual(ok.error, null);
  assert.strictEqual(ok.status?.staged.length, 1);

  writeFileSync(path.join(repo, ".git", "index.lock"), "");
  writeFileSync(path.join(repo, "c.txt"), "new\n");
  const stage = await gitResult(repo, () => stageFile(repo, "c.txt"));
  assert.match(stage.error ?? "", /index\.lock/);
  const unstage = await gitResult(repo, () => unstageFile(repo, "b.txt"));
  assert.match(unstage.error ?? "", /index\.lock/);
  const all = await gitResult(repo, () => stageAll(repo));
  assert.match(all.error ?? "", /index\.lock/);
  assert.ok(stage.status, "실패해도 status는 다시 읽어 낸다");
});

test("gitResult — 목록 밖 업스트림은 git 사유가 아니라 UNLISTED_UPSTREAM 표지다", async () => {
  const repo = makeRepo();
  const r = await gitResult(repo, () => setUpstream(repo, "origin/nope"));
  assert.strictEqual(r.error, UNLISTED_UPSTREAM);
});

// ── commitStaged · pushCheckout · pullCheckout (§11-3 결정 4) ──────────────────

test("commitStaged — 스테이지된 것만 들어가고 트레일러가 안 붙는다", async () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "two\n");
  writeFileSync(path.join(repo, "b.txt"), "untracked\n");
  await stageFile(repo, "a.txt"); // b.txt는 스테이지 안 함
  const r = await commitStaged(repo, "고침 하나");
  assert.deepStrictEqual(r, { ok: true, error: null });
  const log = execFileSync("git", ["-C", repo, "log", "-1", "--format=%B"], { encoding: "utf8" });
  assert.strictEqual(log.trim(), "고침 하나"); // Ticket: 트레일러 없음
  const s = await readStatus(repo);
  assert.deepStrictEqual(s.staged, []);
  assert.deepStrictEqual(s.unstaged, [{ path: "b.txt", code: "?", word: "new" }]); // 안 들어감
});

test("commitStaged — 스테이지가 비어 있으면 실패 사유를 낸다", async () => {
  const repo = makeRepo();
  const r = await commitStaged(repo, "빈 커밋");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error && r.error.length > 0);
});

test("pullCheckout — --ff-only 하나. fast-forward면 성공하고 머지 커밋이 안 생긴다", async () => {
  const upstream = makeRepo();
  const repo = mkdtempSync(path.join(tmpdir(), "scm-clone2-"));
  tmps.push(repo);
  rmSync(repo, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", upstream, repo], { encoding: "utf8" });
  writeFileSync(path.join(upstream, "a.txt"), "upstream change\n");
  execFileSync("git", ["-C", upstream, "commit", "-qam", "upstream"], { encoding: "utf8" });

  const r = await pullCheckout(repo);
  assert.deepStrictEqual(r, { ok: true, error: null });
  const log = execFileSync("git", ["-C", repo, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  assert.strictEqual(log, "upstream"); // ff로 그대로 따라감, 새 머지 커밋 없음
});

test("pullCheckout — ff가 안 되면 실패 사유가 그대로 나오고 머지 커밋이 안 생긴다", async () => {
  const upstream = makeRepo();
  const repo = mkdtempSync(path.join(tmpdir(), "scm-clone3-"));
  tmps.push(repo);
  rmSync(repo, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", upstream, repo], { encoding: "utf8" });
  writeFileSync(path.join(upstream, "a.txt"), "upstream change\n");
  execFileSync("git", ["-C", upstream, "commit", "-qam", "upstream"], { encoding: "utf8" });
  writeFileSync(path.join(repo, "a.txt"), "local change\n");
  execFileSync("git", ["-C", repo, "commit", "-qam", "local"], { encoding: "utf8" });

  const before = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  const r = await pullCheckout(repo);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error && r.error.length > 0);
  const after = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert.strictEqual(before, after); // 머지 커밋이 안 생겼다
});

test("pushCheckout — 루트는 git push다", async () => {
  // upstream이 bare가 아니면 `main`이 거기서도 체크아웃된 채라 git 자신이 push를 거절한다
  // (denyCurrentBranch) — 그 방어는 애플리케이션 로직과 무관해 bare 리모트로 피한다.
  const source = makeRepo();
  const upstream = mkdtempSync(path.join(tmpdir(), "scm-bare-"));
  tmps.push(upstream);
  rmSync(upstream, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--bare", source, upstream], { encoding: "utf8" });
  const repo = mkdtempSync(path.join(tmpdir(), "scm-clone4-"));
  tmps.push(repo);
  rmSync(repo, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", upstream, repo], { encoding: "utf8" });
  writeFileSync(path.join(repo, "a.txt"), "local\n");
  execFileSync("git", ["-C", repo, "commit", "-qam", "local"], { encoding: "utf8" });

  const checkout: Checkout = { id: "root", path: repo, branch: "main", isRoot: true, pushSh: null };
  const r = await pushCheckout(checkout);
  assert.deepStrictEqual(r, { ok: true, error: null });
  const upstreamLog = execFileSync("git", ["-C", upstream, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  assert.strictEqual(upstreamLog, "local");
});

test("pushCheckout — 워크트리는 .dira/push.sh를 인자 없이 부른다", async () => {
  const repo = makeRepo();
  const wt = path.join(repo, "..", "wt-push");
  execFileSync("git", ["-C", repo, "worktree", "add", "-b", "feature", wt], { encoding: "utf8" });
  tmps.push(wt);
  mkdirSync(path.join(wt, ".dira"));
  // 가짜 push.sh — 진짜 헬퍼의 인자 없는 모드를 흉내만 낸다(락·non-ff 재시도는 그 파일의 몫이라
  // 여기서 검증하지 않는다 — 이 테스트가 보는 것은 "그 파일을 부르는가" 하나다).
  writeFileSync(
    path.join(wt, ".dira", "push.sh"),
    "#!/bin/bash\necho called > \"$(dirname \"$0\")/../called\"\n",
  );
  const checkout: Checkout = { id: "wt-push", path: wt, branch: "feature", isRoot: false, pushSh: true };
  const r = await pushCheckout(checkout, "main");
  assert.deepStrictEqual(r, { ok: true, error: null });
  const called = readFileSync(path.join(wt, "called"), "utf8");
  assert.strictEqual(called.trim(), "called");
});

test("pushCheckout — push.sh가 없으면 헬퍼를 만들지 않고 사유만 낸다", async () => {
  const repo = makeRepo();
  const checkout: Checkout = { id: "root", path: repo, branch: "main", isRoot: false, pushSh: false };
  const r = await pushCheckout(checkout);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "NO_PUSH_SH");
});

// ── 워크트리 push의 통합 브랜치 동기화 (§0-25 결정 10) ─────────────────────────

const G = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim();

/** 통합 브랜치 `dev`가 받는 트리에 체크아웃된 저장소 + 그 위 워크트리 + 실제 push.sh 사본. */
function makeIntegrationSetup() {
  const repo = makeRepo();
  G(repo, "checkout", "-q", "-b", "dev");
  G(repo, "config", "receive.denyCurrentBranch", "updateInstead"); // 실물 받는 트리와 같은 설정
  const origin = mkdtempSync(path.join(tmpdir(), "scm-origin-"));
  tmps.push(origin);
  execFileSync("git", ["clone", "-q", "--bare", repo, origin]);
  G(repo, "remote", "add", "origin", origin);
  const wt = path.join(repo, "..", `wt-${path.basename(repo)}`);
  G(repo, "worktree", "add", "-q", "-b", "feat", wt);
  tmps.push(wt);
  mkdirSync(path.join(wt, ".dira"));
  writeFileSync(path.join(repo, ".git", "info", "exclude"), ".dira/\n"); // 실물처럼 gitignore
  const src = readFileSync(path.join(import.meta.dirname, "../../../templates/hooks/push.sh"), "utf8");
  writeFileSync(path.join(wt, ".dira", "push.sh"), src.replaceAll("<통합 브랜치>", "dev"));
  const checkout: Checkout = { id: path.basename(wt), path: wt, branch: "feat", isRoot: false, pushSh: true };
  const commit = (cwd: string, file: string, body = file) => {
    writeFileSync(path.join(cwd, file), body + "\n");
    G(cwd, "add", file);
    G(cwd, "commit", "-qm", file);
    return G(cwd, "rev-parse", "HEAD");
  };
  return { repo, origin, wt, checkout, commit };
}

test("pushCheckout - 통합 브랜치가 전진해도 두 회차 모두 성공하고 origin은 그대로다", async () => {
  const { repo, origin, wt, checkout, commit } = makeIntegrationSetup();
  const originBefore = G(origin, "rev-parse", "HEAD");
  const made: string[] = [];
  for (const n of [1, 2]) {
    made.push(commit(repo, `dev${n}.txt`));
    made.push(commit(wt, `feat${n}.txt`));
    const r = await pushCheckout(checkout, "dev");
    assert.deepStrictEqual(r, { ok: true, error: null });
  }
  for (const c of made) G(repo, "merge-base", "--is-ancestor", c, "dev");
  assert.strictEqual(G(origin, "rev-parse", "HEAD"), originBefore);
});

test("pushCheckout - 통합 대상이 없으면 추측하지 않고 헬퍼도 안 부른다", async () => {
  const { checkout } = makeIntegrationSetup();
  assert.strictEqual((await pushCheckout(checkout, null)).error, "NO_INTEGRATION_BRANCH");
  assert.match((await pushCheckout(checkout, "nope")).error ?? "", /INTEGRATION_BRANCH_MISSING/);
});

test("pushCheckout - dirty 체크아웃은 합치지 않고 HEAD와 파일을 보존한다", async () => {
  const { repo, wt, checkout, commit } = makeIntegrationSetup();
  commit(repo, "dev1.txt");
  commit(wt, "feat1.txt");
  writeFileSync(path.join(wt, "untracked.txt"), "u\n");
  const head = G(wt, "rev-parse", "HEAD");
  const r = await pushCheckout(checkout, "dev");
  assert.strictEqual(r.error, "DIRTY_CHECKOUT");
  assert.strictEqual(G(wt, "rev-parse", "HEAD"), head);
  assert.strictEqual(readFileSync(path.join(wt, "untracked.txt"), "utf8"), "u\n");
});

test("pushCheckout - 내용 충돌이면 이번 merge만 abort하고 호출 전 상태로 돌린다", async () => {
  const { repo, wt, checkout, commit } = makeIntegrationSetup();
  commit(repo, "same.txt", "dev side");
  commit(wt, "same.txt", "feat side");
  const head = G(wt, "rev-parse", "HEAD");
  const r = await pushCheckout(checkout, "dev");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(G(wt, "rev-parse", "HEAD"), head);
  assert.strictEqual(G(wt, "status", "--porcelain"), "");
  assert.throws(() => G(wt, "rev-parse", "-q", "--verify", "MERGE_HEAD"));
});

test("pushCheckout - 진행 중인 merge가 있으면 건드리지 않는다", async () => {
  const { repo, wt, checkout, commit } = makeIntegrationSetup();
  commit(repo, "same.txt", "dev side");
  commit(wt, "same.txt", "feat side");
  assert.throws(() => G(wt, "merge", "--no-edit", "dev"));
  const r = await pushCheckout(checkout, "dev");
  assert.match(r.error ?? "", /IN_PROGRESS: MERGE_HEAD/);
  G(wt, "rev-parse", "-q", "--verify", "MERGE_HEAD"); // 사람의 merge가 남아 있다
});

function fakeHelper(wt: string, script: string) {
  writeFileSync(path.join(wt, ".dira", "push.sh"), `#!/bin/bash\n${script}\n`);
}

test("pushCheckout - non-ff 경합은 한 번만 다시 합치고 헬퍼를 재호출한다", async () => {
  const { repo, wt, checkout, commit } = makeIntegrationSetup();
  commit(wt, "feat1.txt");
  // 첫 호출은 그 사이 dev가 전진한 척 non-ff로 거절한다.
  fakeHelper(
    wt,
    `n=$(cat "$(dirname "$0")/n" 2>/dev/null || echo 0); echo $((n+1)) > "$(dirname "$0")/n"
if [ "$n" = 0 ]; then cd "${repo}" && echo x > late.txt && git add late.txt && git commit -qm late; echo "! [rejected] (non-fast-forward)" >&2; exit 1; fi`,
  );
  const r = await pushCheckout(checkout, "dev");
  assert.deepStrictEqual(r, { ok: true, error: null });
  assert.strictEqual(readFileSync(path.join(wt, ".dira", "n"), "utf8").trim(), "2");
  G(wt, "merge-base", "--is-ancestor", "dev", "HEAD"); // 두 번째 통합이 late를 가져왔다
});

test("pushCheckout - non-ff가 아닌 헬퍼 실패는 재시도하지 않는다", async () => {
  const { wt, checkout, commit } = makeIntegrationSetup();
  commit(wt, "feat1.txt");
  fakeHelper(wt, `echo x >> "$(dirname "$0")/n"; echo "Authentication failed" >&2; exit 1`);
  const r = await pushCheckout(checkout, "dev");
  assert.strictEqual(r.ok, false);
  assert.match(r.error ?? "", /Authentication failed/);
  assert.strictEqual(readFileSync(path.join(wt, ".dira", "n"), "utf8").trim(), "x");
});

// ── 일반 동기화 (§0-25 결정 10) ──────────────────────────────────────────────

/** bare 원격 + 복제본 둘(a, b). 둘 다 main이 origin/main을 추적한다. */
function makeTrio() {
  const base = mkdtempSync(path.join(tmpdir(), "scm-trio-"));
  tmps.push(base);
  const seed = makeRepo();
  const bare = path.join(base, "bare.git");
  execFileSync("git", ["clone", "-q", "--bare", seed, bare]);
  const clone = (n: string) => {
    const d = path.join(base, n);
    execFileSync("git", ["clone", "-q", bare, d]);
    G(d, "config", "user.email", "t@example.com");
    G(d, "config", "user.name", "t");
    return d;
  };
  return { bare, a: clone("a"), b: clone("b") };
}
const commitFile = (dir: string, name: string) => {
  writeFileSync(path.join(dir, name), name + "\n");
  G(dir, "add", name);
  G(dir, "commit", "-qm", name);
  return G(dir, "rev-parse", "HEAD");
};
const isAncestor = (dir: string, c: string) => {
  try {
    G(dir, "merge-base", "--is-ancestor", c, "HEAD");
    return true;
  } catch {
    return false;
  }
};
const bPush = (b: string) => {
  G(b, "pull", "-q", "--no-rebase", "--no-edit");
  G(b, "push", "-q", "origin", "main");
};
const rootOf = (p: string): Checkout => ({ id: "root", path: p, branch: "main", isRoot: true, pushSh: null });

test("동기화 — pull과 루트 push 두 회차: 서로 다른 파일 커밋이 갈려도 성공하고 원래 커밋이 조상이다", async () => {
  for (const mode of ["pull", "push"] as const) {
    const { a, b } = makeTrio();
    for (let i = 0; i < 2; i++) {
      const mine = commitFile(a, `${mode}-a${i}`);
      const theirs = commitFile(b, `${mode}-b${i}`);
      bPush(b);
      const r = mode === "pull" ? await pullCheckout(a) : await pushCheckout(rootOf(a));
      assert.deepStrictEqual(r, { ok: true, error: null });
      assert.ok(isAncestor(a, mine) && isAncestor(a, theirs));
      if (mode === "push") assert.strictEqual(G(a, "rev-parse", "HEAD"), G(a, "rev-parse", "origin/main"));
    }
  }
});

test("동기화 — 같음/앞섬/뒤처짐은 머지 커밋이 없고 분기만 만든다", async () => {
  const { a, b } = makeTrio();
  const parents = () => G(a, "rev-list", "--parents", "-1", "HEAD").split(" ").length - 1;
  const h0 = G(a, "rev-parse", "HEAD");
  assert.deepStrictEqual(await pullCheckout(a), { ok: true, error: null }); // 같음
  assert.strictEqual(G(a, "rev-parse", "HEAD"), h0);
  const ahead = commitFile(a, "ahead");
  assert.deepStrictEqual(await pullCheckout(a), { ok: true, error: null }); // 로컬만 앞섬
  assert.strictEqual(G(a, "rev-parse", "HEAD"), ahead);
  G(a, "push", "origin", "main");
  commitFile(b, "behind");
  bPush(b);
  assert.deepStrictEqual(await pullCheckout(a), { ok: true, error: null }); // 뒤처짐
  assert.strictEqual(G(a, "rev-parse", "HEAD"), G(b, "rev-parse", "HEAD")); // ff
  commitFile(a, "l");
  commitFile(b, "r");
  bPush(b);
  assert.deepStrictEqual(await pullCheckout(a), { ok: true, error: null }); // 분기
  assert.strictEqual(parents(), 2);
});

test("동기화 — dirty, untracked, 진행 중 merge, detached, 내용 충돌에서 상태를 보존한다", async () => {
  const snap = (d: string) => [G(d, "rev-parse", "HEAD"), G(d, "status", "--porcelain=v2"), G(d, "ls-files", "-s")].join("|");
  const cases: Record<string, (a: string, b: string) => void> = {
    dirty: (a) => writeFileSync(path.join(a, "a.txt"), "dirty\n"),
    untracked: (a) => writeFileSync(path.join(a, "u.txt"), "u\n"),
    detached: (a) => G(a, "checkout", "-q", "--detach"),
    merging: (a) => {
      G(a, "checkout", "-q", "-b", "x");
      commitFile(a, "x1");
      G(a, "checkout", "-q", "main");
      commitFile(a, "m1");
      try {
        G(a, "merge", "--no-commit", "--no-ff", "x");
      } catch {}
      writeFileSync(path.join(a, ".git", "MERGE_HEAD"), G(a, "rev-parse", "x") + "\n");
    },
  };
  for (const [name, setup] of Object.entries(cases)) {
    const { a, b } = makeTrio();
    commitFile(b, "r-" + name);
    bPush(b);
    if (name !== "detached") commitFile(a, "l-" + name);
    setup(a, b);
    const before = snap(a);
    const r = await pullCheckout(a);
    assert.strictEqual(r.ok, false, name);
    assert.strictEqual(snap(a), before, name);
  }
  // 내용 충돌: 이번 merge만 abort하고 잔여 상태가 없다
  const { a, b } = makeTrio();
  writeFileSync(path.join(b, "a.txt"), "r\n");
  G(b, "commit", "-qam", "r");
  bPush(b);
  writeFileSync(path.join(a, "a.txt"), "l\n");
  G(a, "commit", "-qam", "l");
  const before = G(a, "rev-parse", "HEAD");
  const r = await pullCheckout(a);
  assert.strictEqual(r.ok, false);
  assert.match(r.error ?? "", /MERGE_CONFLICT/);
  assert.strictEqual(G(a, "rev-parse", "HEAD"), before);
  assert.strictEqual(G(a, "status", "--porcelain"), "");
  assert.strictEqual(readFileSync(path.join(a, "a.txt"), "utf8"), "l\n");
});

test("동기화 — upstream 부재와 push 대상 불일치는 사유를 내고 원격에 안 쓴다", async () => {
  const { a, bare } = makeTrio();
  G(a, "checkout", "-q", "-b", "solo");
  commitFile(a, "s");
  const r1 = await pushCheckout({ ...rootOf(a), branch: "solo" });
  assert.match(r1.error ?? "", /NO_UPSTREAM/);
  G(a, "checkout", "-q", "main");
  commitFile(a, "m");
  G(a, "config", "remote.origin.push", "refs/heads/main:refs/heads/other");
  const r2 = await pushCheckout(rootOf(a));
  assert.match(r2.error ?? "", /PUSH_TARGET_MISMATCH/);
  G(a, "config", "--add", "remote.origin.push", "refs/heads/main:refs/heads/main");
  assert.match((await pushCheckout(rootOf(a))).error ?? "", /PUSH_TARGET_AMBIGUOUS/);
  assert.notStrictEqual(G(bare, "rev-parse", "main"), G(a, "rev-parse", "HEAD"));
  assert.strictEqual(G(bare, "branch", "--list", "other"), "");
});

test("동기화 — non-ff는 1회 재통합 후 성공하고 훅 거절은 재시도하지 않는다", async () => {
  const { a, b, bare } = makeTrio();
  // pre-receive 훅: 첫 호출에서 b의 커밋을 밀어 넣어 a의 push를 non-ff로 만든다
  commitFile(b, "race");
  const raceSha = G(b, "rev-parse", "HEAD");
  const marker = path.join(bare, "hook-count");
  mkdirSync(path.join(bare, "hooks"), { recursive: true });
  writeFileSync(
    path.join(bare, "hooks", "pre-receive"),
    `#!/bin/sh\nn=$(cat "${marker}" 2>/dev/null || echo 0)\necho $((n+1)) > "${marker}"\nexit 0\n`,
    { mode: 0o755 },
  );
  commitFile(a, "mine");
  G(b, "push", "-q", "origin", "main"); // fetch 이후 원격이 전진 - 첫 통합은 이미 이걸 본다
  assert.deepStrictEqual(await pushCheckout(rootOf(a)), { ok: true, error: null });
  assert.ok(isAncestor(a, raceSha));
  // 훅 거절: 횟수가 정확히 1 늘어난다
  writeFileSync(path.join(bare, "hooks", "pre-receive"), `#!/bin/sh\necho x >> "${marker}"\nexit 1\n`, { mode: 0o755 });
  const lines = () => readFileSync(marker, "utf8").split("\n").filter(Boolean).length;
  const n0 = lines();
  commitFile(a, "hooked");
  const r = await pushCheckout(rootOf(a));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(lines() - n0, 1);
});

test("동기화 — 같은 체크아웃의 동시 호출은 겹치지 않고 순서대로 돈다", async () => {
  const { a, b } = makeTrio();
  commitFile(b, "r");
  bPush(b);
  commitFile(a, "l");
  const rs = await Promise.all([pullCheckout(a), pullCheckout(a), pushCheckout(rootOf(a))]);
  assert.ok(rs.every((r) => r.ok), JSON.stringify(rs));
  assert.strictEqual(G(a, "rev-parse", "HEAD"), G(a, "rev-parse", "origin/main"));
});
