"use client";

/** 에픽 사이드바 목록 끝 감시행(DESIGN.md §에픽 결정 22 · §비주얼 §52 ⑪) — `BoardDoneLane`
 *  (`board-ui.tsx`)과 같은 기전이다: 마지막 줄 뒤 1px 상자가 보이면 `?epics=`를 20 올린다.
 *  스피너·<불러오는 중> 없음, `SidebarMenu`(`<ul>`)의 자식이라 `<li>`다.
 *
 *  `useUrlNav`(`board-ui.tsx`)를 그대로 안 쓰는 이유 — 그 훅의 `replace`는 목록이 갈릴 때
 *  `rows`·`done`을 지운다(§1 §되감기). 사이드바 목록에는 되감기 판정이 없다(§에픽 결정 22
 *  §되감기 판정 — "다른 목록으로 갈리는 자리가 없다") — `epics`만 올리고 다른 파라미터는
 *  손대지 않는다. */
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTrackedRouter } from "@/lib/route-pending";
import { EPIC_SIDEBAR_PAGE, epicLimit } from "@/lib/urls";

export function EpicSidebarMore({ more, shown }: { more: boolean; shown: number }) {
  const router = useTrackedRouter();
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const sentinel = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return;
      const next = new URLSearchParams(qs);
      // 요청은 그려진 줄에서 센다(URL이 아니다) — `BoardDoneLane`과 같은 이유.
      if (shown + EPIC_SIDEBAR_PAGE <= epicLimit(next.get("epics"))) return;
      next.set("epics", String(shown + EPIC_SIDEBAR_PAGE));
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router는 매 렌더 새 함수다(qs가 실질 의존)
  }, [qs, shown, pathname]);

  if (!more) return null;
  // 1px 감시행. 높이가 0이면 교차비가 0으로 굳어 안 걸린다(`BoardDoneLane`과 같은 주석)
  return <li ref={sentinel} aria-hidden className="h-px" />;
}
