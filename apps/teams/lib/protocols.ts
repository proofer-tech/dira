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
import { expandHome, resolveWithin } from "./paths.ts";
import { engineRepo } from "./scaffold.ts";

export type ProtocolEntry = {
  /** 기준 디렉터리 기준 상대경로. URL(`?file=`)에 실리는 값이자 모든 액션의 입력이다 */
  rel: string;
  name: string;
  /** 들여쓰기 단계. 트리 컴포넌트 대신 이 값으로 그린다 */
  depth: number;
  isDir: boolean;
  /** 최상위 `AGENTS.md`만 — 모든 세션 프롬프트에 인라인된다(tick.sh 155~168행). 길이가 곧 비용이다 */
  inlineChars?: number;
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
    agents.inlineChars = [...text].length; // 코드포인트 수. UTF-16 단위로 세면 이모지가 2로 잡힌다
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
    return { error: `코어 프로토콜을 읽지 못했습니다 — ${dir} (${err.code ?? err.message})` };
  }
  if (names.length === 0) return { error: `코어 프로토콜이 없습니다 — ${dir}` };

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

/** 편집기가 열 수 있는 것과 못 여는 것. `text`가 null이면 `reason`이 이유다. */
export type ProtocolFile = { rel: string; text: string | null; reason?: string };

/** ponytail: NUL 바이트가 있으면 바이너리(git과 같은 판정). 인코딩은 추측하지 않는다 —
 *  UTF-8이 아닌 텍스트가 실제로 나오면 그때 판정을 늘린다. */
const MAX_EDIT_BYTES = 1024 * 1024;

/** `.md`가 아닌 파일도 연다 — 트리에 보이는데 못 열면 그게 더 이상하다. 텍스트가 아닌 것만 막는다. */
export async function readTextFile(baseDir: string, rel: string): Promise<ProtocolFile> {
  const full = await resolveWithin(baseDir, rel);
  if ((await lstat(full)).isDirectory()) return { rel, text: null, reason: "디렉터리입니다." };
  const buf = await readFile(full);
  if (buf.length > MAX_EDIT_BYTES) {
    return { rel, text: null, reason: `${buf.length}바이트 — 1MB가 넘어 편집기로 열지 않습니다.` };
  }
  if (buf.includes(0)) {
    return { rel, text: null, reason: "텍스트 파일이 아닙니다(NUL 바이트) — 편집할 수 없습니다." };
  }
  return { rel, text: buf.toString("utf8") };
}

export async function saveFile(baseDir: string, rel: string, text: string): Promise<void> {
  const full = await resolveWithin(baseDir, rel);
  // 덮어쓰기 전에 대상을 확인한다. 없는 파일에 쓰는 건 저장이 아니라 생성이고(누가 지운
  // 파일에 편집기 내용을 되살리는 것), 디렉터리에 쓰면 EISDIR로 터진다.
  const st = await lstat(full).catch(() => null);
  if (!st) throw new Error(`파일이 없습니다(지워졌을 수 있습니다): ${rel}`);
  if (!st.isFile()) throw new Error(`일반 파일이 아닙니다: ${rel}`);
  await writeFile(full, text, "utf8");
}

/** 새 파일. 중간 디렉터리는 만든다(`sub/GUIDE.md`) — 기준 디렉터리 자체가 없는 큐도 있다. */
export async function createFile(baseDir: string, rel: string): Promise<string> {
  const want = rel.trim();
  if (!want) throw new Error("파일 이름을 입력하세요.");
  await mkdir(expandHome(baseDir), { recursive: true }); // 없으면 resolveWithin이 realpath에서 튕긴다
  const full = await resolveWithin(baseDir, want);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "", { flag: "wx" }); // O_EXCL. 있는 파일을 빈 파일로 덮지 않는다
  return path.relative(await realpath(expandHome(baseDir)), full);
}

export async function deleteFile(baseDir: string, rel: string): Promise<void> {
  const full = await resolveWithin(baseDir, rel);
  if ((await lstat(full)).isDirectory()) {
    throw new Error(`디렉터리는 이 화면에서 지우지 않습니다: ${rel}`);
  }
  await unlink(full);
}

/** 이름변경 겸 이동. `rename`은 대상이 있으면 **조용히 덮어쓴다** — link(EEXIST로 튕긴다) 후
 *  unlink로 원자적 배타 생성을 얻는다. 같은 디렉터리 안이라 하드링크가 항상 된다. */
export async function renameFile(baseDir: string, from: string, to: string): Promise<string> {
  const want = to.trim();
  if (!want) throw new Error("새 이름을 입력하세요.");
  const src = await resolveWithin(baseDir, from);
  const dst = await resolveWithin(baseDir, want);
  if ((await lstat(src)).isDirectory()) {
    throw new Error(`디렉터리는 이 화면에서 옮기지 않습니다: ${from}`);
  }
  if (src === dst) return path.relative(await realpath(expandHome(baseDir)), src);
  await mkdir(path.dirname(dst), { recursive: true });
  await link(src, dst);
  await unlink(src);
  return path.relative(await realpath(expandHome(baseDir)), dst);
}
