"use client";

/** 화면별 스켈레톤 등록 자리 (DESIGN.md §P534 결정 3 - 4). `ShellMain`이 대기 신호의 목적지
 *  경로로 여기서 스켈레톤을 고른다 - **등록 자리는 이 표 한 군데**다. 등록 안 된 화면은 종전처럼
 *  스켈레톤 없이 §0-22 표식만 쓴다. 숫자 - 이름 - 문구를 안 넣는다(§49): 큰 상자 배치만 흉내 낸다. */

import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { usePendingDest } from "@/lib/route-pending";
import { pendingTarget, type Screen } from "@/lib/urls";

function HomeSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-6">
      {/* 실제 홈 패널(`home-ui.tsx` `Sidebar`)과 같은 상자다(§P544): `-mt-12`로 헤더 위까지 덮고
          `z-50`으로 헤더보다 위, 면 `bg-surface`와 경계선 `border-r`도 같다. 좁은 창에서도 실제 패널이
          보이므로 `hidden`을 걸지 않는다. */}
      <div className="relative z-50 -mt-12 flex w-64 shrink-0 flex-col gap-3 border-r bg-surface p-4">
        <Skeleton className="h-8 w-8" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="min-h-0 flex-1" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

/** 실제 보드와 같은 두 칸이다(§P540). 왼쪽 에픽 사이드바(`w-64`, `sidebar=off`면 `w-10`),
 *  오른쪽은 `view=table`이면 행 목록, 아니면 칸반 세 열(스윔레인도 세 열로 대신한다). */
function BoardSkeleton({ query }: { query: URLSearchParams }) {
  const table = query.get("view") === "table";
  const sidebarOff = query.get("sidebar") === "off";
  return (
    <>
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex min-h-0 flex-1 gap-6">
        <div className={`flex shrink-0 flex-col gap-2 ${sidebarOff ? "w-10" : "w-64"}`}>
          {Array.from({ length: sidebarOff ? 1 : 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        {table ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 gap-4">
            {Array.from({ length: 3 }, (_, c) => (
              <div key={c} className="flex min-w-0 flex-1 flex-col gap-3">
                <Skeleton className="h-6 w-1/2" />
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** 왼쪽 트리 - 목록과 오른쪽 본문 두 칸 - 스쿼드 - 프로토콜 - 온톨로지가 같이 쓴다. */
function SidebarBodySkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-6">
      <div className="flex w-64 shrink-0 flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    </div>
  );
}

function WorkersSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-48" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </>
  );
}

const SKELETONS: Partial<Record<Screen, (p: { query: URLSearchParams }) => React.ReactNode>> = {
  home: HomeSkeleton,
  board: BoardSkeleton,
  personas: SidebarBodySkeleton,
  protocols: SidebarBodySkeleton,
  ontology: SidebarBodySkeleton,
  workers: WorkersSkeleton,
};

/** 누른 이동의 목적지가 등록된 화면이고 지금과 프로젝트나 화면이 다르면 그 목적지, 아니면
 *  `null`이다. 신호가 꺼지면(도착 - 뒤로가기 - 앞지름) 자동으로 `null`이라 종전 화면으로
 *  돌아간다(결정 5). */
export function usePendingTarget() {
  const target = pendingTarget(usePathname(), usePendingDest());
  return target && SKELETONS[target.screen] ? target : null;
}

export function ScreenSkeleton({ screen, query }: { screen: Screen; query: URLSearchParams }) {
  const Body = SKELETONS[screen];
  return Body ? <Body query={query} /> : null;
}
