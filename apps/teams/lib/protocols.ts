/** 프로토콜 파일트리 읽기·쓰기 (DESIGN.md §6).
 *
 *  **기준 디렉터리는 해석된 `TICKET_PROTOCOLS`다 — 프로젝트 root가 아니다.** 엔진이 이 값을
 *  워커에서 재정의할 수 있게 열어뒀고(README 용례: 여러 큐가 같은 규약을 쓰면 공유 경로로 준다),
 *  그러면 프로토콜 디렉터리는 루트 밖에 있다. root를 기준으로 접두를 확인하면 정상 설치가
 *  전부 거부되거나 — 더 나쁘게 — 루트 안이라는 잘못된 가정으로 경로를 조립하게 된다.
 *  기준을 인자로 받는 이유가 이것이고, 호출자는 `resolveConfig(project).protocols`를 넘긴다.
 *
 *  `lib/workers.ts` ↔ `workers/actions.ts`와 같은 분담이다: fs 로직은 여기, `revalidatePath`와
 *  프로젝트 해석은 얇은 서버 액션. 경로 방어를 Next 없이 `node --test`로 못박기 위해서이기도 하다. */
import { link, lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { byteLength } from "./budgets.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { expandHome, resolveWithin } from "./paths.ts";
import { engineRepo } from "./scaffold.ts";

export type ProtocolEntry = {
  /** 기준 디렉터리 기준 상대경로. URL(`?file=`)에 실리는 값이자 모든 액션의 입력이다 */
  rel: string;
  name: string;
  /** 들여쓰기 단계. 트리 컴포넌트 대신 이 값으로 그린다 */
  depth: number;
  isDir: boolean;
  /** 최상위 `AGENTS.md`만 — 모든 세션 프롬프트에 인라인된다(tick.sh 155~168행). UTF-8 바이트 수
   *  다 — `wc -c`와 같은 값이라야 예산과 비교된다(§프롬프트 층 결정 11) */
  inlineBytes?: number;
};

/** 트리. 심링크된 디렉터리는 따라 들어가지 않는다(readdir recursive의 기본 동작) — 루프도 막고
 *  기준 밖 내용이 목록에 새지도 않는다. 디렉터리가 아예 없으면 빈 배열이다(에러가 아니다:
 *  프로토콜 없이 도는 큐가 정상이고, tick.sh도 없으면 그냥 넘어간다). */
export async function listTree(baseDir: string): Promise<ProtocolEntry[]> {
  const base = expandHome(baseDir);
  let dirents;
  try {
    dirents = await readdir(base, { recursive: true, withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const entries: ProtocolEntry[] = dirents
    // vendored 큐(결정 8)의 `CORE*.md`는 §6 코어 항목(readCore)이 이미 보여준다 — 편집 가능
    // 목록에 또 넣으면 다음 미러링(결정 8-c)이 소리 없이 되돌리는 편집기가 된다(결정 8-d).
    // 최상위(depth 0)만 거른다 — 이 이름은 층 표시로 예약이라(결정 6) 하위 디렉터리에서까지
    // 뺄 근거는 없다.
    .filter((d) => !(d.parentPath === base && d.isFile() && isCoreLayerName(d.name)))
    .map((d) => {
      const rel = path.relative(base, path.join(d.parentPath, d.name));
      return { rel, name: d.name, depth: rel.split(path.sep).length - 1, isDir: d.isDirectory() };
    });
  entries.sort(byTreeOrder);

  // 중첩된 AGENTS.md는 인라인되지 않는다 — tick.sh가 읽는 건 `<protocols>/AGENTS.md` 하나뿐이고,
  // 나머지는 "AGENTS.md 안에서 가리키면 세션이 필요할 때 직접 읽는" 문서다.
  const agents = entries.find((e) => e.rel === "AGENTS.md" && !e.isDir);
  if (agents) {
    const text = await readFile(path.join(base, "AGENTS.md"), "utf8").catch(() => "");
    agents.inlineBytes = byteLength(text);
  }
  return entries;
}

/** 경로 조각별 비교 — 자식이 부모 디렉터리 바로 뒤에 오게 한다.
 *  문자열로 그냥 비교하면 `a.md`(0x2E)가 `a/b`(0x2F)보다 앞서서 트리가 흩어진다. */
function byTreeOrder(a: ProtocolEntry, b: ProtocolEntry): number {
  const A = a.rel.split(path.sep);
  const B = b.rel.split(path.sep);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] !== B[i]) return A[i].localeCompare(B[i]);
  }
  return A.length - B.length;
}

export type NestedEntry = ProtocolEntry & { children: NestedEntry[]; open: boolean };

/** 평면 `ProtocolEntry[]` → 중첩 + 조상 열림 판정 (DESIGN.md §6 §트리 안의 디렉터리 줄이
 *  접힌다). `entries`는 `listTree`가 낸 순서(부모 바로 뒤에 자식) 그대로 들어와야 한다 — 깊이만
 *  보고 스택을 쌓으므로 정렬이 깨지면 트리도 깨진다. 기본값은 전부 접힘(`open: false`)이고,
 *  `selectedRel`의 조상 디렉터리만 `open: true`다. fs도 JSX도 안 타는 순수 함수라 `node --test`가
 *  직접 받는다. */
export function nestTree(entries: ProtocolEntry[], selectedRel?: string): NestedEntry[] {
  const openAncestors = new Set<string>();
  if (selectedRel) {
    const parts = selectedRel.split("/");
    for (let i = 1; i < parts.length; i++) openAncestors.add(parts.slice(0, i).join("/"));
  }

  const roots: NestedEntry[] = [];
  const dirStack: NestedEntry[] = []; // 깊이별 마지막으로 연 디렉터리 노드
  for (const e of entries) {
    const node: NestedEntry = { ...e, children: [], open: e.isDir && openAncestors.has(e.rel) };
    while (dirStack.length > e.depth) dirStack.pop();
    (dirStack.length > 0 ? dirStack[dirStack.length - 1].children : roots).push(node);
    if (e.isDir) dirStack.push(node);
  }
  return roots;
}

/** 코어 프로토콜 한 장. `name`이 화면의 선택 키다(`?core=`) — 경로를 URL에 싣지 않는다. */
export type CoreFile = { name: string; path: string; text: string };

/** 인라인되는 유일한 코어. 나머지 `CORE-*.md`는 세션이 필요할 때 읽는다(§프롬프트 층 결정 6). */
export const CORE_INLINED = "CORE.md";

/** `CORE` 접두는 층 표시로 예약이다(§프롬프트 층 결정 6·8-d) — vendored 큐의 프로젝트 파일
 *  (`AGENTS.md` 등)과 코어 사본을 같은 디렉터리에서 걸러낼 때, §6 편집 가능 트리에서 코어를
 *  뺄 때 둘 다 이 판정 하나를 쓴다. */
export function isCoreLayerName(name: string): boolean {
  return name === CORE_INLINED || (name.startsWith("CORE-") && name.endsWith(".md"));
}

/** 코어 프로토콜. 정본은 `<엔진 레포>/protocols/`고 엔진이 그중 `CORE.md`를 매 세션 프롬프트 맨
 *  앞에 인라인한다(`tick.sh:266`, DESIGN.md §프롬프트 층 결정 5·6). **vendored 큐**(= 큐
 *  `protocols/CORE.md`가 있는 큐, 결정 8)에서는 세션이 실제로 받는 사본이 큐 쪽이라 그걸 읽는다
 *  (결정 8-d) — 엔진의 `$TICKET_ROOT` 우선·폴백(결정 8-b)과 같은 판정을 화면에서도 낸다.
 *  나머지 `CORE-*.md`는 거기서 가리키면 세션이 직접 읽는다 — 화면에 안 보이면 사람이 세션
 *  행동을 추적할 자리가 없어진다. 그래서 이 모듈이 코어에 주는 것은 이 읽기 하나뿐이다 —
 *  저장·생성·삭제·이름변경은 전부 기준 디렉터리(= 큐 안)에서만 도는 함수라, 화면을 잠그는 것과
 *  별개로 **쓰는 경로 자체가 서버에 없다.**
 *
 *  글롭은 **한 단계만**이다(`tick.sh:235`의 메모리 글롭과 같은 깊이) — 하위 디렉터리는 안 따라간다.
 *  vendored 큐의 디렉터리는 `AGENTS.md`·`tickets.md`도 같이 담으므로 `isCoreLayerName`으로
 *  걸러 코어만 집는다(엔진 레포 쪽은 `CORE*.md`뿐이라 밑져도 본전이다).
 *  못 읽으면 던지지 않고 사유를 준다: 엔진 레포를 못 찾는 배치가 정상이고(엔진도 `[ -r ]`로
 *  넘어간다) 화면은 그 항목들만 빼고 종전대로 돌아야 한다.
 *
 *  @param queueProtocolsDir 이 큐의 해석된 `protocols` 디렉터리(§6 화면이 넘기는 기준 디렉터리) */
export async function readCore(
  queueProtocolsDir: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ files: CoreFile[]; vendored: boolean } | { error: string }> {
  const vendoredDir = expandHome(queueProtocolsDir);
  const vendored = await lstat(path.join(vendoredDir, CORE_INLINED))
    .then((st) => st.isFile())
    .catch(() => false);

  let dir: string;
  if (vendored) {
    dir = vendoredDir;
  } else {
    const repo = engineRepo();
    if ("error" in repo) return { error: repo.error };
    dir = path.join(repo.path, "protocols");
  }

  let names: string[];
  try {
    // 디렉터리 엔트리로 거른다 — `foo.md`라는 이름의 디렉터리가 있으면 readFile이 EISDIR로 터진다
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && isCoreLayerName(d.name))
      .map((d) => d.name);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return {
      error: `${t(locale, "protocols.lib.coreReadFailPrefix")} ${dir} (${err.code ?? err.message})`,
    };
  }
  if (names.length === 0) {
    return { error: `${t(locale, "protocols.lib.coreEmptyPrefix")} ${dir}` };
  }

  names.sort((a, b) =>
    a === CORE_INLINED ? -1 : b === CORE_INLINED ? 1 : a.localeCompare(b),
  );
  const files: CoreFile[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    files.push({ name, path: full, text: await readFile(full, "utf8") });
  }
  return { files, vendored };
}

