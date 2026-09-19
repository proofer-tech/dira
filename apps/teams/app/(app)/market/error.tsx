"use client";

/** `/market`의 error boundary(§비주얼 §79 ⑥). `(app)/error.tsx`(§데스크톱 앱 고정하는 것 9)보다
 *  더 안쪽 경계라 이 화면의 예외는 여기서 먼저 잡힌다. §6 에러 3요소에 `<CopyCommand>` 하나를
 *  더한다 — 마켓 저장소는 GUI가 고쳐 쓰려 들지 않는 파일 뭉치라(§페르소나 마켓 §안 하는 것
 *  §되돌리기를 안 만든다) 사람이 직접 열어 보는 명령을 준다. */
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyCommand } from "@/components/copy-command";
import { useT } from "@/components/language-provider";

export default function MarketError({
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
        <AlertTitle>{t("market.error.title")}</AlertTitle>
        <AlertDescription className="grid gap-2">
          <span className="block font-mono text-xs break-all whitespace-pre-wrap">
            {error.message || error.digest || t("errorBoundary.noReason")}
          </span>
          <CopyCommand cmd="ls -la ~/.config/dira/market" />
        </AlertDescription>
      </Alert>
      <Button onClick={reset}>{t("errorBoundary.retry")}</Button>
    </main>
  );
}
