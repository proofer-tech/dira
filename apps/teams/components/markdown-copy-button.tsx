/** P443 §계약 1-5. `CopyAnswer`(home-ui.tsx)·`CopyCommand`의 관용구 그대로 — 아이콘만
 *  1.5초 `Check`, 토스트 없음. 래퍼(`group/codeblock`)가 `overflow-x-auto` 밖이라 가로
 *  스크롤을 끝까지 밀어도 버튼은 블록 오른쪽 위에 머문다.
 *
 *  `<Markdown>`(`components/markdown.tsx`)은 서버 컴포넌트 트리(티켓 상세 - 에픽)에서도
 *  쓰이므로 그 파일 자체는 `"use client"`가 아니다(선례 `queue-ref.tsx`) — `useState`·`useT`를
 *  쓰는 이 리프만 클라이언트 컴포넌트로 뗀다. 티켓 52b8cdc0: 이 훅들이 `markdown.tsx`에
 *  그대로 있으면 서버 컴포넌트로 잘못 실행돼 화면이 500으로 죽는다. */
"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/language-provider";

export function CodeBlockCopyButton({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("markdown.copyCode.ariaLabel")}
      className="absolute right-2 top-2 opacity-0 group-hover/codeblock:opacity-100 group-focus-within/codeblock:opacity-100"
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}
