/** 온톨로지 `/p/<project>/ontology` — 파일트리 + 원문 에디터 (DESIGN.md §5-3 §온톨로지 빌더 §화면).
 *
 *  `protocols/page.tsx`의 판박이다 — 프로토콜 화면이 이미 «기준 디렉터리 + 파일트리 사이드바 +
 *  원문 에디터 + `?file=` URL 상태»라는 완성된 관용구라서다. **기준 디렉터리는 해석된
 *  `TICKET_ONTOLOGY`다**(`resolveConfig`, 기본값 `<큐 루트>/ontology`) — `TICKET_PROTOCOLS`와
 *  같은 재정의 길이 §5-3 §온톨로지 자리를 워커가 재정의한다로 열렸다.
 *
 *  코어 프로토콜(`readCore`)·`AGENTS.md` 인라인 배지 같은 프로토콜 전용 개념은 없다 — 온톨로지가
 *  세션 프롬프트에 싣는 것은 위치 + 검색 방법뿐인 상수 블록이고(§5-2), 본문은 항상 세션이 필요할
 *  때 직접 읽는다. */
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText, PanelLeft, TriangleAlert } from "lucide-react";
import {
  FixSchemaViolationsButton,
  NewOntologyFileButton,
  OntologyEditor,
  OntologyImport,
  OntologyLocationEditor,
  OntologySurveyForm,
} from "@/components/ontology-ui";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusLabel } from "@/components/status-badge";
import { t } from "@/lib/i18n";
import { buildVault } from "@/lib/markdown-wikilinks";
import { computeOntologyMetrics, isDiraFormat, type OntologyMetrics } from "@/lib/ontology";
import {
  ONTOLOGY_FIX_MARKER,
  importFolderOf,
  listTickets,
  openFixTicket,
  openImportTickets,
  statusOf,
  type Ticket,
} from "@/lib/queue";
import {
  listTree,
  nestTree,
  readTextFile,
  type NestedEntry,
  type ProtocolEntry,
  type ProtocolFile,
} from "@/lib/protocols";
import { getProject, ontologyInWorktree, readLanguage, resolveConfig, usingDefault } from "@/lib/projects";
import { cn } from "@/lib/utils";

/** `tree`에서 지표 계산에 필요한 텍스트를 모아 순수 함수(`computeOntologyMetrics`)에 넘긴다.
 *  fs는 여기(Server Component)까지만 — `lib/ontology.ts`는 이 결과물만 받는다.
 *
 *  `ontology/actions.ts`의 `문제해결` 액션도 같은 위반 목록이 필요해 이 함수를 그대로 가져다
 *  쓴다(§P230) — 새 실행층 없이 export만 늘렸다. */
export async function loadMetrics(base: string, tree: ProtocolEntry[]): Promise<OntologyMetrics> {
  const basename = (rel: string) => rel.split("/").at(-1) ?? rel;
  const text = async (rel: string) => (await readTextFile(base, rel)).text ?? "";

  const schemaEntry = tree.find((e) => !e.isDir && e.rel === "_ontology/SCHEMA.md");
  const objectEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("objects/") && e.rel.endsWith(".md"));
  const viewEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("object-views/") && e.rel.endsWith(".md"));
  const logEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("action-log/") && e.rel.endsWith(".md"));
  const typeFileEntries = tree.filter(
    (e) => !e.isDir && e.rel.startsWith("_ontology/object-types/") && e.rel.endsWith(".md"),
  );

  const [schemaText, objects, views, actionLogs, typeFiles] = await Promise.all([
    schemaEntry ? text(schemaEntry.rel) : Promise.resolve(""),
    Promise.all(objectEntries.map(async (e) => ({ rel: e.rel, text: await text(e.rel) }))),
    Promise.all(viewEntries.map(async (e) => ({ rel: e.rel, text: await text(e.rel) }))),
    Promise.all(
      logEntries.map(async (e) => ({ date: basename(e.rel).replace(/\.md$/, ""), text: await text(e.rel) })),
    ),
    Promise.all(typeFileEntries.map(async (e) => ({ rel: e.rel, text: await text(e.rel) }))),
  ]);

  return computeOntologyMetrics({ schemaText, objects, views, actionLogs, typeFiles });
}

// 온톨로지도 세션이 GUI 밖에서 고친다 — 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

