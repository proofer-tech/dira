import type { ReactNode } from "react";

// 셸은 아직 비어 있다 — 리셋·킬 스위치·전역 CSS는 랜딩 포트 티켓(§순서 ⑥)이 세운다.
// 여기가 지금 지는 것은 `lang`뿐이고 그것도 `config.ts`의 `lang: "ko-KR"`를 그대로 옮긴 값이다.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko-KR">
      <body>{children}</body>
    </html>
  );
}
