"use client";

/** 제약 4가 요구하는 것 — GUI가 실행하지 않고 사람이 실행할 명령어를 복사시킨다
 *  (DESIGN.md §5 커스텀 5개). crontab 등록·안내 명령이 전부 이 모양으로 나온다. */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <code className="grow font-mono text-xs break-all">{cmd}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="명령어 복사"
        onClick={async () => {
          await navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}
