/** 테넌트 레지스트리 + 테넌트별 설정 해석 (DESIGN.md §테넌트, §테넌트별 설정 해석).
 *
 *  GUI는 큐 하나에 붙어 사는 게 아니라 사용자가 등록한 큐들을 전환하며 본다. 레지스트리는
 *  머신 로컬 JSON 한 파일이고, 큐 위치·접미사·페르소나 디렉터리는 전부 테넌트에서 받아온다. */
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { NAME_RE, TENANT_ID_RE, expandHome, resolveWithin, shellValue } from "./paths.ts";
import { listTickets, type Ticket } from "./queue.ts";
import { listWorkers, type Worker } from "./workers.ts";
import { slugify } from "./urls.ts";

export { slugify };

export type Tenant = {
  id: string; // URL 조각
  name: string; // 사람이 읽는 라벨
  root: string; // <프로젝트>/.fs-tickets 절대경로 (realpath 된 것)
};

export type TenantConfig = {
  personas: string;
  protocols: string;
  inProgress: string; // 상태 접미사
  done: string;
  cwd: string; // 첫 워커 값 (한 경로가 필요한 호출자용)
  /** `TICKET_CWD`를 읽은 워커만. 워커마다 자기 워크트리를 쓰는 게 정상이라 목록으로 본다. */
  cwdByWorker: Record<string, string>;
  /** 워커에서 못 읽어 기본값을 쓴 키. UI가 "기본값 가정"으로 표시할 근거다. */
  assumed: string[];
  /** 워커 간 값이 갈린 키. 엔진은 디스패치한 워커의 값을 쓰므로 실제 위험이다.
   *  `cwd`는 **절대 들어오지 않는다**(§테넌트별 설정 해석의 `TICKET_CWD` 예외). */
  conflicts: { key: string; byWorker: Record<string, string> }[];
};

// ── 레지스트리 ──────────────────────────────────────────────────────────────

/** 엔진이 머신 로컬 상태를 두는 곳(oauth-token, run/)과 같은 디렉터리. 레포에 넣지 않는다. */
export function registryPath(): string {
  const local = process.env.TICKET_LOCAL || path.join(homedir(), ".config", "fs-tickets");
  return path.join(expandHome(local), "gui-tenants.json");
}

export async function readTenants(): Promise<Tenant[]> {
  let raw: string;
  try {
    raw = await readFile(registryPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; // 아직 등록 전 = 온보딩
    throw e;
  }
  // 깨진 JSON은 삼키지 않는다. 빈 목록으로 넘기면 다음 등록이 남의 테넌트를 덮어쓴다.
  const parsed = JSON.parse(raw) as { tenants?: unknown };
  if (!Array.isArray(parsed.tenants)) {
    throw new Error(`레지스트리 형식이 이상하다(tenants 배열 없음): ${registryPath()}`);
  }
  return parsed.tenants as Tenant[];
}

export async function getTenant(id: string): Promise<Tenant | null> {
  return (await readTenants()).find((t) => t.id === id) ?? null;
}

async function writeTenants(tenants: Tenant[]): Promise<void> {
  const p = registryPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ version: 1, tenants }, null, 2) + "\n", "utf8");
}

/** 등록 검증 실패. `code`가 어느 입력의 문제인지를 정하고(등록 폼이 필드 아래 vs 폼 하단
 *  Alert을 가른다), `message`는 사용자에게 그대로 보이는 문장이다(DESIGN.md §7 문구 표).
 *  문장을 액션에 다시 쓰지 않는다 — 검증이 여기 있으므로 문구도 여기 있어야 갈리지 않는다. */
export type TenantErrorCode =
  | "name" // 이름 비었음
  | "root" // 경로 사유 (없음 · 디렉터리 아님 · 큐 아님)
  | "dupRoot" // 같은 큐가 이미 등록됨
  | "needId" // 슬러그가 비어 URL 조각을 직접 받아야 함
  | "badId" // 손으로 넣은 URL 조각 형식 오류
  | "dupId"; // URL 조각 중복

export class TenantError extends Error {
  code: TenantErrorCode;
  /** `dupRoot`일 때 그 테넌트 — 폼이 "그 테넌트로 가는 링크"를 붙인다. */
  dup?: Tenant;
  // 필드를 생성자 파라미터 프로퍼티로 쓰지 않는다 — Node의 타입 스트리핑이 거부한다(pnpm test).
  constructor(code: TenantErrorCode, message: string, dup?: Tenant) {
    super(message);
    this.name = "TenantError";
    this.code = code;
    this.dup = dup;
  }
}

