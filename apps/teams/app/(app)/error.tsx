"use client";

/** `(app)` 그룹 전체의 error boundary(§데스크톱 앱 못박는 것 9 마지막 문단, 요구 `bdb1d13c`).
 *  클라이언트 예외 하나가 그대로 빈 화면이 되던 자리를 여기서 잡는다. `not-found.tsx`와 같은
 *  셋째 자리 원리 — 이 파일은 물려받은 `(app)/layout.tsx`의 `<html>`·`<body>` 안에서 그려지므로
 *  shadcn·Tailwind를 그대로 쓴다. §비주얼 §6 에러 3요소: 무엇이 실패했는지 - 원인 원문 -
 *  다음 행동. */
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8">
      <Alert variant="destructive" className="max-w-lg">
        <TriangleAlert aria-hidden />
        <AlertTitle>화면을 표시하지 못했습니다</AlertTitle>
        <AlertDescription>
          <span className="block font-mono text-xs break-all whitespace-pre-wrap">
            {error.message || error.digest || "원인 정보 없음"}
          </span>
        </AlertDescription>
      </Alert>
      <Button onClick={reset}>다시 시도</Button>
    </main>
  );
}
