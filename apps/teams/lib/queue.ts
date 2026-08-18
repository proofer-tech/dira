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
  priority: number; // 원값(frontmatter priority:). 없거나 잘못되면 3(§1-3 §값)
  baseline: number; // §1-4 기준값 — 파생(마감)이 있으면 파생, 없으면 priority. effective 이전값
  effective: number; // 유효 우선순위 — deps 역방향 상속(§1-3 §유효 우선순위). 파일에 안 씀
  // §1-4 유효마감 — min({자기 duedate} ∪ {후행의 유효마감}). `.done`은 그래프 밖이라 null.
  // §종 항목 ⑦(`dueAlertOf`)과 §값을 넣는 자리(상세 파생 한 줄의 "남은")가 같이 쓴다. 파일에 안 씀
  effectiveDue: Date | null;
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

/** §2 §원문의 양끝: 닫는 `---` 다음 구분 빈 줄 한 줄과 파일 끝 개행 하나를 뗀다(trim이 아니다 —
 *  본문 자체의 빈 줄·개행은 안 건드린다, 한 줄씩만 있으면 뗀다). `writeTicket`이 짝으로 되씌운다. */
export function stripBodyEnds(lines: string[]): string[] {
  let out = lines;
  if (out[0] === "") out = out.slice(1);
  if (out.length && out[out.length - 1] === "") out = out.slice(0, -1);
  return out;
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

export const PRIORITY_DEFAULT = 3;
export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 5;

/** python `int()`가 받는 문자열 모양(부호 + 숫자만). `"3.0"`·`""`은 거부한다. */
function pyInt(s: string): number | null {
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
}

/** tickets.py priority_of. frontmatter `priority:`. 없으면 3(무경고). 정수가 아니거나 1~5 밖이면
 *  3 + WARN 한 줄(§1-3 §값 — 파서를 안 만든다, `readFm`이 준 문자열에 정수 판정 한 번이다). */
export function priorityOf(fm: Record<string, string>, h = ""): number {
  const raw = unquote(fm.priority ?? "");
  if (!raw) return PRIORITY_DEFAULT;
  const n = pyInt(raw);
  if (n === null) {
    console.warn(`WARN priority가 정수가 아니다 ${h} 값=${JSON.stringify(raw)} - 3으로 읽음`);
    return PRIORITY_DEFAULT;
  }
  if (n < PRIORITY_MIN || n > PRIORITY_MAX) {
    console.warn(`WARN priority가 1~5 밖이다 ${h} 값=${n} - 3으로 읽음`);
    return PRIORITY_DEFAULT;
  }
  return n;
}

export const DUE_ESCALATE_MS = 5 * 60 * 60 * 1000; // 남은 <= 이 값이면 파생 5(지난 마감 포함)
export const DUE_DEMOTE_MS = 7 * 24 * 60 * 60 * 1000; // 남은 >= 이 값 + 자기 duedate 있으면 파생 1

/** ISO 8601 날짜시간, 오프셋은 선택(`+09:00`·`Z`). `<input type="datetime-local">`이 내는
 *  오프셋 없는 값이 기본 입력이다. */
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?$/;

function isoOffsetMs(off: string): number {
  if (off === "Z") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(off)!;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000;
}

/** tickets.py duedate_of. frontmatter `duedate:`. 키가 없으면 마감 없음(무경고 — 큐 마이그레이션
 *  0건이 이 무경고에 걸려 있다). 못 읽으면(빈 값·자연어 포함) 마감 없음 + WARN 한 줄(§1-4 §값 —
 *  새 파서를 안 만든다, 정규식 하나가 `fromisoformat` 대신이다). 오프셋 있는 값은 그 오프셋의
 *  절대 시각으로, 없는 값은 로컬 시각으로 읽는다 — 둘 다 `Date`(절대 시각)라 이후 `now`와의
 *  차는 오프셋 유무와 무관하게 맞다(tickets.py가 로컬로 변환해 버리는 것과 같은 결과다). */
export function duedateOf(fm: Record<string, string>, h = ""): Date | null {
  if (!("duedate" in fm)) return null;
  const raw = unquote(fm.duedate ?? "");
  const m = raw ? ISO_DATETIME_RE.exec(raw) : null;
  if (!m) {
    console.warn(`WARN duedate 못 읽음 ${h} 값=${JSON.stringify(raw)} - 마감 없음으로 읽음`);
    return null;
  }
  const [, y, mo, d, hh, mi, ss, off] = m;
  const sec = ss ? Math.trunc(Number(ss)) : 0;
  if (!off) return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), sec);
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), sec);
  return new Date(utcMs - isoOffsetMs(off));
}

/** tickets.py derive_priority. §1-4 §파생: 남은 <= 5시간이면 5(지난 마감 포함) · 자기 duedate가
 *  있고 남은 >= 7일이면 1 · 그 사이는 없음(null). 강등(1)만 `hasOwnDuedate`로 막는다 — 급한
 *  쪽(5)은 전이하지만 느긋한 쪽(1)은 전이하지 않는다(§1-4 §전이). */
export function derivePriority(remainingMs: number | null, hasOwnDuedate: boolean): number | null {
  if (remainingMs === null) return null;
  if (remainingMs <= DUE_ESCALATE_MS) return 5;
  if (hasOwnDuedate && remainingMs >= DUE_DEMOTE_MS) return 1;
  return null;
}

