/** 재시도 대기 중에도 개입하는 손잡이 하나(DESIGN.md §답변 대기는 사람이 답을 쓰는 자리 하나다
 *  결정 4, P395-3) — `지금 다시 보내기`. **여기서는 판정을 다시 안 잰다** — 만료 여부는 이미
 *  `readBackoff`가 파일에서 읽은 값이고, 표식을 지우는 것 자체가 다시 큐에 넣는 유일한 동작이다.
 *
 *  `polling-control.ts`와 같은 이유로 판정·쓰기를 여기 하나에 모은다 — 화면(actions.ts)이 같은
 *  판정을 다시 하면 두 곳이 갈릴 수 있다. */
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { findTicket } from "./engine.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { localDir } from "./paths.ts";
import { readBackoff } from "./projects.ts";
import { readFm, stateOf, stemOf, type Suffixes } from "./queue.ts";

/** python `.strip().strip("\"'")` — `polling-control.ts`가 이미 든 것과 같은 한 줄(§경계).
 *  `queue.ts`의 `unquote`는 export하지 않는다 — 각 control 파일이 자기 몫만 든다. */
const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, "");

export type BackoffControlResult = { ok: true; stem: string } | { ok: false; error: string };

/** `지금 다시 보내기` — 표식 파일(`<local>/run/backoff-<해시>`)을 지운다. 누적 횟수도 같은
 *  파일의 둘째 줄이라 같이 없어진다(결정 4 "사람이 무언가 고쳤다고 보는 것이 맞다"). frontmatter는
 *  한 글자도 안 건드린다 — 표식이 티켓 밖에 있다(결정 2). */
export async function retryBackoffNow(
  root: string,
  sfx: Suffixes,
  hash: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<BackoffControlResult> {
  const file = await findTicket(root, hash, sfx);
  if (!file) return { ok: false, error: `${t(locale, "ticketDetail.ticketNotFoundPrefix")} ${hash}` };
  if (stateOf(path.basename(file), sfx) !== "open") {
    return { ok: false, error: t(locale, "backoff.control.notRetrying") };
  }
  const { fm } = readFm(await readFile(file, "utf8"));
  // `queue.ts`의 hash 판정과 같은 한 줄(§경계 — 엔진 의미 복제) — 표식 파일명은 이 값으로 갈린다.
  const base = path.basename(file).normalize("NFC");
  const realHash = unquote(fm.ticket ?? "") || base.slice(0, -3);
  const stem = stemOf(file, sfx);
  const local = localDir();
  // 재확인 — 화면이 그린 뒤 만료됐거나(다음 tick이 이미 지웠다) 애초에 없을 수 있다.
  const mark = await readBackoff(local, realHash);
  if (!mark) return { ok: false, error: t(locale, "backoff.control.notRetrying") };
  await unlink(path.join(local, "run", `backoff-${realHash}`)).catch(() => {});
  return { ok: true, stem };
}
