"use client";

/** `(app)` 그룹 전체의 error boundary(§데스크톱 앱 고정하는 것 9 마지막 문단, 요구 `bdb1d13c`).
 *  클라이언트 예외 하나가 그대로 빈 화면이 되던 자리를 여기서 잡는다. `not-found.tsx`와 같은
 *  셋째 자리 원리 — 이 파일은 물려받은 `(app)/layout.tsx`의 `<html>`·`<body>` 안에서 그려지므로
 *  shadcn·Tailwind를 그대로 쓴다. §비주얼 §6 에러 3요소: 무엇이 실패했는지 - 원인 원문 -
 *  다음 행동. */
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useT } from "@/components/language-provider";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8">
      <Alert variant="destructive" className="max-w-lg">
        <TriangleAlert aria-hidden />
        <AlertTitle>{t("errorBoundary.title")}</AlertTitle>
        <AlertDescription>
          <span className="block font-mono text-xs break-all whitespace-pre-wrap">
            {error.message || error.digest || t("errorBoundary.noReason")}
          </span>
        </AlertDescription>
      </Alert>
      <Button onClick={reset}>{t("errorBoundary.retry")}</Button>
    </main>
  );
}
