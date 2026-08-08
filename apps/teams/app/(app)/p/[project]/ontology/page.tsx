/** 온톨로지 `/p/<project>/ontology` — 파일트리 + 원문 에디터 (DESIGN.md §5-3 §온톨로지 빌더 §화면).
 *
 *  `protocols/page.tsx`의 판박이다 — 프로토콜 화면이 이미 «기준 디렉터리 + 파일트리 사이드바 +
 *  원문 에디터 + `?file=` URL 상태»라는 완성된 관용구라서다. **기준 디렉터리는
 *  `ontologyDir(project)` 고정이다** — 엔진이 `ONTDIR`을 `$TICKET_ROOT/ontology`로 하드코딩해서
 *  `TICKET_PROTOCOLS`처럼 워커가 재정의할 길이 없다.
 *
 *  코어 프로토콜(`readCore`)·`AGENTS.md` 인라인 배지 같은 프로토콜 전용 개념은 없다 — 온톨로지가
 *  세션 프롬프트에 싣는 것은 위치 + 검색 방법뿐인 상수 블록이고(§5-2), 본문은 항상 세션이 필요할
 *  때 직접 읽는다. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Folder, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { NewOntologyFileButton, OntologyEditor } from "@/components/ontology-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { listTree, readTextFile, type ProtocolFile } from "@/lib/protocols";
import { getProject, ontologyDir } from "@/lib/projects";

// 온톨로지도 세션이 GUI 밖에서 고친다 — 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

export default async function Ontology({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { project: id } = await params;
  const { file } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  const base = ontologyDir(project);
  const tree = await listTree(base);

  // `file`은 사용자 입력이다 — 서버에서 기준 디렉터리 안인지 확인한다. 밖이면 404가 아니라
  // 거부 사유를 그대로 보여준다(§6 에러 3요소).
  let selected: ProtocolFile | null = null;
  let rejected: string | null = null;
  if (file) {
    try {
      selected = await readTextFile(base, file);
    } catch (e) {
      rejected = (e as Error).message;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">온톨로지</h1>
          <p className="font-mono text-xs break-all text-muted-foreground">{base}</p>
        </div>
        {tree.length > 0 && <NewOntologyFileButton projectId={id} />}
      </div>

      {tree.length === 0 && (
        // §5-3 §생성 — 온톨로지 없이 도는 프로젝트가 정상이다: 여기서 디렉터리를 만들지 않는다.
        <div className="max-w-3xl space-y-3">
          <EmptyState
            text="온톨로지가 아직 없습니다"
            action={<NewOntologyFileButton projectId={id} variant="outline" />}
          />
          <p className="text-sm text-muted-foreground">
            온톨로지가 없어도 이 프로젝트는 돕니다 — <span className="font-mono text-xs">tick.sh</span>는{" "}
            <span className="font-mono text-xs">ontology/</span>가 비어 있으면 그냥 넘어갑니다. 세션이
            이 프로젝트의 축적된 지식(객체·관계)을 모른 채 시작할 뿐입니다.
          </p>
        </div>
      )}

      {tree.length > 0 && (
        // §비주얼 §34 ① — 이 행 자신이 `SidebarProvider`다(`Sidebar`가 `collapsible="none"`에서도
        // `useSidebar()`를 무조건 부른다). `min-h-0`이 기본 `min-h-svh`를 덮는다.
        <SidebarProvider className="min-h-0 flex-col gap-6 lg:flex-row">
          <Sidebar
            collapsible="none"
            role="navigation"
            aria-label="온톨로지 파일"
            className="w-full shrink-0 rounded-lg border bg-surface lg:w-80"
          >
            <SidebarContent className="py-2">
              <SidebarGroup className="p-0">
                <SidebarMenu className="gap-0.5">
                  {tree.map((e) =>
                    e.isDir ? (
                      <SidebarMenuItem key={e.rel}>
                        <div
                          className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground"
                          style={{ paddingLeft: `${e.depth * 0.75 + 0.5}rem` }}
                        >
                          <Folder aria-hidden className="size-3.5 shrink-0" />
                          <span className="font-mono break-all">{e.name}</span>
                        </div>
                      </SidebarMenuItem>
                    ) : (
                      <SidebarMenuItem key={e.rel}>
                        <SidebarMenuButton
                          size="sm"
                          className={ROW}
                          isActive={e.rel === selected?.rel}
                          aria-current={e.rel === selected?.rel ? "page" : undefined}
                          render={
                            <Link href={`/p/${id}/ontology?file=${encodeURIComponent(e.rel)}`} />
                          }
                          style={{ paddingLeft: `${e.depth * 0.75 + 0.5}rem` }}
                        >
                          <FileText
                            aria-hidden
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="font-mono break-all">{e.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ),
                  )}
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <div className="min-w-0 grow">
            {rejected ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>이 경로는 열 수 없습니다</AlertTitle>
                <AlertDescription>
                  <span className="font-mono text-xs break-all">{rejected}</span>
                </AlertDescription>
              </Alert>
            ) : !selected ? (
              <p className="text-sm text-muted-foreground">왼쪽에서 파일을 고르세요.</p>
            ) : selected.text === null ? (
              <Alert>
                <TriangleAlert aria-hidden className="text-status-stale" />
                <AlertTitle>
                  <span className="font-mono break-all">{selected.rel}</span>
                </AlertTitle>
                <AlertDescription>{selected.reason}</AlertDescription>
              </Alert>
            ) : (
              <OntologyEditor key={selected.rel} projectId={id} rel={selected.rel} initial={selected.text} />
            )}
          </div>
        </SidebarProvider>
      )}
    </div>
  );
}

/** 트리 줄 클래스 — `protocols/page.tsx`의 `ROW`와 같은 값. 근거는 그 파일 주석에 있다
 *  (§34 판정표의 `안 바꾸는 값`들: `h-auto min-h-8` · `py-1` · `gap-1.5` · 아이콘 `size-3.5` ·
 *  파일명 줄바꿈). 두 화면이 같은 트리 관용구를 쓰므로 값도 같다. */
const ROW = "h-auto min-h-8 gap-1.5 py-1 [&_svg]:size-3.5 [&>span:last-child]:whitespace-normal";
