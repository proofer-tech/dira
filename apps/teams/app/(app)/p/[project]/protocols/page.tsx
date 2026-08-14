/** 프로토콜 `/p/<project>/protocols` — 파일트리 + 원문 에디터 (DESIGN.md §6).
 *
 *  **`<루트>/protocols`를 가정하지 않는다.** 엔진이 `TICKET_PROTOCOLS`로 재정의를 열어뒀고
 *  (README 용례: 여러 큐가 같은 규약을 쓰면 공유 경로로 준다), 그러면 이 디렉터리는 루트 밖이다.
 *  기준은 `resolveConfig(project).protocols` 하나뿐이고, 경로 방어의 접두도 그 디렉터리다.
 *
 *  선택 파일은 URL `?file=`이 담는다 — 새로고침·공유가 공짜고 클라이언트 상태가 필요 없다. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Folder, Lock, PanelLeft, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InlineBadge, NewFileButton, ProtocolEditor } from "@/components/protocols-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CORE_INLINED,
  listTree,
  readCore,
  readTextFile,
  type CoreFile,
  type ProtocolFile,
} from "@/lib/protocols";
import { getProject, resolveConfig, usingDefault } from "@/lib/projects";

// 프로토콜 파일은 세션이 GUI 밖에서 고친다 — 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

export default async function Protocols({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ file?: string; core?: string; sidebar?: string }>;
}) {
  const { project: id } = await params;
  const { file, core: wantCore, sidebar } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  // `?sidebar=on`(§6 §파일트리 사이드바 둘이 접힌다) — 없거나 모르는 값이면 접힘(기본값).
  const expanded = sidebar === "on";
  // 트리 링크가 나르는 값 — 편 상태가 파일 고르기를 지나 유지된다(계약).
  const sidebarQuery = expanded ? "&sidebar=on" : "";
  const toggleLabel = expanded ? "파일 목록 접기" : "파일 목록 펴기";
  // 지금 URL에서 `sidebar`만 뒤집는다 — `?file=`/`?core=`는 한 개도 안 잃는다(계약).
  const toggleHref = (() => {
    const usp = new URLSearchParams();
    if (wantCore !== undefined) usp.set("core", wantCore);
    if (file) usp.set("file", file);
    if (!expanded) usp.set("sidebar", "on");
    const qs = usp.toString();
    return `/p/${id}/protocols${qs ? `?${qs}` : ""}`;
  })();
  // §비주얼 §53 — §52 ⑦(`epic-sidebar.tsx:74-85`)과 같은 그릇, `title` 대신 툴팁(⑧).
  const toggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            nativeButton={false}
            className="ml-auto text-muted-foreground"
            render={<Link href={toggleHref} />}
          >
            <PanelLeft aria-hidden className="size-4" />
            <span className="sr-only">{toggleLabel}</span>
          </Button>
        }
      />
      <TooltipContent side="right">{toggleLabel}</TooltipContent>
    </Tooltip>
  );

  const config = await resolveConfig(project);
  const tree = await listTree(config.protocols);

  // 코어는 읽기 전용이라 `?file=`(기준 디렉터리 상대경로)에 실을 수 없다 — 별도 `?core=<파일명>`
  // 이다. 못 읽으면 트리에서 항목만 빠진다(§프롬프트 층 결정 5·6). vendored 큐(큐
  // `protocols/CORE.md`가 있는 큐)에서는 세션이 실제로 받는 큐 사본을 읽는다(결정 8-d) —
  // `listTree`가 그 이름들을 편집 가능 목록에서 빼는 것과 같은 판정을 쓴다.
  const core = await readCore(config.protocols);
  const coreFiles = "files" in core ? core.files : [];
  const coreVendored = "vendored" in core && core.vendored;
  // `core`도 사용자 입력이지만 **경로로 조립하지 않는다** — 실제로 나열해 나온 이름과 맞춰만 본다.
  const openedCore = wantCore === undefined ? null : coreFiles.find((f) => f.name === wantCore);

  // `file`은 사용자 입력이다 — 서버에서 기준 디렉터리 안인지 확인한다. 밖이면 404가 아니라
  // 거부 사유를 그대로 보여준다(§6 에러 3요소: 무엇이 왜 거부됐는지 삼키지 않는다).
  let selected: ProtocolFile | null = null;
  let rejected: string | null = null;
  if (wantCore !== undefined) {
    // 항목이 안 보이는데 URL로 들어온 경우다 — 사유를 삼키지 않는다.
    if (!openedCore) {
      rejected = "error" in core ? core.error : `코어 프로토콜에 없는 파일입니다: ${wantCore}`;
    }
  } else if (file) {
    try {
      selected = await readTextFile(config.protocols, file);
    } catch (e) {
      rejected = (e as Error).message;
    }
  } else {
    // 기본 선택 = 루트 `AGENTS.md`(§6). 인라인되는 유일한 파일이라 여기서 제일 많이 열고,
    // 리다이렉트 대신 서버가 고른다 — `?file=`은 명시 선택만 담는다. 없으면 안내 문구로
    // 떨어진다(트리 첫 파일 같은 임의 대체를 넣지 않는다). 거부 사유가 없으니 Alert도 없다.
    selected = await readTextFile(config.protocols, "AGENTS.md").catch(() => null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">프로토콜</h1>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {config.protocols}
            {usingDefault(config, "protocols") && (
              <span className="ml-2 font-sans">기본값 가정</span>
            )}
          </p>
        </div>
        {tree.length > 0 && <NewFileButton projectId={id} />}
      </div>

      {usingDefault(config, "protocols") && (
        // 워커에서 TICKET_PROTOCOLS를 못 얻었다(없거나 해석 실패) = 엔진의
        // `${TICKET_PROTOCOLS:-$TICKET_ROOT/protocols}` 기본값을 쓴다는 뜻이다.
        // 둘을 가르는 화면은 §7 해석 결과 표 하나다 — 여기는 "기본값을 본다"는 사실만 필요하다.
        <p className="max-w-3xl text-sm text-muted-foreground">
          워커 파일에서 <span className="font-mono text-xs">TICKET_PROTOCOLS</span>를 읽지 못해 엔진 기본값
          (<span className="font-mono text-xs">&lt;루트&gt;/protocols</span>)으로 봅니다. 워커에서
          다른 경로로 재정의하면 이 화면도 그 경로를 따라갑니다.
        </p>
      )}

      {tree.length === 0 && (
        <div className="max-w-3xl space-y-3">
          <EmptyState text="파일 없음" action={<NewFileButton projectId={id} variant="outline" />} />
          <p className="text-sm text-muted-foreground">
            프로토콜이 없어도 이 프로젝트는 돕니다 — <span className="font-mono text-xs">tick.sh</span>는{" "}
            <span className="font-mono text-xs">AGENTS.md</span>가 없으면 그냥 넘어갑니다. 세션이
            협업 규약(티켓 분류별 처리·핸드오프·보고)을 모른 채 시작할 뿐입니다.
          </p>
        </div>
      )}

      {/* 프로젝트 파일이 하나도 없어도 코어는 매 세션에 실린다 — 그때도 볼 자리를 남긴다 */}
      {(tree.length > 0 || coreFiles.length > 0) && (
        // **이 행 자신이 `SidebarProvider`다**(§비주얼 §34 ①) — `Sidebar`가 `collapsible="none"`
        // 에서도 `useSidebar()`를 무조건 부르므로 Provider가 있어야 하는데, Provider가 내는 것도
        // `flex` `div` 하나라 **새 요소가 0개다.** `layout.tsx`에 세우지 않는 이유는 2단이 없는
        // 다섯 화면에도 그 `div`가 얹혀서다(§34 §범위). **`min-h-0`이 기본 `min-h-svh`를 덮는다** —
        // 안 덮으면 이 화면 아래로 빈 뷰포트 높이가 생긴다.
        <SidebarProvider className="min-h-0 flex-col gap-6 lg:flex-row">
          {/* 트리 — 서버 렌더 링크. 들여쓰기가 중첩을 그린다(트리 컴포넌트를 만들지 않는다).
              **면이 선다**(§34 ④ — 가로 형제 · 경계 확정 · 종류가 다른 쌍에서 목록 쪽이 든다):
              `bg-surface`+`border`+`rounded-lg`. `bg-sidebar`를 덮는 이유는 그 토큰이 다크에서
              `--card`(0.205)라 카드가 면 위에서 사라져서다(§34 ②).
              **랜드마크가 `<nav>` 태그에서 이 `role`/`aria-label`로 옮겼다** — 부품에 `render`가
              없어 태그를 못 바꾸고, 새 요소는 0개다.
              **폭은 `--sidebar-width`가 아니라 className이 든다** — 좁은 폭에서 `w-full`이어야
              하는데 CSS 변수로는 브레이크포인트를 못 준다(§34 ①). */}
          <Sidebar
            collapsible="none"
            role="navigation"
            aria-label="프로토콜 파일"
            className={`w-full shrink-0 rounded-lg border bg-surface ${expanded ? "lg:w-80" : "lg:w-10"}`}
          >
            {/* `py-2`가 면의 세로 패딩. 그룹이 하나뿐이라 그룹 사이 `gap`은 덮을 것이 없다.
                가로 패딩은 0이다(`SidebarGroup p-0`) — 줄이 자기 `px-2`로 그 8px을 이미 든다. */}
            <SidebarContent className="py-2">
              <SidebarGroup className="p-0">
                {/* 머리 행 — 접힘·펼침 공통(§비주얼 §53). 낱말은 원래 0개라 접혀도 잃을 게 없다. */}
                <div className="flex h-6 items-center pr-2">{toggle}</div>
                {expanded && (
                  // `SidebarGroupLabel`이 없다 — 이 패널은 머리 낱말이 원래 0개다(§34 판정표).
                  // 줄 사이 `space-y-0.5` → 부품의 `gap-0.5`.
                  <SidebarMenu className="gap-0.5">
                    {/* 맨 위 · 자물쇠 · 편집 없음. 큐 밖 파일이라 `?file=`이 아니다.
                        배지는 인라인되는 `CORE.md`에만 — 나머지는 프로젝트 층의 비인라인 파일과
                        같이 트리에서 배지가 없다(§프롬프트 층 결정 6 배지 표). */}
                    {coreFiles.map((f) => (
                      <SidebarMenuItem key={f.name}>
                        <SidebarMenuButton
                          size="sm"
                          className={ROW}
                          isActive={f.name === openedCore?.name}
                          aria-current={f.name === openedCore?.name ? "page" : undefined}
                          render={
                            <Link
                              href={`/p/${id}/protocols?core=${encodeURIComponent(f.name)}${sidebarQuery}`}
                            />
                          }
                        >
                          <Lock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-mono break-all">{f.name}</span>
                          {f.name === CORE_INLINED && <InlineBadge chars={[...f.text].length} />}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                    {tree.map((e) =>
                      e.isDir ? (
                        // 디렉터리 줄은 `SidebarMenuItem` 안의 `div` 그대로다(§34 판정표) —
                        // 누를 수 없는 줄에 `<button>`을 세우면 탭 정거장이 는다.
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
                              <Link
                                href={`/p/${id}/protocols?file=${encodeURIComponent(e.rel)}${sidebarQuery}`}
                              />
                            }
                            // 중첩은 평면 목록 + 인라인 `paddingLeft`다(§34 §안 쓰는 export —
                            // `SidebarMenuSub`는 마크업이 실제로 중첩돼야 하고 겹을 하나만 그려
                            // 깊이 3 이상을 못 낸다). `p-2`의 왼쪽 8px을 이 값이 덮는다.
                            style={{ paddingLeft: `${e.depth * 0.75 + 0.5}rem` }}
                          >
                            <FileText
                              aria-hidden
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                            <span className="font-mono break-all">{e.name}</span>
                            {e.inlineChars !== undefined && <InlineBadge chars={e.inlineChars} />}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ),
                    )}
                  </SidebarMenu>
                )}
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
            ) : openedCore ? (
              <CoreView file={openedCore} vendored={coreVendored} />
            ) : !selected ? (
              <p className="text-sm text-muted-foreground">
                {expanded ? "파일을 고르세요." : "파일 목록을 펴서 고르세요."}
              </p>
            ) : selected.text === null ? (
              // 트리에는 보이지만 편집기로는 안 여는 것들(§6 `.md` 아닌 파일)
              <Alert>
                <TriangleAlert aria-hidden className="text-status-stale" />
                <AlertTitle>
                  <span className="font-mono break-all">{selected.rel}</span>
                </AlertTitle>
                <AlertDescription>{selected.reason}</AlertDescription>
              </Alert>
            ) : (
              <ProtocolEditor
                key={selected.rel} // 파일을 바꿔도 앞 파일 내용이 textarea에 남지 않게 한다
                projectId={id}
                rel={selected.rel}
                initial={selected.text}
                inlined={selected.rel === "AGENTS.md"}
              />
            )}
          </div>
        </SidebarProvider>
      )}
    </div>
  );
}

