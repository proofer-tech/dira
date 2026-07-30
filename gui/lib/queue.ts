/** 티켓 읽기 코어 — `tickets.py`의 미러.
 *
 *  판정이 한 글자라도 갈리면 GUI가 거짓말을 한다. 그래서 이 파일은 예쁘게 쓰지 않고
 *  `tickets.py`의 함수(is_open_name·read_fm·deps_of·deps_unmet·find_any·scan)를 줄 단위로
 *  베낀다. 눈으로 맞추지 말고 queue.test.ts의 패리티 테스트로 못박는다.
 *  YAML 파서를 쓰지 않는 이유도 같다 — 엔진이 정규식이라 파서를 쓰면 판정이 갈린다. */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "./projects.ts";

export type TicketState = "open" | "wip" | "done";

export type Ticket = {
  hash: string; // frontmatter ticket: || 파일명 stem. **표시값이다** (DESIGN.md §식별자)
  stem: string; // 파일명 − 상태 접미사 − `.md` (NFC). **식별자다** — 링크·URL·엔진 인자가 이것
  // 표시값(`hash`)으로 엔진이 **이 파일을** 찾는가(find_any). false면 사람이 화면의 해시를
  // `deps:`에 옮겨 적으면 선행이 `.done`이 돼도 영구 대기다 — 상세가 경고를 띄우는 근거.
  // 문자열 비교(`hash !== stem`)로 판정하지 않는다: `ticket:` 없는 `.wip`(표시값 `<이름>.wip`)과
  // `re-<해시>` 폴백은 둘이 갈려도 엔진이 정상적으로 찾는다.
  hashResolves: boolean;
  path: string; // 절대경로 (파일시스템 원본 표기 — NFD일 수 있다)
  state: TicketState;
  title: string;
  kind: string;
  persona: string; // PERSONA_RE 통과한 것만
  deps: string[];
  unmet: string[]; // .done이 아닌 deps. 못 찾은 해시도 미충족(보수적)
  assigned: boolean;
  fm: Record<string, string>;
  body: string; // frontmatter 이후 본문
  birth: number; // ms. st_birthtime ?? mtime. 큐 순서
  mtime: number; // ms. 마지막 수정 = `awaiting`이 걸린 시점 (답변 대기 경과일의 기준, §1 보드)
};

/** 상태 접미사는 프로젝트별이다. 하드코딩하지 않고 해석된 값을 받는다. */
export type Suffixes = Pick<ProjectConfig, "inProgress" | "done">;

const nfc = (s: string) => s.normalize("NFC");
/** python `.strip().strip("\"'")` */
const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, "");

const PERSONA_RE = /^[A-Za-z0-9_-]+$/;

/** tickets.py read_fm. 첫 줄이 `---`이 아니거나 닫는 `---`이 없으면 end<0 → 엔진이 무시한다. */
export function readFm(text: string): { fm: Record<string, string>; lines: string[]; end: number } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { fm: {}, lines, end: -1 };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return { fm: {}, lines, end: -1 };
  const fm: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, lines, end };
}

/** tickets.py deps_of. 인라인 `[a, b]`와 블록 리스트 둘 다, 첫 `deps:` 키만. */
export function depsOf(lines: string[], end: number): string[] {
  const out: string[] = [];
  for (let i = 1; i < end; i++) {
    const m = /^deps:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].trim().replace(/^[[\]]+|[[\]]+$/g, "");
    if (inline) out.push(...inline.split(",").map(unquote));
    for (let j = i + 1; j < end; j++) {
      const m2 = /^\s+-\s*(.+)$/.exec(lines[j]);
      if (!m2) break;
      out.push(unquote(m2[1]));
    }
    break;
  }
  return out.filter(Boolean);
}

/** tickets.py is_open_name / in_progress. NFC 정규화 후 접미사 판정. */
export function stateOf(basename: string, sfx: Suffixes): TicketState {
  let stem = nfc(basename);
  if (stem.endsWith(".md")) stem = stem.slice(0, -3);
  if (stem.endsWith(nfc(sfx.done))) return "done";
  if (stem.endsWith(nfc(sfx.inProgress))) return "wip";
  return "open";
}

