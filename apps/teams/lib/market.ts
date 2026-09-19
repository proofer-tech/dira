/** 페르소나 마켓 저장소 — 자리와 `meta.json` 스키마, 목록·상세·즐겨찾기·설치 기록 읽기,
 *  배포(DESIGN.md §페르소나 마켓 §계약 §저장 자리 §배포, 티켓 `ad443849` · `44a57214`),
 *  가져오기(§가져오기, 티켓 `299a45d8`).
 *
 *  배포 쓰기(`deployPersona` · `deploySquad`, `44a57214`)와 가져오기 쓰기(`importPersona` ·
 *  `importSquad`, `299a45d8`)가 이 파일의 타입과 경로 함수를 나눠 받아 쓰되 자기 함수는 따로
 *  낸다 — 두 티켓이 같은 파일에 각자의 쓰기 함수를 더한다. 즐겨찾기 토글도 예외로 쓰기다
 *  (배포·가져오기와 무관한 화면 상태라 여기 둔다).
 *
 *  경로 조립은 `lib/paths.ts`의 기존 방어(`resolveWithin` · `NAME_RE` · `PROJECT_ID_RE`)를
 *  그대로 쓴다 — 새 방어를 따로 만들지 않는다. */
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NAME_RE, PROJECT_ID_RE, localDir, resolveWithin } from "./paths.ts";
import { personaNames, squadNames } from "./projects.ts";

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

/** 쓰기용 항목 디렉터리. 읽기 쪽 `itemDir`과 달리 기준 디렉터리(`market/personas` 등)가 아직
 *  없으면 먼저 만든다 — 마켓을 한 번도 안 쓴 머신에서 첫 배포가 이 함수를 지난다. */
async function itemDirForWrite(kind: MarketKind, owner: string, name: string): Promise<string> {
  if (!PROJECT_ID_RE.test(owner)) throw new Error(`잘못된 소유 프로젝트 id: ${owner}`);
  if (!NAME_RE.test(name)) throw new Error(`잘못된 이름: ${name}`);
  const root = marketKindRoot(kind);
  await mkdir(path.join(root, owner, name), { recursive: true });
  return resolveWithin(root, path.join(owner, name));
}

