import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/language-provider";
import { siteLocale } from "./request-locale";

// 셸이 지는 것은 `lang`과 `LanguageProvider` 배선 둘이다. `lang`은 종전 `config.ts`의
// `lang: "ko-KR"` 상수였는데 §0-24가 그 값을 요청이 그린 언어를 따라가게 만든다
// (`ko-KR`·`en-US`) — 네 공개 라우트(`/` · `/docs/**` · `/terms` · `/privacy`)가 이 레이아웃
// 하나를 공유해서 판정도 한 자리에서 끝난다.
// 킬 스위치는 `app/landing.css`가 지고, 그 파일은 `(list)/page.tsx`만 무는 `globals.css`가
// `landing` 레이어로 싣는다(§비주얼 §46 ①) — 매뉴얼 셸(§순서 ⑤)은 이 파일을 안 물어 그
// 리셋을 안 받는다. 랜딩은 라이트 전용이고 매뉴얼은 두 모드라(§사이트 기반 §그대로 남는 규칙)
// 두 셸이 각자 자기 전역 CSS를 갖는다.

// `config.ts:33`의 `head` 한 줄이 여기로 온다 — 그 배열이 26장 전부에
// `<link rel="icon" href="/icon.svg" type="image/svg+xml">`를 굽고 있었다. 자리가 루트
// 레이아웃인 것은 페이지 `metadata`가 `title`·`description`만 덮고 `icons`는 물려받기 때문이다.
// 파일을 `app/icon.svg`로 옮기면 Next가 자동으로 잡지만 그러면 URL에 해시가 붙어서
// **주소가 갈린다** — `public/icon.svg`가 정본이라는 것이 §갈아 끼우는 것의 그 행이다.
// `apps/teams`로 합친 뒤로는 `(app)/layout.tsx`도 같은 값을 고정한다 — 루트 레이아웃이
// 둘로 갈려서(§한 코드베이스 §부딪히는 것 ①) 한쪽만 적으면 나머지 트리에 파비콘이 없다.
export const metadata: Metadata = {
  icons: { icon: { url: "/icon.svg", type: "image/svg+xml" } },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await siteLocale();

  return (
    <html lang={locale === "en" ? "en-US" : "ko-KR"}>
      <body>
        <LanguageProvider locale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
