import { test } from "node:test";
import assert from "node:assert";
import {
  FRESHNESS_MS,
  GAP_THRESHOLD_MS,
  INITIAL_OFFLINE,
  MERGE_WINDOW_MS,
  isFresh,
  isReachable,
  mergeResume,
  nextOffline,
  powerOffGap,
  sleepGap,
  startHeartbeat,
  type ResumeEvent,
} from "./machine-state.ts";

test("판정 1 파싱 — 온라인 실측 문자열은 Reachable, 오프라인은 그 낱말이 없다", () => {
  // 이 세션은 이 머신의 실제 scutil -r 출력을 그대로 썼다: `Reachable,Transient Connection`.
  assert.ok(isReachable("Reachable,Transient Connection"));
  assert.ok(isReachable("Reachable,Connection Required"));
  // 오프라인 출력의 실제 바이트는 이 세션이 못 쟀다(## 결과의 §측정 못함 사유) — 판정 규칙
  // 자체는 스펙이 이미 확정했다("Reachable 부재"), 그 규칙만 여기서 검증한다.
  assert.ok(!isReachable("Unreachable,Connection Required"));
  assert.ok(!isReachable(""));
});

test("판정 1 연속 2회 규칙 — 미스 1회는 안 켜지고 2회째 켜진다, 히트 1회면 바로 꺼진다", () => {
  let s = INITIAL_OFFLINE;
  s = nextOffline(s, false);
  assert.equal(s.offline, false); // 1회 미스 — 아직
  s = nextOffline(s, false);
  assert.equal(s.offline, true); // 2회째 — 켜진다
  s = nextOffline(s, true);
  assert.equal(s.offline, false); // 히트 1회 — 바로 꺼진다
});

test("판정 2 공백 — 도는 중 공백은 60초 문턱, 기동 시 공백은 boottime 비교", () => {
  const t0 = 1_000_000;
  assert.equal(sleepGap(t0, t0 + GAP_THRESHOLD_MS), null); // 문턱 이하는 아니다
  const slept = sleepGap(t0, t0 + GAP_THRESHOLD_MS + 1);
  assert.deepEqual(slept, { from: t0, to: t0 + GAP_THRESHOLD_MS + 1, kind: "slept" });

  // heartbeat 파일 시각(F) < boottime = 그 사이 꺼져 있었다
  const poweredOff = powerOffGap(t0, t0 + 1, t0 + 5_000);
  assert.deepEqual(poweredOff, { from: t0, to: t0 + 5_000, kind: "poweredOff" });
  // boottime이 F보다 이르면(앱만 꺼졌다 켜졌다) 이벤트 없음
  assert.equal(powerOffGap(t0, t0 - 1, t0 + 5_000), null);
  // 첫 기동(파일 없음)도 이벤트 없음
  assert.equal(powerOffGap(null, t0, t0 + 5_000), null);
});

test("병합 — 10분 안이면 하나로 합치고(from·kind 유지), 밖이면 새 이벤트 그대로", () => {
  const first: ResumeEvent = { from: 0, to: 100_000, kind: "slept" };
  const within: ResumeEvent = { from: 100_000 + MERGE_WINDOW_MS, to: 200_000, kind: "slept" };
  assert.deepEqual(mergeResume(first, within), { from: 0, to: 200_000, kind: "slept" });

  const outside: ResumeEvent = { from: 100_000 + MERGE_WINDOW_MS + 1, to: 200_000, kind: "slept" };
  assert.deepEqual(mergeResume(first, outside), outside);

  assert.deepEqual(mergeResume(null, first), first);
});

test("신선도 — to에서 10분 안이면 살아 있고 지나면 죽는다", () => {
  const ev: ResumeEvent = { from: 0, to: 1_000_000, kind: "poweredOff" };
  assert.ok(isFresh(ev, 1_000_000 + FRESHNESS_MS));
  assert.ok(!isFresh(ev, 1_000_000 + FRESHNESS_MS + 1));
});

test("핫리로드 가드 — 두 번째 startHeartbeat는 새 타이머를 안 만든다", () => {
  const g = globalThis as unknown as { __diraMachineTimer?: NodeJS.Timeout };
  delete g.__diraMachineTimer; // 이 테스트 파일 안에서 격리
  try {
    let calls = 0;
    const created1 = startHeartbeat({ tick: () => calls++ });
    const timerAfterFirst = g.__diraMachineTimer;
    const created2 = startHeartbeat({ tick: () => calls++ });
    assert.equal(created1, true);
    assert.equal(created2, false);
    assert.equal(g.__diraMachineTimer, timerAfterFirst); // 같은 타이머 — 안 늘었다
  } finally {
    if (g.__diraMachineTimer) clearInterval(g.__diraMachineTimer);
    delete g.__diraMachineTimer;
  }
});