/** 등록. 검증 4종을 서버에서 통과해야 저장한다 — 실패하면 무엇이 틀렸는지 문장으로 던진다. */
export async function addTenant(name: string, rootInput: string, id?: string): Promise<Tenant> {
  if (!name.trim()) throw new TenantError("name", "이름을 입력하세요.");
  const given = expandHome(rootInput.trim());
  if (!path.isAbsolute(given)) {
    throw new TenantError("root", `절대경로여야 합니다: ${rootInput.trim() || "(비어 있음)"}`);
  }

  let root: string;
  try {
    root = await realpath(given);
  } catch {
    throw new TenantError(
      "root",
      `${given}가 없습니다. 절대경로가 맞는지, 마운트가 연결돼 있는지 확인하세요.`,
    );
  }
  if (!(await stat(root)).isDirectory()) {
    throw new TenantError("root", `${root}는 디렉터리가 아닙니다.`);
  }
  const inside = await readdir(root).catch(() => [] as string[]);
  if (!inside.includes("tickets") && !inside.includes("workers")) {
    throw new TenantError(
      "root",
      "이 디렉터리에 tickets/도 workers/도 없습니다 — fs-tickets 큐 디렉터리가 맞는지 확인하세요.",
    );
  }

  const tenants = await readTenants();
  const dup = tenants.find((t) => t.root === root);
  if (dup) throw new TenantError("dupRoot", `이미 ${dup.name}으로 등록돼 있습니다.`, dup);

  // id는 이름에서 만들되, 비거나 겹치면 자동으로 지어내지 않는다 — `tenant-1` 같은 값은 URL이
  // 의미를 잃는다. 등록 폼이 그때만 `URL 조각` 입력을 노출하고 사용자가 정한다.
  const tid = id ?? slugify(name);
  if (!TENANT_ID_RE.test(tid) || tid.length > 40) {
    if (id) {
      throw new TenantError(
        "badId",
        `URL 조각 형식이 틀렸습니다 — 영문 소문자·숫자·하이픈 1~40자: ${id}`,
      );
    }
    throw new TenantError(
      "needId",
      "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈).",
    );
  }
  if (tenants.some((t) => t.id === tid)) {
    throw new TenantError(
      "dupId",
      `URL 조각 ${tid}가 이미 쓰이고 있습니다. 다른 이름을 쓰거나 조각을 직접 정하세요.`,
    );
  }

  const tenant: Tenant = { id: tid, name: name.trim(), root };
  await writeTenants([...tenants, tenant]);
  return tenant;
}

export async function renameTenant(id: string, name: string): Promise<void> {
  if (!name.trim()) throw new TenantError("name", "이름을 입력하세요.");
  const tenants = await readTenants();
  const t = tenants.find((x) => x.id === id);
  if (!t) throw new Error(`없는 테넌트: ${id}`);
  t.name = name.trim();
  await writeTenants(tenants);
}

/** 표시 순서 = 배열 순서. 목록에 없는 id는 뒤에 원래 순서대로 남긴다. */
export async function reorderTenants(ids: string[]): Promise<void> {
  const tenants = await readTenants();
  const ordered = ids.map((id) => tenants.find((t) => t.id === id)).filter((t): t is Tenant => !!t);
  const rest = tenants.filter((t) => !ordered.includes(t));
  await writeTenants([...ordered, ...rest]);
}

/** 레지스트리에서만 지운다. 큐 파일은 손대지 않는다(DESIGN.md 제약 7). */
export async function removeTenant(id: string): Promise<void> {
  const tenants = await readTenants();
  await writeTenants(tenants.filter((t) => t.id !== id));
}

// ── 설정 해석 ───────────────────────────────────────────────────────────────

/** 워커 파일의 변수 → TenantConfig 필드. 이 5개만 본다. */
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

function parseWorker(text: string): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const line of text.split("\n")) {
    const m = ASSIGN_RE.exec(line);
    if (!m) continue;
    const field = KEYS[m[1] as keyof typeof KEYS];
    if (!field) continue;
    const v = shellValue(m[2]);
    if (v !== null) out[field] = v; // 뒤 할당이 이긴다(셸과 같다)
  }
  return out;
}

/** 테넌트의 실효 설정. `<루트>/personas`·`.wip`·`.done`을 가정하지 않고 워커 파일에서 읽는다.
 *  워커가 여러 개인데 값이 갈리면 첫 워커 값을 쓰고 conflicts에 양쪽을 담는다 —
 *  `TICKET_CWD`만 예외로 `cwdByWorker` 목록에 담고 충돌로 보지 않는다. */
