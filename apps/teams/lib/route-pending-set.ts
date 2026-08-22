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
  const sources = new Set<object>();
  const listeners = new Set<() => void>();
  return {
    setPending(token: object, pending: boolean) {
      const had = sources.has(token);
      if (pending === had) return;
      if (pending) sources.add(token);
      else sources.delete(token);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return sources.size > 0;
    },
  };
}
