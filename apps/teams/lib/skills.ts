/** 페르소나 사이드카 읽기·쓰기 — 스킬(§5-1) · 메모리(§5-2) · 동시 워커 상한(§5-4).
 *
 *  두 세계가 만나는 자리다: **이 머신에 설치된 스킬**(`<config>/skills/…` — 큐 밖·GUI 밖·머신
 *  로컬)과 **이 페르소나가 고른 스킬**(`<personas>/<이름>/skills.md` — 큐 안. 엔진이 디스패치
 *  때 읽어 프롬프트에 싣는다). 둘 다 fs를 읽는 파서라 화면(`1666fac4`)이 fs를 다시 만지지 않게
 *  여기 모은다.
 *
 *  **새 파일인 이유**(AGENTS.md "새 파일을 늘리지 않는다"): 붙일 자리가 `projects.ts`인데
 *  저기는 레지스트리·설정 해석·페르소나 CRUD로 이미 600줄이고, 여기 든 것 중 절반
 *  (`~/.claude` 훑기)은 **큐와 무관**하다 — 프로젝트를 인자로도 안 받는다. 티켓 `d608feb3`.
 *
 *  **메모리(`memory/*.md`)가 여기 있는 이유**는 스킬과 같은 물건이기 때문이다 — 같은 디렉터리의
 *  사이드카고, 같은 `personaFilePath`로 방어하고, 같은 화면이 같은 렌더에서 둘을 같이 읽는다.
 *  갈리는 것은 쓰는 쪽뿐이다(스킬은 GUI, 메모리는 세션 — §5-2). 티켓 `bb48630b`.
 *  **상한(`limit`)도 같은 자리다** — 같은 디렉터리의 사이드카고 같은 `personaFilePath`로
 *  방어하고 같은 화면이 같은 렌더에서 셋을 같이 읽는다. 읽는 쪽이 하나 더 있는 것만 갈린다
 *  (엔진이 디스패치 앞에서 읽는다 — §5-4). 티켓 `e94030b4`.
 *
 *  경로 방어는 `projects.ts`의 `personaFilePath` 하나다(이름이 신뢰 경계 — §경로 방어). */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_BYTES } from "./attachment-limit.ts";
import { byteLength } from "./budgets.ts";
import { skillUploadError } from "./skill-upload-limit.ts";
import { DEFAULT_LOCALE, t, wrap, type Locale } from "./i18n.ts";
import { expandHome, resolveWithin } from "./paths.ts";
import { personaFilePath } from "./projects.ts";
import { type EngineId, NO_MODEL, parseEngineValue, renderEngineBlock } from "./workers.ts";

const execFileP = promisify(execFile);

/** 목록 한 항목. `description`은 `SKILL.md` frontmatter 원문 그대로다 — **자르지 않는다**(§5-1:
 *  "언제 이걸 쓰는가"가 유도의 본체다. 길이는 비용이고 비용은 화면의 자수가 정직하게 보인다). */
export type Skill = { name: string; description: string };

// ── 설치된 스킬 (이 머신) ───────────────────────────────────────────────────

/** `CLAUDE_CONFIG_DIR` 있으면 그 값, 없으면 `~/.claude` (§5-1). */
export const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");

/** 이 머신에 설치된 스킬. 자리는 둘이다(§5-1) — 사용자 `<config>/skills/<스킬>/SKILL.md`
 *  (한 단계 중첩까지) · 플러그인 `<config>/plugins/marketplaces/<마켓>/skills/<스킬>/SKILL.md`.
 *  (글롭의 `*`를 주석에 쓰지 않는다 — `*` + `/`가 블록 주석을 닫는다)
 *
 *  **못 읽는 자리는 건너뛴다.** 빈 배열이 정상이다 — 스킬이 하나도 없는 머신이 있고, 그건
 *  화면이 "고를 게 없다"로 그릴 사실이지 에러가 아니다.
 *
 *  `configDir`를 인자로 받는 이유: 테스트가 임시 디렉터리를 주입한다. 이 머신의 `~/.claude`를
 *  읽는 테스트는 머신마다 결과가 달라 회귀 판정이 안 된다.
 *
 *  ponytail: 부를 때마다 전체 재스캔이다(디렉터리 몇 개 + 파일 수십 개). 다이얼로그를 여는
 *  순간에만 도는 경로라 캐시 안 한다 — 스킬이 수백 개가 되면 mtime 캐시. */
export async function listInstalledSkills(configDir: string = claudeConfigDir()): Promise<Skill[]> {
  const config = expandHome(configDir);
  const markets = path.join(config, "plugins", "marketplaces");
  const files = [
    ...(await skillFilesUnder(path.join(config, "skills"), 1)),
    ...(await skillFilesUnder(path.join(config, "skills"), 2)),
    ...(await subdirs(markets)).flatMap((m) => [path.join(markets, m, "skills")]),
  ];
  // 마켓플레이스 자리는 위에서 디렉터리만 모았다 — 그 아래 한 단계가 스킬이다.
  const paths = [
    ...files.filter((f) => f.endsWith("SKILL.md")),
    ...(await Promise.all(
      files.filter((f) => !f.endsWith("SKILL.md")).map((d) => skillFilesUnder(d, 1)),
    )).flat(),
  ];

  const found = new Map<string, Skill>();
  for (const skill of await Promise.all(paths.map(readSkillFile))) {
    // 같은 이름이 두 자리에 있으면 먼저 찾은 것을 남긴다. 지목은 이름으로 서므로 둘을 다
    // 보여줘도 사람이 고를 근거가 없다.
    if (skill && !found.has(skill.name)) found.set(skill.name, skill);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `<dir>` 아래 `depth`단계의 `SKILL.md` 후보 경로. 없는 디렉터리는 빈 배열이다.
 *  글롭 라이브러리를 들이지 않는다 — `*`가 한 단계씩 두 번뿐이다. */
async function skillFilesUnder(dir: string, depth: number): Promise<string[]> {
  const subs = await subdirs(dir);
  if (depth === 1) return subs.map((s) => path.join(dir, s, "SKILL.md")); // 없으면 읽기에서 걸러진다
  return (await Promise.all(subs.map((s) => skillFilesUnder(path.join(dir, s), depth - 1)))).flat();
}

async function subdirs(dir: string): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
}

async function readSkillFile(file: string): Promise<Skill | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? null : parseSkillFm(text);
}