export async function resolveConfig(tenant: Pick<Tenant, "root">): Promise<TenantConfig> {
  const root = tenant.root;
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
  const parsed: [string, Partial<Record<Field, string>>][] = [];
  for (const n of names) {
    const text = await readFile(path.join(dir, n), "utf8").catch(() => null);
    if (text !== null) parsed.push([n.slice(0, -3), parseWorker(text)]);
  }

  const config: TenantConfig = { ...defaults, cwdByWorker: {}, assumed: [], conflicts: [] };
  for (const field of Object.values(KEYS)) {
    const found = parsed.filter(([, kv]) => kv[field] !== undefined);
    // `TICKET_CWD`는 워커마다 갈리는 게 정상이다(워커마다 자기 git 워크트리) — 충돌이 아니라
    // 목록이다. 하나뿐이어도 담는다: 표기(워커명 생략 여부)를 화면이 정한다.
    if (field === "cwd") config.cwdByWorker = Object.fromEntries(found.map(([w, kv]) => [w, kv.cwd!]));
    if (found.length === 0) {
      config.assumed.push(field); // 워커에 없거나 해석 불가 — 어느 쪽이든 기본값을 쓴 것이다
      continue;
    }
    config[field] = found[0][1][field]!;
    if (field !== "cwd" && new Set(found.map(([, kv]) => kv[field])).size > 1) {
      config.conflicts.push({
        key: field,
        byWorker: Object.fromEntries(found.map(([w, kv]) => [w, kv[field]!])),
      });
    }
  }
  return config;
}

// ── 목록·전환기용 요약 ──────────────────────────────────────────────────────

/** 테넌트 목록 행과 전환기 항목이 쓰는 한 줄 요약. 못 읽으면 `connected: false` + 사유 원문이고
 *  카운트는 **0이 아니라 없음**이다(읽지 못한 것과 0건은 다른 사실이다 — DESIGN.md §4-1). */
export type TenantSummary = {
  connected: boolean;
  /** 연결 안 됨 사유 원문(`ENOENT: …`). §6 에러 3요소의 2번. 삼키지 않는다. */
  error: string | null;
  open: number | null; // 열린 티켓 수
  workers: Worker[];
};

/** 테넌트 하나를 훑는다. 경로가 없으면 읽기를 시도하지 않고 사유만 담는다.
 *
 *  ponytail: 티켓 파일을 전부 읽어 개수만 센다(listTickets 재사용). 테넌트가 한 자릿수고
 *  큐가 수십 건이라 이게 제일 싸다 — 수천 건 되면 파일명만 세는 경로를 따로 만든다. */
export async function readSummary(tenant: Pick<Tenant, "root">): Promise<TenantSummary> {
  try {
    const st = await stat(tenant.root);
    if (!st.isDirectory()) throw new Error(`디렉터리가 아니다: ${tenant.root}`);
    const config = await resolveConfig(tenant);
    const [tickets, workers] = await Promise.all([
      listTickets(tenant.root, config),
      listWorkers(tenant.root),
    ]);
    return {
      connected: true,
      error: null,
      open: tickets.filter((t) => t.state === "open").length,
      workers,
    };
  } catch (e) {
    return { connected: false, error: (e as Error).message, open: null, workers: [] };
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
 *  통과해도 문자열을 믿지 않고 `resolveWithin`으로 기준 디렉터리 안인지 확인한다(심링크 포함). */
async function profilePath(dir: string, name: string): Promise<string> {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `페르소나 이름은 영문·숫자·_·- 만 됩니다: ${name || "(비어 있음)"} — 엔진이 이 이름으로 <personas>/<이름>/PROFILE.md 경로를 만듭니다.`,
    );
  }
  return resolveWithin(dir, path.join(name, "PROFILE.md"));
}

/** 디렉터리에 있는 페르소나 ∪ 티켓이 부르는 페르소나. 이름 순.
 *
 *  ponytail: 이름 규칙(`NAME_RE`) 밖 디렉터리는 목록에서 뺀다 — 엔진이 그 이름으로 티켓을
 *  받아주지 않으므로(`persona_of`가 빈 문자열로 만든다) 절대 쓰이지 않는 디렉터리다. */
export async function listPersonas(dir: string, tickets: Ticket[] = []): Promise<Persona[]> {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = new Set(
    ents.filter((e) => e.isDirectory() && NAME_RE.test(e.name)).map((e) => e.name),
  );
  for (const t of tickets) if (t.persona) names.add(t.persona); // 프로필 없는 이름 = 엔진의 WARN
  return Promise.all(
    [...names].sort().map(async (name) => {
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