/** tickets.py _priority_graph. 열린 티켓 + `.wip`의 (hash -> priority, hash -> deps,
 *  hash -> duedate). `.done`은 제외한다 — 끝난 티켓은 더는 아무것도 기다리지 않는다
 *  (§1-3 §유효 우선순위). */
function priorityGraph(
  entries: { hash: string; state: TicketState; fm: Record<string, string>; deps: string[] }[],
): { prio: Map<string, number>; deps: Map<string, string[]>; duedate: Map<string, Date | null> } {
  const prio = new Map<string, number>();
  const deps = new Map<string, string[]>();
  const duedate = new Map<string, Date | null>();
  for (const e of entries) {
    if (e.state === "done") continue;
    prio.set(e.hash, priorityOf(e.fm, e.hash));
    deps.set(e.hash, e.deps);
    duedate.set(e.hash, duedateOf(e.fm, e.hash));
  }
  return { prio, deps, duedate };
}

/** tickets.py _effective_from_graph. §1-3 유효 우선순위 + §1-4 유효마감을 **같은 순회에서**
 *  함께 접는다(추가 순회 0):
 *
 *  유효마감(t) = min({t.duedate} ∪ {유효마감(w) | w의 deps에 t가 있다}) — 아무것도 없으면 null.
 *  기준(t) = 파생(남은(t) = 유효마감(t)-now, 자기 duedate 유무)이 있으면 파생, 없으면 t.priority.
 *  유효(t) = max(기준(t), {유효(w) | w의 deps에 t가 있다}).
 *
 *  방향은 역방향이다 — t를 기다리는 w의 값을 t가 물려받는다. 체인 전체를 타고, 순환은 방문
 *  집합으로 자른다(사이클 위에서 재방문하면 그 노드의 원값만 반환하고 더 안 판다 — 무한재귀
 *  없이, 다른 비순환 경로의 최댓값은 그대로 잡는다). 파일에는 안 쓴다.
 *
 *  반환하는 `baseline`은 §1-4가 접는 두 번째 값이다(기준값 — 파생이 명시값을 덮었는지 구별하는
 *  자리, DISPATCH 로그의 `(마감)`·`(상속 N)` 출처 표기와 같은 값). */
function effectiveFromGraph(
  prio: Map<string, number>,
  deps: Map<string, string[]>,
  duedate: Map<string, Date | null>,
  now: Date,
): { eff: Map<string, number>; baseline: Map<string, number>; effDue: Map<string, Date | null> } {
  const waiters = new Map<string, string[]>();
  for (const [h, ds] of deps) {
    for (const d of ds) {
      const list = waiters.get(d);
      if (list) list.push(h);
      else waiters.set(d, [h]);
    }
  }

  const eff = new Map<string, number>();
  const baseline = new Map<string, number>();
  const effDue = new Map<string, Date | null>();

  function calc(h: string, visiting: Set<string>): [number, Date | null] {
    if (eff.has(h)) return [eff.get(h)!, effDue.get(h) ?? null];
    const ownPrio = prio.get(h) ?? PRIORITY_DEFAULT;
    const ownDue = duedate.get(h) ?? null;
    if (visiting.has(h)) return [ownPrio, ownDue];
    visiting.add(h);
    let bestDue = ownDue;
    let bestEff: number | null = null;
    for (const w of waiters.get(h) ?? []) {
      const [wEff, wDue] = calc(w, visiting);
      if (wDue !== null && (bestDue === null || wDue < bestDue)) bestDue = wDue;
      bestEff = bestEff === null ? wEff : Math.max(bestEff, wEff);
    }
    visiting.delete(h);

    const remaining = bestDue !== null ? bestDue.getTime() - now.getTime() : null;
    const derived = derivePriority(remaining, ownDue !== null);
    const hBase = derived ?? ownPrio;
    const best = bestEff === null ? hBase : Math.max(hBase, bestEff);

    eff.set(h, best);
    baseline.set(h, hBase);
    effDue.set(h, bestDue);
    return [best, bestDue];
  }

  for (const h of prio.keys()) calc(h, new Set());
  return { eff, baseline, effDue };
}

/** §1-4 §종 항목 ⑦ 판정 둘. 큐 파일만 읽는다(유효마감·unmet) — 예측 0. 한 티켓이 둘 다
 *  맞아도 행은 하나다: 지난 마감이 우선이다(문구 표 ⑦ "지났습니다" 또는 "남았는데…"). */
export type DueAlert = { overdue: boolean; remainingMs: number; unmetCount: number };

