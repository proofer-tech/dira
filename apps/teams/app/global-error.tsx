"use client";

/** 루트 레이아웃 자체가 죽었을 때의 최후 방어선(§데스크톱 앱 고정하는 것 9 마지막 문단,
 *  요구 `bdb1d13c`) — `(app)`·`(site)` 어느 레이아웃도 못 뜬 상태라 이 파일이 직접
 *  `<html>`·`<body>`를 낸다(`app/not-found.tsx`와 같은 자리, 같은 이유로 Tailwind 없음).
 *  §비주얼 §6 에러 3요소를 지킨다. */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko-KR">
      <body>
        <main>
          <h1>화면을 표시하지 못했습니다</h1>
          <pre>{error.message || error.digest || "원인 정보 없음"}</pre>
          <button onClick={reset}>다시 시도</button>
        </main>
      </body>
    </html>
  );
}