/** 트리 줄 한 벌의 클래스 — **코어 줄과 파일 줄이 같이 쓴다**(둘 다 `render={<Link>}`).
 *  대부분은 `SidebarMenuButton size="sm"`이 든다(`flex w-full items-center gap-2 rounded-md
 *  p-2 text-left text-xs` · `hover:bg-sidebar-accent`(= `--muted` 값, §비주얼 §34 ②) ·
 *  `data-active:bg-sidebar-accent data-active:font-medium`). 여기 남는 넷은 **§34 판정표의
 *  `안 바꾸는 값` 칸을 지키는 것들**이다 — 그 표가 바꾼다고 적지 않은 값은 안 갈린다:
 *  - `h-auto min-h-8` — 부품 기본 `h-7`은 접기용 **고정** 높이다. 파일명이 `break-all`로
 *    두 줄이 되는 자리라(깊은 경로) 고정 높이면 `overflow-hidden`이 아랫줄을 먹는다.
 *  - `py-1` — `p-2`를 그대로 두면 `InlineBadge`(20px)가 든 줄만 36px이 되어 32px인 나머지
 *    줄과 어긋난다. 세로 4px은 종전 값이고 한 줄 줄 높이는 `min-h-8`이 그대로 든다.
 *  - `gap-1.5` — 부품 기본 `gap-2`. 아이콘과 파일명 사이는 종전 6px이다.
 *  - `[&_svg]:size-3.5` — 부품 기본 `[&_svg]:size-4`가 **자식 선택자라 아이콘의 `size-3.5`를
 *    이긴다**(0,1,1 vs 0,1,0). 안 덮으면 `Folder`/`FileText`/`Lock`이 조용히 16px이 된다.
 *  - `[&>span:last-child]:whitespace-normal` — 같은 이유로 부품의 `[&>span:last-child]:truncate`가
 *    파일명 `span`을 물어 `break-all`을 죽인다(배지가 없는 줄에서 그 `span`이 마지막이다).
 *    긴 파일명은 잘리는 게 아니라 접힌다 — 판정표의 `안 바꾸는 값`이 `break-all`이다. */
