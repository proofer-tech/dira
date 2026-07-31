import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { followup } from "./followup.ts";
import { readFm } from "./queue.ts";
import type { Suffixes } from "./queue.ts";

/** 픽스처 큐는 전부 임시 디렉터리다 — **진짜 `.dira`를 건드리지 않는다.** 이 파일이 만드는 건
 *  티켓 파일이고, 실수로 진짜 큐를 가리키면 새 티켓이 실제로 디스패치된다. */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-followup-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const SFX: Suffixes = { inProgress: ".wip", done: ".done" };
const root = path.join(tmp, "dira");
const dir = path.join(root, "tickets");
mkdirSync(dir, { recursive: true });

/** 티켓 하나 쓰고 stem을 돌려준다. `fm`은 frontmatter 줄 그대로(엔진 키까지 넣어 본다). */
function ticket(stem: string, suffix: string, fm: string[], body: string): string {
  writeFileSync(path.join(dir, `${stem}${suffix}.md`), ["---", ...fm, "---", "", body].join("\n"));
  return stem;
}

/** 지금 큐의 파일 이름 집합 — 새로 생긴 것 하나를 집어내는 데 쓴다. */
const names = () => new Set(readdirSync(dir));

const ORIGIN_BODY = [
  "## Goal",
  "무언가를 만든다.",
  "",
  "## Done when",
  "- [ ] 만들어진다",
  "",
  "## 결과",
  "만들었다. `abc1234`로 push.",
  "",
].join("\n");

// ---------- 되는 길 ----------

test("완료 티켓 → 새 열린 티켓 한 장. 본문 순서·fm 키가 §2-2 계약과 같다", async () => {
  const stem = ticket(
    "done1111",
    ".done",
    [
      "ticket: done1111",
      "title: 원본 제목",
      "kind: work",
      "persona: developer",
      "deps: [aaaa0000]",
      "req: bbbb0000",
      "session_id: 11111111-2222-3333-4444-555555555555",
      "owner: developer / w1-11111111",
      "assigned_at: 2026-08-01T00:00:00+09:00",
      "pid: 4932",
      "attempts: 1",
      "claimed_at: 2026-08-01T00:00:00+09:00",
      "awaiting: cccc0000",
      "inbox: /tmp/inbox-x",
    ],
    ORIGIN_BODY,
  );

  const before = names();
  const r = await followup(root, SFX, stem, "  이어서 이것도 해주세요\n두 번째 줄  ");
  assert.equal(r.ok, true, JSON.stringify(r));
  const created = (r as { stem: string }).stem;

  // 새 파일은 **열린 티켓 하나**다(접미사 없음).
  const added = [...names()].filter((n) => !before.has(n));
  assert.deepEqual(added, [`${created}.md`]);

  const text = readFileSync(path.join(dir, `${created}.md`), "utf8");
  const { fm, lines, end } = readFm(text);

  // fm: title은 참견 첫 줄, kind·persona는 원본 값, 그 밖은 하나도 없다.
  assert.equal(fm.ticket, created);
  assert.equal(fm.title, "이어서 이것도 해주세요");
  assert.equal(fm.kind, "work");
  assert.equal(fm.persona, "developer");
  assert.deepEqual(Object.keys(fm), ["ticket", "title", "kind", "persona"]);
  for (const k of [
    "deps",
    "req",
    "session_id",
    "owner",
    "assigned_at",
    "pid",
    "attempts",
    "claimed_at",
    "awaiting",
    "inbox",
  ]) {
    assert.equal(fm[k], undefined, `${k}가 넘어왔다`);
  }

  // 본문: `## 이어서` → 참견 → 라벨 절 → 원본 본문 전문(`## 결과` 포함) 순서.
  const body = lines.slice(end + 1).join("\n");
  assert.equal(
    body,
    [
      "",
      "## 이어서",
      "이어서 이것도 해주세요",
      "두 번째 줄",
      "",
      `## 이어받은 티켓 — ${stem}`,
      "아래는 그 티켓 전문이다. **이미 끝난 일이라 맥락으로만 읽는다** — 계약은 위 `## 이어서`다.",
      "",
      ORIGIN_BODY.trimEnd(),
      "",
    ].join("\n"),
  );
  // 참견이 위, 원본이 아래다 — 순서가 계약이다(§2-2).
  assert.ok(body.indexOf("## 이어서") < body.indexOf("## 이어받은 티켓"));
  assert.ok(body.indexOf("## 이어받은 티켓") < body.indexOf("## Goal"));
});

test("kind·persona가 없는 원본이면 그 키를 아예 안 쓴다", async () => {
  const stem = ticket("done2222", ".done", ["ticket: done2222", "title: t"], "본문\n");
  const r = await followup(root, SFX, stem, "이어서");
  assert.equal(r.ok, true);
  const { fm } = readFm(readFileSync(path.join(dir, `${(r as { stem: string }).stem}.md`), "utf8"));
  assert.deepEqual(Object.keys(fm), ["ticket", "title"]);
});

