/** 우선순위 미터 — §비주얼 §49의 유일한 출처 (§49가 dot을 대체하며 새로 정한 형식).
 *
 *  5칸 막대, 채운 칸 수 = `priority`. 색은 무채색 둘(`--foreground` · `--border`)뿐이고 상태색을
 *  한 개도 안 빌린다 — 순위는 순서가 있는 축이라 색이 아니라 양으로 그린다(§49 §고르는 축).
 *  자기 `priority`만 그린다, 유효 우선순위가 아니다(§1-3이 닫은 값). 조작이 아니라
 *  `aria-hidden`이고, 색만으로 말하지 않으므로 옆에 `sr-only` 문구가 따라온다.
 *
 *  칸반(서버 컴포넌트) · 표(서버) · 상세 편집 폼(클라이언트) 셋이 같은 글리프를 쓰므로
 *  이 파일엔 `"use client"`가 없다 — 로케일은 인자로 받는다(§0-16, `sr-only` 문구도 사전에서 온다). */
import { t, wrap, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const BAR_H = ["h-0.5", "h-1", "h-1.5", "h-2", "h-2.5"]; // 2·4·6·8·10px

export function PriorityMeter({ priority, locale }: { priority: number; locale: Locale }) {
  // 3은 안 그린다. 자리도 안 잡는다 — 아무것도 렌더하지 않는다(§재판정 `c34954a4`)
  if (priority === 3) return null;
  return (
    <>
      <span aria-hidden className="inline-flex h-2.5 w-3.5 items-end gap-px">
        {BAR_H.map((h, i) => (
          <span key={i} className={cn("w-0.5", h, i < priority ? "bg-foreground" : "bg-border")} />
        ))}
      </span>
      <span className="sr-only">{wrap(t(locale, "ticket.priority.srOnly"), String(priority), "")}</span>
    </>
  );
}