/** `SKILL.md` frontmatter에서 `name`·`description`만 꺼낸다. **YAML 파서를 안 쓴다**
 *  (AGENTS.md §의존성). 접힘(`>`)·리터럴(`|`) 블록은 더 들여쓴 줄을 **공백으로 접어 한 줄**로
 *  만든다(§5-1) — 우리가 이 값으로 하는 일은 목록 한 줄에 넣는 것뿐이라 줄바꿈이 뜻을 갖지 않는다.
 *  `name:`이 없으면 null이다: 이름이 곧 지목이라 이름 없는 스킬은 고를 수 없다. */
export function parseSkillFm(text: string): Skill | null {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const fm: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]); // 들여쓴 줄은 키가 아니다(블록 본문)
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][-+]?$/.test(value) || value === "") {
      const block: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === "" || /^\s/.test(lines[i + 1]))) {
        block.push(lines[++i].trim());
      }
      value = block.filter(Boolean).join(" ");
    }
    fm[m[1]] = unquote(value);
  }
  return fm.name ? { name: fm.name, description: fm.description ?? "" } : null;
}

const unquote = (v: string) =>
  (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))
    ? v.slice(1, -1)
    : v;

// ── import — 첨부한 스킬을 이 머신에 설치한다 (§5-1 §import) ──────────────────

/** import 한 장. `path`는 스킬 루트 기준 상대경로(`"SKILL.md"`·`"references/x.md"`) — 폴더를
 *  고른 경우 사람이 고른 폴더 이름은 호출부(`af84d919`, `FormData` 해석)가 이미 뗀 값이다.
 *  `bytes`는 그 파일 내용 그대로다. `originalName`은 **`SKILL.md`로 다시 쓰기 전의 원래 파일명**
 *  (§비주얼 §25 ⑤ 갈래 1의 사유가 요구하는 값 — 한 장 모드에서 고른 이름이 `SKILL.md`가 아닐 수
 *  있다). 없으면 `path`로 대신한다(폴더 모드는 애초에 `SKILL.md`다). */
export type SkillUpload = { path: string; bytes: Buffer; originalName?: string };

/** import 실패 사유를 두 조각으로 낸다(§비주얼 §25 ⑤) — 사람이 읽는 문장(`message` =
 *  `Error.message`)과 기계값(`detail`, mono). 서버 액션이 이 둘을 `AlertTitle`·
 *  `AlertDescription`에 그대로 나눠 얹는다 — 갈래마다 문장이 다르다는 계약이 타입에 선다. */
export class SkillInstallError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "SkillInstallError";
    this.detail = detail;
  }
}

