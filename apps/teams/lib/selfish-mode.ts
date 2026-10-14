// P487-1 이기적 모드 순수 함수. `osascript`-파일 쓰기는 서버 라우트 몫이라 여기엔 없다.
import { judgeSchedule } from "./urls.ts";

export type SelfishActive = {
  since: string;
  until: string | null;
  saved_limit: string | null;
  cap: number | null;
  quit: string[];
  left: string[];
};

export type SelfishConfig = {
  schedule: { start: string; end: string } | null;
  cap: number | null;
  exclude: string[];
  active: SelfishActive | null;
  last_start_due: number | null;
  last_end_due: number | null;
};

export const DEFAULT_SCHEDULE = { start: "0 23 * * *", end: "0 7 * * *" };
export const DEFAULT_EXCLUDE = [
  "dira",
  "Finder",
  "Terminal",
  "iTerm2",
  "Google Drive",
  "Amphetamine",
  "1Password",
  "1Password 7",
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function parseActive(v: unknown): SelfishActive | null {
  if (!isObj(v) || typeof v.since !== "string" || Number.isNaN(Date.parse(v.since))) return null;
  return {
    since: v.since,
    until: typeof v.until === "string" ? v.until : null,
    saved_limit: typeof v.saved_limit === "string" ? v.saved_limit : null,
    cap: intOrNull(v.cap),
    quit: strList(v.quit) ?? [],
    left: strList(v.left) ?? [],
  };
}

/** `selfish.json` 내용 검증. 못 읽는 값은 필드마다 기본값이다(`cap`은 `null` = 상한을 안 건드린다). */
export function parseSelfishConfig(text: string | null | undefined): SelfishConfig {
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const o = isObj(raw) ? raw : {};
  const s = o.schedule;
  const schedule =
    isObj(s) && typeof s.start === "string" && typeof s.end === "string" ? { start: s.start, end: s.end } : null;
  return {
    schedule,
    cap: intOrNull(o.cap),
    exclude: strList(o.exclude) ?? [...DEFAULT_EXCLUDE],
    active: parseActive(o.active),
    last_start_due: typeof o.last_start_due === "number" ? o.last_start_due : null,
    last_end_due: typeof o.last_end_due === "number" ? o.last_end_due : null,
  };
}

/** 종료 대상: 실행 중 앱 이름에서 제외 목록과 `VPN` 포함 이름을 뺀다. */
export function filterQuitTargets(running: string[], exclude: string[]): string[] {
  const skip = new Set(exclude);
  return running.filter((n) => n && !skip.has(n) && !n.includes("VPN"));
}

export type ScheduleDecision = { action: "start" | "end" | null; startDue: number | null; endDue: number | null };

/** 하트비트 판정. `start`-`end`를 각각 `judgeSchedule`로 본다. 켜져 있으면 start 회차는 건너뛰고,
 *  꺼져 있으면 end 회차는 무시한다. 둘이 한꺼번에 늦게 왔고 end가 더 늦으면(밤새 앱이 꺼져 있었다)
 *  이미 끝난 구간이라 아무것도 안 한다. 호출자는 `startDue`-`endDue`를 `last_*_due`에 저장한다. */
export function judgeSelfish(cfg: SelfishConfig, nowMs: number, createdMs: number): ScheduleDecision {
  if (!cfg.schedule) return { action: null, startDue: null, endDue: null };
  const startDue = judgeSchedule({ when: cfg.schedule.start, lastDueMs: cfg.last_start_due, createdMs, nowMs });
  const endDue = judgeSchedule({ when: cfg.schedule.end, lastDueMs: cfg.last_end_due, createdMs, nowMs });
  let action: "start" | "end" | null = null;
  if (startDue !== null && endDue !== null) {
    if (startDue > endDue && !cfg.active) action = "start";
    else if (endDue > startDue && cfg.active) action = "end";
  } else if (startDue !== null && !cfg.active) action = "start";
  else if (endDue !== null && cfg.active) action = "end";
  return { action, startDue, endDue };
}

export type LogCounts = {
  dispatch: number;
  done: number;
  stall: number;
  cap_skip: number;
  limit_reap: number;
  last_dispatch: string | null;
};

/** `<날짜> <시각> [<워커>] <표식> ...` 줄을 `sinceMs` 이후(포함)만 센다. 시각은 로컬이다. */
export function countRunnerLog(text: string, sinceMs: number): LogCounts {
  const c: LogCounts = { dispatch: 0, done: 0, stall: 0, cap_skip: 0, limit_reap: 0, last_dispatch: null };
  const re = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) \[[^\]]*\] (\S+)/;
  for (const line of text.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const t = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
    if (t < sinceMs) continue;
    const mark = m[7]!;
    if (mark === "DISPATCH") {
      c.dispatch++;
      c.last_dispatch = line.slice(0, 19);
    } else if (mark === "DONE") c.done++;
    else if (mark === "STALL") c.stall++;
    else if (mark === "상한") c.cap_skip++;
    else if (mark === "REAP" && line.includes("(한도라")) c.limit_reap++;
  }
  return c;
}

export type SelfishReport = {
  since: string;
  until_actual: string;
  cap: number | null;
  quit: string[];
  left: string[];
  per_project: ({ project: string } & LogCounts)[];
};

export function buildReport(
  active: SelfishActive,
  untilActual: string,
  logs: { project: string; text: string }[],
): SelfishReport {
  const sinceMs = Date.parse(active.since);
  return {
    since: active.since,
    until_actual: untilActual,
    cap: active.cap,
    quit: active.quit,
    left: active.left,
    per_project: logs.map((l) => ({ project: l.project, ...countRunnerLog(l.text, sinceMs) })),
  };
}

/** 프로젝트 한 줄: 디스패치-완료-STALL 비율-상한 건너뜀-한도 사망-마지막 디스패치. */
export function projectLine(p: SelfishReport["per_project"][number]): string {
  const ratio = p.dispatch ? Math.round((p.stall / p.dispatch) * 100) : 0;
  return `${p.project}: 디스패치 ${p.dispatch}, 완료 ${p.done}, STALL ${p.stall} (${ratio}%), 상한 건너뜀 ${p.cap_skip}, 한도 사망 ${p.limit_reap}, 마지막 디스패치 ${p.last_dispatch ?? "없음"}`;
}

/** saveSelfishSettings가 입력 검증에서 돌려주는 사유. 이 밖의 실패는 System Events 호출 거절(권한)이다. */
export const SAVE_INVALID = ["invalid schedule", "invalid cap", "invalid exclude"];

/** 저장 실패를 권한 안내로 띄울지 가른다. 입력 오류면 그 사유를 그대로 보여 준다. */
export function saveFailure(error: string | undefined): { kind: "invalid"; reason: string } | { kind: "permission" } {
  return error && SAVE_INVALID.includes(error) ? { kind: "invalid", reason: error } : { kind: "permission" };
}