/** `meta.json`을 임시 파일에 쓴 뒤 `rename`으로 갈아 끼운다(§배포). */
async function writeMetaAtomic(dir: string, meta: MarketMeta): Promise<void> {
  const file = path.join(dir, "meta.json");
  const tmp = path.join(dir, `.meta.json.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
  await rename(tmp, file);
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

// ── 원본에서 보는 기록 (DESIGN.md §원본에서 보는 기록, 티켓 `1c06035e`) ────────────

/** 원본 화면(페르소나 상세·스쿼드 상세) 절 하나가 보여 주는 값 셋 — 배포 이력·가져간 기록·
 *  갱신 배지. `deploy`가 `null`이면 이 프로젝트가 그 이름으로 배포한 적이 없다(§원본에서 보는
 *  기록의 "아직 배포 안 함"). `update`는 이 페르소나-스쿼드가 마켓에서 가져온 것이고 원본이
 *  그 뒤 더 배포했을 때만 채워진다 — 그 밖에는 `null`이라 배지가 안 뜬다. */
export type MarketRecord = {
  deploy: { latest: number; versions: MarketVersion[] } | null;
  installs: MarketInstall[];
  update: { owner: string; name: string; installedVersion: number; latestVersion: number } | null;
};

/** 한 페르소나-스쿼드가 든 마켓 기록 전부를 한 번에 모은다. `owner`는 언제나 이 프로젝트
 *  자신이다(§계약 §항목 식별) — 배포 이력·가져간 기록은 이 프로젝트가 그 이름으로 마켓에 낸
 *  것만 본다. `importEntry`(레지스트리의 `market.personas/squads.<이름>`)가 있으면 그 원본
 *  항목의 최신 버전과 비교해 갱신 여부를 판정한다 — 없으면(가져온 적 없는 이름) `update`는
 *  항상 `null`이다. */
export async function marketRecord(
  kind: MarketKind,
  projectId: string,
  name: string,
  importEntry?: { owner: string; name: string; v: number },
): Promise<MarketRecord> {
  const [own, installs, source] = await Promise.all([
    getMarketItem(kind, projectId, name),
    listInstalls(kind, projectId, name),
    importEntry ? getMarketItem(kind, importEntry.owner, importEntry.name) : Promise.resolve(null),
  ]);
  const update =
    importEntry && source && needsUpdate(importEntry.v, source.latest)
      ? {
          owner: importEntry.owner,
          name: importEntry.name,
          installedVersion: importEntry.v,
          latestVersion: source.latest,
        }
      : null;
  return {
    deploy: own ? { latest: own.latest, versions: own.versions } : null,
    installs,
    update,
  };
}

// ── 배포 (DESIGN.md §배포) ───────────────────────────────────────────────────

/** 다음 버전 번호. 첫 배포가 `1`, 그 뒤로 `latest + 1`(§계약 §버전). 파일을 안 읽는 순수
 *  함수 — `meta.json`이 없으면(첫 배포) `latest`로 `null`을 넘긴다. */
export function nextVersion(latest: number | null): number {
  return latest === null ? 1 : latest + 1;
}

/** 스쿼드 멤버 중 같은 소유 프로젝트의 마켓에 없는 이름을 뽑는다(§배포 §스쿼드 배포 1).
 *  파일을 안 읽는 순수 함수 — 목록 둘을 호출자가 넘긴다. */
export function missingMarketMembers(memberNames: string[], marketPersonaNames: string[]): string[] {
  const have = new Set(marketPersonaNames);
  return memberNames.filter((n) => !have.has(n));
}

function requireNote(note: string): string {
  const trimmed = note.trim();
  if (trimmed === "") throw new Error("노트가 없으면 배포할 수 없다 — 한 줄을 적어야 한다");
  return trimmed;
}

function appendVersion(meta: MarketMeta | null, v: number, note: string): MarketVersion[] {
  return [...(meta?.versions ?? []), { v, at: new Date().toISOString(), note }];
}

/** 페르소나 배포 한 벌 — `PROFILE.md` + `skills.md`(§계약 §담는 것). 버전 디렉터리는
 *  `mkdir(recursive: false)`로 먼저 만든다 — 같은 번호가 이미 있으면 그 자리에서 실패한다.
 *  `meta.json`은 임시 파일에 쓴 뒤 `rename`으로 갈아 끼운다.
 *  // ponytail: 머신 한 대에서 사람이 누르는 버튼이라 잠금 장치를 안 둔다. 두 창이 같은 항목을
 *  동시에 배포하면 뒤엣것이 디렉터리 충돌로 실패하고 다시 누르면 된다.
 *
 *  `profile`이 `null`이면(`PROFILE.md`가 없는 페르소나) 던진다 — 담을 것이 없다(§배포).
 *  `skills`가 `null`이면 그 파일 없이 담는다 — 없는 것이 정상이다(`lib/skills.ts`). */
export async function deployPersona(
  owner: string,
  ownerName: string,
  name: string,
  files: { profile: string | null; skills: string | null },
  note: string,
  tags: string[],
): Promise<MarketMeta> {
  const trimmedNote = requireNote(note);
  if (files.profile === null) throw new Error(`${name}에 PROFILE.md가 없어 배포할 수 없다`);
  const dir = await itemDirForWrite("persona", owner, name);
  const meta = await readMeta(dir);
  const v = nextVersion(meta?.latest ?? null);
  const versionDir = path.join(dir, `v${v}`);
  await mkdir(versionDir, { recursive: false });
  await writeFile(path.join(versionDir, "PROFILE.md"), files.profile, "utf8");
  if (files.skills !== null) await writeFile(path.join(versionDir, "skills.md"), files.skills, "utf8");
  const nextMeta: MarketMeta = {
    kind: "persona",
    owner,
    ownerName,
    name,
    tags,
    latest: v,
    versions: appendVersion(meta, v, trimmedNote),
  };
  await writeMetaAtomic(dir, nextMeta);
  return nextMeta;
}

/** 스쿼드 배포 한 벌 — `members` 한 장(§계약 §담는 것). 버전 디렉터리·`meta.json` 규칙은
 *  `deployPersona`와 같다. 멤버 선행 배포는 이 함수가 안 한다 — 호출자(서버 액션)가
 *  `missingMarketMembers`로 뽑은 목록을 `deployPersona`로 하나씩 먼저 배포한 뒤 이 함수를
 *  부른다(§배포 §스쿼드 배포). */
export async function deploySquad(
  owner: string,
  ownerName: string,
  name: string,
  members: string,
  note: string,
  tags: string[],
): Promise<MarketMeta> {
  const trimmedNote = requireNote(note);
  const dir = await itemDirForWrite("squad", owner, name);
  const meta = await readMeta(dir);
  const v = nextVersion(meta?.latest ?? null);
  const versionDir = path.join(dir, `v${v}`);
  await mkdir(versionDir, { recursive: false });
  await writeFile(path.join(versionDir, "members"), members, "utf8");
  const nextMeta: MarketMeta = {
    kind: "squad",
    owner,
    ownerName,
    name,
    tags,
    latest: v,
    versions: appendVersion(meta, v, trimmedNote),
  };
  await writeMetaAtomic(dir, nextMeta);
  return nextMeta;
}

// ── 설치 기록 쓰기 ───────────────────────────────────────────────────────────

/** `installs.jsonl`에 한 줄 append(DESIGN.md §저장 자리 — "추가만 한다"). */
export async function appendInstall(install: MarketInstall): Promise<void> {
  await mkdir(marketDir(), { recursive: true });
  await appendFile(marketInstallsPath(), JSON.stringify(install) + "\n", "utf8");
}

// ── 가져오기 (DESIGN.md §가져오기, 티켓 `299a45d8`) ────────────────────────────

/** `members` 한 줄에서 이름만(첫 낱말) — 역할 문구는 필요 없는 자리라 `parseSquadMemberLine`
 *  (`projects.ts`)을 새로 안 부른다. 정규식은 그 함수의 이름 자리와 같다(첫 공백에서 자른다). */
export function squadMemberNames(membersText: string): string[] {
  return membersText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => /^(\S+)/.exec(l)![1]);
}

/** 스쿼드 멤버 중 대상 프로젝트에 아직 없는 이름 — 순수 함수(파일을 안 읽는다). 대상에 이미
 *  있는 이름은 로컬에서 고쳐 쓰던 페르소나일 수 있어 안 건드린다(DESIGN.md §가져오기). */
export function missingSquadMembers(memberNames: string[], existingPersonaNames: string[]): string[] {
  const existing = new Set(existingPersonaNames);
  return memberNames.filter((n) => !existing.has(n));
}

/** `importPersona` · `importSquad`가 실패를 가르는 이유. 문자열을 지어내지 않고 서버 액션이
 *  이 값으로 문구를 고른다.
 *  - `conflict`: 대상에 같은 이름이 이미 있는데 `overwrite`가 아니다 — 아무 파일도 안 썼다.
 *  - `notFound`: 마켓에 그런 항목(또는 `PROFILE.md`)이 없다.
 *  - `invalidName`: 받을 이름이 `NAME_RE`를 벗어난다. */
export type ImportReason = "conflict" | "notFound" | "invalidName";

export type ImportResult = { ok: true } | { ok: false; reason: ImportReason };

/** 페르소나 가져오기. `overwrite`가 없거나 `false`인데 대상에 같은 이름이 있으면 **아무 파일도
 *  안 쓰고** `conflict`를 돌려준다 — 호출자(서버 액션)가 사람에게 덮어쓰기/다른 이름을 물어
 *  `asName`이나 `overwrite`를 바꿔 다시 부른다. 덮어쓰기도 `PROFILE.md`·`skills.md` 둘만
 *  쓴다 — 대상의 `memory/`·`limit`·`engine`은 손대지 않는다(파일 둘 밖은 아예 건드리지 않는다). */
export async function importPersona(
  owner: string,
  name: string,
  targetPersonasDir: string,
  asName: string,
  overwrite = false,
): Promise<ImportResult> {
  if (!NAME_RE.test(asName)) return { ok: false, reason: "invalidName" };
  const item = await getMarketItem("persona", owner, name);
  if (!item || item.profile === null) return { ok: false, reason: "notFound" };
  if (!overwrite && (await personaNames(targetPersonasDir)).includes(asName)) {
    return { ok: false, reason: "conflict" };
  }
  await mkdir(targetPersonasDir, { recursive: true });
  const dest = await resolveWithin(targetPersonasDir, asName);
  await mkdir(dest, { recursive: true });
  await writeFile(path.join(dest, "PROFILE.md"), item.profile, "utf8");
  if (item.skills !== null) await writeFile(path.join(dest, "skills.md"), item.skills, "utf8");
  return { ok: true };
}

export type ImportSquadResult =
  | { ok: true; missingInMarket: string[] }
  | { ok: false; reason: ImportReason };

/** 스쿼드 가져오기. `members`를 원문 그대로 쓴다(줄 순서·첫 줄(리더) 보존 — 다시 조립하지
 *  않는다). 대상에 없는 멤버 페르소나는 같은 소유 프로젝트의 마켓 최신 버전으로 같이 가져오되
 *  대상에 이미 있는 이름은 건드리지 않는다(`missingSquadMembers`). 마켓에도 없는 멤버는
 *  `missingInMarket`에 담기고 가져오기 자체는 성공한다(엔진이 프로필 없는 멤버를 WARN으로
 *  넘기므로 큐가 멎지 않는다) — 멤버 쪽 `notFound`만 이렇게 삼키고, 그 밖의 이유(이름 규칙 위반
 *  등)는 없다: 멤버 이름은 `members` 파일에서 그대로 읽은 값이라 `NAME_RE`를 벗어나도 여기서는
 *  걸러지지 않고 `importPersona`가 `invalidName`으로 실패시키면 그 멤버도 조용히 건너뛴다 —
 *  마켓에 없는 것과 같은 결과라 목록을 하나로 합친다. */
export async function importSquad(
  owner: string,
  name: string,
  targetSquadsDir: string,
  targetPersonasDir: string,
  asName: string,
  overwrite = false,
): Promise<ImportSquadResult> {
  if (!NAME_RE.test(asName)) return { ok: false, reason: "invalidName" };
  const item = await getMarketItem("squad", owner, name);
  if (!item || item.members === null) return { ok: false, reason: "notFound" };
  if (!overwrite && (await squadNames(targetSquadsDir)).includes(asName)) {
    return { ok: false, reason: "conflict" };
  }

  const memberNames = squadMemberNames(item.members);
  const missing = missingSquadMembers(memberNames, await personaNames(targetPersonasDir));
  const missingInMarket: string[] = [];
  for (const member of missing) {
    const r = await importPersona(owner, member, targetPersonasDir, member, false);
    if (!r.ok) missingInMarket.push(member); // notFound(마켓에 없음)와 invalidName 둘 다 여기로
  }

  await mkdir(targetSquadsDir, { recursive: true });
  const dest = await resolveWithin(targetSquadsDir, asName);
  await mkdir(dest, { recursive: true });
  await writeFile(path.join(dest, "members"), item.members, "utf8");
  return { ok: true, missingInMarket };
}
