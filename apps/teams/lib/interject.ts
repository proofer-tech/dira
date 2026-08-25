/** 참견 보내기 (DESIGN.md §2-2) — 도는 세션의 입구(FIFO)에 한 줄을 밀어 넣는다.
 *
 *  입구는 엔진이 만든다: `tick.sh`가 세션마다 `mkfifo`하고 그 경로를 티켓 frontmatter
 *  `inbox:`에 적는다(`tickets.py setinbox`). **GUI는 경로를 유도하지 않는다** — 유도하면
 *  프로젝트 설정을 추측하게 되고, 추측이 틀리면 화면은 "보냈습니다"라고 말하는데 아무 데도
 *  안 간다. `inbox`가 없다 = 참견 불가가 그 규약에서 공짜로 떨어진다.
 *
 *  **이 파일의 일은 거짓말을 안 하는 것 하나다.** "보냈습니다"가 거짓이 되는 것이 이 기능
 *  최악의 실패라(§2-2), 실패를 삼키지 않고 사유마다 다른 문장으로 돌려준다. */
import { open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { findTicket } from "./engine.ts";
import { readFm, stateOf, type Suffixes, type TicketState } from "./queue.ts";

/** §2-2가 가른 **네 사유** + 그 밖. 화면이 §비주얼 §21의 문구 넷(제목·다음 행동)을 갈라 쓰는
 *  근거가 이 코드다 — `error` 문장을 되짚어 갈리면 문구 한 자를 고치는 날 화면이 조용히 뭉친다.
 *  `other`는 §21에 항이 없는 나머지(EAGAIN·EPIPE·FIFO 아님·상대경로·큐에 없음)이고, 화면은
 *  제목 한 줄 + `detail` 원문으로 그린다(§6 2번 — 사유를 삼키지 않는다). */
export type InterjectReason = "ENXIO" | "ENOENT" | "not-wip" | "no-inbox" | "other";

/** `error`는 사람이 읽는 한 문장(로그·다른 호출부), `detail`은 §비주얼 §21의 **mono 원문**이다.
 *  둘이 갈리는 건 넷뿐이고(`ENXIO: <경로>` · `상태: 완료` …) 나머지는 같은 문장이다. */
export type InterjectResult =
  | { ok: true }
  | { ok: false; reason: InterjectReason; error: string; detail: string };

const fail = (reason: InterjectReason, error: string, detail = error): InterjectResult => ({
  ok: false,
  reason,
  error,
  detail,
});

/** §비주얼 §21 실패 표의 `상태: 완료` / `상태: 열림`. `wip`은 여기 안 온다(그 판정이 통과다). */
const STATE_KO: Record<TicketState, string> = { open: "열림", wip: "진행중", done: "완료" };

/** python `.strip().strip("\"'")` — `queue.ts`의 unquote와 같은 정규화. `setinbox`는 따옴표 없이
 *  쓰지만 사람이 손으로 만진 fm도 같은 규칙으로 읽는다(엔진 `read_fm`이 그렇다). */
const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, "");

/** 참견 한 줄을 티켓의 세션 입구로 보낸다. 프로젝트는 인자로 받는다(§아키텍처 — 모듈 전역에
 *  "현재 프로젝트"를 두지 않는다).
 *
 *  **화면이 들고 있던 값을 하나도 믿지 않는다.** 상태도 `inbox` 경로도 지금 이 순간의 티켓
 *  파일에서 다시 읽는다 — 스트림 폴링이 2초라 그 사이에 세션이 끝난다. 클라이언트가 주는 건
 *  티켓 stem과 본문뿐이고, stem은 다른 액션과 같은 조회(`find_any` 미러)를 지나므로 큐 밖
 *  파일을 가리킬 수 없다. */
