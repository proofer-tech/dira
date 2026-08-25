/** §0-14 — 머신 상태: 잠자기 · 꺼짐 · 오프라인. 서버 모듈 스코프(선례: `home-agent.ts`의
 *  `runs` 맵)에서 15초 하트비트를 돌려 `{ offline, resume }`를 낸다. 화면 배선(종 항목 ⑤·⑥,
 *  시각 문자열 포맷)은 별도 티켓(`1087db4d`)이 한다 — 여기가 내는 `from`·`to`는 epoch ms다. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runSchedules } from "./home-agent.ts";
import { localDir } from "./paths.ts";
import { webhookTick } from "./webhook.ts";
import { readAlerts, writeAlerts } from "./workers.ts";

const execFileP = promisify(execFile);

export type ResumeKind = "slept" | "poweredOff";
export type ResumeEvent = { from: number; to: number; kind: ResumeKind };
export type MachineState = { offline: boolean; resume: ResumeEvent | null };

export const HEARTBEAT_MS = 15_000;
export const GAP_THRESHOLD_MS = 60_000;
export const FRESHNESS_MS = 10 * 60_000;
export const MERGE_WINDOW_MS = 10 * 60_000;

// ---- 순수 함수 — 시간·입력을 주입받는다. 하트비트 타이머 없이 검증 가능하다 ----

/** 판정 1 — `scutil -r` 출력에 `Reachable`이 없으면 미스. 온라인에서는 무엇을 물어도 낙관적으로
 *  `Reachable`이 나오므로(실측 §0-14 — 존재하지 않는 호스트도 `Reachable,Transient Connection`)
 *  이 판정이 잡는 건 인터페이스가 죽은 것뿐이다(라우터 너머는 §0-5가 세션 실패로 받는다). */
export function isReachable(scutilOutput: string): boolean {
  return scutilOutput.includes("Reachable");
}

export type OfflineTally = { offline: boolean; misses: number };
export const INITIAL_OFFLINE: OfflineTally = { offline: false, misses: 0 };

/** 연속 2회 미스에 켜고 1회 히트에 끈다 — 복귀 직후 Wi-Fi 재접속 창(수 초)에 종이 깜빡이는 것을
 *  막는다(§0-5 판정 1이 `DISPATCH`를 결과로 안 세는 것과 같은 근거). */
export function nextOffline(prev: OfflineTally, reachable: boolean): OfflineTally {
  if (reachable) return { offline: false, misses: 0 };
  const misses = prev.misses + 1;
  return { offline: prev.offline || misses >= 2, misses };
}

/** §0-14 §개정(2026-08-26) — 하트비트 표식. 소유자 판정과 기동 시 공백 판정이 함께 읽는다.
 *  `owner`가 `null`인 것은 옛 형식(시각 하나)이었던 파일 — 표식 없음과 같은 갈래로 다룬다. */
export type HeartbeatMark = { owner: string | null; at: number };

/** 하트비트 표식 파싱 — 새 형식은 `{owner, at}` JSON, 옛 형식은 시각 하나(숫자 문자열)뿐이다.
 *  §개정 §수용조건 4 — 형식이 갈려도 기동 시 `poweredOff` 판정이 옛 파일을 그대로 읽는다. */
export function parseHeartbeatMark(raw: string): HeartbeatMark | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{")) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? { owner: null, at: n } : null;
  }
  try {
    const obj = JSON.parse(trimmed);
    return typeof obj.at === "number" && Number.isFinite(obj.at)
      ? { owner: typeof obj.owner === "string" ? obj.owner : null, at: obj.at }
      : null;
  } catch {
    return null;
  }
}

/** §개정 §결정 — 소유자 판정. 표식이 없거나 내 것이면 소유자다. 남의 것이면 공백 문턱(60초)
 *  보다 오래된 경우에만 이어받는다 — 신선하면 그 박에서 머신 스코프 셋을 건너뛴다. */
export function isOwner(mark: HeartbeatMark | null, myId: string, nowMs: number): boolean {
  if (!mark || mark.owner === myId) return true;
  return nowMs - mark.at > GAP_THRESHOLD_MS;
}

/** 판정 2 — 도는 중 공백. 하트비트 간격 > 60초면 프로세스가 얼어 있었다(잠자기) — 박을 이었다는
 *  것 자체가 프로세스가 살아 있었다는 증거라 꺼짐일 수 없다. */
export function sleepGap(prevHeartbeatMs: number, nowMs: number): ResumeEvent | null {
  return nowMs - prevHeartbeatMs > GAP_THRESHOLD_MS
    ? { from: prevHeartbeatMs, to: nowMs, kind: "slept" }
    : null;
}

/** 판정 2 — 기동 시 공백. heartbeat 파일 시각(F)보다 `kern.boottime`이 늦으면 그 사이 머신이
 *  꺼져 있었다. boottime ≤ F면 앱만 꺼졌던 것이라 이벤트가 없다. 파일이 없으면(첫 기동) 없다. */