export function dueAlertOf(t: Ticket, now: Date): DueAlert | null {
  if (t.state === "done" || t.effectiveDue === null) return null;
  const remainingMs = t.effectiveDue.getTime() - now.getTime();
  if (remainingMs < 0) return { overdue: true, remainingMs, unmetCount: t.unmet.length };
  if (remainingMs <= DUE_ESCALATE_MS && t.unmet.length > 0) {
    return { overdue: false, remainingMs, unmetCount: t.unmet.length };
  }
  return null;
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

/** 해시 → 실제 티켓 경로. `tickets.py find`(= find_any)와 같은 판정을 큐 디렉터리 스캔으로 답한다.
 *  경로를 조립하지 않는다 — 돌려주는 건 `readdir`가 준 실제 파일 경로다(§경로 방어).
 *  **파일을 열지 않는다**: 이름만 보면 되므로 `listTickets`보다 훨씬 싸다(38b11db5). */
export async function findPath(
  root: string,
  want: string,
  sfx: Suffixes,
): Promise<string | null> {
  return findAny(stemIndex(await ticketFiles(root)), want, sfx);
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
 *  엔진에게 안 보이는 파일이고, GUI에 띄우면 있지도 않은 티켓을 있다고 하는 셈이다.
 *
 *  `now`는 §1-4 §계산 시점 — 안 주면 호출 시점을 한 번 읽어 이 호출의 값 전부에 같은 시각을
 *  쓴다(엔진의 `scan(troot, now=None)`과 같은 자리). GUI는 렌더마다 새로 부르므로 그때마다
 *  다시 잰다 — tickets.py와 같은 계약, 새 폴링 규칙 0개. */
export async function listTickets(root: string, config: Suffixes, now: Date = new Date()): Promise<Ticket[]> {
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
        body: end < 0 ? "" : stripBodyEnds(lines.slice(end + 1)).join("\n"),
      };
      parseCache.set(p, q);
      return { p, st, q };
    }),
  );
  // hash·state는 그래프(priority 상속)의 재료라 값 조립 전에 먼저 뽑는다 — tickets.py의
  // scan()이 _priority_graph를 한 번 만들고서야 행을 채우는 것과 같은 순서다.
  const entries = read.flatMap((r) => {
    if (!r || r.q.end < 0) return [];
    const { p, st, q } = r;
    const base = nfc(path.basename(p));
    const hash = unquote(q.fm.ticket ?? "") || base.slice(0, -3);
    return [{ p, st, hash, state: stateOf(path.basename(p), config), fm: q.fm, deps: q.deps, body: q.body }];
  });
  const { prio, deps: depsGraph, duedate } = priorityGraph(entries);
  const { eff, baseline, effDue } = effectiveFromGraph(prio, depsGraph, duedate, now);

  const out: Ticket[] = [];
  for (const { p, st, hash, state, fm, deps, body } of entries) {
    // ponytail: birthtime이 없는 파일시스템은 0으로 온다 → mtime (tickets.py와 같은 폴백).
    const birth = st.birthtimeMs || st.mtimeMs;
    const persona = unquote(fm.persona ?? "");
    out.push({
      hash,
      stem: stemOf(p, config),
      hashResolves: findAny(ix, hash, config) === p,
      path: p,
      state,
      title: unquote(fm.title ?? ""),
      kind: unquote(fm.kind ?? ""),
      persona: PERSONA_RE.test(persona) ? persona : "",
      deps,
      unmet: deps.filter((h) => {
        const hit = findAny(ix, h, config);
        return !hit || !nfc(path.basename(hit)).endsWith(nfc(config.done + ".md"));
      }),
      assigned: !!unquote(fm.session_id ?? ""),
      // `.done`은 그래프에서 빠지므로(priorityGraph) 자기 값을 직접 읽는다 — dot이 모든 카드에
      // 자기 priority를 그리기 때문이다(§1-3 §보드). baseline·effective는 엔진이 안 계산하는
      // 값이라 원본과 같은 기본값(3)으로 둔다 — scan()도 열린 티켓 밖은 이 값을 안 쓴다.
      priority: prio.get(hash) ?? priorityOf(fm, hash),
      baseline: baseline.get(hash) ?? PRIORITY_DEFAULT,
      effective: eff.get(hash) ?? PRIORITY_DEFAULT,
      effectiveDue: effDue.get(hash) ?? null,
      fm,
      body,
      birth,
      mtime: st.mtimeMs,
    });
  }
  out.sort((a, b) => a.birth - b.birth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/** tickets.py scan() 정렬 — 열린 티켓만, `(-effective, birth, path)`(§1-3 §순서 ①②).
 *  `listTickets`의 기본 순서(birth 오름차순, 전체 상태)와는 다른 자리다: 그건 보드가 보여주는
 *  큐 순서고, 이건 CLI `select`/`list`가 실제로 디스패치하는 순서다 — 표현과 판정을 안 섞는다. */
export function queueOrder(tickets: Ticket[]): Ticket[] {
  return tickets
    .filter((t) => t.state === "open")
    .sort(
      (a, b) =>
        b.effective - a.effective ||
        a.birth - b.birth ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
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

/** 이 티켓이 아카이빙하는 대상 stem(§5-3 §표시 규약 ①). 스칼라 하나다 — 목록이 아니다.
 *
 *  **`req:`를 재사용하지 않는다**: pm이 쪼개기 중복을 `grep -l '^req: <stem>'`로 막는데
 *  요구사항이 아카이빙되면 그 grep이 아카이브 티켓을 물어 "이미 쪼갰다"로 읽힌다. */
export const archivesOf = (t: Ticket): string => unquote(t.fm.archives ?? "");

/** 이 티켓이 속한 에픽의 P번호(DESIGN.md §에픽 결정 1). 값은 문자열 그대로가 키다 —
 *  접두사를 벗기거나 정규화하지 않는다: `epic: P273`과 `epic: P273-2`는 다른 에픽으로 선다. */
export const epicOf = (t: Ticket): string => unquote(t.fm.epic ?? "");

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

/** 결정 11 §자리①의 선택지 하나 — `(a-1)`은 `(a)`를 고르면 열리는 하위 선택지다(⑤). */
export type Option = {
  letter: string; // "a" | "a-1" | "a-1-1"
  label: string;
  options: Option[];
};

/** 결정 11 §자리①의 문항 카드 하나 — `1-1.`은 `1.` 카드 안의 하위 문항이다(④). */
export type OptionGroup = {
  /** 카드 제목 — `###` 뒤 전문(번호 포함, 마커 없이) */
  heading: string;
  /** `composeAnswer`가 줄머리로 쓰는 번호 — `1.` `1-1.` `1-1-1.` */
  number: string;
  options: Option[];
  sub: OptionGroup[];
};

/** 문항 머리 — `### 1.` `### 1-1.` `### 1-1-1.`. 번호 없는 `###`(`### Q1.` 등)은 문항이
 *  아니다(결정 11 ①⑦) — 계층은 번호의 하이픈 깊이가 정하고 제목 레벨은 안 본다. */
const HEADING_RE = /^###\s+(\d+(?:-\d+)*)\.(?:\s|$)/;

/** 목록 항목 머리의 `(x)` 하나 — 목록 마커 필수, 산문 중간의 `(b)`는 안 잡는다(결정 11 ②).
 *  글자는 `(a)` `(a-1)` `(a-1-1)`(결정 11 ③). */
const OPTION_LINE = /^\s*(?:[-*]|\d+\.)\s+\**\(([a-z](?:-\d+)*)\)/;

/** 선택지 줄의 라벨 — 볼드 마커만 걷는다. 첫 문장 자르기와 60자 상한 둘 다 없다(결정 11 ⑧) —
 *  한 줄 고정은 이미 CSS `truncate` + `title`이 하므로 JS가 또 자르면 두 번 자르는 것이고
 *  `title`의 전문까지 잘린다. */
function optionLabel(rest: string): string {
  return rest.replace(/\*\*/g, "").trim();
}

/** "1" → 1, "1-1" → 2, "a-1-1" → 3 — 하이픈 개수 + 1이 계층 깊이다(번호·글자 공용). */
const depthOf = (token: string) => token.split("-").length;

/** 마지막 질문 절의 문항 계층(결정 11 ①③④⑤) — 출처는 `questionsOf`가 데려간 절 중 마지막
 *  라운드고, 이 함수는 넘겨받은 텍스트 하나만 본다(라운드를 고르는 건 호출부의 일).
 *
 *  문항은 `###`+번호로만 열린다 — 옛 그룹 폴백이 없어서(⑦), 번호 없는 `###`나 헤딩이 아예
 *  없는 구간의 선택지 줄은 어디에도 못 붙어 버려진다. 선택지가 없는 절은 빈 배열이다
 *  (58/100 — 결정 10 ⑨ 그대로, 그 갈래는 화면이 안 바뀐다). */
export function optionsOf(question: string): OptionGroup[] {
  const groups: OptionGroup[] = [];
  const groupPath: OptionGroup[] = []; // path[depth-1] = 그 깊이의 지금 문항
  let cur: OptionGroup | null = null;
  const optPath: Option[] = []; // cur 안에서 선택지 깊이별 지금 노드

  for (const line of question.split("\n")) {
    const h = line.match(HEADING_RE);
    if (h) {
      const number = h[1];
      const depth = depthOf(number);
      if (depth > 1 && !groupPath[depth - 2]) {
        cur = null; // 부모 문항이 없는 하위 문항 — 형식 위반이라 버린다
        continue;
      }
      const group: OptionGroup = {
        heading: line.replace(/^###\s+/, "").trim(),
        number: `${number}.`,
        options: [],
        sub: [],
      };
      if (depth === 1) groups.push(group);
      else groupPath[depth - 2].sub.push(group);
      groupPath[depth - 1] = group;
      groupPath.length = depth;
      cur = group;
      optPath.length = 0;
      continue;
    }
    const m = line.match(OPTION_LINE);
    if (!m || !cur) continue;
    const letter = m[1];
    const depth = depthOf(letter);
    if (depth > 1 && !optPath[depth - 2]) continue; // 부모 선택지가 없는 하위 선택지 — 버린다
    const option: Option = { letter, label: optionLabel(line.slice(m[0].length)), options: [] };
    if (depth === 1) cur.options.push(option);
    else optPath[depth - 2].options.push(option);
    optPath[depth - 1] = option;
    optPath.length = depth;
  }
  return groups;
}

// `composeAnswer`는 `lib/urls.ts`에 산다 — 그 파일이 이미 "클라이언트·서버가 같은 규칙을
// 써야 하는 순수 함수" 자리다(AGENTS.md — node:*가 없는 파일). `AnswerForm`(클라이언트)이
// 체크박스마다 이 함수를 직접 부른다. 재수출로 자리는 여기 하나로 보인다.
export { composeAnswer, type AnswerPick } from "./urls.ts";

/** §2-11①의 네 상태. `TicketState`(open/wip/done)와 같은 영문 관용구다. */
export type PlanState = "todo" | "doing" | "done" | "cancelled";

/** `## 진행 계획` 절의 체크박스 줄 하나(§2-11①). `start`·`end`는 줄에 적힌 대로의 ISO 8601 +
 *  오프셋 문자열이다 — 안 적힌 시각은 화면이 지어내지 않고 `null`로 둔다. */
export type PlanItem = {
  text: string; // 문장. 취소면 `~~`를 걷어낸 값
  state: PlanState;
  start: string | null;
  end: string | null;
};

const PLAN_LINE = /^-\s*\[([ x])\]\s*(.*)$/;
// 줄 끝의 `(<시작>)` 또는 `(<시작> -> <끝>)` — frontmatter `assigned_at`과 같은 ISO 8601 + 오프셋(§2-11①)
const PLAN_TIME =
  /\s*\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))(?:\s*->\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})))?\)\s*$/;

