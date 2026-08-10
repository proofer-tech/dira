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
 *  **메모리(`memory/*.md`)가 여기 사는 이유**는 스킬과 같은 물건이기 때문이다 — 같은 디렉터리의
 *  사이드카고, 같은 `personaFilePath`로 방어하고, 같은 화면이 같은 렌더에서 둘을 같이 읽는다.
 *  갈리는 것은 쓰는 쪽뿐이다(스킬은 GUI, 메모리는 세션 — §5-2). 티켓 `bb48630b`.
 *  **상한(`limit`)도 같은 자리다** — 같은 디렉터리의 사이드카고 같은 `personaFilePath`로
 *  방어하고 같은 화면이 같은 렌더에서 셋을 같이 읽는다. 읽는 쪽이 하나 더 있는 것만 갈린다
 *  (엔진이 디스패치 앞에서 읽는다 — §5-4). 티켓 `e94030b4`.
 *
 *  경로 방어는 `projects.ts`의 `personaFilePath` 하나다(이름이 신뢰 경계 — §경로 방어). */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { skillUploadError } from "./skill-upload-limit.ts";
import { expandHome, resolveWithin } from "./paths.ts";
import { personaFilePath } from "./projects.ts";
import { type EngineId, NO_MODEL, parseEngineValue, renderEngineBlock } from "./workers.ts";

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
 *  만든다(§5-1) — 우리가 이 값으로 하는 일은 목록 한 줄에 박는 것뿐이라 줄바꿈이 뜻을 갖지 않는다.
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
): Promise<Skill> {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  // §비주얼 §25 ⑤ 표 «+» — 폴더 바로 아래에 SKILL.md가 없다. 화면이 폴더 모드에서 먼저 거절하므로
  // (원래 폴더 이름은 화면만 안다) 여기 닿는 것은 직접 호출뿐이다 — detail은 아는 값(파일명)으로 채운다.
  if (!skillMd) {
    throw new SkillInstallError("고른 폴더 바로 아래에 SKILL.md가 없습니다", "SKILL.md");
  }
  const badPath = files.find((f) => hasBadPathComponent(f.path));
  if (badPath) throw new Error(`올바르지 않은 경로입니다: ${badPath.path}`);
  const limitError = skillUploadError(
    files.length,
    files.reduce((n, f) => n + f.bytes.length, 0),
  );
  if (limitError) throw new SkillInstallError(limitError.title, limitError.message);

  const skill = parseSkillFm(skillMd.bytes.toString("utf8"));
  if (!skill) {
    throw new SkillInstallError(
      "고른 파일의 frontmatter에 name이 없습니다 — 설치될 디렉터리 이름이 name입니다",
      skillMd.originalName ?? skillMd.path,
    );
  }
  if (!SKILL_NAME_RE.test(skill.name)) {
    throw new SkillInstallError(
      "name을 디렉터리 이름으로 쓸 수 없습니다 — 영숫자로 시작하고 영숫자 · . _ - 만, 64자까지입니다",
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
      throw new SkillInstallError(
        "이 이름의 스킬이 이 머신에 이미 있습니다 — 덮지 않습니다. 지우거나 name을 바꾼 뒤 다시 고릅니다",
        dest,
      );
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

// ── 페르소나가 고른 스킬 (`<personas>/<이름>/skills.md`) ─────────────────────

/** 목록 줄 문법은 이것 하나다(§5-1). **안 맞는 줄은 목록에서 빠지지만 파일에서 지워지지 않는다** —
 *  사람이 손으로 문장을 덧붙일 수 있고 그 글도 프롬프트에 실린다. 파일이 원본이라는 말의 내용이다. */
const ITEM_RE = /^- `([^`\n]+)` — ?(.*)$/;

const HEADER = `## 스킬

이 페르소나가 쓰는 스킬이다. 해당하는 일이면 먼저 이걸 쓴다.

`;

/** 목록 + **파일 전체 자수**. 화면이 둘 다 든다: 목록은 문법에 맞는 줄만이고(사람이 덧붙인
 *  산문은 안 그린다), 접힌 줄의 자수는 `tick.sh`가 주입하는 **파일 전체**를 센다(§비주얼 §25).
 *  한 번 읽어 둘로 나눠주는 이유가 그것이다 — 화면이 같은 파일을 두 번 열지 않는다.
 *
 *  파일이 없으면 `[]`·`0`. 기준 디렉터리(해석된 `TICKET_PERSONAS`)가 아직 없는 큐도 같다 —
 *  이름 위반·기준 밖 경로는 그대로 던진다(신뢰 경계는 조용히 넘어가지 않는다). */
export async function readPersonaSkillsFile(
  dir: string,
  name: string,
): Promise<{ skills: Skill[]; chars: number }> {
  let file: string;
  try {
    file = await personaFilePath(dir, name, "skills.md");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // realpath(기준 디렉터리) 실패만
    return { skills: [], chars: 0 };
  }
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return { skills: [], chars: 0 };
  return {
    skills: text
      .split("\n")
      .map((l) => ITEM_RE.exec(l.trimEnd()))
      .filter((m) => m !== null)
      .map((m) => ({ name: m[1], description: m[2] })),
    chars: text.length,
  };
}

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
 *  원래 첫 항목 줄 자리에 들어간다: 사람이 목록 위/아래에 쓴 글이 서로 자리를 바꾸지 않는다. */
export async function writePersonaSkills(dir: string, name: string, skills: Skill[]): Promise<void> {
  const file = await personaFilePath(dir, name, "skills.md");
  if (skills.length === 0) {
    await rm(file, { force: true });
    return;
  }

  const items = skills.map((s) => {
    const n = s.name.trim();
    // 백틱·줄바꿈이 들어가면 우리가 쓴 파일을 우리가 못 읽는다(ITEM_RE). 설명은 접고, 이름은 거절.
    if (!n || /[`\n]/.test(n)) throw new Error(`스킬 이름에 쓸 수 없는 문자: ${JSON.stringify(s.name)}`);
    return `- \`${n}\` — ${s.description.replace(/\s+/g, " ").trim()}`;
  });

  const old = await readFile(file, "utf8").catch(() => null);
  if (old === null) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, HEADER + items.join("\n") + "\n", "utf8");
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
  await writeFile(file, out.join("\n").replace(/\n*$/, "\n"), "utf8");
}

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
    throw new Error(`상한은 0 이상의 정수여야 합니다: ${limit}`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${limit}\n`, "utf8");
}

// ── 페르소나별 실행 엔진 (`<personas>/<이름>/engine` · §제약 1 §결정 기록 §열한 번째) ────

/** 내용은 워커 파일이 쓰는 것과 **글자 하나까지 같은 한 줄** — `TICKET_ENGINE=(...)`
 *  (`renderEngineBlock` 그대로, §23 카탈로그 무수정 · 요구 `3917dbda` 답 `7563d133`).
 *  `tick.sh`가 이 파일을 그대로 `source`하므로 새 파서를 만들지 않는다 — 배열 블록 한 줄만 읽는다.
 *
 *  파일 없음 · 못 읽음 · 모양이 다름 · 카탈로그와 안 맞는 값은 전부 `null`(= 지정 없음 — 그
 *  페르소나는 워커 자신의 엔진을 그대로 쓴다). `limit`과 같은 원칙: 파서를 안 만들고, 오타 하나가
 *  조용히 다른 뜻으로 읽히지 않는다. */
export async function readPersonaEngine(
  dir: string,
  name: string,
): Promise<{ engineId: EngineId; model: string } | null> {
  let file: string;
  try {
    file = await personaFilePath(dir, name, "engine");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  }
  const text = (await readFile(file, "utf8").catch(() => "")).trim();
  const m = /^TICKET_ENGINE=\((.*)\)$/.exec(text);
  return m ? parseEngineValue(m[1]) : null;
}

/** 저장. `id === null`이면 파일을 지운다(= 지정 없음, `writePersonaLimit`과 같은 규약).
 *
 *  자기검증은 **쓴 뒤 읽기 경로로 다시 읽는다**(`readPersonaEngine` — 워커 파일 대상이던
 *  `writeEngine`과 같은 패턴). 값이 다르면 **안 쓴 것으로 실패한다** — 쓴 파일을 지운다. */
export async function writePersonaEngine(
  dir: string,
  name: string,
  id: EngineId | null,
  model: string = NO_MODEL,
): Promise<{ engineId: EngineId; model: string } | null> {
  const file = await personaFilePath(dir, name, "engine");
  if (id === null) {
    await rm(file, { force: true });
    return null;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${renderEngineBlock(id, model)}\n`, "utf8");
  const back = await readPersonaEngine(dir, name);
  if (!back || back.engineId !== id || back.model !== model) {
    await rm(file, { force: true });
    throw new Error(`쓴 블록을 다시 읽으면 값이 달라집니다. 쓰지 않았습니다.`);
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

/** 목록 + **파일 전체 자수의 합**. 접힌 줄의 자수가 이 값을 `PROFILE.md`·`skills.md`에 더한다
 *  (§비주얼 §32 ①) — 엔진이 인라인하는 것이 파일 전체라 파일명 줄도 `관련:`·`출처:` 줄도 센다.
 *  `--- <파일명>` 구분 줄은 주입이 만드는 글자라 안 센다.
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
  return { memories, chars: memories.reduce((n, m) => n + m.text.length, 0) };
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
  if (!target) throw new Error(`메모리 파일이 목록에 없습니다: ${file}`);
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
