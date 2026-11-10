/** 티켓 편집 op 본체(P559-8). `app/(app)/p/[project]/tickets/[hash]/actions.ts`의 서버 액션이 여기를 부르고
 *  `revalidatePath`만 더한다. 판정은 전부 `lib/*.ts`가 하고 여기는 프로젝트 해석 + 열린 티켓 잠금 + 즉시 디스패치뿐이다.
 *  `next/*` import 금지 - `cli.ts`가 화면 서버 없이 돌린다. 돌려주는 값에 `stem`이 있으면 화면이 그 상세를 다시 그린다. */
import { readFile, unlink } from "node:fs/promises";
import { verifyAttachments, withAttachments } from "../attachments.ts";
import { retryBackoffNow } from "../backoff-control.ts";
import { writeEpic, type EpicWriteResult } from "../epic.ts";
import { findTicket } from "../engine.ts";
import { followup, type FollowupResult } from "../followup.ts";
import { t, type Locale } from "../i18n.ts";
import { kickIdleWorker } from "../kick.ts";
import { parseAssignment } from "../paths.ts";
import { dispatchPollingNow, extendPollingUntil } from "../polling-control.ts";
import type { Project, ProjectConfig } from "../projects.ts";
import { resolveConfig } from "../projects.ts";
import {
  PRIORITY_DEFAULT,
  PRIORITY_MAX,
  PRIORITY_MIN,
  isTicketEngineKey,
  TICKET_FORM_FIELD_KEYS,
  lockedReason,
  readFm,
  stateOf,
  stemOf,
  stripBodyEnds,
  writeTicket,
  type TicketState,
} from "../queue.ts";

export type TicketCtx = { project: Project; config: ProjectConfig; locale: Locale };
export type EditResult = { ok: true; stem: string } | { ok: false; error: string };

export async function ticketCtx(project: Project, locale: Locale): Promise<TicketCtx> {
  return { project, config: await resolveConfig(project), locale };
}

async function located(c: TicketCtx, hash: string): Promise<{ path: string; stem: string; state: TicketState }> {
  const p = await findTicket(c.project.root, hash, c.config);
  if (!p) throw new Error(`${t(c.locale, "ticketDetail.ticketNotFoundPrefix")} ${hash}`);
  const base = p.split("/").pop() ?? p;
  return { path: p, stem: stemOf(p, c.config), state: stateOf(base, c.config) };
}

/** 열린 티켓만 쓴다 - `.wip`은 세션이 그 파일로 일하고 `.done`은 불변 기록이다. 틀리면 던지지 않고 결과로 돌려준다. */
async function openOnly(c: TicketCtx, hash: string) {
  const l = await located(c, hash);
  return l.state === "open" ? { l } : { fail: { ok: false, error: lockedReason(l.state, c.locale) } as const };
}

/** frontmatter 값으로 들어갈 한 줄. 개행이 섞이면 frontmatter가 깨져 티켓이 큐에서 사라진다. */
function fmValue(c: TicketCtx, name: string, raw: string): string {
  const v = raw.trim();
  if (/[\r\n]/.test(v)) throw new Error(`${name}${t(c.locale, "ticketDetail.noNewlineSuffix")}`);
  return v;
}

export type SaveInput = { title: string; kind: string; persona: string; priority: unknown; duedate: string; body: string };

