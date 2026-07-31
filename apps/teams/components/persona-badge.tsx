/** persona 값 표시의 **유일한 출처** (DESIGN.md §5 "점 배지가 붙는 자리" · §비주얼 §12).
 *
 *  persona 값이 5곳에 나오는데 색은 레지스트리에 있다 — 조회를 자리마다 다시 쓰면 어느 화면
 *  하나가 조용히 색 없이 남는다(`<StatusBadge>`와 같은 이유). 점만 필요한 자리(필터 팝오버 ·
 *  발행/편집 폼 select 항목)를 이 파일이 같이 받는다: 껍데기가 있고 없고가 갈릴 뿐 **점은 같은
 *  `size-2`다** — 자리마다 커졌다 작아지면 같은 표식으로 안 읽힌다.
 *
 *  **상태 배지 레시피(색 글자 + 10% 틴트 + 30% 테두리)를 쓰지 않는다**(§비주얼 §12) —
 *  이 파일에 상태 토큰 문자열이 하나도 없는 것이 그 규칙의 검증이다(티켓 `d9740156`의 grep).
 *  페르소나 색은 뜻이 없는 신원 표식이고 상태 색은 뜻이 박혀 있다 — 섞으면 사람이 고른 초록이
 *  `완료`로 읽힌다. 껍데기는 중립(`outline`)이고 색은 8px 점 하나뿐이다. */
import { Badge } from "@/components/ui/badge";
import type { TicketState } from "@/lib/queue";
import { personaDotClass } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** 색 점 하나 (점만 그리는 모드). `size-2`는 border-box라 빈 점의 테두리가 붙어도 정확히 8px이다 —
 *  미할당 페르소나 줄만 들여쓰기가 어긋나지 않는다(§12). 색만으로 뜻을 전하지 않으므로
 *  `aria-hidden`이다 — 이름 텍스트가 항상 같이 온다(§비주얼 §0).
 *
 *  **수직 정렬은 점이 들고 간다** — `self-center`다(`394d3b50`). 감싸는 항목에 맡기면
 *  `CommandItem`(`items-center`)에서는 맞고 `SelectItem`에서는 6px 위로 붙는다:
 *  shadcn `SelectItem`의 텍스트 슬롯이 `flex ... gap-2`인데 `items-center`가 없어
 *  교차축 시작점(줄 맨 위)에 놓인다. `components/ui/`는 손대지 않으므로(apps/teams/AGENTS.md)
 *  여섯 번째 자리가 생겨도 안 어긋나는 쪽에 붙인다. 이미 `items-center`인 자리에서는 무동작이다.
 *
 *  **진행중 판정도 점이 든다** — 호출부가 `state === "wip" && "animate-..."`를 계산해서 넘기면
 *  점이 나가는 6곳에 같은 조건이 흩어지고 한 자리가 조용히 빠진다(`self-center`와 같은 이유).
 *  그래서 받는 것은 클래스가 아니라 **티켓 상태**다. 티켓 문맥이 없는 자리(페르소나 설정 ·
 *  발행/편집 폼 select · 필터 팝오버 · 프로젝트 목록)는 이 프롭을 안 넘기므로 종전대로 정지다.
 *  모션 값은 §비주얼 §18(`--animate-wip-pulse`)이고 `motion-reduce`에서 기본 상태에 선다 —
 *  움직임이 사라져도 레인·상태 배지·워커 이름이 `진행중`을 글자로 말한다. */
export function PersonaDot({
  color,
  state,
  className,
}: {
  color?: string;
  /** 티켓 상태. `wip`이면 점이 움직인다(§비주얼 §18). 티켓이 아닌 자리는 안 넘긴다 */
  state?: TicketState;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 self-center rounded-full",
        personaDotClass(color),
        state === "wip" && "animate-wip-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** 점 + 이름 (보드 테이블 persona 컬럼 · 칸반 카드 메타 줄).
 *
 *  `outline`인 이유(§12): `secondary`는 중립 상태(`대기`·`idle`)가 이미 쓰는데 보드 테이블은
 *  상태 컬럼과 persona 컬럼이 이웃이라 회색으로 채운 배지 두 개가 나란히 앉는다.
 *  점–이름 간격은 Badge 기본 `gap-1`이고 오버라이드하지 않는다.
 *
 *  **persona가 없는 티켓은 이 배지를 그리지 않는다** — 호출부가 `—` 한 글자를 낸다(§12).
 *  "담당이 없다"와 "담당은 있는데 색을 안 골랐다"는 다른 사실이다. */
export function PersonaBadge({
  name,
  color,
  state,
  className,
}: {
  name: string;
  /** 레지스트리 `personaColors`의 팔레트 키. 없거나 팔레트 밖이면 빈 점이다 */
  color?: string;
  /** 점까지 그대로 내려간다 — 판정은 점이 한다(§비주얼 §18) */
  state?: TicketState;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={className}>
      <PersonaDot color={color} state={state} />
      {name}
    </Badge>
  );
}
