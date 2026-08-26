import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Suffixes } from "./queue.ts";
import { listTickets } from "./queue.ts";
import {
  NO_EPIC,
  createEpic,
  deleteEpicMemory,
  epicMemory,
  epicReadmeBody,
  epicTitle,
  listEpics,
  refreshKnownRefs,
  resolveMarkdownRefs,
  saveEpicReadme,
  suggestEpicKey,
} from "./epics.ts";

const DEFAULT: Suffixes = { inProgress: ".wip", done: ".done" };

const root = mkdtempSync(path.join(tmpdir(), "fse-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "tickets"));

const fm = (o: Record<string, string>) =>
  "---\n" +
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n") +
  "\n---\n";

function write(name: string, body: string) {
  writeFileSync(path.join(root, "tickets", name), body);
}

// P273: 대기 1 · 진행중 1 · 완료 1. P273-2는 접두사가 같아도 다른 에픽(결정 1).
write("a1.md", fm({ ticket: "a1", title: "A1", epic: "P273" }));
write(
  "a2.wip.md",
  fm({ ticket: "a2", title: "A2", epic: "P273", session_id: "s", owner: "developer / w1-83533def" }),
);
write("a3.done.md", fm({ ticket: "a3", title: "A3", epic: "P273", owner: "developer / w9-83533def" }));
write("a4.md", fm({ ticket: "a4", title: "A4", epic: "P273-2" }));
// P10 — 디렉터리 없음(제목·메모리 없음이 정상인지 보는 픽스처)
write("b1.md", fm({ ticket: "b1", title: "B1", epic: "P10" }));
// epic: 없음 -> (에픽 없음)
write("c1.md", fm({ ticket: "c1", title: "C1" }));
write("c2.done.md", fm({ ticket: "c2", title: "C2" }));

// 워커 집합(§에픽 결정 9) — P273에 워커 둘, 하나는 owner: 형식이 아니라 안 세야 한다.
write(
  "a5.wip.md",
  fm({ ticket: "a5", title: "A5", epic: "P273", session_id: "s2", owner: "developer / w2-77646def" }),
);
write("a6.wip.md", fm({ ticket: "a6", title: "A6", epic: "P273", session_id: "s3", owner: "손으로 씀" }));

// P273의 README + 메모리(한 단계 글롭)
mkdirSync(path.join(root, "epics", "P273", "memory"), { recursive: true });
writeFileSync(path.join(root, "epics", "P273", "README.md"), "P273 제목\n\n본문\n");
writeFileSync(path.join(root, "epics", "P273", "memory", "x.md"), "x 내용\n");
writeFileSync(path.join(root, "epics", "P273", "memory", "y.md"), "y 내용\n");
mkdirSync(path.join(root, "epics", "P273", "memory", "하위"), { recursive: true });
writeFileSync(path.join(root, "epics", "P273", "memory", "하위", "z.md"), "안 읽혀야 한다\n");

// P900 — 티켓 0건, 디렉터리만 있다(README도 없다). listEpics가 합쳐야 하는 그 자리다.
mkdirSync(path.join(root, "epics", "P900"), { recursive: true });

test("에픽 목록 — epic: 값 집합(distinct), 접두사 정규화 안 한다", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = await listEpics(root, tickets);
  assert.deepStrictEqual(
    epics.map((e) => e.epic),
    ["P10", "P273", "P273-2", "P900", NO_EPIC], // 문자열 정렬, (에픽 없음) 맨 뒤
  );
});

test("에픽 목록 — 티켓 0건인 디렉터리 키도 든다, counts 다 0·workers 빈 목록", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = await listEpics(root, tickets);
  const p900 = epics.find((e) => e.epic === "P900")!;
  assert.deepStrictEqual(p900.counts, { open: 0, wip: 0, done: 0 });
  assert.deepStrictEqual(p900.workers, []);
  // 티켓만 있고 디렉터리가 없는 키(P10)도 그대로 든다(결정 17 수용조건 4)
  assert.ok(epics.some((e) => e.epic === "P10"));
});

test("에픽 건수 — 상태 3종은 queue.ts의 기존 판정 그대로다", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = await listEpics(root, tickets);
  const p273 = epics.find((e) => e.epic === "P273")!;
  // wip 3 = a2·a5·a6 (§워커 집합 픽스처 — a6은 owner: 형식이 아니라 건수엔 들되 워커는 안 든다)
  assert.deepStrictEqual(p273.counts, { open: 1, wip: 3, done: 1 });
  const noEpic = epics.find((e) => e.epic === NO_EPIC)!;
  assert.deepStrictEqual(noEpic.counts, { open: 1, wip: 0, done: 1 });
});

