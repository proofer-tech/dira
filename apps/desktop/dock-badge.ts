// §데스크톱 앱 §N7 독 아이콘 배지 — N2가 이미 세는 둘(답변 대기 + 디스패치 보류)의 합을
// 독 아이콘에 그린다. 계약: ../../docs/DESIGN.md §데스크톱 앱 §N7.
//
// 판정은 두 층의 직전 수만 보는 순수 함수다 — 실패한 층은 호출하는 쪽이 갱신을 건너뛰어
// 직전 수가 그대로 남는다(§N2 신뢰 경계와 같은 관용구, `link.ts` 참고).

/** 두 층의 지금 수. 실패한 층은 호출하는 쪽이 이 값을 안 갈아서 직전 수를 유지한다. */
export interface DockCounts {
  awaiting: number;
  gate: number;
}

/** 실패한 층은 `next`가 `null`이면 `prev`를 그대로 돌려주고, 성공한 층은 `next`로 간다. */
export function nextCount(prev: number, next: number | null): number {
  return next === null ? prev : next;
}

/** 합이 0이면 배지를 지우는 빈 문자열, 그 외엔 합의 문자열. 상한 없음(§상한을 두지 않는다). */
export function badgeText(counts: DockCounts): string {
  const total = counts.awaiting + counts.gate;
  return total === 0 ? "" : String(total);
}
