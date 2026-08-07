/** Claude 장기 토큰 — 상태 읽기 · 저장 (DESIGN.md §0-4).
 *
 *  **엔진은 한 줄도 안 고친다**(제약 1). 여기가 하는 일은 `tick.sh:52-54`가 이미 정한 계약을
 *  따라 쓰는 것뿐이다 — 경로 `$TICKET_LOCAL/oauth-token`, 내용은 **개행 없는 한 줄**, 권한 `0600`.
 *  `.authwarn`은 건드리지 않는다: 엔진이 "이미 한 번 경고했다"를 적어 두는 자기 파일이고,
 *  토큰이 생기면 61행 조건이 먼저 꺼져 다시 보지 않는다(§0-4). */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isMultiToken } from "./flags.ts";
import { DEFAULT_LOCALE, t as translate, type Locale } from "./i18n.ts";
import { registryPath } from "./projects.ts";

/** 레지스트리와 **같은 디렉터리**다(엔진의 `$LOCAL`). 규칙을 두 벌로 적지 않으려고
 *  `registryPath()`에서 파생시킨다 — `TICKET_LOCAL` 존중도 거기 한 곳에만 있다. */
export function tokenPath(): string {
  return path.join(path.dirname(registryPath()), "oauth-token");
}

export type AuthStatus = {
  path: string;
  /** 파일이 없으면 `null`. 있으면 mtime을 CLI `list`와 같은 표기로.
   *  **유효한지는 판정하지 않는다** — 다음 디스패치에서 드러난다(§0-4). */
  savedAt: string | null;
  /** 준비물 층 ⓪ — `claude` 실행파일의 절대경로, 없으면 `null`(§0-4 ⓪).
   *  버전을 묻지 않는다: 서버 렌더에 남의 프로세스를 붙이지 않는다. */
  cli: string | null;
};

export async function readAuth(): Promise<AuthStatus> {
  const p = tokenPath();
  const s = await stat(p).catch(() => null);
  // 층 ②가 몰 대상을 고르는 **그 함수** 그대로다 — 두 벌로 적으면 "있다고 했는데 눌렀더니
  // 없다"가 생긴다(§0-4 ⓪). PATH 훑기 몇 회라 서버 렌더에 붙여도 싸다.
  return { path: p, savedAt: s?.isFile() ? when(s.mtime) : null, cli: findClaude() };
}

// ── 다른 엔진의 상태 층 — 사실 둘만, 판정은 안 한다 (§0-4 §개정 `b0966e66`) ──────────
//
// §4-3 카탈로그(claude·codex·grok·agy)와 엔진 선택 컨트롤이 서면서, 엔진을 고르는 사람이
// 인증이 섰는지 볼 자리가 이 다이얼로그에 없었다. 여기서 여는 것은 **상태 층뿐**이다 —
// `login status`류 서브프로세스를 부르지 않고, `auth.json`의 JWT `exp`도 읽지 않는다
// (그 값을 재는 것은 아직 안 여는 발급·관리 층의 일이다).

export type OtherEngine = "codex" | "grok" | "agy";

/** 실행파일 이름 = §4-3 템플릿의 첫 토큰. 엔진이 하나 늘면 이 표에만 더한다. */
const OTHER_ENGINE_BINS: Record<OtherEngine, string> = { codex: "codex", grok: "grok", agy: "agy" };

/** codex·grok의 자격증명 파일 자리(§4-3 §개정 표). agy는 파일이 아니라 macOS 키체인이라
 *  여기 없다 — `readOtherEngineAuth`가 그 엔진만 상시 문구로 답한다. */
const CRED_FILE: Partial<Record<OtherEngine, string>> = {
  codex: path.join(".codex", "auth.json"),
  grok: path.join(".grok", "auth.json"),
};

export type OtherEngineAuth = {
  engine: OtherEngine;
  /** `findExecutable(bin)`과 같은 값 — 없으면 `null`(§0-4 ⓪과 같은 축). */
  cli: string | null;
  /** 자격증명 파일의 절대경로. agy는 항상 `null`이다. */
  credPath: string | null;
  credMtime: string | null;
};

/** `home`은 테스트가 픽스처 디렉터리로 갈아 끼우는 자리다(`usage.ts`의 `root` 기본 인자와
 *  같은 관용구) — 실제 홈을 밟지 않고 파일 유무 두 갈래를 잰다. */
