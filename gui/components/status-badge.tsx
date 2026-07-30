/** 상태 표현의 **유일한 출처** (DESIGN.md §비주얼 디렉션 §2 · §4-1 · §5 커스텀 5개).
 *
 *  shadcn Badge 변종 4개로는 상태 11개(티켓 5 · 워커 4 · 연결 2)를 담지 못한다. 색·아이콘·라벨을
 *  한 표에서 결정해 세 화면이 같은 상태를 다르게 그리는 걸 구조적으로 막는다. 라벨 문자열은
 *  `tickets.py list` 출력과 같은 말을 쓴다 — CLI와 GUI가 다른 단어를 쓰면 안 된다.
 *
 *  색만으로 의미를 전달하지 않는다: 셋(색·아이콘·텍스트)이 항상 같이 나온다. */
import {
  Circle,
  CircleCheck,
  CircleDot,
  CirclePlay,
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
  // 테넌트 연결 2상태
  | "connected"
  | "disconnected";

type Spec = {
  label: string;
  icon: LucideIcon;
  /** 중립 상태는 shadcn 변종을 그대로 쓴다. 색 토큰을 쓰는 상태는 `outline` 위에 덮는다. */
  variant: "secondary" | "outline";
  /** 배지 레시피는 하나다 — 색만 다르다. Tailwind가 클래스를 정적으로 봐야 해서 다 적는다. */
  tint?: string;
};

const ACTIVE = "text-status-active bg-status-active/10 border-status-active/30";
const STALE = "text-status-stale bg-status-stale/10 border-status-stale/30";

const STATUS: Record<Status, Spec> = {
  open: { label: "대기", icon: Circle, variant: "secondary" },
  blocked: {
    label: "deps 대기",
    icon: Lock,
    variant: "outline",
    tint: "text-status-blocked bg-status-blocked/10 border-status-blocked/30",
  },
  assigned: {
    label: "할당됨",
    icon: CircleDot,
    variant: "outline",
    tint: "text-status-assigned bg-status-assigned/10 border-status-assigned/30",
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

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { label, icon: Icon, variant, tint } = STATUS[status];
  return (
    <Badge variant={variant} className={cn(tint, className)}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </Badge>
  );
}
