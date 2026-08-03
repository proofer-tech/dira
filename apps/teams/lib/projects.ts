/** 프로젝트 레지스트리 + 프로젝트별 설정 해석 (DESIGN.md §프로젝트, §프로젝트별 설정 해석).
 *
 *  GUI는 큐 하나에 붙어 사는 게 아니라 사용자가 등록한 큐들을 전환하며 본다. 레지스트리는
 *  머신 로컬 JSON 한 파일이고, 큐 위치·접미사·페르소나 디렉터리는 전부 프로젝트에서 받아온다. */
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_KEYMAP, defaultBindings, type Bindings, type Keymap } from "./keymap.ts";
import {
  NAME_RE,
  PROJECT_ID_RE,
  expandHome,
  localDir,
  resolveWithin,
  shellPath,
  shellValue,
} from "./paths.ts";
import { isAwaiting, listTickets, statusOf, type Ticket } from "./queue.ts";
import { listWorkers, type Worker } from "./workers.ts";
import { PERSONA_COLORS, slugify, tildePath } from "./urls.ts";

export { slugify };

export type Project = {
  id: string; // URL 조각
  name: string; // 사람이 읽는 라벨
  root: string; // <프로젝트>/.dira 절대경로 (realpath 된 것)
  /** 페르소나 이름 → 팔레트 키 (DESIGN.md §5 · §비주얼 §12). **큐에 저장하지 않는 이유**:
   *  `PROFILE.md`에 넣으면 `tick.sh`가 통째로 프롬프트에 인라인하고(tick.sh:186), 사이드카
   *  파일은 큐에 GUI 전용 규약을 새로 만든다. 레지스트리는 이미 있는 머신 로컬 저장소다.
   *  페르소나를 지워도 청소하지 않는다 — 이름으로 조회하는 맵이라 고아 키가 아무것도 안 한다. */
  personaColors?: Record<string, string>;
};

export type ProjectConfig = {
  personas: string;
  protocols: string;
  inProgress: string; // 상태 접미사
  done: string;
  cwd: string; // 첫 워커 값 (한 경로가 필요한 호출자용)
  /** `TICKET_CWD`를 읽은 워커만. 워커마다 자기 워크트리를 쓰는 게 정상이라 목록으로 본다. */
  cwdByWorker: Record<string, string>;
  /** 워커에 **값이 없어** 기본값을 쓴 키. UI가 "기본값 가정"으로 표시할 근거다. */
  assumed: string[];
  /** 값은 있는데 `$HOME` 외 변수가 남아 해석하지 못한 할당문. UI가 `[해석 실패]` 배지 + 원문
   *  라인을 그린다(§7). `assumed`와 다른 사실이다 — 없는 것과 못 읽은 것은 조치가 다르다. */
  unresolved: { key: string; raw: string; worker: string }[];
  /** 워커 간 값이 갈린 키. 엔진은 디스패치한 워커의 값을 쓰므로 실제 위험이다.
   *  `cwd`는 **절대 들어오지 않는다**(§프로젝트별 설정 해석의 `TICKET_CWD` 예외). */
  conflicts: { key: string; byWorker: Record<string, string> }[];
};

// ── 레지스트리 ──────────────────────────────────────────────────────────────

/** 엔진이 머신 로컬 상태를 두는 곳(oauth-token, run/)과 같은 디렉터리. 레포에 넣지 않는다. */
export function registryPath(): string {
  return path.join(localDir(), "gui-projects.json");
}

/** 프로젝트로 이름을 바꾸기 전의 레지스트리(`gui-tenants.json`, 배열 키 `tenants`).
 *  ponytail: 읽기만 폴백한다 — 첫 쓰기가 새 파일로 옮겨 담으므로 마이그레이션 코드가 없다.
 *  옛 파일은 그대로 남는다(지우지 않는다). 한동안 새 파일만 보이면 이 폴백을 지운다. */
