"use client";

import { useLocale, useT } from "@/components/language-provider";
import { LOCALE_COOKIE, localePath, stripEn, type Locale } from "@/lib/i18n";

/** 공개 사이트 언어 토글(DESIGN.md §0-24 §토글) — 매뉴얼 셸의 `DarkToggle` 옆과 랜딩 헤더 둘 다에
 *  뜬다. 자리도 크기도 그 버튼과 같다(클래스 `appearance`를 그대로 쓴다 — `manual.css`엔 이미
 *  있고 `landing.css`엔 이 티켓이 옮겨 붙였다).
 *
 *  **풀 모드에서는 안 세운다** — 부르는 쪽(`shell.tsx`의 `isLandingOnly()`, `landing.tsx`의
 *  `fullMode`)이 렌더 자체를 건너뛴다. 그 모드의 정본은 설정 다이얼로그의 `언어`고, 두 입구가
 *  다른 값을 가리키면 어느 쪽이 정본인지 알 방법이 없다.
 *
 *  쿠키를 쓰고 같은 경로의 다른 언어 주소(`/en` 접두)로 이동한다(P548). */
export function LanguageToggle() {
  const locale = useLocale();
  const t = useT();
  const next: Locale = locale === "ko" ? "en" : "ko";

  return (
    <button
      type="button"
      className="appearance"
      aria-label={t("settings.language.label")}
      onClick={() => {
        // P548 결정 2 - 언어는 주소가 정본이다. 쿠키를 쓰고(다음 방문의 /en 리다이렉트 판정) 같은
        // 경로의 다른 언어 주소로 이동한다.
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000`;
        const { pathname, search, hash } = window.location;
        window.location.assign(localePath(next, stripEn(pathname)) + search + hash);
      }}
    >
      {t(next === "ko" ? "languageToggle.shortKo" : "languageToggle.shortEn")}
    </button>
  );
}
