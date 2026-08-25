"use client";

/** 사이드바 그룹 머리의 에픽 만들기 입구 + 다이얼로그 (DESIGN.md §에픽 결정 17 · §비주얼 §52 ⑩).
 *
 *  참조 구현은 `protocols-ui.tsx`의 `NewFileButton`이다 — 그릇 · 폼 · 거절 자리가 다 그대로다.
 *  갈리는 것은 칸이 하나(경로)에서 둘(제목 · 키)이 되는 것 하나뿐이다. 화면은 안 옮긴다
 *  (§안 하는 것) — 성공하면 다이얼로그만 닫고 목록은 서버 액션의 `revalidatePath`가 새로 그린다. */
import { useState, useTransition } from "react";
import { FilePlus2, TriangleAlert } from "lucide-react";
import { createEpic } from "@/app/(app)/p/[project]/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type Locale } from "@/lib/i18n";

/** §6 에러 3요소 중 1·2번 — `protocols-ui.tsx`의 `Failure`와 같은 값이다. */
function Failure({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="font-mono text-xs break-all">{message}</span>
      </AlertDescription>
    </Alert>
  );
}

export function EpicCreateButton({
  projectId,
  locale,
  suggestedKey,
}: {
  projectId: string;
  locale: Locale;
  /** `P<숫자>` 최댓값 + 1, 그 꼴이 하나도 없으면 빈 문자열(§에픽 결정 17 §키 제안) */
  suggestedKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [key, setKey] = useState(suggestedKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = t(locale, "board.epic.create");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // 열 때도 닫을 때도 초기화한다 — 여는 순간의 `suggestedKey`가 최신이라야
        // 이전 회차에서 만든 값 바로 다음 번호가 다시 뜬다(취소·ESC·바깥 클릭 다 이 길이다).
        setOpen(o);
        setTitle("");
        setKey(suggestedKey);
        setError(null);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto text-muted-foreground"
            title={label}
          />
        }
      >
        <FilePlus2 aria-hidden className="size-4" />
        <span className="sr-only">{label}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t(locale, "board.epic.createDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-epic-title">{t(locale, "board.epic.createTitleLabel")}</Label>
            <Input
              id="new-epic-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-epic-key">{t(locale, "board.epic.createKeyLabel")}</Label>
            <Input
              id="new-epic-key"
              className="font-mono"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          {error && <Failure title={t(locale, "board.epic.createFailed")} message={error} />}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t(locale, "common.cancel")}</DialogClose>
          <Button
            disabled={pending || !key.trim() || !title.trim()}
            onClick={() =>
              start(async () => {
                const r = await createEpic(projectId, key, title);
                if (r.ok) {
                  setOpen(false);
                  setTitle("");
                  setKey(suggestedKey);
                  setError(null);
                } else {
                  setError(r.error);
                }
              })
            }
          >
            {pending ? t(locale, "common.creating") : t(locale, "common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
