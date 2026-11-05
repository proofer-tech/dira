// §데스크톱 앱 고정하는 것 9 — 렌더러가 멎었을 때 사람에게 다시 읽을지 묻는 판정.
// electron을 안 만지는 순수 함수라 `hang-prompt.test.ts`가 창 없이 분기를 밟는다.

/** `unresponsive` 뒤 이만큼 `responsive`가 안 오면 묻는다. */
export const HANG_PROMPT_MS = 5000;

export function shouldAskReload(state: { elapsedMs: number; asked: boolean; visible: boolean }): boolean {
  return state.elapsedMs >= HANG_PROMPT_MS && !state.asked && state.visible;
}
