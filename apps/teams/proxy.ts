/** 랜딩-only 경계 — 화면·서버 액션 두 층이 뚫는 유일한 자리(DESIGN.md §한 코드베이스 §플래그).
 *  판정은 요청이 라우트·서버 컴포넌트에 닿기 **전**에 여기서 끝난다 — `/p/[project]/layout.tsx`의
 *  `readProjects()` 같은 fs 읽기가 실행되지 않는다(fs 0회 요건은 화면을 막는 이 자리에서 같이 산다).
 *
 *  액션마다 `if`를 흩지 않는다: Next 서버 액션은 항상 **현재 페이지 URL로 POST**되고 `next-action`
 *  헤더가 실린다 — 그래서 경로 하나(`/`, `/p/**`)만 지키면 그 경로에서 부르는 액션은 지금 것도
 *  앞으로 추가되는 것도 자동으로 막힌다. `/p/**`는 모든 메서드를 404로 끊으므로 그 경로의 액션은
 *  이미 그걸로 거절되고, 아래 `next-action` 검사는 `/`(홈)의 액션까지 마저 덮는다.
 *
 *  `middleware.ts`가 아니라 `proxy.ts`다 — Next 16의 proxy는 **항상 Node.js 런타임**이다.
 *  `middleware.ts`(기본 Edge 런타임)로 두면 `instrumentation.ts`가 물고 있는 `node:fs/promises`
 *  체인이 같은 edge 번들에 실려 모든 요청이 500이었다(실측). */
import { NextResponse, type NextRequest } from "next/server.js";
import { isLandingOnly } from "./lib/flags.ts";

export const config = {
  matcher: ["/", "/p/:path*", "/api/:path*"],
};

export function proxy(request: NextRequest) {
  if (!isLandingOnly()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/p" || pathname.startsWith("/p/") || pathname === "/api" || pathname.startsWith("/api/")) {
    return new NextResponse(null, { status: 404 });
  }
  if (request.method === "POST" && request.headers.has("next-action")) {
    return new NextResponse(null, { status: 403 });
  }
  return NextResponse.next();
}
