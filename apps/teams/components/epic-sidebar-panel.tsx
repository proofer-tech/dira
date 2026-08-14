"use client";

/** 사이드바 에픽 줄이 접은 값을 펴는 패널(§에픽 결정 15 · §비주얼 §52 ⑨). 그릇이
 *  `popover`인 이유는 그 절 §그릇 — 요구가 지목한 `TooltipContent`는 열려도 문이 포커스를
 *  못 받는다. 한 줄에 팝업은 하나다: 이 패널이 포인터 채널을 들면 ⑧의 툴팁(포인터 채널)은
 *  취소한다 — 그 툴팁은 포커스 채널로만 남는다(§52 ⑨ §트리거와 지연). */
import type { ReactElement, ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EpicRowPanel({
  trigger,
  memoryTrigger,
  memoryLabel,
  children,
}: {
  /** 줄의 그 링크(`SidebarMenuButton render={<Link>}`) — 패널의 트리거가 된다 */
  trigger: ReactElement;
  /** 둘째 문(§52 ⑧) — `(에픽 없음)`처럼 갈 곳이 없으면 준다 안 준다 */
  memoryTrigger?: ReactElement;
  memoryLabel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
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
      {memoryTrigger && (
        <Tooltip
          onOpenChange={(_open, details) => {
            // 포인터 채널은 위 패널이 든다 — 같은 자리에 두 팝업이 겹치는 것을 막는다
            if (details.reason === "trigger-hover") details.cancel();
          }}
        >
          <TooltipTrigger render={memoryTrigger} />
          <TooltipContent side="right">{memoryLabel}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
