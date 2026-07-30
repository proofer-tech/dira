"use server";

/** 티켓 **파일**을 바꾸는 서버 액션 — 저장 · 할당 해제 · 삭제.
 *
 *  `app/actions.ts`와 따로 두는 이유: 그쪽은 레지스트리 전용이고 큐 파일을 하나도 건드리지 않는다
 *  (제약 7). 여기는 반대로 큐 파일만 만진다. 화면 폴더에 두는 건 `workers/actions.ts`와 같은 규칙.
 *
 *  **클라이언트가 넘긴 프로젝트·해시는 신뢰 경계 밖이다.** 매 호출마다 다시 검증하고, 경로는
 *  `tickets.py find`로 새로 얻는다 — 화면을 그린 뒤 파일이 잡혔을(claim) 수도 있다.
 *  상태 재확인이 `.wip` 편집을 막는 유일한 장치다(렌더 시점 판정은 이미 낡았다).
 *
 *  여기 오는 `hash`는 **푼 값**이다(페이지가 `decodeHash`로 한 번 푼다). 조회에만 쓴다 —
 *  엔진 인자와 `revalidatePath`는 찾아낸 파일의 `stem`이고(§식별자), URL이라 다시 인코딩한다. */
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { findTicket, unassign, type UnassignRun } from "@/lib/engine";
import { NAME_RE, isHash, resolveWithin } from "@/lib/paths";
import { findTranscript, sessionIdOf, tailEvents, type StreamEvent } from "@/lib/transcript";
import {
  awaitingOf,
  isAwaiting,
  listTickets,
  readFm,
  resolveDep,
  stateOf,
  stemOf,
  writeTicket,
  type TicketState,
} from "@/lib/queue";
import { getProject, resolveConfig } from "@/lib/projects";

export type SaveState = { ok?: boolean; error?: string };

type Target = {
  root: string;
  path: string;
  stem: string;
  state: TicketState;
  assigned: boolean;
  sessionId: string | null; // UUID_RE를 통과한 것만. 이 값만 경로가 된다(§2-1 경로 방어)
};

/** 프로젝트·해시 → 지금 이 순간의 파일. 못 찾으면 문장으로 던진다(액션이 결과로 바꾼다).
 *
 *  `stem`은 **찾아낸 파일에서 뽑는다** — 엔진 왕복(`unassign`)과 `revalidatePath`가 쓰는 값이다.
 *  URL 문자열을 그대로 넘기면 `findTicket` 폴백으로 들어온 표시값에서 화면은 뜨는데 엔진 호출만
 *  `티켓을 못 찾음`으로 실패한다(DESIGN.md §식별자). */
