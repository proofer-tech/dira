/** 소스별 토큰을 세는 집계기 - `route-pending.ts`가 쓰는 로직 중 React 의존이 없는 부분만 여기
 *  있다. `useSyncExternalStore`용 구독 - `Set` dedup은 순수 로직이라 `route-pending.test.ts`가
 *  직접 돈다 - React·`next/navigation`을 문 파일은 node의 네이티브 TS 로더가 모듈 해석에서
 *  걸린다(`next/navigation`이 `exports` 맵 조건과 안 맞는다, 실측). 파일을 가른 이유가 그것이다.
 *
 *  `useTrackedRouter`·`useLinkPendingReporter`·`<RoutePending/>`(DESIGN.md §0-22 결정 2 -
 *  §비주얼 §65)이 이 인스턴스 하나를 공유해 두 갈래(`<Link>` - `router.push`/`replace`)의
 *  신호를 한 값으로 모은다 - 하나라도 남으면 켜진 채다(dedup - 같은 값 재설정은 구독자를 안
 *  깨운다). */
export function createPendingSet() {
  // 값은 목적지 경로다(P534 결정 3) - 없는 소스(`trackPending`)는 `null`이다.
  const sources = new Map<object, string | null>();
  const listeners = new Set<() => void>();
  function setPending(token: object, pending: boolean, dest: string | null = null) {
    const had = sources.has(token);
    if (pending === had && (!pending || sources.get(token) === dest)) return;
    if (pending) sources.set(token, dest);
    else sources.delete(token);
    listeners.forEach((l) => l());
  }
  return {
    setPending,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return sources.size > 0;
    },
    /** 가장 나중에 켠 소스의 목적지 - 켜진 것이 없거나 목적지를 안 실은 소스면 `null`이다. */
    getDest() {
      let last: string | null = null;
      sources.forEach((d) => {
        last = d;
      });
      return last;
    },
    /** 훅이 아닌 입구(§11-20 결정 2) - 토큰 하나를 받자마자 켜고, 넘긴 프라미스가 끝나면
     *  (성공 - 실패 둘 다) 끈다. `openLink`처럼 컴포넌트 밖 함수가 셸 표식을 켜고 싶을 때
     *  `route-pending.ts`의 `trackPending`이 이 메서드를 그대로 부른다. */
    trackPending<T>(promise: Promise<T>): Promise<T> {
      const token = {};
      setPending(token, true);
      return promise.finally(() => setPending(token, false));
    },
  };
}
