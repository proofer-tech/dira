/** 에픽 화면 `/p/<project>/epics[/<P번호>]` (DESIGN.md §에픽 §결정 6 · §비주얼 §52 ④).
 *
 *  **새 화면 종류가 아니다** — 페르소나 화면(`personas/[[...persona]]`)과 같은 optional
 *  catch-all이다: 세그먼트 없는 자리에서 리다이렉트하지 않고 목록 첫 실제 에픽으로 떨어진다
 *  (선택이 경로에 담긴다, §5와 같은 규약). **오른쪽에 두 번째 칸반은 없다** — *각 에픽 보드*는
 *  `?epic=` 필터가 걸린 그 보드이고, `보드에서 보기` 링크 하나가 데려간다.
 *
 *  **`(에픽 없음)`은 이 화면에 서지 않는다** — `epics/<P번호>/` 사이드카가 없는 자리라 오른쪽에
 *  그릴 것이 0이다. 사이드바의 그 줄만 목적지가 보드다(§결정 6). 어떤 티켓도 안 쓰는 값으로
 *  들어오면 404가 아니라 페르소나 화면과 같은 `Alert`("이 경로는 열 수 없습니다") — 에픽은
 *  티켓이 만들고 사라질 수 있다. */
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EpicSidebar } from "@/components/epic-sidebar";
import { EpicMemorySection, EpicReadmeEditButton } from "@/components/epics-ui";
import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkerChips } from "@/components/worker-mark";
import {
  epicMemory,
  epicReadmeBody,
  epicTitle,
  listEpics,
  NO_EPIC,
  resolveMarkdownRefs,
  type EpicMemory,
} from "@/lib/epics";
import { t } from "@/lib/i18n";
import { epicOf, listTickets } from "@/lib/queue";
import { epicCostChunk } from "@/lib/usage";
import { decodeHash } from "@/lib/urls";
import { getProject, readLanguage, resolveConfig } from "@/lib/projects";

// 큐는 GUI 밖에서도 바뀐다(디스패처 · 세션의 회고) — 굳히지 않는다(personas 화면과 같은 이유).
export const dynamic = "force-dynamic";

