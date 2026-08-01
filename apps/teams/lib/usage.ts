/** 토큰의 두 축 (DESIGN.md §0-8). **쓴 양**(판정 1)과 **남은 양**(판정 2)이 한 파일에 산다 —
 *  둘 다 토큰이고, 하단 status bar가 한 칸에서 둘을 갈아 끼운다(게이지가 못 서면 소비량이 선다).
 *
 *  - 판정 1(소비): 입력은 **이미 쌓이고 있는 `<루트>/workers/logs/`**다 — 새 엔진 규약도 새
 *    저장소도 없다. 파일명이 워커·시각을 주고, 마지막 줄 JSON의 `usage` 넷을 더한 수가 그
 *    세션의 토큰이다. `$` 환산도 모델별 분해도 없다(Q3=(a): `total_cost_usd`는 읽지도 않는다).
 *  - 판정 2(잔여): 엔진마다 원본이 다르다 — claude는 GET 1회, codex는 rollout 파일이다.
 *    **부르는 주체는 서버뿐이고 토큰은 응답에 담기지 않는다**(아래 `engineLimits`).
 *
 *  **읽기 전용이다.** 이 모듈은 아무 파일도 쓰지 않는다. */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { lastJsonLine } from "./workers.ts";

/** 창 기본값. §0-8: 창은 엔진의 한도 창을 따르는데 그 길이는 판정 2의 실측이 준다 —
 *  **실측 전 기본값이 5시간 롤링**이고 화면이 `최근 5시간`이라고 그렇게 말한다. */
export const DEFAULT_WINDOW_MS = 5 * 60 * 60 * 1000;

export type Usage = {
  /** 워커 이름 → 창 안에서 끝난 세션들의 토큰 합. **값이 0인 워커는 들어 있지 않다** */
  byWorker: Record<string, number>;
  /** `byWorker`의 합 */
  total: number;
  /** 창 안인데 **토큰을 못 읽어 이 합계 밖에 있는** 세션 수. 이 수가 이 판정의 천장이다 —
   *  `usage`는 세션 종료 시 한 번 쓰이므로 90분짜리 세션은 90분 동안 0으로 보이고, 신호로
   *  죽은 세션은 그 줄을 영영 안 쓴다. 화면이 침묵하면 사람은 "덜 썼다"로 읽고, 그게 §0-8이
   *  없애려던 오독이다.
   *
   *  **`도는 세션 수`가 아니다.** 실측(이 큐, 창 5시간) 13건 중 8건이 rc 143/137로 죽은
   *  세션이라 그 토큰은 앞으로도 안 온다(`4a884d8d`). 로그만으로는 도는 것과 죽은 것을
   *  못 가르므로(hook JSON이 stderr에 먼저 깔린다) 두 수로 가르지 않는다 — §0-8 판정 1. */
  unaccounted: number;
};

/** `<YYYYMMDD>-<HHMMSS>-<워커>-<해시>.log` (실측 `20260801-145504-w6-3c56c1c3.log`).
 *
 *  **`split("-")[2]`를 쓰지 않는다** — 워커 이름에 `-`가 들어갈 수 있다. 앞 2필드와 마지막
 *  1필드를 고정하고 **가운데 전부**가 이름이다(`workerOf`가 sid 8자를 길이로 가르는 것과 같은 선).
 *  `at`은 tick.sh의 `date '+%Y%m%d-%H%M%S'`, 즉 **이 머신 로컬 시각**이라 로컬로 판다. */
export function parseLogName(file: string): { at: number; worker: string } | null {
  const m = /^(\d{8})-(\d{6})-(.+)-([^-]+)\.log$/.exec(file);
  if (!m) return null;
  const [, d, t] = m;
  const at = new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6)),
  ).getTime();
  // 한글 워커 이름을 만들 수 있는 자리다(TICKET_NAME). readdir이 NFD를 주는 파일시스템이
  // 있어서 정규화 없이 키를 만들면 `listWorkers`의 이름과 안 붙는다(`queue.ts`와 같은 이유).
  return Number.isFinite(at) ? { at, worker: m[3].normalize("NFC") } : null;
}

/** 세션 하나의 토큰. **넷을 더한 한 수**다 — 가중치를 우리가 매기지 않는다(§0-8).
 *  `usage`가 없으면 `null`: 아직 안 끝났거나(stderr의 hook JSON이 마지막 줄인 경우가 실재한다)
 *  결과 없이 죽은 세션이고, 둘 다 **0이라고 단정할 근거가 아니다**. */
