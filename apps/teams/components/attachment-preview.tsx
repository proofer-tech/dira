/** 첨부 미리보기 — 사람이 다시 읽는 면 넷(DESIGN.md §8 §개정 · §비주얼 §27 §개정).
 *
 *  순수 렌더 함수다(fs 0 · 상태 0) — `lib/attachment-format.ts`의 순수 문자열 함수만 쓰므로
 *  세션 스트림 · 홈처럼 `"use client"` 파일 안에서도 안전하게 import된다.
 *
 *  자리는 그 문단이 있던 자리 그대로다 - 본문 아래 한 칸(`mt-3`), 여러 장이면 칩 줄과 같은
 *  `flex flex-wrap gap-2`다. 라이트박스 0 - 갤러리 0 - 모션 0(§27 머리가 칩에 대해 정한 값과
 *  같다) - 큰 그림을 보는 수단은 새 탭이고 그건 브라우저가 이미 가진 기능이다. */
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { attachmentDisplayName, isImageAttachment } from "@/lib/attachment-format";

export function AttachmentPreview({ project, paths }: { project: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {paths.map((p) => {
        const name = attachmentDisplayName(p);
        const href = `/api/attachment?project=${encodeURIComponent(project)}&path=${encodeURIComponent(p)}`;
        return isImageAttachment(name) ? (
          <a key={p} href={href} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- 최적화할 원본이 큐 안의 파일이다(§27 §개정) */}
            <img src={href} alt={name} className="max-h-48 w-auto rounded-md border" />
          </a>
        ) : (
          <a key={p} href={href} target="_blank" rel="noreferrer">
            <Badge variant="secondary">
              <Paperclip aria-hidden />
              {name}
            </Badge>
          </a>
        );
      })}
    </div>
  );
}
