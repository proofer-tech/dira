/** 이어받기 (DESIGN.md §2-2 완료 티켓의 참견) — 완료 티켓의 참견은 FIFO가 아니라 **새 열린
 *  티켓 한 장**이 된다.
 *
 *  이건 새 기능이 아니라 **`복제`(§2)의 한 동작 판**이다. 값은 전부 복제 계약에서 온다:
 *  `kind`·`persona`는 원본 값, `deps`·`req`·엔진 키(`session_id`·`owner`·`assigned_at`·`pid`·
 *  `attempts`·`claimed_at`·`awaiting`)는 안 넘어간다 — 엔진 키가 들어가면 이미 할당된 것으로 보여
 *  영원히 디스패치되지 않고, 원본의 deps는 원본이 이미 소비했다. `title`만 갈린다(참견 첫 줄).
 *
 *  **원본은 읽기만 한다.** 참견을 원본 본문에 덧붙이면 `.done`이 이 큐의 불변 기록이라는 규약을
 *  깨고(그 파일의 존재에 `deps` 해소·`req:` 역참조가 달렸다), 덧붙일 자리도 `## 결과` 뒤다.
 *
 *  **모드가 어긋나면 조용히 바꾸지 않는다.** 화면이 `.done`으로 알고 보냈는데 서버가 `.wip`으로
 *  읽으면 실패 + 사유다 — 자동으로 참견으로 넘기면 사람이 원하지 않은 곳에 말이 들어간다
 *  (`lib/interject.ts`가 반대 방향으로 같은 판정을 이미 들고 있다). */
import { randomUUID } from "node:crypto";
import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { findTicket } from "./engine.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { NAME_RE } from "./paths.ts";
import { readFm, reqTitle, stateOf, stemOf, type Suffixes, type TicketState } from "./queue.ts";

/** 갈리는 것은 **모드 어긋남 하나**다(§2-2 — 그 사실 자체가 사람이 알아야 하는 값이다).
 *  나머지(빈 본문·큐에 없음·frontmatter 없음·해시 고갈)는 `other`이고 화면은 원문을 그린다
 *  (§6 2번 — 사유를 삼키지 않는다). `lib/interject.ts`와 같은 모양이라 화면이 `<Failure>` 하나로 받는다. */
export type FollowupReason = "not-done" | "other";

/** `error`는 사람이 읽는 한 문장, `detail`은 §비주얼 §21의 **mono 원문**이다(`상태: 진행중` …). */
export type FollowupResult =
  | { ok: true; stem: string }
  | { ok: false; reason: FollowupReason; error: string; detail: string };

const fail = (reason: FollowupReason, error: string, detail = error): FollowupResult => ({
  ok: false,
  reason,
  error,
  detail,
});

/** `.done`이 아닌 두 상태의 mono 원문(§비주얼 §21의 `상태: 완료`와 같은 자리·반대 방향). */
const stateLabel = (locale: Locale, state: TicketState): string =>
  t(locale, `followupLib.state.${state}`);

/** python `.strip().strip("\"'")` — `queue.ts`의 unquote와 같은 정규화. */
const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, "");

/** 라벨 한 줄. **이 줄이 이 항의 유일한 발명이다**(§2-2): 원본 본문에는 `## Goal`·`## Done when`이
 *  살아 있고 프로토콜은 그 둘을 계약이라고 명시하므로, 라벨이 없으면 새 세션이 첫 화면에서 읽는
 *  계약이 **이미 끝난 일**이고 그러면 그걸 다시 한다. */
const HANDOFF_NOTE =
  "아래는 그 티켓 전문이다. **이미 끝난 일이라 맥락으로만 읽는다** — 계약은 위 `## 이어서`다.";

/** 완료 티켓 + 참견 한 줄 → 새 열린 티켓. 성공하면 그 **stem**을 돌려준다(화면이 상세로 이동한다).
 *
 *  **화면이 들고 있던 값을 하나도 믿지 않는다.** 상태도 `kind`·`persona`·본문도 지금 이 순간의
 *  티켓 파일에서 다시 읽는다 — 스트림 폴링이 2초라 그 사이에 상태가 바뀐다. 클라이언트가 주는
 *  건 티켓 stem과 참견 본문뿐이고, stem은 다른 액션과 같은 조회(`find_any` 미러)를 지나므로
 *  큐 밖 파일을 가리킬 수 없다. */