/** vendored 큐 판정 + 미러링(§프롬프트 층 결정 8-c). 큐 `protocols/`에 `CORE.md`가 **있으면**
 *  (= vendored 큐) 엔진 `protocols/`의 `CORE*.md` 집합에 내용을 그대로 맞춘다 — 다른 내용은
 *  덮고, 새 형제는 만들고, 엔진에 없어진 `CORE-*.md`는 지운다. **없으면 아무것도 안 쓴다** —
 *  그게 폴백 큐(이 큐 포함)를 손대지 않는 것의 구현이다. 서버 기동 시 전 등록 프로젝트에,
 *  프로젝트 등록 시 그 프로젝트에 돈다(기동 훅은 `instrumentation.ts`, 등록은 `addProject`).
 *
 *  **엔진 쪽은 `readCore()`가 아니라 여기서 직접 읽는다** — vendored 큐에서 `readCore()`는
 *  일부러 큐 사본을 되돌려주므로(§프롬프트 층 결정 8-d, `readCore` 머리 주석) 그걸로 목표
 *  집합을 구하면 큐가 자기 자신을 베끼는 순환이 된다. 목표는 항상 엔진 원본이다. */
export async function mirrorCore(queueProtocols: string): Promise<void> {
  const local = expandHome(queueProtocols);
  const existing = await readdir(local).catch(() => [] as string[]);
  if (!existing.includes(CORE_INLINED)) return;

  const repo = engineRepo();
  if ("error" in repo) return; // 엔진을 못 찾는 배치는 정상 운용이다(결정 3과 같은 완화) — 손대지 않는다
  const dir = path.join(repo.path, "protocols");
  const names = (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isFile() && isCoreLayerName(d.name))
    .map((d) => d.name);
  if (names.length === 0) return;

  const engineNames = new Set(names);
  for (const name of names) {
    const text = await readFile(path.join(dir, name), "utf8");
    await writeFile(path.join(local, name), text, "utf8");
  }
  for (const name of existing) {
    if (isCoreLayerName(name) && !engineNames.has(name)) {
      await unlink(path.join(local, name));
    }
  }
}

