"use client";

/** 화면과 화면 사이의 대기 창 - 공유 배선 (DESIGN.md §0-22 결정 2 - §비주얼 §65).
 *
 *  갈래 둘(`<Link>`의 `useLinkStatus` - `router.push`/`replace`의 `useTransition`)이 신호를
 *  한 값으로 모으는 자리가 여기다 - 소스별 토큰으로 `Set`에 넣고 하나라도 남으면 켜진 채다.
 *  `<RoutePending/>`(셸)가 이 값을 구독해 300ms 지나서도 켜져 있으면 표식을 켠다(§65 ③).
 *
 *  **`router.refresh()`는 이 모듈을 안 쓴다** - 감싸는 것은 사람이 부른 이동뿐이다(§0-22 결정
 *  3). 폴링 자리(보드 5초 - 티켓 상세 mtime - 스트림 2초 - 온톨로지 600ms)는 그대로
 *  `useRouter()`를 쓰고 여기 훅을 안 부른다. */

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPendingSet } from "./route-pending-set";

/** §65 ③ - 상수 하나. 입구 둘(결정 2) - 전환기 예외(§65 ④)가 전부 이 값을 쓴다. */
export const ROUTE_PENDING_DELAY_MS = 300;

const routePending = createPendingSet();
const setSourcePending = routePending.setPending;
const subscribe = routePending.subscribe;
const getSnapshot = routePending.getSnapshot;

function getServerSnapshot() {
  return false;
}

/** 300ms 지나서도 `active`면 `true`를 낸다 - 그 전에 꺼지면 한 프레임도 안 뜬다(§65 ③).
 *  전환기 `프로젝트 관리` 항목의 "여는 중"(§65 ④)도 이 지연을 그대로 쓴다.
 *
 *  `active`가 꺼지면 **렌더 중에** 바로 `visible`을 내린다(React가 문서로 고정한 "이전 값과
 *  비교해 렌더 중 상태를 조정하는" 패턴) - 이펙트 본문에서 곧장 `setState`를 부르면 커밋
 *  직후 렌더가 한 번 더 도는 것을 react-hooks/set-state-in-effect가 잡는다. */
export function useDelayedFlag(active: boolean, delayMs: number = ROUTE_PENDING_DELAY_MS) {
  const [visible, setVisible] = useState(false);
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setVisible(false);
  }
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return visible;
}

/** `<RoutePending/>`이 구독하는 훅 - 두 갈래 중 하나라도 켜져 있으면 `true`다. */
export function useRoutePending() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `<Link>` 자손(우리 `Link` 래퍼)이 부르는 리포터 - 그리는 것은 0이다(§65 ⑨). */
export function useLinkPendingReporter(pending: boolean) {
  const [token] = useState(() => ({}));
  useEffect(() => {
    setSourcePending(token, pending);
    return () => setSourcePending(token, false);
  }, [token, pending]);
}

/** `router.push`/`replace` 갈래(결정 2) - 부르는 쪽이 `useRouter()` 대신 이걸 쓰면 그 호출만
 *  `startTransition`에 실려 셸에 신호를 낸다. 같은 컴포넌트의 다른 상태(발행 중 - 등록 해제
 *  중 같은 변경 갈래 표시)는 안 건든다 - 이 훅이 여는 것은 그 이후의 이동 한 호출뿐이다. */
export function useTrackedRouter() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token] = useState(() => ({}));
  useEffect(() => {
    setSourcePending(token, pending);
    return () => setSourcePending(token, false);
  }, [token, pending]);
  return useMemo(
    () => ({
      push: (...args: Parameters<typeof router.push>) =>
        startTransition(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        startTransition(() => router.replace(...args)),
    }),
    [router, startTransition],
  );
}