export async function readOtherEngineAuth(home = homedir()): Promise<OtherEngineAuth[]> {
  return Promise.all(
    (Object.keys(OTHER_ENGINE_BINS) as OtherEngine[]).map(async (engine) => {
      const rel = CRED_FILE[engine];
      const credPath = rel ? path.join(home, rel) : null;
      const s = credPath ? await stat(credPath).catch(() => null) : null;
      return {
        engine,
        cli: findExecutable(OTHER_ENGINE_BINS[engine]),
        credPath: s ? credPath : null,
        credMtime: s ? when(s.mtime) : null,
      };
    }),
  );
}

/** 붙여 넣은 값을 저장할 형태로 만든다. 못 쓰면 사유를 던진다.
 *
 *  **검증은 "비어 있지 않다 · 공백과 개행이 없다"까지다.** 접두사(`sk-ant-oat…`)로 거르지
 *  않는다 — 그 형식은 우리 것이 아니고 바뀌면 멀쩡한 토큰을 GUI가 거부한다(§0-4).
 *  바깥 공백은 떨어낸다: 복사하면 줄바꿈이 딸려 오고 엔진도 `tr -d '\r\n'`으로 지운다. */
export function normalizeToken(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("토큰이 비어 있습니다.");
  if (/\s/.test(t)) throw new Error("토큰 안에 공백·줄바꿈이 있습니다. 한 줄만 붙여 넣어 주세요.");
  return t;
}

/** 덮어쓴다 — 토큰은 하나뿐이라 이력을 남길 자리가 없다(§0-4 재발급 항).
 *  `writeFile`의 `mode`는 **새로 만들 때만** 먹는다. 재발급이 기존 파일에 쓰면 그때 권한이
 *  안 바뀌므로 `chmod`를 따로 부른다 — 0600은 이 파일의 요건이다. */
export async function saveToken(token: string): Promise<void> {
  const p = tokenPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, token, { mode: 0o600 });
  await chmod(p, 0o600);
}

// ── 여러 계정 — `tokens.json` 그릇, `oauth-token`은 파생값이다 (DESIGN.md §0-13) ────
//
// **정본은 여기 하나다.** `oauth-token`은 `active`가 가리키는 토큰의 내용을 그대로 받는
// 파생 파일이고, 엔진 계약(개행 없는 한 줄 · `0600` · 같은 경로)은 `saveToken()` 그대로다 —
// `tokens.json`을 엔진은 보지도 않는다.

/** §0-13 §자리의 JSON 항목 그대로. `label`은 선택이고 `exhaustedUntil`은 자동 회전(P169-3)만 쓴다. */
export type TokenEntry = {
  id: string;
  label?: string;
  token: string;
  addedAt: string;
  enabled: boolean;
  exhaustedUntil: number | null;
};

type ClaudeTokens = { active: string; tokens: TokenEntry[] };
/** claude 하나만 다룬다(§0-13 §범위) — 최상위 키는 다른 엔진이 자격증명을 우리 파일로 가질 때를
 *  위해 미리 산다. 오늘은 `claude` 밖의 키를 아무도 안 쓴다. */
export type TokensFile = { claude?: ClaudeTokens };

/** 레지스트리·`oauth-token`·키맵과 **같은 디렉터리**다. `tokenPath()`와 같은 한 줄. */
export function tokensPath(): string {
  return path.join(path.dirname(registryPath()), "tokens.json");
}

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function newEntry(token: string, label?: string): TokenEntry {
  return { id: tokenId(token), label, token, addedAt: new Date().toISOString(), enabled: true, exhaustedUntil: null };
}

/** §0-13 §상태의 그 한 줄 — **여기 한 곳에만** 있다. P169-2(화면)·P169-3(회전)·P169-4(알림) 셋이
 *  전부 이 함수를 부른다. 두 벌로 적으면 화면은 "쓸 게 남았다"는데 회전은 안 도는 상태가 생긴다. */
export function isEligible(
  t: Pick<TokenEntry, "enabled" | "exhaustedUntil">,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  return t.enabled && (t.exhaustedUntil == null || t.exhaustedUntil <= nowSec);
}