function legacyRegistryPath(): string {
  return registryPath().replace(/gui-projects\.json$/, "gui-tenants.json");
}

// ── 키맵 파일 (DESIGN.md §0-6) ──────────────────────────────────────────────
//
// 판정·표기·검증은 전부 `lib/keymap.ts`고 여기 있는 건 **파일 세 함수뿐**이다. 저기는
// 클라이언트 컴포넌트가 import해서 번들로 가므로 `node:*`를 들일 수 없고(실측: 빌드가
// `chunking context does not support external modules`로 깨진다), 이 셋이 필요한 건
// `registryPath()` 하나다 — 그 주인이 이 파일이라 여기 얹었다(`auth.ts`가 못 하는 선택이다).

/** 레지스트리·토큰과 **같은 디렉터리**다(엔진의 `$LOCAL`). `lib/auth.ts:16`과 같은 한 줄. */
export function keymapPath(): string {
  return path.join(path.dirname(registryPath()), "keymap.json");
}

/** 파일을 **손댄 그대로** 준다(모르는 id 포함). 쓰기가 이 객체 위에 덮어쓴다.
 *  `error`가 사유 원문이다 — 화면이 그대로 그리므로(§비주얼 §22) 문구를 지어내지 않는다. */
async function readRawKeymap(): Promise<{ obj: Record<string, unknown>; error: string | null }> {
  let raw: string;
  try {
    raw = await readFile(keymapPath(), "utf8");
  } catch (e) {
    // 없음은 정상이다(아직 아무것도 안 바꿨다). 그 외(권한 등)는 사유를 그대로 올린다 —
    // 던지면 서버 컴포넌트가 500이 되고, 삼키면 화면이 기본값으로 뜬 이유를 말할 수 없다
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { obj: {}, error: null };
    return { obj: {}, error: (e as Error).message };
  }
  try {
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      return { obj: {}, error: "최상위가 객체가 아닙니다" };
    }
    return { obj: o as Record<string, unknown>, error: null };
  } catch (e) {
    return { obj: {}, error: (e as Error).message };
  }
}

/** 기본값 위에 파일을 얹는다. **던지지 않는다** — 파일 없음 · JSON 깨짐 · 모르는 액션 id
 *  셋 다 완전한 키맵으로 흡수한다(모르는 id는 안 읽고, 쓰기가 보존한다). */
export async function readKeymap(): Promise<Keymap> {
  const { obj, error } = await readRawKeymap();
  const bindings = defaultBindings();
  for (const a of DEFAULT_KEYMAP) {
    const v = obj[a.id];
    if (typeof v === "string" && v) bindings[a.id] = v;
  }
  return {
    bindings,
    broken: error !== null,
    ...(error ? { error } : {}),
    path: tildePath(keymapPath(), homedir()),
  };
}

/** 바꾼 것만 넘긴다. **읽은 객체 위에 덮어쓰므로** 우리가 모르는 id는 살아남는다
 *  (옛 버전이 쓴 것 · 사람이 적어 둔 것). 깨진 파일만은 보존할 길이 없어 새로 쓴다 —
 *  그 사실은 화면이 이미 `broken`으로 말한 뒤다. */
export async function writeKeymap(changes: Partial<Bindings>): Promise<void> {
  const { obj } = await readRawKeymap();
  const next: Record<string, unknown> = { ...obj, ...changes };
  // 기본값으로 되돌아온 항목은 파일에서 뺀다 — 파일은 **차이**만 담는다(§0-6)
  for (const a of DEFAULT_KEYMAP) if (next[a.id] === a.combo) delete next[a.id];
  const p = keymapPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(next, null, 2) + "\n");
}

