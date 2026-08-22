import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeymapProvider } from "@/components/keymap-provider";
import { LanguageProvider } from "@/components/language-provider";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { DesktopFindBar } from "@/components/find-bar";
import { UpdateToast } from "@/components/update-toast";
import { RoutePending } from "@/components/route-pending";
import { ScreenView } from "@/components/project-switcher";
import { readKeymap, readLanguage } from "@/lib/projects";
import { t } from "@/lib/i18n";
import "../globals.css";

// sans는 `globals.css`의 `@font-face`(원티드산스 · `public/fonts/`)가 든다 — 그래서 Geist
// 임포트가 여기 없다. `Geist_Mono`만 남는다(`--font-mono` 무수정 · P149 못 ⑧).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// `icons`는 `app/icon.svg`(Next 메타데이터 관행)가 지던 것이다 — 옛 site 패키지를
// 합친 이사(`6a24257d`)로 `public/icon.svg`가 정본이 되면서(§한 코드베이스 §부딪히는 것, 파일명 해시가 안 붙는
// URL이 계약이라서다) 여기서 명시로 못박는다. `(site)/layout.tsx`도 같은 값을 못박는다 —
// 두 루트 레이아웃이 갈려서 한쪽에만 적으면 나머지 트리의 파비콘이 없어진다.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await readLanguage();
  return {
    title: "dira",
    description: t(locale, "appLayout.description"),
    icons: { icon: { url: "/icon.svg", type: "image/svg+xml" } },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 키맵은 **여기서 한 번** 읽는다(§0-6 배선). 두 셸이 다 이 아래고 파일 하나짜리 읽기라
  // 셸마다 중복해서 읽을 이유가 없다. `readKeymap()`은 던지지 않는다 — 키맵 파일 하나가
  // 앱 전체를 못 열게 하면 안 된다(깨졌다는 사실은 `broken`으로 화면이 말한다).
  const keymap = await readKeymap();
  // §0-16 §장치. 머신 하나짜리 설정이라 키맵과 같은 자리에서 같이 읽는다.
  const locale = await readLanguage();
  return (
    <html
      lang={locale}
      className={`${geistMono.variable} h-full overflow-hidden antialiased`}
    >
      {/* 세로 스크롤의 주체는 `main`이다 — 문서가 아니다(§비주얼 §4). `h-full`이라 셸이 뷰포트
          높이를 잡고, 헤더 아래를 `main`이 채운다(그 `main`이 자기 안에서 스크롤한다). 보드는
          그 높이를 레인까지 흘려보내 화면에 맞는다(§1). `min-h-full`이면 문서가 다시 길어진다.
          `overflow-hidden`은 **`html`에** 건다 — 없으면 문서가 내용 없이 수십 px 밀리고
          (티켓 상세 1440×900 실측 36px: 아무것도 안 드러나는 헛스크롤이다) `body`에 걸면
          뷰포트로 전파되면서 정작 그 스크롤이 안 잡힌다(실측).
          **그래서 모든 화면의 `main`이 스크롤러여야 한다** — 안 그러면 넘친 내용이 못 닿는다 */}
      <body className="flex h-full flex-col">
        {/* 툴팁은 잘린 경로 전문·배지 설명에 쓴다. shadcn tooltip이 Provider를 요구한다 */}
        {/* `screen_view`를 보내는 유일한 자리(§0-11). 화면 8종이 전부 이 아래고 그리는 것이 없다 */}
        <ScreenView />
        {/* §0-12 의견 폼. 여는 신호(`dira:feedback`)는 데스크톱 셸의 `Help` 메뉴에서 오고
            **화면 이동 없이 지금 화면 위에** 떠야 해서 자리가 여기다. 닫혀 있으면 안 그린다 */}
        <FeedbackDialog />
        <TooltipProvider>
          <LanguageProvider locale={locale}>
            <KeymapProvider keymap={keymap}>
              {children}
              {/* §데스크톱 앱 N5 찾기 바. **`KeymapProvider` 안**이어야 한다 — `⌘F`는 키맵의
                  값이고 `useHotkey`가 그 컨텍스트를 읽는다(§0-6). 자리가 여기인 이유는
                  `<FeedbackDialog/>`와 같다: 붙는 화면이 다섯이고 레이아웃이 둘로 갈린다.
                  뜨지 않는 화면(보드·홈)과 셸(브라우저)은 저 컴포넌트가 판정해 `null`이다 */}
              <DesktopFindBar />
              {/* §릴리스 - 자동 업데이트 §표면이 창 안으로 들어온다(§비주얼 §55). `LanguageProvider`
                  안인 이유는 `containerAriaLabel`이 이 셸의 다른 aria-label처럼 사전을 지나서다
                  (§0-16). `<FeedbackDialog>`-`<DesktopFindBar>`와 같은 자리 - 화면 이동 없이
                  지금 화면 위에 뜬다 */}
              <UpdateToast />
              {/* §0-22 - §비주얼 §65. `{children}` 뒤 - 헤더의 `sticky z-50`과 DOM 순서로
                  갈리는 같은 `z-50`이다(§65 ②) */}
              <RoutePending />
            </KeymapProvider>
          </LanguageProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