/** 없음·깨짐·객체 아님 셋 다 `{}`다 — `analytics.ts`의 `readSettings`와 같은 관용구. */
async function readTokensFile(): Promise<TokensFile> {
  try {
    const o: unknown = JSON.parse(await readFile(tokensPath(), "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as TokensFile) : {};
  } catch {
    return {};
  }
}

/** `writeFile`의 `mode`는 새로 만들 때만 먹는다 — `saveToken()`과 같은 이유로 `chmod`를
 *  따로 부른다. 이 파일은 비밀을 **여러 개** 담으므로 `oauth-token`과 같은 등급인 `0600`이다. */
async function writeTokensFile(next: TokensFile): Promise<void> {
  const p = tokensPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await chmod(p, 0o600);
}

/** `oauth-token`은 여기서만 다시 쓴다. eligible이 하나도 없으면 지운다 →
 *  §0-4의 `Claude 토큰이 없습니다`가 저절로 선다(§0-13 §상태). */
async function syncOauthToken(file: TokensFile): Promise<void> {
  const engine = file.claude;
  if (!engine || !engine.tokens.some((t) => isEligible(t))) {
    await rm(tokenPath(), { force: true });
    return;
  }
  const active = engine.tokens.find((t) => t.id === engine.active);
  if (active) await saveToken(active.token);
}

/** `tokens.json`에 쓰는 유일한 통로. `active`가 바뀌든 상태가 바뀌든 이 함수를 지나가면
 *  `oauth-token` 파생값이 저절로 맞는다 — P169-2·3·4는 다음 상태를 만들어 여기 넘기기만 한다. */
export async function writeTokens(file: TokensFile): Promise<void> {
  await writeTokensFile(file);
  await syncOauthToken(file);
}

/** 지금 `oauth-token`의 내용. 없거나 `normalizeToken`이 거부하면(빈 파일 등) `null` —
 *  마이그레이션도 손편집 판정도 이 경우는 건너뛴다. */
async function currentOauthToken(): Promise<string | null> {
  const raw = await readFile(tokenPath(), "utf8").catch(() => null);
  if (raw == null) return null;
  try {
    return normalizeToken(raw);
  } catch {
    return null;
  }
}

/** 읽을 때마다 두 보정을 먼저 맞춘다 — 부르는 쪽은 어느 쪽도 몰라도 된다(§0-13 §자리).
 *  ① `tokens.json`이 없고 `oauth-token`만 있으면 그 값을 항목 하나로 들여온다(마이그레이션.
 *     **잃는 것이 0이다** — 지금 도는 큐의 인증이 그 파일 하나다).
 *  ② 목록 어디에도 없는 `oauth-token` 값이면(사람이 손으로 고쳤다) 덮어쓰지 않고 새 항목으로
 *     들여와 활성화한다. */
export async function readTokens(): Promise<TokensFile> {
  const file = await readTokensFile();
  const current = await currentOauthToken();
  if (current == null) return file;

  if (!file.claude) {
    const entry = newEntry(current);
    const next: TokensFile = { claude: { active: entry.id, tokens: [entry] } };
    await writeTokens(next);
    return next;
  }

  if (!file.claude.tokens.some((t) => t.token === current)) {
    const entry = newEntry(current);
    const next: TokensFile = { claude: { active: entry.id, tokens: [...file.claude.tokens, entry] } };
    await writeTokens(next);
    return next;
  }

  return file;
}

/** 추가한다 — 같은 토큰이면 항목이 늘지 않는다(같은 `id`).
 *
 *  **`active`는 안 건드린다** — `reconcileActive`에 맡긴다(§0-13 §화면, P179 뒤집힘). eligible한
 *  활성이 이미 있으면(중복 추가 포함) 그 자리에 머물고 새 항목은 `대기`로 들어간다. eligible이
 *  하나도 없을 때만(첫 토큰 · 전부 소진/비활성) 방금 넣은 항목이 그 판정으로 활성이 된다 —
 *  판정을 두 벌로 적지 않는다. 지금 쓸 토큰을 사람이 직접 고르는 손은 `setActiveToken`이다.
 *
 *  **잠금(§0-13 §잠금 계약 ①)에서는 append가 아니라 `active` 자리 교체다.** 이미 아는 토큰이면
 *  그 자리를 그대로 활성으로 삼고(항목 0개 변화), 새 토큰이면 지금 `active`가 앉은 인덱스를
 *  새 항목으로 갈아 끼운다 — 배열 길이가 안 늘어난다. 다른 인덱스의 항목(계약 ③이 지키는
 *  대상)은 안 건드린다. */
export async function addToken(raw: string, label?: string): Promise<TokenEntry> {
  const token = normalizeToken(raw);
  const id = tokenId(token);
  const file = await readTokens();
  const tokens = file.claude?.tokens ?? [];
  const existing = tokens.find((t) => t.id === id);

  if (!isMultiToken()) {
    if (existing) {
      await writeTokens({ claude: { active: existing.id, tokens } });
      return existing;
    }
    const entry = newEntry(token, label);
    const activeIdx = tokens.findIndex((t) => t.id === (file.claude?.active ?? ""));
    const replaceIdx = activeIdx >= 0 ? activeIdx : 0;
    const nextTokens = tokens.length === 0 ? [entry] : tokens.map((t, i) => (i === replaceIdx ? entry : t));
    await writeTokens({ claude: { active: entry.id, tokens: nextTokens } });
    return entry;
  }

  const entry = existing ?? newEntry(token, label);
  const nextTokens = existing ? tokens : [...tokens, entry];
  const active = reconcileActive(file.claude?.active ?? "", nextTokens);
  await writeTokens({ claude: { active, tokens: nextTokens } });
  return entry;
}

// ── 화면 — 목록 하나, 값은 가린다 (DESIGN.md §0-13 §화면 · P169-2) ────────────

/** 값 전체를 그리지 않는다 — `복사` 버튼도 만들지 않는다(§0-13 §화면). 짧으면 전부 가린다. */
function maskToken(token: string): string {
  return token.length <= 14 ? "•".repeat(token.length) : `${token.slice(0, 10)}…${token.slice(-4)}`;
}

/** §0-13 §화면의 네 상태. `대기`·`비활성`·`소진`은 `isEligible`의 두 축이고 `활성`은 지금
 *  `oauth-token`에 있는 것(`active`가 가리키는 항목) 하나뿐이다 — 축을 새로 안 만든다. */
export type TokenStatus =
  | { kind: "active" }
  | { kind: "pending" }
  | { kind: "disabled" }
  | { kind: "exhausted"; resumesAt: string };

export type TokenRow = {
  id: string;
  label: string;
  /** 실제로 저장된 값(없으면 빈 문자열) — 편집 칸의 초기값이다. `label`은 표시용
   *  순번 대체가 섞여 있어 그대로 프리필하면 "계정 1"이 문자 그대로 저장돼 버린다. */
  rawLabel: string;
  masked: string;
  addedAt: string;
  status: TokenStatus;
};

/** 화면이 그리는 목록 그대로 — 원문 토큰은 여기서 나가지 않는다(가린 문자열만).
 *
 *  **잠금(§0-13 §잠금 계약 ②)에서는 행이 최대 하나다** — `active`가 가리키는 항목만 낸다.
 *  `tokens.json`이 이미 여러 개를 담고 있어도(계약 ③) 나머지는 파일에 그대로 남을 뿐 화면에
 *  안 나온다.
 *
 *  라벨 없는 행의 표시 이름(`계정 N` · `Account N`)이 로케일을 타므로 `locale`을 받는다 —
 *  파일을 읽는 것은 서버 액션 쪽(`readLanguage()`)이고 이 함수는 값만 받는다. 기본값이 있는 것은
 *  테스트·스크립트가 한국어 기준으로 부르기 때문이다(§0-16 §설정 노드). */
export async function readTokenRows(locale: Locale = DEFAULT_LOCALE): Promise<TokenRow[]> {
  const file = await readTokens();
  const engine = file.claude;
  if (!engine) return [];
  const now = Math.floor(Date.now() / 1000);
  const source = isMultiToken() ? engine.tokens : engine.tokens.filter((t) => t.id === engine.active);
  return source.map((t, i) => ({
    id: t.id,
    label: t.label ?? `${translate(locale, "settings.tokens.accountFallbackPrefix")} ${i + 1}`,
    rawLabel: t.label ?? "",
    masked: maskToken(t.token),
    addedAt: when(new Date(t.addedAt)),
    // `active`가 가리키는 항목이어도 **eligible이 아니면 활성이 아니다** — eligible이 하나도
    // 없을 때 `active`는 되돌릴 값이 없어 그 자리에 머물지만(reconcileActive), 그때 `oauth-token`은
    // `writeTokens`가 이미 지웠다(§0-13 §상태). 가리키는 값과 실제로 쓰이는 값이 갈리는 그 한
    // 경우를 여기서 놓치면 방금 끈 토큰이 화면에 계속 `활성`으로 남는다.
    status:
      t.id === engine.active && isEligible(t, now)
        ? { kind: "active" }
        : !t.enabled
          ? { kind: "disabled" }
          : t.exhaustedUntil != null && t.exhaustedUntil > now
            ? { kind: "exhausted", resumesAt: when(new Date(t.exhaustedUntil * 1000)) }
            : { kind: "pending" },
  }));
}

/** `active`가 여전히 eligible이면 그대로 두고, 아니면 다음 eligible로 넘긴다(§0-13 §상태 —
 *  "활성 토큰을 비활성화·삭제하면 그 자리에서 다음 eligible로 넘어간다"). 하나도 없으면
 *  손대지 않는다 — eligible 0이면 `writeTokens`가 그 경우 `oauth-token`을 지운다. */
function reconcileActive(active: string, tokens: TokenEntry[]): string {
  const current = tokens.find((t) => t.id === active);
  if (current && isEligible(current)) return active;
  return tokens.find((t) => isEligible(t))?.id ?? active;
}

/** 행의 `활성화`/`비활성화` 버튼 — `enabled`만 바꾼다(§0-13 §상태: 이 축은 사람만 쓴다).
 *  `oauth-token` 쓰기는 `writeTokens` 안에서만 일어난다 — 이 함수도, 부르는 화면도 직접 쓰지 않는다. */
export async function setTokenEnabled(id: string, enabled: boolean): Promise<void> {
  const file = await readTokens();
  const engine = file.claude;
  if (!engine) return;
  const tokens = engine.tokens.map((t) => (t.id === id ? { ...t, enabled } : t));
  await writeTokens({ claude: { active: reconcileActive(engine.active, tokens), tokens } });
}

/** 행의 `사용` 버튼 — 지금 쓸 토큰을 사람이 직접 고른다(§0-13 §화면 · P179). `대기` 행에만
 *  붙는 버튼이라 대상은 이미 eligible이지만, 목록에 없는 id가 오면 조용히 무시한다(방어).
 *  `비활성`·`소진`을 이걸로 활성화하지 않는다 — 화면이 애초에 그 행엔 버튼을 안 그린다. */
export async function setActiveToken(id: string): Promise<void> {
  const file = await readTokens();
  const engine = file.claude;
  if (!engine || !engine.tokens.some((t) => t.id === id)) return;
  await writeTokens({ claude: { active: id, tokens: engine.tokens } });
}

/** 행의 라벨 편집(P180-1, §0-13 §라벨). `label`만 간다 — `active`도 손대지 않는다(다른 축과
 *  무관하다). 빈 값(trim 후)이면 키를 지운다 — `readTokenRows`의 `label ?? 계정 N`이 되살아난다. */
export async function setTokenLabel(id: string, label: string): Promise<void> {
  const file = await readTokens();
  const engine = file.claude;
  if (!engine) return;
  const trimmed = label.trim();
  const tokens = engine.tokens.map((t) => (t.id === id ? { ...t, label: trimmed || undefined } : t));
  await writeTokens({ claude: { active: engine.active, tokens } });
}

/** 행의 `삭제` 버튼 — 마지막 하나를 지워도 막지 않는다(§0-13 §상태). */
export async function deleteToken(id: string): Promise<void> {
  const file = await readTokens();
  const engine = file.claude;
  if (!engine) return;
  const tokens = engine.tokens.filter((t) => t.id !== id);
  const active = tokens.length ? reconcileActive(engine.active, tokens) : "";
  await writeTokens({ claude: { active, tokens } });
}

// ── ② 발급 — `claude setup-token`을 GUI가 pty로 몬다 (§0-4) ─────────────────

/** pty 한 덩어리를 **사람이 읽을 줄**로 바꾼다. 출력이 Ink TUI라 낱말 사이가 공백이 아니라
 *  커서 이동(`Opening\x1b[12Gbrowser`)이다 — 통째로 걷어내면 `Openingbrowser`가 된다.
 *  그래서 **가로 이동만 공백 한 칸으로 바꾸고** 나머지 escape를 지운다.
 *
 *  덩어리가 아니라 **누적 원문 전체**를 받는다. 매 폴링마다 다시 계산하는 대신 청크 경계에서
 *  잘린 escape를 이어 붙이는 상태를 안 들고 다니려는 것이다(원문은 수 KB고 120초 뒤 끝난다).
 *  ponytail: 이동 폭(`[46G`)을 공백 하나로 접는다 — 진행 로그지 터미널 재현이 아니다.
 *  배너 아스키아트를 지우는 것도 이 규칙이다(글자·숫자가 없는 줄은 버린다). */
export function ptyLines(raw: string): string[] {
  const text = raw
    // OSC — 색 질의(`\x1b]11;?`)와 하이퍼링크(`\x1b]8;;<URL>`). URL은 눈에 보이는 본문으로도
    // 한 번 더 나오므로 여기서 버려도 로그에서 사라지지 않는다
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;]*[GC]/g, " ") // CHA·CUF = 낱말 사이 간격
    .replace(/\x1b\[[0-9;?>=!]*[ -/]*[@-~]/g, "") // 나머지 CSI
    .replace(/\x1b./g, ""); // ESC 7 · ESC 8 …
  const out: string[] = [];
  for (const seg of text.split("\n")) {
    const line = seg.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z0-9]/.test(line)) continue; // 배너 아스키아트·스피너 프레임
    if (line !== out[out.length - 1]) out.push(line); // Ink가 같은 줄을 다시 그린다
  }
  return out;
}

