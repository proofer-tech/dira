/** 소스 컨트롤 표면의 서버 쪽 git 호출 (DESIGN.md §11-3 결정 1-2-3). 커밋 - push - pull은
 *  P366-9의 몫이라 여기 없다.
 *
 *  **체크아웃 목록은 새로 파싱하지 않는다**(§11-3 결정 1) — 출처는 `lib/workers.ts`가 이미
 *  `prepareWorktree`에서 쓰는 `listWorktreeEntries`(`git worktree list --porcelain`)다. */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { listWorktreeEntries, nfc } from "./workers.ts";

const git = (cwd: string, args: string[]) =>
  promisify(execFile)("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 });

/** 체크아웃 하나 — 루트 또는 워크트리 하나(§11-3 결정 1 · §비주얼 §72 ⑤). `id`가 `"root"`이면
 *  루트다. 워크트리의 `id`는 디렉터리 이름(= 워커 이름, §4-2가 워크트리 하나에 워커 하나를
 *  묶었다)이고, 그 값이 사람이 읽는 화면에서도 그대로 쓰인다(§비주얼 §72 ⑤ §고른 체크아웃의
 *  표기는 한 벌이다). */
export type Checkout = { id: string; path: string; branch: string; isRoot: boolean };

/** `repo`(git 프로젝트 루트, `path.dirname(project.root)`)의 체크아웃 전부. **워크트리가
 *  0개인 프로젝트에서도 루트 하나는 언제나 있다**(§4-2 — `git worktree list`가 루트 하나만
 *  주는 배치가 정상이다). 실경로로 비교하는 것은 `prepareWorktree`와 같은 근거다(맥
 *  `/private` 별칭 — §4-2). */
export async function listCheckouts(repo: string): Promise<Checkout[]> {
  const entries = await listWorktreeEntries(repo);
  const repoKey = nfc(await realpath(repo).catch(() => repo));
  const out: Checkout[] = [];
  for (const e of entries) {
    const key = nfc(await realpath(e.worktree).catch(() => e.worktree));
    const isRoot = key === repoKey;
    out.push({
      id: isRoot ? "root" : path.basename(e.worktree),
      path: e.worktree,
      branch: e.branch?.replace(/^refs\/heads\//, "") ?? "",
      isRoot,
    });
  }
  return out;
}

/** 목록에서 `id`가 가리키는 체크아웃 하나를 다시 찾는다. **클라이언트가 경로를 직접 안 보낸다**
 *  — 서버 액션은 항상 이 함수로 `id`를 검증된 절대경로로 바꾼 뒤에만 그 경로에서 git을 부른다
 *  (신뢰 경계 — GUI가 받는 것은 체크아웃 id 하나뿐이다). */
export async function resolveCheckout(repo: string, id: string): Promise<Checkout | null> {
  const list = await listCheckouts(repo);
  return list.find((c) => c.id === id) ?? null;
}

/** 파일 한 줄의 상태(§비주얼 §72 ④). `word`가 `null`이면 아는 낱말이 없다는 뜻이고, 그때
 *  화면은 `code`를 `font-mono`로 그대로 보여준다 — 모르는 코드에 아는 낱말을 억지로 안 붙인다. */
export type StatusFile = { path: string; code: string; word: "modified" | "new" | "deleted" | "renamed" | null };

export type GitStatus = {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: StatusFile[];
  unstaged: StatusFile[];
};

function wordFor(code: string): StatusFile["word"] {
  if (code === "M") return "modified";
  if (code === "A" || code === "?") return "new";
  if (code === "D") return "deleted";
  if (code === "R" || code === "C") return "renamed";
  return null;
}

/** `git status --porcelain=v2 -b`를 줄 단위로 읽는다(§11-3 결정 2). 경로가 공백을 담을 수
 *  있어 고정폭 필드 뒤 `.*`로 나머지 전부를 문지 — 스페이스로 단순 `split`하면 그 경로에서
 *  깨진다. 이름 바뀐 줄(`2 …`)은 탭 뒤 옛 경로를 버린다 — 이 화면은 새 경로만 보여준다. */
export function parseStatus(output: string): GitStatus {
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const staged: StatusFile[] = [];
  const unstaged: StatusFile[] = [];
  for (const line of output.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith("1 ")) {
      const m = line.match(/^1 (\S+) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/);
      if (!m) continue;
      const [, xy, filePath] = m;
      if (xy[0] !== ".") staged.push({ path: filePath, code: xy[0], word: wordFor(xy[0]) });
      if (xy[1] !== ".") unstaged.push({ path: filePath, code: xy[1], word: wordFor(xy[1]) });
    } else if (line.startsWith("2 ")) {
      const m = line.match(/^2 (\S+) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/);
      if (!m) continue;
      const [, xy, rest] = m;
      const filePath = rest.split("\t")[0];
      if (xy[0] !== ".") staged.push({ path: filePath, code: xy[0], word: wordFor(xy[0]) });
      if (xy[1] !== ".") unstaged.push({ path: filePath, code: xy[1], word: wordFor(xy[1]) });
    } else if (line.startsWith("? ")) {
      unstaged.push({ path: line.slice(2), code: "?", word: "new" });
    } else if (line.startsWith("u ")) {
      // 충돌(§11 결정 5 — 머지 화면을 안 그린다). 코드를 아는 낱말로 안 옮긴다(§비주얼 §72 ④).
      const m = line.match(/^u (\S+) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/);
      if (!m) continue;
      const [, xy, filePath] = m;
      unstaged.push({ path: filePath, code: xy, word: null });
    }
    // `!` (무시된 파일)은 그리지 않는다.
  }
  return { branch, upstream, ahead, behind, staged, unstaged };
}

export async function readStatus(cwd: string): Promise<GitStatus> {
  const { stdout } = await git(cwd, ["status", "--porcelain=v2", "-b"]);
  return parseStatus(stdout);
}

/** 스테이지 - 해제 - 전부 스테이지(§11-3 결정 2). `--`가 경로를 옵션으로 안 읽는다. 트리
 *  밖을 가리키는 경로는 git 자신이 거절한다(`resolveCheckout`이 `cwd`를 이미 검증했다). */
export async function stageFile(cwd: string, filePath: string): Promise<void> {
  await git(cwd, ["add", "--", filePath]);
}

export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  await git(cwd, ["restore", "--staged", "--", filePath]);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
}