/** §5-1 §검증 — `/`·공백·`..`·`.` 시작을 한 판정으로 막는다. `:`도 막는다(플러그인 호출
 *  문법과 겹치면 `listInstalledSkills`의 첫 승 규칙이 한쪽을 가린다). */
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 상대경로 성분 하나가 빈 값·`.`·`..`이거나 `\`·NUL을 담으면 참이다(§5-1 §검증). 실제 방어는
 *  아래 `installSkill`의 `resolveWithin` 하나다 — 이건 사유를 갈라 보여주기 위한 사전 판정이다. */
function hasBadPathComponent(p: string): boolean {
  return p.split("/").some((part) => part === "" || part === "." || part === ".." || /[\\\0]/.test(part));
}

/** 첨부한 파일들을 `<config>/skills/<name:>/`에 설치한다(§5-1 §import). `files`는 **(상대경로,
 *  바이트) 짝의 목록**이다 — `FormData` 해석·폴더 이름 떼기는 호출부 몫이다.
 *
 *  **다 검증한 뒤에 쓴다**(§검증 마지막 줄) — 상한·이름·경로 전부를 통과해야 디렉터리 하나라도
 *  생긴다. 이름 충돌 판정은 `mkdir`(재귀 없음)의 `EEXIST`다 — 검사와 생성 사이가 안 벌어진다
 *  (`saveAttachment`의 `wx`와 같은 규약). 쓰다가 실패하면(디스크 꽉 참 등) 방금 만든 디렉터리를
 *  지운다 — 반쪽 설치를 안 남긴다. */
export async function installSkill(
  files: SkillUpload[],
  configDir: string = claudeConfigDir(),
  locale: Locale = DEFAULT_LOCALE,
): Promise<Skill> {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  // §비주얼 §25 ⑤ 표 «+» — 폴더 바로 아래에 SKILL.md가 없다. 화면이 폴더 모드에서 먼저 거절하므로
  // (원래 폴더 이름은 화면만 안다) 여기 닿는 것은 직접 호출뿐이다 — detail은 아는 값(파일명)으로 채운다.
  if (!skillMd) {
    throw new SkillInstallError(t("ko", "persona.skill.installMissingSkillMd"), "SKILL.md");
  }
  const badPath = files.find((f) => hasBadPathComponent(f.path));
  if (badPath) throw new Error(wrap(t("ko", "persona.skill.installBadPathPrefix"), badPath.path, ""));
  const limitError = skillUploadError(
    files.length,
    files.reduce((n, f) => n + f.bytes.length, 0),
    locale,
  );
  if (limitError) throw new SkillInstallError(limitError.title, limitError.message);

  const skill = parseSkillFm(skillMd.bytes.toString("utf8"));
  if (!skill) {
    throw new SkillInstallError(
      t("ko", "persona.skill.installNoName"),
      skillMd.originalName ?? skillMd.path,
    );
  }
  if (!SKILL_NAME_RE.test(skill.name)) {
    throw new SkillInstallError(
      t("ko", "persona.skill.installBadName"),
      `name: ${skill.name}`,
    );
  }

  const skillsDir = path.join(expandHome(configDir), "skills");
  await mkdir(skillsDir, { recursive: true }); // 없는 머신도 있다(§5-1) — resolveWithin이 realpath하기 전에 먼저 만든다
  const dest = path.join(skillsDir, skill.name);
  try {
    await mkdir(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SkillInstallError(t("ko", "persona.skill.installNameConflict"), dest);
    }
    throw e;
  }

  try {
    for (const f of files) {
      const full = await resolveWithin(skillsDir, path.join(skill.name, f.path));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, f.bytes, { flag: "wx" });
    }
  } catch (e) {
    await rm(dest, { recursive: true, force: true });
    throw e;
  }
  return skill;
}

// ── .skill 한 장(zip) → SkillUpload[] (§5-1 §셋째 입구) ───────────────────────

/** `unzip -l`의 데이터 줄 하나만 잡는다 — 날짜 칸(`00-00-1980`도 온다)이 있는 줄이 그거다.
 *  헤더 · 구분선 · 합계 줄은 그 칸이 없어 자동으로 빠진다. */
const UNZIP_LIST_LINE_RE = /^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/;

/** `unzip`을 부르고, 실패하면 §비주얼 §25 ⑤ 갈래 8의 두 조각으로 다시 던진다(zip이 아니거나
 *  깨진 아카이브 — 화면은 그 둘을 정직하게 못 가르므로 `unzip`이 낸 한 줄을 mono가 그대로 든다). */
async function runUnzip(args: string[]): Promise<{ stdout: string }> {
  try {
    return await execFileP("/usr/bin/unzip", args);
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { code?: number | string; stderr?: string; stdout?: string };
    const firstLine = (err.stderr?.trim() || err.stdout?.trim() || err.message).split("\n")[0];
    throw new SkillInstallError(
      t("ko", "persona.skill.unzipFailed"),
      `unzip ${err.code ?? "?"}: ${firstLine}`,
    );
  }
}

/** zip 안의 파일 목록 + **압축을 풀었을 때의 바이트**(`unzip -l`의 `Length` 칸). 상한이 재는
 *  값이 이거다 — 압축 전(zip 파일) 바이트로 재면 압축률 큰 zip 하나가 상한을 우회한다(§5-1
 *  §상한). 디렉터리 항목(이름이 `/`로 끝난다)은 여기서 뺀다 — 상한이 재는 수는 "푼 결과의
 *  파일"이다. */
async function listZipFiles(zipFile: string): Promise<{ path: string; bytes: number }[]> {
  const { stdout } = await runUnzip(["-l", zipFile]);
  return stdout
    .split("\n")
    .map((line) => UNZIP_LIST_LINE_RE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && !m[2].endsWith("/"))
    .map((m) => ({ path: m[2], bytes: Number(m[1]) }));
}

/** `.skill`(zip) 한 장을 `SkillUpload[]`로 바꾼다(§5-1 §셋째 입구). 통로는 그대로다 — 이 함수가
 *  낸 값을 그대로 `installSkill`에 넣는다(검증 · 상한 · 충돌 · 설치 자리는 한 줄도 안 갈린다).
 *
 *  **푸는 도구는 `/usr/bin/unzip`이다** — 손으로 쓴 zip 파서가 없다(신뢰 경계 바이트를 우리가
 *  파싱할 자리가 아니다. Node 표준 라이브러리에 zip 컨테이너 파서가 없다). 경로 탈출은 이
 *  바이너리가 이미 막는다(실측 — `../`가 든 항목은 그 성분을 스킵하고 대상 디렉터리 안에 쓴다).
 *  풀린 자리를 읽어 돌려주는 이 함수는 그 위에 한 번 더 `resolveWithin`을 건다.
 *
 *  **상한은 <푼 뒤>를 잰다** — 실제로 풀기 전에 `unzip -l`로 파일 수 · 바이트를 읽어
 *  `skillUploadError`로 먼저 거절한다(통과한 것만 디스크에 푼다).
 *
 *  **첫 성분 규칙**(§5-1): 최상위에 `SKILL.md`가 있으면 안 뗀다 - 없고 최상위 항목이 디렉터리
 *  하나뿐이면 그것을 뗀다 - 둘 다 아니면 **이 함수가 직접** 갈래 7로 거절한다(§비주얼 §25 ⑤ —
 *  `installSkill`의 폴더 문장을 되쓰면 `.skill`을 고른 사람에게 고르지도 않은 폴더를 탓하게 된다).
 *
 *  **`originalName`은 사람이 고른 `.skill` 파일명이다** — 갈래 7의 mono가 그 값을 든다.
 *  호출부(`installSkillAction`)가 안 넘기면 내부 임시 파일명으로 대신한다(테스트 편의).
 *
 *  **`unzip`이 실패하면**(헤더가 zip이 아니거나 깨진 아카이브) 갈래 8로 거절한다 — 그 실패가
 *  헤더 탓인지 손상 탓인지는 `unzip`이 낸 한 줄에만 있어 화면이 그 둘을 가르지 않는다.
 *
 *  **자리는 임시 디렉터리이고 끝나면 지운다**(성공하든 거절하든) — `<config>/skills` 밖이다.
 *
 *  **`subtree`는 §5-1 §넷째 입구가 쓰는 인자다** — 저장소 전체가 아니라 그 안의 한 경로만 남긴다
 *  (`tree`/`blob`/raw 주소가 가리키는 `<path>`). `undefined`면 전체(`.skill` 한 장과 같은 갈래).
 *  codeload zip은 언제나 저장소를 `<repo>-<ref>/` 한 겹으로 감싸는데, 그 이름을 몰라도 <유일한
 *  최상위 항목>으로 찾아 뗀 뒤 `subtree`를 그 아래에서 다시 찾는다 — 못 찾으면 갈래 13(§비주얼
 *  §25 ⑦)이다. **상한은 이 필터를 거친 뒤를 잰다**(§5-1 §상한 — 레포 전체가 아니라 남긴 하위
 *  트리). 그 뒤(첫 성분 규칙 · 상한 · 임시 디렉터리 · `installSkill` 이후)는 `subtree` 없을 때와
 *  한 줄도 안 갈린다 — `cut`이 그때 빈 문자열이라 아래 계산이 그대로 종전 값으로 접힌다. */
export async function extractSkillArchive(
  bytes: Buffer,
  originalName = "archive.skill",
  subtree?: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<SkillUpload[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "skill-import-"));
  try {
    const zipFile = path.join(dir, "archive.zip");
    await writeFile(zipFile, bytes);
    let entries = await listZipFiles(zipFile);

    let cut = ""; // subtree가 없으면 빈 문자열 — 아래 전부가 종전 그대로다
    if (subtree !== undefined) {
      const repoTop = new Set(entries.map((e) => e.path.split("/")[0]));
      const repoRoot = repoTop.size === 1 ? `${[...repoTop][0]}/` : "";
      cut = `${repoRoot}${subtree}/`;
      entries = entries.filter((e) => e.path.startsWith(cut));
      if (entries.length === 0) {
        throw new SkillInstallError(t("ko", "persona.skill.subtreeNotFound"), subtree);
      }
    }

    const limitError = skillUploadError(
      entries.length,
      entries.reduce((n, e) => n + e.bytes, 0),
      locale,
    );
    if (limitError) throw new SkillInstallError(limitError.title, limitError.message);

    const extractDir = path.join(dir, "extracted");
    await mkdir(extractDir);
    await runUnzip(["-q", zipFile, "-d", extractDir]);

    const relPaths = entries.map((e) => e.path.slice(cut.length));
    const topSegments = new Set(relPaths.map((p) => p.split("/")[0]));
    const only = topSegments.size === 1 ? [...topSegments][0] : null;
    const isSingleTopDir = only !== null && relPaths.every((p) => p !== only);
    const hasTopSkillMd = relPaths.some((p) => p === "SKILL.md");
    if (!hasTopSkillMd && !isSingleTopDir) {
      throw new SkillInstallError(t("ko", "persona.skill.skillMdNotFound"), originalName);
    }
    const strip = !hasTopSkillMd && isSingleTopDir ? `${cut}${only}/` : cut;

    return await Promise.all(
      entries.map(async (e) => ({
        path: e.path.slice(strip.length),
        bytes: await readFile(await resolveWithin(extractDir, e.path)),
      })),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── 주소 한 줄(URL) → SkillUpload[] (§5-1 §넷째 입구) ─────────────────────────

/** 이 셋만 받는다(§5-1 §호스트 목록 셋). `https`가 아니거나 이 밖이면 요청을 안 낸다 — IP
 *  리터럴 · 사설 대역 · `file:`을 따로 세는 코드를 안 만드는 이유다(목록 하나가 그 전부를 막는다).
 *  리디렉션 뒤 최종 호스트(`res.url`)도 이 목록으로 판정한다. */
const SKILL_ADDRESS_HOSTS = new Set([
  "github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
]);

/** §5-1 §타임아웃 — 전체 30초. 헤더뿐 아니라 본문을 다 받는 시간까지 잰다(기존 `AbortSignal.timeout`
 *  조립 그대로 — `lib/usage.ts`의 5초 프로브와 다른 수인 이유는 §5-1 §넷째 입구가 적었다). */
const SKILL_FETCH_TIMEOUT_MS = 30_000;

/** 갈래 10(§비주얼 §25 ⑦) — 표에 없는 모양이거나 호스트가 셋 밖이면 요청을 내기 전에 거절한다. */
function badSkillAddress(address: string): never {
  throw new SkillInstallError(t("ko", "persona.skill.badAddress"), address);
}

/** 주소 한 줄 → codeload zip 주소 + 남길 하위 트리(§5-1 §주소 갈래 표 여섯). API를 안 부른다 —
 *  기본 브랜치를 몰라도 `zip/HEAD`가 그것을 준다. 토큰도 안 붙인다(§5-1 §안 하는 것). */
export function parseSkillAddress(address: string): { fetchUrl: string; subtree?: string } {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return badSkillAddress(address);
  }
  if (url.protocol !== "https:" || !SKILL_ADDRESS_HOSTS.has(url.hostname))
    return badSkillAddress(address);
  const seg = url.pathname.split("/").filter(Boolean);

  if (url.hostname === "github.com") {
    if (seg.length === 2) return { fetchUrl: `https://codeload.github.com/${seg[0]}/${seg[1]}/zip/HEAD` };
    if (seg[2] === "tree" && seg.length >= 4) {
      const [owner, repo, , ref, ...rest] = seg;
      const fetchUrl = `https://codeload.github.com/${owner}/${repo}/zip/${ref}`;
      return rest.length === 0 ? { fetchUrl } : { fetchUrl, subtree: rest.join("/") };
    }
    // blob/<ref>/<path>/<파일> — <path>가 최소 한 성분이라야 한다(파일이 레포 바로 아래면 표 밖이다).
    if (seg[2] === "blob" && seg.length >= 6) {
      const [owner, repo, , ref, ...rest] = seg;
      return {
        fetchUrl: `https://codeload.github.com/${owner}/${repo}/zip/${ref}`,
        subtree: rest.slice(0, -1).join("/"),
      };
    }
    return badSkillAddress(address);
  }
  // raw.githubusercontent.com/<o>/<r>/<ref>/<path>/<파일> — 위 blob과 같은 최소 길이 조건이다.
  if (url.hostname === "raw.githubusercontent.com" && seg.length >= 5) {
    const [owner, repo, ref, ...rest] = seg;
    return {
      fetchUrl: `https://codeload.github.com/${owner}/${repo}/zip/${ref}`,
      subtree: rest.slice(0, -1).join("/"),
    };
  }
  return badSkillAddress(address);
}

