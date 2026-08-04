import type { ReactNode } from "react";

// 셸이 지는 것은 `lang`뿐이고 그것도 `config.ts`의 `lang: "ko-KR"`를 그대로 옮긴 값이다.
// 리셋·킬 스위치·랜딩 전역 CSS는 `app/landing.css` 한 벌이고 `landing.tsx`가 문다 —
// 여기서 물면 매뉴얼 셸(§순서 ⑤)까지 그 리셋을 받는다. 랜딩은 라이트 전용이고 매뉴얼은
// 두 모드라(§사이트 기반 §그대로 서는 못) 두 셸이 각자 자기 전역 CSS를 갖는다.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko-KR">
      <body>{children}</body>
    </html>
  );
}
