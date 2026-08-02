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

/** 바닥에 붙어 있나. 프리미티브 `scrollEdgeThreshold` 기본값 8px 안이면 붙은 것으로 본다 —
 *  `최신으로`가 `data-active`로 뜨는 경계와 같은 값이다(§비주얼 §13). §9의 32는 그 절의 값이라
 *  안 가져온다(`session-stream.tsx`의 `atBottom`이 그것이다). */
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= 8

function MessageScrollerViewport({
  className,
  ref,
  onScroll,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  // **바닥에 붙어 있으면 놓지 않는다**(§비주얼 §24 §답이 흐르는 동안 `따라가기` 행 —
  // 사람 보고 `4f95f79f` · 티켓 `d887073a`). 프리미티브만으로는 그 행이 두 군데서 거짓이었다:
  //
  // ① **제스처가 방향도 바닥 여부도 안 본다.** `userScrollIntent`가 `wheel`·`touchmove`·방향키
  //    하나에 무조건 `following-bottom` → `free-scrolling`으로 떨어진다. 바닥에 붙은 채로
  //    **아래로** 한 틱만 굴리면 화면은 1px도 안 움직이고 `scroll` 이벤트도 안 난다 — 모드를
  //    되돌리는 유일한 자리가 그 이벤트라 **영영 안 돌아온다**. 그 뒤로는 답이 흘러도 안
  //    따라가는데 `최신으로`도 안 뜬다(바닥이라 `data-active=false`). 사람이 본 것이 이것이다:
  //    "직접 올린 게 아닌데 매번 손으로 내려야 한다"(1440×900 실측 — 한 틱 뒤 gap 48→278px).
  // ② **따라가도 한 프레임 늦다.** 바닥으로 미는 두 경로(Content `childList` MutationObserver ·
  //    Content·Viewport ResizeObserver)가 전부 `requestAnimationFrame`으로 미뤄져서, 조각이
  //    붙은 프레임은 **어긋난 자리로 한 번 그려지고** 다음 프레임에 붙는다(프레임 단위 실측:
  //    45초 스트리밍에 2프레임짜리 어긋남 49회, 최대 264px).
  //
  // 둘 다 **여기 ResizeObserver 하나**로 끝난다. RO 콜백은 레이아웃 뒤 · **페인트 전**이라
  // 여기서 민 `scrollTop`은 어긋난 프레임을 아예 안 만들고(②), 프리미티브 모드를 안 보고
  // 밀므로 ①의 굳은 `free-scrolling`도 지나간다. 민 뒤에 나는 `scroll` 이벤트가 프리미티브의
  // `updateMode`를 태워 모드까지 `following-bottom`으로 되돌려 놓는다.
  //
  // **사람이 위로 올리면 안 따라간다**(§24가 지키라는 것) — `scroll` 이벤트가 `stuck`을 끄고,
  // 그때부터 RO는 아무것도 안 민다. `최신으로`를 누르면 바닥으로 가는 `scroll`이 도로 켠다.
  // `session-stream.tsx`의 `atBottom` + `detached`와 같은 관용구다(§9 §자동 스크롤).
  const stuck = React.useRef(true)
  const viewport = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    // ponytail: 관찰 대상은 Viewport의 첫 자식 = Content다(Root > Viewport > Content). 프리미티브가
    // Content 엘리먼트를 밖으로 안 준다 — 구조가 바뀌면 여기가 먼저 조용해지니 이 줄이 표식이다
    const el = viewport.current
    const content = el?.firstElementChild
    if (!el || !content || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      ref={(el: HTMLDivElement | null) => {
        viewport.current = el
        if (typeof ref === "function") ref(el)
        else if (ref) ref.current = el
      }}
      onScroll={(e) => {
        stuck.current = atBottom(e.currentTarget)
        onScroll?.(e)
      }}
      className={cn(
        // 등록 항목의 `scroll-fade-b`·`scrollbar-*` 넷을 덜어냈다(§비주얼 §13 — 장식이고,
        // "아래에 더 있다"는 `최신으로` 버튼이 이미 글자로 말한다). `globals.css`는 한 줄도 안 는다
        //
        // **`overflow-x-hidden`은 축약이 아니라 계약이다**(`462d90be`): CSS는 `overflow-y`만
        // `auto`인 상태를 허용하지 않는다 — 한쪽이 `auto`면 남은 쪽의 `visible`은 **`auto`로
        // 계산된다**(CSS Overflow 3). 그래서 자손이 1px만 삐져나와도 가로 스크롤바가 15px을 먹고
        // **상시** 그려졌다(답과 입력칸 사이 회색 띠 — 1440×900 실측). §비주얼 §24의 "스크롤하는
        // 요소는 Viewport 하나"는 그 하나가 **세로로만** 스크롤한다는 뜻이라, 축을 계산에 맡기지
        // 않고 여기서 못박는다. 넓은 것(표·펜스)은 자기 그릇이 `overflow-x-auto`로 받으므로
        // (`components/markdown.tsx`) 여기서 잘리는 건 없다.
        // `command.tsx`·`select.tsx`도 같은 짝을 쓴다
        "w-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain contain-content",
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