/** 다이얼로그가 그리는 것 전부. 세션이 없으면 `running: false` + 빈 로그다. */
export type SetupState = {
  running: boolean;
  lines: string[];
  /** 잡아서 저장까지 마쳤다. 층 ①이 이 값으로 바뀐다 */
  savedAt?: string;
  /** 실패 사유. **조용히 실패하지 않는다** — 화면이 이걸 그대로 보여주고 층 ③으로 안내한다 */
  error?: string;
};

/** **pty가 필수다.** 파이프로는 CLI가 첫 화면도 안 그린다(§0-4 실측표 1행).
 *
 *  `cat |`이 있는 이유: macOS `script`는 stdin이 **소켓**이면 `tcgetattr/ioctl: Operation not
 *  supported on socket`으로 즉시 죽는다. Node의 `stdio: "pipe"`가 소켓쌍이라 그냥 물리면 그
 *  경로다(실측). 셸 파이프는 진짜 `pipe(2)`라 `script`가 ENOTTY를 보고 pty를 연다.
 *  **stdin은 열린 채로 둔다**(실측표 2행) — 이 통로가 나중에 코드를 넣는 길이기도 하다.
 *
 *  `stty cols 200`이 있는 이유: 위 경로로 열린 pty는 winsize가 **0×0**이다(실측). 그대로 두면
 *  Ink가 좁게 잡아 토큰이 줄바꿈으로 쪼개진다.
 *
 *  마지막 `echo`가 있는 이유: **CLI가 끝난 것을 프로세스 종료로는 알 수 없다.** `sh`는 파이프라인
 *  두 짝을 다 기다리는데 `cat`은 우리가 stdin을 열어 두는 한 안 끝난다 — 즉시 죽는 스텁으로
 *  15초를 기다려도 `close`도 stdout `end`도 오지 않았다(실측). 그러면 실패 사유가 전부 "120초
 *  타임아웃"으로 뭉개진다. 그래서 **종료를 pty 안에서 한 줄로 실어 보낸다** — 프로세스 트리를
 *  헤집는 것보다 짧고, 종료 코드도 같이 온다. FIFO로 `cat`을 없애는 길은 막혀 있다: macOS는
 *  FIFO의 `tcgetattr`에 ENOTTY가 아니라 EOPNOTSUPP를 줘서 `script`가 그냥 죽는다(실측). */
