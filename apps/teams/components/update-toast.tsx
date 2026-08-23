"use client";

/** 업데이트 토스트 (DESIGN.md §릴리스 - 자동 업데이트 §표면이 창 안으로 들어온다 T1~T7 - §비주얼 §55).
 *
 *  main(`c9461f38`)이 판정한 것을 그대로 그린다 - **무엇을 언제 뜨는지는 여기서 안 정한다.**
 *  main -> 렌더러는 `window` 이벤트 `dira:update`(`event.detail`이 progress/downloaded/message/
 *  confirm 넷 중 하나), 렌더러 -> main은 `window.dira.updateAction(action)`이다(T7).
 *
 *  **브라우저에서는 아무것도 안 그린다** - `window.dira`가 없으면 `null`이다(N3와 같은 판정,
 *  `path-picker.tsx`의 `useIsDesktop`). `<FeedbackDialog>`-`<DesktopFindBar>`가 여는 `dira:feedback`-
 *  `dira:find` 관용구 그대로다.
 *
 *  **사라지지 않는 상자는 상태가 이 컴포넌트에 산다**(①②⑤). `toast.custom`이 매번 새 엘리먼트를
 *  받으므로 상자 안의 상태(노트 펼침 - 노트 본문)를 토스트 쪽에 두지 않는다 - 여기 `useState`가
 *  바뀔 때마다 같은 `id`로 다시 그린다(§55 판정 3). ③④(메시지)만 독립된 `id`로 뜬다 - 사람이
 *  손으로 누른 U1의 응답이라 ①이 떠 있는 동안에도 와야 한다(T2). */

import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/language-provider";
import { useIsDesktop } from "@/components/path-picker";

type UpdateDetail =
  | { kind: "progress"; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "message"; text: string }
  | { kind: "confirm" };

/** 사라지지 않는 상자 하나 - 고정 `id`(§55 판정 3). ①->②->①로 갈아 끼워지고 ⑤는 ①과 같은 id다. */
const STICKY_ID = "dira-update";

/** (11) 포커스 - 가상클래스라 인라인 `style`로 못 쓴다(§55 §배선). `[data-sonner-toaster]`를
 *  앞에 붙여 sonner 자기 규칙보다 한 계단 높은 특정도를 얻는다 - 같은 특정도면 나중에 붙는
 *  sonner의 `<style>`이 이긴다(§55 §배선 실측, `find-bar.tsx`의 같은 함정). 그림자는 sonner
 *  기본값을 그 규칙 안에서 다시 적는다 - 안 그러면 포커스 때 사라진다. */
const FOCUS_CSS = `
[data-sonner-toaster] [data-sonner-toast]:focus-visible {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  outline: 3px solid color-mix(in oklab, var(--ring) 50%, transparent);
  outline-offset: 0;
}
`;

/** 다 받았습니다(①) - 진행률(②) - 재확인(⑤) 셋의 몸통. `notes`는 `undefined`(아직 안 왔다) -
 *  `null`(compare 실패, 노트 없음) - `string`(왔다) 셋을 진다. */
