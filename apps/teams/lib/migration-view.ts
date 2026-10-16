/** 마이그레이션 오버레이의 순수 판정 (DESIGN.md P505 "화면 (오버레이)").
 *
 *  `node:*`가 없다 - 오버레이(클라이언트 컴포넌트)가 직접 import한다. 상태 파일 모양은
 *  `migrate.py`의 `Status`가 정본이고, 여기는 읽는 쪽 타입과 판정만 든다. */

export type MigrationState = "대기" | "세션 대기" | "진행" | "완료" | "실패" | "건너뜀";

export type MigrationRow = {
  key: string;
  name: string;
  root: string | null;
  state: MigrationState;
  item: string;
  desc: string;
  desc_en: string;
  sessions: number;
  waited_s: number;
  error: string;
  log: string;
  backup: string;
};

export type MigrationStatus = {
  pid: number;
  started_at: string;
  finished_at: string | null;
  rows: MigrationRow[];
};

/** 세션 대기 상한 - 넘으면 사람에게 묻는다(결정 5). */
export const WAIT_LIMIT_S = 20 * 60;

/** 오버레이가 걷히기 전에 머무는 시간. */
export const CLOSE_DELAY_MS = 1000;

/** 보이는 조건: `완료`와 `건너뜀`이 아닌 행이 하나라도 있다. */
export function needsOverlay(rows: MigrationRow[] | undefined): boolean {
  return !!rows?.some((r) => r.state !== "완료" && r.state !== "건너뜀");
}

/** 지금 그려야 하나. `doneAt`은 `needsOverlay`가 참에서 거짓으로 바뀐 시각(없으면 null)이고,
 *  그로부터 1초 동안은 마지막 모습을 유지한다. */
export function overlayShown(rows: MigrationRow[] | undefined, doneAt: number | null, now: number): boolean {
  return needsOverlay(rows) || (doneAt !== null && now - doneAt < CLOSE_DELAY_MS);
}

/** 세션 대기가 상한을 넘었나 - 버튼 둘이 붙는 조건. */
export function waitExpired(row: MigrationRow): boolean {
  return row.state === "세션 대기" && row.waited_s >= WAIT_LIMIT_S;
}

/** `mm:ss` - 분은 두 자리 이상으로 늘어난다. */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
