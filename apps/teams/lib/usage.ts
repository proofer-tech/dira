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
import { access, readdir, readFile, stat } from "node:fs/promises";
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

// ── 소모 속도 `<n> 토큰/분` (§0-8 판정 4 · 요구 `b1e932ae`) ──────────────────
//
// **판정 1의 로그로는 못 만든다.** `tick.sh`가 엔진 stdout을 세션이 끝난 뒤에 한 번에 옮겨서
// (`:395` → `:474`) 도는 세션의 `.log`가 **0바이트**인데, 분당 값은 바로 그 도는 세션이 만드는
// 수다. 그래서 출처는 **트랜스크립트**다 — `~/.claude/projects/<인코딩된 cwd>/<sid>.jsonl`의
// `type=="assistant"` 레코드(실측 창 15분: 로그 222건 · 트랜스크립트 440건 · 로그에만 있는
// 메시지 0건). `lib/transcript.ts`가 §2-1 스트림을 그리는 바로 그 파일이라 **새 권한이 아니다.**
//
// 이 절도 **읽기 전용이다** — `~/.claude/`에 아무것도 쓰지 않는다(이 파일 머리의 계약).

/** 창은 **10분**이다. 지난 4시간의 매 분에 화면에 떴을 값 240개를 창별로 뽑아 골랐다
 *  (§0-8 판정 4 표). 1분은 0이 깜빡이고(§0-5가 상시 요소에 대해 거절한 모양), 30분은 흔들림을
 *  0.2 줄이는 대가로 **20분을 더 거짓말한다**(워커가 멈춘 뒤 0으로 내려오는 데 걸리는 시간이
 *  곧 창의 길이다). 화면이 `title`에 `최근 10분`을 적어 이 창을 말한다. */
export const RATE_WINDOW_MS = 10 * 60 * 1000;

/** 10분 창의 값이 30초에 움직이는 폭이 5%를 못 넘는다 — 5초 폴링 6번 중 1번만 스캔을 치른다
 *  (§0-8 판정 4 §비용). `engineLimits`와 **같은 모양**이다: 값이 아니라 Promise를 캐시한다. */
const RATE_TTL_MS = 30_000;

/** 트랜스크립트를 원본으로 갖는 엔진. **오늘은 claude 하나다** — `~/.claude/projects/`는
 *  claude가 쓰는 파일이라 codex·grok 세션이 거기 없다(grok은 `~/.grok/sessions/`에 자기
 *  형식으로 남긴다 — §4-3 §grok. 그 파싱은 §2-1 스트림 쪽 일이고 여기는 안 쓴다). 그래서
 *  그 칸은 `0`이 아니라 이 항목이
 *  **통째로 빠진다**(§0-8 판정 4: 못 구하는 값에 `0`을 그리지 않는다. 판정 2와 같은 줄이다).
 *
 *  ponytail: codex의 같은 값은 rollout의 `token_count`에 있다(`codexLimit`이 읽는 그 파일).
 *  지금 이 큐에 codex 워커가 0개라 재현할 방법이 없는 배선을 안 세운다 — 생기면 여기 한 줄. */
const RATE_SOURCE = new Set(["claude"]);

/** cwd → `~/.claude/projects/`의 디렉터리 이름. 규칙은 **비영숫자 전부 `-`**다
 *  (CLI 번들 2.1.220에서 읽었다. 이 머신 워커 8/8 일치). */
const enc = (p: string) => p.replace(/[^a-zA-Z0-9]/g, "-");

const rateCache = new Map<string, { at: number; value: Promise<Record<string, number>> }>();

/** 엔진 이름 → **토큰/분**. **원본이 없는 엔진은 키 자체가 없다**(화면이 그 항목을 통째로 뺀다).
 *  창 안에 세션이 없어서 나온 진짜 `0`은 키가 있는 `0`이라 둘이 갈린다.
 *
 *  `workers`는 셸이 이미 들고 있는 `{ 실효 이름, engineName }` 배열이다(`layout.tsx`) —
 *  칸마다 그 엔진을 무는 워커들의 세션만 센다(§0-8 판정 4 §표기). **새 fs 읽기가 아니다.**
 *  `projects`는 테스트가 픽스처를 주는 자리다(`findTranscript`와 같은 선). */
