/** 보드 로딩 — 실제 테이블과 같은 모양(헤더 + 8행, 행 높이 `h-9`, 컬럼 8개). 스피너 금지(DESIGN.md §6).
 *
 *  **라우트 그룹 `(board)`에 사는 이유**: `p/[project]/loading.tsx`로 두면 워커·페르소나·프로토콜·
 *  티켓 화면까지 테이블 스켈레톤이 뜬다. 더 위(`p/[project]/`)의 Suspense 경계는 레이아웃의
 *  `notFound()`보다 먼저 흘러서 404 상태도 못 세운다 — `(list)/loading.tsx`가 같은 함정의 실측이다.
 *  경계가 이 그룹 안에 있으면 `p/[project]/layout.tsx`는 여전히 블로킹으로 돌아 404를 세운다.
 *
 *  헤더·발행 버튼은 fs를 안 읽지만 스켈레톤에 남긴다 — 이 화면에서 그 자리는 테이블 위로
 *  고정이고, 비워 두면 도착할 때 표가 통째로 아래로 밀린다. */
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** 컬럼 8개의 대략적인 내용 폭 — 상태·해시·title·kind·persona·deps·생성일·owner 순.
 *  실제 표는 auto layout이라 정확히 같을 수 없다. 눈에 띄는 점프만 막으면 된다. */
const CELLS = ["w-14", "w-16", "w-48", "w-12", "w-16", "w-10", "w-28", "w-24"];

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

      <Table>
        <TableHeader>
          <TableRow className="h-9 hover:bg-transparent">
            {CELLS.map((w, i) => (
              <TableHead key={i} className="h-9 px-3">
                <Skeleton className={`h-3.5 ${w}`} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }, (_, r) => (
            <TableRow key={r} className="h-9 hover:bg-transparent">
              {CELLS.map((w, i) => (
                <TableCell key={i} className="px-3 py-0">
                  <Skeleton className={`h-3.5 ${w}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
