/** 폴링 대기를 상한 전에 끊는 손잡이 둘(DESIGN.md §폴링 대기 §개정 3) — `지금 디스패치`·
 *  `상한 늘리기`. **여기서는 답변 파일을 안 쓴다** — 답변 파일이 태어나는 자리는 상한 초과
 *  하나뿐이고(결정 7 무수정), 사람이 안 물은 질문에 답이 생기지 않는다.
 *
 *  판정과 쓰기를 여기 하나에 모으는 이유는 `lib/interject.ts`·`lib/followup.ts`와 같다 —
 *  화면(actions.ts)이 같은 판정을 다시 하면 두 곳이 갈릴 수 있다. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { findTicket } from "./engine.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import {
  parseIsoOffset,
  readFm,
  stateOf,
  stemOf,
  stripBodyEnds,
  writeTicket,
  type Suffixes,
} from "./queue.ts";

/** python `.strip().strip("\"'")` — `queue.ts`의 unquote와 같은 정규화(`followup.ts`도 같은
 *  이유로 이 한 줄을 다시 든다 — `"use server"` 액션 파일이 못 내보내는 헬퍼라 여기도 새 export를
 *  안 만든다). */
const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, "");

export type PollingControlResult = { ok: true; stem: string } | { ok: false; error: string };

/** 공통 앞부분 — 파일을 다시 찾고 `isPolling`을 재확인한다(§개정 3 Done when "`isPolling`이
 *  거짓인 티켓에서는 거절한다"). `queue.ts`의 `isPolling`은 `Ticket` 전체(= `listTickets` 전체
 *  스캔)를 요구하는데 여기는 파일 하나만 다시 읽으면 되므로, 같은 정의(`state === "open"` &&
 *  `polling`이 비어 있지 않음)를 fm 하나로 다시 본다 — `actions.ts`의 `target()`이 `session_id`·
 *  `inbox`를 이 방식으로 보는 것과 같은 관용구다. */
async function pollingFile(
  root: string,
  sfx: Suffixes,
  hash: string,
  locale: Locale,
): Promise<{ path: string; stem: string; body: string } | { error: string }> {
  const file = await findTicket(root, hash, sfx);
  if (!file) return { error: `${t(locale, "ticketDetail.ticketNotFoundPrefix")} ${hash}` };
  const text = await readFile(file, "utf8");
  const { fm, lines, end } = readFm(text);
  if (end < 0 || stateOf(path.basename(file), sfx) !== "open" || !unquote(fm.polling ?? "")) {
    return { error: t(locale, "polling.control.notPolling") };
  }
  return {
    path: file,
    stem: stemOf(file, sfx),
    body: stripBodyEnds(lines.slice(end + 1)).join("\n"),
  };
}

/** `지금 디스패치` — `polling`·`polling_fails` 둘 다 비운다. 카운트를 같이 비우는 이유: 화면의
 *  쓰기는 그 티켓의 `run/poll-<해시>.lock` 밖에서 일어나므로, 스크립트가 도는 30초 안에 사람이
 *  누르면 뒤이은 tick의 `pollresult`가 실패 카운트를 올릴 수 있다 — 이미 2였으면 3에 닿아 방금
 *  푼 티켓이 답변 대기로 다시 잠긴다. 같이 비우면 그 자리가 없어진다. `polling_until`·`polled_at`은
 *  이력으로 남긴다(결정 7과 같은 이유). */
export async function dispatchPollingNow(
  root: string,
  sfx: Suffixes,
  hash: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<PollingControlResult> {
  const f = await pollingFile(root, sfx, hash, locale);
  if ("error" in f) return { ok: false, error: f.error };
  await writeTicket(f.path, { polling: undefined, polling_fails: undefined }, f.body, locale);
  return { ok: true, stem: f.stem };
}

/** `상한 늘리기` — `polling_until` 하나만 다시 적는다. 파싱 안 되는 값과 지금보다 앞선 값은
 *  거절한다(`tickets.py` `pollplan`의 검사 3과 같은 판정 — 못 읽으면 만료로 안 보는 그쪽과 달리
 *  여기는 사람이 지금 입력한 값이라 관대할 이유가 없다). `parseIsoOffset`은 이미 이 필드
 *  (`assigned_at`과 같은 서식)의 정본 파서라 새 파서를 안 만든다. */
export async function extendPollingUntil(
  root: string,
  sfx: Suffixes,
  hash: string,
  untilRaw: string,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): Promise<PollingControlResult> {
  const f = await pollingFile(root, sfx, hash, locale);
  if ("error" in f) return { ok: false, error: f.error };
  const raw = untilRaw.trim();
  const parsed = raw ? parseIsoOffset(raw) : null;
  if (!parsed) return { ok: false, error: t(locale, "polling.control.badUntil") };
  if (parsed.getTime() <= now.getTime()) {
    return { ok: false, error: t(locale, "polling.control.pastUntil") };
  }
  await writeTicket(f.path, { polling_until: raw }, f.body, locale);
  return { ok: true, stem: f.stem };
}
