/** 탐색기 · 편집기 코어 (DESIGN.md §11-2 결정 1 · 2 · 4).
 *
 *  뿌리는 항상 `projects.ts`의 `explorerRoot(project)`(= `dirname(project.root)`)다(§11 결정 3 —
 *  프로젝트 루트. `resolveConfig(project).cwd`는 워커마다 `TICKET_CWD`가 갈리면 그중 하나로
 *  바뀌는 값이라 안 쓴다).
 *  **경로 방어는 `lib/paths.ts`의 `resolveWithin` 하나다** — 새 검사를 안 만든다(신뢰 경계가
 *  둘이 되는 것을 결정 1이 막는다).
 *
 *  `.md`는 이 편집기가 열지 않는다(결정 2) — 티켓 · 페르소나 · 프로토콜 디렉터리 밑이면
 *  `redirectTarget`이 그 화면 URL을 주고, 화면은 `router.push`로 넘어간다. 같은 파일을 두
 *  편집기로 여는 자리를 만들지 않는다는 계약이 여기 한 함수에 있다. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { resolveWithin } from "./paths.ts";

/** `resolveWithin`이 돌려주는 값은 항상 realpath를 지난다(§경로 방어) — 티켓 · 페르소나 ·
 *  프로토콜 디렉터리를 그 값과 문자열로 비교하려면 이 셋도 같은 realpath를 지나야 한다.
 *  안 지나면 macOS의 `/tmp` → `/private/tmp` 같은 심링크 한 겹 차이로 "밑에 있다" 판정이
 *  통째로 거짓이 된다(`explorer.test.ts`가 이 자리를 잡는다). 없는 디렉터리는 원문 그대로
 *  돌려준다 — 어차피 `isUnder`가 그 문자열과 실제 안 만난다. */
async function real(dir: string): Promise<string> {
  return await realpath(dir).catch(() => dir);
}

export type ExplorerEntry = { name: string; isDir: boolean };
export type ExplorerListing =
  | { ok: true; entries: ExplorerEntry[]; total: number; capped: boolean }
  | { ok: false; reason: string };

/** §11-2 결정 1 — 디렉터리 하나의 읽기 상한. */
const LIST_CAP = 2000;

/** §11 결정 3 — 실경로가 이미 조상에 있는 노드는 안 펼친다. 펼치는 이 한 단계에서만 조상을
 *  훑는다(lazy 로딩이라 트리 전체를 미리 realpath하지 않는다). */
async function isCycle(baseDir: string, rel: string, locale: Locale): Promise<boolean> {
  const target = await resolveWithin(baseDir, rel, locale);
  // 뿌리 자신도 조상이다 — `rel`의 부분경로에는 안 실리므로 따로 잰다(`abc/loop`가 뿌리로
  // 되돌아가는 심링크면 아래 for는 못 잡는다).
  if (target === (await resolveWithin(baseDir, "", locale))) return true;
  const parts = rel.split("/").filter(Boolean);
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    const ancestorReal = await resolveWithin(baseDir, acc, locale);
    if (ancestorReal === target) return true;
  }
  return false;
}

/** 디렉터리 한 단계(§11-2 결정 1). 숨은 파일 토글은 화면이 이 목록을 걸러서 낸다 — 서버 왕복을
 *  하나 더 만들지 않는다(디렉터리 하나의 항목 수는 상한 2,000이라 다시 거를 값이 이미 다 왔다). */