const EXIT_MARK = "__dira_setup_exit:";
const setupCmd = (bin: string) =>
  "cat | script -q /dev/null sh -c " +
  // 홑따옴표 안이다 — 경로에 `'`가 있으면 명령이 갈라진다. 사람이 고른 경로가 아니라 PATH의
  // 디렉터리라 실현되기 어렵지만, 셸 문자열을 조립하는 자리라 값싸게 막아 둔다
  `'stty cols 200 rows 50; ${bin.replace(/'/g, "'\\''")} setup-token; echo "${EXIT_MARK}$?"'`;
const SETUP_TIMEOUT_MS = 120_000;
/** 남의 TUI를 긁는 일이라 접두사에 묶인다 — 저장 검증(`normalizeToken`)이 접두사로 거르지
 *  **않는** 것과 축이 다르다. 여기선 화면 잡음 속에서 토큰을 골라낼 표식이 이것뿐이다. */
const TOKEN_RE = /sk-ant-[A-Za-z0-9._-]{20,}/;

// ponytail: 토큰은 머신당 하나라 동시에 몰 이유가 없다 — 세션도 하나다.
let setup: {
  child: ChildProcess;
  raw: string;
  timer: NodeJS.Timeout;
  settled: boolean;
  savedAt?: string;
  error?: string;
} | null = null;