export async function usageRates(
  root: string,
  workers: { worker: string; engine: string }[],
  projects = path.join(homedir(), ".claude", "projects"),
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const w of workers) if (RATE_SOURCE.has(w.engine)) out[w.engine] = 0;
  if (!Object.keys(out).length) return out; // 스캔조차 안 한다

  const key = `${root}\0${projects}`;
  const now = Date.now();
  let hit = rateCache.get(key);
  if (!hit || now - hit.at >= RATE_TTL_MS) {
    rateCache.set(key, (hit = { at: now, value: scanRate(root, projects) }));
  }
  for (const [rest, tokens] of Object.entries(await hit.value)) {
    // 나머지가 빈 문자열 = 워크트리를 안 쓰는 배치라 워커 전부가 그 한 cwd에서 뜬다 — 못 가른다.
    const hits = rest === "" ? workers : [workerOfRest(rest, workers)];
    for (const engine of new Set(hits.map((w) => w?.engine))) {
      if (engine !== undefined && engine in out) out[engine] += tokens;
    }
  }
  const mins = RATE_WINDOW_MS / 60_000;
  for (const e of Object.keys(out)) out[e] /= mins;
  return out;
}

/** 접두를 뗀 나머지 → 그 세션을 띄운 워커. 나머지가 하위 경로를 달고 올 수 있어서
 *  (`…-worktrees-w2-apps-desktop`이 실재한다) **가장 긴 이름이 이긴다** — `w2`와 `w2-apps`가
 *  같이 있어도 안 겹친다. 어느 워커도 아니면 `null`이다(등록이 풀린 워커의 세션 — 무는 엔진이
 *  없으니 어느 칸에도 못 든다. 실측: 창 10분에서 그 몫이 0이다). */
function workerOfRest<T extends { worker: string }>(rest: string, workers: T[]): T | null {
  let best: T | null = null;
  let bestLen = -1;
  for (const w of workers) {
    const e = enc(w.worker);
    if ((rest === e || rest.startsWith(`${e}-`)) && e.length > bestLen) {
      [best, bestLen] = [w, e.length];
    }
  }
  return best;
}

/** 이 프로젝트의 트랜스크립트 디렉터리들 → 창 안 토큰. 키는 **접두를 뗀 나머지**다.
 *
 *  **`workers/<w>.sh`의 `TICKET_CWD`를 파싱하지 않는다** — 실측으로 이 큐의 워커 8개 중 넷이
 *  `TICKET_CWD="$HOME/…"`로 셸 변수를 안 펼친 채 적혀 있어서, 문자열 그대로 인코딩하면 없는
 *  디렉터리가 나오고 **에러가 아니라 0이 된다**(화면이 절반만 세면서 통과한다). 대신 큐 루트에서
 *  유도한 접두로 고른다 — CORE §워커 작업 디렉터리가 못 박은 그 규칙이다. */
async function scanRate(root: string, projects: string): Promise<Record<string, number>> {
  const trees = path.join(root, "worktrees");
  // 워크트리를 쓰면 그 아래 **전부**가 이 프로젝트다(하위 디렉터리에서 뜬 세션도 든다).
  // 안 쓰면 워커의 자리가 큐의 부모라 그 하나다 — 조건이 `worktrees/`의 유무 하나다.
  const byTree = await access(trees).then(
    () => true,
    () => false,
  );
  const prefix = byTree ? enc(trees + path.sep) : enc(path.dirname(root));
  const since = Date.now() - RATE_WINDOW_MS;
  // 워크트리를 안 쓸 때는 **정확히 일치**여야 한다 — 접두로 잡으면 형제 프로젝트가 딸려 온다
  // (`enc("/…/proj")`가 `enc("/…/proj2")`의 접두다).
  const names = (await readdir(projects).catch(() => [] as string[])).filter((n) =>
    byTree ? n.startsWith(prefix) : n === prefix,
  );

  const out: Record<string, number> = {};
  await Promise.all(
    names.map(async (name) => {
      const dir = path.join(projects, name);
      const files = (await readdir(dir).catch(() => [] as string[])).filter((f) =>
        f.endsWith(".jsonl"),
      );
      const sums = await Promise.all(
        files.map(async (f) => {
          const full = path.join(dir, f);
          // **창 밖 파일은 `mtime`만 보고 건너뛴다 — 열지 않는다.** 판정 1이 파일명으로 하는
          // 일을 여기서는 mtime이 한다(트랜스크립트 파일명은 `<sid>.jsonl`이라 시각이 없다).
          const st = await stat(full).catch(() => null);
          if (!st || st.mtimeMs < since) return 0;
          return windowTokens(await readFile(full).catch(() => Buffer.alloc(0)), since);
        }),
      );
      out[name.slice(prefix.length)] = sums.reduce((a, b) => a + b, 0);
    }),
  );
  return out;
}