/** 응답을 스트리밍으로 받으며 §8 `MAX_BYTES`를 잰다 — `Content-Length`를 안 믿는다(chunked면
 *  안 온다). 넘는 순간 **받는 도중에 끊는다**(갈래 12). 그 밖의 끊김 · 소켓 에러 · 타임아웃은
 *  갈래 11로 뭉뚱그린다 — HTTP 상태 · 타임아웃 · 끊김을 가르지 않고 사유를 지어내지 않는다. */
async function readLimitedBody(res: Response, fetchUrl: string): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new SkillInstallError(t("ko", "persona.skill.tooLarge"), `${MAX_BYTES / 1024 / 1024}MB`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof SkillInstallError) throw e;
    throw new SkillInstallError(
      t("ko", "persona.skill.fetchFailed"),
      `GET ${fetchUrl}: ${(e as Error).message}`,
    );
  }
  return Buffer.concat(chunks);
}

/** 주소 한 줄 → `SkillUpload[]`(§5-1 §넷째 입구 · §비주얼 §25 ⑦). 통로는 여전히
 *  `extractSkillArchive` 하나다 — 이 함수는 그 앞에 붙는 것(주소 판정 · fetch · 상한을 지키며
 *  받기)만 하고, 받은 뒤는 `.skill` 한 장과 한 줄도 안 갈린다. 새 npm은 0이다 — `fetch`와
 *  `AbortSignal.timeout`은 Node 런타임 내장이다.
 *
 *  거절하면 `<config>/skills` 아래에도 임시 디렉터리에도 아무것도 안 남는다 — 요청 자체가
 *  거절되면 `extractSkillArchive`를 아예 안 부르고, 부른 뒤의 거절은 그 함수의 `finally`가 건다. */
