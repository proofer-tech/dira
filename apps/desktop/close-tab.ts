// §P528 — `dispatchEvent`의 반환값은 리스너가 preventDefault하지 않았을 때만 true다.
// false면 홈이 탭을 닫았다. 그 밖(true, 렌더러 호출 실패)은 창을 닫는다.
// $ cd apps/desktop && pnpm test
export function closeTabOutcome(result: unknown): "tab" | "window" {
  return result === false ? "tab" : "window";
}