/** 편집기가 열 수 있는 것과 못 여는 것. `text`가 null이면 `reason`이 이유다.
 *  `mtimeMs`는 `text`가 실려 있을 때만 있다 — 저장 왕복(`saveFile`)이 그 값을 되돌려 받는다
 *  (§10 저장 충돌). */
export type ProtocolFile = { rel: string; text: string | null; reason?: string; mtimeMs?: number };

/** ponytail: NUL 바이트가 있으면 바이너리(git과 같은 판정). 인코딩은 추측하지 않는다 —
 *  UTF-8이 아닌 텍스트가 실제로 나오면 그때 판정을 늘린다. */
const MAX_EDIT_BYTES = 1024 * 1024;

/** `.md`가 아닌 파일도 연다 — 트리에 보이는데 못 열면 그게 더 이상하다. 텍스트가 아닌 것만 막는다. */
export async function readTextFile(
  baseDir: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ProtocolFile> {
  const full = await resolveWithin(baseDir, rel);
  const st = await lstat(full);
  if (st.isDirectory()) {
    return { rel, text: null, reason: t(locale, "protocols.lib.isDirectory") };
  }
  const buf = await readFile(full);
  if (buf.length > MAX_EDIT_BYTES) {
    return {
      rel,
      text: null,
      reason: `${buf.length}${t(locale, "protocols.lib.tooLargeSuffix")}`,
    };
  }
  if (buf.includes(0)) {
    return { rel, text: null, reason: t(locale, "protocols.lib.notText") };
  }
  return { rel, text: buf.toString("utf8"), mtimeMs: st.mtimeMs };
}

/** `expectedMtimeMs`는 화면이 파일을 읽었을 때 받은 `ProtocolFile.mtimeMs`다(§10 저장 충돌) —
 *  없으면(내부 호출, 예: 온톨로지 시드 직후 저장) 충돌 검사를 건너뛴다. 있으면 쓰기 직전에
 *  다시 잰 mtime이 그 값보다 새로울 때(=그 사이 다른 손이 고쳤을 때) 쓰지 않고 거절한다 —
 *  잠그지 않는다, 다시 읽게 할 뿐이다. */
export async function saveFile(
  baseDir: string,
  rel: string,
  text: string,
  expectedMtimeMs?: number,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const full = await resolveWithin(baseDir, rel);
  // 덮어쓰기 전에 대상을 확인한다. 없는 파일에 쓰는 건 저장이 아니라 생성이고(누가 지운
  // 파일에 편집기 내용을 되살리는 것), 디렉터리에 쓰면 EISDIR로 터진다.
  const st = await lstat(full).catch(() => null);
  if (!st) throw new Error(`${t(locale, "protocols.lib.missingPrefix")} ${rel}`);
  if (!st.isFile()) throw new Error(`${t(locale, "protocols.lib.notRegularPrefix")} ${rel}`);
  if (expectedMtimeMs !== undefined && st.mtimeMs > expectedMtimeMs) {
    throw new Error(t(locale, "protocols.lib.staleConflict"));
  }
  await writeFile(full, text, "utf8");
}

/** 새 파일. 중간 디렉터리는 만든다(`sub/GUIDE.md`) — 기준 디렉터리 자체가 없는 큐도 있다. */
export async function createFile(
  baseDir: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  const want = rel.trim();
  if (!want) throw new Error(t(locale, "protocols.lib.nameRequired"));
  await mkdir(expandHome(baseDir), { recursive: true }); // 없으면 resolveWithin이 realpath에서 튕긴다
  const full = await resolveWithin(baseDir, want);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "", { flag: "wx" }); // O_EXCL. 있는 파일을 빈 파일로 덮지 않는다
  return path.relative(await realpath(expandHome(baseDir)), full);
}

export async function deleteFile(
  baseDir: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const full = await resolveWithin(baseDir, rel);
  if ((await lstat(full)).isDirectory()) {
    throw new Error(`${t(locale, "protocols.lib.dirNoDeletePrefix")} ${rel}`);
  }
  await unlink(full);
}

/** 이름변경 겸 이동. `rename`은 대상이 있으면 **조용히 덮어쓴다** — link(EEXIST로 튕긴다) 후
 *  unlink로 원자적 배타 생성을 얻는다. 같은 디렉터리 안이라 하드링크가 항상 된다. */
export async function renameFile(
  baseDir: string,
  from: string,
  to: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  const want = to.trim();
  if (!want) throw new Error(t(locale, "protocols.lib.newNameRequired"));
  const src = await resolveWithin(baseDir, from);
  const dst = await resolveWithin(baseDir, want);
  if ((await lstat(src)).isDirectory()) {
    throw new Error(`${t(locale, "protocols.lib.dirNoMovePrefix")} ${from}`);
  }
  if (src === dst) return path.relative(await realpath(expandHome(baseDir)), src);
  await mkdir(path.dirname(dst), { recursive: true });
  await link(src, dst);
  await unlink(src);
  return path.relative(await realpath(expandHome(baseDir)), dst);
}