/** 티켓 본문의 `## 진행 계획` 절 → 계획 목록(§2-11①). 체크박스 줄이 아닌 줄은 건너뛴다 —
 *  형식이 어긋난 줄에 상태를 지어내지 않는다.
 *
 *  판정 순서 — **취소**(문장이 `~~`로 감싸였다) → **완료**(상자가 켜졌다) → **진행중**(시작이
 *  있다) → **미착수**. `questionsOf`와 한 파일·같은 루프 모양이다. */
export function planOf(body: string): PlanItem[] {
  const items: PlanItem[] = [];
  let inSection = false;
  for (const line of body.split("\n")) {
    if (/^#{1,2}\s/.test(line)) {
      inSection = /^##\s*진행\s*계획/.test(line);
      continue;
    }
    if (!inSection) continue;
    const m = line.match(PLAN_LINE);
    if (!m) continue;
    const checked = m[1] === "x";
    let rest = m[2];
    let start: string | null = null;
    let end: string | null = null;
    const t = rest.match(PLAN_TIME);
    if (t) {
      start = t[1];
      end = t[2] ?? null;
      rest = rest.slice(0, t.index).trimEnd();
    }
    const strike = rest.match(/^~~(.*)~~$/);
    const state: PlanState = strike ? "cancelled" : checked ? "done" : start ? "doing" : "todo";
    items.push({ text: (strike ? strike[1] : rest).trim(), state, start, end });
  }
  return items;
}

