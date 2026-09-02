/** 페르소나 하나의 활동을 모으는 자리 (DESIGN.md §5-6 §활동 탭 — 티켓 `4ea1147a`).
 *
 *  새 파서는 0개다 — `planOf`·`isAwaiting`·`derivedFrom`(`./queue.ts`)과
 *  `lastLogByWorker`(`./workers.ts`)가 이미 있다. 이 파일이 하는 일은 그것들을 페르소나 축으로
 *  한 자리에 모으는 것뿐이다. `runner.log`는 이 함수 안에서 `lastLogByWorker`를 딱 한 번만
 *  부른다 — `dispatchByHash`가 이미 손에 있으니 되돌아옴 합은 `reassignCount`를 또 부르지
 *  않고 그 자리에서 직접 계산한다(공식은 같다). */
import path from "node:path";
import { derivedFrom, isAwaiting, planOf, planProgress, type Suffixes, type Ticket } from "./queue.ts";
import { lastLogByWorker, workerOf } from "./workers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAY_MS = 30 * DAY_MS;
const RECENT_LIMIT = 20; // §5-6 (3) 최근 — archive-manager 856장 중 최신 20장
const MAX_BAR_DAYS = 30; // §5-6 (4) 30일 — 막대는 로그가 닿는 날 수만큼, 상한 30

/** runner.log 시각 원문(`2026-08-23 05:12:42`, 이 머신 로컬) → epoch ms. 같은 파일·같은 방식으로
 *  적은 두 시각의 차만 쓰므로 로컬 파싱이면 충분하다(절대 시각 비교가 필요 없다). */
const logTimeMs = (s: string) => new Date(s.replace(" ", "T")).getTime();

/** 로컬 달력 날짜 키(`YYYY-MM-DD`) — `toISOString`(UTC)을 안 쓴다. KST 자정 전 9시간이 전날로
 *  밀리면 그 시간대에 닫힌 실행이 옆 칸의 막대로 샌다. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** §5-6 (1) `지금` 한 줄. `plan`이 `null`이면 계획 절이 없는 티켓이다(0/0이 아니다). */
export type PersonaNowItem = {
  hash: string;
  title: string;
  kind: string;
  /** `owner:`에서 `workerOf`로 뽑은 워커 이름(§비주얼 §66 ⑦ "워커" — `w1`~`w8` 두 자다).
   *  전체 `owner:` 문자열이 아니다 — 화면은 이미 페르소나 축이라 그 반쪽은 필요 없다.
   *  `lib/workers.ts`가 `node:fs`를 끄는 클라이언트 컴포넌트에서는 못 부르니 여기서 미리 판다
   *  (`worker-mark.tsx`와 같은 이유). */
  worker: string | null;
  assignedAt: string | null;
  plan: { done: number; total: number } | null;
  /** `## 블록`이 붙어 열린 채 멈춘 티켓(§비주얼 §66 ⑧) — 화면은 상태 점 대신 이 값 하나만
   *  본다. 새 파서가 아니다 — 이미 손에 든 `body`에 정규식 한 줄이다(`questionsOf`가
   *  `## 질문`을 잡는 것과 같은 모양). */
  blocked: boolean;
};

const BLOCKED_HEADING_RE = /^##\s*블록/m;

/** §5-6 (2) `기다리는 것` 한 줄. */
export type PersonaWaitingItem = { hash: string; title: string; mtime: number };

/** §5-6 (3) `최근` 한 줄. `durationMin`·`reassigns`는 로그가 안 닿으면 `null`이다(0으로 안 채운다). */
export type PersonaRecentItem = {
  hash: string;
  title: string;
  kind: string;
  closedAt: number;
  durationMin: number | null;
  reassigns: number | null;
  /** `PersonaNowItem.worker`와 같은 값 — `workerOf(owner)`. */
  worker: string | null;
};

/** §5-6 (4) `30일` 블록. `daily`는 오래된 날이 먼저이고 길이가 곧 "로그가 닿는 날 수"다. */
export type PersonaThirtyDay = {
  closed: number;
  durationMedianMin: number | null;
  reassignSum: number;
  issued: number;
  daily: { date: string; count: number }[];
};

export type PersonaActivity = {
  now: PersonaNowItem[];
  waiting: PersonaWaitingItem[];
  recent: PersonaRecentItem[];
  thirtyDay: PersonaThirtyDay;
  /** 머리 2행 `마지막 활동`. 한 번도 안 돌았으면 `null`(§5-6). */
  lastActivity: { at: string; hash: string } | null;
};

