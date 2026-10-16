/** 디스패치가 멎은 이유 판정 — 순수 함수 (DESIGN.md §P501 §값).
 *
 *  새 판정을 만들지 않고 `runner.log`에 이미 남는 건너뜀 줄과 scan의 열린 티켓 값을 번역한다.
 *  화면 문구는 `i18n.ts`의 `stall.<key>.line` - `stall.<key>.todo`다(자리표시자 `{n}` 등은
 *  `params`로 호출자가 채운다). 이 파일은 키와 값만 낸다. */

import { t, type Locale } from "./i18n.ts";

export type StallKey =
  | "migration" | "auth" | "cooldown" | "machineCap" | "personaCap" | "priority"
  | "shellCap" | "watchdog" | "noCandidate" | "notWaking" | "unknown";

export type StallLine = { at: number; text: string };
export type StallWorker = { name: string; idle: boolean; lines: StallLine[] };
export type StallWatchdog = { at: number; code: string; text: string };
export type StallTicket = { hash: string; unmet: string[]; awaiting: boolean; polling: boolean };
export type StallParams = Record<string, string | number>;
export type Stall = {
  reason: StallKey;
  params: StallParams;
  perWorker: { name: string; reason: StallKey; raw: string; params: StallParams }[];
  watchdog: { code: string; text: string }[];
};

/** "최근" 창 - cron 주기 최대 60초 + 여유 30초. */
const RECENT = 90;

/** 순서 1-6이 우선순위다. 위에서 먼저 걸린 것을 쓴다. */
const RULES: { key: StallKey; re: RegExp; params: (m: RegExpMatchArray) => StallParams }[] = [
  { key: "migration", re: /^SKIP 마이그레이션 (?:진행 중|미적용 (\S+))/, params: (m) => ({ id: m[1] ?? "" }) },
  { key: "auth", re: /^SKIP AUTH 대기 (\S+)/, params: (m) => ({ engine: m[1] }) },
  { key: "cooldown", re: /^SKIP 엔진 쿨다운 · (\d+)초 남음/, params: (m) => ({ n: +m[1] }) },
  { key: "machineCap", re: /^상한 - 머신 전체 산 세션 (\d+)\/(\d+)/, params: (m) => ({ a: +m[1], b: +m[2] }) },
  { key: "personaCap", re: /^SKIP 페르소나 상한 (\S+) (\d+)\/(\d+)/, params: (m) => ({ persona: m[1], a: +m[2], b: +m[3] }) },
  { key: "priority", re: /^SKIP 우선순위 1 ([0-9a-f]{8})/, params: (m) => ({ hash: m[1] }) },
  { key: "shellCap", re: /^셸 상한 - 이 워커의 셸이 (\d+)벌\(상한 (\d+)\)/, params: (m) => ({ n: +m[1], max: +m[2] }) },
];

/** 일시 현상과 이벤트 줄 - 이유 판정에서 건너뛰고 그 다음 최신 줄을 본다. */
const SKIPPED = /^(SKIP ps 조회 실패|SKIP 다른 워커가 선정 중이다|SKIP 선정 잠금 재획득 실패|DISPATCH|DONE|NOTE|BROWSER|REAP|POLL|NUDGE)/;
const BUSY = /^SKIP 이 워커가 아직 티켓을 물고 있다/;

type Own = { key: StallKey; params: StallParams; raw: string };

/** 워커의 최근 줄(최신이 앞)에서 이유 하나. `"busy"`면 이번 판정에서 idle이 아니다. */
function judgeWorker(lines: StallLine[], now: number): Own | "busy" | null {
  for (const { at, text } of lines) {
    if (now - at > RECENT) continue;
    if (SKIPPED.test(text)) continue;
    if (BUSY.test(text)) return "busy";
    for (const r of RULES) {
      const m = text.match(r.re);
      if (m) return { key: r.key, params: r.params(m), raw: text };
    }
    return { key: "unknown", params: { raw: text }, raw: text };
  }
  return null;
}

export function judgeStall(input: {
  workers: StallWorker[];
  watchdog: StallWatchdog[];
  tickets: StallTicket[];
  now: number;
}): Stall | null {
  const { workers, tickets, now } = input;
  if (tickets.length === 0) return null;

  const idle: { name: string; own: Own | null; recent: boolean }[] = [];
  for (const w of workers) {
    if (!w.idle) continue;
    const own = judgeWorker(w.lines, now);
    if (own === "busy") continue;
    idle.push({ name: w.name, own, recent: w.lines.some((l) => now - l.at <= RECENT) });
  }
  if (idle.length === 0) return null;

  const dog = input.watchdog.filter((d) => now - d.at <= RECENT).map(({ code, text }) => ({ code, text }));

  let reason: StallKey;
  let params: StallParams = {};
  const ranked = RULES.map((r) => r.key);
  const hit = idle
    .flatMap((w) => (w.own && w.own.key !== "unknown" ? [w.own] : []))
    .sort((a, b) => ranked.indexOf(a.key) - ranked.indexOf(b.key))[0];
  if (hit) {
    reason = hit.key;
    params = hit.params;
  } else if (dog.length > 0) {
    reason = "watchdog";
    params = { text: dog[0].text, code: dog[0].code };
  } else if (tickets.every((t) => t.unmet.length > 0 || t.awaiting || t.polling)) {
    reason = "noCandidate";
    params = {
      d: tickets.filter((t) => t.unmet.length > 0).length,
      w: tickets.filter((t) => t.awaiting).length,
      p: tickets.filter((t) => t.polling).length,
    };
  } else if (idle.every((w) => !w.recent)) {
    reason = "notWaking";
  } else {
    const u = idle.find((w) => w.own)?.own;
    if (!u) return null; // 줄은 있으나 전부 일시 현상 - 판정할 근거가 없다
    reason = "unknown";
    params = u.params;
  }

  return {
    reason,
    params,
    perWorker: idle.map((w) => ({ name: w.name, reason: w.own?.key ?? reason, raw: w.own?.raw ?? "", params: w.own?.params ?? params })),
    watchdog: dog,
  };
}

const fill = (text: string, params: StallParams) => text.replace(/\{(\w+)\}/g, (m, k) => String(params[k] ?? m));

/** 한 줄과 할 일 문구 - 사전의 자리표시자를 `params`로 채운다. */
export const stallLine = (locale: Locale, key: StallKey, params: StallParams) => fill(t(locale, `stall.${key}.line`), params);
export const stallTodo = (locale: Locale, key: StallKey, params: StallParams) => fill(t(locale, `stall.${key}.todo`), params);