/** `questionsOf`가 데려간 절과 `## 진행 계획`(§2-11⑤)을 뺀 본문 — **읽기 전용 렌더(`<Markdown>`)만**
 *  이걸 쓴다(§2 왕복). 질문은 스레드가, 계획은 진행 기록이 유일한 출처가 되는 자리고, 같은 절이
 *  본문에 두 벌 뜨지 않게 하는 자리다.
 *
 *  편집 폼·검색·복사·이어받기는 **원문 전문**이다 — 폼에서 빼면 저장이 파일에서 절을 지운다.
 *  판정을 `questionsOf`와 한 파일·같은 루프 모양으로 두는 이유: 정규식이 두 벌이 되면 스레드에
 *  뜬 질문이 본문에는 남는 티켓이 생긴다. */
export function bodyWithoutQuestions(body: string): string {
  const out: string[] = [];
  let dropping = false;
  for (const line of body.split("\n")) {
    const heading = /^#{1,2}\s/.test(line);
    if (heading) dropping = /^##\s*(질문|진행\s*계획)/.test(line);
    if (dropping) {
      // 절 제목 앞에 있던 빈 줄까지 걷어낸다 — 안 하면 지운 자리에 빈 줄이 겹쳐 남는다
      if (heading) while (out.length && out[out.length - 1].trim() === "") out.pop();
      continue;
    }
    // 걷어낸 뒤 다시 시작하는 절과 앞 절을 붙여놓지 않는다(이미 빈 줄이면 늘리지 않는다)
    if (heading && out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(line);
  }
  return out.join("\n").trim();
}

/** 스레드 한 칸. 질문은 요구사항 본문의 절이고 답변은 `kind: answer` 티켓이다. */
export type ThreadItem = {
  role: "question" | "answer";
  heading: string;
  text: string;
  /** 답변 티켓의 stem. 질문은 없다(요구사항 본문의 일부다) */
  hash?: string;
  /** 답변 파일의 `birth`(ms) — **진행 기록의 시각이다**(§2-3 ②. `mergeProgress`가 쓴다).
   *  질문은 없다: 자기 파일이 없어서 시각이 없고, 짝인 답변 바로 앞에 붙는 것이 그 시각을 대신한다. */
  birth?: number;
};

/** 요구사항 왕복 스레드 — 본문의 `## 질문 n` 절과 `deps` 중 `kind: answer`인 티켓을 번갈아.
 *  답변은 birth 순이다(라운드 순서고, `deps`에 적힌 순서는 PM이 append한 순서일 뿐이다).
 *
 *  **상세(§2 답변 카드)와 보드 카드의 답변 다이얼로그(§1)가 같은 함수를 쓴다** — 두 곳에서 따로
 *  엮으면 같은 요구사항이 화면마다 다른 스레드로 보인다. 그래서 **순서·짝 규칙은 안 바꾼다**:
 *  §2-3이 더한 것은 답변의 `birth`를 실어 보내는 것 하나고, 그 값으로 진행 기록이 스트림 사건과
 *  같은 줄기에 섞인다(`mergeProgress`). 다이얼로그는 그 필드를 안 본다. */
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
        birth: answers[i].birth,
      });
    }
  }
  return thread;
}

