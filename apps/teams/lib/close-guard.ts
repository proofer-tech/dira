/** 닫기 확인의 판정 둘 - `useCloseGuard`와 `useRequestForm`(components/ticket-ui.tsx)이 쓴다.
 *  훅은 DOM 없이 못 돌려서 판정만 여기 빼 두고 `close-guard.test.ts`가 고정한다. */

/** 요구 접수 폼이 잃을 내용을 쥐고 있는가. 접수 확인 화면(`done`)은 이미 접수돼서 잃을 것이 없다. */
export function requestDirty(done: string | null | undefined, body: string, attDirty: boolean): boolean {
  return !done && (body !== "" || attDirty);
}

/** 닫기 요청(Esc - 밖 클릭 - 미러 재클릭 - 버튼)을 받았을 때 할 일. */
export function closeAction(next: boolean, dirty: boolean): "open" | "ask" | "discard" {
  if (next) return "open";
  return dirty ? "ask" : "discard";
}
