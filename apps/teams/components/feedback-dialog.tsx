"use client";

/** `의견 보내기` 다이얼로그 (DESIGN.md §0-12 §폼).
 *
 *  **칸 하나다** — `textarea` + 보내기. 이름·이메일·분류 select를 만들지 않는다(§0-12).
 *  보내기는 서버로 안 간다: `window.open`이 GitHub `새 이슈`를 제목·본문이 채워진 채 열고
 *  (데스크톱 셸에서는 `setWindowOpenHandler`가 `shell.openExternal`로 보낸다 — **새 IPC 0개**)
 *  마지막 `Submit`은 사람이 GitHub에서 누른다. 서버로 가는 것은 `feedback_submit` 하나고
 *  **거기에 의견 본문은 없다**(§0-11 익명 규칙).
 *
 *  **여는 신호는 하나다** — `apps/desktop/main.ts`의 `Help > 의견 보내기`가 지금 떠 있는 문서에
 *  던지는 `dira:feedback` 이벤트다(§0-12 · `252fd905`). 그래서 열림 상태가 여기 산다: 진입점이
 *  그 메뉴 **하나뿐**이라 밖에서 받을 `open` prop이 갈 곳이 없다. 늘어난 렌더러 노출은 0개다 —
 *  preload에 새 API가 없고 `ipcRenderer`도 `fs`도 안 넘어온다(§데스크톱 앱 못박는 것 4).
 *  브라우저(`pnpm dev`)에는 그 신호를 보내는 메뉴가 없어서 이 다이얼로그가 뜨지 않는다(§0-12).
 *
 *  **루트 레이아웃에 한 번 선다**(`app/layout.tsx`) — 화면 이동도 리로드도 없이 지금 보고 있는
 *  화면 위에 떠야 해서 자리가 거기다.
 *
 *  **새 파일인 이유**: 이 다이얼로그는 두 셸 어디서나 떠야 하고(메뉴는 화면을 안 가린다)
 *  기존 파일 어디에 얹어도 나머지 셸이 그 파일을 import한다 — `keymap-provider.tsx`와 같은 축. */
import { useEffect, useState } from "react";
import { feedbackMetaAction, trackEvent } from "@/app/actions";
import { issueUrl, type FeedbackMeta } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<FeedbackMeta | null>(null);

  // main이 던지는 단방향 신호 하나. `window` 이벤트라 그 위에 아무 통로도 안 만든다.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("dira:feedback", show);
    return () => window.removeEventListener("dira:feedback", show);
  }, []);

  // 열릴 때 한 번만 읽는다 — 두 값 다 이 앱 실행 동안 안 바뀐다(§0-11 세션 정의).
  // 다시 물으면 `session_id`의 30분 창만 밀린다.
  useEffect(() => {
    if (open && !meta) void feedbackMetaAction().then(setMeta);
  }, [open, meta]);

  // 상한을 넘겼는지는 **URL을 실제로 만들어야** 안다(제목·두 줄이 예산을 같이 먹는다).
  // 그리는 김에 만들어 두고 보내기는 이 값을 그대로 연다 — 두 번 조립하지 않는다.
  const built = meta && text.trim() ? issueUrl(text, meta) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>의견 보내기</DialogTitle>
          <DialogDescription>
            GitHub 이슈로 열립니다. 내용이 채워진 채 열리고 마지막 등록은 직접 누르시면 됩니다.
          </DialogDescription>
        </DialogHeader>

        {/* `min-w-0` — 답변 다이얼로그와 같은 결함이다(§비주얼 §3 간격 관용구 · §로드맵 §P167).
            `DialogContent`가 `grid`라 아이템의 `min-width: auto`가 min-content로 굳고, 아래
            `<Textarea>`는 `field-sizing-content`라 안 쪼개지는 긴 토큰 한 줄이 그대로 그 값이
            된다(실측: 100자 토큰에서 그릇 544 → 707.2 · 팝업 576에 가로 스크롤바) */}
        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!built) return;
            // 사람의 클릭 안에서 연다 — 액션을 await한 뒤에 열면 브라우저 팝업 차단에 걸린다
            window.open(built.url, "_blank", "noopener");
            // 화면에서 GA로 나가는 길은 `trackEvent` 하나다(§0-11). **본문은 안 넘긴다** —
            // 자유 입력은 GA로 안 간다(익명 규칙). 기다리지 않는다: 통계 한 건이 폼을 못 막는다
            void trackEvent("feedback_submit", {});
            setText("");
            setOpen(false);
          }}
        >
          {/* **천장을 건다**(`field-sizing-content`라 본문만큼 자란다). 없으면 긴 의견에서
              상자가 다이얼로그를 넘겨 밀고 **잘림 경고가 화면 밖으로 나간다** — 자른 사실을
              말하기로 한 자리가 정작 긴 글에서만 안 보인다(실측 3,000자, 900 높이) */}
          <Textarea
            className="max-h-64"
            aria-label="의견"
            placeholder={"무엇이 불편했는지, 무엇이 필요한지 그냥 쓰세요.\n첫 줄이 이슈 제목이 됩니다."}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {/* 무엇이 같이 나가는지 모르고 누르는 자리를 만들지 않는다(§0-12) — 이슈 본문에
              들어갈 두 줄 **그대로**다. 아직 안 왔으면 자리만 비어 있고 보내기도 잠겨 있다 */}
          <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            <p>이슈에 아래 두 줄이 함께 실립니다.</p>
            <p className="font-mono break-all">- 버전: {meta?.version ?? "…"}</p>
            <p className="font-mono break-all">- 세션: {meta?.session ?? "…"}</p>
          </div>

          {/* 자른 사실을 폼이 말한다(§0-12 URL 길이). 자르고 나서가 아니라 **누르기 전**이다 */}
          {built?.truncated && (
            <p className="text-xs text-destructive">
              내용이 길어 뒷부분은 이슈에 실리지 않습니다. URL로 보내는 방식의 한계입니다 — 나눠
              보내시거나, 열린 이슈에 나머지를 붙여 넣으신 뒤 등록하세요.
            </p>
          )}

          {/* CTA는 행의 오른쪽 끝이다(§비주얼 §4-3 — `DialogFooter`가 이미 `sm:justify-end`).
              빈 채로는 못 보낸다: 빈 이슈가 열리는 것이 이 폼의 유일한 오작동이다(§0-12) */}
          <DialogFooter>
            <Button type="submit" disabled={!built}>
              GitHub 이슈로 보내기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
