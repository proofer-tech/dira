"use client";

/** `(site)` 그룹(랜딩·매뉴얼·`/privacy`·`/terms`)의 error boundary. `(site)/not-found.tsx`와 같은
 *  이유로 shadcn·Tailwind를 안 쓴다 — 이 그룹은 `globals.css`를 레이아웃에서 물지 않고 각 페이지가
 *  `landing.css`·`manual.css`를 따로 무는 구조라, 여기서 그 클래스를 쓰면 어느 페이지에서
 *  터졌는지에 따라 스타일이 있거나 없거나 갈린다. §비주얼 §6 에러 3요소는 그대로 지킨다. */
import { useEffect } from "react";

export default function Error({
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
    <main>
      <h1>화면을 표시하지 못했습니다</h1>
      <pre>{error.message || error.digest || "원인 정보 없음"}</pre>
      <button onClick={reset}>다시 시도</button>
    </main>
  );
}
