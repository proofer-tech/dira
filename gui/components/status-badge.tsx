/** 상태 표현의 **유일한 출처** (DESIGN.md §비주얼 디렉션 §2 · §4-1 · §5 커스텀 5개).
 *
 *  shadcn Badge 변종 4개로는 상태 11개(티켓 5 · 워커 4 · 연결 2)를 담지 못한다. 색·아이콘·라벨을
 *  한 표에서 결정해 세 화면이 같은 상태를 다르게 그리는 걸 구조적으로 막는다. 라벨 문자열은
 *  `tickets.py list` 출력과 같은 말을 쓴다 — CLI와 GUI가 다른 단어를 쓰면 안 된다.
 *
 *  색만으로 의미를 전달하지 않는다: 셋(색·아이콘·텍스트)이 항상 같이 나온다. */
import Link from "next/link";
import {
  Check,
  Circle,
  CircleCheck,
  CircleDot,
  CirclePlay,
  CircleQuestionMark,
  Clock,
  Lock,
  MessageSquareReply,
  Play,
  Plug,
  Power,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DepKind } from "@/lib/queue";
import { elapsedSuffix } from "@/lib/urls";
import { cn } from "@/lib/utils";

export type Status =
  // 티켓 5상태 (open은 미할당·deps 충족)
  | "open"
  | "blocked"
  // `blocked`의 하위 종류 — 상태 5개를 늘리는 게 아니라 표시가 갈리는 것이다(queue.ts isAwaiting)
  | "awaiting"
  | "assigned"
  | "wip"
  | "done"
  // 워커 4상태
  | "running"
  | "idle"
  | "stopped"
  | "stale"
  // 프로젝트 연결 2상태
  | "connected"
  | "disconnected";

type Spec = {
  label: string;
  icon: LucideIcon;
  /** 중립 상태는 shadcn 변종을 그대로 쓴다. 색 토큰을 쓰는 상태는 `outline` 위에 덮는다. */
  variant: "secondary" | "outline";
  /** 배지 레시피는 하나다 — 색만 다르다. Tailwind가 클래스를 정적으로 봐야 해서 다 적는다. */
  tint?: string;
  /** 이상 상태의 사유. `DepBadge`의 `missing`과 같은 처리 — 전문은 `title`로 붙인다. */
  hint?: string;
};

const ACTIVE = "text-status-active bg-status-active/10 border-status-active/30";
const STALE = "text-status-stale bg-status-stale/10 border-status-stale/30";
const BLOCKED = "text-status-blocked bg-status-blocked/10 border-status-blocked/30";

/** `할당됨` 배지의 사유 — 스펙 문구 그대로다(DESIGN.md §비주얼 §2 이상 상태 항). */
const ASSIGNED_HINT =
  "session_id가 박힌 열린 티켓 — 큐에서 영구 제외된다. 할당 해제로 되돌린다";

const STATUS: Record<Status, Spec> = {
  open: { label: "대기", icon: Circle, variant: "secondary" },
  blocked: { label: "deps 대기", icon: Lock, variant: "outline", tint: BLOCKED },
  // 이상 상태가 **아니다** — PM이 물었고 사람이 답할 일이 있다는 정상 신호다(§요구사항 레이어
  // 결정 4). 그래서 막힘 색을 그대로 쓰고 새 색 토큰을 만들지 않는다. 갈리는 건 아이콘·라벨뿐이고,
  // 방치는 `days`(경과일)가 말한다. 아이콘은 designer가 확정했다(`588bc5bc` → DESIGN.md §2):
  // 말풍선+답장 화살표다. 물음표 원(`MessageCircleQuestionMark`)은 안 쓴다 — 14px에서 deps 배지의
  // `큐에 없는 해시`(`CircleQuestionMark`, **같은 BLOCKED 색**)와 실루엣이 겹치고, 보드에서 두
  // 배지가 상태 컬럼·deps 컬럼에 나란히 앉는다.
  awaiting: {
    label: "답변 대기",
    icon: MessageSquareReply,
    variant: "outline",
    tint: BLOCKED,
    hint: "PM이 되물었다 — 요구사항 상세에서 답을 쓰면 다시 큐에 뜬다. 자동 만료는 없다",
  },
  // 정상 흐름에 없는 상태다(엔진은 claim → assign 순서라 "열린 파일 + session_id"를 만들지 않는다).
  // 그래서 정상 단계용 색을 주지 않는다 — stale과 같은 "고장, 사람이 봐야 함"이다(§2 이상 상태).
  assigned: {
    label: "할당됨",
    icon: CircleDot,
    variant: "outline",
    tint: STALE,
    hint: ASSIGNED_HINT,
  },
  wip: { label: "진행중", icon: CirclePlay, variant: "outline", tint: ACTIVE },
  done: {
    label: "완료",
    icon: CircleCheck,
    variant: "outline",
    tint: "text-status-done bg-status-done/10 border-status-done/30",
  },
  running: { label: "running", icon: Play, variant: "outline", tint: ACTIVE },
  idle: { label: "idle", icon: Clock, variant: "secondary" },
  stopped: { label: "stopped", icon: Power, variant: "outline" },
  stale: { label: "stale", icon: TriangleAlert, variant: "outline", tint: STALE },
  connected: { label: "연결됨", icon: Plug, variant: "secondary" },
  // 워커 stale과 색은 공유하고 아이콘으로 갈린다 — 죽은 락과 없는 경로는 다른 사건이다.
  disconnected: { label: "연결 안 됨", icon: Unplug, variant: "outline", tint: STALE },
};