/** `AnswerForm`이 그릴 선택 카드 — 스레드의 **마지막 질문 라운드**에서만 `optionsOf`를 돈다
 *  (결정 10 ①). 클라이언트 컴포넌트는 `node:fs`를 타는 이 파일을 값으로 못 부르므로
 *  (§`ThreadItem`과 같은 이유) 서버가 `threadOf` 옆에서 미리 계산해 내려보낸다. */
export function lastQuestionOptions(thread: ThreadItem[]): OptionGroup[] {
  const lastQuestion = [...thread].reverse().find((item) => item.role === "question");
  return lastQuestion ? optionsOf(lastQuestion.text) : [];
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
  /** 에픽 필터(DESIGN.md §에픽 결정 5) — **단일값**이다(다른 셋과 달리 배지가 아니라 사이드바
   *  한 줄 선택이라 OR로 쌓을 자리가 없다). `null`이면 파라미터가 아예 없는 것(필터 없음),
   *  `""`이면 `?epic=`(값이 빈 것 — `epicOf`가 없는 티켓에 주는 그 값과 같다. §결정 1
   *  `(에픽 없음)`은 GUI가 붙이는 라벨이지 값이 아니다)이다. */
  epic: string | null;
};

/** `kind: answer`는 **기본 목록에서 뺀다**(§1 보드). 답변은 수행할 티켓이 아니라 요구사항 상세에서
 *  읽는 기록이고 CLI `list`에도 뜨지 않는다(`.done`으로 태어난다) — 여기서 빼는 게 패리티다.
 *  kind 필터에서 `answer`를 고르면 보인다. 숨기는 게 아니라 기본에서 빼는 것이다.
 *
 *  **`archives:`를 든 티켓도 같은 자리에서 빠진다**(§5-3 §표시 규약 ②) — 카드 대신 대상 카드
 *  하단 한 줄로 서므로 독립 카드가 없다. 꺼내는 길은 **persona 필터**다(`answer`를 kind 필터로
 *  꺼내는 것과 같은 규칙). 판정을 `persona === "archive-manager"`로 쓰지 않는 이유가 ①에 있다 —
 *  페르소나를 개명하면 카드가 도로 뜬다. */
export const inDefaultList = (t: Ticket, kind: string[], persona: string[]) =>
  (t.kind !== "answer" || kind.includes("answer")) &&
  (!archivesOf(t) || persona.includes(t.persona));

export function filterTickets(tickets: Ticket[], query: BoardQuery): Ticket[] {
  const needle = norm(query.q.trim());
  return tickets.filter((t) => {
    if (!inDefaultList(t, query.kind, query.persona)) return false;
    if (query.kind.length && !query.kind.includes(t.kind)) return false;
    if (query.persona.length && !query.persona.includes(t.persona)) return false;
    if (query.epic !== null && epicOf(t) !== query.epic) return false;
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

/** 정렬 가능한 컬럼 = 테이블 컬럼 9개(§에픽 결정 7 — `epic` 컬럼이 스윔레인을 대신한다).
 *  URL의 `sort` 값은 이 목록으로 검증한다. */
export const SORT_KEYS = [
  "status",
  "hash",
  "title",
  "kind",
  "persona",
  "deps",
  "created",
  "owner",
  "epic",
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
      // 정규화 없음 — epicOf 그대로가 정렬 값이다(§에픽 결정 1). 값 없는 티켓은 빈 문자열이라
      // 오름차순에서 맨 앞이다 — 사이드바·스윔레인의 "(에픽 없음) 맨 아래"는 그 화면들만의
      // 표시 규칙이고 이 범용 컬럼 정렬은 나머지 컬럼과 같은 식이다.
      epic: epicOf(t),
    })[key];
  return [...tickets].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    // 한글 title·persona가 섞이므로 문자열은 localeCompare다(코드포인트 순은 사람이 못 읽는다).
    const c = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "ko");
    return desc ? -c : c;
  });
}

/** 테이블 기본 순서 = **생성일 내림차순**(§1 보드 §테이블 기본 순서. 요구 `1208e64a`).
 *  테이블을 여는 사람이 찾는 것은 디스패치 차례가 아니라 방금 무슨 일이 있었나다. */
export const TABLE_DEFAULT_SORT: SortKey = "created";

/** 테이블 렌더 직전에 한 번 — `sort`가 URL에 없을 때만 기본을 씌운다. `sortTickets`를 안 뒤집는
 *  이유: 칸반·건수·관계선이 같은 목록을 큐 순서로 쓴다(순서는 표현이지 상태가 아니다). URL에는
 *  아무것도 안 붙는다(§정본 URL) — 그래서 기본이 파라미터가 아니라 여기 있다. */
