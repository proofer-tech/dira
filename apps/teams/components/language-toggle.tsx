"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/components/language-provider";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/** 공개 사이트 언어 토글(DESIGN.md §0-24 §토글) — 매뉴얼 셸의 `DarkToggle` 옆과 랜딩 헤더 둘 다에
 *  뜬다. 자리도 크기도 그 버튼과 같다(클래스 `appearance`를 그대로 쓴다 — `manual.css`엔 이미
 *  있고 `landing.css`엔 이 티켓이 옮겨 붙였다).
 *
 *  **풀 모드에서는 안 세운다** — 부르는 쪽(`shell.tsx`의 `isLandingOnly()`, `landing.tsx`의
 *  `fullMode`)이 렌더 자체를 건너뛴다. 그 모드의 정본은 설정 다이얼로그의 `언어`고, 두 입구가
 *  다른 값을 가리키면 어느 쪽이 정본인지 알 방법이 없다.
 *
 *  쿠키만 쓰고 `router.refresh()`로 그 자리에서 화면이 갈린다 — 주소도 재시작도 이동도
 *  요구하지 않는다. `settings-dialog.tsx`의 `LanguageSection`과 같은 배선이다(그쪽은 머신
 *  설정 파일을 쓰고 이쪽은 쿠키를 쓴다는 것만 다르다) — 서버가 `request-locale.ts`의
 *  `siteLocale()`로 이 쿠키를 읽어 새 `locale`을 루트 레이아웃에 내리면 `LanguageProvider`가
 *  그 값을 컨텍스트로 뿌린다. */
export function LanguageToggle() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === "ko" ? "en" : "ko";

  return (
    <button
      type="button"
      className="appearance"
      aria-label={t("settings.language.label")}
      disabled={pending}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000`;
        startTransition(() => router.refresh());
      }}
    >
      {t(next === "ko" ? "languageToggle.shortKo" : "languageToggle.shortEn")}
    </button>
  );
}