export async function readProjects(): Promise<Project[]> {
  let raw: string;
  try {
    raw = await readFile(registryPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    raw = await readFile(legacyRegistryPath(), "utf8").catch(() => "");
    if (!raw) return []; // 아직 등록 전 = 온보딩
  }
  // 깨진 JSON은 삼키지 않는다. 빈 목록으로 넘기면 다음 등록이 남의 프로젝트를 덮어쓴다.
  const parsed = JSON.parse(raw) as { projects?: unknown; tenants?: unknown };
  const list = parsed.projects ?? parsed.tenants; // 옛 파일은 `tenants` 키다
  if (!Array.isArray(list)) {
    throw new Error(`레지스트리 형식이 이상하다(projects 배열 없음): ${registryPath()}`);
  }
  return list as Project[];
}

export async function getProject(id: string): Promise<Project | null> {
  return (await readProjects()).find((t) => t.id === id) ?? null;
}

async function writeProjects(projects: Project[]): Promise<void> {
  const p = registryPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ version: 1, projects }, null, 2) + "\n", "utf8");
}

/** 등록 검증 실패. `code`가 어느 입력의 문제인지를 정하고(등록 폼이 필드 아래 vs 폼 하단
 *  Alert을 가른다), `message`는 사용자에게 그대로 보이는 문장이다(DESIGN.md §7 문구 표).
 *  문장을 액션에 다시 쓰지 않는다 — 검증이 여기 있으므로 문구도 여기 있어야 갈리지 않는다. */
export type ProjectErrorCode =
  | "name" // 이름 비었음
  | "root" // 경로 사유 (없음 · 디렉터리 아님 · 큐 아님)
  | "dupRoot" // 같은 큐가 이미 등록됨
  | "needId" // 슬러그가 비어 URL 조각을 직접 받아야 함
  | "badId" // 손으로 넣은 URL 조각 형식 오류
  | "dupId"; // URL 조각 중복

export class ProjectError extends Error {
  code: ProjectErrorCode;
  /** `dupRoot`일 때 그 프로젝트 — 폼이 "그 프로젝트로 가는 링크"를 붙인다. */
  dup?: Project;
  // 필드를 생성자 파라미터 프로퍼티로 쓰지 않는다 — Node의 타입 스트리핑이 거부한다(pnpm test).
  constructor(code: ProjectErrorCode, message: string, dup?: Project) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.dup = dup;
  }
}

/** 등록. 검증 4종을 서버에서 통과해야 저장한다 — 실패하면 무엇이 틀렸는지 문장으로 던진다. */
export async function addProject(name: string, rootInput: string, id?: string): Promise<Project> {
  if (!name.trim()) throw new ProjectError("name", "이름을 입력하세요.");
  const given = expandHome(rootInput.trim());
  if (!path.isAbsolute(given)) {
    throw new ProjectError("root", `절대경로여야 합니다: ${rootInput.trim() || "(비어 있음)"}`);
  }

  let root: string;
  try {
    root = await realpath(given);
  } catch {
    throw new ProjectError(
      "root",
      `${given}가 없습니다. 절대경로가 맞는지, 마운트가 연결돼 있는지 확인하세요.`,
    );
  }
  if (!(await stat(root)).isDirectory()) {
    throw new ProjectError("root", `${root}는 디렉터리가 아닙니다.`);
  }
  const inside = await readdir(root).catch(() => [] as string[]);
  if (!inside.includes("tickets") && !inside.includes("workers")) {
    throw new ProjectError(
      "root",
      // 다음 행동을 준다(§비주얼 §7 문구 표). 이 경로에는 빈 `.dira`도 들어오는데, 스캐폴딩으로
      // 채우지 않는 것이 §0-3의 결정이다 — 사람이 무엇을 지우는지 알고 지우는 편이 낫다.
      "이 디렉터리에 tickets/도 workers/도 없습니다 — dira 프로젝트가 아닙니다. 안에 tickets/ 와 workers/ 를 만들거나, 지우고 [새로 만들기]로 다시 만드세요.",
    );
  }

  const projects = await readProjects();
  const dup = projects.find((t) => t.root === root);
  if (dup) throw new ProjectError("dupRoot", `이미 ${dup.name}으로 등록돼 있습니다.`, dup);

  // id는 이름에서 만들되, 비거나 겹치면 자동으로 지어내지 않는다 — `project-1` 같은 값은 URL이
  // 의미를 잃는다. 등록 폼이 그때만 `URL 조각` 입력을 노출하고 사용자가 정한다.
  const tid = id ?? slugify(name);
  if (!PROJECT_ID_RE.test(tid) || tid.length > 40) {
    if (id) {
      throw new ProjectError(
        "badId",
        `URL 조각 형식이 틀렸습니다 — 영문 소문자·숫자·하이픈 1~40자: ${id}`,
      );
    }
    throw new ProjectError(
      "needId",
      "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈).",
    );
  }
  if (projects.some((t) => t.id === tid)) {
    throw new ProjectError(
      "dupId",
      `URL 조각 ${tid}가 이미 쓰이고 있습니다. 다른 이름을 쓰거나 조각을 직접 정하세요.`,
    );
  }

  const project: Project = { id: tid, name: name.trim(), root };
  await writeProjects([...projects, project]);
  return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  if (!name.trim()) throw new ProjectError("name", "이름을 입력하세요.");
  const projects = await readProjects();
  const t = projects.find((x) => x.id === id);
  if (!t) throw new Error(`없는 프로젝트: ${id}`);
  t.name = name.trim();
  await writeProjects(projects);
}

