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
import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EpicSidebar } from "@/components/epic-sidebar";
import { EpicMemorySection } from "@/components/epics-ui";
import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { epicMemory, epicReadmeBody, epicTitle, listEpics, NO_EPIC, type EpicMemory } from "@/lib/epics";
import { listTickets } from "@/lib/queue";
import { decodeHash } from "@/lib/urls";
import { getProject, resolveConfig } from "@/lib/projects";

// 큐는 GUI 밖에서도 바뀐다(디스패처 · 세션의 회고) — 굳히지 않는다(personas 화면과 같은 이유).
export const dynamic = "force-dynamic";

export default async function Epics({
  params,
}: {
  params: Promise<{ project: string; epic?: string[] }>;
}) {
  const { project: id, epic: epicSegs } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  const tickets = await listTickets(project.root, config);
  const epics = listEpics(tickets);
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

  // board는 `?epic=`, 이 화면은 경로 — 줄의 목적지가 갈리는 그 prop 하나(§결정 6).
  // `(에픽 없음)`은 이 화면에서도 보드로 나간다 — 갈 화면이 없다(§결정 6).
  const hrefFor = (epic: string) =>
    epic === NO_EPIC
      ? `/p/${id}/?epic=${encodeURIComponent(epic)}`
      : `/p/${id}/epics/${encodeURIComponent(epic)}`;
  const boardHrefFor = (epic: string) => `/p/${id}/?epic=${encodeURIComponent(epic)}`;

  let memories: EpicMemory[] = [];
  let readme: string | null = null;
  if (current) {
    [memories, readme] = await Promise.all([
      epicMemory(project.root, current.epic),
      epicReadmeBody(project.root, current.epic),
    ]);
  }

  return (
    <SidebarProvider className="min-h-0 flex-row gap-6">
      <EpicSidebar epics={epics} titles={titles} active={selected} hrefFor={hrefFor} />

      <div className="min-w-0 grow">
        {realEpics.length === 0 ? (
          <EmptyState text="에픽 없음" />
        ) : requested !== null && current === undefined ? (
          // 404가 아니다 — 왼쪽 목록은 계속 선다(페르소나 화면과 같은 그릇, §비주얼④)
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
                <h1 className="text-lg font-semibold">
                  {titles[current.epic] ?? "제목 없음"} ({current.epic})
                </h1>
                {titles[current.epic] == null && (
                  <Badge variant="outline" title={`epics/${current.epic}/README.md 파일이 없습니다`}>
                    README 없음
                  </Badge>
                )}
              </div>
              <Button variant="outline" nativeButton={false} render={<Link href={boardHrefFor(current.epic)} />}>
                보드에서 보기
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              대기 {current.counts.open} · 진행중 {current.counts.wip} · 완료 {current.counts.done}
            </p>

            {/* README 첫 줄 뒤 본문 — 이 에픽이 무슨 작업인지 사람이 적어 두는 자리(§결정 6).
                제목 줄은 위 머리가 이미 그렸으니 여기는 본문뿐이다. */}
            {readme ? (
              <div className="max-w-3xl">
                <Markdown text={readme} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">epics/{current.epic}/README.md</span> 첫 줄 뒤에 적으면
                여기 뜹니다.
              </p>
            )}

            <EpicMemorySection projectId={id} epic={current.epic} memories={memories} />
          </div>
        ) : null}
      </div>
    </SidebarProvider>
  );
}
