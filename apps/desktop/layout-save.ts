// 레이아웃 기록 IPC 입력 검사(P549 결정 4). electron 없이 테스트하려고 분리했다.
export const LAYOUT_MAX_BYTES = 8 * 1024;

/** 문자열이고 8 KB 이하이며 `v: 1`인 JSON 객체일 때만 그대로 돌려준다. 아니면 null. */
export function acceptLayout(raw: unknown): string | null {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > LAYOUT_MAX_BYTES) return null;
  try {
    const o = JSON.parse(raw);
    return typeof o === "object" && o !== null && !Array.isArray(o) && o.v === 1 ? raw : null;
  } catch {
    return null;
  }
}
