import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeymapProvider } from "@/components/keymap-provider";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { DesktopFindBar } from "@/components/find-bar";
import { ScreenView } from "@/components/project-switcher";
import { readKeymap } from "@/lib/projects";
import "./globals.css";

// sans는 `globals.css`의 `@font-face`(원티드산스 · `public/fonts/`)가 든다 — 그래서 Geist
// 임포트가 여기 없다. `Geist_Mono`만 남는다(`--font-mono` 무수정 · P149 못 ⑧).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "dira",
  description: "파일시스템 티켓 큐 관제",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 키맵은 **여기서 한 번** 읽는다(§0-6 배선). 두 셸이 다 이 아래고 파일 하나짜리 읽기라
  // 셸마다 중복해서 읽을 이유가 없다. `readKeymap()`은 던지지 않는다 — 키맵 파일 하나가
  // 앱 전체를 못 열게 하면 안 된다(깨졌다는 사실은 `broken`으로 화면이 말한다).
  const keymap = await readKeymap();
  return (
    <html
      lang="ko"
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
        {/* `screen_view`를 보내는 유일한 자리(§0-11). 화면 7종이 전부 이 아래고 그리는 것이 없다 */}
        <ScreenView />
        {/* §0-12 의견 폼. 여는 신호(`dira:feedback`)는 데스크톱 셸의 `Help` 메뉴에서 오고
            **화면 이동 없이 지금 화면 위에** 떠야 해서 자리가 여기다. 닫혀 있으면 안 그린다 */}
        <FeedbackDialog />
        <TooltipProvider>
          <KeymapProvider keymap={keymap}>
            {children}
            {/* §데스크톱 앱 N5 찾기 바. **`KeymapProvider` 안**이어야 한다 — `⌘F`는 키맵의
                값이고 `useHotkey`가 그 컨텍스트를 읽는다(§0-6). 자리가 여기인 이유는
                `<FeedbackDialog/>`와 같다: 붙는 화면이 다섯이고 레이아웃이 둘로 갈린다.
                뜨지 않는 화면(보드·홈)과 셸(브라우저)은 저 컴포넌트가 판정해 `null`이다 */}
            <DesktopFindBar />
          </KeymapProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
