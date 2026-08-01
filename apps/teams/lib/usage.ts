/** 워커별 토큰 소비 (DESIGN.md §0-8 판정 1).
 *
 *  입력은 **이미 쌓이고 있는 `<루트>/workers/logs/`**다 — 새 엔진 규약도 새 저장소도 없다.
 *  파일명이 워커·시각을 주고, 마지막 줄 JSON의 `usage` 넷을 더한 수가 그 세션의 토큰이다.
 *  `$` 환산도 모델별 분해도 없다(§0-8 Q3=(a): `total_cost_usd`는 읽지도 않는다).
 *
 *  **읽기 전용이다.** 이 모듈은 아무 파일도 쓰지 않는다. */
import { readdir } from "node:fs/promises";
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
  /** 창 안인데 **토큰을 못 읽은** 로그 수. 이 수가 이 판정의 천장이다 — `usage`는 세션 종료 시
   *  한 번 쓰이므로 90분짜리 세션은 90분 동안 0으로 보인다. 화면이 침묵하면 사람은 "덜 썼다"로
   *  읽고, 그게 §0-8이 없애려던 오독이다.
   *
   *  **실측(이 큐, 창 5시간): 61건 중 13건이 여기 든다 — 진짜 도는 것은 5건이고 나머지 8건은
   *  끝났는데 stdout이 비어 토큰이 영영 안 온다.** 그래서 §0-8이 글자로 정한 문구
   *  `진행중 세션 n개는 끝난 뒤 반영됩니다`가 실측과 어긋난다 — `4a884d8d`로 PM에 올렸다.
   *  이 필드의 값은 어느 답이 와도 같다(합계 밖에 있는 세션 수). */
  running: number;
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
  let running = 0;

  await Promise.all(
    names.map(async (file) => {
      const meta = parseLogName(file);
      if (!meta || meta.at < since) return; // 창 밖 · 우리 이름이 아님 → 안 연다
      const full = path.join(dir, file);
      let tokens = cache.get(full);
      if (tokens === undefined) {
        const got = tokensOf(await lastJsonLine(full));
        // 안 끝난 세션은 **캐시하지 않는다** — 다음 폴링에 다시 본다.
        if (got === null) {
          running++;
          return;
        }
        cache.set(full, (tokens = got));
      }
      byWorker[meta.worker] = (byWorker[meta.worker] ?? 0) + tokens;
      total += tokens;
    }),
  );

  return { byWorker, total, running };
}

/** 읽히는 크기로 줄인다 — `0` · `995` · `1.2k` · `18k` · `2.6M`.
 *
 *  **화면 파일이 아니라 여기 있는 이유**: 워커 화면의 열과 §0-8 하단 status bar가 같은 수를
 *  같은 모양으로 써야 한다. 자리마다 적으면 한쪽만 자릿수를 바꿔도 두 화면이 갈린다.
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
