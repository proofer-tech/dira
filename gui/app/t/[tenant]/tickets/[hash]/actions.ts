"use server";

/** 티켓 **파일**을 바꾸는 서버 액션 — 저장 · 할당 해제 · 삭제.
 *
 *  `app/actions.ts`와 따로 두는 이유: 그쪽은 레지스트리 전용이고 큐 파일을 하나도 건드리지 않는다
 *  (제약 7). 여기는 반대로 큐 파일만 만진다. 화면 폴더에 두는 건 `workers/actions.ts`와 같은 규칙.
 *
 *  **클라이언트가 넘긴 테넌트·해시는 신뢰 경계 밖이다.** 매 호출마다 다시 검증하고, 경로는
 *  `tickets.py find`로 새로 얻는다 — 화면을 그린 뒤 파일이 잡혔을(claim) 수도 있다.
 *  상태 재확인이 `.wip` 편집을 막는 유일한 장치다(렌더 시점 판정은 이미 낡았다).
 *
 *  여기 오는 `hash`는 **푼 값**이다(페이지가 `decodeHash`로 한 번 푼다). 조회에만 쓴다 —
 *  엔진 인자와 `revalidatePath`는 찾아낸 파일의 `stem`이고(§식별자), URL이라 다시 인코딩한다. */
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { findTicket, unassign, type UnassignRun } from "@/lib/engine";
import { NAME_RE } from "@/lib/paths";
import { readFm, stateOf, stemOf, writeTicket, type TicketState } from "@/lib/queue";
import { getTenant, resolveConfig } from "@/lib/tenants";

export type SaveState = { ok?: boolean; error?: string };

type Target = {
  root: string;
  path: string;
  stem: string;
  state: TicketState;
  assigned: boolean;
};

/** 테넌트·해시 → 지금 이 순간의 파일. 못 찾으면 문장으로 던진다(액션이 결과로 바꾼다).
 *
 *  `stem`은 **찾아낸 파일에서 뽑는다** — 엔진 왕복(`unassign`)과 `revalidatePath`가 쓰는 값이다.
 *  URL 문자열을 그대로 넘기면 `findTicket` 폴백으로 들어온 표시값에서 화면은 뜨는데 엔진 호출만
 *  `티켓을 못 찾음`으로 실패한다(DESIGN.md §식별자). */
async function target(tenantId: string, hash: string): Promise<Target> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`등록되지 않은 테넌트입니다: ${tenantId}`);
  const config = await resolveConfig(tenant);
  const p = await findTicket(tenant.root, hash, config);
  if (!p) throw new Error(`큐에 없는 티켓입니다: ${hash}`);
  const { fm, end } = readFm(await readFile(p, "utf8"));
  return {
    root: tenant.root,
    path: p,
    stem: stemOf(p, config),
    state: stateOf(path.basename(p), config),
    assigned: end >= 0 && !!(fm.session_id ?? "").trim().replace(/^["']+|["']+$/g, ""),
  };
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
  const tenantId = String(form.get("tenant") ?? "");
  const hash = String(form.get("hash") ?? "");
  try {
    const t = await target(tenantId, hash);
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
    revalidatePath(`/t/${tenantId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/t/${tenantId}`); // 보드의 title·kind·persona 컬럼
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 할당 해제 — **엔진에 위임한다**(제약 2). `assigned`가 아니면 부르지 않는다: 이 명령은
 *  진행중 접미사도 떼므로, 할당 안 된 `.wip`에 부르면 세션 없이 잡힌 상태를 사람이 흔드는 셈이다. */
export async function unassignTicket(tenantId: string, hash: string): Promise<UnassignRun> {
  try {
    const t = await target(tenantId, hash);
    if (!t.assigned) {
      return { ok: false, output: "할당된 티켓이 아닙니다(session_id가 비어 있습니다).", worker: null };
    }
    // URL 문자열이 아니라 **찾아낸 파일의 stem**을 넘긴다 — 엔진 `find`는 파일명만 본다.
    const r = await unassign(t.root, t.stem);
    revalidatePath(`/t/${tenantId}/tickets/${encodeURIComponent(t.stem)}`);
    revalidatePath(`/t/${tenantId}`);
    return r;
  } catch (e) {
    return { ok: false, output: (e as Error).message, worker: null };
  }
}

export type DeleteResult = { ok: boolean; message?: string };

/** 삭제 — 파일을 지운다. `.wip`이면 막는다(돌고 있는 세션의 티켓이 사라지면 완료 신고도 못 한다). */
export async function deleteTicket(tenantId: string, hash: string): Promise<DeleteResult> {
  try {
    const t = await target(tenantId, hash);
    if (t.state === "wip") {
      return { ok: false, message: "진행중 티켓은 삭제할 수 없습니다 — 세션이 물고 있습니다." };
    }
    await unlink(t.path);
    revalidatePath(`/t/${tenantId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
