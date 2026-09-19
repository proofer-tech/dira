/** 마켓 검색 판정 — `lib/market.ts`에서 분리(티켓 `c7abc609`). `matchesMarketSearch`는
 *  `components/market-ui.tsx`("use client")가 값으로 부르는 순수 함수라, fs를 읽는
 *  `market.ts`(`deployPersona` 등)와 같은 파일에 있으면 그 fs 임포트 체인 전체가 클라이언트
 *  번들에 끌려 들어가 Turbopack이 죽는다. `MarketItem`은 타입만 가져온다(erased, 런타임
 *  임포트 없음) — 이 파일은 fs를 전혀 읽지 않는다. */
import type { MarketItem } from "./market.ts";

/** 검색 판정 — 이름·소유 프로젝트 이름·태그·`PROFILE.md` 첫 줄을 훑는다(DESIGN.md §페르소나
 *  마켓 §화면). `profileFirstLine`은 호출자가 `getMarketItem`으로 미리 뽑아 넘긴다(페르소나가
 *  아니면 빈 문자열). 빈 검색어는 항상 참이다. */
export function matchesMarketSearch(
  item: Pick<MarketItem, "name" | "ownerName" | "tags">,
  profileFirstLine: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = [item.name, item.ownerName, ...item.tags, profileFirstLine].join(" ").toLowerCase();
  return hay.includes(q);
}
