/** Claude 장기 토큰 — 상태 읽기 · 저장 (DESIGN.md §0-4).
 *
 *  **엔진은 한 줄도 안 고친다**(제약 1). 여기가 하는 일은 `tick.sh:52-54`가 이미 정한 계약을
 *  따라 쓰는 것뿐이다 — 경로 `$TICKET_LOCAL/oauth-token`, 내용은 **개행 없는 한 줄**, 권한 `0600`.
 *  `.authwarn`은 건드리지 않는다: 엔진이 "이미 한 번 경고했다"를 적어 두는 자기 파일이고,
 *  토큰이 생기면 61행 조건이 먼저 꺼져 다시 보지 않는다(§0-4). */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
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
 *  판정을 두 벌로 적지 않는다. 지금 쓸 토큰을 사람이 직접 고르는 손은 `setActiveToken`이다. */
export async function addToken(raw: string, label?: string): Promise<TokenEntry> {
  const token = normalizeToken(raw);
  const id = tokenId(token);
  const file = await readTokens();
  const tokens = file.claude?.tokens ?? [];
  const existing = tokens.find((t) => t.id === id);
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

/** 화면이 그리는 목록 그대로 — 원문 토큰은 여기서 나가지 않는다(가린 문자열만). */
export async function readTokenRows(): Promise<TokenRow[]> {
  const file = await readTokens();
  const engine = file.claude;
  if (!engine) return [];
  const now = Math.floor(Date.now() / 1000);
  return engine.tokens.map((t, i) => ({
    id: t.id,
    label: t.label ?? `계정 ${i + 1}`,
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

// ── ② 발급 — dira 자체 OAuth 플로우 (DESIGN.md §0-13 §라벨 §확정, P180-2) ──────

/** 다이얼로그가 그리는 것 전부. 세션이 없으면 `running: false` + 빈 로그다. */
export type SetupState = {
  running: boolean;
  lines: string[];
  /** 잡아서 저장까지 마쳤다. 층 ①이 이 값으로 바뀐다 */
  savedAt?: string;
  /** 실패 사유. **조용히 실패하지 않는다** — 화면이 이걸 그대로 보여주고 층 ③으로 안내한다 */
  error?: string;
};

/** claude CLI 자신의 client_id다(실측 2026-08-06 — CLI 바이너리 문자열 상수를
 *  `platform.claude.com/oauth/authorize` 바로 옆에서 뽑았다. `strings`로 걸러지는 위치가 아니라
 *  raw 오프셋을 읽어야 나온다 — 조립된 상수 객체가 그 자리에 있었다). dira가 새로 등록한
 *  자리가 아니라 CLI가 이미 등록된 자리에 얹는다 — §0-13 §라벨 §확정이 치르기로 한
 *  "엔드포인트에 묶이는 대가"가 이 값이다. */
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://platform.claude.com/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
/** CLI가 `setup-token` 뒤에도 이메일을 확인할 때 부르는 그 GET(§0-13 §라벨 실측과 같은 값). */
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
/** 승인 뒤 브라우저를 보낼 곳. CLI가 쓰는 그 성공 페이지 그대로다 — 새 화면을 안 만든다. */
const SUCCESS_URL = "https://platform.claude.com/oauth/code/success?app=claude-code";
/** setup-token과 같은 1년(초) — CLI 상수 그대로(실측). §0-13 §라벨 §확정의 "장기 토큰" 요건. */
const TOKEN_TTL_SECONDS = 31536000;
/** setup-token의 `user:inference` 하나에 `user:profile`을 더한다. CLI 기본 로그인 스코프는
 *  이보다 넓다(세션·mcp·파일업로드까지) — 프로필 GET 하나에 그 셋은 안 쓴다(§0-13 §라벨 §확정 —
 *  스코프 조합은 실측이 고른다). */
const SCOPES = ["user:inference", "user:profile"];
const SETUP_TIMEOUT_MS = 120_000;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE 한 쌍(RFC 7636 S256). `verifier`는 세션이 들고 있다가 토큰 교환 때 되돌려 준다 —
 *  authorize 요청에는 그 해시(`challenge`)만 나간다. */
function newPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** 화면·순수 테스트가 재는 자리 — 네트워크 없이 URL 모양만 검증한다. */
export function buildAuthorizeUrl(opts: { challenge: string; state: string; port: number }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("code", "true");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", `http://127.0.0.1:${opts.port}/callback`);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("code_challenge", opts.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", opts.state);
  return u.toString();
}

/** `/api/oauth/profile` 응답에서 이메일 하나만 뽑는다(실측 2026-08-06 — 이미 있는 CLI 로그인
 *  토큰으로 GET 한 번: `{account:{email:"…"}}`). 모양이 다르면 `null` — 라벨은 빈 채로 저장되고
 *  행 편집(P180-1)이 폴백이다. */
export function profileEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const account = (body as { account?: unknown }).account;
  if (!account || typeof account !== "object") return null;
  const email = (account as { email?: unknown }).email;
  return typeof email === "string" && email ? email : null;
}

// ponytail: 토큰은 머신당 하나라 동시에 몰 이유가 없다 — 세션도 하나다.
let setup: {
  server: Server;
  port: number;
  state: string;
  verifier: string;
  timer: NodeJS.Timeout;
  settled: boolean;
  lines: string[];
  savedAt?: string;
  error?: string;
} | null = null;

function view(s: NonNullable<typeof setup> | null): SetupState {
  if (!s) return { running: false, lines: [] };
  return { running: !s.settled, lines: s.lines, savedAt: s.savedAt, error: s.error };
}

/** 로컬 콜백 서버를 닫고 타임아웃을 걷는다. */
function kill(s: NonNullable<typeof setup>): void {
  clearTimeout(s.timer);
  s.server.close();
}

function settle(s: NonNullable<typeof setup>, error?: string): void {
  if (s.settled) return;
  s.settled = true;
  s.error = error;
  kill(s);
}

/** 코드를 토큰으로 바꾸고, profile GET **1회**로 이메일을 집어 라벨로 저장한다(§0-13 §라벨
 *  §확정 — profile GET은 발급 직후 1회뿐이고 목록 렌더·확인 버튼은 다시 안 부른다). profile GET이
 *  실패해도 이미 받은 토큰은 저장된다 — 라벨만 비어 `계정 N`으로 선다. 실패 사유는 진행 로그에 남는다. */
async function exchangeAndSave(s: NonNullable<typeof setup>, code: string): Promise<void> {
  try {
    const body = {
      grant_type: "authorization_code",
      code,
      redirect_uri: `http://127.0.0.1:${s.port}/callback`,
      client_id: CLIENT_ID,
      code_verifier: s.verifier,
      state: s.state,
      expires_in: TOKEN_TTL_SECONDS,
    };
    s.lines.push("토큰을 교환하는 중…");
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const tokenJson = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!tokenRes.ok || typeof tokenJson?.access_token !== "string" || !tokenJson.access_token) {
      throw new Error(`토큰 교환 실패 (${tokenRes.status})`);
    }
    const accessToken = tokenJson.access_token;

    let label: string | undefined;
    s.lines.push("이메일을 가져오는 중…");
    try {
      const profileRes = await fetch(PROFILE_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-cache" },
      });
      if (profileRes.ok) {
        const email = profileEmail(await profileRes.json().catch(() => null));
        if (email) label = email;
        else s.lines.push("이메일을 찾지 못했습니다 — 응답 모양이 다릅니다.");
      } else {
        s.lines.push(`이메일을 가져오지 못했습니다 (${profileRes.status}).`);
      }
    } catch (e) {
      s.lines.push(`이메일을 가져오지 못했습니다: ${(e as Error).message}`);
    }

    // 덮어쓰기가 아니라 목록 append다 — 활성은 `addToken`의 `reconcileActive` 판정을 그대로
    // 따른다(§0-13 §화면, P179). eligible한 활성이 이미 있으면 대기로 들어간다
    await addToken(accessToken, label);
    s.savedAt = (await readAuth()).savedAt ?? undefined;
    s.lines.push("토큰을 저장했습니다.");
  } catch (e) {
    s.error = `토큰을 받지 못했습니다: ${(e as Error).message}`;
  } finally {
    kill(s);
  }
}

/** 로컬 서버가 받는 유일한 경로. `state`가 안 맞으면(CSRF) 거부한다 — code 하나만으로는
 *  안 믿는다. 이미 처리된 뒤 온 재요청(브라우저 재시도)은 조용히 안내만 하고 다시 교환하지
 *  않는다 — `exchangeAndSave`가 두 번 불리면 addToken이 같은 토큰을 두 번 저장 시도한다. */
function handleCallback(s: NonNullable<typeof setup>, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (s.settled) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("이미 처리됐습니다. 이 창을 닫아도 됩니다.");
    return;
  }
  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  if (!code || gotState !== s.state) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("잘못된 요청입니다. 이 창을 닫고 dira로 돌아가 다시 시도해 주세요.");
    settle(s, "인증 코드를 받지 못했습니다.");
    return;
  }
  s.settled = true; // 교환은 비동기다 — 다음 요청이 두 번 교환하지 않게 여기서 잠근다
  res.writeHead(302, { Location: SUCCESS_URL });
  res.end();
  s.lines.push("승인을 받았습니다.");
  void exchangeAndSave(s, code);
}

