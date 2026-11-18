"use client";

/** 홈 브라우저 미러 위에 얹는 제어권 표시 - ego-browser(ego lite)의 task space 화면을 따른다.
 *  (1) 에이전트가 쥔 동안: 가장자리 파란 빛과 점무늬, 화면 위 옅은 막, 마지막 동작 자리의 커서와 라벨
 *  (2) 아래 가운데 알약: 누가 쥐었는지와 `직접 하기`-`중지`(에이전트) 또는 `다 했어요`-`돌려주기`(사람)
 *  제어권 자체는 슬롯의 `handoff` 파일 하나가 정본이다(`templates/hooks/browse.sh` §핸드오프) -
 *  이 파일은 그 상태를 그리고 버튼을 서버 액션으로 잇기만 한다. */
import { useState } from "react";
import { GripVertical, Hand, Loader2, MousePointer2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/components/language-provider";
import { handBackBrowserAction, takeOverBrowserAction } from "@/app/(app)/p/[project]/home/actions";
import { unassignTicket } from "@/app/(app)/p/[project]/tickets/[hash]/actions";
import type { BrowserHandoff } from "@/lib/browser-pool";
import type { AgentCursor } from "@/lib/cdp-relay";

/** 미러가 그리는 제어권 상태 - `handoff` 파일과 슬롯 주인에서 한 번에 고른다. */
export type ControlMode = "none" | "agent" | "handedToUser" | "userTookOver" | "returned";

export function controlMode(opts: { isLinkSlot: boolean; hasOwner: boolean; handoff: BrowserHandoff | null }): ControlMode {
  if (opts.isLinkSlot) return "none"; // 링크 슬롯은 사람 자신의 브라우저다
  if (opts.handoff?.state === "returned") return "returned";
  if (opts.handoff?.state === "pending") return opts.handoff.by === "user" ? "userTookOver" : "handedToUser";
  return opts.hasOwner ? "agent" : "none";
}

/** 프레임 `<img>`의 그려진 크기와 원본 크기 - `onLoad`가 잰 값(렌더 중에 ref를 안 읽는다). */
export type FrameSize = { W: number; H: number; nw: number; nh: number };

export function measureFrame(img: HTMLImageElement): FrameSize {
  return { W: img.clientWidth, H: img.clientHeight, nw: img.naturalWidth, nh: img.naturalHeight };
}

/** `object-contain`으로 그려진 프레임의 내용 사각형(컨테이너 기준 CSS px). */
export function contentBox(f: FrameSize | null) {
  if (!f || !f.nw || !f.nh || !f.W || !f.H) return null;
  const scale = Math.min(f.W / f.nw, f.H / f.nh);
  const w = f.nw * scale;
  const h = f.nh * scale;
  return { left: (f.W - w) / 2, top: (f.H - h) / 2, w, h };
}

/** 가장자리 빛 - ego-browser와 같은 두 단계. 에이전트가 쥔 동안은 두꺼운 파란 빛, 점무늬, 화면 위
 *  옅은 막(사람이 만지지 말라는 신호). 사람이 쥔 동안은 막과 점무늬가 걷히고 가장자리 얇은 파란 선만 남는다. */
export function ControlGlow({ mode, frame }: { mode: ControlMode; frame: FrameSize | null }) {
  if (mode === "none") return null;
  const agent = mode === "agent" || mode === "returned";
  // 프레임 내용 사각형에만 얹는다 - `object-contain`의 위아래-좌우 여백까지 덮으면 띠가 어둡게 뜬다.
  const box = contentBox(frame);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={box ? { left: box.left, top: box.top, width: box.w, height: box.h, right: "auto", bottom: "auto" } : undefined}
    >
      {agent && <div className="absolute inset-0 bg-white/35 dark:bg-black/30" />}
      <div
        className={agent ? "absolute inset-0 motion-safe:animate-pulse" : "absolute inset-0"}
        style={{
          boxShadow: agent
            ? "inset 0 0 80px 22px rgba(59,130,246,0.55), inset 0 0 0 2px rgba(59,130,246,0.55)"
            : "inset 0 0 10px 3px rgba(59,130,246,0.45), inset 0 0 0 1px rgba(59,130,246,0.5)",
        }}
      />
      {agent && (
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: "radial-gradient(rgba(59,130,246,0.9) 1px, transparent 1.2px)",
            backgroundSize: "6px 6px",
            maskImage: "radial-gradient(ellipse at center, transparent 60%, black 100%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, transparent 60%, black 100%)",
          }}
        />
      )}
    </div>
  );
}