function tokensOf(rec: Record<string, unknown> | null): number | null {
  const u = rec?.usage;
  if (!u || typeof u !== "object") return null;
  const n = (k: string) => {
    const v = (u as Record<string, unknown>)[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return (
    n("input_tokens") +
    n("output_tokens") +
    n("cache_creation_input_tokens") +
    n("cache_read_input_tokens")
  );
}

/** **끝난 로그는 불변이다** — 그래서 `경로 → 합계`를 프로세스 수명 동안 들고 있는다.
 *  이게 없으면 5초 폴링마다 창 안의 파일 100여 개(실측 215MB · 최대 14MB짜리)를 다시 연다.
 *  정상 상태에서 새로 여는 파일은 지난 폴링 이후 끝난 것뿐이라 0~2개다.
 *
 *  ponytail: 무한히 자라는 Map이다. 항목 하나가 `경로 → number`고 이 머신의 로그가 하루
 *  수백 개라 서버 수명 안에서 문제가 아니다. 문제가 되면 창 밖 키를 지우는 한 줄을 붙인다. */
const cache = new Map<string, number>();

/** 창 안에서 **끝난** 세션들의 워커별 토큰 합.
 *
 *  창 밖 파일은 **파일명만 보고 건너뛴다 — 열지 않는다.** 창을 넓히는 것이 파일 여는 수를
 *  늘리는 유일한 축이다(§0-8 비용). */
export async function listUsage(root: string, windowMs = DEFAULT_WINDOW_MS): Promise<Usage> {
  const dir = path.join(root, "workers", "logs");
  const names = await readdir(dir).catch(() => [] as string[]);
  const since = Date.now() - windowMs;

  const byWorker: Record<string, number> = {};
  let total = 0;
  let unaccounted = 0;

  await Promise.all(
    names.map(async (file) => {
      const meta = parseLogName(file);
      if (!meta || meta.at < since) return; // 창 밖 · 우리 이름이 아님 → 안 연다
      const full = path.join(dir, file);
      let tokens = cache.get(full);
      if (tokens === undefined) {
        const got = tokensOf(await lastJsonLine(full));
        // 토큰을 못 읽은 세션은 **캐시하지 않는다** — 다음 폴링에 다시 본다.
        if (got === null) {
          unaccounted++;
          return;
        }
        cache.set(full, (tokens = got));
      }
      byWorker[meta.worker] = (byWorker[meta.worker] ?? 0) + tokens;
      total += tokens;
    }),
  );

  return { byWorker, total, unaccounted };
}

/** 읽히는 크기로 줄인다 — `0` · `995` · `1.2k` · `18k` · `2.6M`.
 *
 *  **화면 파일이 아니라 여기 있는 이유**: 워커 화면의 열과 상단 합계가 같은 수를 같은 모양으로
 *  써야 한다. 자리마다 적으면 한쪽만 자릿수를 바꿔도 두 화면이 갈린다.
 *  **하단 status bar는 이 함수를 안 쓴다** — 게이지가 못 선 칸의 소비량은 `toLocaleString()`
 *  천 단위 구분이다(§비주얼 §26 ⑤가 `1.2M`으로 줄이는 것을 명시적으로 거절했다. 그 자리는
 *  게이지 대신 서는 유일한 절대 수라 자릿수가 정보다).
 *
 *  가수가 10 미만일 때만 소수 한 자리다(`1.2k`는 정보고 `18.4k`는 소음이다). 경계를 `999_500`에
 *  두는 것은 반올림 뒤 `1000k`가 나오지 않게 하려는 것이다.
 *
 *  // ponytail: `M`이 천장이다. 창이 5시간이라 `G`가 나올 수 없다 — 나오면 한 줄 더 붙인다. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const [v, unit] = n < 999_500 ? [n / 1000, "k"] : [n / 1_000_000, "M"];
  return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + unit;
}

// ── 엔진별 잔여 한도 (§0-8 판정 2 · 하단 status bar) ─────────────────────────
//
// 한도는 **계정 스코프**라 워커별로 갈리지 않는다 — 키가 엔진 이름 하나다(`engineName`).
// 읽는 주체는 서버뿐이다: claude는 `~/.claude/.credentials.json`(0600)을 읽고 codex는
// `~/.codex/`를 읽는다. 둘 다 브라우저가 못 보는 자리고, **나가는 것은 `%`와 리셋 시각뿐**이다.

/** 한 엔진 칸이 그릴 것. **값이 없으면 사유뿐이다** — 빈 트랙도 `0%`도 추정치도 만들지 않는다
 *  (§0-8 판정 2: 화면이 거짓말하지 않는다). `error`는 화면이 `한도를 읽을 수 없습니다` 옆
 *  네이티브 `title`에 싣는 원문이고 **토큰 문자열은 여기 담기지 않는다**. */
export type EngineLimit =
  /** `usedPercent`는 **쓴 %**다(claude `utilization` · codex `used_percent`). 게이지가 차는
   *  쪽이 이 수다 — 뒤집으면 화면이 정확히 반대로 거짓말한다(§비주얼 §26 ②).
   *  `resetsAt`은 ms 에폭이거나 `null`(그때는 남은 시간 항목만 빠진다 — §26 ④). */
  { usedPercent: number; resetsAt: number | null } | { error: string };

/** **5초 폴링에 매달지 않는다**(§0-8 남는 규칙). 셸은 라우트마다 다시 렌더되고 보드는 5초마다
 *  `router.refresh()`를 부르므로, TTL이 없으면 claude 엔드포인트를 초당 여러 번 두드린다.
 *  429의 `retry-after`가 ≈1시간이었다 — 여긴 자주 두드릴 곳이 아니다. */
const LIMIT_TTL_MS = 60_000;

/** 값이 아니라 **Promise를 캐시한다** — 동시에 들어온 요청 여럿이 호출 하나를 나눠 갖는다.
 *  실패도 TTL 동안 캐시된다(그게 "실패해도 더 두드리지 않는다"다).
 *
 *  ponytail: 엔진 이름 몇 개짜리 Map이라 비우지 않는다. */
const limitCache = new Map<string, { at: number; value: Promise<EngineLimit> }>();

/** 엔진 이름들 → 칸마다의 잔여. **호출은 TTL당 엔진 하나에 1회**다.
 *  던지지 않는다 — 실패는 전부 `{ error }`로 돌아온다(바가 사라지면 안 된다). */
export async function engineLimits(engines: string[]): Promise<Record<string, EngineLimit>> {
  const now = Date.now();
  const out: Record<string, EngineLimit> = {};
  await Promise.all(
    [...new Set(engines)].map(async (engine) => {
      let hit = limitCache.get(engine);
      if (!hit || now - hit.at >= LIMIT_TTL_MS) {
        limitCache.set(engine, (hit = { at: now, value: readLimit(engine) }));
      }
      out[engine] = await hit.value;
    }),
  );
  return out;
}

function readLimit(engine: string): Promise<EngineLimit> {
  if (engine === "claude") return claudeLimit();
  if (engine === "codex") return codexLimit();
  // 원본을 모르는 엔진은 폴백이다. **추정치를 지어내지 않는다**(§0-8).
  return Promise.resolve({ error: `${engine}: 한도를 주는 원본을 모릅니다` });
}

/** 설치된 CLI 번들이 부르는 그 경로다(§0-8 판정 2 실측). 타임아웃도 번들의 5000ms 그대로. */
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

/** claude — `GET /api/oauth/usage`의 `five_hour`.
 *
 *  토큰은 **CLI 로그인 토큰**(`~/.claude/.credentials.json`)이다. §0-4의 장기 토큰
 *  (`~/.config/dira/oauth-token`)에는 `user:profile`이 없어 같은 URL이 429다(실측 2026-08-01).
 *  **매 호출마다 파일을 다시 읽는다** — access token이 8시간짜리고 CLI가 제자리 갱신한다.
 *  만료되면 401이고 그 칸은 폴백이다(우리는 `refreshToken`으로 갱신하지 않는다 —
 *  사람 계정에 토큰을 발급하는 행위다).
 *
 *  **비공개 API라 계약이 없다** — 키마다 `null` 가드를 걸고, 하나라도 어긋나면 게이지를
 *  안 그린다(§0-8 판정 2). */
async function claudeLimit(): Promise<EngineLimit> {
  const file = path.join(homedir(), ".claude", ".credentials.json");
  let token: unknown;
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    token = (raw as { claudeAiOauth?: { accessToken?: unknown } })?.claudeAiOauth?.accessToken;
  } catch (e) {
    return { error: `${file}: ${(e as Error).message}` };
  }
  if (typeof token !== "string" || !token) {
    return { error: `${file}: claudeAiOauth.accessToken이 없습니다` };
  }
  let res: Response;
  try {
    res = await fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // TTL 캐시가 우리 것이므로 Next의 fetch 캐시는 끈다(같은 값을 두 겹으로 들지 않는다).
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    // 타임아웃·네트워크 단절. **사유를 지어내지 않는다** — 원문 그대로 title에 싣는다.
    return { error: `GET ${CLAUDE_USAGE_URL}: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: `GET ${CLAUDE_USAGE_URL}: HTTP ${res.status}` };
  const body: unknown = await res.json().catch(() => null);
  const five = (body as { five_hour?: { utilization?: unknown; resets_at?: unknown } } | null)
    ?.five_hour;
  if (typeof five?.utilization !== "number" || !Number.isFinite(five.utilization)) {
    return { error: `GET ${CLAUDE_USAGE_URL}: 응답에 five_hour.utilization이 없습니다` };
  }
  // ISO 8601 문자열이다(codex의 유닉스 초와 다르다). 못 읽으면 이 항목만 빠진다(§26 ④).
  const at = typeof five.resets_at === "string" ? Date.parse(five.resets_at) : NaN;
  return { usedPercent: five.utilization, resetsAt: Number.isFinite(at) ? at : null };
}

/** codex — rollout 파일의 마지막 `token_count` 이벤트. **새 네트워크 호출이 0이다.**
 *
 *  `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<시각>-<uuid>.jsonl`이고 디렉터리·파일 이름이
 *  전부 0 패딩이라 **사전순 = 시각순**이다. 가장 최근 날짜 디렉터리에서 새 파일부터 훑고,
 *  `rate_limits`를 실은 **첫 파일이 판정**이다 — 그게 지금 계정 상태다. 그 파일의
 *  `primary`가 `null`이면 한도에 닿은 것이고, 더 오래된 파일의 살아 있던 수로 덮지 않는다.
 *
 *  ponytail: 최근 날짜 디렉터리의 파일 5개까지만 본다. 자정 직후 첫 세션이 아직 `token_count`를
 *  안 실었으면 그 몇 분은 폴백이다 — 넓히려면 이전 날짜 디렉터리로 한 단계 더 내려간다. */
async function codexLimit(): Promise<EngineLimit> {
  const sessions = path.join(homedir(), ".codex", "sessions");
  let dir: string | null = sessions;
  for (let i = 0; i < 3 && dir; i++) dir = await newestNumericChild(dir);
  if (!dir) return { error: `${sessions}: rollout 파일이 없습니다` };
  const files = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.startsWith("rollout-") && n.endsWith(".jsonl"))
    .sort()
    .reverse()
    .slice(0, 5);
  for (const f of files) {
    const full = path.join(dir, f);
    const rl = lastRateLimits(await readFile(full, "utf8").catch(() => ""));
    if (!rl) continue; // 이 세션은 턴이 없었다 — 한 칸 더 오래된 파일을 본다
    const p = rl.primary;
    if (!p || typeof p.used_percent !== "number" || !Number.isFinite(p.used_percent)) {
      // 한도에 닿으면 codex가 이 수를 아예 안 싣는다(실측 `primary: null`). 게이지를 안 그린다.
      return { error: `${full}: rate_limits.primary가 null입니다` };
    }
    const at = typeof p.resets_at === "number" ? p.resets_at * 1000 : NaN; // 유닉스 **초**다
    return { usedPercent: p.used_percent, resetsAt: Number.isFinite(at) ? at : null };
  }
  return { error: `${dir}: 최근 rollout에 rate_limits가 없습니다` };
}

/** `<YYYY>`·`<MM>`·`<DD>` 중 가장 최근 것. 0 패딩 숫자만 받으므로 사전순으로 고른다. */
async function newestNumericChild(dir: string): Promise<string | null> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^\d+$/.test(n));
  const pick = names.sort().pop();
  return pick ? path.join(dir, pick) : null;
}

type CodexRateLimits = { primary?: { used_percent?: unknown; resets_at?: unknown } | null };

/** rollout 한 파일의 **마지막** `rate_limits`. 줄을 뒤에서부터 훑는다 — 한 세션에 여러 번
 *  실리고 마지막 것이 최신이다. 파일 전체를 읽는 이유는 `token_count`가 파일 앞쪽에만 있는
 *  세션이 실재하기 때문이다(실측: 첫 턴에서 한도에 걸려 끝난 세션). 파일은 수백 KB다. */
export function lastRateLimits(text: string): CodexRateLimits | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    try {
      const rec: unknown = JSON.parse(lines[i]);
      const rl = (rec as { payload?: { rate_limits?: CodexRateLimits } })?.payload?.rate_limits;
      if (rl && typeof rl === "object") return rl;
    } catch {
      // 잘린 줄이다(세션이 쓰는 중). 더 오래된 줄을 본다 — 사유를 지어내지 않는다.
    }
  }
  return null;
}

/** 리셋 시각 표기 (§비주얼 §26 ④). 오늘 안이면 `HH:MM`, 다른 날이면 `M/D`.
 *
 *  **카운트다운을 안 쓴다** — `4시간 12분 남음`은 5초마다 움직이고, 안 움직이는 수가 스캔에
 *  낫다. **24시간제**고 `toLocaleTimeString`을 안 쓴다(로케일에 따라 `오후 5:40`이 나와 폭이
 *  흔들린다 — `session-stream.tsx`의 `localTime`과 같은 판단, 다만 초는 안 쓴다).
 *  창이 5시간(claude)과 30일(codex)이라 한 표기가 둘을 못 받아서 갈림이 하나 있다. */
export function resetLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  const p = (v: number) => String(v).padStart(2, "0");
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`;
}
