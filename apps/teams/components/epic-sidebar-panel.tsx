"use client";

/** 사이드바 에픽 줄이 접은 값을 펴는 패널(§에픽 결정 15 · §비주얼 §52 ⑨). 그릇이
 *  `popover`인 이유는 그 절 §그릇 — 요구가 지목한 `TooltipContent`는 열려도 문이 포커스를
 *  못 받는다. 줄에 팝업은 이 하나뿐이다(§52 ⑧ 둘째 문은 결정 16으로 걷혔다). */
import type { ReactElement, ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function EpicRowPanel({
  trigger,
  children,
}: {
  /** 줄의 그 링크(`SidebarMenuButton render={<Link>}`) — 패널의 트리거가 된다 */
  trigger: ReactElement;
  children: ReactNode;
}) {
  return (
    <Popover
      onOpenChange={(_open, details) => {
        // 줄의 누름은 필터다(결정 5) — 패널의 토글과 겹치면 한 번 눌러 둘이 같이 일어난다
        if (details.reason === "trigger-press") details.cancel();
      }}
    >
      <PopoverTrigger openOnHover nativeButton={false} role="link" render={trigger} />
      <PopoverContent side="right" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}