export async function fetchSkillFromAddress(
  address: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<SkillUpload[]> {
  const { fetchUrl, subtree } = parseSkillAddress(address);

  let res: Response;
  try {
    res = await fetch(fetchUrl, { signal: AbortSignal.timeout(SKILL_FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new SkillInstallError(
      t("ko", "persona.skill.fetchFailed"),
      `GET ${fetchUrl}: ${(e as Error).message}`,
    );
  }
  if (!SKILL_ADDRESS_HOSTS.has(new URL(res.url).hostname)) {
    await res.body?.cancel();
    return badSkillAddress(res.url);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new SkillInstallError(
      t("ko", "persona.skill.fetchFailed"),
      `GET ${fetchUrl}: HTTP ${res.status}`,
    );
  }

  const bytes = await readLimitedBody(res, fetchUrl);
  return extractSkillArchive(bytes, address, subtree, locale);
}

// ── 페르소나가 고른 스킬 (`<personas>/<이름>/skills.md`) ─────────────────────

/** 목록 줄 문법은 이것 하나다(§5-1). **안 맞는 줄은 목록에서 빠지지만 파일에서 지워지지 않는다** —
 *  사람이 손으로 문장을 덧붙일 수 있고 그 글도 프롬프트에 실린다. 파일이 원본이라는 말의 내용이다. */
const ITEM_RE = /^- `([^`\n]+)` — ?(.*)$/;

const HEADER = `## 스킬

이 페르소나가 쓰는 스킬이다. 해당하는 일이면 먼저 이걸 쓴다.

`;

/** 목록 + **파일 전체 바이트 수**. 화면이 둘 다 든다: 목록은 문법에 맞는 줄만이고(사람이 덧붙인
 *  산문은 안 그린다), 접힌 줄의 바이트 수는 `tick.sh`가 주입하는 **파일 전체**를 센다(§비주얼
 *  §25, §프롬프트 층 결정 11 — 예산은 `wc -c`와 같은 단위라야 비교가 된다).
 *  한 번 읽어 둘로 나눠주는 이유가 그것이다 — 화면이 같은 파일을 두 번 열지 않는다.
 *
 *  파일이 없으면 `[]`·`0`. 기준 디렉터리(해석된 `TICKET_PERSONAS`)가 아직 없는 큐도 같다 —
 *  이름 위반·기준 밖 경로는 그대로 던진다(신뢰 경계는 조용히 넘어가지 않는다).
 *
 *  **`skills.md`·`skills-off.md`가 이 함수 하나를 같이 쓴다**(§5-1 §n:m 배정과 비활성 — 파서
 *  두 벌을 안 만든다). `readPersonaSkillsFile`·`readPersonaOffSkillsFile`은 파일명만 갈라 부른다. */
async function readSkillsSidecar(
  dir: string,
  name: string,
  file: string,
): Promise<{ skills: Skill[]; chars: number }> {
  let filePath: string;
  try {
    filePath = await personaFilePath(dir, name, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // realpath(기준 디렉터리) 실패만
    return { skills: [], chars: 0 };
  }
  const text = await readFile(filePath, "utf8").catch(() => null);
  if (text === null) return { skills: [], chars: 0 };
  return {
    skills: text
      .split("\n")
      .map((l) => ITEM_RE.exec(l.trimEnd()))
      .filter((m) => m !== null)
      .map((m) => ({ name: m[1], description: m[2] })),
    chars: byteLength(text),
  };
}

export const readPersonaSkillsFile = (dir: string, name: string) =>
  readSkillsSidecar(dir, name, "skills.md");

/** 비활성 스킬(§5-1 §n:m 배정과 비활성). 자수는 안 쓴다 — 이 파일은 인라인되지 않아 §비주얼
 *  §25의 자수 합에 안 든다(호출부가 `skills`만 읽는다). */
export const readPersonaOffSkillsFile = (dir: string, name: string) =>
  readSkillsSidecar(dir, name, "skills-off.md");

export const readPersonaSkills = async (dir: string, name: string): Promise<Skill[]> =>
  (await readPersonaSkillsFile(dir, name)).skills;

/** 화면이 고른 **이름들** → 파일에 쓸 목록. 다이얼로그도 목록의 `제거`도 이름만 보내고
 *  설명은 서버가 채운다 — 클라이언트가 준 문자열이 그대로 파일이 되지 않는다.
 *
 *  **이미 든 것의 순서를 지키고 새로 고른 것을 뒤에 붙인다.** 체크 순서로 재배열하면 아무것도
 *  안 고른 저장에서도 파일의 줄이 뒤섞인다.
 *
 *  설명은 **설치본이 이긴다**(§5-1 — `SKILL.md`의 `description`을 그대로 옮긴다). 후보에 없는
 *  스킬만 파일에 적힌 설명을 들고 남는다(§5-1 — 지우지 않는다). 어느 쪽에도 없는 이름은 뺀다:
 *  설명을 지어낼 자리가 없고, 그 이름이 어디서 왔는지 아는 것이 화면뿐이라면 참이 아니다. */
export function pickedSkills(picked: string[], current: Skill[], installed: Skill[]): Skill[] {
  const byName = new Map(current.map((s) => [s.name, s]));
  for (const s of installed) byName.set(s.name, s);
  const order = [
    ...current.filter((s) => picked.includes(s.name)).map((s) => s.name),
    ...picked.filter((n) => !current.some((s) => s.name === n)),
  ];
  return order.map((n) => byName.get(n)).filter((s) => s !== undefined);
}

/** 저장. **0개면 파일을 지운다**(§5-1 — 주입할 게 없으면 파일이 없는 게 사실이다. 사람이 덧붙인
 *  산문도 같이 사라지는데, 그게 "빈 파일을 남기지 않는다"의 대가고 스펙이 그렇게 정했다).
 *
 *  이미 있는 파일은 **목록 줄만 갈아끼운다** — 산문은 자리까지 그대로 둔다(§5-1). 새 목록은
 *  원래 첫 항목 줄 자리에 들어간다: 사람이 목록 위/아래에 쓴 글이 서로 자리를 바꾸지 않는다.
 *
 *  **`skills.md`·`skills-off.md`가 이 함수 하나를 같이 쓴다**(§5-1 §n:m 배정과 비활성) —
 *  `writePersonaSkills`·`writePersonaOffSkills`는 파일명 · 새 파일의 머리글만 갈라 부른다.
 *  비활성 파일은 머리글이 없다: 어느 프롬프트에도 안 실려 산문을 안내할 독자가 없다. */
async function writeSkillsSidecar(
  dir: string,
  name: string,
  skills: Skill[],
  file: string,
  header: string,
): Promise<void> {
  const filePath = await personaFilePath(dir, name, file);
  if (skills.length === 0) {
    await rm(filePath, { force: true });
    return;
  }

  const items = skills.map((s) => {
    const n = s.name.trim();
    // 백틱·줄바꿈이 들어가면 우리가 쓴 파일을 우리가 못 읽는다(ITEM_RE). 설명은 접고, 이름은 거절.
    if (!n || /[`\n]/.test(n))
      throw new Error(wrap(t("ko", "persona.skill.badNamePrefix"), JSON.stringify(s.name), ""));
    return `- \`${n}\` — ${s.description.replace(/\s+/g, " ").trim()}`;
  });

  const old = await readFile(filePath, "utf8").catch(() => null);
  if (old === null) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, header + items.join("\n") + "\n", "utf8");
    return;
  }

  const out: string[] = [];
  let placed = false;
  for (const line of old.split("\n")) {
    if (ITEM_RE.test(line.trimEnd())) {
      if (!placed) out.push(...items);
      placed = true;
      continue;
    }
    out.push(line);
  }
  if (!placed) {
    if (out.at(-1)?.trim() !== "") out.push(""); // 산문 바로 밑에 목록을 붙이지 않는다
    out.push(...items);
  }
  await writeFile(filePath, out.join("\n").replace(/\n*$/, "\n"), "utf8");
}