function view(s: NonNullable<typeof setup> | null): SetupState {
  if (!s) return { running: false, lines: [] };
  return {
    // 토큰을 잡은 직후 `settled`는 잠기지만 저장은 비동기다 — 그 사이 창은 `savedAt`도
    // `error`도 없다. 그 창에서 running을 꺼 버리면 폴링 effect가 정리되고 뒤늦게 채워진
    // `savedAt`을 화면이 다시 못 묻는다(§0-13 §저장이 끝나면). 정착은 저장(또는 저장 실패)이
    // 기록된 뒤에만 보인다 — 판정을 여기 한 자리에 둔다.
    running: !s.settled || (s.savedAt === undefined && s.error === undefined),
    lines: ptyLines(s.raw)
      // 종료 표식은 우리가 심은 것이지 CLI가 사람에게 한 말이 아니다 — 로그에서 뺀다
      .filter((l) => !l.startsWith(EXIT_MARK))
      // CLI는 토큰을 화면에 그대로 찍는다. 여기는 파일이 아니라 **화면**이라 가린다 —
      // 이미 제자리에 저장했으므로 사람이 이 값을 눈으로 옮겨 적을 일이 없다
      .map((l) => l.replace(new RegExp(TOKEN_RE, "g"), "sk-ant-…")),
    savedAt: s.savedAt,
    error: s.error,
  };
}