/** 표시 순서 = 배열 순서. 목록에 없는 id는 뒤에 원래 순서대로 남긴다. */
export async function reorderProjects(ids: string[]): Promise<void> {
  const projects = await readProjects();
  const ordered = ids.map((id) => projects.find((t) => t.id === id)).filter((t): t is Project => !!t);
  const rest = projects.filter((t) => !ordered.includes(t));
  await writeProjects([...ordered, ...rest]);
}

/** 페르소나 색 할당 (DESIGN.md §5). `color: null`이면 지운다(`색 없음`).
 *
 *  **큐에는 아무것도 쓰지 않는다** — 레지스트리 파일 하나가 전부다. 값은 팔레트 키만 받는다:
 *  임의 문자열은 화면에서 중립 점으로 무시되므로 저장해봐야 쓰레기고, 이름은 다른 프로젝트의
 *  키와 섞이지 않게 엔진과 같은 규칙(`NAME_RE`)으로 거른다. */
export async function setPersonaColor(
  id: string,
  persona: string,
  color: string | null,
): Promise<void> {
  if (!NAME_RE.test(persona)) throw new Error(`페르소나 이름이 아닙니다: ${persona}`);
  if (color !== null && !(PERSONA_COLORS as readonly string[]).includes(color)) {
    throw new Error(`팔레트에 없는 색입니다: ${color}`);
  }
  const projects = await readProjects();
  const t = projects.find((x) => x.id === id);
  if (!t) throw new Error(`없는 프로젝트: ${id}`);
  const colors = { ...t.personaColors };
  if (color === null) delete colors[persona];
  else colors[persona] = color;
  // 빈 맵은 키째 지운다 — 색을 한 번도 안 고른 프로젝트와 전부 지운 프로젝트가 같아야 한다.
  if (Object.keys(colors).length === 0) delete t.personaColors;
  else t.personaColors = colors;
  await writeProjects(projects);
}

/** 레지스트리에서만 지운다. 큐 파일은 손대지 않는다(DESIGN.md 제약 7). */
export async function removeProject(id: string): Promise<void> {
  const projects = await readProjects();
  await writeProjects(projects.filter((t) => t.id !== id));
}

// ── 설정 해석 ───────────────────────────────────────────────────────────────

/** 워커 파일의 변수 → ProjectConfig 필드. 이 5개만 본다. */
const KEYS = {
  TICKET_PERSONAS: "personas",
  TICKET_PROTOCOLS: "protocols",
  TICKET_INPROGRESS: "inProgress",
  TICKET_DONE: "done",
  TICKET_CWD: "cwd",
} as const;
type Field = (typeof KEYS)[keyof typeof KEYS];

