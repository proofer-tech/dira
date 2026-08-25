/** 공개 배포 스위치 — 화면·서버 액션·fs 세 층이 다 이 함수 하나를 본다(DESIGN.md §한 코드베이스
 *  §플래그). 없으면(`undefined`) 풀 모드다 — 데스크톱 앱·`pnpm dev`는 아무것도 안 주고
 *  지금대로 뜬다. `DIRA_ENGINE`·`TICKET_LOCAL`과 같은 결의 이름, 콘솔이 공개 배포에서만 켠다. */
export function isLandingOnly(): boolean {
  return process.env.DIRA_LANDING_ONLY === "1";
}

/** 다중 토큰 잠금 스위치 — 폴라리티가 위 함수와 반대다: 없으면(`undefined`) **잠김**이다
 *  (DESIGN.md §0-13 §잠금). 빠뜨린 빌드가 배포물이 되므로 누락이 안전한 쪽(잠김)으로
 *  떨어져야 한다. `next.config.ts`의 `env`가 빌드 시각에 이 값을 상수로 굳힌다 — 런타임
 *  env로는 릴리스 dmg를 나중에 못 연다. 이 값을 읽는 자리는 이 함수 하나다. */
export function isMultiToken(): boolean {
  return process.env.DIRA_MULTI_TOKEN === "1";
}
