"use client";

/** 사이드바 에픽 줄이 접은 값을 펴는 패널(§에픽 결정 15 · §비주얼 §52 ⑨). 그릇이
 *  `popover`인 이유는 그 절 §그릇 — 요구가 지목한 `TooltipContent`는 열려도 문이 포커스를
 *  못 받는다. 한 줄에 팝업은 하나다: 이 패널이 포인터 채널을 들면 ⑧의 툴팁(포인터 채널)은
 *  취소한다 — 그 툴팁은 포커스 채널로만 남는다(§52 ⑨ §트리거와 지연).
 *  과녁(⑧)은 이 패널의 둘째 트리거다 — 줄 위에 겹쳐 뜬 형제 요소라 커서가 그 위로 가면
 *  줄의 hover가 끝나고, 실측상 safePolygon이 그 틈을 안 메운다(§52 ⑨ §검증(3) 지적 `f89f9f96`).
 *  그래서 안전지대 추론 대신 과녁 자체를 같은 `Popover`의 hover 트리거로 등록한다. */
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
    <Popover
      onOpenChange={(_open, details) => {
        // 줄의 누름은 필터다(결정 5) — 패널의 토글과 겹치면 한 번 눌러 둘이 같이 일어난다
        if (details.reason === "trigger-press") details.cancel();
      }}
    >
      <PopoverTrigger openOnHover nativeButton={false} role="link" render={trigger} />
      {memoryTrigger && (
        <Tooltip
          onOpenChange={(_open, details) => {
            // 포인터 채널은 이 패널이 든다 — 같은 자리에 두 팝업이 겹치는 것을 막는다
            if (details.reason === "trigger-hover") details.cancel();
          }}
        >
          {/* 과녁도 같은 Popover의 둘째 트리거다 — 포커스 채널(탭)은 안쪽 TooltipTrigger가,
              포인터 채널(hover)은 바깥 PopoverTrigger가 같은 패널을 연다 */}
          <TooltipTrigger
            render={
              <PopoverTrigger openOnHover nativeButton={false} role="link" render={memoryTrigger} />
            }
          />
          <TooltipContent side="right">{memoryLabel}</TooltipContent>
        </Tooltip>
      )}
      <PopoverContent side="right" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}
