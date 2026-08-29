/** 카드를 에픽에 끌어다 놓는 쓰기 (DESIGN.md §에픽 §결정 8) — 티켓 fm `epic:` 한 줄만 고친다.
 *
 *  화면(손잡이는 P273-12)이 아직 안 왔다 — 이 파일은 그 드롭이 부를 액션의 코어다. `interject.ts`
 *  와 같은 이유로 `lib/`에 둔다: `[hash]/actions.ts`는 `"use server"`라 `pnpm test` 글롭
 *  (`*.test.ts` · `lib/**`)에 안 걸린다 — 단위 테스트가 붙는 로직은 여기 있다.
 *
 *  판정(잠금·무변경)은 여기 하나뿐이다 — 화면이 낙관적으로 먼저 판단하면 `saveTicket`과
 *  두 벌이 된다. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { findTicket } from "./engine.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import {
  lockedReason,
  readFm,
  stateOf,
  stemOf,
  stripBodyEnds,
  writeTicket,
  type Suffixes,
} from "./queue.ts";

/** `reason`은 화면(§비주얼 §52 ⑤ 실패 한 줄)이 세 갈래 문구 중 어느 것을 그릴지 고르는 값이다 -
 *  판정을 클라이언트가 다시 하지 않는다(에러 문자열을 패턴 매칭하지 않는다). */
export type EpicWriteResult =
  | { ok: true; stem: string }
  | { ok: false; reason: "locked" | "missing" | "other"; error: string };

/** frontmatter 값으로 들어갈 한 줄. `[hash]/actions.ts`의 `fmValue`와 같은 검사(개행 거부)다 —
 *  `"use server"` 파일에서 못 끌어온 헬퍼라 한 줄 다시 둔다(`(board)/actions.ts`도 같은 대가를
 *  치른다). */
function fmValue(raw: string, locale: Locale): string {
  const v = raw.trim();
  if (/[\r\n]/.test(v)) throw new Error(t(locale, "epicLib.noNewline"));
  return v;
}

/** python `.strip().strip("\"'")` — `queue.ts`의 unquote와 같은 정규화. */
const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, "");

/** `epic`이 빈 문자열이면 `(에픽 없음)`에 놓은 것이다 — `epic:` 줄 자체를 지운다(§결정 8). */
export async function writeEpic(
  root: string,
  sfx: Suffixes,
  hash: string,
  epic: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<EpicWriteResult> {
  const file = await findTicket(root, hash, sfx);
  if (!file) return { ok: false, reason: "missing", error: `${t(locale, "epicLib.notFoundPrefix")} ${hash}` };

  const state = stateOf(path.basename(file), sfx);
  if (state !== "open") return { ok: false, reason: "locked", error: lockedReason(state) };

  let value: string;
  try {
    value = fmValue(epic, locale);
  } catch (e) {
    return { ok: false, reason: "other", error: (e as Error).message };
  }

  const stem = stemOf(file, sfx);
  const { fm, lines, end } = readFm(await readFile(file, "utf8"));
  if (end < 0) return { ok: false, reason: "other", error: `${t(locale, "epicLib.noFrontmatterPrefix")} ${file}` };

  // 이미 그 값이면 아무것도 안 쓴다 — mtime 불변(§결정 8 "5초 폴링이 안 갈린 파일을 다시 그리게
  // 하지 않는다").
  if (value === unquote(fm.epic ?? "")) return { ok: true, stem };

  const body = stripBodyEnds(lines.slice(end + 1)).join("\n");
  await writeTicket(file, { epic: value || undefined }, body);
  return { ok: true, stem };
}
