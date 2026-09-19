/** 페르소나 마켓 저장소 — 자리와 `meta.json` 스키마, 목록·상세·즐겨찾기·설치 기록 읽기
 *  (DESIGN.md §페르소나 마켓 §계약 §저장 자리, 티켓 `ad443849`).
 *
 *  이 파일은 **읽기만** 한다 — 배포(`44a57214`)와 가져오기(`299a45d8`)가 여기 든 타입과
 *  경로 함수를 그대로 받아 쓴다. 즐겨찾기 토글만 예외로 쓰기다(배포·가져오기와 무관한
 *  화면 상태라 여기 둔다).
 *
 *  경로 조립은 `lib/paths.ts`의 기존 방어(`resolveWithin` · `NAME_RE` · `PROJECT_ID_RE`)를
 *  그대로 쓴다 — 새 방어를 따로 만들지 않는다. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NAME_RE, PROJECT_ID_RE, localDir, resolveWithin } from "./paths.ts";

export type MarketKind = "persona" | "squad";

export type MarketVersion = { v: number; at: string; note: string };

/** `meta.json` 한 장의 모양 그대로(DESIGN.md §저장 자리). */
export type MarketMeta = {
  kind: MarketKind;
  owner: string;
  ownerName: string;
  name: string;
  tags: string[];
  latest: number;
  versions: MarketVersion[];
};

export type MarketItem = MarketMeta & {
  id: string; // `${kind}:${owner}/${name}` — favorites.json과 같은 모양
  favorite: boolean;
};

export type MarketItemDetail = MarketItem & {
  profile: string | null; // PROFILE.md 본문(페르소나). 스쿼드는 null
  skills: string | null; // skills.md 본문(페르소나). 없으면 null, 스쿼드는 null
  members: string | null; // members 본문(스쿼드). 페르소나는 null
};

export type MarketInstall = {
  at: string;
  kind: MarketKind;
  owner: string;
  name: string;
  v: number;
  project: string;
  as: string;
};

// ── 저장 자리 ────────────────────────────────────────────────────────────────

/** `~/.config/dira/market/` — 레지스트리·토큰·키맵과 같은 디렉터리(`localDir()`). */
export function marketDir(): string {
  return path.join(localDir(), "market");
}

function marketKindRoot(kind: MarketKind): string {
  return path.join(marketDir(), kind === "persona" ? "personas" : "squads");
}

export function marketInstallsPath(): string {
  return path.join(marketDir(), "installs.jsonl");
}

function favoritesPath(): string {
  return path.join(marketDir(), "favorites.json");
}

/** `${kind}:${owner}/${name}` — `favorites.json`이 이미 쓰는 그 모양(DESIGN.md §저장 자리). */
export function marketItemId(kind: MarketKind, owner: string, name: string): string {
  return `${kind}:${owner}/${name}`;
}

const ITEM_ID_RE = /^(persona|squad):([^/]+)\/(.+)$/;

/** `marketItemId`의 역함수. 모양이 아니면 `null`(오류로 던지지 않는다 — 즐겨찾기 목록에
 *  낯선 문자열이 섞여도 그 한 줄만 무시하고 나머지는 산다). */
export function parseMarketItemId(id: string): { kind: MarketKind; owner: string; name: string } | null {
  const m = ITEM_ID_RE.exec(id);
  return m ? { kind: m[1] as MarketKind, owner: m[2], name: m[3] } : null;
}

/** 항목 디렉터리. 소유 프로젝트 id와 이름 둘 다 신뢰 경계 입력이라 `resolveWithin`을 지난다.
 *  기준 디렉터리(`market/personas` 또는 `market/squads`)가 아직 없으면(마켓을 한 번도 안 쓴
 *  머신) `resolveWithin`이 던진다 — 여기서는 `null`로 삭혀 "아직 없다"와 "탈출 시도"를
 *  호출자에게 같은 값(없음)으로 돌려준다. 둘 다 파일 접근을 안 주므로 안전하다. */
async function itemDir(kind: MarketKind, owner: string, name: string): Promise<string | null> {
  if (!PROJECT_ID_RE.test(owner) || !NAME_RE.test(name)) return null;
  try {
    return await resolveWithin(marketKindRoot(kind), path.join(owner, name));
  } catch {
    return null;
  }
}

async function readMeta(dir: string): Promise<MarketMeta | null> {
  try {
    const raw = await readFile(path.join(dir, "meta.json"), "utf8");
    return JSON.parse(raw) as MarketMeta;
  } catch {
    return null;
  }
}

// ── 목록 · 상세 ──────────────────────────────────────────────────────────────

