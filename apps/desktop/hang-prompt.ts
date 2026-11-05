// §데스크톱 앱 고정하는 것 9 — 렌더러가 멎었을 때 사람에게 다시 읽을지 묻는 판정.
// electron을 안 만지는 순수 함수라 `hang-prompt.test.ts`가 창 없이 분기를 밟는다.

/** `unresponsive` 뒤 이만큼 `responsive`가 안 오면 묻는다. */
export const HANG_PROMPT_MS = 5000;

export function shouldAskReload(state: { elapsedMs: number; asked: boolean; visible: boolean }): boolean {
  return state.elapsedMs >= HANG_PROMPT_MS && !state.asked && state.visible;
}

/** `unresponsive`가 다시 오면 asked를 되돌리되, 대화상자가 열려 있으면 그대로 둬서 하나만 뜨게 한다. */
export function askedAfterUnresponsive(dialogOpen: boolean): boolean {
  return dialogOpen;
}

/** `responsive`가 오면 열린 대화상자는 닫고, 되살리기는 하지 않는다. */
export function shouldCloseDialogOnResponsive(dialogOpen: boolean): boolean {
  return dialogOpen;
}