export function powerOffGap(
  heartbeatAtMs: number | null,
  boottimeMs: number,
  nowMs: number,
): ResumeEvent | null {
  if (heartbeatAtMs === null) return null;
  return boottimeMs > heartbeatAtMs
    ? { from: heartbeatAtMs, to: nowMs, kind: "poweredOff" }
    : null;
}

/** 병합 — 새 이벤트의 `from`이 기존 이벤트의 `to`에서 10분 안이면 하나로 합친다(`from`·`kind`는
 *  기존 값 유지, `to`만 늘어난다). 근거는 실측 `pmset -g log` — 이 맥은 밤새 2~4분 잠자기 ↔
 *  45초 DarkWake를 반복해 병합이 없으면 하룻밤이 수십 조각으로 갈린다. */
export function mergeResume(existing: ResumeEvent | null, incoming: ResumeEvent): ResumeEvent {
  if (existing && incoming.from - existing.to <= MERGE_WINDOW_MS) {
    return { from: existing.from, to: incoming.to, kind: existing.kind };
  }
  return incoming;
}

/** 신선도 — `to`에서 10분 지나면 항목이 죽는다(§0-5 신선도와 같은 값 재사용). */
export function isFresh(event: ResumeEvent, nowMs: number): boolean {
  return nowMs - event.to <= FRESHNESS_MS;
}

/** 읽음 필터 — 화면이 본 `to`와 지금 판정의 `to`가 같으면 지운다. 병합으로 `to`가 자라면
 *  달라지므로 다시 뜬다(§0-14 §읽음 처리 — 새 사실은 다시 봐야 한다). 단위는 이벤트 하나라
 *  값 하나(`readTo`)면 충분하다 — 나열이 아니다. */
export function filterRead(resume: ResumeEvent | null, readTo: number | null): ResumeEvent | null {
  return resume && resume.to === readTo ? null : resume;
}

/** ⑥ 사건 하나를 편지함에 적는다(§0-10 §받은 편지함 §쓰는 자리) — 하트비트가 새 공백을 볼
 *  때마다. 키는 `to`라 병합으로 `to`가 자라면 새 줄이다(§0-14 §읽음 처리가 정한 그 단위
 *  그대로 — *멈춤이 더 길어졌다*는 새 사실이다). */
export async function recordResumeEvent(event: ResumeEvent): Promise<void> {
  const alerts = await readAlerts();
  const machine = {
    ...alerts.machine,
    [String(event.to)]: { from: event.from, kind: event.kind, archived: null },
  };
  await writeAlerts({ ...alerts, machine });
}

// ---- 모듈 스코프 — 여기부터 side effect(파일 I/O · 서브프로세스 · 타이머) ----

// §개정 — 이 프로세스의 소유권 표식 정체성. 서버가 죽고 뜰 때마다 새로 발급되므로,
// 재기동한 프로세스는 자기가 죽기 전에 쓴 옛 표식도 "남의 것"으로 본다(그게 맞다 — 죽은
// 동안 다른 서버가 이어받았을 수 있다).
const MY_ID = randomUUID();

function heartbeatPath(): string {
  return path.join(localDir(), "heartbeat");
}

async function readHeartbeatMark(): Promise<HeartbeatMark | null> {
  try {
    return parseHeartbeatMark(await readFile(heartbeatPath(), "utf8"));
  } catch {
    return null;
  }
}

// §개정 §결정 — 원자적 쓰기가 이제 필요하다. 읽는 자가 자기 자신뿐이 아니게 됐다(서버 둘이
// 같은 파일을 본다). tmp + rename은 `writeHome`(home-agent.ts)과 같은 선례다.
async function writeHeartbeatMark(nowMs: number): Promise<void> {
  const file = heartbeatPath();
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ owner: MY_ID, at: nowMs }), "utf8");
  await rename(tmp, file);
}

async function scutilReachable(): Promise<boolean> {
  try {
    const { stdout } = await execFileP("scutil", ["-r", "api.anthropic.com"], { timeout: 5_000 });
    return isReachable(stdout);
  } catch {
    return false; // 스폰 자체가 실패해도 "닿았다"고 볼 근거가 없다
  }
}

async function boottimeMs(): Promise<number | null> {
  try {
    const { stdout } = await execFileP("sysctl", ["kern.boottime"], { timeout: 5_000 });
    const m = /sec\s*=\s*(\d+)/.exec(stdout);
    return m ? Number(m[1]) * 1000 : null;
  } catch {
    return null;
  }
}

type LiveState = {
  offline: OfflineTally;
  resume: ResumeEvent | null;
  lastHeartbeatAt: number;
  readTo: number | null;
};
type Globals = { __diraMachineState?: LiveState; __diraMachineTimer?: NodeJS.Timeout };
const g = globalThis as unknown as Globals;

