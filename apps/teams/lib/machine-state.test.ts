import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FRESHNESS_MS,
  GAP_THRESHOLD_MS,
  INITIAL_OFFLINE,
  MERGE_WINDOW_MS,
  filterRead,
  isFresh,
  isOwner,
  isReachable,
  markResumeRead,
  mergeResume,
  nextOffline,
  parseHeartbeatMark,
  powerOffGap,
  recordResumeEvent,
  sleepGap,
  startHeartbeat,
  type ResumeEvent,
} from "./machine-state.ts";
import { alertsPath } from "./workers.ts";

// 진짜 `~/.config/dira/alerts.json`을 밟지 않는다(§0-10 §저장) — `recordResumeEvent`·
// `markResumeRead`가 파일 I/O를 하므로 이 테스트만의 디렉터리로 가둔다.
process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "mst-local-"));

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

test("읽음 필터 — 읽은 to와 같으면 지워지고, 병합으로 to가 자라거나 빗나가면 그대로 남는다", () => {
  const ev: ResumeEvent = { from: 0, to: 100_000, kind: "slept" };
  assert.equal(filterRead(ev, ev.to), null); // 읽음 → resume null
  const grown: ResumeEvent = { ...ev, to: 200_000 };
  assert.deepEqual(filterRead(grown, ev.to), grown); // 병합으로 to가 자란 뒤 → 다시 나온다
  assert.deepEqual(filterRead(ev, 999), ev); // 빗나간 to(이미 자란 이벤트) → 무시되고 남는다
  assert.equal(filterRead(null, ev.to), null);
});

test("하트비트 표식 파싱 — 새 형식(JSON)과 옛 형식(시각 하나)을 둘 다 읽는다", () => {
  assert.deepEqual(parseHeartbeatMark('{"owner":"a","at":1000}'), { owner: "a", at: 1000 });
  assert.deepEqual(parseHeartbeatMark("1000"), { owner: null, at: 1000 }); // 옛 형식
  assert.equal(parseHeartbeatMark(""), null);
  assert.equal(parseHeartbeatMark("not json or a number"), null);
  assert.equal(parseHeartbeatMark("{}"), null); // at 없음
});

test("§개정 소유자 판정 — 표식 없음 / 내 것 / 남의 것이고 신선함 / 남의 것이고 오래됨", () => {
  const now = 1_000_000;
  assert.equal(isOwner(null, "me", now), true); // 표식 없음 — 내가 소유자
  assert.equal(isOwner({ owner: "me", at: now - 5_000 }, "me", now), true); // 내 것
  assert.equal(isOwner({ owner: "other", at: now - 5_000 }, "me", now), false); // 남의 것 — 신선함(60초 안)
  assert.equal(isOwner({ owner: "other", at: now - GAP_THRESHOLD_MS - 1 }, "me", now), true); // 남의 것 — 오래됨
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

// ── 받은 편지함 (§0-10 §받은 편지함) — ⑥의 저장이 파일로 내려온다 ────────────

test("recordResumeEvent — 병합으로 to가 자라면 편지함에 새 줄이 뜬다 (§0-10 §쓰는 자리)", async () => {
  rmSync(alertsPath(), { force: true });
  const first: ResumeEvent = { from: 0, to: 100_000, kind: "slept" };
  await recordResumeEvent(first);
  const grown: ResumeEvent = { from: 0, to: 200_000, kind: "slept" }; // mergeResume이 낼 모양
  await recordResumeEvent(grown);

  const written = JSON.parse(readFileSync(alertsPath(), "utf8"));
  assert.deepStrictEqual(written.machine["100000"], { from: 0, kind: "slept", archived: null });
  assert.deepStrictEqual(written.machine["200000"], { from: 0, kind: "slept", archived: null });
});

test("markResumeRead — 목록에 든 `to` 전부의 archived를 한 번에 적는다 (§0-10 §⑥이 한 항목으로 뜨고 한 번에 보관된다)", async () => {
  rmSync(alertsPath(), { force: true });
  const a: ResumeEvent = { from: 0, to: 300_000, kind: "poweredOff" };
  const b: ResumeEvent = { from: 300_000, to: 400_000, kind: "slept" };
  await recordResumeEvent(a);
  await recordResumeEvent(b);

  await markResumeRead([300_000, 400_000]);
  const written = JSON.parse(readFileSync(alertsPath(), "utf8"));
  assert.equal(typeof written.machine["300000"].archived, "string");
  assert.equal(typeof written.machine["400000"].archived, "string");

  // 목록에 없는 `to`(상한에 밀렸거나 아직 하트비트가 안 적은 사건)는 조용히 넘어간다.
  await assert.doesNotReject(markResumeRead([999_999]));
});

test("recordResumeEvent — 머신 전체 상한 200건, 넘치면 `to`가 이른 것부터 버린다 (§0-10 §무한히 쌓이는 것)", async () => {
  rmSync(alertsPath(), { force: true });
  for (let i = 0; i < 205; i++) await recordResumeEvent({ from: i, to: 1000 + i, kind: "slept" });

  const written = JSON.parse(readFileSync(alertsPath(), "utf8"));
  const keys = Object.keys(written.machine)
    .map(Number)
    .sort((a, b) => a - b);
  assert.strictEqual(keys.length, 200);
  assert.strictEqual(keys[0], 1005); // 가장 이른 5개(1000..1004)가 버려졌다
});