/** 상태 라벨 문자열이 필요한 곳(보드 필터 선택지) — 배지 없이도 **같은 말**을 쓰게 한다. */
export const statusLabel = (status: Status) => STATUS[status].label;

/** `답변 대기 · <n>일`의 경과일. 기준은 `birth`가 아니라 `mtime`이다 — PM이 `awaiting`을 걸며
 *  파일을 고친 시점이 대기 시작이다(§1 보드). 배지를 그리는 화면(보드·상세)이 **같은 계산**을
 *  쓰게 여기 둔다. 서버에서 부른다(로컬 도구라 서버·브라우저가 같은 타임존이다). */
export const daysSince = (ms: number) => Math.floor((Date.now() - ms) / 86_400_000);

/** `days`는 방치 경과일이다(`답변 대기 · 3일`). 오래된 답변 대기가 정체의 신호이고 그 판단은
 *  사람이 한다 — 자동 만료도 색 변화도 없다(§요구사항 레이어 결정 4).
 *
 *  경과는 라벨과 **같은 색·크기**다 — 별도 span도 `opacity`도 `--muted-foreground`도 쓰지 않는다
 *  (§비주얼 §1 대비 함정). `tabular-nums`만 붙어서 자릿수가 바뀔 때 배지가 흔들리지 않는다(§3). */
export function StatusBadge({
  status,
  days,
  className,
}: {
  status: Status;
  days?: number;
  className?: string;
}) {
  const { label, icon: Icon, variant, tint, hint } = STATUS[status];
  return (
    <Badge variant={variant} className={cn("tabular-nums", tint, className)} title={hint}>
      <Icon aria-hidden className="size-3.5" />
      {label + elapsedSuffix(days)}
    </Badge>
  );
}

/** deps 배지 (§2 deps 배지) — 보드 deps 컬럼과 티켓 상세 관계 절이 **같은 것**을 쓴다.
 *
 *  네 경우다: 충족 / 미충족 / 큐에 없는 해시(오타 → 조용히 굶는 영구 대기라 특히 눈에 띄어야
 *  한다) / 답변 기록. 종류 판정은 여기서 하지 않는다 — `queue.ts depBadges`가 유일한 출처다.
 *  해시는 자르지 않는다(§6 텍스트 잘림: 잘린 해시는 쓸모가 없다). 전문 설명은 `title`로 붙인다 —
 *  `tooltip`은 클라이언트 컴포넌트고 이 배지는 테이블 셀에 수십 개가 깔린다. */
export function DepBadge({
  hash,
  kind,
  href,
  hint,
}: {
  hash: string;
  kind: DepKind;
  href?: string;
  /** 사유 문구 덮어쓰기. `req:`(출처)는 잠금이 아니라서 "영구 대기"가 거짓말이다 — 그 자리용. */
  hint?: string;
}) {
  const spec = {
    met: { icon: Check, tint: undefined, hint: "충족 — 완료된 티켓" },
    unmet: { icon: Lock, tint: BLOCKED, hint: "미충족 — 아직 완료되지 않았다" },
    missing: { icon: CircleQuestionMark, tint: BLOCKED, hint: "큐에 없는 해시 — 영구 대기" },
    // 충족과 **같은 중립 색이고 아이콘만 다르다** — 답변은 선행 작업이 아니라 기록이다.
    // `답변 대기` 상태 배지와 같은 아이콘: 왕복 한 쌍(기다리는 쪽 / 달린 쪽)이 아이콘을 공유한다.
    answer: {
      icon: MessageSquareReply,
      tint: undefined,
      hint: "답변 기록 — 이 요구사항의 답변",
    },
  }[kind];
  const reason = hint ?? spec.hint;
  const badge = (
    <Badge variant="outline" className={cn("font-mono", spec.tint)} title={reason}>
      <spec.icon aria-hidden className="size-3.5" />
      {hash}
      {/* 아이콘은 `aria-hidden`이고 사유는 `title`뿐이라, 이 문구가 비시각 사용자에게 종류를
          말하는 유일한 통로다(§비주얼 §2, 사람 요청 `1f2ac454`). 옆 라벨의 `· 미충족 n`을
          지우면서 여기로 옮겼다 — 건수 대신 **어느 해시가** 무엇인지를 말한다. */}
      <span className="sr-only">{reason}</span>
    </Badge>
  );
  return href ? <Link href={href}>{badge}</Link> : badge;
}