async function target(projectId: string, hash: string): Promise<Target> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  const config = await resolveConfig(project);
  const p = await findTicket(project.root, hash, config);
  if (!p) throw new Error(`큐에 없는 티켓입니다: ${hash}`);
  const { fm, end } = readFm(await readFile(p, "utf8"));
  return {
    root: project.root,
    path: p,
    stem: stemOf(p, config),
    state: stateOf(path.basename(p), config),
    assigned: end >= 0 && !!(fm.session_id ?? "").trim().replace(/^["']+|["']+$/g, ""),
    sessionId: end >= 0 ? sessionIdOf(fm) : null,
  };
}

export type StreamChunk = { events: StreamEvent[]; offset: number; live: boolean };

/** 세션 스트림 폴링 (DESIGN.md §2-1 · §9). 클라이언트가 `offset`을 들고 오면 **그 뒤에 붙은
 *  바이트만** 읽어 사건 + 새 `offset`을 돌려준다. Route Handler를 만들지 않는다 — 서버 fs 접근은
 *  이미 Server Action이 하는 일이고 `app/api/`는 §아키텍처 트리에 없는 새 관례다.
 *
 *  **`session_id`는 클라이언트가 보내는 것을 쓰지 않는다.** 매 호출마다 티켓 fm에서 서버가 읽고
 *  UUID_RE를 통과한 것만 경로가 된다(§경로 방어). 클라이언트가 주는 건 티켓 stem과 offset뿐이고
 *  stem은 다른 액션과 같은 조회(`tickets.py find`)를 지나므로 큐 밖 파일을 가리킬 수 없다.
 *
 *  `live`(= 티켓이 `.wip`)는 **클라이언트가 폴링을 멈출 근거다.** 티켓이 사라졌거나 조회가 실패해도
 *  `live: false`로 물러난다 — 못 찾는 티켓을 2초마다 다시 물을 이유가 없다. 빈 상태(트랜스크립트
 *  없음)도 에러가 아니라 빈 사건 배열이다(§9 "에러로 그리지 않는다"). */
export async function tailSession(
  projectId: string,
  stem: string,
  offset: number,
): Promise<StreamChunk> {
  // 클라이언트가 준 숫자다. `tailEvents`가 파일 크기로 다시 자르지만 NaN·Infinity는 그 비교를
  // 통과해 `Buffer.alloc`까지 간다 — 여기서 정수 아닌 것을 0으로 되돌린다.
  const at = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  try {
    const t = await target(projectId, stem);
    const live = t.state === "wip";
    if (!t.sessionId) return { events: [], offset: at, live };
    const file = await findTranscript(t.sessionId);
    if (!file) return { events: [], offset: at, live };
    return { ...(await tailEvents(file, at)), live };
  } catch {
    return { events: [], offset: at, live: false };
  }
}

const LOCKED = "진행중 티켓은 편집할 수 없습니다 — 세션이 그 파일로 일하고 있습니다.";

/** frontmatter 값으로 들어갈 한 줄. 개행이 섞이면 frontmatter가 깨져 티켓이 큐에서 사라진다. */
function fmValue(name: string, raw: string): string {
  const v = raw.trim();
  if (/[\r\n]/.test(v)) throw new Error(`${name}에 줄바꿈을 넣을 수 없습니다.`);
  return v;
}

/** 저장 — 읽고-고치고-쓰기. 건드리는 frontmatter 키는 title·kind·persona 셋뿐이고
 *  나머지(session_id·owner·attempts·pid…)는 엔진 것이라 그대로 둔다.
 *
 *  ponytail: deps는 편집하지 않는다 — 자유 입력은 오타 해시로 영구 대기를 만들어 스펙이 금지한다
 *  (DESIGN.md §3). 검색 가능한 멀티셀렉트가 필요하고 그건 티켓 발행(fb4f2723)이 만든다. */
export async function saveTicket(_prev: SaveState, form: FormData): Promise<SaveState> {
  const projectId = String(form.get("project") ?? "");
  const hash = String(form.get("hash") ?? "");
  try {
    const t = await target(projectId, hash);
    if (t.state === "wip") return { error: LOCKED };

    const title = fmValue("제목", String(form.get("title") ?? ""));
    if (!title) return { error: "제목을 입력하세요." };
    const kind = fmValue("kind", String(form.get("kind") ?? ""));
    const persona = fmValue("persona", String(form.get("persona") ?? ""));
    if (persona && !NAME_RE.test(persona)) {
      // 엔진이 이 값으로 페르소나 디렉터리 경로를 만든다. 규칙 밖이면 조용히 무시돼 프로필이 안 붙는다.
      return { error: `persona는 영문·숫자·_·- 만 됩니다(엔진이 경로로 씁니다): ${persona}` };
    }

    // textarea는 CRLF로 온다(HTML 폼 규격). 그대로 쓰면 파일 전체 줄끝이 갈린다.
    let body = String(form.get("body") ?? "").replace(/\r\n/g, "\n");
    if (body && !body.endsWith("\n")) body += "\n";

    await writeTicket(t.path, { title, kind, persona }, body);
    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/p/${projectId}`); // 보드의 title·kind·persona 컬럼
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 할당 해제 — **엔진에 위임한다**(제약 2). `assigned`가 아니면 부르지 않는다: 이 명령은
 *  진행중 접미사도 떼므로, 할당 안 된 `.wip`에 부르면 세션 없이 잡힌 상태를 사람이 흔드는 셈이다. */
export async function unassignTicket(projectId: string, hash: string): Promise<UnassignRun> {
  try {
    const t = await target(projectId, hash);
    if (!t.assigned) {
      return { ok: false, output: "할당된 티켓이 아닙니다(session_id가 비어 있습니다).", worker: null };
    }
    // URL 문자열이 아니라 **찾아낸 파일의 stem**을 넘긴다 — 엔진 `find`는 파일명만 본다.
    const r = await unassign(t.root, t.stem);
    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/p/${projectId}`);
    return r;
  } catch (e) {
    return { ok: false, output: (e as Error).message, worker: null };
  }
}

/** 요구사항 답변 — `tickets/<awaiting><done>.md`를 **새로** 만든다 (DESIGN.md §요구사항 레이어).
 *
 *  이 액션이 큐의 잠금을 푸는 유일한 방법이다: `<R>`은 존재하지 않는 dep을 기다리며 열린 채
 *  `select`에서 빠져 있고(결정 3), 그 파일이 생기는 순간 `deps_unmet`이 비어 다시 디스패치된다.
 *  사람이 누를 `다시 큐에` 버튼은 없다 — 답변 파일 생성이 그 버튼이다.
 *
 *  **답변 파일은 처음부터 `.done`으로 태어난다.** 열린 상태로 만들면 페르소나 없는 티켓이 되어
 *  아무 워커에게 디스패치된다. `<R>` 자체는 건드리지 않는다(`awaiting`도 지우지 않는다 — 이력이다).
 *
 *  `.wip`은 `isAwaiting`의 `state === "open"`이 구조적으로 막는다(제약 5). */