/** 프로세스 그룹째 죽인다. `detached`로 띄웠으므로 `-pid`가 그룹이다 — `script`·`cat`·`claude`
 *  셋이라 자식만 죽이면 pty를 문 `claude`가 남아 다음 시도를 막는다(§0-4). */
function kill(s: NonNullable<typeof setup>): void {
  clearTimeout(s.timer);
  try {
    if (s.child.pid) process.kill(-s.child.pid, "SIGKILL");
  } catch {
    // 이미 죽었다
  }
}

function settle(s: NonNullable<typeof setup>, error?: string): void {
  if (s.settled) return;
  s.settled = true;
  s.error = error;
  kill(s);
}

/** PATH에서 실행파일 하나를 **우리가** 찾는다. 셸에게 맡기면 못 찾았을 때 손에 남는 것이 종료
 *  코드 `127`뿐이고, 사람은 그 숫자에서 원인을 못 읽는다 — §0-4의 "조용히 실패하지 않는다"는
 *  사유가 읽힐 때만 지켜진다(`bcf66f01`). 찾았으면 절대경로를 그대로 몬다.
 *  §0-4 §개정(`b0966e66`)에서 `findClaude()`가 하드코딩했던 이름을 뺐다 — 판정 원본은 이
 *  함수 하나고, 엔진마다 두 벌로 적지 않는다.
 *  ponytail: PATH만 본다 — 셸 alias·function은 이 자식(`sh -c`)이 어차피 못 쓴다. */
export function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      if (!statSync(p).isFile()) continue; // 디렉터리도 X_OK를 통과한다
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // 없거나 실행 권한이 없다 — 다음 디렉터리
    }
  }
  return null;
}

