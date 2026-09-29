/** 다음 디스패치까지 남은 초 — 순수 계산 (DESIGN.md §1-6 §값 §계산).
 *
 *  `NextDispatch`(`components/next-dispatch.tsx`)가 1초마다 이 함수만 다시 부른다 — 서버
 *  왕복도 새 상태도 없다. 함수를 따로 뗀 이유는 클라이언트 컴포넌트를 이 테스트 러너가
 *  `import`하지 못해서다(선례 `early-refresh.test.ts` 주석) — 계산 자체는 순수 함수라 여기서
 *  바로 단정할 수 있다. */

/** idle 워커마다 `주기 - (floor(now/1000) % 주기)`의 **최솟값**. 결과는 `1..min(periods)`다.
 *  `periods`가 비어 있으면 뜰 자리가 아니므로(§1-6 §뜨는 조건) `null`을 낸다. */
export function secondsLeft(periods: readonly (30 | 60)[], now: number = Date.now()): number | null {
  if (periods.length === 0) return null;
  const sec = Math.floor(now / 1000);
  return Math.min(...periods.map((p) => p - (sec % p)));
}
