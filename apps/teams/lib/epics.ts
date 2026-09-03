/** 에픽 읽기 층 — 사이드바·스윔레인·에픽 화면이 같이 쓴다(제품 스펙 §에픽 결정 1·2·5).
 *
 *  에픽 목록의 정본은 큐(티켓 `epic:` 값)다 — 이 파일은 스펙 문서를 읽지 않는다(§검증 (4)).
 *  dira는 아무 프로젝트에나 붙는 GUI라 스펙 문서를 파싱하면 dira 전용 기능이 된다. */
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { collectRefs, bodyPreview, type EpicRefValue, type RefIndex, type TicketRefValue } from "./markdown-refs.ts";
import { resolveWithin } from "./paths.ts";
import { assigneeOf, epicOf, isAwaiting, statusOf, type Ticket, type TicketState } from "./queue.ts";
// 발췌 규칙(첫 줄, 선두 `# ` 제거)이 페르소나 메모리와 같은 값이다 — 두 벌을 안 둔다(§32 ③).
import { memoryExcerpt } from "./skills.ts";
// 워커 이름 파싱은 여기서 다시 안 짓는다 — 워커 화면·칸반 카드와 같은 규칙 하나(§에픽 결정 9).
import { workerOf } from "./workers.ts";

/** `epic:` 없는 티켓이 모이는 자리(결정 1·5). 값이 아니라 GUI가 붙이는 라벨이다. */
export const NO_EPIC = "(에픽 없음)";

export type EpicCounts = Record<TicketState, number>;
/** `workers` — 이 에픽의 `.wip`을 지금 물고 있는 워커 이름 집합(distinct·오름차순, §에픽 결정 9).
 *  `.done`의 `owner:`는 안 세고, `workerOf`가 `null`이면(형식 아님) 그 티켓도 안 센다. */
export type Epic = { epic: string; counts: EpicCounts; workers: string[] };

const sortEpics = (epics: Epic[]): Epic[] =>
  epics.sort((a, b) => (a.epic === NO_EPIC ? 1 : b.epic === NO_EPIC ? -1 : a.epic.localeCompare(b.epic)));

/** 큐 티켓을 `epic:` 값으로 묶는다. 정렬은 P번호 문자열, `(에픽 없음)`이 맨 뒤(결정 5).
 *  건수는 `queue.ts`의 기존 `state` 판정을 그대로 쓴다 — 새 상태 판정을 안 만든다.
 *  워커 집합도 **같은 루프**에서 같이 낸다 — 새 읽기·새 폴링·새 상태 0(§에픽 결정 9).
 *
 *  디렉터리는 안 본다 — 스윔레인(`?lane=epic`)이 이 함수를 쓴다. 티켓 0건 에픽에 빈 띠를 만들지
 *  않는 것이 결정 7·17의 계약이라, 여기서 `epics/`를 합치면 그 계약이 깨진다. 사이드바가 원하는
 *  "빈 에픽도 뜬다"는 아래 `listEpics`가 이 함수 위에 얹는다. */
export function epicsFromTickets(tickets: Ticket[]): Epic[] {
  const byEpic = new Map<string, EpicCounts>();
  const workersByEpic = new Map<string, Set<string>>();
  for (const t of tickets) {
    const key = epicOf(t) || NO_EPIC;
    const counts = byEpic.get(key) ?? { open: 0, wip: 0, done: 0 };
    counts[t.state]++;
    byEpic.set(key, counts);
    if (t.state === "wip") {
      const worker = workerOf(t.fm.owner ?? "");
      if (worker) {
        const set = workersByEpic.get(key) ?? new Set<string>();
        set.add(worker);
        workersByEpic.set(key, set);
      }
    }
  }
  return sortEpics(
    [...byEpic.entries()].map(([epic, counts]) => ({
      epic,
      counts,
      workers: [...(workersByEpic.get(epic) ?? [])].sort((a, b) => a.localeCompare(b)),
    })),
  );
}

/** 사이드바·에픽 화면이 쓰는 목록(§에픽 결정 17) — `epicsFromTickets` 위에 큐 `epics/` 한 단계를
 *  합집합으로 얹는다. 티켓 0건이라 `epicsFromTickets`에 안 잡히는 키(방금 만든 에픽)도 `counts`
 *  전부 0·`workers` 빈 목록으로 목록에 뜬다. 디렉터리가 아예 없으면(`epics/`) 빈 목록 — 정상,
 *  경고 없다(결정 2). */
export async function listEpics(root: string, tickets: Ticket[]): Promise<Epic[]> {
  const epics = epicsFromTickets(tickets);
  const known = new Set(epics.map((e) => e.epic));
  const ents = await readdir(path.join(root, "epics"), { withFileTypes: true }).catch(() => []);
  for (const e of ents) {
    if (e.isDirectory() && !known.has(e.name)) {
      epics.push({ epic: e.name, counts: { open: 0, wip: 0, done: 0 }, workers: [] });
    }
  }
  return sortEpics(epics);
}

