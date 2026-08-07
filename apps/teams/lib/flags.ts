/** 공개 배포 스위치 — 화면·서버 액션·fs 세 층이 다 이 함수 하나를 본다(DESIGN.md §한 코드베이스
 *  §플래그). 없으면(`undefined`) 풀 모드다 — 데스크톱 앱·`pnpm dev`는 아무것도 안 주고
 *  지금대로 선다. `DIRA_ENGINE`·`TICKET_LOCAL`과 같은 결의 이름, 콘솔이 공개 배포에서만 켠다. */
export function isLandingOnly(): boolean {
  return process.env.DIRA_LANDING_ONLY === "1";
}