test("에픽 워커 집합 — 같은 에픽 .wip 워커 둘이 distinct·오름차순으로 든다, .done owner·형식 아닌 owner는 안 든다, .wip 0이면 빈 목록", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = await listEpics(root, tickets);
  const p273 = epics.find((e) => e.epic === "P273")!;
  // a2(w1) · a5(w2)는 든다. a3(w9)는 .done이라 안 들고, a6("손으로 씀")은 workerOf 형식이 아니라 안 든다
  assert.deepStrictEqual(p273.workers, ["w1", "w2"]);
  const p10 = epics.find((e) => e.epic === "P10")!;
  assert.deepStrictEqual(p10.workers, []); // .wip 0건
  const noEpic = epics.find((e) => e.epic === NO_EPIC)!;
  assert.deepStrictEqual(noEpic.workers, []); // .wip 0건 — 특례 없이 같은 규칙(§에픽 결정 9)
});

test("에픽 제목 — README.md 첫 줄, 없으면 null(P번호만)", async () => {
  assert.strictEqual(await epicTitle(root, "P273"), "P273 제목");
  assert.strictEqual(await epicTitle(root, "P10"), null); // 디렉터리 자체가 없다
});

test("에픽 메모리 — 한 단계 글롭, 하위 디렉터리 안 읽는다", async () => {
  const mem = await epicMemory(root, "P273");
  assert.deepStrictEqual(
    mem.map((m) => m.file),
    ["x.md", "y.md"],
  );
  assert.strictEqual(mem.find((m) => m.file === "x.md")!.text, "x 내용\n");
});

test("README 본문 — 첫 줄(제목) 뒤부터, 없으면 null", async () => {
  assert.strictEqual(await epicReadmeBody(root, "P273"), "본문");
  assert.strictEqual(await epicReadmeBody(root, "P10"), null);
});

test("에픽 메모리 — 발췌는 첫 줄, 선두 `# `를 뗀다(페르소나 메모리와 같은 규칙)", async () => {
  const mem = await epicMemory(root, "P273");
  assert.strictEqual(mem.find((m) => m.file === "x.md")!.excerpt, "x 내용");
});

test("에픽 메모리 삭제 — 목록에 있는 파일만 지운다, 없는 이름은 던진다", async () => {
  const memDir = path.join(root, "epics", "P273", "memory");
  writeFileSync(path.join(memDir, "del.md"), "# 지울 것\n본문\n");
  const before = await epicMemory(root, "P273");
  assert.strictEqual(before.find((m) => m.file === "del.md")?.excerpt, "지울 것");

  await deleteEpicMemory(root, "P273", "del.md");
  const after = await epicMemory(root, "P273");
  assert.ok(!after.some((m) => m.file === "del.md"));

  await assert.rejects(() => deleteEpicMemory(root, "P273", "없는파일.md"));
});

test("에픽 메모리 — 디렉터리 없으면 빈 목록(경고 없음)", async () => {
  assert.deepStrictEqual(await epicMemory(root, "P10"), []);
  assert.deepStrictEqual(await epicMemory(root, "없는에픽"), []);
});

test("경로 방어 — epic 값의 ../ 가 큐 밖으로 못 나간다", async () => {
  assert.strictEqual(await epicTitle(root, "../../../etc"), null);
  assert.deepStrictEqual(await epicMemory(root, "../../../etc"), []);
});

test("에픽 만들기 — README.md 한 장, 첫 줄이 제목, memory/는 안 만든다", async () => {
  const r = await createEpic(root, "P999", "사이드바 실험");
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(readFileSync(path.join(root, "epics", "P999", "README.md"), "utf8"), "사이드바 실험\n");
  assert.throws(() => readFileSync(path.join(root, "epics", "P999", "memory"), "utf8"));
});

test("에픽 만들기 — 이미 있는 키는 거절하고 한 바이트도 안 덮는다", async () => {
  const before = readFileSync(path.join(root, "epics", "P273", "README.md"), "utf8");
  const r = await createEpic(root, "P273", "덮어써지면 안 된다");
  assert.strictEqual(r.ok, false);
  if (!r.ok) assert.strictEqual(r.reason, "exists");
  assert.strictEqual(readFileSync(path.join(root, "epics", "P273", "README.md"), "utf8"), before);
});