const ROW =
  "h-auto min-h-8 gap-1.5 py-1 [&_svg]:size-3.5 [&>span:last-child]:whitespace-normal";

/** 코어는 **읽기 전용**이다(§프롬프트 층 결정 5). `ProtocolEditor`에 플래그를 다는 대신 서버
 *  컴포넌트로 따로 그린다 — 저장·이름변경·삭제 버튼이 코드에 아예 없고 클라이언트 액션도 안 실린다.
 *  잠금이 조건문 하나가 아니라 배치다(서버 액션은 어차피 큐 안 경로만 받는다).
 *
 *  `vendored`가 서있으면(결정 8-d) 세션이 실제로 받는 파일이 큐 사본이라 산문도 그걸 말한다 —
 *  `file.path`는 두 경우 다 `readCore`가 실제로 읽은 절대경로라 이미 맞다(위 배지 옆). */
function CoreView({ file, vendored }: { file: CoreFile; vendored: boolean }) {
  const inlined = file.name === CORE_INLINED;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm break-all">{file.path}</span>
        {inlined ? (
          <InlineBadge chars={[...file.text].length} />
        ) : (
          <span className="text-xs text-muted-foreground">세션이 필요할 때 읽음</span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {vendored ? (
          <>이 파일은 이 큐에 vendored된 코어 사본입니다 — </>
        ) : (
          <>이 파일은 큐가 아니라 엔진 레포에 있습니다 — </>
        )}
        {inlined ? (
          <>
            <span className="font-mono text-xs">tick.sh</span>가 전문을{" "}
            <b className="font-medium">모든 프로젝트</b>의 모든 세션 프롬프트 맨 앞에 붙입니다.
          </>
        ) : (
          <>
            <span className="font-mono text-xs">{CORE_INLINED}</span>가 가리키면 세션이 필요할 때
            직접 읽습니다(프롬프트에 인라인되지는 않습니다).
          </>
        )}{" "}
        여기서는 읽기만 합니다(이 화면이 고치는 것은 프로젝트 층입니다).
      </p>

      <Textarea
        aria-label={`${file.name} 원문`}
        className="font-mono"
        rows={28}
        readOnly
        value={file.text}
      />

      <div className="flex items-center justify-end">
        <span className="text-xs text-muted-foreground tabular-nums">
          {[...file.text].length.toLocaleString()}자
        </span>
      </div>
    </div>
  );
}