/** 큐의 티켓 파일. 평면이다 — 하위 디렉터리는 보지 않는다(tickets.py tickets_in). */
async function ticketFiles(root: string): Promise<string[]> {
  const dir = path.join(root, "tickets");
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents
    .filter((e) => !e.isDirectory() && e.name.endsWith(".md") && !e.name.startsWith("."))
    .map((e) => path.join(dir, e.name));
}

/** stem(NFC, `.md` 뗀 파일명) → 파일 목록에서 **처음 나온** 위치. 스캔당 한 번 만들어 재사용한다.
 *  `_find_stem`이 파일을 훑다 처음 맞는 것에서 멈추므로 중복 stem은 **먼저 나온 파일이 이긴다**. */
type StemIndex = { at: Map<string, number>; files: string[] };

function stemIndex(files: string[]): StemIndex {
  const at = new Map<string, number>();
  files.forEach((p, i) => {
    const stem = nfc(path.basename(p)).slice(0, -3);
    if (!at.has(stem)) at.set(stem, i);
  });
  return { at, files };
}

/** tickets.py find_any. 정확 일치가 없으면 `re-<해시>`(피드백 티켓)도 본다. */
function findAny(ix: StemIndex, want: string, sfx: Suffixes): string | null {
  const hit = findStem(ix, nfc(want), sfx);
  if (hit || nfc(want).startsWith("re-")) return hit;
  return findStem(ix, nfc("re-" + want), sfx);
}

/** tickets.py _find_stem — 바깥 루프가 **파일**이고 안쪽이 접미사 3종이다. 즉 이기는 것은
 *  접미사 순서가 아니라 **파일 순서**다: 후보 3개 중 목록에서 가장 앞에 있는 파일을 준다.
 *  (접미사로 먼저 고르면 `x.md`와 `x.wip.md`가 같이 있을 때 판정이 엔진과 갈린다.) */
function findStem(ix: StemIndex, want: string, sfx: Suffixes): string | null {
  let best = -1;
  for (const s of ["", sfx.inProgress, sfx.done]) {
    const i = ix.at.get(want + nfc(s));
    if (i !== undefined && (best < 0 || i < best)) best = i;
  }
  return best < 0 ? null : ix.files[best];
}

/** 파일 하나에서 나오는 것 중 **접미사 설정과 무관한** 부분. 캐시에 담기는 게 이것이다 —
 *  state·stem·unmet은 프로젝트 접미사에 따라 갈리므로 캐시하지 않고 스캔마다 다시 판정한다. */
type Parsed = { mtime: number; size: number; fm: Record<string, string>; deps: string[]; body: string; end: number };

/** 경로 → 파싱 결과. 유효성은 `(mtime, size)`가 판정한다.
 *
 *  보드는 같은 큐를 5초마다 다시 읽는데 그 사이 바뀌는 파일은 0~1개다. stat(162건 ~2ms)만 돌고
 *  안 바뀐 파일은 읽지도 파싱하지도 않는다 — 읽기가 이 함수 비용의 거의 전부다(파싱은 ~2ms).
 *
 *  ponytail: 프로세스 수명 동안 안 비운다. 무효화는 mtime·size가 하고, 항목은 **경로당** 하나라
 *  티켓 하나가 열림·`.wip`·`.done`을 다 거쳐도 3개가 천장이다(큐는 단조 증가하지만 상수배다).
 *  같은 mtime·같은 크기로 덮어쓴 파일은 stale이다 — mtimeMs는 APFS에서 ms 미만까지 오므로
 *  같은 눈금 안에 크기까지 같은 쓰기가 있어야 하고, 그때는 rename(=경로 변경)이 아닌 제자리
 *  수정이다. 이게 문제가 되면 캐시를 지우지 말고 키에 `st.ino`를 더한다. */
const parseCache = new Map<string, Parsed>();