const NL = 0x0a;
const ASSISTANT = Buffer.from('"type":"assistant"');

/** 한 트랜스크립트에서 **창 안** assistant 레코드의 토큰 합.
 *
 *  - **`message.id`로 중복 제거한다.** 스트리밍이 한 응답을 여러 줄로 적는다(실측 78 → 고유 54).
 *    첫 등장과 마지막 등장의 합이 같았으므로 먼저 만난 것을 잡는다.
 *  - **꼬리 읽기를 쓰지 않는다. 재 보고 버렸다** — 창 10분에서 꼬리 64KB가 전문의 **35%**만 줬다
 *    (활성 세션의 한 턴이 MB급이라 꼬리가 창을 못 덮는다. 커버 2/15).
 *  - **문자열로 펴지 않는다.** `readFile(f,"utf8").split("\n")`이면 15MB를 통째로 디코드하고 줄
 *    배열을 만든다 — 실측(이 큐 · 창 안 15파일 15.3MB) **428ms 대 28.6ms**로 15배다. 바이트로
 *    훑고 **assistant 줄만** 디코드한다(`tailEvents`가 이미 쓰는 관용구이고, `\n`이 UTF-8
 *    시퀀스 안에 안 나와서 안전하다). `hit`이 단조 증가라 재탐색을 해도 전체가 O(n)이다. */
function windowTokens(buf: Buffer, since: number): number {
  const seen = new Set<string>();
  let sum = 0;
  let hit = buf.indexOf(ASSISTANT);
  for (let start = 0; start < buf.length; ) {
    let end = buf.indexOf(NL, start);
    if (end < 0) end = buf.length;
    if (hit >= 0 && hit < start) hit = buf.indexOf(ASSISTANT, start);
    if (hit >= 0 && hit < end) {
      let rec: { timestamp?: unknown; message?: Record<string, unknown> } | null = null;
      try {
        rec = JSON.parse(buf.toString("utf8", start, end));
      } catch {
        // 세션이 쓰는 중이라 잘린 줄이다(`tailEvents`와 같은 판단)
      }
      const at = typeof rec?.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
      const id = rec?.message?.id;
      if (Number.isFinite(at) && at >= since && !(typeof id === "string" && seen.has(id))) {
        if (typeof id === "string") seen.add(id);
        sum += tokensOf(rec?.message ?? null) ?? 0;
      }
    }
    start = end + 1;
  }
  return sum;
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

/** 잔여 한도의 **원본이 있는 엔진 집합**이고 값이 그 원본이다(§0-8 판정 2 · §4-3 개정
 *  2026-08-05). `=== "codex"`로 갈래를 적으면 셋째 엔진이 어느 한쪽으로 조용히 떨어진다 —
 *  `codexLimit()`은 codex의 rollout 파일을 읽고 **grok에는 그런 파일이 없다.**
 *  키에 없는 엔진(오늘 grok)은 아래 폴백이다. */
const LIMIT_SOURCE: Record<string, () => Promise<EngineLimit>> = {
  claude: claudeLimit,
  codex: codexLimit,
};

function readLimit(engine: string): Promise<EngineLimit> {
  const read = LIMIT_SOURCE[engine];
  if (read) return read();
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

/** 리셋 시각 표기(§비주얼 §26 ④)는 **`lib/urls.ts`의 `timeLabel`**이다 — 홈 대화 목록(§24)이
 *  같은 서식을 클라이언트에서 쓰게 되면서 옮겼다(이 파일은 `node:fs`라 번들에 못 들어간다).
 *  **카운트다운을 안 쓴다**는 판정은 그 함수 주석과 §26 ④에 그대로 있다 — `4시간 12분 남음`은
 *  5초마다 움직이고, 안 움직이는 수가 스캔에 낫다. 창이 5시간(claude)과 30일(codex)이라
 *  한 표기가 둘을 못 받는 갈림도 그 자리 그대로다. */
