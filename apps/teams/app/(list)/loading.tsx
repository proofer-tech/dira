/** 프로젝트 목록 로딩 — 실제 레이아웃과 같은 모양(행 높이 h-9 3행). 스피너 금지(DESIGN.md §6).
 *  등록 폼은 fs를 안 읽으므로 스켈레톤을 그리지 않는다 — 실제로는 즉시 뜬다. */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    // `min-h-0 flex-1 overflow-y-auto`는 셸 규약이다(§비주얼 §4 · app/layout.tsx) — 문서가
    // 스크롤하지 않으므로 `main`이 스크롤러가 아니면 넘친 내용에 못 닿는다
    <main className="min-h-0 w-full max-w-3xl flex-1 space-y-6 overflow-y-auto px-6 py-6">
      <Skeleton className="h-6 w-24" />
      <div className="space-y-1">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </main>
  );
}