test("에픽 만들기 — 빈 키·줄바꿈·큐 밖 경로를 막는다", async () => {
  const empty = await createEpic(root, "  ", "제목");
  assert.strictEqual(empty.ok, false);
  if (!empty.ok) assert.strictEqual(empty.reason, "empty");

  const newline = await createEpic(root, "P9\n9", "제목");
  assert.strictEqual(newline.ok, false);
  if (!newline.ok) assert.strictEqual(newline.reason, "invalid");

  const escape = await createEpic(root, "../../../etc", "제목");
  assert.strictEqual(escape.ok, false);
  if (!escape.ok) assert.strictEqual(escape.reason, "invalid");
});

test("에픽 만들기 — 빈 제목·공백만 있는 제목을 막고, 디렉터리도 안 생긴다(결정 19-1)", async () => {
  const empty = await createEpic(root, "P998", "");
  assert.strictEqual(empty.ok, false);
  if (!empty.ok) assert.strictEqual(empty.reason, "empty");
  assert.strictEqual(existsSync(path.join(root, "epics", "P998")), false);

  const blank = await createEpic(root, "P998", "   ");
  assert.strictEqual(blank.ok, false);
  if (!blank.ok) assert.strictEqual(blank.reason, "empty");
  assert.strictEqual(existsSync(path.join(root, "epics", "P998")), false);
});

test("README 저장 — 있는 파일을 덮어쓴다, 왕복하면 같은 제목·내용이 나온다", async () => {
  const r = await saveEpicReadme(root, "P273", "새 제목", "새 본문\n두 번째 줄");
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(await epicTitle(root, "P273"), "새 제목");
  assert.strictEqual(await epicReadmeBody(root, "P273"), "새 본문\n두 번째 줄");
});

test("README 저장 — 디렉터리·파일이 없는 키에서도 저장되고 memory/는 안 생긴다(P300 갈래)", async () => {
  const r = await saveEpicReadme(root, "P300", "P300 제목", "P300 본문");
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(await epicTitle(root, "P300"), "P300 제목");
  assert.strictEqual(await epicReadmeBody(root, "P300"), "P300 본문");
  assert.strictEqual(existsSync(path.join(root, "epics", "P300", "memory")), false);
});

test("README 저장 — 빈 제목·빈 내용을 막는다, 있는 파일은 안 바뀐다", async () => {
  const before = readFileSync(path.join(root, "epics", "P273", "README.md"), "utf8");

  const emptyTitle = await saveEpicReadme(root, "P273", "", "본문");
  assert.strictEqual(emptyTitle.ok, false);
  if (!emptyTitle.ok) assert.strictEqual(emptyTitle.reason, "empty");

  const emptyBody = await saveEpicReadme(root, "P273", "제목", "   ");
  assert.strictEqual(emptyBody.ok, false);
  if (!emptyBody.ok) assert.strictEqual(emptyBody.reason, "empty");

  assert.strictEqual(readFileSync(path.join(root, "epics", "P273", "README.md"), "utf8"), before);
});

test("키 제안 — P<숫자> 꼴의 최댓값 + 1, P273-2처럼 접미가 붙은 값은 안 센다", () => {
  const mk = (epic: string) => ({ epic, counts: { open: 0, wip: 0, done: 0 }, workers: [] });
  assert.strictEqual(suggestEpicKey([mk("P10"), mk("P273"), mk("P273-2"), mk(NO_EPIC)]), "P274");
  assert.strictEqual(suggestEpicKey([mk(NO_EPIC)]), ""); // P<숫자> 꼴이 하나도 없다
  assert.strictEqual(suggestEpicKey([]), "");
});

// `resolveMarkdownRefs`는 자기 전용 큐를 쓴다 — 위 `root`는 뒤따르는 "README 저장" 테스트들이
// P273의 제목·건수를 계속 바꿔서, 공유하면 실행 순서에 값이 갈린다.
const refsRoot = mkdtempSync(path.join(tmpdir(), "fse-refs-"));
process.on("exit", () => rmSync(refsRoot, { recursive: true, force: true }));
mkdirSync(path.join(refsRoot, "tickets"));
writeFileSync(
  path.join(refsRoot, "tickets", "d1234567.md"),
  `${fm({ ticket: "d1234567", title: "본문 티켓", epic: "P501" })}## Goal\n\n첫 산문 줄.\n`,
);
writeFileSync(
  path.join(refsRoot, "tickets", "e2345678.wip.md"),
  fm({ ticket: "e2345678", title: "진행 티켓", persona: "developer" }),
);
mkdirSync(path.join(refsRoot, "epics", "P501"), { recursive: true });
writeFileSync(path.join(refsRoot, "epics", "P501", "README.md"), "P501 제목\n\n본문\n");

