import * as React from "react"

const MOBILE_BREAKPOINT = 768

// 원본은 `useState(undefined)` + `useEffect` 안에서 곧바로 `setIsMobile(...)`을 부르는데,
// 이 앱의 lint(`react-hooks/set-state-in-effect`)가 그것을 **에러**로 잡는다. 같은 일을
// React가 이 용도로 내놓은 API 하나로 적었다 — 값·타이밍이 원본과 같다:
// 서버와 하이드레이션 첫 렌더는 `false`(원본의 `!!undefined`), 그 뒤 실제 폭, 그다음은
// `change` 구독. `alert.tsx`·`sidebar.tsx`와 같은 자리다(`AGENTS.md` §손으로 고친 부품).
export function useIsMobile() {
  return React.useSyncExternalStore(
    React.useCallback((onChange: () => void) => {
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }, []),
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
