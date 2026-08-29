"use client";

/** 루트 레이아웃 자체가 죽었을 때의 최후 방어선(§데스크톱 앱 고정하는 것 9 마지막 문단,
 *  요구 `bdb1d13c`) — `(app)`·`(site)` 어느 레이아웃도 못 뜬 상태라 이 파일이 직접
 *  `<html>`·`<body>`를 낸다(`app/not-found.tsx`와 같은 자리, 같은 이유로 Tailwind 없음).
 *  §비주얼 §6 에러 3요소를 지킨다. */
import { useEffect } from "react";
import { useT } from "@/components/language-provider";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // `LanguageProvider`가 위에 없다 — 루트 레이아웃 자체가 죽은 자리라서다(파일 머리 주석).
  // `useLocale()`의 `createContext` 기본값이 이미 `DEFAULT_LOCALE`이라 `ko`로 떨어진다.
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko-KR">
      <body>
        <main>
          <h1>{t("errorBoundary.title")}</h1>
          <pre>{error.message || error.digest || t("errorBoundary.noReason")}</pre>
          <button onClick={reset}>{t("errorBoundary.retry")}</button>
        </main>
      </body>
    </html>
  );
}