const ASSIGN_RE = /^[ \t]*(?:export[ \t]+)?(TICKET_[A-Z_]+)=(.*)$/;

/** 셸 값 해석은 `lib/paths.ts`에 있다 — `workers.ts`도 같은 규칙으로 `TICKET_CWD`를 읽어야 하고
 *  둘이 서로를 import하면 순환이다. 여기서 다시 export하는 건 기존 호출자(테스트) 때문이다. */
export { shellValue };

type Parsed = { kv: Partial<Record<Field, string>>; bad: Partial<Record<Field, string>> };

/** 기준 디렉터리로 쓰이는 키. 상대경로면 서버 cwd(`apps/teams/`) 기준으로 풀리므로 해석 실패다. */
const PATH_FIELDS = new Set<Field>(["personas", "protocols", "cwd"]);

/** 워커 파일 하나의 할당문. `bad`는 **해석 못 한 라인 원문** — 셸 구문(`$X`·`$(…)`·백틱)이
 *  남았거나, 경로 키인데 절대경로가 아닌 경우다.
 *  `TICKET_DONE=`처럼 빈 값은 `shellValue`가 똑같이 null을 주지만 그건 미설정이지 실패가 아니다
 *  (`tickets.py`도 `or 기본값`). 둘을 섞으면 화면이 안 켜져도 될 경고를 켠다. */
