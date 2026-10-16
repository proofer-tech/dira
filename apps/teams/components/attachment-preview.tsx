"use client";

/** 첨부 미리보기 — 사람이 다시 읽는 면 넷(DESIGN.md §8 §개정 · §비주얼 §27 §개정).
 *
 *  fs 0 — `lib/attachment-format.ts`의 순수 문자열 함수만 쓰므로 서버 컴포넌트(티켓 상세)와
 *  `"use client"` 파일(세션 스트림 · 홈) 어디서든 import된다. 상태는 그림 갈래의 다이얼로그
 *  열림 하나(`AttachmentImage`)뿐이고, 서버-클라이언트 경계가 이 파일에 있다(P507).
 *
 *  자리는 그 문단이 있던 자리 그대로다 - 본문 아래 한 칸(`mt-3`), 여러 장이면 칩 줄과 같은
 *  `flex flex-wrap gap-2`다. 그림은 누르면 원본 크기 다이얼로그(P507, §27의 "라이트박스 0"을
 *  뒤집은 요구), 칩(`svg` 포함)은 새 탭이다. 갤러리 0 - 확대 손잡이 0 - 모션 0. */
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/components/language-provider";
import { attachmentDisplayName, isImageAttachment } from "@/lib/attachment-format";

/** 그림 갈래 - 축소판 버튼과 원본 크기 다이얼로그. `img`에 크기 제한 클래스가 없다(`max-w-none`, 고유 1:1). */
function AttachmentImage({ href, name }: { href: string; name: string }) {
  const t = useT();
  return (
    <Dialog>
      <DialogTrigger
        render={<button type="button" className="cursor-zoom-in" aria-label={`${t("attachment.openPreview")}: ${name}`} />}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 최적화할 원본이 큐 안의 파일이다(§27 §개정) */}
        <img src={href} alt={name} className="max-h-48 w-auto rounded-md border" />
      </DialogTrigger>
      <DialogContent className="max-h-[95vh] w-auto max-w-[95vw] gap-0 overflow-auto p-0 sm:max-w-[95vw]">
        <DialogHeader className="flex-row items-center gap-3 p-3 pr-12">
          <DialogTitle className="truncate">{name}</DialogTitle>
          <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-xs underline">
            {t("attachment.openInNewTab")}
          </a>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element -- 위와 같다 */}
        <img src={href} alt={name} className="mx-auto max-w-none" />
      </DialogContent>
    </Dialog>
  );
}

export function AttachmentPreview({ project, paths }: { project: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {paths.map((p) => {
        const name = attachmentDisplayName(p);
        const href = `/api/attachment?project=${encodeURIComponent(project)}&path=${encodeURIComponent(p)}`;
        return isImageAttachment(name) ? (
          <AttachmentImage key={p} href={href} name={name} />
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