/** claude 전용 별칭 — 층 ②가 몰 대상이 이 값이라 호출자를 두 벌로 안 바꾼다. */
export function findClaude(): string | null {
  return findExecutable("claude");
}

/** 층 ②를 시작한다. 앞선 시도가 남아 있으면 먼저 죽인다 — pty를 두 번 물 수 없다. */
export function startSetup(): SetupState {
  stopSetup();
  const bin = findClaude();
  // 세션을 만들지 않고 그 자리에서 끝낸다 — 몰 대상이 없다. 다음 행동(층 ③)은 화면이 붙인다
  if (!bin) {
    return {
      running: false,
      lines: [],
      error: `PATH에서 claude를 찾지 못했습니다. (PATH=${process.env.PATH ?? ""})`,
    };
  }
  const child = spawn("sh", ["-c", setupCmd(bin)], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const s: NonNullable<typeof setup> = {
    child,
    raw: "",
    settled: false,
    timer: setTimeout(
      () => settle(s, `${SETUP_TIMEOUT_MS / 1000}초 안에 토큰을 받지 못했습니다.`),
      SETUP_TIMEOUT_MS,
    ),
  };
  setup = s;

  const feed = (d: Buffer) => {
    if (s.settled) return;
    s.raw = (s.raw + d.toString()).slice(-256_000);
    const m = TOKEN_RE.exec(s.raw);
    if (!m) {
      // 토큰이 먼저다 — 잡았으면 종료 표식이 같은 청크에 있어도 성공이다
      const bye = s.raw.match(new RegExp(`${EXIT_MARK}(\\d+)`));
      if (bye) settle(s, `토큰을 받지 못한 채 끝났습니다 (종료 코드 ${bye[1]}).`);
      return;
    }
    s.settled = true; // 저장은 비동기다 — 다음 청크가 두 번 저장하지 않게 여기서 잠근다
    kill(s);
    // 덮어쓰기가 아니라 목록 append다 — 활성은 `addToken`의 `reconcileActive` 판정을 그대로
    // 따른다(§0-13 §화면, P179). eligible한 활성이 이미 있으면 대기로 들어간다
    addToken(m[0])
      .then(readAuth)
      .then((a) => {
        s.savedAt = a.savedAt ?? undefined;
      })
      .catch((e: Error) => {
        s.error = `토큰을 잡았지만 저장하지 못했습니다: ${e.message}`;
      });
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed); // 같은 로그에 섞는다 — 사람이 볼 곳이 하나다
  child.on("error", (e) => settle(s, `실행하지 못했습니다: ${e.message}`));

  /** 그물이지 주 경로가 아니다. **CLI의 종료는 위 `EXIT_MARK`가 알린다** — 즉시 죽는 스텁으로
   *  재 보니 `close`도 stdout `end`도 15초 동안 오지 않았다: `sh`가 `cat`을 기다리느라 살아
   *  있고, 그 `sh`가 stdout 파이프도 같이 쥐고 있다. 이 둘은 `sh`까지 죽었을 때만 온다. */
  const ended = () => settle(s, "토큰을 받지 못한 채 끝났습니다.");
  child.stdout?.on("end", ended);
  child.on("close", ended); // stdout이 어떤 이유로 안 끝났을 때의 그물
  return view(s);
}

export function pollSetup(): SetupState {
  return view(setup);
}

/** 승인 뒤 브라우저가 주는 코드를 CLI에 넣는다(실측: 마지막 화면이 `Paste code here`다).
 *  `\r`인 이유는 pty에서 Enter가 CR이라서다. */
export function sendSetupCode(code: string): SetupState {
  if (!setup || setup.settled) return view(setup);
  setup.child.stdin?.write(code.trim() + "\r");
  return view(setup);
}

/** 다이얼로그를 닫으면 부른다. **자식을 남기지 않는다**(§0-4). */
export function stopSetup(): void {
  if (setup) kill(setup);
  setup = null;
}

/** CLI `list`와 같은 표기(`%Y-%m-%d %H:%M`). 서버에서 만든다 — 로컬 도구라 서버와 브라우저가
 *  같은 타임존이고, 클라이언트에서 포맷하면 하이드레이션만 시끄러워진다. */
function when(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