/** 사이드바가 그리는 순서(§에픽 결정 22) — 1차 키는 **대기 또는 진행중 티켓이 하나라도 있는가**
 *  (`counts.open + counts.wip > 0`), 활성이 앞이다. 2차 키는 `listEpics`가 이미 낸 P번호 문자열
 *  오름차순이라 여기서 다시 정렬하지 않고 **안정 정렬에 기댄다**(`Array.prototype.sort`는
 *  ES2019부터 표준으로 안정적이다) — 스윔레인 띠(`epicsFromTickets`)·에픽 화면 첫 선택은
 *  이 함수를 안 거치는 그 P번호 순서 그대로다(§무수정). */
export function sortEpicsForSidebar(epics: Epic[]): Epic[] {
  const active = (e: Epic) => e.counts.open + e.counts.wip > 0;
  return [...epics].sort((a, b) => Number(active(b)) - Number(active(a)));
}

/** `epic` 값은 URL에서 온다 — `../`가 큐(`root`) 밖으로 못 나간다(§경로 방어).
 *  벗어나면 null(존재하지 않는 것과 같게 떨어진다 — 던지지 않는다: 이 값은 필터·표시용이지
 *  이 경로에 쓰기가 걸리지 않는다). */
async function epicDir(root: string, epic: string): Promise<string | null> {
  try {
    return await resolveWithin(root, path.join("epics", epic));
  } catch {
    return null;
  }
}

/** `<root>/epics/<epic>/README.md` 첫 줄(결정 5). 파일이 없으면 제목 없음(null) — 사이드바는
 *  P번호만 띄운다. 이건 결정 1이 막은 "이름 짓기"가 아니라 화면에 거는 라벨이다. */
export async function epicTitle(root: string, epic: string): Promise<string | null> {
  const dir = await epicDir(root, epic);
  if (!dir) return null;
  const text = await readFile(path.join(dir, "README.md"), "utf8").catch(() => null);
  if (text === null) return null;
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? null;
}

/** `README.md` 첫 줄 **뒤** 본문(§결정 6 §README) — 이 에픽이 무슨 작업인지 사람이 적어 두는
 *  자리. 제목 줄 자신은 안 실린다. 파일이 없으면 `epicTitle`과 같은 판정으로 null이다. */
export async function epicReadmeBody(root: string, epic: string): Promise<string | null> {
  const dir = await epicDir(root, epic);
  if (!dir) return null;
  const text = await readFile(path.join(dir, "README.md"), "utf8").catch(() => null);
  if (text === null) return null;
  const lines = text.split("\n");
  const titleIdx = lines.findIndex((l) => l.trim() !== "");
  if (titleIdx === -1) return "";
  return lines
    .slice(titleIdx + 1)
    .join("\n")
    .trim();
}

/** `epics/<epic>/README.md`의 절대경로 — 파일이 실재할 때만. 없으면 null이다: 그 자리에 열
 *  파일이 없는 것과 화면의 빈 상태(§결정 6 §README)가 같은 값을 써야 "OS 기본 앱으로 열기"
 *  버튼이 없는 파일을 가리키지 않는다. */
export async function epicReadmePath(root: string, epic: string): Promise<string | null> {
  const dir = await epicDir(root, epic);
  if (!dir) return null;
  const full = path.join(dir, "README.md");
  const exists = await stat(full)
    .then((st) => st.isFile())
    .catch(() => false);
  return exists ? full : null;
}

/** 사이드바 입구의 키 칸 제안값(§에픽 결정 17 §키 제안) — 목록의 키 중 `P<숫자>` 꼴의 최댓값 + 1.
 *  그 꼴이 하나도 없으면 빈 문자열 — 규칙이 아니라 제안값 하나다(값 검증-정규화는 안 한다). */
export function suggestEpicKey(epics: Epic[]): string {
  const nums = epics
    .map((e) => /^P(\d+)$/.exec(e.epic)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return nums.length === 0 ? "" : `P${Math.max(...nums) + 1}`;
}

/** 사이드바 입구가 부르는 쓰기(§에픽 결정 17) — `epics/<키>/README.md` 한 장, 첫 줄이 제목이고
 *  그 뒤는 비어 있다. `memory/`는 안 만든다. 판정은 여기 하나뿐이다(`lib/epic.ts`의
 *  `writeEpic`/`EpicWriteResult`와 같은 짝 — 화면은 `reason`으로 실패 문구만 고른다).
 *
 *  경로 방어는 `epicDir`을 그대로 쓴다 — 새 판정을 안 짓는다. 그 밖의 값(제목·키의 글자 자체)은
 *  검증·정규화하지 않는다 — 문자열 그대로가 키다(결정 1). */
export type CreateEpicResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "invalid" | "exists" | "other"; error: string };