function StickyBody({
  t,
  view,
  percent,
  notes,
  notesOpen,
  onToggleNotes,
  onLater,
  onRestart,
  onCancel,
}: {
  t: (key: string) => string;
  view: "progress" | "downloaded" | "confirm";
  percent: number;
  notes: string | null | undefined;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onLater: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) {
  if (view === "progress") {
    return (
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm font-medium">
          {t("updateToast.progress.prefix")} {percent}%
        </p>
        {/* §26 게이지 관용구 그대로 - 전이 0(§55 §진행률 상자 근거 셋) */}
        <div className="h-2 w-full rounded-full bg-muted">
          <div className="h-2 rounded-full bg-muted-foreground" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  if (view === "confirm") {
    return (
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm font-medium">{t("updateToast.confirm.message")}</p>
        <div className="mt-1.5 flex items-center gap-2 text-popover-foreground">
          <Button variant="outline" size="xs" className="ml-auto" onClick={onCancel}>
            {t("updateToast.confirm.cancel")}
          </Button>
          <Button variant="default" size="xs" onClick={onRestart}>
            {t("updateToast.confirm.restart")}
          </Button>
        </div>
      </div>
    );
  }

  // view === "downloaded" - 노트가 아예 없는 경로(`notes === null`)에서는 손잡이가 안 선다.
  const showNotesButton = notes !== null;
  const notesLoading = notesOpen && notes === undefined;
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm font-medium">{t("updateToast.downloaded.title")}</p>
      {notesOpen && typeof notes === "string" && (
        <div className="max-h-48 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground">
          {notes}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-popover-foreground">
        {showNotesButton && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={notesOpen}
            disabled={notesLoading}
            onClick={onToggleNotes}
          >
            {t("updateToast.downloaded.notesToggle")}
            {notesOpen ? (
              <ChevronDown aria-hidden className="size-3" />
            ) : (
              <ChevronRight aria-hidden className="size-3" />
            )}
          </Button>
        )}
        <Button variant="outline" size="xs" className="ml-auto" onClick={onLater}>
          {t("updateToast.downloaded.later")}
        </Button>
        <Button variant="default" size="xs" onClick={onRestart}>
          {t("updateToast.downloaded.restartNow")}
        </Button>
      </div>
    </div>
  );
}

export function UpdateToast() {
  const t = useT();
  // N3와 같은 판정(`path-picker.tsx`) - 서버 스냅숏은 항상 `false`라 SSR에서 `window`를 안 만진다.
  const desktop = useIsDesktop();
  const [view, setView] = useState<"progress" | "downloaded" | "confirm" | null>(null);
  const [percent, setPercent] = useState(0);
  const [notes, setNotes] = useState<string | null | undefined>(undefined);
  const [notesOpen, setNotesOpen] = useState(false);

  /** 다운로드가 끝난 사실을 받는 자리 하나 - 이어붙임(T1)과 `downloaded` 이벤트가 같이 쓴다.
   *  노트는 클릭을 안 기다리고 바로 물어본다 - main의 promise는 이미 그 시점에 돌고 있다(T6). */
  function beginDownloaded() {
    setNotesOpen(false);
    setNotes(undefined);
    setView("downloaded");
    void window.dira?.updateAction("notes").then(setNotes);
  }

  // T1 이어붙임 - 마운트할 때 main에게 상태를 한 번 물어본다. 알림을 눌러 열렸든 트레이
  // `열기`로 열렸든 경로를 안 가린다.
  useEffect(() => {
    if (!window.dira) return;
    void window.dira.updateAction("state").then((s) => {
      if (s) beginDownloaded();
    });
  }, []);

  useEffect(() => {
    if (!window.dira) return;
    const onUpdate = (e: Event) => {
      const { detail } = e as CustomEvent<UpdateDetail>;
      switch (detail.kind) {
        case "progress":
          setPercent(detail.percent);
          setView("progress");
          break;
        case "downloaded":
          beginDownloaded();
          break;
        case "message":
          toast(detail.text);
          break;
        case "confirm":
          setView("confirm");
          break;
      }
    };
    window.addEventListener("dira:update", onUpdate);
    return () => window.removeEventListener("dira:update", onUpdate);
  }, []);

  // 사라지지 않는 상자 - `view`가 바뀔 때마다 같은 `id`로 다시 그린다(§55 판정 3).
  useEffect(() => {
    if (!view) {
      toast.dismiss(STICKY_ID);
      return;
    }
    toast.custom(
      () => (
        // sonner가 `toast.custom` 상자에 `data-styled="false"`를 달아 §55 (5)(6)의 몸(면 - 변 -
        // 라운드 - 그림자 - padding)이 안 걸린다(§55 §배선 함정 셋째) - 그 몸을 이 엘리먼트가 진다.
        <div className="w-full rounded-lg border border-border bg-popover p-4 shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
          <StickyBody
            t={t}
            view={view}
            percent={percent}
            notes={notes}
            notesOpen={notesOpen}
            onToggleNotes={() => setNotesOpen((v) => !v)}
            onLater={() => {
              setView(null);
              void window.dira?.updateAction("later");
            }}
            onRestart={() => void window.dira?.updateAction("restart")}
            onCancel={() => {
              void window.dira?.updateAction("later");
              beginDownloaded(); // ⑤ 취소는 ①로 되돌아간다 - 되돌릴 상태가 0이다(§55)
            }}
          />
        </div>
      ),
      { id: STICKY_ID, duration: Infinity },
    );
  }, [view, percent, notes, notesOpen, t]);

  if (!desktop) return null;

  return (
    <>
      <style href="dira-update" precedence="default">
        {FOCUS_CSS}
      </style>
      <Toaster
        theme="system"
        expand
        offset={{ bottom: "52px", right: "24px" }}
        mobileOffset={{ bottom: "52px" }}
        containerAriaLabel={t("shell.update.ariaLabel")}
        toastOptions={{
          style: {
            "--normal-bg": "var(--popover)",
            "--normal-border": "var(--border)",
            "--normal-text": "var(--popover-foreground)",
            "--border-radius": "var(--radius)",
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            transition:
              "transform 200ms var(--ease-out), opacity 200ms var(--ease-out), height 200ms var(--ease-out)",
          } as React.CSSProperties,
        }}
      />
    </>
  );
}