export const writePersonaSkills = (dir: string, name: string, skills: Skill[]) =>
  writeSkillsSidecar(dir, name, skills, "skills.md", HEADER);

export const writePersonaOffSkills = (dir: string, name: string, skills: Skill[]) =>
  writeSkillsSidecar(dir, name, skills, "skills-off.md", "");

// ── 페르소나 동시 워커 상한 (`<personas>/<이름>/limit` · §5-4) ───────────────

/** 파일 하나에 정수 하나. **파서를 안 만든다**(§5-4). 없는 파일 · 빈 파일 · 정수가 아닌 내용은
 *  전부 `null`(= 상한 없음)이고 그게 기본값이다 — 화면은 `null`에 아무것도 안 그린다.
 *
 *  **양끝 공백을 떼는 것이 계약이다**(§5-4 §양끝 공백). 쓰는 쪽(아래)이 `n\n`을 쓰고 사람이
 *  에디터로 ` 2 `를 쓸 수 있으므로, 읽는 쪽 둘(엔진과 이 함수)이 같은 값을 봐야 한다.
 *  `Number()`가 아니라 `^\d+$`인 이유: `Number(" 2 ")`는 2지만 `Number("")`도 0이고
 *  `Number("2x")`는 NaN이라 세 갈래를 한 판정으로 못 가른다. 오타 하나가 페르소나를 0으로
 *  굶기는 쪽으로 떨어지면 안 된다(§5-4 표). */
