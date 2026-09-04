import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findByContent, findByName, listExplorerDir, openExplorerFile, redirectTarget, saveExplorerFile } from "./explorer.ts";

/** DESIGN.md §11-2 결정 1 · 2 · 4 픽스처.
 *
 *      <tmp>/root/            ← 프로젝트 루트(뿌리)
 *        src/urls.ts
 *        .dira/
 *          tickets/<hash>.wip.md · <hash>.done.md
 *        loop/                ← loop/loop가 root를 다시 가리키는 순환 심링크
 *      <tmp>/personas/<name>/PROFILE.md
 *      <tmp>/protocols/AGENTS.md
 */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-explorer-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "root");
const ticketsDir = path.join(root, ".dira", "tickets");
const personasDir = path.join(tmp, "personas");
const protocolsDir = path.join(tmp, "protocols");
mkdirSync(path.join(root, "src"), { recursive: true });
mkdirSync(ticketsDir, { recursive: true });
mkdirSync(path.join(personasDir, "developer"), { recursive: true });
mkdirSync(protocolsDir, { recursive: true });
mkdirSync(path.join(root, "loop"), { recursive: true });

writeFileSync(path.join(root, "src", "urls.ts"), "export const A = 1;\n");
writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
writeFileSync(path.join(root, "big.bin"), Buffer.alloc(0));
writeFileSync(path.join(ticketsDir, "abc123.wip.md"), "---\nticket: abc123\n---\n본문\n");
writeFileSync(path.join(ticketsDir, "def456.done.md"), "---\nticket: def456\n---\n본문\n");
writeFileSync(path.join(personasDir, "developer", "PROFILE.md"), "# developer\n");
writeFileSync(path.join(protocolsDir, "AGENTS.md"), "협업 프로토콜\n");
symlinkSync(root, path.join(root, "loop", "loop")); // 실경로가 조상(root)과 같다 — 순환

// ── 목록(결정 1) ─────────────────────────────────────────────────────────

test("한 단계 목록 — 디렉터리가 먼저, 이름 오름차순", async () => {
  const r = await listExplorerDir(root, "");
  assert.ok(r.ok);
  if (!r.ok) return;
  const names = r.entries.map((e) => `${e.isDir ? "d" : "f"}:${e.name}`);
  const dirIdx = names.findIndex((n) => n.startsWith("d:"));
  const fileIdx = names.findIndex((n) => n.startsWith("f:"));
  assert.ok(dirIdx < fileIdx, "디렉터리가 파일보다 먼저다");
  assert.ok(names.includes("f:.gitignore"), "숨은 파일도 목록엔 있다(거르기는 화면이 한다)");
});

test("상한 2,000 — 넘으면 capped와 total이 실제 개수를 낸다", async () => {
  const many = path.join(tmp, "many");
  mkdirSync(many);
  for (let i = 0; i < 2005; i++) writeFileSync(path.join(many, `f${String(i).padStart(4, "0")}`), "");
  const r = await listExplorerDir(tmp, "many");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.strictEqual(r.entries.length, 2000);
  assert.strictEqual(r.total, 2005);
  assert.strictEqual(r.capped, true);
});

test("순환 — 실경로가 이미 조상에 있으면 안 펼친다", async () => {
  const r = await listExplorerDir(root, "loop/loop");
  assert.ok(!r.ok);
});

test("경로 방어 — 루트 밖은 안 열린다(다른 프로젝트 경로를 넣어도)", async () => {
  const r = await listExplorerDir(root, "../personas");
  assert.ok(!r.ok);
});

// ── 리다이렉트(결정 2) ───────────────────────────────────────────────────

test("티켓 .wip.md·.done.md는 티켓 화면으로 — 해시만 남는다", () => {
  assert.strictEqual(
    redirectTarget(path.join(ticketsDir, "abc123.wip.md"), "demo", ticketsDir, personasDir, protocolsDir),
    "/p/demo/tickets/abc123",
  );
  assert.strictEqual(
    redirectTarget(path.join(ticketsDir, "def456.done.md"), "demo", ticketsDir, personasDir, protocolsDir),
    "/p/demo/tickets/def456",
  );
});

test("페르소나 디렉터리 밑은 페르소나 화면으로", () => {
  assert.strictEqual(
    redirectTarget(
      path.join(personasDir, "developer", "PROFILE.md"),
      "demo",
      ticketsDir,
      personasDir,
      protocolsDir,
    ),
    "/p/demo/personas/developer",
  );
});

test("프로토콜 디렉터리 밑 .md는 프로토콜 화면으로 — ?file=", () => {
  assert.strictEqual(
    redirectTarget(path.join(protocolsDir, "AGENTS.md"), "demo", ticketsDir, personasDir, protocolsDir),
    "/p/demo/protocols?file=AGENTS.md",
  );
});

