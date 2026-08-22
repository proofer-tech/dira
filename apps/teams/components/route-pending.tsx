"use client";

/** 화면과 화면 사이의 대기 창 - 셸의 표식 하나 (DESIGN.md §0-22 - §비주얼 §65).
 *
 *  루트 레이아웃에 한 번 마운트되고 이 앱에 다른 인스턴스가 없다(§65 ①). `<Link>`(`useLinkStatus`) -
 *  `router.push`/`replace`(`useTransition`) 두 갈래의 신호가 `lib/route-pending.ts`에서 한 값으로
 *  모여 여기로 온다 - `router.refresh()`(폴링)는 그 모듈을 안 써서 여기에 안 뜬다(결정 3).
 *
 *  그릇(`role="status"`)은 늘 마운트돼 있다 - 꺼진 동안 안쪽 잉크가 0이라 화면에서는 없는 것과
 *  같다(§65 ⑦ 빈 상태). 2px 줄 자신은 `aria-hidden`이고 낭독은 `sr-only` 낱말 하나가 딴다
 *  (§65 ⑤) - 같은 사실을 두 번 안 읽는다. */

import { useT } from "@/components/language-provider";
import { useDelayedFlag, useRoutePending } from "@/lib/route-pending";

export function RoutePending() {
  const pending = useRoutePending();
  const visible = useDelayedFlag(pending);
  const t = useT();
  return (
    <div
      data-slot="route-pending"
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
    >
      {visible && (
        <>
          <div aria-hidden className="h-full bg-primary" />
          <span className="sr-only">{t("shell.pending.srLabel")}</span>
        </>
      )}
    </div>
  );
}