export async function answerRequirement(_prev: SaveState, form: FormData): Promise<SaveState> {
  const projectId = String(form.get("project") ?? "");
  const hash = String(form.get("hash") ?? "");
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);
    const file = await findTicket(project.root, hash, config);
    if (!file) throw new Error(`큐에 없는 티켓입니다: ${hash}`);

    // 화면을 그린 뒤 세션이 이 티켓을 잡았거나 다른 창이 이미 답했을 수 있다 — 판정을 다시 한다.
    const tickets = await listTickets(project.root, config);
    const nfc = (s: string) => s.normalize("NFC");
    const t = tickets.find((x) => nfc(x.path) === nfc(file));
    if (!t || !isAwaiting(t)) {
      throw new Error(
        "지금 이 티켓은 답변 대기가 아닙니다 — 이미 답변이 달렸거나 세션이 잡았습니다. 화면을 새로고침해 상태를 확인하세요.",
      );
    }

    const stem = awaitingOf(t);
    // PM 세션이 쓴 값이지만 여기서 파일명이 된다 — 신뢰 경계다(경로 구분자·제어문자·dotfile).
    if (!isHash(stem)) {
      throw new Error(
        `awaiting 값을 파일 이름으로 쓸 수 없습니다: ${stem}. 경로 구분자·제어문자가 없는 이름이어야 합니다 — 요구사항의 frontmatter를 고치세요.`,
      );
    }

    // **`O_EXCL`만으로는 부족하다**: 그건 `<A><done>.md`만 막는다. `<A>.md`가 열린 채로 있으면
    // `_find_stem`이 열린 쪽을 먼저 집어 답을 써도 unmet이 그대로다 = 영구 대기. 판정은 엔진과
    // 같은 조회(`tickets.py find` → `find_any`)로 한다 — 상태 무관하게 그 stem을 찾는다.
    const clash = await findTicket(project.root, stem, config);
    if (clash) {
      throw new Error(
        `${stem} 이름의 티켓이 이미 큐에 있습니다: ${path.basename(clash)}. 그 파일이 있는 한 답변 파일을 만들어도 엔진이 그쪽을 먼저 집어 요구사항이 영구 대기합니다. 그 파일을 확인해 정리하거나, PM에게 다른 awaiting 해시를 받으세요.`,
      );
    }

    // textarea는 CRLF로 온다(HTML 폼 규격).
    const answer = String(form.get("body") ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!answer) throw new Error("답변 내용을 입력하세요.");

    // 라운드 번호 = 이미 달린 답변 수 + 1. 질문 절 번호와 같은 수를 쓴다(§요구사항 왕복 스레드).
    const n =
      t.deps.filter((d) => resolveDep(tickets, d, config)?.kind === "answer").length + 1;

    // 경로를 문자열로 믿지 않는다 — 큐 디렉터리 안인지 확인하고 그 결과로 연다(§경로 방어).
    const answerPath = await resolveWithin(
      path.join(project.root, "tickets"),
      `${stem}${config.done}.md`,
    );
    const text = [
      "---",
      `ticket: ${stem}`,
      `title: 답변 — ${t.stem} #${n}`,
      "kind: answer",
      "---",
      "",
      `## 답변 ${n}`,
      "",
      answer,
      "",
    ].join("\n");

    // 여는 것 자체가 검사다(`wx`) — 위 검사와 생성 사이에 다른 창·세션이 끼어들 수 있다.
    const fh = await open(answerPath, "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `답변 파일이 이미 있습니다: ${path.basename(answerPath)}. 다른 창에서 방금 답했을 수 있습니다 — 새로고침해 스레드를 확인하세요.`,
        );
      }
      throw e;
    });
    try {
      await fh.writeFile(text, "utf8");
    } finally {
      await fh.close();
    }

    revalidatePath(`/p/${projectId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/p/${projectId}`); // 배지가 `deps 대기` → `대기`로 바뀐다 = 재큐의 증거
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type DeleteResult = { ok: boolean; message?: string };

/** 삭제 — 파일을 지운다. `.wip`이면 막는다(돌고 있는 세션의 티켓이 사라지면 완료 신고도 못 한다). */
export async function deleteTicket(projectId: string, hash: string): Promise<DeleteResult> {
  try {
    const t = await target(projectId, hash);
    if (t.state === "wip") {
      return { ok: false, message: "진행중 티켓은 삭제할 수 없습니다 — 세션이 물고 있습니다." };
    }
    await unlink(t.path);
    revalidatePath(`/p/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
