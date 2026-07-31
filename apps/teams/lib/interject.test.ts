import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { interject } from "./interject.ts";
import type { Suffixes } from "./queue.ts";

/** 픽스처 큐는 전부 임시 디렉터리다 — **진짜 `.dira`를 건드리지 않는다.** */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-interject-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const SFX: Suffixes = { inProgress: ".wip", done: ".done" };
const root = path.join(tmp, "dira");
mkdirSync(path.join(root, "tickets"), { recursive: true });

/** 티켓 하나 쓰고 stem을 돌려준다. `inbox`가 null이면 그 키를 아예 안 쓴다. */
function ticket(stem: string, suffix: string, inbox: string | null): string {
  const fm = ["---", `ticket: ${stem}`, "title: t", "kind: work"];
  if (inbox !== null) fm.push(`inbox: ${inbox}`);
  fm.push("---", "", "## Goal", "");
  writeFileSync(path.join(root, "tickets", `${stem}${suffix}.md`), fm.join("\n"));
  return stem;
}

/** POSIX `mkfifo`. `tick.sh`가 입구를 만들 때 쓰는 바로 그 바이너리다(새 npm 0). */
function mkfifo(name: string): string {
  const p = path.join(tmp, name);
  execFileSync("mkfifo", [p]);
  return p;
}

// ---------- 되는 길 ----------

test("읽는 쪽이 있으면 한 줄이 FIFO에 도착한다", async () => {
  const fifo = mkfifo("inbox-live");
  // 읽는 쪽을 먼저 붙인다 = 도는 세션. `O_NONBLOCK`이라 이 open도 안 막힌다.
  const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stem = ticket("aaaa1111", ".wip", fifo);
    assert.deepEqual(await interject(root, SFX, stem, "  참견입니다\n두 줄  "), { ok: true });

    const buf = Buffer.alloc(4096);
    const { bytesRead } = await reader.read(buf, 0, buf.length, null);
    const line = buf.subarray(0, bytesRead).toString("utf8");
    assert.ok(line.endsWith("\n"), `\\n으로 끝나야 한다: ${JSON.stringify(line)}`);
    // 앞뒤 공백은 잘리고, 본문의 개행은 이스케이프돼 한 줄로 나간다.
    assert.equal(line.trimEnd().split("\n").length, 1);
    assert.deepEqual(JSON.parse(line), {
      type: "user",
      message: { role: "user", content: "참견입니다\n두 줄" },
    });
  } finally {
    await reader.close();
  }
});

// ---------- 실패 사유가 갈린다 (§2-2 "각각 다른 문구") ----------

test("읽는 쪽이 없으면 ENXIO — 블록하지 않고 '세션이 이미 끝났습니다'", async () => {
  const fifo = mkfifo("inbox-dead"); // 아무도 안 연다
  const stem = ticket("aaaa2222", ".wip", fifo);
  const r = await interject(root, SFX, stem, "안녕");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /세션이 이미 끝났습니다/);
});

test("FIFO 파일이 없으면 ENOENT — ENXIO와 다른 문구", async () => {
  const stem = ticket("aaaa3333", ".wip", path.join(tmp, "없는입구"));
  const r = await interject(root, SFX, stem, "안녕");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /입구가 없습니다/);
});

test("`.wip`이 아니면 열기 전에 거절한다", async () => {
  const fifo = mkfifo("inbox-open");
  const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    for (const sfx of ["", ".done"]) {
      const r = await interject(root, SFX, ticket(`bbbb${sfx.length}`, sfx, fifo), "안녕");
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /진행중 티켓이 아닙니다/);
    }
  } finally {
    await reader.close();
  }
});

test("`inbox` 키가 없으면 그 사유로 거절한다", async () => {
  const r = await interject(root, SFX, ticket("cccc1111", ".wip", null), "안녕");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /참견 입구가 없습니다\(frontmatter/);
});

test("빈 본문·공백만인 본문은 안 보낸다 (신뢰 경계)", async () => {
  const fifo = mkfifo("inbox-empty");
  const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stem = ticket("dddd1111", ".wip", fifo);
    for (const bad of ["", "   ", "\n\n", "\r\n \t"]) {
      const r = await interject(root, SFX, stem, bad);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /보낼 내용을 입력하세요/);
    }
    // 아무것도 안 갔다는 증거 — 읽는 쪽이 붙어 있는데 FIFO가 비어 있다(쓰는 쪽이 없으니 EOF).
    assert.equal((await reader.read(Buffer.alloc(16), 0, 16, null)).bytesRead, 0);
  } finally {
    await reader.close();
  }
});

test("큐에 없는 티켓", async () => {
  const r = await interject(root, SFX, "없는해시", "안녕");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /큐에 없는 티켓/);
});

test("실패 4종은 `reason` 코드와 mono 원문으로 갈린다 (§비주얼 §21)", async () => {
  const dead = mkfifo("inbox-reason-dead"); // 읽는 쪽 없음 → ENXIO
  const gone = path.join(tmp, "없는입구-reason"); // 파일 없음 → ENOENT
  const live = mkfifo("inbox-reason-live");
  const reader = await open(live, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const cases: [string, string, string][] = [
      // [stem, 기대 reason, 기대 detail]
      [ticket("ffff1111", ".wip", dead), "ENXIO", `ENXIO: ${dead}`],
      [ticket("ffff2222", ".wip", gone), "ENOENT", `ENOENT: ${gone}`],
      [ticket("ffff3333", "", live), "not-wip", "상태: 열림"],
      [ticket("ffff4444", ".done", live), "not-wip", "상태: 완료"],
      [ticket("ffff5555", ".wip", null), "no-inbox", "frontmatter에 inbox 없음"],
    ];
    for (const [stem, reason, detail] of cases) {
      const r = await interject(root, SFX, stem, "안녕");
      assert.equal(r.ok, false);
      assert.equal((r as { reason: string }).reason, reason, stem);
      assert.equal((r as { detail: string }).detail, detail, stem);
    }
    // §21에 항이 없는 나머지는 `other`이고 원문이 그대로 detail이다(화면이 제목 한 줄로 그린다).
    const other = await interject(root, SFX, ticket("ffff6666", ".wip", "run/rel"), "안녕");
    assert.equal((other as { reason: string }).reason, "other");
    assert.match((other as { detail: string }).detail, /절대경로가 아닙니다/);
  } finally {
    await reader.close();
  }
});

// ---------- 경로 방어 ----------

test("`inbox`가 FIFO가 아니면 그 파일에 쓰지 않는다", async () => {
  const victim = path.join(tmp, "victim.txt");
  writeFileSync(victim, "건드리면 안 되는 내용\n");
  const r = await interject(root, SFX, ticket("eeee1111", ".wip", victim), "안녕");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /FIFO가 아닙니다/);
  assert.equal(execFileSync("cat", [victim]).toString(), "건드리면 안 되는 내용\n");
});

test("`inbox`가 상대경로면 거절한다 — 서버 cwd 기준으로 풀리면 앱 파일을 연다", async () => {
  const r = await interject(root, SFX, ticket("eeee2222", ".wip", "run/inbox-x"), "안녕");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /절대경로가 아닙니다/);
});
