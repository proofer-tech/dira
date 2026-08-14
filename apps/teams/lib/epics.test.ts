import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Suffixes } from "./queue.ts";
import { listTickets } from "./queue.ts";
import { NO_EPIC, epicMemory, epicTitle, listEpics } from "./epics.ts";

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
write("a2.wip.md", fm({ ticket: "a2", title: "A2", epic: "P273", session_id: "s" }));
write("a3.done.md", fm({ ticket: "a3", title: "A3", epic: "P273" }));
write("a4.md", fm({ ticket: "a4", title: "A4", epic: "P273-2" }));
// P10 — 디렉터리 없음(제목·메모리 없음이 정상인지 보는 픽스처)
write("b1.md", fm({ ticket: "b1", title: "B1", epic: "P10" }));
// epic: 없음 -> (에픽 없음)
write("c1.md", fm({ ticket: "c1", title: "C1" }));
write("c2.done.md", fm({ ticket: "c2", title: "C2" }));

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
  assert.deepStrictEqual(p273.counts, { open: 1, wip: 1, done: 1 });
  const noEpic = epics.find((e) => e.epic === NO_EPIC)!;
  assert.deepStrictEqual(noEpic.counts, { open: 1, wip: 0, done: 1 });
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
