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
      <Skeleton className="hidden w-64 shrink-0 md:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="min-h-0 flex-1" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <>
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
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

const SKELETONS: Partial<Record<Screen, () => React.ReactNode>> = {
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

export function ScreenSkeleton({ screen }: { screen: Screen }) {
  const Body = SKELETONS[screen];
  return Body ? <Body /> : null;
}