test("persona가 엔진 규칙 밖이면 안 싣는다 — 그 값이 경로가 된다", async () => {
  const stem = ticket(
    "done3333",
    ".done",
    ["ticket: done3333", "title: t", "kind: work", "persona: ../../etc"],
    "본문\n",
  );
  const r = await followup(root, SFX, stem, "이어서");
  assert.equal(r.ok, true);
  const { fm } = readFm(readFileSync(path.join(dir, `${(r as { stem: string }).stem}.md`), "utf8"));
  assert.equal(fm.persona, undefined);
  assert.equal(fm.kind, "work");
});

test("참견 첫 줄이 80자를 넘으면 `…`로 자른다 (reqTitle 재사용)", async () => {
  const stem = ticket("done4444", ".done", ["ticket: done4444", "title: t"], "본문\n");
  const long = "가".repeat(200);
  const r = await followup(root, SFX, stem, `\n\n${long}\n뒷줄`);
  assert.equal(r.ok, true);
  const { fm } = readFm(readFileSync(path.join(dir, `${(r as { stem: string }).stem}.md`), "utf8"));
  assert.equal(fm.title, "가".repeat(80) + "…");
  // frontmatter는 줄 단위 정규식이다 — 제목이 여러 줄이면 티켓이 조용히 큐에서 사라진다.
  assert.equal(fm.title.includes("\n"), false);
});

// ---------- 모드가 어긋나면 실패 + 사유 (§2-2) ----------

test("`.wip`·열린 티켓은 이어받지 않는다 — 조용히 참견으로 바꾸지 않는다", async () => {
  const before = names();
  const cases: [string, string, string][] = [
    // [stem, 접미사, 기대 detail]
    [ticket("open1111", "", ["ticket: open1111", "title: t"], "본문\n"), "", "상태: 열림"],
    [ticket("wip11111", ".wip", ["ticket: wip11111", "title: t"], "본문\n"), ".wip", "상태: 진행중"],
  ];
  for (const [stem, , detail] of cases) {
    const r = await followup(root, SFX, stem, "이어서");
    assert.equal(r.ok, false, stem);
    assert.equal((r as { reason: string }).reason, "not-done", stem);
    assert.equal((r as { detail: string }).detail, detail, stem);
    assert.match((r as { error: string }).error, /완료 티켓이 아닙니다/);
  }
  // 실패했으면 **파일이 하나도 안 생겼다**(픽스처로 쓴 티켓 2장만 늘었다).
  assert.deepEqual([...names()].filter((n) => !before.has(n)).sort(), [
    "open1111.md",
    "wip11111.wip.md",
  ]);
});

test("빈 참견·큐에 없는 티켓·frontmatter 없음은 `other` + 원문", async () => {
  const stem = ticket("done5555", ".done", ["ticket: done5555", "title: t"], "본문\n");
  const before = names();
  for (const bad of ["", "   ", "\n\n", "\r\n \t"]) {
    const r = await followup(root, SFX, stem, bad);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /보낼 내용을 입력하세요/);
  }
  const missing = await followup(root, SFX, "없는해시", "이어서");
  assert.equal((missing as { reason: string }).reason, "other");
  assert.match((missing as { error: string }).error, /큐에 없는 티켓/);

  // frontmatter가 깨진 파일 — `scan()`이 빼는 파일이라 이어받을 값이 없다.
  writeFileSync(path.join(dir, "broke11.done.md"), "제목만 있고 fm이 없다\n");
  const broke = await followup(root, SFX, "broke11", "이어서");
  assert.equal((broke as { reason: string }).reason, "other");
  assert.match((broke as { error: string }).error, /frontmatter가 없거나/);

  assert.deepEqual([...names()].filter((n) => !before.has(n)), ["broke11.done.md"]);
});

// ---------- 원본 불변 ----------

test("원본 파일은 한 글자도 안 바뀐다 (내용·mtime)", async () => {
  const stem = ticket(
    "done6666",
    ".done",
    ["ticket: done6666", "title: 원본", "kind: feedback", "persona: pm"],
    ORIGIN_BODY,
  );
  const p = path.join(dir, `${stem}.done.md`);
  const text0 = readFileSync(p, "utf8");
  const st0 = statSync(p);

  const r = await followup(root, SFX, stem, "이어서 다음 것");
  assert.equal(r.ok, true);

  const st1 = statSync(p);
  assert.equal(readFileSync(p, "utf8"), text0);
  assert.equal(st1.mtimeMs, st0.mtimeMs);
  assert.equal(st1.size, st0.size);
  // 파일명도 그대로다 — `.done`이 열림으로 되돌아가지 않는다.
  assert.ok(names().has(`${stem}.done.md`));
});