test("셋 다 아니면 리다이렉트가 없다 — 이 편집기가 연다", () => {
  assert.strictEqual(
    redirectTarget(path.join(root, "src", "urls.ts"), "demo", ticketsDir, personasDir, protocolsDir),
    null,
  );
});

// ── 열기(결정 2) ─────────────────────────────────────────────────────────

const noRedirect = { projectId: "demo", ticketsDir: "", personasDir: "", protocolsDir: "" };

test("일반 텍스트 파일이 연다", async () => {
  const f = await openExplorerFile(root, "src/urls.ts", noRedirect);
  assert.strictEqual(f.kind, "text");
  if (f.kind === "text") assert.strictEqual(f.text, "export const A = 1;\n");
});

test("1MB 넘으면 안 연다", async () => {
  const big = path.join(root, "huge.txt");
  writeFileSync(big, Buffer.alloc(1024 * 1024 + 1, "a"));
  const f = await openExplorerFile(root, "huge.txt", noRedirect);
  assert.strictEqual(f.kind, "unreadable");
});

test("NUL 바이트가 있으면 바이너리라 안 연다", async () => {
  writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2]));
  const f = await openExplorerFile(root, "bin.dat", noRedirect);
  assert.strictEqual(f.kind, "unreadable");
});

test("티켓 디렉터리 밑 .md는 이 함수도 리다이렉트를 낸다", async () => {
  const f = await openExplorerFile(root, ".dira/tickets/abc123.wip.md", {
    projectId: "demo",
    ticketsDir,
    personasDir,
    protocolsDir,
  });
  assert.deepStrictEqual(f, { kind: "redirect", to: "/p/demo/tickets/abc123" });
});

// ── 저장(결정 4) ─────────────────────────────────────────────────────────

test("원자적 저장 — 디스크가 갈리고 새 mtime·size를 낸다", async () => {
  const rel = "src/urls.ts";
  const before = await stat(path.join(root, rel));
  const r = await saveExplorerFile(root, rel, "export const A = 2;\n", before.mtimeMs, before.size, ticketsDir);
  assert.ok(r.ok);
  assert.strictEqual(readFileSync(path.join(root, rel), "utf8"), "export const A = 2;\n");
});

test("저장 충돌 — 연 뒤 mtime·size가 갈리면 거절한다", async () => {
  const rel = "src/urls.ts";
  const r = await saveExplorerFile(root, rel, "손댄다\n", 1, 999999, ticketsDir);
  assert.ok(!r.ok);
});

test("티켓 .wip.md는 이 함수도 한 번 더 막는다(§11-2 결정 4 방어 한 겹)", async () => {
  const rel = ".dira/tickets/abc123.wip.md";
  const st = await stat(path.join(root, rel));
  const r = await saveExplorerFile(root, rel, "고친다\n", st.mtimeMs, st.size, ticketsDir);
  assert.ok(!r.ok);
});

// ── 찾기(결정 3) ─────────────────────────────────────────────────────────

mkdirSync(path.join(root, "worktrees", "w9", "src"), { recursive: true });
writeFileSync(path.join(root, "worktrees", "w9", "src", "urls.ts"), "export const A = 1;\n");
writeFileSync(path.join(root, "src", "home-agent.ts"), "export const HOME_PERSONA = 1;\n");

test("이름 찾기 — 파일명이 query를 담으면 걸린다", async () => {
  const r = await findByName(root, "urls", false);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.matches, ["src/urls.ts"]);
});

test("이름 찾기 — 워크트리 사본은 기본으로 빠진다, 체크박스를 켜면 뜬다", async () => {
  const off = await findByName(root, "urls", false);
  assert.ok(off.ok);
  assert.strictEqual(off.matches.length, 1);
  const on = await findByName(root, "urls", true);
  assert.ok(on.ok);
  assert.strictEqual(on.matches.length, 2);
});

test("내용 찾기 — HOME_PERSONA가 그 줄과 함께 걸린다", async () => {
  const r = await findByContent(root, "HOME_PERSONA", false);
  assert.ok(r.ok);
  assert.strictEqual(r.hits.length, 1);
  assert.strictEqual(r.hits[0]?.file, "src/home-agent.ts");
  assert.strictEqual(r.hits[0]?.line, 1);
  assert.ok(!r.truncated);
});

test("내용 찾기 — 워크트리 사본은 기본으로 빠진다", async () => {
  writeFileSync(path.join(root, "worktrees", "w9", "src", "home-agent.ts"), "export const HOME_PERSONA = 1;\n");
  const off = await findByContent(root, "HOME_PERSONA", false);
  assert.ok(off.ok);
  assert.strictEqual(off.hits.length, 1);
  const on = await findByContent(root, "HOME_PERSONA", true);
  assert.ok(on.ok);
  assert.strictEqual(on.hits.length, 2);
});