function parseWorker(text: string): Parsed {
  const kv: Partial<Record<Field, string>> = {};
  const bad: Partial<Record<Field, string>> = {};
  for (const line of text.split("\n")) {
    const m = ASSIGN_RE.exec(line);
    if (!m) continue;
    const field = KEYS[m[1] as keyof typeof KEYS];
    if (!field) continue;
    const isPath = PATH_FIELDS.has(field);
    const v = isPath ? shellPath(m[2]) : shellValue(m[2]);
    if (v !== null) kv[field] = v; // 뒤 할당이 이긴다(셸과 같다)
    // 값이 있는데 못 읽은 것만 원문으로 남긴다: 셸 구문이 남았거나, 경로인데 상대경로거나.
    else if (/[$`]/.test(m[2]) || (isPath && shellValue(m[2]) !== null)) bad[field] = line.trim();
  }
  return { kv, bad };
}

/** 프로젝트의 실효 설정. `<루트>/personas`·`.wip`·`.done`을 가정하지 않고 워커 파일에서 읽는다.
 *  워커가 여러 개인데 값이 갈리면 첫 워커 값을 쓰고 conflicts에 양쪽을 담는다 —
 *  `TICKET_CWD`만 예외로 `cwdByWorker` 목록에 담고 충돌로 보지 않는다. */
export async function resolveConfig(project: Pick<Project, "root">): Promise<ProjectConfig> {
  const root = project.root;
  const defaults: Record<Field, string> = {
    personas: path.join(root, "personas"),
    protocols: path.join(root, "protocols"),
    inProgress: ".wip",
    done: ".done",
    cwd: path.dirname(root),
  };

  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".sh"))
    .sort();
  const parsed: [string, Parsed][] = [];
  for (const n of names) {
    const text = await readFile(path.join(dir, n), "utf8").catch(() => null);
    if (text !== null) parsed.push([n.slice(0, -3), parseWorker(text)]);
  }

  const config: ProjectConfig = {
    ...defaults,
    cwdByWorker: {},
    assumed: [],
    unresolved: [],
    conflicts: [],
  };
  for (const field of Object.values(KEYS)) {
    const found = parsed.filter(([, p]) => p.kv[field] !== undefined);
    const bad = parsed.filter(([, p]) => p.bad[field] !== undefined);
    // 못 읽은 라인은 다른 워커가 같은 키를 제대로 줬더라도 남긴다 — 엔진은 셸을 실행하므로
    // 그 워커에서는 우리가 못 본 값이 실제로 쓰인다. 그 사실을 화면이 알려야 한다.
    for (const [w, p] of bad) config.unresolved.push({ key: field, raw: p.bad[field]!, worker: w });
    // `TICKET_CWD`는 워커마다 갈리는 게 정상이다(워커마다 자기 git 워크트리) — 충돌이 아니라
    // 목록이다. 하나뿐이어도 담는다: 표기(워커명 생략 여부)를 화면이 정한다.
    if (field === "cwd") config.cwdByWorker = Object.fromEntries(found.map(([w, p]) => [w, p.kv.cwd!]));
    if (found.length === 0) {
      // 값이 아예 없다(`기본값 가정`) ≠ 있는데 못 읽었다(`해석 실패`). 후자는 unresolved에만 담는다.
      if (bad.length === 0) config.assumed.push(field);
      continue;
    }
    config[field] = found[0][1].kv[field]!;
    if (field !== "cwd" && new Set(found.map(([, p]) => p.kv[field])).size > 1) {
      config.conflicts.push({
        key: field,
        byWorker: Object.fromEntries(found.map(([w, p]) => [w, p.kv[field]!])),
      });
    }
  }
  return config;
}

/** 워커 값을 못 쓴 모든 경우(값이 없음 + 해석 실패). §7 해석 결과 표만 둘을 구분해 그리고,
 *  나머지 화면은 "화면이 쓰는 값이 기본값이다"라는 같은 사실만 필요하다. */
export function usingDefault(config: ProjectConfig, key: string): boolean {
  return config.assumed.includes(key) || config.unresolved.some((u) => u.key === key);
}

// ── 목록·전환기용 요약 ──────────────────────────────────────────────────────

/** 프로젝트 목록 행과 전환기 항목이 쓰는 한 줄 요약. 못 읽으면 `connected: false` + 사유 원문이고
 *  카운트는 **0이 아니라 없음**이다(읽지 못한 것과 0건은 다른 사실이다 — DESIGN.md §4-1). */
export type ProjectSummary = {
  connected: boolean;
  /** 연결 안 됨 사유 원문(`ENOENT: …`). §6 에러 3요소의 2번. 삼키지 않는다. */
  error: string | null;
  /** 티켓 3종 수(§0 자원 표). 판정은 `listTickets`가 준 `state`를 세는 것뿐 — 새 fs 읽기 0.
   *  못 읽으면 셋 다 `null`이다(0건과 다른 사실이다 — §4-1). */
  open: number | null; // 열린 티켓 수
  wip: number | null;
  done: number | null;
  /** 페르소나 **이름만**(§0 자원 표). `listPersonas`를 부르지 않는 이유: 그건 이름마다
   *  `PROFILE.md`를 열어서 페르소나 수 × 프로젝트 수만큼 파일을 읽는다(§성능 예산).
   *  못 읽은 프로젝트는 빈 배열이다(`assigned`와 같은 규칙 — 그 자리엔 `연결 안 됨`이 뜬다). */
  personas: string[];
  workers: Worker[];
  /** `할당됨`(열린 파일 + `session_id`) 티켓 — 엔진이 만들지 않는 조합이고 도달하면 아무 신호
   *  없이 영구 정체다. 셸의 상주 배너(§0-2)와 목록 행 배지(§0)가 이걸 쓴다. 판정은 `statusOf`
   *  하나뿐이고 이미 읽은 `listTickets` 결과를 거르므로 **새 fs 읽기가 0**이다.
   *  링크는 `stem`이다(상태가 바뀌어도 URL이 안 변한다 — §식별자).
   *
   *  못 읽은 프로젝트는 빈 배열이다. `open`과 달리 `null`로 갈라두지 않는다 — 판정 자체가
   *  불가능하면 배너·배지가 없는 게 답이고(§0-2 마지막 항), 그 자리에는 이미 `연결 안 됨`
   *  사유가 뜬다. */
  assigned: { hash: string; stem: string }[];
  /** `답변 대기`(열림 + `awaiting`이 미충족 deps에 있다) 티켓 — 사람이 답을 써야 그 큐가 다시
   *  도는 유일한 상태다(§0-10 ④ · §요구사항 레이어 결정 5). 판정은 `isAwaiting` 하나뿐이고
   *  보드·상세가 쓰는 그 함수다 — **두 벌째 판정을 만들지 않는다.** `assigned`와 같은 자리에서
   *  같은 `listTickets` 결과를 한 번 더 거르므로 **새 fs 읽기가 0**이다.
   *  `mtime`을 같이 드는 것은 배지의 경과일(`답변 대기 · 3일`) 때문이다 — 계산은 종전대로
   *  `daysSince`(`components/status-badge.tsx`) 하나다.
   *
   *  못 읽은 프로젝트는 빈 배열이다(`assigned`의 그 규칙 그대로 — 판정 자체가 불가능하면
   *  항목이 없는 게 답이고 그 자리에는 `연결 안 됨`이 이미 서 있다). */
  awaiting: { hash: string; stem: string; mtime: number }[];
};

/** 프로젝트 하나를 훑는다. 경로가 없으면 읽기를 시도하지 않고 사유만 담는다.
 *
 *  ponytail: 티켓 파일을 전부 읽어 개수만 센다(listTickets 재사용). 프로젝트가 한 자릿수고
 *  큐가 수십 건이라 이게 제일 싸다 — 수천 건 되면 파일명만 세는 경로를 따로 만든다. */
export async function readSummary(project: Pick<Project, "root">): Promise<ProjectSummary> {
  try {
    const st = await stat(project.root);
    if (!st.isDirectory()) throw new Error(`디렉터리가 아니다: ${project.root}`);
    const config = await resolveConfig(project);
    const [tickets, workers] = await Promise.all([
      listTickets(project.root, config),
      listWorkers(project.root),
    ]);
    return {
      connected: true,
      error: null,
      open: tickets.filter((t) => t.state === "open").length,
      wip: tickets.filter((t) => t.state === "wip").length,
      done: tickets.filter((t) => t.state === "done").length,
      personas: await personaNames(config.personas, tickets),
      workers,
      assigned: tickets
        .filter((t) => statusOf(t) === "assigned")
        .map((t) => ({ hash: t.hash, stem: t.stem })),
      awaiting: tickets
        .filter(isAwaiting)
        .map((t) => ({ hash: t.hash, stem: t.stem, mtime: t.mtime })),
    };
  } catch (e) {
    return {
      connected: false,
      error: (e as Error).message,
      open: null,
      wip: null,
      done: null,
      personas: [],
      workers: [],
      assigned: [],
      awaiting: [],
    };
  }
}

// ── 페르소나 (DESIGN.md §5) ─────────────────────────────────────────────────
//
// 기준 디렉터리는 **해석된 `TICKET_PERSONAS`**다. `<루트>/personas`라고 가정하면 재정의한 큐에서
// 엉뚱한 디렉터리를 편집한다 — 그래서 이 함수들은 root를 받지 않고 디렉터리를 받는다.
// 페르소나 로직이 여기 있는 이유: 그 디렉터리를 해석하는 게 `resolveConfig`고, 같은 파일이다.

/** 목록 한 항목. `body: null` = PROFILE.md가 없다 — 엔진은 WARN만 남기고 **페르소나 없이**
 *  디스패치한다(tick.sh 188행). 그래서 프로필 없는 이름도 목록에 넣는다(경고의 근거다). */
export type Persona = {
  name: string;
  /** `<해석된 personas>/<이름>/PROFILE.md` */
  file: string;
  body: string | null;
  /** 이 이름을 `persona:`로 쓰는 티켓 수. 삭제 경고가 이걸 쓴다 */
  refs: { open: number; wip: number; total: number };
};

/** 이름 검증 + 경로 조립은 **서버에서만** 한다(신뢰 경계). 규칙은 `tickets.py PERSONA_RE`와 같다 —
 *  엔진이 이 값으로 경로를 만들므로 `../../.ssh` 같은 이름은 프롬프트에 실려 나간다.
 *  통과해도 문자열을 믿지 않고 `resolveWithin`으로 기준 디렉터리 안인지 확인한다(심링크 포함).
 *
 *  파일명을 인자로 받는 이유: 페르소나 디렉터리에 사는 파일이 `PROFILE.md` 하나가 아니다
 *  (`skills.md` — §5-1, `lib/skills.ts`). 방어가 두 벌이 되면 한쪽만 고쳐지는 날이 온다. */
export async function personaFilePath(dir: string, name: string, file: string): Promise<string> {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `페르소나 이름은 영문·숫자·_·- 만 됩니다: ${name || "(비어 있음)"} — 엔진이 이 이름으로 <personas>/<이름>/${file} 경로를 만듭니다.`,
    );
  }
  return resolveWithin(dir, path.join(name, file));
}

const profilePath = (dir: string, name: string) => personaFilePath(dir, name, "PROFILE.md");

/** 디렉터리에 있는 페르소나 ∪ 티켓이 부르는 페르소나. 이름 순.
 *
 *  ponytail: 이름 규칙(`NAME_RE`) 밖 디렉터리는 목록에서 뺀다 — 엔진이 그 이름으로 티켓을
 *  받아주지 않으므로(`persona_of`가 빈 문자열로 만든다) 절대 쓰이지 않는 디렉터리다. */
export async function personaNames(dir: string, tickets: Ticket[] = []): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = new Set(
    ents.filter((e) => e.isDirectory() && NAME_RE.test(e.name)).map((e) => e.name),
  );
  for (const t of tickets) if (t.persona) names.add(t.persona); // 프로필 없는 이름 = 엔진의 WARN
  return [...names].sort();
}

/** 위 이름들 + 각각의 `PROFILE.md`·참조 수. **파일을 이름 수만큼 읽는다** — 목록 행처럼 이름만
 *  필요한 화면은 `personaNames`를 부른다(§0 표 · §성능 예산). */
export async function listPersonas(dir: string, tickets: Ticket[] = []): Promise<Persona[]> {
  return Promise.all(
    (await personaNames(dir, tickets)).map(async (name) => {
      const file = path.join(dir, name, "PROFILE.md");
      const refs = tickets.filter((t) => t.persona === name);
      return {
        name,
        file,
        body: await readFile(file, "utf8").catch(() => null),
        refs: {
          open: refs.filter((t) => t.state === "open").length,
          wip: refs.filter((t) => t.state === "wip").length,
          total: refs.length,
        },
      };
    }),
  );
}

/** 저장. 없으면 만든다 — 목록에 "프로필 없음"으로 뜬 이름을 그 자리에서 채우게 하려고
 *  생성과 같은 경로를 쓴다(빈 textarea에 쓰고 저장 = 생성). */
export async function savePersona(dir: string, name: string, body: string): Promise<string> {
  await mkdir(expandHome(dir), { recursive: true }); // 기준 디렉터리가 아직 없는 큐도 있다
  const file = await profilePath(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
  return file;
}

/** 생성은 `O_EXCL`. 이미 있는 프로필을 덮으면 돌고 있는 큐의 페르소나가 조용히 바뀐다. */
export async function createPersona(dir: string, name: string): Promise<string> {
  await mkdir(expandHome(dir), { recursive: true });
  const file = await profilePath(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `# ${name}\n`, { flag: "wx" });
  return file;
}

/** 디렉터리째 지운다(안의 다른 파일도 같이) — 화면이 확인 다이얼로그에서 그 사실을 알린다. */
export async function deletePersona(dir: string, name: string): Promise<void> {
  const file = await profilePath(dir, name);
  await rm(path.dirname(file), { recursive: true, force: true });
}
