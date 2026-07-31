"use client"

import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowDownIcon } from "lucide-react"

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        // `size-full` → `w-full`(§비주얼 §13): 부모가 `Card`·`DialogContent`라 `h-full`이 auto로
        // 풀리고 `max-h`가 아무 일도 안 한다. 높이를 무는 곳은 Viewport 하나다
        "group/message-scroller relative flex w-full min-h-0 flex-col overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        // 등록 항목의 `scroll-fade-b`·`scrollbar-*` 넷을 덜어냈다(§비주얼 §13 — 장식이고,
        // "아래에 더 있다"는 `최신으로` 버튼이 이미 글자로 말한다). `globals.css`는 한 줄도 안 는다
        "w-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content",
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      // `gap-6` → `gap-4`(§비주얼 §13 — 24px은 마케팅 채팅의 값이다)
      className={cn("flex h-max min-h-full flex-col gap-4", className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      // 등록 항목의 `[content-visibility:auto] [contain-intrinsic-size:auto_10rem]`을 지웠다
      // (§비주얼 §13 — 메시지 수백 개용인데 이 스레드는 2~6개고, 페이지 내 찾기에서 항목이 숨는다)
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  // `icon-sm` → `sm`(§비주얼 §13): 아이콘만이면 "한 화면 아래로"인지 "맨 끝으로"인지 안 갈려서
  // 라벨(`최신으로`)을 남겼고, 그러면 크기가 아이콘 버튼일 수 없다
  size = "sm",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        // §비주얼 §13 `최신으로` 버튼: 등록 항목의 `translate`/`scale`/`duration-400`/
        // `cubic-bezier(…)` 묶음을 지웠다(§0 — 히어로도 애니메이션도 없다). `inset-s-1/2`도
        // `left-1/2`다(RTL을 쓰지 않는다). `bottom-4`는 384px 상자에서 바닥 48px을 가려 `bottom-2`.
        // `shadow-sm`은 장식이 아니라 층 표시다 — `--border`가 말풍선 면에서 1.26이라 테두리만으로는
        // 흰 알약이 흰 여백에서 안 갈린다(§13 실측표 ③)
        "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background text-foreground shadow-sm transition-opacity duration-150 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[direction=start]:top-2 data-[direction=start]:bottom-auto data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
