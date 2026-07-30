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
import { personaDotClass } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** 색 점 하나 (점만 그리는 모드). `size-2`는 border-box라 빈 점의 테두리가 붙어도 정확히 8px이다 —
 *  미할당 페르소나 줄만 들여쓰기가 어긋나지 않는다(§12). 색만으로 뜻을 전하지 않으므로
 *  `aria-hidden`이다 — 이름 텍스트가 항상 같이 온다(§비주얼 §0). */
export function PersonaDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", personaDotClass(color), className)}
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
  className,
}: {
  name: string;
  /** 레지스트리 `personaColors`의 팔레트 키. 없거나 팔레트 밖이면 빈 점이다 */
  color?: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={className}>
      <PersonaDot color={color} />
      {name}
    </Badge>
  );
}