/** 프로젝트 큐의 티켓 전부(open·wip·done). 순서는 birth 오름차순, 동률이면 path — CLI `list`와 같다.
 *
 *  frontmatter가 없거나 닫는 `---`이 없는 파일은 **제외한다**: tickets.py scan()이 그렇게 하므로
 *  엔진에게 안 보이는 파일이고, GUI에 띄우면 있지도 않은 티켓을 있다고 하는 셈이다. */
export async function listTickets(root: string, config: Suffixes): Promise<Ticket[]> {
  const files = await ticketFiles(root);
  const ix = stemIndex(files);
  // 파일별 I/O는 서로 독립이다 — 순차로 기다리면 큐 크기에 그대로 비례한다(158건 200ms).
  // 결과는 Promise.all이 인자 순서로 주고 아래에서 birth·path로 다시 정렬하므로 순서는 불변이다.
  const stats = await Promise.all(files.map((p) => stat(p).catch(() => null)));
  const read = await Promise.all(
    files.map(async (p, i) => {
      const st = stats[i];
      if (!st) return null;
      const hit = parseCache.get(p);
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return { p, st, q: hit };
      let text: string;
      try {
        text = await readFile(p, "utf8");
      } catch {
        return null;
      }
      const { fm, lines, end } = readFm(text);
      const q: Parsed = {
        mtime: st.mtimeMs,
        size: st.size,
        fm,
        end,
        deps: end < 0 ? [] : depsOf(lines, end),
        body: end < 0 ? "" : lines.slice(end + 1).join("\n"),
      };
      parseCache.set(p, q);
      return { p, st, q };
    }),
  );
  const out: Ticket[] = [];
  for (const r of read) {
    if (!r) continue;
    const { p, st, q } = r;
    const { fm, deps, body, end } = q;
    if (end < 0) continue;
    // ponytail: birthtime이 없는 파일시스템은 0으로 온다 → mtime (tickets.py와 같은 폴백).
    const birth = st.birthtimeMs || st.mtimeMs;

    const base = nfc(path.basename(p));
    const persona = unquote(fm.persona ?? "");
    // 접미사 판정은 여기서 한 번만 한다 — 호출부마다 basename을 쪼개면 판정이 갈린다(§식별자).
    const hash = unquote(fm.ticket ?? "") || base.slice(0, -3);
    out.push({
      hash,
      stem: stemOf(p, config),
      hashResolves: findAny(ix, hash, config) === p,
      path: p,
      state: stateOf(path.basename(p), config),
      title: unquote(fm.title ?? ""),
      kind: unquote(fm.kind ?? ""),
      persona: PERSONA_RE.test(persona) ? persona : "",
      deps,
      unmet: deps.filter((h) => {
        const hit = findAny(ix, h, config);
        return !hit || !nfc(path.basename(hit)).endsWith(nfc(config.done + ".md"));
      }),
      assigned: !!unquote(fm.session_id ?? ""),
      fm,
      body,
      birth,
      mtime: st.mtimeMs,
    });
  }
  out.sort((a, b) => a.birth - b.birth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/** 디스패치 가능 = open + 미할당 + unmet 없음 (tickets.py select). */
export const isDispatchable = (t: Ticket) =>
  t.state === "open" && !t.assigned && t.unmet.length === 0;

/** 티켓 5상태. 우선순위는 `tickets.py list`와 같다 — **할당됨이 deps 대기보다 먼저** 나온다.
 *  (`<StatusBadge>`의 Status 부분집합이다. 라벨·색은 그쪽이 정하고 판정은 여기서만 한다.) */
export type TicketStatus = "open" | "blocked" | "assigned" | "wip" | "done";

export function statusOf(t: Ticket): TicketStatus {
  if (t.state !== "open") return t.state;
  if (t.assigned) return "assigned";
  return t.unmet.length ? "blocked" : "open";
}

// ── 요구사항 왕복 (DESIGN.md §요구사항 레이어 결정 5) ────────────────────────

/** 지금 기다리는 답변 stem. 엔진은 이 키를 모른다 — GUI 의미다. */
export const awaitingOf = (t: Ticket): string => unquote(t.fm.awaiting ?? "");

/** 답변 대기 = 열림 + `awaiting`이 걸려 있고 그 stem이 **미충족 dep**이다.
 *
 *  `deps`가 엔진 잠금이고 `awaiting`은 그 잠금이 사람 답변을 기다린다는 표시다. 답변 파일이
 *  생기면 unmet에서 빠져 판정이 저절로 꺼진다 — `awaiting`은 지우지 않는다(이력이 남는다).
 *  `.wip`은 state로 이미 걸러진다: 그 파일로 지금 세션이 일하고 있다(제약 5).
 *
 *  **`statusOf`에 넣지 않는다**(결정 4): 이건 `blocked`의 하위 종류이고, 칸반 레인 배정과 상태
 *  정렬은 엔진이 아는 5상태 그대로여야 한다. 갈리는 것은 배지·필터 선택지뿐이다(§1 보드). */
export function isAwaiting(t: Ticket): boolean {
  const a = nfc(awaitingOf(t));
  return t.state === "open" && !!a && t.unmet.some((d) => nfc(d) === a);
}

/** 표시만 있고 잠금이 없는 상태 — PM이 `awaiting`만 쓰고 `deps`에 안 걸었다.
 *  판정을 `unmet`이 아니라 `deps`로 하는 이유: 답이 달린 뒤엔 `awaiting`이 unmet에서 빠지는데
 *  그때도 경고를 띄우면 "답변 전에 디스패치된다"가 거짓말이 된다(정상적으로 답을 받은 티켓이다). */
export function awaitingUnlocked(t: Ticket): boolean {
  const a = nfc(awaitingOf(t));
  return t.state === "open" && !!a && !t.deps.some((d) => nfc(d) === a);
}

/** 출처 요구사항 stem. `deps`가 아니다 — 선후가 아니라 출처고, 엮으면 큐가 직렬화된다(결정 5). */
export const reqOf = (t: Ticket): string => unquote(t.fm.req ?? "");

/** 본문의 `## 질문 n` 절. 다음 `#`/`##` 제목 전까지가 그 질문의 몸통이다(h3 이하는 안에 남는다). */
export function questionsOf(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let cur: { heading: string; text: string[] } | null = null;
  const flush = () => {
    if (cur) out.push({ heading: cur.heading, text: cur.text.join("\n").trim() });
    cur = null;
  };
  for (const line of body.split("\n")) {
    if (/^#{1,2}\s/.test(line)) {
      flush();
      if (/^##\s*질문/.test(line)) cur = { heading: line.replace(/^#+\s*/, "").trim(), text: [] };
      continue;
    }
    cur?.text.push(line);
  }
  flush();
  return out;
}

/** 스레드 한 칸. 질문은 요구사항 본문의 절이고 답변은 `kind: answer` 티켓이다. */
export type ThreadItem = {
  role: "question" | "answer";
  heading: string;
  text: string;
  /** 답변 티켓의 stem. 질문은 없다(요구사항 본문의 일부다) */
  hash?: string;
};

/** 요구사항 왕복 스레드 — 본문의 `## 질문 n` 절과 `deps` 중 `kind: answer`인 티켓을 번갈아.
 *  답변은 birth 순이다(라운드 순서고, `deps`에 적힌 순서는 PM이 append한 순서일 뿐이다).
 *
 *  **상세(§2 답변 카드)와 보드 카드의 답변 다이얼로그(§1)가 같은 함수를 쓴다** — 두 곳에서 따로
 *  엮으면 같은 요구사항이 화면마다 다른 스레드로 보인다. */
export function threadOf(tickets: Ticket[], t: Ticket, sfx: Suffixes): ThreadItem[] {
  const questions = questionsOf(t.body);
  const answers = t.deps
    .map((d) => resolveDep(tickets, d, sfx))
    .filter((x): x is Ticket => !!x && x.kind === "answer")
    .sort((a, b) => a.birth - b.birth);
  const thread: ThreadItem[] = [];
  for (let i = 0; i < Math.max(questions.length, answers.length); i++) {
    if (questions[i]) thread.push({ role: "question", ...questions[i] });
    if (answers[i]) {
      thread.push({
        role: "answer",
        heading: answers[i].title,
        text: answers[i].body.trim(),
        hash: answers[i].stem,
      });
    }
  }
  return thread;
}

/** 요구 접수 모드의 `title` — 자연어 입력의 첫 비어있지 않은 줄(80자에서 자르고 `…`).
 *
 *  사람이 쓴 문장을 고쳐 쓰지 않는다(그 해석이 PM의 일이다 — §3 요구 접수 모드). frontmatter는
 *  줄 단위 정규식이므로 한 줄이면 그대로 실린다. 없으면 ""을 준다 — 판정은 호출부(액션)가 한다. */
export function reqTitle(input: string): string {
  const line = input.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? line.slice(0, 80) + "…" : line;
}

// ── 보드 필터·검색·정렬 (DESIGN.md §1 보드) ──────────────────────────────────

/** 대소문자·정규화 무시 비교용. 큐 파일이 NFD로 저장돼 있어도(macOS) 한글 검색어가 걸려야 한다 —
 *  안 맞추면 "검색해도 안 나오는 티켓"이 생겨 GUI가 거짓말을 한다. */
const norm = (s: string) => s.normalize("NFC").toLowerCase();

export type BoardQuery = {
  kind: string[]; // 비면 전체 (다중 선택은 OR, 필터끼리는 AND)
  persona: string[];
  status: string[];
  q: string; // title + 본문 + frontmatter 값 전체 부분일치
};

/** `kind: answer`는 **기본 목록에서 뺀다**(§1 보드). 답변은 수행할 티켓이 아니라 요구사항 상세에서
 *  읽는 기록이고 CLI `list`에도 뜨지 않는다(`.done`으로 태어난다) — 여기서 빼는 게 패리티다.
 *  kind 필터에서 `answer`를 고르면 보인다. 숨기는 게 아니라 기본에서 빼는 것이다. */
export const inDefaultList = (t: Ticket, kind: string[]) =>
  t.kind !== "answer" || kind.includes("answer");

export function filterTickets(tickets: Ticket[], query: BoardQuery): Ticket[] {
  const needle = norm(query.q.trim());
  return tickets.filter((t) => {
    if (!inDefaultList(t, query.kind)) return false;
    if (query.kind.length && !query.kind.includes(t.kind)) return false;
    if (query.persona.length && !query.persona.includes(t.persona)) return false;
    // `답변 대기`는 `deps 대기`의 하위 종류다 — `blocked`를 고르면 답변 대기도 들어오고,
    // `awaiting`을 고르면 그것만 남는다(statusOf는 여전히 `blocked`를 준다).
    if (
      query.status.length &&
      !query.status.includes(statusOf(t)) &&
      !(query.status.includes("awaiting") && isAwaiting(t))
    )
      return false;
    if (!needle) return true;
    // 해시를 같이 본다: `ticket:`이 없는 티켓은 해시가 파일명에서 나오므로 frontmatter 값만
    // 훑으면 해시로 못 찾는다("검색해도 안 나오는 티켓"이 생긴다).
    return [t.hash, t.title, t.body, ...Object.values(t.fm)].some((v) => norm(v).includes(needle));
  });
}

/** 상태 필터 프리셋 `완료 숨기기`가 세팅하는 값(§1 보드 · 사람 요청 `fd34255d`).
 *  새 파라미터가 아니라 그냥 `status` 5개다 — 선택지 6개 중 5개 고르기를 1클릭으로 접은 것.
 *
 *  `awaiting`이 결과를 안 바꾸는데도 있는 이유: 위 `filterTickets`의 하위 종류 규칙대로
 *  `blocked`가 답변 대기를 이미 데려오므로 이걸 빼도 결과 집합은 같다. 그래도 넣는다 —
 *  필터의 체크 표시는 결과가 아니라 **진술**이라서, 그것만 비어 있으면 완료 숨김이 답변
 *  대기까지 숨긴다고 읽힌다(사람 요청 `4578d715`).
 *  `assigned`가 있는 이유: 빼면 디스패치되지 않는 티켓이 테이블에서 사라진다 — GUI가 유일하게
 *  보여주는 고장 신호다(§0-2). */
export const HIDE_DONE_STATUSES = ["open", "blocked", "awaiting", "assigned", "wip"];

/** 정렬 가능한 컬럼 = 테이블 컬럼 8개. URL의 `sort` 값은 이 목록으로 검증한다. */
export const SORT_KEYS = [
  "status",
  "hash",
  "title",
  "kind",
  "persona",
  "deps",
  "created",
  "owner",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** 상태 컬럼의 정렬 순서. 알파벳순(assigned·blocked·done…)은 의미가 없다 — 큐를 흐르는 순서다. */
const RANK: Record<TicketStatus, number> = { open: 0, blocked: 1, assigned: 2, wip: 3, done: 4 };

/** `key`가 null이면 **손대지 않는다** — listTickets의 birth 오름차순, 즉 CLI `list`와 같은
 *  큐 순서가 기본값이다. 동률은 `sort`가 안정적이라(ES2019) 큐 순서를 유지한다. */
export function sortTickets(tickets: Ticket[], key: SortKey | null, desc: boolean): Ticket[] {
  if (!key) return tickets;
  const val = (t: Ticket): string | number =>
    ({
      status: RANK[statusOf(t)],
      hash: t.hash,
      title: norm(t.title),
      kind: t.kind,
      persona: t.persona,
      deps: t.deps.length,
      created: t.birth,
      owner: norm(t.fm.owner ?? ""),
    })[key];
  return [...tickets].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    // 한글 title·persona가 섞이므로 문자열은 localeCompare다(코드포인트 순은 사람이 못 읽는다).
    const c = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "ko");
    return desc ? -c : c;
  });
}

// ── 관계 (티켓 상세 §2) ─────────────────────────────────────────────────────

/** 상태 접미사를 뗀 파일명 stem. deps 해시가 가리키는 이름이 이것이다(tickets.py _find_stem). */
export function stemOf(p: string, sfx: Suffixes): string {
  let stem = nfc(path.basename(p));
  if (stem.endsWith(".md")) stem = stem.slice(0, -3);
  for (const s of [sfx.done, sfx.inProgress]) {
    const n = nfc(s);
    if (n && stem.endsWith(n)) return stem.slice(0, -n.length);
  }
  return stem;
}

/** deps 문자열 하나 → 큐의 티켓. tickets.py find_any와 같은 판정: 정확 일치가 없으면 `re-<해시>`.
 *
 *  ponytail: find_any는 frontmatter가 깨진 파일도 후보로 보지만(파일 목록을 훑는다) 여기 넘어오는
 *  `tickets`는 그 파일들이 빠진 목록이다. 그런 파일은 엔진 scan에도 안 잡혀 화면에 띄울 게 없으므로
 *  링크가 없는 `큐에 없는 해시`로 보인다 — unmet 판정 자체는 listTickets가 파일 목록으로 한다. */
export function resolveDep(tickets: Ticket[], dep: string, sfx: Suffixes): Ticket | null {
  const byStem = (want: string) => tickets.find((t) => stemOf(t.path, sfx) === want) ?? null;
  const want = nfc(dep);
  return byStem(want) ?? (want.startsWith(nfc("re-")) ? null : byStem(nfc("re-") + want));
}

/** deps 해시 → 배지 종류. **판정이 사는 유일한 곳**이다(§비주얼 §2 deps 배지).
 *
 *  보드 카드·보드 테이블·상세 관계 절 세 곳이 이걸 쓴다 — 같은 `kind: answer` dep이 화면마다
 *  다르게 보이면 안 된다. 우선순위: 큐에 없음 → 미충족 → 답변 → 충족. **`unmet`이 `answer`보다
 *  앞이다**: 답변 파일은 `.done`으로 태어나므로 정상적으로는 겹치지 않지만, 열린 채로 있는
 *  `kind: answer` dep은 실제로 후행을 굶기고 있어서 중립 배지로 그리면 막힌 사유를 감춘다.
 *
 *  반환 순서도 여기서 정한다(미충족·큐에 없음 → 충족·답변) — 조치가 필요한 것이 줄 왼쪽 끝이다. */
export type DepKind = "met" | "unmet" | "missing" | "answer";

/** `sort`는 ES2019부터 안정적이라 그룹 안에서는 `deps`에 적힌 순서가 그대로 유지된다. */
const needsAction = (d: { kind: DepKind }) => d.kind === "unmet" || d.kind === "missing";

export function depBadges(
  tickets: Ticket[],
  t: Ticket,
  sfx: Suffixes,
): { hash: string; kind: DepKind; hit: Ticket | null }[] {
  return t.deps
    .map((hash) => {
      const hit = resolveDep(tickets, hash, sfx);
      const kind: DepKind = !hit
        ? "missing"
        : t.unmet.includes(hash)
          ? "unmet"
          : hit.kind === "answer"
            ? "answer"
            : "met";
      return { hash, kind, hit };
    })
    .sort((a, b) => Number(needsAction(b)) - Number(needsAction(a)));
}

/** 역참조 — **이 티켓을 deps에 가진** 티켓들. 전체 큐를 훑는다(deps는 한 방향으로만 적히므로).
 *  ponytail: 티켓 수 × deps 수 선형 스캔. 큐가 수천 건 되면 stem → 티켓 맵을 한 번 만든다. */
export function referrers(tickets: Ticket[], target: Ticket, sfx: Suffixes): Ticket[] {
  return tickets.filter(
    (t) => t.path !== target.path && t.deps.some((d) => resolveDep(tickets, d, sfx) === target),
  );
}

/** 이 요구사항에서 나온 티켓 — `req:`가 이 티켓을 가리키는 것들(§요구사항 레이어 결정 5).
 *
 *  `referrers`(deps 역참조)와 **섞지 않는다**: 이건 선후가 아니라 출처다. 해석은 `resolveDep`을
 *  그대로 쓴다 — stem 조회 판정이 엔진과 갈리면 화면의 링크가 다른 파일로 간다. */
export function derivedFrom(tickets: Ticket[], target: Ticket, sfx: Suffixes): Ticket[] {
  return tickets.filter((t) => {
    const req = reqOf(t);
    return !!req && t.path !== target.path && resolveDep(tickets, req, sfx) === target;
  });
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────

/** 티켓 파일 제자리 쓰기 — frontmatter 키 갱신 + 본문 교체. **읽고-고치고-쓰기**다.
 *
 *  frontmatter는 `tickets.py set_fm_keys`와 같은 규칙으로 손댄다: 있는 키는 그 줄을 바꾸고 없는
 *  키는 닫는 `---` 직전에 넣는다. 나머지 줄(session_id·owner·attempts·pid…)은 순서까지 그대로
 *  둔다 — 엔진이 쓰는 값이라 GUI가 다시 조립하면 잃는다.
 *
 *  `.wip` 여부는 **호출자가 막는다**(그 파일로 지금 세션이 일하고 있다 — 제약 5). */
export async function writeTicket(
  p: string,
  updates: Record<string, string>,
  body: string,
): Promise<void> {
  const text = await readFile(p, "utf8");
  const { lines, end } = readFm(text);
  if (end < 0) throw new Error(`frontmatter 없음: ${p}`);

  const fmLines = lines.slice(0, end + 1);
  for (const [key, raw] of Object.entries(updates)) {
    const val = raw.trim();
    const line = val ? `${key}: ${val}` : `${key}:`;
    const i = fmLines.findIndex((l, n) => n > 0 && l.startsWith(key + ":"));
    if (i < 0) fmLines.splice(fmLines.length - 1, 0, line);
    else fmLines[i] = line;
  }
  await writeFile(p, [...fmLines, ...body.split("\n")].join("\n"), "utf8");
}