export async function readPersonaLimit(dir: string, name: string): Promise<number | null> {
  let file: string;
  try {
    file = await personaFilePath(dir, name, "limit");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // realpath(기준 디렉터리) 실패만
    return null;
  }
  const text = (await readFile(file, "utf8").catch(() => "")).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** 저장. **`null`이면 파일을 지운다**(= 상한 없음. §5-4 §화면 "비우면 파일을 지운다").
 *  쓰는 바이트는 `n\n` 하나다 — 선례가 `writePersonaSkills`의 `+ "\n"`이고, 이 한 줄이
 *  엔진과의 이음매다(§5-4 §양끝 공백. 판정은 §검증 ⑧ = 다른 티켓).
 *
 *  **정수가 아닌 값은 거절한다.** 여기서 조용히 넘어가면 화면이 쓴 상한이 엔진에서
 *  `상한 없음`이 되고 화면에는 아무 이상이 안 보인다(§5-4가 짚은 바로 그 자리다). */
export async function writePersonaLimit(dir: string, name: string, limit: number | null): Promise<void> {
  const file = await personaFilePath(dir, name, "limit");
  if (limit === null) {
    await rm(file, { force: true });
    return;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(wrap(t("ko", "persona.limit.invalidPrefix"), String(limit), ""));
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${limit}\n`, "utf8");
}

// ── 페르소나별 실행 엔진 (`<personas>/<이름>/engine` · §제약 1 §결정 기록 §열한 번째) ────

/** 내용은 워커 파일이 쓰는 것과 **글자 하나까지 같은 한 줄** — `TICKET_ENGINE=(...)`
 *  (`renderEngineBlock` 그대로, §23 카탈로그 무수정 · 요구 `3917dbda` 답 `7563d133`).
 *  `tick.sh`가 이 파일을 그대로 `source`하므로 새 파서를 만들지 않는다 — 배열 블록 한 줄만 읽는다.
 *
 *  파일 없음 · 못 읽음 · 모양이 다름(`TICKET_ENGINE=(...)` 한 줄이 아님)은 `null`(= 지정 없음 —
 *  그 페르소나는 워커 자신의 엔진을 그대로 쓴다). **그 대입 자체는 있는데 카탈로그와 안 맞으면**
 *  (사람이 손으로 얹은 `--autocompact`류 꼬리) `{ raw }`로 원문을 그대로 낸다 — `null`로 뭉개면
 *  화면이 "지정 없음"으로 그리고, `writePersonaEngine`이 그 값을 못 본 채 지운다(`77ca2128`). */
export async function readPersonaEngine(
  dir: string,
  name: string,
): Promise<{ engineId: EngineId; model: string } | { raw: string } | null> {
  let file: string;
  try {
    file = await personaFilePath(dir, name, "engine");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  }
  const text = (await readFile(file, "utf8").catch(() => "")).trim();
  const m = /^TICKET_ENGINE=\((.*)\)$/.exec(text);
  if (!m) return null;
  return parseEngineValue(m[1]) ?? { raw: m[1] };
}

/** 커스텀 인자(`{ raw }`)가 있는 engine 파일을 `force` 없이 덮어쓰려 할 때 던진다 — PROFILE.md
 *  §파일 쓰기("덮어쓰기 전에 읽는다") 그대로다. `raw`는 지금 파일의 원문 인자다 — 화면이 그대로
 *  보여주고 사람이 확인하면 `force: true`로 다시 부른다. */
export class PersonaEngineCustomError extends Error {
  readonly raw: string;
  constructor(raw: string) {
    super(wrap(t("ko", "persona.engine.customPrefix"), raw, ""));
    this.name = "PersonaEngineCustomError";
    this.raw = raw;
  }
}

/** 저장. `id === null`이면 파일을 지운다(= 지정 없음, `writePersonaLimit`과 같은 규약).
 *
 *  **덮어쓰기 전에 읽는다**(PROFILE.md §파일 쓰기): 지금 파일이 카탈로그와 안 맞는 커스텀 값
 *  (`{ raw }`)이면 `force`가 없는 한 `PersonaEngineCustomError`로 멈춘다 — 팝오버가 모델만 고르고
 *  저장해도 그 커스텀 꼬리가 조용히 사라지지 않는다(`77ca2128`).
 *
 *  자기검증은 **쓴 뒤 읽기 경로로 다시 읽는다**(`readPersonaEngine` — 워커 파일 대상이던
 *  `writeEngine`과 같은 패턴). 값이 다르면 **안 쓴 것으로 실패한다** — 쓴 파일을 지운다. */
export async function writePersonaEngine(
  dir: string,
  name: string,
  id: EngineId | null,
  model: string = NO_MODEL,
  force = false,
): Promise<{ engineId: EngineId; model: string } | null> {
  const file = await personaFilePath(dir, name, "engine");
  if (id === null) {
    await rm(file, { force: true });
    return null;
  }
  if (!force) {
    const current = await readPersonaEngine(dir, name);
    if (current && "raw" in current) throw new PersonaEngineCustomError(current.raw);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${renderEngineBlock(id, model)}\n`, "utf8");
  const back = await readPersonaEngine(dir, name);
  if (!back || !("engineId" in back) || back.engineId !== id || back.model !== model) {
    await rm(file, { force: true });
    throw new Error(t("ko", "persona.engine.writeVerifyFailed"));
  }
  return back;
}

// ── 페르소나 메모리 (`<personas>/<이름>/memory/*.md` · §5-2) ─────────────────

/** 개념 하나 = 파일 하나. `file`은 **확장자를 단 파일명**이다(삭제가 이 값으로 선다 — 화면이
 *  `.md`를 떼는 것은 표시 규칙이다. §비주얼 §32 ③). `text`는 파일 원문 그대로다. */
export type Memory = { file: string; excerpt: string; text: string };

/** 화면 발췌 — **첫 비어 있지 않은 줄**, 선두 `# `는 뗀다(§5-2 형식 표). 파싱 계약은 이 두 줄이
 *  전부다. 빈 파일·공백뿐인 파일은 빈 문자열이고, 그래도 목록에서 안 숨긴다(§5-2: 못 읽는
 *  파일은 없다 — 발췌가 비면 파일명만 그린다). */
export function memoryExcerpt(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().replace(/^# /, "");
}

/** 목록 + **파일 전체 바이트 수의 합**. 접힌 줄의 바이트 수가 이 값을 `PROFILE.md`·`skills.md`와
 *  **따로** 든다(§비주얼 §32 ①, §프롬프트 층 결정 11 (4) — 메모리는 프롬프트에 안 실려 5,000B
 *  합계에서 빠지고, `AGENTS.md` §회고 예산(150,000B)을 재는 별개 표시가 된다). 파일명 줄도
 *  `관련:`·`출처:` 줄도 센다. `--- <파일명>` 구분 줄은 주입이 만드는 글자라 안 센다.
 *
 *  글롭은 **한 단계**다(`tick.sh`의 `for m in "$MEMDIR"/*.md`와 같은 판정 — 하위 디렉터리는
 *  안 읽는다). `memory/`가 없으면 `[]`·`0`이고 그게 정상이다(§5-2 — WARN도 없다). */
export async function readPersonaMemory(
  dir: string,
  name: string,
): Promise<{ memories: Memory[]; chars: number }> {
  const files = await memoryFiles(dir, name);
  const memories = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(path.join(file.dir, file.name), "utf8").catch(() => "");
      return { file: file.name, excerpt: memoryExcerpt(text), text };
    }),
  );
  return { memories, chars: memories.reduce((n, m) => n + byteLength(m.text), 0) };
}

