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
  const r = await pushCheckout(checkout);
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
