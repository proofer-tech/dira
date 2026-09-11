"use client";

/** §0-25 결정 7-8 - 오류를 먼저 그리고 그 카드 위에서 A/S가 도는 한 벌. 오류를 그리는 11곳
 *  (결정 1)이 함께 쓰는 계약이라 이 파일 하나가 그 지점이다 - `948145ab`가 소스 컨트롤 pull
 *  하나에 먼저 붙이고, 나머지 열 자리는 `31c9f7c4`가 이 파일을 그대로 가져다 쓴다(시그니처를
 *  안 고친다).
 *
 *  A/S를 부르는 서버 액션(`runSelfHeal`)은 `app/(app)/p/[project]/actions.ts`다 - 결정 8이 말하는
 *  "A/S가 자기 서버 액션 하나가 된다"의 그 액션. */
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { runSelfHeal } from "@/app/(app)/p/[project]/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** 오류 카드(결정 7) - `Alert variant="destructive"` 그대로이고, A/S가 도는 동안 진행 한 줄이
 *  덧붙는다(갈아 끼우지 않는다). `fixingText`가 무엇을 고치는 중인지 가리킨다 - `고치는 중`만
 *  적은 문구를 안 쓴다. */
export function SelfHealAlert({
  title,
  error,
  fixing,
  fixingText,
}: {
  title: string;
  error: string;
  fixing: boolean;
  fixingText: string;
}) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="block font-mono text-xs break-all whitespace-pre-wrap">{error}</span>
        {fixing && <span className="block text-xs">{fixingText}</span>}
      </AlertDescription>
    </Alert>
  );
}

/** 결정 8의 순서 - 실패하면 그 사유를 즉시 쥐고(카드가 뜬다), `runSelfHeal`을 부르는 동안
 *  `fixing`이 참이다가, `ticketed`가 아니면 원래 조작을 한 번 더 부른다. 시도는 그대로 한
 *  번이다(결정 5) - 이 훅이 재시도 곡선을 돌리지 않는다. */
export function useSelfHealRetry() {
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);

  async function run<T>(
    attempt: () => Promise<T>,
    errorOf: (result: T) => string | null,
    ctx: { projectId: string; surface: string; checkoutId?: string },
  ): Promise<T> {
    const first = await attempt();
    const firstError = errorOf(first);
    if (!firstError) {
      setError(null);
      return first;
    }
    setError(firstError);
    setFixing(true);
    const outcome = await runSelfHeal(ctx.projectId, firstError, ctx.surface, ctx.checkoutId);
    setFixing(false);
    if (outcome === "ticketed") return first;

    const second = await attempt();
    setError(errorOf(second));
    return second;
  }

  return { error, fixing, setError, run };
}