/** 저장 - title - kind - persona|squad - priority - duedate와 본문. 나머지 키(엔진 것)는 그대로 둔다. */
export async function saveTicketOp(c: TicketCtx, hash: string, a: SaveInput): Promise<EditResult> {
  try {
    const o = await openOnly(c, hash);
    if (o.fail) return o.fail;
    const title = fmValue(c, t(c.locale, "ticketDetail.titleFieldName"), a.title);
    if (!title) return { ok: false, error: t(c.locale, "ticketDetail.titleRequired") };
    const kind = fmValue(c, "kind", a.kind);
    const assignment = parseAssignment(a.persona);
    const n = Number(a.priority);
    const priority = String(Number.isInteger(n) && n >= PRIORITY_MIN && n <= PRIORITY_MAX ? n : PRIORITY_DEFAULT);
    const duedate = a.duedate.trim();
    await writeTicket(
      o.l.path,
      {
        title,
        kind,
        persona: assignment.squad ? undefined : assignment.persona,
        squad: assignment.squad || undefined,
        priority,
        duedate: duedate || undefined,
      },
      a.body.replace(/\r\n/g, "\n"),
    );
    await kickIdleWorker(c.project.root);
    return { ok: true, stem: o.l.stem };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 키 하나(op)나 행 편집기 제출(화면)을 `updates`로 바꾸는 함수를 받아 쓴다. 본문은 읽은 그대로 되쓴다. */
export async function saveFrontmatterOp(
  c: TicketCtx,
  hash: string,
  toUpdates: (fm: Record<string, string>) => Record<string, string | undefined>,
): Promise<EditResult> {
  try {
    const o = await openOnly(c, hash);
    if (o.fail) return o.fail;
    const { fm, lines, end } = readFm(await readFile(o.l.path, "utf8"));
    await writeTicket(o.l.path, toUpdates(fm), stripBodyEnds(lines.slice(end + 1)).join("\n"));
    await kickIdleWorker(c.project.root);
    return { ok: true, stem: o.l.stem };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** op용: 키 하나. `value`가 없으면 그 줄을 지운다. 폼 키와 엔진 키는 거절한다(화면 행 편집기와 같은 경계). */
export function oneKeyUpdates(c: TicketCtx, key: string, value: string | undefined) {
  return (fm: Record<string, string>): Record<string, string | undefined> => {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`invalid key: ${key}`);
    if (TICKET_FORM_FIELD_KEYS.has(key) || isTicketEngineKey(key)) {
      throw new Error(`${t(c.locale, "queue.frontmatter.uneditableKeyPrefix")} ${key}`);
    }
    if (value !== undefined && /[\r\n]/.test(value)) throw new Error("value must be one line");
    return fm[key] === value ? {} : { [key]: value };
  };
}

export async function setEpicOp(c: TicketCtx, hash: string, epic: string): Promise<EpicWriteResult> {
  try {
    return await writeEpic(c.project.root, c.config, hash, epic);
  } catch (e) {
    return { ok: false, reason: "other", error: (e as Error).message };
  }
}

/** 삭제 - 열린 티켓만. */
export async function deleteTicketOp(c: TicketCtx, hash: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const l = await located(c, hash);
    if (l.state !== "open") {
      const k = l.state === "wip" ? "ticketDetail.deleteLockedWipMessage" : "ticketDetail.deleteLockedDoneMessage";
      return { ok: false, message: t(c.locale, k) };
    }
    await unlink(l.path);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function followupOp(c: TicketCtx, stem: string, text: string, attachments: string[] = []): Promise<FollowupResult> {
  try {
    const attached = await verifyAttachments(c.project, attachments, c.locale);
    const r = await followup(c.project.root, c.config, stem, withAttachments(text, attached), c.locale);
    if (r.ok) await kickIdleWorker(c.project.root);
    return r;
  } catch (e) {
    const error = (e as Error).message;
    return { ok: false, reason: "other", error, detail: error };
  }
}

async function wrap(run: () => Promise<{ ok: true; stem: string } | { ok: false; error: string }>, kick?: string): Promise<EditResult> {
  try {
    const r = await run();
    if (r.ok && kick) await kickIdleWorker(kick);
    return r.ok ? { ok: true, stem: r.stem } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const dispatchPollingNowOp = (c: TicketCtx, hash: string) =>
  wrap(() => dispatchPollingNow(c.project.root, c.config, hash, c.locale), c.project.root);
export const extendPollingOp = (c: TicketCtx, hash: string, until: string) =>
  wrap(() => extendPollingUntil(c.project.root, c.config, hash, until, new Date(), c.locale));
export const retryBackoffOp = (c: TicketCtx, hash: string) =>
  wrap(() => retryBackoffNow(c.project.root, c.config, hash, c.locale), c.project.root);
