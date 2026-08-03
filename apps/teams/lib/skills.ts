/** 페르소나 사이드카 읽기·쓰기 — 스킬(§5-1)과 메모리(§5-2).
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
 *
 *  경로 방어는 `projects.ts`의 `personaFilePath` 하나다(이름이 신뢰 경계 — §경로 방어). */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { expandHome } from "./paths.ts";
import { personaFilePath } from "./projects.ts";

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