export async function listExplorerDir(
  baseDir: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ExplorerListing> {
  try {
    if (rel && (await isCycle(baseDir, rel, locale))) {
      return { ok: false, reason: t(locale, "explorer.cycleReason") };
    }
    const full = await resolveWithin(baseDir, rel, locale);
    const dirents = await readdir(full, { withFileTypes: true });
    const entries: ExplorerEntry[] = [];
    for (const d of dirents) {
      let isDir = d.isDirectory();
      // 심링크는 readdir이 안 따라가므로(lstat 정보) 따로 stat한다 — `.dira`가 그 경우다.
      if (!isDir && d.isSymbolicLink()) {
        isDir = await stat(path.join(full, d.name))
          .then((s) => s.isDirectory())
          .catch(() => false);
      }
      entries.push({ name: d.name, isDir });
    }
    entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    const total = entries.length;
    return { ok: true, entries: entries.slice(0, LIST_CAP), total, capped: total > LIST_CAP };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** `full`(이미 `resolveWithin`을 지난 실경로)이 `dir` 밑인가 — 셋(티켓 · 페르소나 · 프로토콜)이
 *  같은 판정을 쓴다. `dir`가 없거나 못 읽는 프로젝트는 호출자가 빈 문자열을 준다(빈 문자열은
 *  아무 것도 못 담아 항상 거짓이다). */
function isUnder(dir: string, full: string): boolean {
  return dir !== "" && (full === dir || full.startsWith(dir + path.sep));
}

/** §11-2 결정 2 — `.md`가 티켓 · 페르소나 · 프로토콜 디렉터리 밑이면 지금 마크다운 편집기
 *  화면으로 보낸다. 셋 다 아니면 null(이 편집기가 연다). */
export function redirectTarget(
  full: string,
  projectId: string,
  ticketsDir: string,
  personasDir: string,
  protocolsDir: string,
): string | null {
  if (isUnder(ticketsDir, full) && full.endsWith(".md")) {
    const hash = path.basename(full, ".md").replace(/\.(wip|done)$/, "");
    return `/p/${projectId}/tickets/${encodeURIComponent(hash)}`;
  }
  if (isUnder(personasDir, full)) {
    const name = path.relative(personasDir, full).split(path.sep)[0];
    if (name && name !== "..") return `/p/${projectId}/personas/${encodeURIComponent(name)}`;
  }
  if (isUnder(protocolsDir, full) && full.endsWith(".md")) {
    return `/p/${projectId}/protocols?file=${encodeURIComponent(path.relative(protocolsDir, full))}`;
  }
  return null;
}

/** ponytail: NUL 바이트가 있으면 바이너리(git · `lib/protocols.ts readTextFile`과 같은 판정). */
const MAX_EDIT_BYTES = 1024 * 1024; // §11-2 결정 2 — 1MB 초과는 안 연다

export type ExplorerFile =
  | { kind: "redirect"; to: string }
  | { kind: "unreadable"; reason: string }
  | { kind: "text"; text: string; mtimeMs: number; size: number };

export async function openExplorerFile(
  baseDir: string,
  rel: string,
  redirect: { projectId: string; ticketsDir: string; personasDir: string; protocolsDir: string },
  locale: Locale = DEFAULT_LOCALE,
): Promise<ExplorerFile> {
  let full: string;
  try {
    full = await resolveWithin(baseDir, rel, locale);
  } catch (e) {
    return { kind: "unreadable", reason: (e as Error).message };
  }
  const to = redirectTarget(
    full,
    redirect.projectId,
    await real(redirect.ticketsDir),
    await real(redirect.personasDir),
    await real(redirect.protocolsDir),
  );
  if (to) return { kind: "redirect", to };
  const st = await lstat(full).catch(() => null);
  if (!st || !st.isFile()) return { kind: "unreadable", reason: t(locale, "explorer.notAFile") };
  if (st.size > MAX_EDIT_BYTES) {
    return { kind: "unreadable", reason: `${st.size}${t(locale, "explorer.tooLargeSuffix")}` };
  }
  const buf = await readFile(full);
  if (buf.includes(0)) return { kind: "unreadable", reason: t(locale, "explorer.binary") };
  return { kind: "text", text: buf.toString("utf8"), mtimeMs: st.mtimeMs, size: st.size };
}

export type SaveResult = { ok: true; mtimeMs: number; size: number } | { ok: false; reason: string };

/** §11-2 결정 4 — 저장은 원자적이다(같은 디렉터리에 임시 파일을 쓰고 `rename`). 읽은 뒤 남이
 *  고친 파일은 안 덮는다: 연 시점의 `mtime`과 크기를 다시 재서 갈렸으면 거절한다.
 *
 *  `ticketsDir`는 방어 한 겹 더다 — `.md`는 전부 위 `redirectTarget`이 편집기 앞에서 이미
 *  가로채므로 이 자리에 `tickets/*.wip.md`가 실제로 오는 경로는 없다. 그래도 제약 5가
 *  <깨면 블록>이라 저장 쪽에도 같은 거절을 하나 더 둔다(누가 이 함수를 직접 불러도 안 뚫린다). */
export async function saveExplorerFile(
  baseDir: string,
  rel: string,
  text: string,
  expectedMtimeMs: number,
  expectedSize: number,
  ticketsDir: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<SaveResult> {
  try {
    const full = await resolveWithin(baseDir, rel, locale);
    if (isUnder(await real(ticketsDir), full) && /\.wip\.md$/.test(full)) {
      return { ok: false, reason: t(locale, "explorer.ticketWipReadonly") };
    }
    const st = await lstat(full).catch(() => null);
    if (!st || !st.isFile()) return { ok: false, reason: t(locale, "explorer.missing") };
    if (st.mtimeMs !== expectedMtimeMs || st.size !== expectedSize) {
      return { ok: false, reason: t(locale, "explorer.staleConflict") };
    }
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, full);
    const next = await stat(full);
    return { ok: true, mtimeMs: next.mtimeMs, size: next.size };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

// ── 찾기(§11-2 결정 3) ───────────────────────────────────────────────────
//
// 이름과 내용, 자리 둘이다. 워크트리 사본(`worktrees/<이름>` 디렉터리)은 두 찾기 다 기본으로
// 뺀다 — 같은 파일이 워커마다 여러 벌이라 결과가 8배로 뜬다.

const FIND_EXCLUDE_DIRS = new Set([".git", "node_modules", ".next"]);
const WORKTREES_DIR = "worktrees";

/** §결정 3 — 이름 찾기 상한. 뿌리 아래를 한 번 걸어 이 안에서 캐시한다. */
const NAME_WALK_CAP = 50_000;
/** ponytail: 프로세스 메모리 캐시 하나, TTL 30초. 파일 트리가 몇 분 안에 자주 안 바뀌는
 *  탐색기 용도라 무효화를 따로 안 만든다 — 더 정확해야 하면 저장 액션에서 캐시를 지운다. */
const NAME_WALK_TTL_MS = 30_000;

type NameWalk = { at: number; files: string[]; capped: boolean };
const nameWalkCache = new Map<string, NameWalk>();

async function walkNames(baseDir: string, includeWorktrees: boolean): Promise<NameWalk> {
  const key = `${baseDir}\0${includeWorktrees}`;
  const cached = nameWalkCache.get(key);
  if (cached && Date.now() - cached.at < NAME_WALK_TTL_MS) return cached;
  const files: string[] = [];
  let capped = false;
  async function walk(dir: string, rel: string) {
    if (capped) return;
    // 못 읽는 디렉터리는 조용히 뺀다(권한 등) — 찾기가 멎지 않는다.
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!dirents) return;
    for (const d of dirents) {
      if (files.length >= NAME_WALK_CAP) {
        capped = true;
        return;
      }
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (FIND_EXCLUDE_DIRS.has(d.name)) continue;
        if (!includeWorktrees && d.name === WORKTREES_DIR) continue;
        await walk(path.join(dir, d.name), childRel);
      } else if (d.isFile()) {
        files.push(childRel);
      }
    }
  }
  await walk(baseDir, "");
  const result: NameWalk = { at: Date.now(), files, capped };
  nameWalkCache.set(key, result);
  return result;
}

export type FindNameResult =
  | { ok: true; matches: string[]; capped: boolean }
  | { ok: false; reason: string };

/** §결정 3 — 이름 찾기. 파일명(경로 마지막 조각)이 `query`를 담으면 일치다(대소문자 안 가림). */
export async function findByName(
  baseDir: string,
  query: string,
  includeWorktrees: boolean,
): Promise<FindNameResult> {
  const q = query.trim().toLowerCase();
  if (!q) return { ok: true, matches: [], capped: false };
  try {
    const { files, capped } = await walkNames(baseDir, includeWorktrees);
    return { ok: true, matches: files.filter((f) => path.basename(f).toLowerCase().includes(q)), capped };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** §결정 3 — 내용 찾기 상한 · 타임아웃. */
const CONTENT_LINE_CAP = 200;
const CONTENT_TIMEOUT_MS = 10_000;

export type FindContentHit = { file: string; line: number; text: string };
export type FindContentResult =
  | { ok: true; hits: FindContentHit[]; truncated: boolean }
  | { ok: false; reason: string };

/** `grep -rn`이 내는 한 줄을 판정한다 — `path:line:text`(경로에 콜론이 든 드문 경우는 못
 *  가른다. ponytail: 이 화면이 찾는 것은 코드 경로라 실무에서 안 걸린다). */
const GREP_LINE = /^(.*?):(\d+):(.*)$/;

/** §결정 3 — 내용 찾기. `grep -rn --binary-files=without-match` 서브프로세스 하나이고,
 *  결과가 상한(200줄)에 닿거나 타임아웃(10초)에 걸리면 그 자리에서 죽이고 그때까지의 결과와
 *  `truncated: true`를 낸다 — 화면이 빈 채로 안 남는다. */
export async function findByContent(
  baseDir: string,
  query: string,
  includeWorktrees: boolean,
): Promise<FindContentResult> {
  if (!query.trim()) return { ok: true, hits: [], truncated: false };
  const args = ["-rn", "--binary-files=without-match"];
  for (const d of FIND_EXCLUDE_DIRS) args.push(`--exclude-dir=${d}`);
  if (!includeWorktrees) args.push(`--exclude-dir=${WORKTREES_DIR}`);
  args.push("-F", "--", query, ".");
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("grep", args, { cwd: baseDir });
    } catch (e) {
      resolve({ ok: false, reason: (e as Error).message });
      return;
    }
    const hits: FindContentHit[] = [];
    let truncated = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve({ ok: true, hits, truncated });
    };
    const timer = setTimeout(() => {
      truncated = true;
      finish();
    }, CONTENT_TIMEOUT_MS);
    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      if (settled) return;
      if (hits.length >= CONTENT_LINE_CAP) {
        truncated = true;
        finish();
        return;
      }
      const m = GREP_LINE.exec(line);
      if (m) hits.push({ file: m[1].replace(/^\.\//, ""), line: Number(m[2]), text: m[3] });
    });
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: (e as Error).message });
      }
    });
    child.on("close", () => finish());
  });
}
