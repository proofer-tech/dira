import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "dira",
  description: "파일시스템 티켓 큐 관제",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased`}
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
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
