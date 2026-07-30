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
  Play,
  Plug,
  Power,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Status =
  // 티켓 5상태 (open은 미할당·deps 충족)
  | "open"
  | "blocked"
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

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { label, icon: Icon, variant, tint, hint } = STATUS[status];
  return (
    <Badge variant={variant} className={cn(tint, className)} title={hint}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </Badge>
  );
}

/** deps 배지 (§2 deps 배지) — 보드 deps 컬럼과 티켓 상세 관계 절이 **같은 것**을 쓴다.
 *
 *  세 경우다: 충족 / 미충족 / 큐에 없는 해시(오타 → 조용히 굶는 영구 대기라 특히 눈에 띄어야 한다).
 *  해시는 자르지 않는다(§6 텍스트 잘림: 잘린 해시는 쓸모가 없다). 전문 설명은 `title`로 붙인다 —
 *  `tooltip`은 클라이언트 컴포넌트고 이 배지는 테이블 셀에 수십 개가 깔린다. */
export function DepBadge({
  hash,
  kind,
  href,
  hint,
}: {
  hash: string;
  kind: "met" | "unmet" | "missing";
  href?: string;
  /** 사유 문구 덮어쓰기. `req:`(출처)는 잠금이 아니라서 "영구 대기"가 거짓말이다 — 그 자리용. */
  hint?: string;
}) {
  const spec = {
    met: { icon: Check, tint: undefined, hint: "충족 — 완료된 티켓" },
    unmet: { icon: Lock, tint: BLOCKED, hint: "미충족 — 아직 완료되지 않았다" },
    missing: { icon: CircleQuestionMark, tint: BLOCKED, hint: "큐에 없는 해시 — 영구 대기" },
  }[kind];
  const badge = (
    <Badge variant="outline" className={cn("font-mono", spec.tint)} title={hint ?? spec.hint}>
      <spec.icon aria-hidden className="size-3.5" />
      {hash}
    </Badge>
  );
  return href ? <Link href={href}>{badge}</Link> : badge;
}