export async function createEpic(
  root: string,
  key: string,
  title: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<CreateEpicResult> {
  const k = key.trim();
  if (!k) return { ok: false, reason: "empty", error: t(locale, "epicsLib.keyRequired") };
  if (!title.trim()) return { ok: false, reason: "empty", error: t(locale, "epicsLib.titleRequired") };
  if (/[\r\n]/.test(k)) return { ok: false, reason: "invalid", error: t(locale, "epicsLib.keyNoNewline") };
  const dir = await epicDir(root, k);
  if (!dir) return { ok: false, reason: "invalid", error: `${t(locale, "epicsLib.keyOutsideQueuePrefix")} ${k}` };
  try {
    await mkdir(dir, { recursive: true });
    // O_EXCL — 검사와 생성 사이가 항상 벌어진다(`lib/attachments.ts`의 `saveAttachment`와 같은
    // 이유). 이미 있으면 한 바이트도 안 건드리고 거절한다(수용조건 3).
    const fh = await open(path.join(dir, "README.md"), "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw e;
    });
    if (!fh) return { ok: false, reason: "exists", error: `${t(locale, "epicsLib.keyExistsPrefix")} ${k}` };
    try {
      await fh.writeFile(`${title.trim()}\n`);
    } finally {
      await fh.close();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "other", error: `${t(locale, "epicsLib.createFailedPrefix")} ${(e as Error).message}` };
  }
}

/** 에픽 화면의 편집 다이얼로그가 부르는 쓰기(§에픽 결정 19-2) — `createEpic`과 갈리는 자리는
 *  `wx`가 아니라 `writeFile`이다: 사람이 그 파일을 고치러 연 것이라 덮어쓴다. 디렉터리가 없으면
 *  만든다(P300 갈래) — `memory/`는 안 만든다. 판정은 `createEpic`과 같은 식이다(제목·내용이
 *  비면 거절, `reason: "empty"`) — 그 밖의 검증·정규화는 0.
 *
 *  꼴은 `epicTitle`/`epicReadmeBody`가 다시 읽어 같은 값이 나와야 한다(§함정 §왕복) — 제목 한 줄,
 *  빈 줄 하나, 내용, 끝 줄바꿈. */
