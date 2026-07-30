/** 보드 로딩 — 실제 칸반과 같은 모양(레인 3개 `w-72` × 카드 3장). 스피너 금지(DESIGN.md §6).
 *  기본 뷰가 칸반이라 스켈레톤도 칸반이다(§1). `?view=table`로 들어와도 이 스켈레톤이 뜬다 —
 *  뷰 선택 기억을 안 두므로 서버가 어느 쪽인지 모른다. 기본값 쪽이 제일 자주 맞는다.
 *
 *  **라우트 그룹 `(board)`에 사는 이유**: `p/[project]/loading.tsx`로 두면 워커·페르소나·프로토콜·
 *  티켓 화면까지 보드 스켈레톤이 뜬다. 더 위(`p/[project]/`)의 Suspense 경계는 레이아웃의
 *  `notFound()`보다 먼저 흘러서 404 상태도 못 세운다 — `(list)/loading.tsx`가 같은 함정의 실측이다.
 *  경계가 이 그룹 안에 있으면 `p/[project]/layout.tsx`는 여전히 블로킹으로 돌아 404를 세운다.
 *
 *  헤더·발행 버튼은 fs를 안 읽지만 스켈레톤에 남긴다 — 이 화면에서 그 자리는 보드 위로
 *  고정이고, 비워 두면 도착할 때 본문이 통째로 아래로 밀린다. */
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-8 w-20" />
      </div>

      {/* 검색 · kind · persona · 상태 · 뷰 전환 · 건수 — 선택지가 큐에서 나오므로 늦게 온다 */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      {/* 레인 3개 × w-72 — 개수는 파생값이다(`(board)/page.tsx`의 `STATUSES`). 그쪽 레인이
          바뀌면 여기도 같이 바꾼다(§1). `-mx-1 px-1`도 보드와 같다: <Card>의 `ring-1`은
          border box 밖에 그려서 여백이 없으면 양끝 카드 테두리가 잘린다(근거는 같은 파일).
          여기서 빼면 스켈레톤과 도착한 보드의 카드 테두리가 갈린다 */}
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {Array.from({ length: 3 }, (_, c) => (
          <div key={c} className="w-72 shrink-0 space-y-2">
            {/* 컬럼 헤더: 상태 배지 + 건수 */}
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3.5 w-8" />
            </div>
            {/* 카드 3장 — 컬럼별 실제 건수는 알 수 없다. 카드 안은 해시·title·kind·persona 순 */}
            {Array.from({ length: 3 }, (_, i) => (
              <Card key={i} className="gap-2 px-4">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3.5 w-32" />
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