/** macOS `open`으로 기본 브라우저를 연다 — 의존성 0(플랫폼 명령 하나, §0-4 pty 항의 같은 태도).
 *  실패해도 흐름은 안 죽는다 — 진행 로그에 남은 URL을 사람이 직접 열 수 있다. */
function openBrowser(url: string): void {
  try {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // 사람이 진행 로그의 URL을 직접 연다
  }
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

/** 층 ②를 시작한다 — dira 자체 OAuth(PKCE + 로컬 콜백 서버). 앞선 시도가 남아 있으면
 *  먼저 정리한다(로컬 서버는 포트를 두 번 못 문다). `claude` 실행파일이 없어도 돈다 —
 *  §0-13 §라벨 §확정이 걷어낸 pty 의존성이 이 함수다. */
export function startSetup(): SetupState {
  stopSetup();
  const { verifier, challenge } = newPkce();
  const state = base64url(randomBytes(32));
  const server = createServer();
  const s: NonNullable<typeof setup> = {
    server,
    port: 0,
    state,
    verifier,
    settled: false,
    lines: [],
    timer: setTimeout(
      () => settle(s, `${SETUP_TIMEOUT_MS / 1000}초 안에 승인을 받지 못했습니다.`),
      SETUP_TIMEOUT_MS,
    ),
  };
  setup = s;
  server.on("request", (req, res) => handleCallback(s, req, res));
  server.on("error", (e) => settle(s, `로컬 서버를 열지 못했습니다: ${e.message}`));
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      settle(s, "로컬 서버 포트를 얻지 못했습니다.");
      return;
    }
    s.port = addr.port;
    const url = buildAuthorizeUrl({ challenge, state, port: s.port });
    s.lines.push("브라우저를 여는 중…", url);
    openBrowser(url);
  });
  return view(s);
}

export function pollSetup(): SetupState {
  return view(setup);
}

/** 다이얼로그를 닫으면 부른다. **로컬 서버를 남기지 않는다**(§0-4와 같은 태도 — 남으면
 *  다음 시도가 같은 포트를 못 연다는 성질은 없지만, 열어 둔 포트·타이머를 남기지 않는다). */
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