export async function saveEpicReadme(
  root: string,
  epic: string,
  title: string,
  body: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<CreateEpicResult> {
  const trimmedTitle = title.trim();
  const b = body.trim();
  if (!trimmedTitle) return { ok: false, reason: "empty", error: t(locale, "epicsLib.titleRequired") };
  if (!b) return { ok: false, reason: "empty", error: t(locale, "epicsLib.bodyRequired") };
  const dir = await epicDir(root, epic);
  if (!dir) return { ok: false, reason: "invalid", error: `${t(locale, "epicsLib.keyOutsideQueuePrefix")} ${epic}` };
  try {
    await mkdir(dir, { recursive: true });
    const fh = await open(path.join(dir, "README.md"), "w");
    try {
      await fh.writeFile(`${trimmedTitle}\n\n${b}\n`);
    } finally {
      await fh.close();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "other", error: `${t(locale, "epicsLib.saveFailedPrefix")} ${(e as Error).message}` };
  }
}

export type EpicMemory = { file: string; excerpt: string; text: string };

/** 메모리 디렉터리 글롭 하나 — 읽기(`epicMemory`)와 삭제(`deleteEpicMemory`)가 같이 쓴다
 *  (`lib/skills.ts`의 `memoryFiles`와 같은 자리). 디렉터리가 없으면 빈 목록(정상 — 결정 2). */
async function memoryFiles(root: string, epic: string): Promise<{ dir: string; name: string }[]> {
  const epicRoot = await epicDir(root, epic);
  if (!epicRoot) return [];
  const dir = path.join(epicRoot, "memory");
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ dir, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `<root>/epics/<epic>/memory/*.md` 한 단계 글롭(결정 2) — 파일만, 이름 오름차순. 하위
 *  디렉터리는 안 읽는다. 디렉터리가 없으면 빈 목록이고 경고 없다(정상 — 결정 2). */
export async function epicMemory(root: string, epic: string): Promise<EpicMemory[]> {
  const files = await memoryFiles(root, epic);
  return Promise.all(
    files.map(async (f) => {
      const text = await readFile(path.join(f.dir, f.name), "utf8");
      return { file: f.name, excerpt: memoryExcerpt(text), text };
    }),
  );
}

/** 삭제. 클라이언트가 준 파일명은 이 디렉터리를 실제로 나열해 나온 목록 안에 있을 때만 지운다
 *  (§경로 방어 — `lib/skills.ts`의 `deletePersonaMemory`와 같은 규칙). NFC로 대조한다(같은 이유:
 *  macOS HFS+가 파일명을 NFD로 돌려주는 자리가 있다). */
export async function deleteEpicMemory(
  root: string,
  epic: string,
  file: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const files = await memoryFiles(root, epic);
  const target = files.find((f) => f.name.normalize("NFC") === file.normalize("NFC"));
  if (!target) throw new Error(`${t(locale, "epicsLib.memoryFileNotFoundPrefix")} ${file}`);
  await rm(path.join(target.dir, target.name));
}

/** `<Markdown>` 산문 속 해시-P번호 표식의 값을 채운다(§9 §화면이 해석해서 내려준다,
 *  요구 `cadd5e04`). **새 파일 읽기 0** — 티켓 값 넷은 `listTickets`가 이미 파싱해 둔 것을
 *  Map으로 조회할 뿐이다. 에픽 README만 새로 읽고, **그 글에 실제로 나온 에픽만 - 한 번**이다
 *  (`texts`를 훑어 나온 P번호 집합 크기만큼만 `epicTitle`·`epicReadmeBody`가 돈다).
 *
 *  `texts`를 배열로 받는 이유 — 티켓 상세 한 렌더에 본문·스레드·질문이 여러 조각이라, 조각마다
 *  따로 훑으면 겹치는 에픽의 README를 두 번 읽는다. 합쳐서 한 번 훑고 한 번 읽는다. */
export async function resolveMarkdownRefs(
  root: string,
  project: string,
  texts: string[],
  tickets: Ticket[],
  epics: Epic[],
): Promise<RefIndex> {
  const known = { tickets: new Set(tickets.map((t) => t.stem)), epics: new Set(epics.map((e) => e.epic)) };
  const hitTickets = new Set<string>();
  const hitEpics = new Set<string>();
  for (const text of texts) {
    const hit = collectRefs(text, known);
    for (const s of hit.tickets) hitTickets.add(s);
    for (const e of hit.epics) hitEpics.add(e);
  }
  return finalizeRefs(root, project, tickets, epics, hitTickets, hitEpics);
}

/** 이미 아는 stem·P번호 값을 큐의 **지금** 상태로 다시 뽑는다(§아키텍처 §이른 갱신이 붙는
 *  화면 §개정 4, 요구 `de0b759d`) — `resolveMarkdownRefs`와 갈리는 자리는 훑을 글이 없다는
 *  것뿐이다: 새 글에서 찾는 대신 **호출부가 이미 들고 있는 키 집합**을 그대로 재해석한다.
 *  로직은 한 벌(`finalizeRefs`)이라 두 함수가 서로 다른 값을 낼 수 없다. */
export async function refreshKnownRefs(
  root: string,
  project: string,
  tickets: Ticket[],
  epics: Epic[],
  knownTickets: readonly string[],
  knownEpics: readonly string[],
): Promise<RefIndex> {
  return finalizeRefs(root, project, tickets, epics, new Set(knownTickets), new Set(knownEpics));
}

async function finalizeRefs(
  root: string,
  project: string,
  tickets: Ticket[],
  epics: Epic[],
  hitTickets: Set<string>,
  hitEpics: Set<string>,
): Promise<RefIndex> {
  const byStem = new Map(tickets.map((t) => [t.stem, t]));
  const ticketsOut: Record<string, TicketRefValue> = {};
  for (const stem of hitTickets) {
    const ticket = byStem.get(stem);
    if (!ticket) continue;
    const awaiting = isAwaiting(ticket);
    ticketsOut[stem] = {
      stem,
      href: `/p/${project}/tickets/${encodeURIComponent(stem)}`,
      state: ticket.state,
      status: awaiting ? "awaiting" : statusOf(ticket),
      // §비주얼 §1 `daysSince`와 같은 식이다(`components/status-badge.tsx`) — 이 파일은
      // `components/`를 참조하지 않는 경계라(위 §머리말) 여기서 다시 쓴다.
      days: awaiting ? Math.floor((Date.now() - ticket.mtime) / 86_400_000) : undefined,
      title: ticket.title,
      bodyPreview: bodyPreview(ticket.body),
      assignee: assigneeOf(ticket),
    };
  }

  const byEpic = new Map(epics.map((e) => [e.epic, e]));
  const epicsOut: Record<string, EpicRefValue> = {};
  for (const epic of hitEpics) {
    epicsOut[epic] = {
      epic,
      href: `/p/${project}/epics/${encodeURIComponent(epic)}`,
      title: await epicTitle(root, epic),
      body: await epicReadmeBody(root, epic),
      counts: byEpic.get(epic)?.counts ?? { open: 0, wip: 0, done: 0 },
    };
  }

  return { tickets: ticketsOut, epics: epicsOut };
}
