/** 상태 표현의 **유일한 출처** (DESIGN.md §비주얼 디렉션 §2 · §4-1 · §5 커스텀 5개).
 *
 *  shadcn Badge 변종 4개로는 상태 11개(티켓 5 · 워커 4 · 연결 2)를 담지 못한다. 색·아이콘·라벨을
 *  한 표에서 결정해 세 화면이 같은 상태를 다르게 그리는 걸 구조적으로 막는다. 라벨 문자열은
 *  `tickets.py list` 출력과 같은 말을 쓴다 — CLI와 GUI가 다른 단어를 쓰면 안 된다.
 *
 *  색만으로 의미를 전달하지 않는다: 셋(색·아이콘·텍스트)이 항상 같이 나온다.
 *
 *  **`locale`을 프롭으로 받는다**(§0-16 §발행 §묶음 표 2, `dd97c69c`) — `"use client"`를 안
 *  붙인다. 이 컴포넌트는 서버(셸·보드·상세·워커)와 클라이언트(`project-switcher.tsx`) 양쪽에서
 *  쓰이므로 `useLocale()`로 고정하지 않는다(developer memory "i18n 서버 문자열은 로케일이
 *  없다" — 한쪽은 `readLanguage()`, 한쪽은 `useLocale()`로 호출부가 채운다). 아직 이 프롭을 안
 *  넘기는 자리(다음 묶음 몫인 화면들)는 `ko` 기본값으로 떨어져 종전과 같은 화면이 선다. */
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
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";
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
  labelKey: string;
  icon: LucideIcon;
  /** 중립 상태는 shadcn 변종을 그대로 쓴다. 색 토큰을 쓰는 상태는 `outline` 위에 덮는다. */
  variant: "secondary" | "outline";
  /** 배지 레시피는 하나다 — 색만 다르다. Tailwind가 클래스를 정적으로 봐야 해서 다 적는다. */
  tint?: string;
  /** 이상 상태의 사유 키. `DepBadge`의 `missing`과 같은 처리 — 전문은 `title`로 붙인다. */
  hintKey?: string;
};

const ACTIVE = "text-status-active bg-status-active/10 border-status-active/30";
const STALE = "text-status-stale bg-status-stale/10 border-status-stale/30";
const BLOCKED = "text-status-blocked bg-status-blocked/10 border-status-blocked/30";

const STATUS: Record<Status, Spec> = {
  open: { labelKey: "status.label.open", icon: Circle, variant: "secondary" },
  blocked: { labelKey: "status.label.blocked", icon: Lock, variant: "outline", tint: BLOCKED },
  // 이상 상태가 **아니다** — PM이 물었고 사람이 답할 일이 있다는 정상 신호다(§요구사항 레이어
  // 결정 4). 그래서 막힘 색을 그대로 쓰고 새 색 토큰을 만들지 않는다. 갈리는 건 아이콘·라벨뿐이고,
  // 방치는 `days`(경과일)가 말한다. 아이콘은 designer가 확정했다(`588bc5bc` → DESIGN.md §2):
  // 말풍선+답장 화살표다. 물음표 원(`MessageCircleQuestionMark`)은 안 쓴다 — 14px에서 deps 배지의
  // `큐에 없는 해시`(`CircleQuestionMark`, **같은 BLOCKED 색**)와 실루엣이 겹치고, 보드에서 두
  // 배지가 상태 컬럼·deps 컬럼에 나란히 앉는다.
  awaiting: {
    labelKey: "status.label.awaiting",
    icon: MessageSquareReply,
    variant: "outline",
    tint: BLOCKED,
    hintKey: "status.hint.awaiting",
  },
  // 정상 흐름에 없는 상태다(엔진은 claim → assign 순서라 "열린 파일 + session_id"를 만들지 않는다).
  // 그래서 정상 단계용 색을 주지 않는다 — stale과 같은 "고장, 사람이 봐야 함"이다(§2 이상 상태).
  assigned: {
    labelKey: "status.label.assigned",
    icon: CircleDot,
    variant: "outline",
    tint: STALE,
    hintKey: "status.hint.assigned",
  },
  wip: { labelKey: "status.label.wip", icon: CirclePlay, variant: "outline", tint: ACTIVE },
  done: {
    labelKey: "status.label.done",
    icon: CircleCheck,
    variant: "outline",
    tint: "text-status-done bg-status-done/10 border-status-done/30",
  },
  running: { labelKey: "status.label.running", icon: Play, variant: "outline", tint: ACTIVE },
  idle: { labelKey: "status.label.idle", icon: Clock, variant: "secondary" },
  stopped: { labelKey: "status.label.stopped", icon: Power, variant: "outline" },
  stale: { labelKey: "status.label.stale", icon: TriangleAlert, variant: "outline", tint: STALE },
  connected: { labelKey: "status.label.connected", icon: Plug, variant: "secondary" },
  // 워커 stale과 색은 공유하고 아이콘으로 갈린다 — 죽은 락과 없는 경로는 다른 사건이다.
  disconnected: { labelKey: "status.label.disconnected", icon: Unplug, variant: "outline", tint: STALE },
};

/** 상태 라벨 문자열이 필요한 곳(보드 필터 선택지) — 배지 없이도 **같은 말**을 쓰게 한다.
 *  훅을 못 쓰는 자리(서버 컴포넌트 · 상수 목록)를 위해 `locale`을 인자로 받는다 — 안 주면 `ko`. */
export const statusLabel = (status: Status, locale: Locale = DEFAULT_LOCALE) =>
  t(locale, STATUS[status].labelKey);

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
  locale = DEFAULT_LOCALE,
}: {
  status: Status;
  days?: number;
  className?: string;
  locale?: Locale;
}) {
  const { icon: Icon, variant, tint, hintKey } = STATUS[status];
  return (
    <Badge
      variant={variant}
      className={cn("tabular-nums", tint, className)}
      title={hintKey ? t(locale, hintKey) : undefined}
    >
      <Icon aria-hidden className="size-3.5" />
      {statusLabel(status, locale) + elapsedSuffix(days, locale)}
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
  locale = DEFAULT_LOCALE,
}: {
  hash: string;
  kind: DepKind;
  href?: string;
  /** 사유 문구 덮어쓰기. `req:`(출처)는 잠금이 아니라서 "영구 대기"가 거짓말이다 — 그 자리용. */
  hint?: string;
  locale?: Locale;
}) {
  const spec = {
    met: { icon: Check, tint: undefined, hintKey: "dep.hint.met" },
    unmet: { icon: Lock, tint: BLOCKED, hintKey: "dep.hint.unmet" },
    missing: { icon: CircleQuestionMark, tint: BLOCKED, hintKey: "dep.hint.missing" },
    // 충족과 **같은 중립 색이고 아이콘만 다르다** — 답변은 선행 작업이 아니라 기록이다.
    // `답변 대기` 상태 배지와 같은 아이콘: 왕복 한 쌍(기다리는 쪽 / 달린 쪽)이 아이콘을 공유한다.
    answer: {
      icon: MessageSquareReply,
      tint: undefined,
      hintKey: "dep.hint.answer",
    },
  }[kind];
  const reason = hint ?? t(locale, spec.hintKey);
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