/** 페르소나 이름 하나 · 티켓 목록 · 큐 root → §5-6 §활동 탭이 세우는 값 전부. 화면은 이 값을
 *  포맷만 한다 — 상대 시각·"n분 전" 같은 문구는 여기서 안 만든다. */
export async function personaActivity(
  persona: string,
  tickets: Ticket[],
  root: string,
  sfx: Suffixes,
): Promise<PersonaActivity> {
  const mine = tickets.filter((t) => t.persona === persona);
  const now = Date.now();

  const nowItems: PersonaNowItem[] = mine
    .filter((t) => t.state === "wip")
    .map((t) => {
      return {
        hash: t.hash,
        title: t.title,
        kind: t.kind,
        worker: t.fm.owner ? workerOf(t.fm.owner) : null,
        assignedAt: t.fm.assigned_at ?? null,
        plan: planProgress(planOf(t.body)),
        blocked: BLOCKED_HEADING_RE.test(t.body),
      };
    });

  const waiting: PersonaWaitingItem[] = mine
    .filter((t) => isAwaiting(t))
    .map((t) => ({ hash: t.hash, title: t.title, mtime: t.mtime }));

  const { dispatchByHash, personaRuns, logStart } = await lastLogByWorker(path.join(root, "workers"));
  const runs = personaRuns[persona] ?? [];
  const doneByHash = new Map(runs.filter((r) => r.verb === "DONE").map((r) => [r.hash, r]));

  const doneTickets = mine.filter((t) => t.state === "done").sort((a, b) => b.mtime - a.mtime);

  const recent: PersonaRecentItem[] = doneTickets.slice(0, RECENT_LIMIT).map((t) => {
    const run = doneByHash.get(t.hash);
    const seenByLog = dispatchByHash[t.hash] !== undefined;
    return {
      hash: t.hash,
      title: t.title,
      kind: t.kind,
      closedAt: t.mtime,
      durationMin: run ? (logTimeMs(run.endAt) - logTimeMs(run.dispatchAt)) / 60000 : null,
      reassigns: seenByLog ? Math.max(0, dispatchByHash[t.hash] - 1) : null,
      worker: t.fm.owner ? workerOf(t.fm.owner) : null,
    };
  });

  const windowStart = now - THIRTY_DAY_MS;
  const closedInWindow = doneTickets.filter((t) => t.mtime >= windowStart);
  // ponytail: reassignCount(root, hash)를 티켓마다 부르면 매번 lastLogByWorker를 다시 타는데
  // cache()는 리액트 요청 경계 밖에서 메모가 안 돼 8만 줄 로그를 그 횟수만큼 다시 훑는다(실측
  // pm 30일 595건에서 타임아웃). 위에서 이미 뽑은 dispatchByHash를 그대로 쓴다 — 공식은
  // reassignCount와 동일(Math.max(0, count - 1)), 로그 재파싱만 없앤다.
  const reassignSum = closedInWindow.reduce(
    (sum, t) => sum + Math.max(0, (dispatchByHash[t.hash] ?? 0) - 1),
    0,
  );
  const issued = closedInWindow.reduce((sum, t) => sum + derivedFrom(tickets, t, sfx).length, 0);

  const doneDurationsInWindow = runs
    .filter((r) => r.verb === "DONE" && logTimeMs(r.endAt) >= windowStart)
    .map((r) => (logTimeMs(r.endAt) - logTimeMs(r.dispatchAt)) / 60000);

  const dayCount = logStart
    ? Math.min(MAX_BAR_DAYS, Math.floor((now - logTimeMs(logStart)) / DAY_MS) + 1)
    : 0;
  const countByDay = new Map<string, number>();
  for (const r of runs) {
    if (r.verb !== "DONE") continue;
    const k = dayKey(logTimeMs(r.endAt));
    countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
  }
  const daily: { date: string; count: number }[] = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const date = dayKey(now - i * DAY_MS);
    daily.push({ date, count: countByDay.get(date) ?? 0 });
  }

  let lastActivity: { at: string; hash: string } | null = null;
  for (const r of runs) {
    if (!lastActivity || r.endAt > lastActivity.at) lastActivity = { at: r.endAt, hash: r.hash };
  }

  return {
    now: nowItems,
    waiting,
    recent,
    thirtyDay: {
      closed: closedInWindow.length,
      durationMedianMin: median(doneDurationsInWindow),
      reassignSum,
      issued,
      daily,
    },
    lastActivity,
  };
}