async function tickOnce(): Promise<void> {
  const s = g.__diraMachineState;
  if (!s) return;
  const now = Date.now();
  const gapEvent = sleepGap(s.lastHeartbeatAt, now);
  if (gapEvent) {
    s.resume = mergeResume(s.resume, gapEvent);
    await recordResumeEvent(s.resume);
  }
  s.lastHeartbeatAt = now;
  s.offline = nextOffline(s.offline, await scutilReachable());
  // §개정 §결정 — 박마다 소유자 판정 한 번. 남의 것이 신선하면 머신 스코프 셋(heartbeat 쓰기 -
  // runSchedules - webhookTick)을 건너뛴다. offline·resume은 위에서 이미 끝났다(프로세스 스코프,
  // 안 갈린다).
  if (isOwner(await readHeartbeatMark(), MY_ID, now)) {
    await writeHeartbeatMark(now);
    // §7-2 §깨우는 자리 — 새 타이머를 안 만든다. 판정은 `runSchedules`(순수 함수 `judgeSchedule` 위의
    // 그 절반)가 지고, 여기는 그 함수에 <지금>을 넣고 부르는 것뿐이다.
    await runSchedules(now);
    // §0-10 §답변 대기가 앱 밖으로 나간다 — 같은 이유로 새 타이머 0. 주소가 없으면 `webhookTick`이
    // 그 자리에서 돌아온다(큐를 안 훑는다).
    await webhookTick(now);
  }
}

async function initState(): Promise<LiveState> {
  const now = Date.now();
  const [heartbeatMark, boottime] = await Promise.all([readHeartbeatMark(), boottimeMs()]);
  const resume = boottime !== null ? powerOffGap(heartbeatMark?.at ?? null, boottime, now) : null;
  await writeHeartbeatMark(now);
  return { offline: INITIAL_OFFLINE, resume, lastHeartbeatAt: now, readTo: null };
}

/** 핫리로드 가드 — `globalThis`에 이미 타이머가 있으면 새로 안 만든다(Next dev가 이 모듈을
 *  재평가해도 인터벌이 배로 늘지 않는다). `deps.tick`은 테스트 주입용. */
export function startHeartbeat(deps: { tick: () => void } = { tick: () => void tickOnce() }): boolean {
  if (g.__diraMachineTimer) return false;
  g.__diraMachineTimer = setInterval(deps.tick, HEARTBEAT_MS);
  g.__diraMachineTimer.unref();
  return true;
}

let starting: Promise<void> | null = null;
function ensureStarted(): void {
  if (g.__diraMachineState) {
    startHeartbeat();
    return;
  }
  // ponytail: 초기화가 끝나기 전 machineState() 호출은 기본값(정상)을 낸다. 실측상 초기화는
  //           scutil 8ms + sysctl 8ms 남짓이라 그 창은 서버 기동 순간뿐이다.
  if (!starting) {
    // 이 initState()가 도는 동안 누가 g.__diraMachineState를 먼저 채웠으면(테스트 주입 등)
    // 그 값을 지키지 덮어쓰지 않는다 — resolve 시점은 subprocess 타이밍이라 불확정이다.
    starting = initState().then((s) => {
      if (!g.__diraMachineState) g.__diraMachineState = s;
      startHeartbeat();
    });
  }
}

/** §0-14 상태 모델. `readSummary`가 매 폴링(5초)마다 부르지만 새 I/O는 0이다 — 이미 하트비트가
 *  채워 둔 모듈 스코프 값을 읽기만 한다. */
export function machineState(nowMs: number = Date.now()): MachineState {
  ensureStarted();
  const s = g.__diraMachineState;
  if (!s) return { offline: false, resume: null };
  const fresh = s.resume && isFresh(s.resume, nowMs) ? s.resume : null;
  return { offline: s.offline.offline, resume: filterRead(fresh, s.readTo) };
}

/** Server Action이 부르는 쓰기 — 화면이 그 순간 나열한 사건 전부의 `to`를 한 번에 보관한다
 *  (§0-10 §보관 = 읽음이다 — 개정 `4ea7e8d9`로 단위가 이벤트 하나에서 목록이 됐다. 키는 안
 *  갈린다). 모듈 메모리의 `readTo`는 그 목록의 최댓값 — 지금 이 서버가 그 값을 즉시 반영하는
 *  자리로 남고, 편지함의 `archived`가 재시작을 넘겨 있는 자리다(§0-10 §저장). 목록에 없는 `to`나
 *  편지함에 그 사건이 없으면(상한에 밀렸거나 아직 하트비트가 못 적었으면) 조용히 넘어간다. */
export async function markResumeRead(toMsList: number[]): Promise<void> {
  if (toMsList.length === 0) return;
  if (g.__diraMachineState) g.__diraMachineState.readTo = Math.max(...toMsList);
  const alerts = await readAlerts();
  const now = new Date().toISOString();
  const machine = { ...alerts.machine };
  for (const toMs of toMsList) {
    const key = String(toMs);
    if (machine[key]) machine[key] = { ...machine[key], archived: now };
  }
  await writeAlerts({ ...alerts, machine });
}