test("resolveMarkdownRefs — 글에 나온 stem·P번호만 채운다, 티켓 값은 새 파일 읽기 0", async () => {
  const tickets = await listTickets(refsRoot, DEFAULT);
  const epics = await listEpics(refsRoot, tickets);
  const idx = await resolveMarkdownRefs(refsRoot, "proj", ["본문에 d1234567과 P501을 인용한다"], tickets, epics);
  assert.deepStrictEqual(Object.keys(idx.tickets), ["d1234567"]);
  assert.deepStrictEqual(Object.keys(idx.epics), ["P501"]);
  const t = idx.tickets.d1234567;
  assert.strictEqual(t.title, "본문 티켓");
  assert.strictEqual(t.state, "open");
  assert.strictEqual(t.status, "open");
  assert.strictEqual(t.bodyPreview, "첫 산문 줄.");
  assert.strictEqual(t.href, "/p/proj/tickets/d1234567");
  const e = idx.epics.P501;
  assert.strictEqual(e.title, "P501 제목");
  assert.strictEqual(e.body, "본문");
  assert.deepStrictEqual(e.counts, epics.find((x) => x.epic === "P501")!.counts);
});

test("resolveMarkdownRefs — 글에 없는 stem·P번호는 값이 안 든다", async () => {
  const tickets = await listTickets(refsRoot, DEFAULT);
  const epics = await listEpics(refsRoot, tickets);
  const idx = await resolveMarkdownRefs(refsRoot, "proj", ["아무 참조도 없는 글"], tickets, epics);
  assert.deepStrictEqual(idx.tickets, {});
  assert.deepStrictEqual(idx.epics, {});
});

test("resolveMarkdownRefs — 진행중 티켓은 state가 wip다", async () => {
  const tickets = await listTickets(refsRoot, DEFAULT);
  const epics = await listEpics(refsRoot, tickets);
  const idx = await resolveMarkdownRefs(refsRoot, "proj", ["e2345678 진행 중"], tickets, epics);
  assert.strictEqual(idx.tickets.e2345678.state, "wip");
  assert.strictEqual(idx.tickets.e2345678.assignee.name, "developer");
});

test("refreshKnownRefs — 이미 아는 stem의 값이 큐가 갈린 회차에 다시 읽힌다(요구 de0b759d)", async () => {
  // `e2345678`은 위 refsRoot에서 `.wip`(진행중)로 만든 티켓 — 그 값을 한 번 읽어 두고("이미
  // 그려진 표식"), 파일을 `.done`으로 rename한 뒤("큐가 갈린 회차") 같은 stem을 다시 물으면
  // 값이 wip에 안 굳고 done으로 따라가야 한다. 안 그러면 이 테스트가 실패해 회귀를 잡는다.
  const before = await listTickets(refsRoot, DEFAULT);
  const seen = await resolveMarkdownRefs(refsRoot, "proj", ["e2345678 여기"], before, []);
  assert.strictEqual(seen.tickets.e2345678.state, "wip");

  renameSync(
    path.join(refsRoot, "tickets", "e2345678.wip.md"),
    path.join(refsRoot, "tickets", "e2345678.done.md"),
  );
  try {
    const after = await listTickets(refsRoot, DEFAULT);
    const revived = await refreshKnownRefs(refsRoot, "proj", after, [], Object.keys(seen.tickets), []);
    assert.strictEqual(revived.tickets.e2345678.state, "done");
    assert.strictEqual(revived.tickets.e2345678.status, "done");
  } finally {
    renameSync(
      path.join(refsRoot, "tickets", "e2345678.done.md"),
      path.join(refsRoot, "tickets", "e2345678.wip.md"),
    );
  }
});

test("앱은 DESIGN.md를 안 판다(§검증 (4))", () => {
  let out = "";
  try {
    out = execFileSync(
      "grep",
      ["-rn", "DESIGN.md", path.join(import.meta.dirname, "epics.ts")],
      { encoding: "utf8" },
    );
  } catch (e) {
    // grep은 매치가 없으면 exit 1로 던진다 — 여기서는 그게 통과 조건이다
    out = (e as { stdout?: string }).stdout ?? "";
  }
  assert.strictEqual(out, "");
});
