"use client";

/** 언어를 서버에서 클라이언트로 나르는 통로 (DESIGN.md §0-16 §장치).
 *
 *  `keymap-provider.tsx`와 같은 모양이다 — 언어도 **파일**이고 화면을 그리는 것은 클라이언트
 *  컴포넌트다. 루트 레이아웃이 `readLanguage()`를 한 번 읽어 여기로 내리고, 아래는
 *  `useContext`로 꺼내 쓴다. */

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** 화면이 문구를 그릴 때 쓰는 자리. `t(locale, key)`를 매번 반복하지 않는다. */
export function useT(): (key: string) => string {
  const locale = useLocale();
  return (key: string) => t(locale, key);
}