export default async function Epics({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; epic?: string[] }>;
  searchParams: Promise<{ sidebar?: string }>;
}) {
  const { project: id, epic: epicSegs } = await params;
  const { sidebar } = await searchParams;
  // `?sidebar=off`(§에픽 결정 13 · §비주얼 §52 ⑦) — 없거나 모르는 값이면 펼침. 이 화면은
  // 세그먼트마다 **다른 경로**라(catch-all) 각 링크가 이 값을 직접 실어야 접힌 채로 남는다
  // (보드는 `sp` 통째 복사로 저절로지만 여기는 그 그릇이 없다).
  const sidebarOff = sidebar === "off";
  const sidebarSuffix = sidebarOff ? "?sidebar=off" : "";
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  const locale = await readLanguage();
  const tickets = await listTickets(project.root, config);
  const epics = await listEpics(project.root, tickets);
  // `(에픽 없음)`은 고를 대상이 아니다 — 메모리 사이드카가 없는 값이다(§결정 6).
  const realEpics = epics.filter((e) => e.epic !== NO_EPIC);

  const titles = Object.fromEntries(
    await Promise.all(
      realEpics.map(async (e) => [e.epic, await epicTitle(project.root, e.epic)] as const),
    ),
  );

  // 세그먼트가 없으면 목록 첫 실제 에픽이다(§5 §선택이 경로에 담긴다 ①과 같은 규약).
  // 있는데 목록에 없으면(가짜 값 · 닫혀서 티켓이 하나도 안 남은 값) 아래 Alert로 갈린다.
  const requested = epicSegs?.map(decodeHash).join("/") ?? null;
  const selected = requested ?? realEpics[0]?.epic ?? null;
  const current = selected === null ? undefined : realEpics.find((e) => e.epic === selected);

  // `EpicSidebar`의 값 규약과 같다 — `""`는 `(에픽 없음)`(board.ts `epicHref`와 같은 값).
  // board는 `?epic=`, 이 화면은 경로 — 줄의 목적지가 갈리는 그 prop 하나(§결정 6).
  // `(에픽 없음)`은 이 화면에서도 보드로 나간다 — 갈 화면이 없다(§결정 6).
  // 셋 다 `sidebarSuffix`를 싣는다 — 접힌 채로 줄을 눌러도 접힌 채로 남는다(§비주얼 §52 ⑦).
  const hrefFor = (value: string) =>
    value === ""
      ? `/p/${id}/?epic=${encodeURIComponent(value)}${sidebarOff ? "&sidebar=off" : ""}`
      : `/p/${id}/epics/${encodeURIComponent(value)}${sidebarSuffix}`;
  const boardHrefFor = (epic: string) =>
    `/p/${id}/?epic=${encodeURIComponent(epic)}${sidebarOff ? "&sidebar=off" : ""}`;
  // 지금 경로(세그먼트 그대로) — 토글 링크가 목록 선택은 안 건드리고 `sidebar` 하나만 뒤집는다.
  const epicPath = `/p/${id}/epics${epicSegs?.length ? `/${epicSegs.map(encodeURIComponent).join("/")}` : ""}`;
  const sidebarToggleHref = sidebarOff ? epicPath : `${epicPath}?sidebar=off`;

  let memories: EpicMemory[] = [];
  let readme: string | null = null;
  let costText: string | null = null;
  if (current) {
    [memories, readme, costText] = await Promise.all([
      epicMemory(project.root, current.epic),
      epicReadmeBody(project.root, current.epic),
      // 토큰량 덩이(§비주얼 §63 ①⑤) — 이 에픽 티켓들의 해시 전부. 이미 읽은 `tickets`에서
      // 거른다(새 스캔 0) — `epicOf`가 없는 티켓엔 `""`을 주므로 `(에픽 없음)`은 여기 안 온다
      // (`current`가 `realEpics`에서만 나오므로 `""`와 안 겹친다).
      epicCostChunk(project.root, tickets.filter((tk) => epicOf(tk) === current.epic).map((tk) => tk.hash)),
    ]);
  }
  // 산문 속 해시-P번호 표식(§9) — README 본문 한 조각만 훑는다. `readme`가 null이면 안 부른다.
  const refs = readme ? await resolveMarkdownRefs(project.root, id, [readme], tickets, epics) : undefined;

  return (
    // `EpicSidebar`가 자기 `SidebarProvider`를 이미 든다(§52 ①) — 여기는 형제 열 하나와
    // 나란한 플렉스 행이면 된다(보드의 `flex min-h-0 flex-1 gap-6`와 같은 값).
    <div className="flex min-h-0 gap-6">
      <EpicSidebar
        projectId={id}
        epics={epics}
        titles={titles}
        active={current?.epic ?? null}
        hrefFor={hrefFor}
        allHref={`/p/${id}${sidebarSuffix}`}
        allActive={false}
        collapsed={sidebarOff}
        toggleHref={sidebarToggleHref}
        locale={locale}
      />

      <div className="min-w-0 grow">
        {realEpics.length === 0 ? (
          <EmptyState text={t(locale, "epics.empty")} />
        ) : requested !== null && current === undefined ? (
          // 404가 아니다 — 왼쪽 목록은 계속 뜬다(페르소나 화면과 같은 그릇, §비주얼④)
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>이 경로는 열 수 없습니다</AlertTitle>
            <AlertDescription>
              <span className="font-mono text-xs break-all">{requested}</span>
            </AlertDescription>
          </Alert>
        ) : current ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-baseline gap-2">
                {/* P번호 등급(§에픽 결정 11 · §비주얼 §52 ④) — `h1` 안의 별 요소, 라벨보다
                    한 등급 아래. 빠짐 표식은 종전대로 `h1` 밖(제목이 아니다) */}
                <h1 className="flex items-baseline gap-2 text-lg font-semibold">
                  <span>{titles[current.epic] ?? t(locale, "board.epic.noTitle")}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    ({current.epic})
                  </span>
                </h1>
                {titles[current.epic] == null && (
                  <Badge variant="outline">{t(locale, "epics.readme.missingBadge")}</Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <EpicReadmeEditButton
                  projectId={id}
                  epic={current.epic}
                  locale={locale}
                  initialTitle={titles[current.epic] ?? ""}
                  initialBody={readme ?? ""}
                />
                <Button variant="outline" nativeButton={false} render={<Link href={boardHrefFor(current.epic)} />}>
                  {t(locale, "epics.viewInBoard")}
                </Button>
              </div>
            </div>

            {/* 완료 N 뒤 워커 칩, 그 뒤 토큰량 덩이 — 안 자른다, 넘치면 줄이 는다(§비주얼 §52 ⑥-3 ·
                §63 ⑤). 토큰량이 칩 앞이 아니라 뒤인 이유: 칩은 `진행중 N`의 누구고, 토큰량을 그
                사이에 끼우면 수와 이름이 떨어져 사람이 둘을 따로 읽는다(§63 ⑤). */}
            <p className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
              <span>
                대기 {current.counts.open} · 진행중 {current.counts.wip} · 완료 {current.counts.done}
              </span>
              <WorkerChips names={current.workers} locale={locale} />
              {costText && <span>{costText}</span>}
            </p>

            {/* README 첫 줄 뒤 본문 — 이 에픽이 무슨 작업인지 사람이 적어 두는 자리(§결정 6).
                제목 줄은 위 머리가 이미 그렸으니 여기는 본문뿐이다. */}
            {readme ? (
              <div className="max-w-3xl">
                <Markdown text={readme} locale={locale} refs={refs} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">epics/{current.epic}/README.md</span>{" "}
                {t(locale, "epics.readme.hint")}
              </p>
            )}

            <EpicMemorySection projectId={id} epic={current.epic} memories={memories} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