/** 업스트림 후보 목록(§11-3 결정 3). `origin/HEAD` 같은 symref는 뺀다 — 그건 사람이 고를
 *  추적 대상이 아니라 리모트의 기본 브랜치를 가리키는 별칭이다. 기본 출력(`-> ` 화살표가 붙는
 *  그 한 줄)으로 거른다 — `--format=%(refname:short)`는 그 줄을 `origin/HEAD`가 아니라
 *  `origin`으로 줄여서 `/HEAD` 접미사로는 못 거른다(실측). */
export async function listRemoteBranches(cwd: string): Promise<string[]> {
  const { stdout } = await git(cwd, ["branch", "-r"]);
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.includes("->"));
}

/** 업스트림을 바꾼다 — **`origin`의 URL도, 브랜치도 안 만든다**(§11-3 결정 3, 답 `4-1.(a)`).
 *  `branch`는 부르는 쪽이 `listRemoteBranches`가 낸 목록에서만 고른 값이어야 한다(서버가
 *  같은 목록으로 다시 확인한다 — 화면과 별개로 값이 실재하는 원격 추적 브랜치인지 본다). */
export async function setUpstream(cwd: string, branch: string): Promise<boolean> {
  const remotes = await listRemoteBranches(cwd);
  if (!remotes.includes(branch)) return false;
  await git(cwd, ["branch", `--set-upstream-to=${branch}`]);
  return true;
}