/** 디렉터리 항목 중 이름 규칙을 지키는 것만. `personaNames`(`projects.ts`)와 같은 이유 —
 *  규칙 밖 디렉터리는 절대 유효한 항목이 될 수 없다. */
async function subdirNames(dir: string, re: RegExp): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory() && re.test(e.name)).map((e) => e.name);
}

/** 마켓 항목 목록. `kind`를 안 주면 페르소나 + 스쿼드 둘 다. 마켓 디렉터리가(또는 그 안의
 *  `personas`/`squads`가) 없으면 빈 목록 — 마켓을 한 번도 안 쓴 머신의 정상 상태다. */
export async function listMarketItems(kind?: MarketKind): Promise<MarketItem[]> {
  const kinds: MarketKind[] = kind ? [kind] : ["persona", "squad"];
  const favorites = new Set(await readFavorites());
  const items = await Promise.all(
    kinds.flatMap(async (k) => {
      const root = marketKindRoot(k);
      const owners = await subdirNames(root, PROJECT_ID_RE);
      return (
        await Promise.all(
          owners.map(async (owner) => {
            const names = await subdirNames(path.join(root, owner), NAME_RE);
            return Promise.all(
              names.map(async (name) => {
                const meta = await readMeta(path.join(root, owner, name));
                if (!meta) return null;
                const id = marketItemId(k, owner, name);
                return { ...meta, id, favorite: favorites.has(id) } satisfies MarketItem;
              }),
            );
          }),
        )
      ).flat();
    }),
  );
  return items.flat().filter((x): x is MarketItem => x !== null);
}

/** 항목 상세: 최신 버전의 본문 + 버전 목록. 없는 항목이거나 `meta.json`이 깨졌으면 `null` —
 *  오류가 아니라 "그런 항목이 없다"다. */
export async function getMarketItem(
  kind: MarketKind,
  owner: string,
  name: string,
): Promise<MarketItemDetail | null> {
  const dir = await itemDir(kind, owner, name);
  if (!dir) return null;
  const meta = await readMeta(dir);
  if (!meta) return null;
  const versionDir = path.join(dir, `v${meta.latest}`);
  const readOrNull = (file: string) => readFile(path.join(versionDir, file), "utf8").catch(() => null);
  const [profile, skills, members] = await Promise.all([
    kind === "persona" ? readOrNull("PROFILE.md") : Promise.resolve(null),
    kind === "persona" ? readOrNull("skills.md") : Promise.resolve(null),
    kind === "squad" ? readOrNull("members") : Promise.resolve(null),
  ]);
  const id = marketItemId(kind, owner, name);
  return { ...meta, id, favorite: (await readFavorites()).includes(id), profile, skills, members };
}

// ── 설치 기록 ────────────────────────────────────────────────────────────────

/** `installs.jsonl`에서 이 항목이 가져간 줄만. 파일이 없으면 빈 목록, 깨진 줄은 건너뛰되
 *  나머지 줄은 산다(`lastRateLimits`의 그 관용구, `usage.ts`). */
export async function listInstalls(kind: MarketKind, owner: string, name: string): Promise<MarketInstall[]> {
  const text = await readFile(marketInstallsPath(), "utf8").catch(() => "");
  const out: MarketInstall[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as MarketInstall;
      if (rec.kind === kind && rec.owner === owner && rec.name === name) out.push(rec);
    } catch {
      // 쓰는 중인 줄이거나 손상된 줄이다 — 사유를 지어내지 않고 건너뛴다.
    }
  }
  return out;
}

// ── 즐겨찾기 ─────────────────────────────────────────────────────────────────

export async function readFavorites(): Promise<string[]> {
  const text = await readFile(favoritesPath(), "utf8").catch(() => null);
  if (text === null) return [];
  try {
    const arr: unknown = JSON.parse(text);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 있으면 빼고 없으면 더한다. 갱신된 배열을 그대로 돌려준다(화면이 다시 읽지 않아도 되게). */
export async function toggleFavorite(id: string): Promise<string[]> {
  const list = await readFavorites();
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  await mkdir(marketDir(), { recursive: true });
  await writeFile(favoritesPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

// ── 갱신 배지 ────────────────────────────────────────────────────────────────

/** 설치된 버전이 최신보다 낮으면 갱신이 있다. 파일을 안 읽는 순수 함수 — 레지스트리의
 *  설치 버전과 이 항목의 `meta.json.latest`를 호출자가 골라 넘긴다. */
export function needsUpdate(installedVersion: number, latest: number): boolean {
  return installedVersion < latest;
}
