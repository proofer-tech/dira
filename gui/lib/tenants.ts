/** 테넌트 레지스트리 + 테넌트별 설정 해석 (DESIGN.md §테넌트, §테넌트별 설정 해석).
 *
 *  GUI는 큐 하나에 붙어 사는 게 아니라 사용자가 등록한 큐들을 전환하며 본다. 레지스트리는
 *  머신 로컬 JSON 한 파일이고, 큐 위치·접미사·페르소나 디렉터리는 전부 테넌트에서 받아온다. */
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { TENANT_ID_RE, expandHome } from "./paths.ts";

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
  cwd: string;
  /** 워커에서 못 읽어 기본값을 쓴 키. UI가 "기본값 가정"으로 표시할 근거다. */
  assumed: string[];
  /** 워커 간 값이 갈린 키. 엔진은 디스패치한 워커의 값을 쓰므로 실제 위험이다. */
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

/** 이름 → URL 조각 (DESIGN.md §테넌트 > `id` 슬러그 규칙).
 *  한글 이름이면 빈 문자열이 되는 게 정상이다 — 그때는 등록 폼이 id를 직접 받는다. */
export function slugify(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** 등록. 검증 4종을 서버에서 통과해야 저장한다 — 실패하면 무엇이 틀렸는지 문장으로 던진다. */
export async function addTenant(name: string, rootInput: string, id?: string): Promise<Tenant> {
  if (!name.trim()) throw new Error("이름이 비었다");
  const given = expandHome(rootInput.trim());
  if (!path.isAbsolute(given)) throw new Error(`절대경로여야 한다: ${rootInput}`);

  let root: string;
  try {
    root = await realpath(given);
  } catch {
    throw new Error(`디렉터리가 없다: ${given}`);
  }
  if (!(await stat(root)).isDirectory()) throw new Error(`디렉터리가 아니다: ${root}`);
  const inside = await readdir(root).catch(() => [] as string[]);
  if (!inside.includes("tickets") && !inside.includes("workers")) {
    throw new Error(`큐로 보이지 않는다(tickets/ 도 workers/ 도 없다): ${root}`);
  }

  const tenants = await readTenants();
  const dup = tenants.find((t) => t.root === root);
  if (dup) throw new Error(`같은 큐가 이미 등록돼 있다: ${dup.name} (${root})`);

  // id는 이름에서 만들되, 비거나 겹치면 자동으로 지어내지 않는다 — `tenant-1` 같은 값은 URL이
  // 의미를 잃는다. 등록 폼이 그때만 `URL 조각` 입력을 노출하고 사용자가 정한다.
  const tid = id ?? slugify(name);
  if (!TENANT_ID_RE.test(tid) || tid.length > 40) {
    throw new Error(
      id
        ? `URL 조각 형식이 틀렸다(^[a-z0-9-]{1,40}$): ${id}`
        : `이름에서 URL 조각을 만들 수 없다: ${name} — URL 조각을 직접 정해야 한다`,
    );
  }
  if (tenants.some((t) => t.id === tid)) {
    throw new Error(`URL 조각이 이미 있다: ${tid} — 다른 값을 정해야 한다`);
  }

  const tenant: Tenant = { id: tid, name: name.trim(), root };
  await writeTenants([...tenants, tenant]);
  return tenant;
}

export async function renameTenant(id: string, name: string): Promise<void> {
  if (!name.trim()) throw new Error("이름이 비었다");
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

/** 셸 값 한 줄을 해석한다. 해석 못 하면 null(호출자가 기본값 + assumed로 처리).
 *
 *  **셸을 실행하지 않는다.** 등록된 경로의 임의 코드가 GUI 권한으로 도는 걸 막는 게 이 함수의
 *  존재 이유다(DESIGN.md §결정 기록). 그 대가로 `$HOME` 말고 다른 변수는 못 읽는다. */
export function shellValue(raw: string): string | null {
  const s = raw.trimStart();
  let v: string;
  if (s.startsWith("'")) {
    const e = s.indexOf("'", 1);
    if (e < 0) return null;
    return s.slice(1, e) || null; // 작은따옴표 안은 치환 없음(셸과 같다)
  } else if (s.startsWith('"')) {
    const e = s.indexOf('"', 1);
    if (e < 0) return null;
    v = s.slice(1, e);
  } else {
    v = s.split(/[ \t#]/)[0];
  }
  v = v.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, homedir());
  if (/\$[A-Za-z_{]/.test(v)) return null; // 남은 변수 참조 = 해석 실패
  return v || null; // 빈 값은 미설정과 같다(tickets.py도 `or 기본값`)
}

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
 *  워커가 여러 개인데 값이 갈리면 첫 워커 값을 쓰고 conflicts에 양쪽을 담는다. */
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

  const config: TenantConfig = { ...defaults, assumed: [], conflicts: [] };
  for (const field of Object.values(KEYS)) {
    const found = parsed.filter(([, kv]) => kv[field] !== undefined);
    if (found.length === 0) {
      config.assumed.push(field); // 워커에 없거나 해석 불가 — 어느 쪽이든 기본값을 쓴 것이다
      continue;
    }
    config[field] = found[0][1][field]!;
    if (new Set(found.map(([, kv]) => kv[field])).size > 1) {
      config.conflicts.push({
        key: field,
        byWorker: Object.fromEntries(found.map(([w, kv]) => [w, kv[field]!])),
      });
    }
  }
  return config;
}