export async function interject(
  root: string,
  sfx: Suffixes,
  hash: string,
  text: string,
): Promise<InterjectResult> {
  // 신뢰 경계 입력 검증. 공백만인 참견은 세션의 턴을 흔들기만 하고 아무 뜻도 없다.
  const content = text.replace(/\r\n/g, "\n").trim();
  if (!content) return fail("other", "보낼 내용을 입력하세요.");

  const file = await findTicket(root, hash, sfx);
  if (!file) return fail("other", `큐에 없는 티켓입니다: ${hash}`);

  const state = stateOf(path.basename(file), sfx);
  if (state !== "wip") {
    return fail(
      "not-wip",
      "진행중 티켓이 아닙니다 — 도는 세션이 없어 참견이 닿을 곳이 없습니다.",
      `상태: ${STATE_KO[state]}`,
    );
  }

  const { fm, end } = readFm(await readFile(file, "utf8"));
  const inbox = end < 0 ? "" : unquote(fm.inbox ?? "");
  if (!inbox) {
    return fail(
      "no-inbox",
      "이 세션에는 참견 입구가 없습니다(frontmatter `inbox` 없음) — 스트리밍 입력으로 띄운 세션에만 말을 걸 수 있습니다.",
      "frontmatter에 inbox 없음",
    );
  }
  // fm은 디스패처가 쓰지만 그 파일을 세션이 편집할 수도 있다. 여기서 쓰기 대상 경로가 되므로
  // 상대경로는 거부한다 — Next 서버 cwd(`apps/teams/`) 기준으로 풀려 엉뚱한 파일을 연다.
  if (!path.isAbsolute(inbox)) {
    return fail("other", `참견 입구 경로가 절대경로가 아닙니다: ${inbox}`);
  }

  // **`O_NONBLOCK`이 이 함수의 핵심이다.** 없으면 읽는 쪽이 붙을 때까지 open이 블록하고,
  // 세션이 이미 죽은 FIFO에 쓰면 Server Action이 영영 안 끝난다.
  let fh;
  try {
    fh = await open(inbox, constants.O_WRONLY | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENXIO") {
      return fail(
        "ENXIO",
        "세션이 이미 끝났습니다 — 입구는 남아 있는데 읽는 쪽이 없습니다.",
        `ENXIO: ${inbox}`,
      );
    }
    if (code === "ENOENT") {
      return fail("ENOENT", "참견 입구가 없습니다 — 세션이 끝나면서 지워졌습니다.", `ENOENT: ${inbox}`);
    }
    return fail("other", `참견 입구를 열 수 없습니다(${code ?? "?"}): ${inbox}`);
  }
  try {
    // 심층 방어: FIFO가 아니면 안 쓴다. `inbox`가 일반 파일을 가리키면 위 open이 성공해서
    // 그 파일 앞부분을 덮어쓴다 — 여는 것만으로는 아무 피해가 없으므로 연 뒤에 판정한다.
    if (!(await fh.stat()).isFIFO()) {
      return fail("other", `참견 입구가 FIFO가 아닙니다: ${inbox}`);
    }
    // 엔진의 최초 프롬프트와 같은 모양(`tick.sh`). `\n`으로 끝난다 — 파서가 줄 단위다.
    // 본문의 개행은 JSON 이스케이프되므로 여러 줄이어도 한 줄로 나간다.
    // ponytail: 파이프 버퍼(64KB)를 넘는 참견은 `O_NONBLOCK` 때문에 EAGAIN이 되어 아래
    // 문장으로 실패한다. 사람이 손으로 치는 글이라 천장에 안 닿는다 — 닿으면 나눠 쓴다.
    const line = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
    await fh.write(line);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EAGAIN") {
      return fail("other", "참견 입구가 가득 찼습니다 — 세션이 읽어갈 때까지 기다렸다 다시 보내세요.");
    }
    if (code === "EPIPE") {
      // `ENXIO`로 뭉치지 않는다 — 사유는 같아도(세션이 끝났다) mono 원문에 `ENXIO:`를 적으면
      // 화면이 안 난 errno를 적는 셈이다. 문장이 이미 무슨 일이 났는지 알려 준다.
      return fail("other", "세션이 이미 끝났습니다 — 쓰는 중에 입구가 닫혔습니다.");
    }
    return fail("other", `참견을 쓰지 못했습니다(${code ?? "?"}): ${(e as Error).message}`);
  } finally {
    await fh.close();
  }
  return { ok: true };
}
