/** 보드 왼쪽 에픽 사이드바 (DESIGN.md §에픽 결정 5 · §비주얼 §52 ①②).
 *
 *  **에픽 화면(§결정 6, `36e431d9`)이 같은 컴포넌트를 쓴다** — 갈리는 것은 링크 목적지 하나다
 *  (§52 ④ "같은 컴포넌트 … 갈리는 것은 prop 하나"). 지금 이 티켓은 보드 쪽 `hrefFor`
 *  (`?epic=<값>`)만 채운다.
 *
 *  서버 컴포넌트다 — 목록도 제목도 페이지가 이미 읽은 값을 그대로 받는다(새 클라이언트 상태 ·
 *  새 폴링 · 새 스켈레톤 0개, §52 §로딩). */
import Link from "next/link";
import { NotebookText } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { NO_EPIC, type Epic } from "@/lib/epics";
import { t, type Locale } from "@/lib/i18n";

export function EpicSidebar({
  epics,
  titles,
  active,
  hrefFor,
  allHref,
  allActive,
  memoryHrefFor,
  locale,
}: {
  epics: Epic[];
  /** P번호 → `README.md` 첫 줄. 없거나 못 읽으면 `null`(§결정 5 §제목 없음). `NO_EPIC`은 키에 없다 */
  titles: Record<string, string | null>;
  /** 지금 걸린 `?epic=` 값. `null`이면 필터 없음(어느 줄도 선택되지 않는다) */
  active: string | null;
  /** 이 값으로 필터를 건 URL(§결정 5 — 기존 필터 그릇에 드는 `?epic=`) */
  hrefFor: (value: string) => string;
  /** 맨 위 `전체` 줄의 목적지(§결정 12) — 보드는 `?epic=`을 뺀 URL, 에픽 화면은 보드 루트다.
   *  값이 아니라 화면마다 다른 상수라 `hrefFor`처럼 함수로 안 받는다 */
  allHref: string;
  /** `전체` 줄의 선택 표식 — 보드는 `active === null`, 에픽 화면은 늘 `false`다(§결정 12
   *  "그 화면은 늘 에픽 하나를 골라 두므로 이 줄은 선택 표식을 안 든다") */
  allActive: boolean;
  /** 둘째 문의 목적지 — `/p/<project>/epics/<P번호>`(§결정 6). 없으면 안 그린다 — 에픽
   *  화면 자신이 쓸 때는 줄 자체가 이미 그 화면이라 둘째 문이 없다(§비주얼 §52 ④) */
  memoryHrefFor?: (epic: string) => string;
  locale: Locale;
}) {
  // `전체`(§결정 12) 건수 — 에픽 축 필터가 걸리기 전 큐 전체다. `listEpics`에 항목을 안 더하므로
  // 아래 줄들(NO_EPIC 포함)의 합으로 낸다 — 그래서 수용조건 2가 저절로 참이다.
  const allTotal = epics.reduce((n, e) => n + e.counts.open + e.counts.wip + e.counts.done, 0);
  const allWip = epics.reduce((n, e) => n + e.counts.wip, 0);
  return (
    // `w-full`·`min-h-svh` 기본값을 덮는다(personas-ui.tsx와 같은 처방) — 여기는 형제 열
    // 하나(칸반 또는 표)와 나란한 **한 칸**이지 2단 전체가 아니다.
    <SidebarProvider className="min-h-0 w-auto shrink-0">
      {/* 폭 `w-64`(256)는 레인 하한 288보다 좁다(§52 §폭). 카드도 레일도 아니다 — 층을
          페이지로 내려 필터 입구(툴바)와 한 덩이로 잇는다(§52 §가르는 축) */}
      <Sidebar collapsible="none" className="w-64 shrink-0 border-r bg-background">
        <SidebarContent className="py-2">
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className="h-6 text-muted-foreground">
              {t(locale, "board.epic.label")}
            </SidebarGroupLabel>
            <SidebarMenu aria-label={t(locale, "board.epic.label")} className="gap-0.5">
              {/* `전체`(§결정 12) — 목록 맨 위, `(에픽 없음)`과 한 클래스도 안 다르다. 새 모양을
                  안 고른다: 구분선-여백 0, P번호 없음, 둘째 문 없음. `listEpics`가 안 낳는 값이라
                  `epics.map` 밖에서 따로 그린다. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-auto items-start"
                  isActive={allActive}
                  aria-current={allActive ? "page" : undefined}
                  render={<Link href={allHref} />}
                >
                  <div className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-sm">{t(locale, "board.epic.all")}</span>
                    </span>
                    <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span>{allTotal}건</span>
                      {allWip > 0 && (
                        <span className="ml-auto">
                          {t(locale, "status.label.wip")} {allWip}
                        </span>
                      )}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {epics.map((row) => {
                const isNone = row.epic === NO_EPIC;
                const value = isNone ? "" : row.epic;
                const isActive = active === value;
                const total = row.counts.open + row.counts.wip + row.counts.done;
                return (
                  <SidebarMenuItem key={row.epic}>
                    <SidebarMenuButton
                      className="h-auto items-start"
                      isActive={isActive}
                      aria-current={isActive ? "page" : undefined}
                      render={<Link href={hrefFor(value)} />}
                    >
                      <div className="flex min-w-0 grow flex-col gap-0.5">
                        <span className="flex items-baseline gap-2">
                          {!isNone && (
                            <span className="shrink-0 font-mono text-sm">{row.epic}</span>
                          )}
                          <span className="min-w-0 truncate text-sm">
                            {isNone
                              ? t(locale, "board.epic.none")
                              : `${titles[row.epic] ?? t(locale, "board.epic.noTitle")} (${row.epic})`}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                          <span>{total}건</span>
                          {row.counts.wip > 0 && (
                            <span className="ml-auto">
                              {t(locale, "status.label.wip")} {row.counts.wip}
                            </span>
                          )}
                        </span>
                      </div>
                    </SidebarMenuButton>
                    {/* `(에픽 없음)`은 둘째 문이 없다 — 갈 메모리 디렉터리가 없다(결정 2) */}
                    {!isNone && memoryHrefFor && (
                      <SidebarMenuAction
                        render={
                          <Link href={memoryHrefFor(row.epic)} title={`${row.epic} ${t(locale, "board.epic.memory")}`} />
                        }
                      >
                        <NotebookText aria-hidden className="size-4" />
                        <span className="sr-only">
                          {row.epic} {t(locale, "board.epic.memory")}
                        </span>
                      </SidebarMenuAction>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
