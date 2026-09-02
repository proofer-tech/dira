/** 설정 `워커` 패널의 순수 타입·조립·필터 (DESIGN.md §4-16 결정 5 · §비주얼 §68 · §롤백). **fs
 *  의존이 0이다** — I/O는 `app/actions.ts`의 `readWorkersPanelAction`이 지고, 이 모듈은 그 결과를
 *  조립·필터만 한다. 클라이언트 컴포넌트(`settings-dialog.tsx`)가 안전하게 import하는 이유가
 *  이것이다. */
import type { Worker, WorkerStatus } from "./workers.ts";

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
 *  그대로 옮겨 담는다 — 여기서 유도할 값이 없다(합계·분포 둘 다 이미 계산돼 온다). */
export type WorkersPanelSessionCap = {
  limit: number | null;
  warn: boolean;
  total: number;
  byProject: SessionCapProjectRow[];
};

export const EMPTY_SESSION_CAP: WorkersPanelSessionCap = { limit: null, warn: false, total: 0, byProject: [] };

export type WorkersPanelView = {
  projects: WorkersPanelProject[];
  sessionCap: WorkersPanelSessionCap;
};

/** 다중 선택 셋(§비주얼 §68 ③) — 비어 있으면 "그 축은 안 걸렀다"다(보드 `BoardFilter`와 같은 규약). */
export type WorkersFilters = {
  project: string[];
  status: WorkerStatus[];
};

export const EMPTY_WORKERS_FILTERS: WorkersFilters = { project: [], status: [] };

/** 읽은 값을 그대로 그릇에 담는다. */
export function buildWorkersPanel(
  projects: WorkersPanelProject[],
  sessionCap: WorkersPanelSessionCap = EMPTY_SESSION_CAP,
): WorkersPanelView {
  return { projects, sessionCap };
}

function passStatus(w: Pick<Worker, "status">, filters: WorkersFilters): boolean {
  return filters.status.length === 0 || filters.status.includes(w.status);
}

/** 프로젝트별로 묶은 행. **묶음 하나가 필터로 0건이 되면 그 묶음을 통째로 뺀다**(§비주얼 §68 ③
 *  §0건 — "머리만 남기면 dira 0 줄이 프로젝트 수만큼 선다"). **연결 안 된 프로젝트는 예외다** —
 *  워커가 원래 0개(못 읽어서)이지 필터가 비운 게 아니라서, 그 사유를 계속 보여준다(§4-16 결정 5:
 *  "빠지면 사람이 워커가 없어진 것으로 읽는다"). */
export function filteredGroups(view: WorkersPanelView, filters: WorkersFilters): WorkersPanelProject[] {
  return view.projects
    .filter((p) => filters.project.length === 0 || filters.project.includes(p.id))
    .map((p) => ({
      ...p,
      workers: p.connected ? p.workers.filter((w) => passStatus(w, filters)) : p.workers,
    }))
    .filter((p) => !p.connected || p.workers.length > 0);
}
