import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Suffixes } from "./queue.ts";
import { listTickets } from "./queue.ts";
import {
  NO_EPIC,
  deleteEpicMemory,
  epicMemory,
  epicReadmeBody,
  epicTitle,
  listEpics,
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

test("에픽 목록 — epic: 값 집합(distinct), 접두사 정규화 안 한다", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = listEpics(tickets);
  assert.deepStrictEqual(
    epics.map((e) => e.epic),
    ["P10", "P273", "P273-2", NO_EPIC], // 문자열 정렬, (에픽 없음) 맨 뒤
  );
});

test("에픽 건수 — 상태 3종은 queue.ts의 기존 판정 그대로다", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = listEpics(tickets);
  const p273 = epics.find((e) => e.epic === "P273")!;
  // wip 3 = a2·a5·a6 (§워커 집합 픽스처 — a6은 owner: 형식이 아니라 건수엔 들되 워커는 안 든다)
  assert.deepStrictEqual(p273.counts, { open: 1, wip: 3, done: 1 });
  const noEpic = epics.find((e) => e.epic === NO_EPIC)!;
  assert.deepStrictEqual(noEpic.counts, { open: 1, wip: 0, done: 1 });
});

test("에픽 워커 집합 — 같은 에픽 .wip 워커 둘이 distinct·오름차순으로 든다, .done owner·형식 아닌 owner는 안 든다, .wip 0이면 빈 목록", async () => {
  const tickets = await listTickets(root, DEFAULT);
  const epics = listEpics(tickets);
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
