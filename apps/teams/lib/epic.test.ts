import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeEpic } from "./epic.ts";
import type { Suffixes } from "./queue.ts";

/** 픽스처 큐는 전부 임시 디렉터리다 — **진짜 `.dira`를 건드리지 않는다.** */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-epic-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const SFX: Suffixes = { inProgress: ".wip", done: ".done" };
const root = path.join(tmp, "dira");
mkdirSync(path.join(root, "tickets"), { recursive: true });

/** 티켓 하나 쓰고 stem을 돌려준다. `epic`이 null이면 그 키를 아예 안 쓴다. */
function ticket(stem: string, suffix: string, epic: string | null): string {
  const fm = ["---", `ticket: ${stem}`, "title: t", "kind: work", "persona: developer"];
  if (epic !== null) fm.push(`epic: ${epic}`);
  fm.push("---", "", "## Goal", "", "본문은 안 갈린다.", "");
  writeFileSync(path.join(root, "tickets", `${stem}${suffix}.md`), fm.join("\n"));
  return stem;
}

function read(stem: string, suffix: string): string {
  return readFileSync(path.join(root, "tickets", `${stem}${suffix}.md`), "utf8");
}

test("값 설정 — epic: 없는 티켓에 값이 붙는다", async () => {
  const stem = ticket("aaaa0001", "", null);
  const r = await writeEpic(root, SFX, stem, "P273");
  assert.deepEqual(r, { ok: true, stem });
  assert.match(read(stem, ""), /^epic: P273$/m);
});

test("빈 값이면 epic: 줄이 지워진다 — (에픽 없음)에 놓은 경우", async () => {
  const stem = ticket("aaaa0002", "", "P273");
  const r = await writeEpic(root, SFX, stem, "");
  assert.deepEqual(r, { ok: true, stem });
  assert.doesNotMatch(read(stem, ""), /^epic:/m);
});

test("이미 그 값이면 파일을 안 건드린다 — mtime 불변", async () => {
  const stem = ticket("aaaa0003", "", "P273");
  const before = read(stem, "");
  const mtimeBefore = statSync(path.join(root, "tickets", `${stem}.md`)).mtimeMs;
  const r = await writeEpic(root, SFX, stem, "P273");
  assert.deepEqual(r, { ok: true, stem });
  assert.equal(read(stem, ""), before);
  assert.equal(statSync(path.join(root, "tickets", `${stem}.md`)).mtimeMs, mtimeBefore);
});

test("`.wip`·`.done`은 거절한다 — saveTicket과 같은 LOCKED 문장", async () => {
  const wip = ticket("aaaa0004", ".wip", null);
  const done = ticket("aaaa0005", ".done", null);
  const beforeWip = read(wip, ".wip");
  const beforeDone = read(done, ".done");

  const rWip = await writeEpic(root, SFX, wip, "P273");
  assert.equal(rWip.ok, false);
  assert.match((rWip as { error: string }).error, /진행중 티켓은 편집할 수 없습니다/);

  const rDone = await writeEpic(root, SFX, done, "P273");
  assert.equal(rDone.ok, false);
  assert.match((rDone as { error: string }).error, /완료 티켓은 편집할 수 없습니다/);

  // 거절이면 파일은 한 글자도 안 갈린다.
  assert.equal(read(wip, ".wip"), beforeWip);
  assert.equal(read(done, ".done"), beforeDone);
});

test("다른 키도 본문도 안 갈린다 — epic: 한 줄만 바뀐다", async () => {
  const stem = ticket("aaaa0006", "", null);
  await writeEpic(root, SFX, stem, "P273");
  const text = read(stem, "");
  assert.match(text, /^title: t$/m);
  assert.match(text, /^kind: work$/m);
  assert.match(text, /^persona: developer$/m);
  assert.match(text, /^epic: P273$/m);
  assert.match(text, /본문은 안 갈린다\./);
});

test("큐에 없는 티켓", async () => {
  const r = await writeEpic(root, SFX, "없는해시", "P273");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /큐에 없는 티켓/);
});