export default async function Ontology({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ file?: string; sidebar?: string }>;
}) {
  const { project: id } = await params;
  const { file, sidebar } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  // `?sidebar=off`(§6 §파일트리 사이드바 둘이 접힌다) — 없거나 모르는 값이면 펼침(기본값).
  const expanded = sidebar !== "off";
  // 트리 링크가 나르는 값 — 접힌 상태가 파일 고르기를 지나 유지된다(계약).
  const sidebarQuery = expanded ? "" : "&sidebar=off";
  const toggleLabel = expanded ? "파일 목록 접기" : "파일 목록 펴기";
  // 지금 URL에서 `sidebar`만 뒤집는다 — `?file=`은 한 개도 안 잃는다(계약).
  const toggleHref = (() => {
    const usp = new URLSearchParams();
    if (file) usp.set("file", file);
    if (expanded) usp.set("sidebar", "off");
    const qs = usp.toString();
    return `/p/${id}/ontology${qs ? `?${qs}` : ""}`;
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

  const locale = await readLanguage();
  const config = await resolveConfig(project);
  const base = config.ontology;
  const ontologyAssumed = usingDefault(config, "ontology");
  // §5-3 §편집 표면이 사는 화면 §결정 2 — 사람이 워커 `.sh`를 손으로 고쳐 경계를 어긴 경우만
  // 선다(엔진은 검사하지 않는다). 종전에는 워커 화면 온톨로지 행의 캡션이었다(티켓 cd662a73) —
  // 편집 표면을 따라 이 화면으로 옮긴다(티켓 c5d51522).
  const ontologyWarn = ontologyInWorktree(project.root, base) ? t(locale, "ontology.location.inWorktree") : null;
  const tree = await listTree(base);
  // §5-3 §온톨로지 자리를 워커가 재정의한다 §결정 3 — 형식이 아닌 폴더는 지표를 아예 안 낸다.
  const diraFormat = isDiraFormat(tree);
  const metrics = tree.length > 0 && diraFormat ? await loadMetrics(base, tree) : null;
  // 위지윅 면의 `[[이름]]` -> 링크(§비주얼 §10 §위키링크) — 이름 집합은 여기서 한 번 읽는다.
  const vault = buildVault(tree, (rel) => `/p/${id}/ontology?file=${encodeURIComponent(rel)}`);

  // 위반이 있거나 import 폼이 설 때만 큐를 훑는다 — 둘 다 없는 흔한 경우에 listTickets
  // 비용을 안 낸다. 판정(openFixTicket)은 `문제해결` 액션과 같은 함수다 — 갈리면 화면이
  // 거짓말을 한다(§P230 — §비주얼 §56 ⑤가 import에 같은 판정을 요구한다).
  let fixTicket: Ticket | null = null;
  // `Ticket` 전체가 아니라 이미 판정된 문자열만 클라이언트로 내려간다 — `statusOf`·
  // `importFolderOf`는 `lib/queue.ts` runtime이라(`node:fs/promises` 의존) 클라이언트
  // 컴포넌트(`OntologyImport`)의 번들에 못 들어간다.
  let importTickets: { stem: string; hash: string; status: string; folder: string }[] = [];
  if ((metrics && metrics.schemaViolations.length > 0) || tree.length > 0) {
    const tickets = await listTickets(project.root, config);
    if (metrics && metrics.schemaViolations.length > 0) {
      fixTicket = openFixTicket(tickets, ONTOLOGY_FIX_MARKER);
    }
    if (tree.length > 0) {
      importTickets = openImportTickets(tickets).map((t) => ({
        stem: t.stem,
        hash: t.hash,
        status: statusLabel(statusOf(t)),
        folder: importFolderOf(t),
      }));
    }
  }

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
          {/* 이 경로 줄이 편집 표면이다(§5-3 §편집 표면이 사는 화면, 티켓 c5d51522) — 파일트리가
              0장인 프로젝트에서도 이 조건문 밖이라 그대로 선다. */}
          <OntologyLocationEditor
            projectId={id}
            initialValue={ontologyAssumed ? "" : base}
            locale={locale}
            placeholder={t(locale, "ontology.location.placeholder")}
            saveLabel={t(locale, "ontology.location.save")}
            failureTitle={t(locale, "ontology.location.saveFailed")}
            browseLabel={t(locale, "ontology.location.browse")}
          />
          <div className="mt-1 font-mono text-xs break-all text-muted-foreground">
            {base}
            {ontologyAssumed && <span className="ml-2 font-sans">기본값 가정</span>}
            {ontologyWarn && (
              <span className="ml-2 inline-flex items-center gap-1 font-sans text-status-stale">
                <TriangleAlert aria-hidden className="size-3.5" />
                {ontologyWarn}
              </span>
            )}
          </div>
        </div>
        {tree.length > 0 && <NewOntologyFileButton projectId={id} />}
      </div>

      {metrics && <OntologyMetricsPanel metrics={metrics} projectId={id} fixTicket={fixTicket} />}

      {tree.length > 0 && !diraFormat && (
        <Alert>
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>{t(locale, "ontology.notDira.title")}</AlertTitle>
          <AlertDescription>{t(locale, "ontology.notDira.body")}</AlertDescription>
        </Alert>
      )}

      {tree.length === 0 && (
        // §5-3 §생성 — 온톨로지 없이 도는 프로젝트가 정상이다: 여기서 디렉터리를 만들지 않는다.
        // 설문은 **선택**이다 — 건너뛰고 `직접 만들기`로 빈 파일을 열 수도 있다.
        <div className="max-w-2xl space-y-6">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">몇 가지만 답하면 시작할 자료를 만들어 드립니다</h2>
            <p className="text-sm text-muted-foreground">
              건너뛰어도 이 프로젝트는 그대로 돕니다 — <span className="font-mono text-xs">tick.sh</span>는{" "}
              <span className="font-mono text-xs">ontology/</span>가 비어 있으면 그냥 넘어갑니다.
            </p>
          </div>
          <OntologySurveyForm projectId={id} />
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>답할 게 마땅치 않다면 건너뛰고 빈 파일부터 시작해도 됩니다.</span>
            <NewOntologyFileButton projectId={id} variant="outline" />
          </div>
        </div>
      )}

      {tree.length > 0 && (
        // §비주얼 §56 ③ — 지표 판 뒤, 2단 행 앞. 테두리도 면도 안 준다(행동 한 줄일 뿐이다).
        <div className="max-w-2xl">
          <OntologyImport projectId={id} tickets={importTickets} />
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
            className={`w-full shrink-0 rounded-lg border bg-surface ${expanded ? "lg:w-80" : "lg:w-10"}`}
          >
            <SidebarContent className="py-2">
              <SidebarGroup className="p-0">
                {/* 머리 행 — 접힘·펼침 공통(§비주얼 §53). 낱말은 원래 0개라 접혀도 잃을 게 없다. */}
                <div className="flex h-6 items-center pr-2">{toggle}</div>
                {expanded && (
                  <SidebarMenu className="gap-0.5">
                    {nestTree(tree, selected?.rel).map((e) => (
                      <TreeRow key={e.rel} entry={e} projectId={id} selectedRel={selected?.rel} sidebarQuery={sidebarQuery} />
                    ))}
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
            ) : !selected ? (
              <p className="text-sm text-muted-foreground">
                {expanded ? "파일을 고르세요." : "파일 목록을 펴서 고르세요."}
              </p>
            ) : selected.text === null ? (
              <Alert>
                <TriangleAlert aria-hidden className="text-status-stale" />
                <AlertTitle>
                  <span className="font-mono break-all">{selected.rel}</span>
                </AlertTitle>
                <AlertDescription>{selected.reason}</AlertDescription>
              </Alert>
            ) : (
              <OntologyEditor
                key={selected.rel}
                projectId={id}
                rel={selected.rel}
                initial={selected.text}
                vault={vault}
              />
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

/** 트리 줄 하나(디렉터리는 자기 아래를 재귀 - §비주얼 §54 §조립). 상태는 `<details>` 자신이
 *  든다 - 새 클라이언트 상태 0. `nestTree`가 `open`을 이미 정해 놨으니 여기는 그리기만 한다. */
function TreeRow({
  entry: e,
  projectId,
  selectedRel,
  sidebarQuery,
}: {
  entry: NestedEntry;
  projectId: string;
  selectedRel: string | undefined;
  sidebarQuery: string;
}) {
  const style = { paddingLeft: `${e.depth * 0.75 + 0.5}rem` };

  if (!e.isDir) {
    return (
      <SidebarMenuItem key={e.rel}>
        <SidebarMenuButton
          size="sm"
          className={ROW}
          isActive={e.rel === selectedRel}
          aria-current={e.rel === selectedRel ? "page" : undefined}
          render={<Link href={`/p/${projectId}/ontology?file=${encodeURIComponent(e.rel)}${sidebarQuery}`} />}
          style={style}
        >
          <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-mono break-all">{e.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem key={e.rel}>
      <details open={e.open} className="open:[&>summary>svg:first-child]:rotate-90">
        <SidebarMenuButton
          size="sm"
          className={`${ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden text-muted-foreground`}
          style={style}
          render={<summary />}
        >
          <ChevronRight aria-hidden className="size-3.5 shrink-0" />
          <span className="font-mono break-all">{e.name}</span>
        </SidebarMenuButton>
        <SidebarMenu className="gap-0.5">
          {e.children.map((c) => (
            <TreeRow key={c.rel} entry={c} projectId={projectId} selectedRel={selectedRel} sidebarQuery={sidebarQuery} />
          ))}
        </SidebarMenu>
      </details>
    </SidebarMenuItem>
  );
}

/** DESIGN.md §5-3 §지표. 판정은 `lib/ontology.ts`가 다 하고 여기는 표시만 한다. */
function OntologyMetricsPanel({
  metrics: m,
  projectId,
  fixTicket,
}: {
  metrics: OntologyMetrics;
  projectId: string;
  fixTicket: Ticket | null;
}) {
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-surface p-4 sm:grid-cols-4">
        <MetricStat label="객체 · 관계" value={`${m.objectCount} · ${m.relationCount}`} />
        <MetricStat
          label="숨은 간선"
          value={`${m.hiddenEdges.count}건 (${pct(m.hiddenEdges.ratio)})`}
          alert={m.hiddenEdges.count > 0}
        />
        <MetricStat
          label="규범 문장"
          value={`${m.normativeSentences.count}건`}
          alert={m.normativeSentences.count > 0}
        />
        <MetricStat
          label="서술 한 문장"
          value={`${m.singleSentenceProse.count}건 (${pct(m.singleSentenceProse.ratio)})`}
        />
        <MetricStat label="껍데기" value={`${m.shells.count}건 (${pct(m.shells.ratio)})`} />
        <MetricStat label="고립" value={`${m.isolated.count}건 (${pct(m.isolated.ratio)})`} />
        <MetricStat
          label="계층 순환"
          value={`${m.hierarchyCycles.count}건`}
          alert={m.hierarchyCycles.count > 0}
        />
        <MetricStat
          label="다의적 요소"
          value={`${m.polysemousElements.count}건`}
          alert={m.polysemousElements.count > 0}
        />
        <MetricStat
          label="잉여 클래스"
          value={`${m.redundantClasses.count}건`}
          alert={m.redundantClasses.count > 0}
        />
        <MetricStat
          label="빈손 비율"
          value={m.emptyHanded.total > 0 ? pct(m.emptyHanded.ratio) : "기록 없음"}
          alert={m.emptyHanded.total > 0 && m.emptyHanded.ratio < 0.1}
        />
        <MetricStat
          label="스키마 개정(누적)"
          value={`${m.schemaStability.reduce((n, d) => n + d.count, 0)}건`}
        />
        <MetricStat label="마지막 반영" value={m.lastUpdated ?? "기록 없음"} />
      </div>

      {m.schemaViolations.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>스키마 위반 {m.schemaViolations.length}건</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1 font-mono text-xs">
              {m.schemaViolations.slice(0, 10).map((v, i) => (
                <li key={i} className="break-all">
                  {v}
                </li>
              ))}
            </ul>
            {m.schemaViolations.length > 10 && (
              <p className="mt-1 text-xs">외 {m.schemaViolations.length - 10}건</p>
            )}
            {fixTicket ? (
              <p className="mt-2 text-xs">
                <Link
                  href={`/p/${projectId}/tickets/${fixTicket.stem}`}
                  className="underline underline-offset-2"
                >
                  정리 티켓 {fixTicket.stem} {statusLabel(statusOf(fixTicket))}
                </Link>
              </p>
            ) : (
              <FixSchemaViolationsButton projectId={projectId} />
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function MetricStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm tabular-nums", alert && "text-status-stale")}>{value}</p>
    </div>
  );
}