/** 에이전트 커서 - 마지막 동작 자리에 화살표와 라벨 말풍선. 자리가 바뀌면 미끄러져 옮겨 간다. */
export function AgentCursorMark({ cursor, frame }: { cursor: AgentCursor | null; frame: FrameSize | null }) {
  const box = contentBox(frame);
  if (!cursor || !box || cursor.x === null || cursor.y === null || !cursor.vw || !cursor.vh) return null;
  const left = box.left + (cursor.x / cursor.vw) * box.w;
  const top = box.top + (cursor.y / cursor.vh) * box.h;
  // 아래 알약(하단 약 80px)과 겹치지 않게, 화면 아래쪽에서는 말풍선을 커서 위로 올린다.
  const labelAbove = top > box.top + box.h - 110;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 transition-[left,top] duration-300 ease-out motion-reduce:transition-none"
      style={{ left, top }}
    >
      <MousePointer2 className="size-5 -translate-x-[3px] -translate-y-[2px] fill-black stroke-white drop-shadow" strokeWidth={1.5} />
      {cursor.label && (
        <span className={`absolute left-4 ${labelAbove ? "bottom-5" : "top-4"} whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-900 shadow-lg ring-1 ring-black/5`}>
          {cursor.label}
        </span>
      )}
    </div>
  );
}

/** 아래 가운데 알약 - 누가 쥐었는지와 지금 할 수 있는 일. */
export function ControlPill({
  mode,
  title,
  busy,
  cursorLabel,
  reason,
  projectId,
  hash,
  canStop,
  onTookOver,
  onHandedBack,
}: {
  mode: ControlMode;
  title: string;
  busy: boolean;
  cursorLabel: string | null;
  reason: string;
  projectId: string;
  hash: string;
  /** 티켓을 도는 워커 세션일 때만 `중지`가 선다(홈 대화-외부 호출은 끊을 세션 표식이 없다). */
  canStop: boolean;
  onTookOver: () => void;
  onHandedBack: () => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  if (mode === "none") return null;

  const takeOver = () => {
    setPending(true);
    void takeOverBrowserAction(hash, t("browser.control.takeOverReason")).then((ok) => {
      setPending(false);
      if (ok) onTookOver();
      else toast.error(t("browser.handoff.failed"));
    });
  };
  const handBack = () => {
    setPending(true);
    void handBackBrowserAction(hash).then((ok) => {
      setPending(false);
      if (ok) onHandedBack();
      else toast.error(t("browser.handoff.failed"));
    });
  };
  const stop = () => {
    setPending(true);
    void unassignTicket(projectId, hash, true).then((run) => {
      setPending(false);
      setConfirmStop(false);
      if (run.ok) toast.success(t("browser.control.stopped"));
      else toast.error(run.output || t("browser.handoff.failed"));
    });
  };

  const userHolds = mode === "handedToUser" || mode === "userTookOver";
  const status =
    mode === "agent"
      ? cursorLabel
        ? `${t("browser.control.agent")} - ${cursorLabel}`
        : t("browser.control.agent")
      : mode === "handedToUser"
        ? `${t("browser.control.userInControl")}${reason ? ` - ${reason}` : ""}`
        : mode === "userTookOver"
          ? t("browser.control.userInControl")
          : t("browser.handoff.returned");

  return (
    <>
      <div
        role="status"
        className={`absolute bottom-4 left-1/2 z-20 flex max-w-[min(640px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl py-2 pl-2 pr-2 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur ${
          userHolds ? "bg-neutral-600/85" : "bg-neutral-900/90"
        }`}
      >
        <GripVertical aria-hidden className="size-4 shrink-0 text-white/40" />
        <span className="shrink-0">
          {busy ? (
            <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          ) : userHolds ? (
            <Hand aria-hidden className="size-5" />
          ) : (
            <MousePointer2 aria-hidden className="size-5" />
          )}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs font-medium text-sky-400">{status}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {mode === "agent" && (
            <button
              type="button"
              disabled={pending}
              onClick={takeOver}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
            >
              {t("browser.control.takeOver")}
            </button>
          )}
          {userHolds && (
            <button
              type="button"
              disabled={pending}
              onClick={handBack}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
            >
              {t("browser.control.handBack")}
            </button>
          )}
          {canStop && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmStop(true)}
              className="rounded-xl bg-white/5 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-white/10 disabled:opacity-50"
            >
              {t("browser.control.stop")}
            </button>
          )}
        </span>
      </div>
      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ticketDetail.forceStopTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{hash}</span>
              {t("ticketDetail.forceStopDescSuffix")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={stop}>
              {t("ticketDetail.forceStop")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