export async function followup(
  root: string,
  sfx: Suffixes,
  hash: string,
  text: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<FollowupResult> {
  // 신뢰 경계 입력 검증. 공백만인 참견으로 만들면 title 없는 티켓이 태어난다.
  const content = text.replace(/\r\n/g, "\n").trim();
  if (!content) return fail("other", t(locale, "followupLib.emptyBody"));

  const file = await findTicket(root, hash, sfx);
  if (!file) return fail("other", `${t(locale, "followupLib.ticketNotFoundPrefix")} ${hash}`);

  const state = stateOf(path.basename(file), sfx);
  if (state !== "done") {
    return fail(
      "not-done",
      t(locale, "followupLib.notDoneReason"),
      `${t(locale, "followupLib.stateDetailPrefix")} ${stateLabel(locale, state)}`,
    );
  }

  const { fm, lines, end } = readFm(await readFile(file, "utf8"));
  if (end < 0) {
    // scan()이 빼는 파일이다 — 엔진에게 안 보이는 티켓에서 값을 베끼면 없는 것을 이어받는 셈이다.
    return fail(
      "other",
      `${t(locale, "followupLib.malformedFrontmatterPrefix")} ${path.basename(file)}`,
    );
  }

  const stem = stemOf(file, sfx);
  // `title`만 복제와 갈린다(§2-2): 다이얼로그가 없어 고칠 자리가 없으므로 원본 제목을 그대로
  // 쓰면 보드에 같은 제목이 두 줄 뜨고 어느 쪽이 후속인지 화면이 말할 수 없다.
  const title = reqTitle(content);
  // 원본 값 그대로다. `kind`는 검증하지 않는다 — 엔진이 안 보는 값이고 목록 밖 값(`answer` 등)도
  // 원본이 그렇게 살아 있었다. `persona`는 엔진이 `<personas>/<이름>/PROFILE.md` 경로로 쓰므로
  // 규칙 밖이면 안 싣는다(`queue.ts`의 `Ticket.persona`와 같은 판정 — 그쪽도 버린다).
  const kind = unquote(fm.kind ?? "");
  const raw = unquote(fm.persona ?? "");
  const persona = NAME_RE.test(raw) ? raw : "";

  // 원본 본문 전문(`## 결과` 포함). 닫는 `---` 다음 줄은 항상 빈 줄이라 앞을 떼고 붙인다.
  const origin = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  // **참견이 위, 원본이 아래다**(§2-2 — 순서가 계약이다).
  const body =
    ["## 이어서", content, "", `## 이어받은 티켓 — ${stem}`, HANDOFF_NOTE, "", origin]
      .join("\n")
      .trimEnd() + "\n";

  const fileText = (h: string) =>
    [
      "---",
      `ticket: ${h}`,
      `title: ${title}`,
      ...(kind ? [`kind: ${kind}`] : []),
      ...(persona ? [`persona: ${persona}`] : []),
      "---",
      "",
      body,
    ].join("\n");

  // 큐 디렉터리의 **파일명**을 직접 본다: 해시 충돌 검사는 frontmatter가 깨져 엔진에 안 보이는
  // 파일까지 포함해야 하고(그 파일도 이름을 점유한다), deps가 가리키는 이름이 `ticket:` 값이
  // 아니라 상태 접미사를 뗀 파일명이다(`tickets.py _find_stem`).
  //
  // 아래 열 줄은 `(board)/actions.ts`의 `createTicket`과 같은 코드다. **거기서 import하지 못한다** —
  // `"use server"` 파일은 모든 export가 async 함수여야 해서 헬퍼를 내보낼 수 없다(그 파일 머리
  // 주석이 `fmValue`로 같은 대가를 이미 적고 있다). 규약이 갈리면 안 되는 쪽은 이 주석이 짝이다.
  const dir = path.join(root, "tickets");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith("."));
  const stems = new Set(names.map((n) => stemOf(n, sfx)));

  // 해시는 서버가 만든다(`randomUUID` 8 hex). `stems` 검사와 생성 사이에 다른 세션이 끼어들 수
  // 있으므로 **여는 것 자체가 검사**여야 한다 — `wx`(= `O_EXCL`).
  for (let i = 0; i < 10; i++) {
    const h = randomUUID().slice(0, 8);
    if (stems.has(h)) continue;
    const fh = await open(path.join(dir, `${h}.md`), "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; // 졌다 — 다시 뽑는다
      throw e;
    });
    if (!fh) continue;
    try {
      await fh.writeFile(fileText(h), "utf8");
    } finally {
      await fh.close();
    }
    return { ok: true, stem: h };
  }
  return fail("other", t(locale, "followupLib.hashExhausted"));
}
