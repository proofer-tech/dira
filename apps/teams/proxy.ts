/** 랜딩-only 경계 — 화면·서버 액션 두 층이 뚫는 유일한 자리(DESIGN.md §한 코드베이스 §플래그).
 *  판정은 요청이 라우트·서버 컴포넌트에 닿기 **전**에 여기서 끝난다 — `/p/[project]/layout.tsx`의
 *  `readProjects()` 같은 fs 읽기가 실행되지 않는다(fs 0회 요건은 화면을 막는 이 자리에서 같이 그대로다).
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
import { LOCALE_COOKIE, localePath, stripEn } from "./lib/i18n.ts";
import { acceptLanguageLocale } from "./lib/site-locale.ts";

export const config = {
  matcher: ["/", "/p/:path*", "/api/:path*", "/market", "/en", "/en/:path*", "/docs", "/docs/:path*", "/privacy", "/terms"],
};

/** 공개 사이트 주소(한국어 기준)다 - 언어 판정이 걸리는 자리 전부. */
const PUBLIC_PATH = /^\/(docs(\/.*)?|privacy|terms)?$/;

/** P548 결정 1-2 - `/en/**`는 한국어 라우트를 `x-site-locale: en`과 함께 rewrite해 그린다
 *  (`app/(site)/request-locale.ts`가 읽는다). 클라이언트가 보낸 같은 이름 헤더는 늘 지운다. */
function publicLocale(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const base = stripEn(pathname);
  const isEn = base !== pathname;
  const headers = new Headers(request.headers);
  headers.delete("x-site-locale");
  if (isEn) {
    headers.set("x-site-locale", "en");
    const url = request.nextUrl.clone();
    url.pathname = base;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  // 한국어 주소에 처음 들어온 사람만 영어 주소로 보낸다(랜딩-only). 쿠키 ko는 보내지 않는다.
  if (isLandingOnly() && (request.method === "GET" || request.method === "HEAD")) {
    const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
    const wantsEn =
      cookie === "en" ||
      (cookie !== "ko" && acceptLanguageLocale(request.headers.get("accept-language")) === "en");
    if (wantsEn) {
      const url = request.nextUrl.clone();
      url.pathname = localePath("en", base);
      const res = NextResponse.redirect(url, 302);
      res.headers.set("Vary", "Accept-Language, Cookie");
      return res;
    }
  }
  const res = NextResponse.next({ request: { headers } });
  if (isLandingOnly()) res.headers.set("Vary", "Accept-Language, Cookie");
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // 공개 주소의 서버 액션 POST는 아래 랜딩-only 경로(403)가 맡는다.
  const action = request.method === "POST" && request.headers.has("next-action");
  if (PUBLIC_PATH.test(stripEn(pathname)) && !(isLandingOnly() && action)) return publicLocale(request);
  if (!isLandingOnly()) return NextResponse.next();

  // 오류 제보 수신(§P513 결정 2)은 랜딩-only에서도 열린 유일한 `/api/**`다. fs를 읽지 않는 라우트다.
  // 90일 파기 크론(§P513 결정 7)의 purge도 열린다 - 라우트가 CRON_SECRET으로 스스로 막는다.
  if (pathname === "/api/error-report" || pathname === "/api/error-report/purge") return NextResponse.next();
  if (
    pathname === "/p" ||
    pathname.startsWith("/p/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    // 마켓도 레지스트리·마켓 저장소를 읽는 화면이라 §플래그의 fs 요건에 걸린다(§페르소나 마켓
    // §화면). `/p/**`와 같은 경계 — 서브경로가 없어 `startsWith` 없이 정확히 하나만 막는다.
    pathname === "/market"
  ) {
    return new NextResponse(null, { status: 404 });
  }
  if (request.method === "POST" && request.headers.has("next-action")) {
    return new NextResponse(null, { status: 403 });
  }
  return NextResponse.next();
}
