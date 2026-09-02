/** 설정 `워커` 패널의 순수 타입·조립·필터 (DESIGN.md §4-16 결정 5 · §비주얼 §68). **fs 의존이
 *  0이다** — I/O는 `app/actions.ts`의 `readWorkersPanelAction`이 지고, 이 모듈은 그 결과를 조립·
 *  필터만 한다. 클라이언트 컴포넌트(`settings-dialog.tsx`)가 안전하게 import하는 이유가 이것이다.
 *
 *  덩이 둘은 부분집합 관계가 아니다(§비주얼 §68 ①) — 풀 줄은 **실행 슬롯**, 목록의 `공통` 줄은
 *  그 슬롯이 프로젝트 큐에 남긴 **shim 파일**이다. 그래서 두 함수(`filteredPool`·`filteredGroups`)로
 *  갈라 두고, 하나로 합치지 않는다. */
import type { Worker, WorkerStatus } from "./workers.ts";

export type WorkersPanelPoolRow = {
  name: string;
  status: WorkerStatus;
  /** §비주얼 §68 ② `<n>곳` — 이 풀을 빌리는(각 프로젝트 `pool-limit` >= 1) 프로젝트 수. `pool-limit`은
   *  프로젝트 하나에 값 하나라 풀 워커 전부가 같은 수를 쓴다(§4-16 결정 3 — 상한 1 이상은 풀 전원의
   *  shim을 그 큐에 넣는다). */
  borrowedBy: number;
};

export type WorkersPanelProject = {
  id: string;
  name: string;
  connected: boolean;
  /** `연결 안 됨` 사유 원문. `connected`가 `true`면 `null`(§6 에러 3요소) */
  error: string | null;
  workers: Worker[];
};

export type SessionCapProjectRow = { id: string; name: string; count: number };

/** 머신 전체 동시 세션 상한(§세션이 120초 안에 못 뜬다 §개정 결정 2-3). I/O(`readSessionLimit`·
 *  `liveSessionCount`)는 `session-cap.ts` + `readWorkersPanelAction`이 지고, 이 조각은 그 결과를
 *  그대로 옮겨 담는다 — `pool`과 달리 여기서 유도할 값이 없다(합계·분포 둘 다 이미 계산돼 온다). */
export type WorkersPanelSessionCap = {
  limit: number | null;
  warn: boolean;
  total: number;
  byProject: SessionCapProjectRow[];
};

export const EMPTY_SESSION_CAP: WorkersPanelSessionCap = { limit: null, warn: false, total: 0, byProject: [] };

export type WorkersPanelView = {
  pool: WorkersPanelPoolRow[];
  projects: WorkersPanelProject[];
  sessionCap: WorkersPanelSessionCap;
};

export type WorkersKind = "pool" | "project";

/** 프로젝트 필터 축의 `공통` 값(§4-16 결정 5 §필터 축 셋 — "프로젝트(공통 포함)"). 등록 프로젝트
 *  id와 절대 안 겹친다(`NAME_RE`가 프로젝트 id에 허용하는 문자와 `__`가 다른 자리다). */
export const POOL_PROJECT_VALUE = "__pool__";

/** 다중 선택 셋(§비주얼 §68 ③) — 비어 있으면 "그 축은 안 걸렀다"다(보드 `BoardFilter`와 같은 규약). */
export type WorkersFilters = {
  project: string[]; // 프로젝트 id 또는 `POOL_PROJECT_VALUE`
  kind: WorkersKind[];
  status: WorkerStatus[];
};

export const EMPTY_WORKERS_FILTERS: WorkersFilters = { project: [], kind: [], status: [] };

/** 읽은 값을 그대로 그릇에 담는다. `borrowedBy`는 프로젝트별 `pool-limit`에서 유도한다(§4-16 결정 3
 *  — 상한이 하나뿐이라 풀 워커 전부가 같은 수를 쓴다) — `readWorkersPanelAction`이 프로젝트 수만큼
 *  다시 세지 않도록 여기 한 곳에서 계산한다. `poolLimits`는 `projects`와 **같은 순서·길이**다. */
export function buildWorkersPanel(
  pool: { name: string; status: WorkerStatus }[],
  projects: WorkersPanelProject[],
  poolLimits: number[],
  sessionCap: WorkersPanelSessionCap = EMPTY_SESSION_CAP,
): WorkersPanelView {
  const borrowedBy = poolLimits.filter((n) => n >= 1).length;
  return {
    pool: pool.map((p) => ({ ...p, borrowedBy })),
    projects,
    sessionCap,
  };
}

const kindOf = (w: Worker): WorkersKind => (w.pool ? "pool" : "project");

function passStatusKind(w: Pick<Worker, "status" | "pool">, filters: WorkersFilters): boolean {
  if (filters.kind.length > 0 && !filters.kind.includes(kindOf(w as Worker))) return false;
  if (filters.status.length > 0 && !filters.status.includes(w.status)) return false;
  return true;
}

/** 덩이 1(공통 워커 풀). 종류 축에서 `project`만 골랐으면 이 덩이는 통째로 0건이다 — 풀 줄은
 *  전부 `공통`이라서다. 프로젝트 축은 `POOL_PROJECT_VALUE`를 안 골랐으면(그리고 뭔가는 골랐으면)
 *  0건이다 — §비주얼 §68 ⑩ 실측: "프로젝트를 dira 하나로 좁히면 풀 덩이의 줄이 0건이 된다". */
export function filteredPool(view: WorkersPanelView, filters: WorkersFilters): WorkersPanelPoolRow[] {
  if (filters.kind.length > 0 && !filters.kind.includes("pool")) return [];
  if (filters.project.length > 0 && !filters.project.includes(POOL_PROJECT_VALUE)) return [];
  if (filters.status.length === 0) return view.pool;
  return view.pool.filter((p) => filters.status.includes(p.status));
}

/** 덩이 2(전체 워커) — 프로젝트별로 묶은 행. **묶음 하나가 필터로 0건이 되면 그 묶음을 통째로
 *  뺀다**(§비주얼 §68 ③ §0건 — "머리만 남기면 dira 0 줄이 프로젝트 수만큼 선다"). **연결 안 된
 *  프로젝트는 예외다** — 워커가 원래 0개(못 읽어서)이지 필터가 비운 게 아니라서, 그 사유를 계속
 *  보여준다(§4-16 결정 5: "빠지면 사람이 워커가 없어진 것으로 읽는다"). */
export function filteredGroups(view: WorkersPanelView, filters: WorkersFilters): WorkersPanelProject[] {
  return view.projects
    .filter((p) => filters.project.length === 0 || filters.project.includes(p.id))
    .map((p) => ({
      ...p,
      workers: p.connected ? p.workers.filter((w) => passStatusKind(w, filters)) : p.workers,
    }))
    .filter((p) => !p.connected || p.workers.length > 0);
}