export function sortTableRows(tickets: Ticket[], key: SortKey | null, desc: boolean): Ticket[] {
  return key ? sortTickets(tickets, key, desc) : sortTickets(tickets, TABLE_DEFAULT_SORT, true);
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
/** stem → 티켓. **처음 나온 것이 이긴다** — 종전 `tickets.find`와 같은 판정이고 `stemIndex`가
 *  파일 목록에 하는 것과 같은 규칙이다(중복 stem은 먼저 나온 파일이 이긴다).
 *
 *  같은 배열·같은 접미사면 다시 안 만든다. `relationEdges`가 티켓마다 `deps` 전부 + `req:` 하나에
 *  `resolveDep`을 불러서 전체가 O(n²)였다(786건에서 96ms — 요구 `e6a179dc`). WeakMap이라
 *  `tickets`가 GC되면 같이 사라지고, `sortTickets`가 새 배열을 주므로(`[...tickets].sort`)
 *  캐시된 배열의 내용이 뒤에서 바뀌는 자리가 없다. */
const stemMaps = new WeakMap<Ticket[], Map<string, Map<string, Ticket>>>();

function stemMap(tickets: Ticket[], sfx: Suffixes): Map<string, Ticket> {
  let perSfx = stemMaps.get(tickets);
  if (!perSfx) stemMaps.set(tickets, (perSfx = new Map()));
  const key = `${sfx.done} ${sfx.inProgress}`;
  let m = perSfx.get(key);
  if (!m) {
    m = new Map();
    for (const t of tickets) {
      const s = stemOf(t.path, sfx);
      if (!m.has(s)) m.set(s, t);
    }
    perSfx.set(key, m);
  }
  return m;
}

export function resolveDep(tickets: Ticket[], dep: string, sfx: Suffixes): Ticket | null {
  const byStem = stemMap(tickets, sfx);
  const want = nfc(dep);
  return (
    byStem.get(want) ??
    (want.startsWith(nfc("re-")) ? null : (byStem.get(nfc("re-") + want) ?? null))
  );
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
 *  조회는 `stemMap`이라 전체가 deps 수에 선형이다. */
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

/** 이 티켓을 아카이빙하는 티켓 — `archives:`가 이 티켓을 가리키는 것들(§5-3 §표시 규약 ④).
 *  `derivedFrom`과 같은 모양·같은 `resolveDep`이다. 보통 하나지만 사람이 손으로 더 냈거나
 *  재발행된 경우가 있어 목록이다(보드 카드는 그중 하나만 그린다 — ③). */
export function archivedBy(tickets: Ticket[], target: Ticket, sfx: Suffixes): Ticket[] {
  return tickets.filter((t) => {
    const a = archivesOf(t);
    return !!a && t.path !== target.path && resolveDep(tickets, a, sfx) === target;
  });
}

/** 이 티켓이 정리하는 마커(§P230 §두 번 눌러도 한 장). `archivesOf`와 같은 선례 — GUI만 읽는
 *  커스텀 frontmatter 키라 엔진은 모르는 채 무해하다. */
export const fixesOf = (t: Ticket): string => unquote(t.fm.fixes ?? "");

/** `fixes: <marker>`이고 아직 `.done`이 아닌 티켓 — 마커당 하나만 도는지 판정한다.
 *  화면(카드 상태)과 액션(발행 직전 재확인)이 같은 걸 불러야 한다 — 갈리면 화면이 거짓말을 한다. */
export function openFixTicket(tickets: Ticket[], marker: string): Ticket | null {
  return tickets.find((t) => fixesOf(t) === marker && t.state !== "done") ?? null;
}

/** 온톨로지 스키마 위반 정리 티켓의 마커 값(§P230). 화면·액션이 같은 리터럴을 쓰게 하는 자리. */
export const ONTOLOGY_FIX_MARKER = "ontology-schema";

/** 온톨로지 마이그레이션 발행 티켓의 마커(§5-3). 프로젝트당 한 장 — `마이그레이션 시작`과
 *  첫 채움이 같은 값을 써서 같은 티켓을 가리킨다. */
export const ONTOLOGY_MIGRATION_MARKER = "ontology-migration";

/** 온톨로지 import 발행 티켓의 마커(§5-3). 폴더당 한 장 — 다른 폴더는 서로를 안 막는다.
 *  화면(카드 판정)과 액션(발행 직전 재확인)이 같은 함수를 불러야 한다. */
export function ontologyImportMarker(folder: string): string {
  return `ontology-import:${folder}`;
}

/** 이 티켓이 미완으로 끝나며 남긴 이어받기 티켓 stem(§P294 §미완으로 끝나는 세션 결정 3).
 *  `archivesOf`와 같은 선례 — 값은 stem 하나이고 목록이 아니다, GUI만 읽는 커스텀 frontmatter
 *  키라 엔진은 모르는 채 무해하다. 대상 티켓 조회는 호출부가 `resolveDep`으로 한다. */
export const continuedOf = (t: Ticket): string => unquote(t.fm.continued ?? "");

/** 칸반 호버 관계선의 간선 (DESIGN.md §1 보드 · §비주얼 §17). 상세 §2 관계 절이 그리는 것과
 *  **같은 간선**이다: `deps`(선행 · 후행 역참조) + `req:`(요구사항 ↔ 나온 티켓).
 *  met/unmet으로 거르지 않는다 — 상세가 안 거르는 것과 같은 이유고 개별 상태는 배지가 말한다.
 *
 *  **fs를 1건도 더 읽지 않는다**: 보드가 이미 읽은 `tickets`와 `depBadges`·`derivedFrom`이
 *  쓰는 `resolveDep`·`reqOf` 그대로다. 선에는 방향이 없으므로 **양쪽에 넣는다** — 호버된
 *  stem 하나로 상대를 찾는 것이 클라이언트가 하는 전부다.
 *
 *  `shown`(지금 화면이 그리는 stem) 밖은 애초에 안 싣는다. 카드가 DOM에 없어 그릴 수 없고,
 *  큐 전체를 실으면 5초마다 안 쓰는 간선을 브라우저로 밀어 넣는다. 완료 레인 20건 자르기와
 *  레인 세로 스크롤은 여기서 못 보므로 클라이언트가 DOM·rect로 마저 거른다(§1).
 *
 *  객체가 아니라 `Map`인 이유는 `personaDotClass`와 같다 — 키가 **파일명에서 오는 남의
 *  문자열**이라 `obj["__proto__"] ??= []`가 Object.prototype에 push하는 자리다.
 *
 *  `resolveDep`이 `stemMap`을 쓰므로 전체가 deps 수에 선형이다(`referrers`와 같은 자리). */
export type RelationEdge = { to: string; kind: "deps" | "req" };

export function relationEdges(
  tickets: Ticket[],
  sfx: Suffixes,
  shown: Set<string>,
): Map<string, RelationEdge[]> {
  const out = new Map<string, RelationEdge[]>();
  const link = (a: string, b: string, kind: RelationEdge["kind"]) => {
    if (a === b || !shown.has(a) || !shown.has(b)) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const list = out.get(x);
      if (list) list.push({ to: y, kind });
      else out.set(x, [{ to: y, kind }]);
    }
  };
  for (const t of tickets) {
    for (const d of t.deps) {
      const hit = resolveDep(tickets, d, sfx);
      if (hit) link(t.stem, hit.stem, "deps");
    }
    const req = reqOf(t);
    const hit = req ? resolveDep(tickets, req, sfx) : null;
    if (hit) link(t.stem, hit.stem, "req");
  }
  return out;
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────

/** 쓰기가 막히는 두 상태의 사유. **열린 티켓만 쓸 수 있다** — `.wip`은 세션이 그 파일로 일하고
 *  있고(제약 5), `.done`은 이 큐의 불변 기록이다. `[hash]/actions.ts`의 `saveTicket`과
 *  `epic.ts`의 `writeEpic`(§에픽 §결정 8 - 카드를 에픽에 끌어다 놓는 쓰기)이 같은 문장을 쓴다 -
 *  한쪽이 새 문장을 짓거나 두 벌로 갈리지 않게 여기 하나만 둔다. */
export const LOCKED: Record<"wip" | "done", string> = {
  wip: "진행중 티켓은 편집할 수 없습니다 — 세션이 그 파일로 일하고 있습니다.",
  done: "완료 티켓은 편집할 수 없습니다 — 완료는 이 큐의 불변 기록입니다.",
};

/** 티켓 파일 제자리 쓰기 — frontmatter 키 갱신 + 본문 교체. **읽고-고치고-쓰기**다.
 *
 *  frontmatter는 `tickets.py set_fm_keys`와 같은 규칙으로 손댄다: 있는 키는 그 줄을 바꾸고 없는
 *  키는 닫는 `---` 직전에 넣는다. 나머지 줄(session_id·owner·attempts·pid…)은 순서까지 그대로
 *  둔다 — 엔진이 쓰는 값이라 GUI가 다시 조립하면 잃는다.
 *
 *  `.wip` 여부는 **호출자가 막는다**(그 파일로 지금 세션이 일하고 있다 — 제약 5).
 *
 *  `body`는 `stripBodyEnds`가 뗀 모양(구분 빈 줄·끝 개행 없음)으로 받는다 — 그 둘은 여기서
 *  되씌운다(§2 §원문의 양끝, 짝 자리). */
export async function writeTicket(
  p: string,
  // `undefined` = 그 키의 줄을 통째로 지운다(§1-4 §값 — `duedate:`는 빈 값이 아니라 **줄
  // 자체가 없어야** "마감 없음"이다. 빈 값으로 두면 duedateOf가 WARN을 낸다). 없는 키를
  // undefined로 주면 아무 일도 안 한다(splice 대상이 없다).
  updates: Record<string, string | undefined>,
  body: string,
): Promise<void> {
  const text = await readFile(p, "utf8");
  const { lines, end } = readFm(text);
  if (end < 0) throw new Error(`frontmatter 없음: ${p}`);

  const fmLines = lines.slice(0, end + 1);
  for (const [key, raw] of Object.entries(updates)) {
    const i = fmLines.findIndex((l, n) => n > 0 && l.startsWith(key + ":"));
    if (raw === undefined) {
      if (i >= 0) fmLines.splice(i, 1);
      continue;
    }
    const val = raw.trim();
    const line = val ? `${key}: ${val}` : `${key}:`;
    if (i < 0) fmLines.splice(fmLines.length - 1, 0, line);
    else fmLines[i] = line;
  }
  const bodyLines = body === "" ? [] : body.split("\n");
  await writeFile(p, [...fmLines, "", ...bodyLines, ""].join("\n"), "utf8");
}
