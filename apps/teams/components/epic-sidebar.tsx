/** 보드 왼쪽 에픽 사이드바 (DESIGN.md §에픽 결정 5 · §비주얼 §52 ①② · 접힘은 결정 13 · §52 ⑦).
 *
 *  **에픽 화면(§결정 6, `36e431d9`)이 같은 컴포넌트를 쓴다** — 갈리는 것은 링크 목적지 하나다
 *  (§52 ④ "같은 컴포넌트 … 갈리는 것은 prop 하나"). 지금 이 티켓은 보드 쪽 `hrefFor`
 *  (`?epic=<값>`)만 채운다.
 *
 *  서버 컴포넌트다 — 목록도 제목도 페이지가 이미 읽은 값을 그대로 받는다(새 클라이언트 상태 ·
 *  새 폴링 · 새 스켈레톤 0개, §52 §로딩). */
import Link from "@/components/link";
import { NotebookText, PanelLeft } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { EpicCreateButton } from "@/components/epic-sidebar-create";
import { EpicRowPanel } from "@/components/epic-sidebar-panel";
import { NO_EPIC, suggestEpicKey, type Epic } from "@/lib/epics";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WorkerChips } from "@/components/worker-mark";

/** 사이드바 슬롯 예산(§비주얼 §52 ⑥) — 214px 자리에 셋이 18%를 남긴다. 넷째부터 `+n` */
const WORKER_CHIP_CAP = 3;

