import { test } from "node:test";
import assert from "node:assert";
import {
  buildReport, countRunnerLog, DEFAULT_EXCLUDE, filterQuitTargets, judgeSelfish, parseSelfishConfig, projectLine,
} from "./selfish-mode.ts";

const L = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

test("since 이전 줄을 빼고 표식 다섯을 센다", () => {
  const log = [
    "2026-10-12 22:00:00 [w1] DISPATCH aaaaaaaa kind=work",
    "2026-10-12 23:30:00 [w1] DISPATCH bbbbbbbb kind=work",
    "2026-10-12 23:40:00 [w1] DONE bbbbbbbb sid=x",
    "2026-10-13 01:00:00 [w2] STALL cccccccc 엔진이 멎었다",
    "2026-10-13 01:05:00 [w3] 상한 - 머신 전체 산 세션 9/6, 이번 tick을 건너뜀",
    "2026-10-13 02:00:00 [reaper] REAP dddddddd attempts=4(한도라 예산 안 씀) - 사망",
    "2026-10-13 02:01:00 [reaper] REAP eeeeeeee attempts=1 - 사망",
    "2026-10-13 03:00:00 [w2] DISPATCH ffffffff kind=work",
    "깨진 줄",
  ].join("\n");
  const c = countRunnerLog(log, L(2026, 10, 12, 23));
  assert.deepEqual(c, { dispatch: 2, done: 1, stall: 1, cap_skip: 1, limit_reap: 1, last_dispatch: "2026-10-13 03:00:00" });
});

test("기본 제외 목록과 VPN 포함 이름이 빠진다", () => {
  const out = filterQuitTargets(["Finder", "Slack", "Foo VPN", "1Password 7", "Safari"], DEFAULT_EXCLUDE);
  assert.deepEqual(out, ["Slack", "Safari"]);
});

test("깨진 selfish.json은 기본값이다", () => {
  for (const t of ["{oops", "[]", "null", "", null]) {
    const c = parseSelfishConfig(t);
    assert.equal(c.schedule, null);
    assert.equal(c.cap, null);
    assert.equal(c.active, null);
    assert.deepEqual(c.exclude, DEFAULT_EXCLUDE);
  }
  const c = parseSelfishConfig(JSON.stringify({ cap: "x", exclude: [1], schedule: { start: "0 23 * * *" } }));
  assert.equal(c.cap, null);
  assert.deepEqual(c.exclude, DEFAULT_EXCLUDE);
  assert.equal(c.schedule, null);
});

test("0 7 * * * 끝 회차가 늦게 와도 한 번만 난다", () => {
  const cfg = parseSelfishConfig(JSON.stringify({
    schedule: { start: "0 23 * * *", end: "0 7 * * *" },
    active: { since: new Date(L(2026, 10, 12, 23)).toISOString(), until: null, saved_limit: null, cap: null, quit: [], left: [] },
    last_start_due: L(2026, 10, 12, 23),
  }));
  const created = L(2026, 10, 1, 0);
  const d1 = judgeSelfish(cfg, L(2026, 10, 13, 8, 30), created);
  assert.equal(d1.action, "end");
  assert.equal(d1.endDue, L(2026, 10, 13, 7));
  // 서버가 endDue를 저장하고 껐다 -> 다음 하트비트는 아무것도 안 한다
  const after = { ...cfg, active: null, last_end_due: d1.endDue };
  assert.equal(judgeSelfish(after, L(2026, 10, 13, 8, 30, 15), created).action, null);
});

test("start 회차에 이미 켜져 있으면 건너뛴다, 밤새 꺼졌다 켜진 앱은 지난 구간을 안 켠다", () => {
  const sched = { start: "0 23 * * *", end: "0 7 * * *" };
  const on = parseSelfishConfig(JSON.stringify({
    schedule: sched, active: { since: new Date(0).toISOString() }, last_start_due: L(2026, 10, 11, 23),
  }));
  assert.equal(judgeSelfish(on, L(2026, 10, 12, 23, 1), L(2026, 10, 1, 0)).action, null);
  const off = parseSelfishConfig(JSON.stringify({
    schedule: sched, last_start_due: L(2026, 10, 12, 7), last_end_due: L(2026, 10, 12, 7),
  }));
  // 23:00 start와 07:00 end가 함께 늦게 왔고 end가 더 늦다 -> 아무것도 안 함
  assert.equal(judgeSelfish(off, L(2026, 10, 13, 8), L(2026, 10, 1, 0)).action, null);
});

test("보고가 프로젝트마다 한 줄이다", () => {
  const active = { since: new Date(L(2026, 10, 13, 0)).toISOString(), until: null, saved_limit: null, cap: 3, quit: ["Slack"], left: [] };
  const r = buildReport(active, "2026-10-13T07:00:00Z", [
    { project: "dira", text: "2026-10-13 01:00:00 [w1] DISPATCH a\n2026-10-13 01:10:00 [w1] STALL a x" },
  ]);
  assert.equal(r.per_project[0]!.dispatch, 1);
  assert.equal(projectLine(r.per_project[0]!), "dira: 디스패치 1, 완료 0, STALL 1 (100%), 상한 건너뜀 0, 한도 사망 0, 마지막 디스패치 2026-10-13 01:00:00");
});
