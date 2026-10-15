import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeStall, type StallKey, type StallTicket } from "./dispatch-stall.ts";

const NOW = 1_000_000;
const open: StallTicket = { hash: "aaaaaaaa", unmet: [], awaiting: false, polling: false };
const w = (name: string, ...lines: [number, string][]) => ({
  name,
  idle: true,
  lines: lines.map(([ago, text]) => ({ at: NOW - ago, text })),
});
const run = (workers: ReturnType<typeof w>[], tickets = [open], watchdog: { at: number; code: string; text: string }[] = []) =>
  judgeStall({ workers, watchdog, tickets, now: NOW });

const fixtures: [StallKey, string][] = [
  ["auth", "SKIP AUTH 대기 claude"],
  ["cooldown", "SKIP 엔진 쿨다운 · 120초 남음"],
  ["machineCap", "상한 - 머신 전체 산 세션 3/3, 이번 tick을 건너뜀"],
  ["personaCap", "SKIP 페르소나 상한 developer 2/2"],
  ["priority", "SKIP 우선순위 1 0b805420 - 진행중 1건"],
  ["shellCap", "셸 상한 - 이 워커의 셸이 12벌(상한 8)"],
  ["unknown", "처음 보는 줄"],
];
for (const [key, line] of fixtures) {
  test(`키 ${key}`, () => {
    const s = run([w("w1", [10, line])]);
    assert.equal(s?.reason, key);
    assert.equal(s?.perWorker[0].raw, line);
  });
}

test("키 watchdog", () => {
  const s = run([w("w1", [10, "처음 보는 줄"])], [open], [{ at: NOW - 5, code: "X1", text: "토큰이 만료됐습니다" }]);
  assert.equal(s?.reason, "watchdog");
  assert.equal(s?.params.text, "토큰이 만료됐습니다");
});

test("키 noCandidate", () => {
  const s = run([w("w1")], [
    { hash: "a", unmet: ["b"], awaiting: false, polling: false },
    { hash: "c", unmet: [], awaiting: true, polling: false },
  ]);
  assert.equal(s?.reason, "noCandidate");
  assert.deepEqual(s?.params, { d: 1, w: 1, p: 0 });
});

test("키 notWaking - 91초 전 줄만", () => {
  assert.equal(run([w("w1", [91, "상한 - 머신 전체 산 세션 3/3"])])?.reason, "notWaking");
});

test("열린 티켓 0장 - null", () => assert.equal(run([w("w1", [1, "SKIP AUTH 대기 claude"])], []), null));
test("idle 워커 0개 - null", () => {
  assert.equal(run([]), null);
  assert.equal(run([w("w1", [1, "SKIP 이 워커가 아직 티켓을 물고 있다"])]), null);
});

test("순서 - machineCap과 cooldown이 섞이면 cooldown", () => {
  const s = run([w("w1", [5, "상한 - 머신 전체 산 세션 3/3"]), w("w2", [5, "SKIP 엔진 쿨다운 · 30초 남음"])]);
  assert.equal(s?.reason, "cooldown");
  assert.deepEqual(s?.perWorker.map((p) => [p.name, p.reason]), [["w1", "machineCap"], ["w2", "cooldown"]]);
});

test("일시 현상 줄은 건너뛰고 그 앞 줄을 본다", () => {
  const s = run([w("w1", [1, "SKIP ps 조회 실패"], [31, "상한 - 머신 전체 산 세션 3/3"])]);
  assert.equal(s?.reason, "machineCap");
  assert.deepEqual(s?.params, { a: 3, b: 3 });
});