/** 삭제. **클라이언트가 준 이름은 이 디렉터리를 실제로 나열해 나온 목록 안에 있을 때만** 지운다
 *  (§5-2 §화면 · §경로 방어) — 경로를 문자열로 조립하지 않는다는 규칙의 이 화면 버전이다.
 *  목록에 없으면 던진다: 이름이 신뢰 경계이고, 조용히 지나가면 화면이 안 지운 것을 지웠다고 한다.
 *
 *  **NFC로 대조한다.** 파일명이 한글이면 fs가 NFD로 돌려주는 자리가 있고(macOS HFS+) 그러면
 *  화면이 그린 이름과 글자가 같아도 `===`가 거짓이다 — `queue.ts`가 티켓 이름에 쓰는 규칙과 같다. */
export async function deletePersonaMemory(dir: string, name: string, file: string): Promise<void> {
  const files = await memoryFiles(dir, name);
  const target = files.find((f) => f.name.normalize("NFC") === file.normalize("NFC"));
  if (!target) throw new Error(wrap(t("ko", "persona.memory.notInListPrefix"), file, ""));
  await rm(path.join(target.dir, target.name));
}

/** `<personas>/<이름>/memory/*.md` — 파일만, 이름 오름차순. 기준 디렉터리가 없는 큐도 정상이다.
 *  **읽기와 삭제가 같은 목록을 쓴다**(위 둘): 화이트리스트가 화면이 그린 목록과 갈리면 방어가
 *  아니라 다른 규칙이 된다. */
async function memoryFiles(dir: string, name: string): Promise<{ dir: string; name: string }[]> {
  let base: string;
  try {
    base = await personaFilePath(dir, name, "memory");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // realpath(기준 디렉터리) 실패만
    return [];
  }
  const ents = await readdir(base, { withFileTypes: true }).catch(() => []);
  return ents
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ dir: base, name: e.name }))
    // ponytail: `localeCompare`다(`listInstalledSkills`와 같은 벌). bash 글롭의 순서는 워커의
    // LC_COLLATE에 달렸으므로 비ASCII 파일명에서 주입 순서와 갈릴 수 있다 — 실제로 갈리면 그때.
    .sort((a, b) => a.name.localeCompare(b.name));
}