export function EpicSidebar({
  projectId,
  epics,
  titles,
  active,
  hrefFor,
  allHref,
  allActive,
  memoryHrefFor,
  collapsed = false,
  toggleHref,
  locale,
}: {
  /** 만들기 입구가 부르는 서버 액션에 넘긴다(§에픽 결정 17) — 사이드바에 새로 느는 프롭 하나 */
  projectId: string;
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
  /** `?sidebar=off`(§에픽 결정 13 · §비주얼 §52 ⑦). 없거나 모르는 값이면 펼침 — 판정은
   *  호출하는 페이지가 이미 했다(`sp.get("sidebar") === "off"`) */
  collapsed?: boolean;
  /** 지금 상태를 뒤집는 링크 — 펼침이면 `?sidebar=off`를 더한 URL, 접힘이면 그 파라미터를
   *  뺀 URL. 글리프 하나가 두 방향을 다 내므로(§52 ⑦) 링크도 하나다 */
  toggleHref: string;
  locale: Locale;
}) {
  // `전체`(§결정 12) 건수 — 에픽 축 필터가 걸리기 전 큐 전체다. `listEpics`에 항목을 안 더하므로
  // 아래 줄들(NO_EPIC 포함)의 합으로 낸다 — 그래서 수용조건 2가 저절로 참이다.
  const allTotal = epics.reduce((n, e) => n + e.counts.open + e.counts.wip + e.counts.done, 0);
  const allWip = epics.reduce((n, e) => n + e.counts.wip, 0);
  // 접힌 컨트롤(펴기)과 펼친 컨트롤(접기)은 글리프 하나가 두 방향을 다 낸다(§52 ⑦) — 자리도
  // 같다: `SidebarGroupLabel`이 뜨는 그 행(`h-6`·`px-2`). `ml-auto`는 결정 17이 만들기로
  // 옮긴다(§52 ⑩) — 둘째 컨트롤이 뜨면서 그 자리가 만들기·접기 **쌍**의 앞쪽으로 간다.
  const toggle = (
    <Button
      variant="ghost"
      size="icon-xs"
      nativeButton={false}
      className="text-muted-foreground"
      title={t(locale, collapsed ? "board.epic.expand" : "board.epic.collapse")}
      render={<Link href={toggleHref} />}
    >
      <PanelLeft aria-hidden className="size-4" />
      <span className="sr-only">{t(locale, collapsed ? "board.epic.expand" : "board.epic.collapse")}</span>
    </Button>
  );
  // 만들기 입구의 키 제안(§에픽 결정 17 §키 제안) — 목록의 `P<숫자>` 최댓값 + 1.
  const suggestedKey = suggestEpicKey(epics);
  return (
    // `w-full`·`min-h-svh` 기본값을 덮는다(personas-ui.tsx와 같은 처방) — 여기는 형제 열
    // 하나(칸반 또는 표)와 나란한 **한 칸**이지 2단 전체가 아니다.
    <SidebarProvider className="min-h-0 w-auto shrink-0">
      {/* 폭 `w-64`(256)는 레인 하한 288보다 좁다(§52 §폭). 카드도 레일도 아니다 — 층을
          페이지로 내려 필터 입구(툴바)와 한 덩이로 잇는다(§52 §가르는 축). 접히면 갈리는
          클래스는 `w-64` -> `w-10` 하나뿐이다 — 층-변-그릇은 이 한 자리에서 그대로 나온다(§52 ⑦). */}
      <Sidebar
        collapsible="none"
        className={cn(collapsed ? "w-10" : "w-64", "shrink-0 border-r bg-background")}
      >
        <SidebarContent className="py-2">
          {collapsed ? (
            // 접힌 띠(§비주얼 §52 ⑦) — `SidebarGroup` 이하가 통째로 안 그려진다. 남는 것은
            // 펴는 링크 하나뿐이다.
            <div className="flex h-6 items-center px-2">{toggle}</div>
          ) : (
            <SidebarGroup className="p-0">
              {/* 드래그 중 "놓을 에픽을 고릅니다"로 갈리는 자리(§비주얼 §52 ⑤ (2)) —
                  `board-ui.tsx`의 `EpicDrag`가 이 속성으로 찾는다. 표식은 **행이 아니라 낱말을
                  감싸는 span**에 붙는다(§52 ⑩ §함정) — 만들기의 `DialogTrigger`가 이 행에 뜨면서
                  `innerHTML` 왕복(드래그 시작/끝)에 그 컨트롤이 갈리지 않아야 한다. 왕복이 행
                  전체를 갈아 끼우면 React 핸들러를 든 버튼이 되돌아온 뒤 죽는다. */}
              <SidebarGroupLabel className="h-6 gap-1 text-muted-foreground">
                <span data-epic-group-label>{t(locale, "board.epic.label")}</span>
                <EpicCreateButton projectId={projectId} locale={locale} suggestedKey={suggestedKey} />
                {toggle}
              </SidebarGroupLabel>
              <SidebarMenu aria-label={t(locale, "board.epic.label")} className="gap-0.5">
                {/* `전체`(§결정 12) — 목록 맨 위, 에픽 값 줄과 한 클래스도 안 다르다. 새 모양을
                    안 고른다: 구분선-여백 0, P번호 없음, 둘째 문 없음. `listEpics`가 안 낳는 값이라
                    `epics.map` 밖에서 따로 그린다.
                    걷힌 `(에픽 없음)` 줄이 물던 드롭 과녁을 물려받는다(§에픽 결정 18 · §비주얼
                    §52 ⑤ (2)-(3)) — `data-epic-drop=""`가 <에픽에서 뺀다>는 그 빈 값이고,
                    `data-epic-ring` · `data-epic-line`은 에픽 줄이 쓰는 그 표식 그대로다. */}
                <SidebarMenuItem data-epic-drop="">
                  <SidebarMenuButton
                    data-epic-ring
                    className="h-auto items-start"
                    isActive={allActive}
                    aria-current={allActive ? "page" : undefined}
                    render={<Link href={allHref} />}
                  >
                    <div className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate text-sm">{t(locale, "board.epic.all")}</span>
                      </span>
                      <span
                        data-epic-line
                        className="flex items-baseline gap-2 text-xs text-muted-foreground"
                      >
                        <span>
                          {allTotal}
                          {t(locale, "epicSidebar.unit.count")}
                        </span>
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
                  if (isNone) return null; // §에픽 결정 18 — 이 목록에서 걷힌다. `전체`가 과녁을 물려받는다
                  const value = row.epic;
                  const isActive = active === value;
                  const total = row.counts.open + row.counts.wip + row.counts.done;
                  return (
                    // 드롭이 받는 상자는 이 줄 전체다(§비주얼 §52 ⑤ — 둘째 문 위도 같은 줄이다).
                    <SidebarMenuItem key={row.epic} data-epic-drop={value}>
                      <EpicRowPanel
                        trigger={
                          <SidebarMenuButton
                            data-epic-ring
                            className="h-auto items-start"
                            isActive={isActive}
                            aria-current={isActive ? "page" : undefined}
                            render={<Link href={hrefFor(value)} />}
                          >
                            <div className="flex min-w-0 grow flex-col gap-0.5">
                              <span className="flex items-baseline gap-2">
                                <span className="min-w-0 truncate text-sm">
                                  {titles[row.epic] ?? t(locale, "board.epic.noTitle")}
                                </span>
                                {/* P번호 등급(§에픽 결정 11 · §비주얼 §52 ②) — 라벨보다 크지도 두껍지도
                                    않다. `font-normal`을 여기서 지정해야 선택 줄의 `font-medium` 상속을 끊는다. */}
                                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                  ({row.epic})
                                </span>
                              </span>
                              {/* 드래그 중 "놓으면 이 에픽으로" 문장이 이 슬롯에 대신 든다(§52 ⑤ (3)) */}
                              <span
                                data-epic-line
                                className="flex items-baseline gap-2 text-xs text-muted-foreground"
                              >
                                <span>
                                  {total}
                                  {t(locale, "epicSidebar.unit.count")}
                                </span>
                                {row.counts.wip > 0 && (
                                  // 칩이 뜨면 `진행중 n`을 걷는다(§에픽 결정 14 - §52 ②) - 워커 칩과
                                  // 폴백 글자는 같은 사실의 두 모양이라 한 줄에 하나만 뜬다.
                                  <span className="ml-auto flex items-baseline gap-1">
                                    {row.workers.length === 0 && (
                                      <span>
                                        {t(locale, "status.label.wip")} {row.counts.wip}
                                      </span>
                                    )}
                                    <WorkerChips names={row.workers} cap={WORKER_CHIP_CAP} locale={locale} />
                                  </span>
                                )}
                              </span>
                            </div>
                          </SidebarMenuButton>
                        }
                      >
                        {/* 패널 1행 — 제목 전문 + P번호(§52 ⑨ §내용 넷의 배치) */}
                        <p className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span>{titles[row.epic] ?? t(locale, "board.epic.noTitle")}</span>
                          <span className="shrink-0 text-xs font-normal text-muted-foreground">
                            ({row.epic})
                          </span>
                        </p>
                        {/* 패널 2행 — 건수 셋. 0도 적는다(접힌 2행과 갈리는 규칙) */}
                        <p className="text-xs text-muted-foreground">
                          {t(locale, "status.label.open")} {row.counts.open} ·{" "}
                          {t(locale, "status.label.wip")} {row.counts.wip} ·{" "}
                          {t(locale, "status.label.done")} {row.counts.done}
                        </p>
                        {/* 패널 3행 — 워커 전부. cap 없음, 0명이면 줄이 통째로 안 뜬다 */}
                        {row.workers.length > 0 && (
                          <div className="flex flex-wrap items-baseline gap-2">
                            <WorkerChips names={row.workers} locale={locale} />
                          </div>
                        )}
                        {/* 패널 4행 — 상세 문(넓은 문) */}
                        {memoryHrefFor && (
                          <Button
                            variant="outline"
                            nativeButton={false}
                            className="w-full justify-start"
                            render={<Link href={memoryHrefFor(row.epic)} />}
                          >
                            <NotebookText aria-hidden className="size-4" />
                            {row.epic} {t(locale, "board.epic.memory")}
                          </Button>
                        )}
                      </EpicRowPanel>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
