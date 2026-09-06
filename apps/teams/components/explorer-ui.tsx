"use client";

/** 홈 셸의 `탐색기` 표면(DESIGN.md §11-2 결정 1 · 2 · 4, P366-6).
 *
 *  **트리는 한 단계씩 읽는다**(결정 1) — 디렉터리 노드 하나가 곧 컴포넌트 인스턴스 하나이고,
 *  펼칠 때 그 인스턴스가 자기 자식 한 단계만 서버에 묻는다. 부모가 자식 목록을 미리 들고
 *  있지 않으므로 순환 검사(§11 결정 3 — 실경로가 이미 조상에 있으면 안 펼친다)도 클라이언트가
 *  조상을 따로 들고 다닐 필요가 없다: `listExplorerDirAction`에 넘기는 `relPath`가 이미 뿌리부터의
 *  전체 경로라 서버가 그 경로의 조상 전부를 한 번에 realpath해서 판정한다(`lib/explorer.ts`).
 *
 *  **편집기는 `shiki` + `textarea`다**(결정 2) — LSP도 자동완성도 없다. 문법 색은 배경의
 *  읽기 전용 `<pre>`가 그리고, 그 위에 투명한 `textarea`가 캐럿과 타이핑을 받는다(스크롤 위치를
 *  `onScroll`로 맞춘다 — 흔한 "코드 하이라이트 오버레이" 관용구, 새 의존성 없이 `shiki` 하나로
 *  된다). 하이라이트는 타이핑마다 다시 안 긋는다 — 값이 바뀔 때(로드 직후 · blur)만 다시 그린다:
 *  타이핑 중엔 옛 색 그대로 보여도 캐럿·값은 항상 최신이라 편집이 막히지 않는다.
 *  // ponytail: 토큰 단위 실시간 하이라이트는 안 한다 — 다음 줄바꿈이면 늦어도 되는 장식이다.
 *  //           타이핑마다 다시 긋고 싶어지면 `blur`가 아니라 디바운스로 바꾼다. */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink, File, Folder, Search, TriangleAlert } from "lucide-react";
import {
  findByContentAction,
  findByNameAction,
  listExplorerDirAction,
  openExplorerFileAction,
  openExplorerFileExternallyAction,
  openExplorerFileTab,
  saveExplorerFileAction,
  setExplorerTabUnsaved,
} from "@/app/(app)/p/[project]/home/actions";
import { useT } from "@/components/language-provider";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ExplorerFile, ExplorerListing, FindContentResult, FindNameResult } from "@/lib/explorer";
import type { HomeChunk, Tab } from "@/lib/home-session";
import { cn } from "@/lib/utils";

/** `protocols-ui.tsx` · `ticket-ui.tsx` 등에 이미 있는 "OS 기본 앱으로 열기" 버튼과 같은
 *  모양(§10 §자리 다섯) — 값으로 못 무는 클라이언트 조각이라 각 화면이 자기 액션만 바꿔 하나씩
 *  둔다(그 파일들의 관용 그대로). */
function OpenInAppButton({ action }: { action: () => Promise<{ ok: boolean; message?: string }> }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (pending) return;
                start(async () => {
                  setError(null);
                  const r = await action();
                  if (!r.ok) setError(r.message || t("common.openInApp.failed"));
                });
              }}
            >
              <ExternalLink aria-hidden />
              {t("common.openInApp")}
            </Button>
          }
        />
        <TooltipContent>{t("common.openInApp")}</TooltipContent>
      </Tooltip>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** 확장자 → shiki 언어 id. 모르는 확장자는 `"text"`(하이라이트 없이도 그대로 연다 — 결정 2
 *  "`.md`가 아닌 파일도 연다"와 같은 관용, `lib/protocols.ts`가 이미 그렇게 한다). */
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
  json: "json", md: "markdown", py: "python", sh: "bash", bash: "bash",
  css: "css", html: "html", yml: "yaml", yaml: "yaml", toml: "toml",
  rs: "rust", go: "go", rb: "ruby", php: "php", sql: "sql", graphql: "graphql",
  txt: "text", env: "bash", gitignore: "bash",
};
function langOf(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANG_BY_EXT[ext] ?? "text";
}

const SHIKI_THEMES = { light: "github-light-default", dark: "github-dark-default" } as const;

/** 트리 노드 하나(디렉터리 또는 파일). 펼치기·자식 로딩은 이 인스턴스 자신의 상태다. */
function TreeNode({
  projectId,
  name,
  relPath,
  isDir,
  depth,
  showHidden,
  onOpenFile,
}: {
  projectId: string;
  name: string;
  relPath: string;
  isDir: boolean;
  depth: number;
  showHidden: boolean;
  onOpenFile: (relPath: string, line?: number) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [listing, setListing] = useState<ExplorerListing | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!isDir) {
      onOpenFile(relPath);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (listing) return; // 이미 한 번 읽었다 — 다시 안 묻는다(§11 결정 4 §펼칠 때만 읽는다)
    setLoading(true);
    setListing(await listExplorerDirAction(projectId, relPath));
    setLoading(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-muted"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {isDir ? (
          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        {isDir ? <Folder aria-hidden className="size-3.5 shrink-0" /> : <File aria-hidden className="size-3.5 shrink-0" />}
        <span className="truncate">{name}</span>
      </button>
      {expanded && isDir && (
        <div>
          {loading && <div className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</div>}
          {!loading && listing && !listing.ok && (
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
              <TriangleAlert aria-hidden className="size-3 shrink-0" />
              {listing.reason}
            </div>
          )}
          {!loading &&
            listing?.ok &&
            listing.entries
              .filter((e) => showHidden || !e.name.startsWith("."))
              .map((e) => (
                <TreeNode
                  key={e.name}
                  projectId={projectId}
                  name={e.name}
                  relPath={relPath ? `${relPath}/${e.name}` : e.name}
                  isDir={e.isDir}
                  depth={depth + 1}
                  showHidden={showHidden}
                  onOpenFile={onOpenFile}
                />
              ))}
          {!loading && listing?.ok && listing.capped && (
            <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}>
              {listing.total} {t("explorer.moreCountPrefix")} {LIST_CAP_LABEL}
              {t("explorer.moreCountSuffix")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const LIST_CAP_LABEL = "2,000";
const NAME_CAP_LABEL = "50,000";

/** 워크트리 사본 체크박스(§결정 3) — 이름·내용 찾기 둘이 같은 모양을 쓴다. */
function IncludeWorktreesToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {t("explorer.find.includeWorktrees")}
    </label>
  );
}

/** 이름 찾기(§결정 3) — 칸에 치면 그 즉시 서버가 캐시한 파일 목록을 걸러 flat 목록으로 낸다.
 *  트리 구조는 안 그린다(어느 디렉터리 밑인지는 `relPath`가 이미 보여준다). */
function NameFindResults({
  projectId,
  query,
  includeWorktrees,
  onOpenFile,
}: {
  projectId: string;
  query: string;
  includeWorktrees: boolean;
  onOpenFile: (relPath: string) => void;
}) {
  const t = useT();
  const [result, setResult] = useState<FindNameResult | null>(null);

  useEffect(() => {
    let live = true;
    void findByNameAction(projectId, query, includeWorktrees).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [projectId, query, includeWorktrees]);

  if (!result) return <div className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</div>;
  if (!result.ok) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
        <TriangleAlert aria-hidden className="size-3 shrink-0" />
        {result.reason}
      </div>
    );
  }
  if (result.matches.length === 0) return <EmptyState text={t("explorer.find.noMatches")} />;
  return (
    <div className="space-y-0.5">
      {result.matches.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onOpenFile(m)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-muted"
        >
          <File aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-xs">{m}</span>
        </button>
      ))}
      {result.capped && (
        <div className="px-1 py-1 text-xs text-muted-foreground">
          {t("explorer.find.capped")} ({NAME_CAP_LABEL})
        </div>
      )}
    </div>
  );
}

/** 내용 찾기(§결정 3) — `트리` 옆 별 탭. 타이핑마다 안 돌고 `찾기`를 눌러야 돈다(`grep`
 *  서브프로세스라 값이 크다 — actions.ts `findByContentAction` 주석과 같은 경계). */
function ContentFindPanel({
  projectId,
  includeWorktrees,
  onIncludeWorktreesChange,
  onOpenFile,
}: {
  projectId: string;
  includeWorktrees: boolean;
  onIncludeWorktreesChange: (v: boolean) => void;
  onOpenFile: (relPath: string, line?: number) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindContentResult | null>(null);
  const [pending, start] = useTransition();

  function search() {
    if (!query.trim() || pending) return;
    start(async () => {
      setResult(await findByContentAction(projectId, query, includeWorktrees));
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={t("explorer.find.contentPlaceholder")}
          className="h-8 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none"
        />
        <Button type="button" size="sm" variant="outline" disabled={pending || !query.trim()} onClick={search}>
          <Search aria-hidden className="size-3.5" />
          {t("explorer.find.search")}
        </Button>
      </div>
      <IncludeWorktreesToggle checked={includeWorktrees} onChange={onIncludeWorktreesChange} />
      {pending && <div className="px-1 py-1 text-xs text-muted-foreground">{t("explorer.find.searching")}</div>}
      {!pending && result && !result.ok && (
        <div className="flex items-center gap-1 px-1 py-1 text-xs text-muted-foreground">
          <TriangleAlert aria-hidden className="size-3 shrink-0" />
          {result.reason}
        </div>
      )}
      {!pending && result?.ok && result.hits.length === 0 && <EmptyState text={t("explorer.find.noMatches")} />}
      {!pending && result?.ok && result.hits.length > 0 && (
        <div className="space-y-0.5">
          {result.hits.map((h, i) => (
            <button
              key={`${h.file}:${h.line}:${i}`}
              type="button"
              onClick={() => onOpenFile(h.file, h.line)}
              className="flex w-full flex-col items-start gap-0.5 rounded px-1 py-1 text-left hover:bg-muted"
            >
              <span className="truncate font-mono text-xs text-muted-foreground">
                {h.file}:{h.line}
              </span>
              <span className="w-full truncate font-mono text-xs">{h.text}</span>
            </button>
          ))}
          {result.truncated && (
            <div className="px-1 py-1 text-xs text-muted-foreground">{t("explorer.find.truncated")}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 좌측 패널의 `탐색기` 표면(§11-2 결정 1 · 3) — 뿌리(`resolveConfig(project).cwd`)의 목록을
 *  마운트 때 한 번 읽는다. 숨은 파일 토글 기본값은 켬이다(`.dira`가 그 안쪽이라).
 *
 *  **찾기는 `트리` 탭 안의 이름 칸 하나 + `내용 찾기` 탭 하나다**(§결정 3) — 워크트리 사본
 *  체크박스는 둘이 상태를 나눠 갖지 않고 이 컴포넌트가 하나만 들고 공유한다(사람이 한 번 켜면
 *  두 찾기 다 그 값을 쓴다). */
export function ExplorerTree({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (relPath: string, line?: number) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"tree" | "content">("tree");
  const [showHidden, setShowHidden] = useState(true);
  const [nameQuery, setNameQuery] = useState("");
  const [includeWorktrees, setIncludeWorktrees] = useState(false);
  const [listing, setListing] = useState<ExplorerListing | null>(null);

  useEffect(() => {
    let live = true;
    void listExplorerDirAction(projectId, "").then((r) => {
      if (live) setListing(r);
    });
    return () => {
      live = false;
    };
  }, [projectId]);

  const tabs: { id: "tree" | "content"; labelKey: string }[] = [
    { id: "tree", labelKey: "explorer.find.treeTab" },
    { id: "content", labelKey: "explorer.find.contentTab" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex gap-1 border-b pb-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={cn(
              "rounded px-2 py-1 text-xs",
              tab === tb.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>
      {tab === "content" ? (
        <ContentFindPanel
          projectId={projectId}
          includeWorktrees={includeWorktrees}
          onIncludeWorktreesChange={setIncludeWorktrees}
          onOpenFile={onOpenFile}
        />
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1 px-1">
            <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder={t("explorer.find.namePlaceholder")}
              className="h-7 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none"
            />
          </div>
          {nameQuery.trim() ? (
            <>
              <IncludeWorktreesToggle checked={includeWorktrees} onChange={setIncludeWorktrees} />
              <NameFindResults
                projectId={projectId}
                query={nameQuery}
                includeWorktrees={includeWorktrees}
                onOpenFile={onOpenFile}
              />
            </>
          ) : (
            <>
              <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
                {t("explorer.showHidden")}
              </label>
              {!listing && <div className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</div>}
              {listing && !listing.ok && (
                <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
                  <TriangleAlert aria-hidden className="size-3 shrink-0" />
                  {listing.reason}
                </div>
              )}
              {listing?.ok && (
                <>
                  {listing.entries.filter((e) => showHidden || !e.name.startsWith(".")).length === 0 ? (
                    <EmptyState text={t("home.surface.explorer.empty")} />
                  ) : (
                    listing.entries
                      .filter((e) => showHidden || !e.name.startsWith("."))
                      .map((e) => (
                        <TreeNode
                          key={e.name}
                          projectId={projectId}
                          name={e.name}
                          relPath={e.name}
                          isDir={e.isDir}
                          depth={0}
                          showHidden={showHidden}
                          onOpenFile={onOpenFile}
                        />
                      ))
                  )}
                  {listing.capped && (
                    <div className="px-1 text-xs text-muted-foreground">
                      {listing.total} {t("explorer.moreCountPrefix")} {LIST_CAP_LABEL}
                      {t("explorer.moreCountSuffix")}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 트리에서 파일 하나를 골랐을 때의 왕복(§11-2 결정 2) — 리다이렉트면 그 화면으로 넘어가고,
 *  아니면 이 편집기가 열 내용을 들고 온다. `ExplorerTree`(트리)와 `HomeUI`(우측 칸) 둘 다
 *  이 함수 하나만 부른다 — 같은 판정이 두 곳에 안 흩어진다. */
type OpenableFile = Exclude<ExplorerFile, { kind: "redirect" }>;

/** 열어 둔 파일 탭 각각의 내용(§11 결정 1 §파일 탭이 표면을 가로지르는 탭 줄에 선다, P366-6).
 *  정본 탭 목록(id · 순서 · `activeTab`)은 `home.tabs`다 — 이 맵은 그 목록의 각 `id`(relPath)가
 *  가리키는 **내용**만 든다(`useState` 로컬 하나에 최근 파일 하나만 덮어쓰던 종전 모델을
 *  대체한다). 탭이 둘 이상이어도 여기 다 실린다 — `home-ui.tsx`가 탭마다 `hidden`으로만 접어
 *  둔 컴포넌트 인스턴스를 그려서(`TerminalSurface`와 같은 관용구) 안 보이는 탭도 캐럿·되돌리기
 *  상태를 잃지 않는다. */
export type ExplorerOpenFiles = Record<string, { file: OpenableFile; line?: number }>;

export function useExplorerOpen(projectId: string, tabs: Tab[], activeTab: string | null, apply: (c: HomeChunk) => void) {
  const router = useRouter();
  const [filesById, setFilesById] = useState<ExplorerOpenFiles>({});

  async function onOpenFile(relPath: string, line?: number) {
    const file = await openExplorerFileAction(projectId, relPath);
    if (file.kind === "redirect") {
      router.push(file.to);
      return;
    }
    setFilesById((now) => ({ ...now, [relPath]: { file, line } }));
    apply(await openExplorerFileTab(projectId, relPath));
  }

  // 새로고침 직후처럼 탭은 있는데 내용을 아직 안 읽었으면(§11 셸 수용조건 §새로고침해도 탭
  // 줄이 그대로 뜬다) 그 탭이 활성이 되는 순간 한 번 읽는다 — §11 결정 4 "파일을 열 때"에
  // 탭을 눌러 보는 것도 든다(펼칠 때 · 파일을 열 때 말고는 안 읽는다는 결정은 안 깬다).
  useEffect(() => {
    const active = tabs.find((tb) => tb.id === activeTab);
    if (!active || active.kind !== "file" || filesById[active.id]) return;
    let live = true;
    void openExplorerFileAction(projectId, active.id).then((file) => {
      if (!live || file.kind === "redirect") return; // 리다이렉트 대상이 탭으로 열려 있을 일은 없다
      setFilesById((now) => ({ ...now, [active.id]: { file } }));
    });
    return () => {
      live = false;
    };
  }, [projectId, activeTab, tabs, filesById]);

  /** `CodeEditor`의 깨끗함 <-> 더러움 전환에서만 부른다(§11 수용조건 4 — 저장 안 한 파일 탭은
   *  상한 계산에서 빠진다). 타이핑마다가 아니다. */
  function onUnsavedChange(relPath: string, unsaved: boolean) {
    void setExplorerTabUnsaved(projectId, relPath, unsaved).then(apply);
  }

  /** 탭을 닫을 때 로컬 캐시에서도 뗀다 — 탭 목록(`home.tabs`)에서 빼는 것은 부르는 쪽(`closeTab`
   *  서버 액션)의 일이고, 여기는 그 relPath의 내용을 다시 열 때까지 안 들고 있는 것만 맡는다. */
  function dropFile(relPath: string) {
    setFilesById((now) => {
      const { [relPath]: _drop, ...rest } = now;
      return rest;
    });
  }

  return { filesById, onOpenFile, onUnsavedChange, dropFile };
}

/** 우측 칸의 편집기 본문(§11-2 결정 2 · 4). **더는 `relPath`로 remount하지 않는다** — 탭마다
 *  자기 인스턴스를 계속 마운트해 둔 채 `hidden`으로만 접는 쪽(`ExplorerPane`)이 그 자리를
 *  대신한다(글자 · 저장 기준선이 탭을 오가도 안 날아간다). */
export function FileEditorPane({
  projectId,
  relPath,
  file,
  line,
  onClose,
  onDirtyChange,
}: {
  projectId: string;
  relPath: string;
  file: OpenableFile;
  line?: number;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  if (file.kind === "unreadable") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{relPath}</p>
        <p className="text-sm text-muted-foreground">{file.reason}</p>
        <OpenInAppButton action={() => openExplorerFileExternallyAction(projectId, relPath)} />
      </div>
    );
  }
  return (
    <CodeEditor
      projectId={projectId}
      relPath={relPath}
      initial={file}
      line={line}
      onClose={onClose}
      onDirtyChange={onDirtyChange}
    />
  );
}

/** 탐색기 표면 본문 — 열린 파일 탭 전부를 그리고 활성 탭만 보인다(§11 결정 1 §표면을 가로지르는
 *  탭 — `TerminalSurface`와 같은 관용구: 안 보이는 탭도 `hidden`으로만 접어서 되돌리기 상태를
 *  잃지 않는다. 내용을 아직 못 읽은 탭(새로고침 직후, `useExplorerOpen`이 활성이 되는 순간
 *  읽는 중)은 로딩 한 줄을 대신 그린다. */
export function ExplorerPane({
  projectId,
  tabs,
  activeTab,
  filesById,
  onUnsavedChange,
  onClose,
}: {
  projectId: string;
  tabs: Tab[];
  activeTab: string | null;
  filesById: ExplorerOpenFiles;
  onUnsavedChange: (relPath: string, unsaved: boolean) => void;
  onClose: (relPath: string) => void;
}) {
  const t = useT();
  if (tabs.length === 0) return <EmptyState text={t("explorer.noFileOpen")} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tabs.map((tab) => {
        const entry = filesById[tab.id];
        return (
          <div key={tab.id} hidden={tab.id !== activeTab} className="flex min-h-0 flex-1 flex-col">
            {entry ? (
              <FileEditorPane
                projectId={projectId}
                relPath={tab.id}
                file={entry.file}
                line={entry.line}
                onClose={() => onClose(tab.id)}
                onDirtyChange={(dirty) => onUnsavedChange(tab.id, dirty)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 편집기 CSS의 `leading-6`과 같은 값(px) — 내용 찾기 결과를 눌렀을 때 그 줄로 스크롤하는 계산에 쓴다. */
const LINE_HEIGHT_PX = 24;

function CodeEditor({
  projectId,
  relPath,
  initial,
  line,
  onClose,
  onDirtyChange,
}: {
  projectId: string;
  relPath: string;
  initial: Extract<ExplorerFile, { kind: "text" }>;
  line?: number;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const [text, setText] = useState(initial.text);
  const [baseline, setBaseline] = useState({ mtimeMs: initial.mtimeMs, size: initial.size });
  const [savedText, setSavedText] = useState(initial.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== savedText;
  const lang = langOf(relPath);

  // 서버(탭의 `unsaved`)에는 깨끗함 <-> 더러움이 **갈릴 때만** 알린다 — 마운트 때 한 번 뜨는
  // `false`는 이미 서버 쪽 기본값이라 안 보낸다(§11 수용조건 4, `home-session.ts setFileTabUnsaved`
  // 머리 주석과 같은 경계).
  const dirtyMounted = useRef(false);
  useEffect(() => {
    if (!dirtyMounted.current) {
      dirtyMounted.current = true;
      return;
    }
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  async function highlight(source: string) {
    const { codeToHtml } = await import("shiki");
    setHtml(await codeToHtml(source, { lang, themes: SHIKI_THEMES, defaultColor: false }));
  }

  // 마운트 한 번 — 이후 다시 그리는 자리는 `blur`(아래)다(파일 top 주석 §타이핑마다 안 긋는다).
  // `ignore` 플래그가 있는 이 모양은 리액트 문서의 표준 effect-fetch 관용구다(react-hooks의
  // `set-state-in-effect`가 이 모양은 잡지 않는다 — `highlight`를 effect 밖에서 부르면 잡는다).
  useEffect(() => {
    let ignore = false;
    (async () => {
      const { codeToHtml } = await import("shiki");
      const out = await codeToHtml(initial.text, { lang, themes: SHIKI_THEMES, defaultColor: false });
      if (!ignore) setHtml(out);
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 내용 찾기 결과 줄을 누르고 왔을 때만(§11-2 결정 3) — 캐럿을 그 줄 앞에 두고 스크롤한다.
  useEffect(() => {
    if (!line) return;
    const ta = taRef.current;
    if (!ta) return;
    const idx = initial.text.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(idx, idx);
    ta.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT_PX - ta.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await saveExplorerFileAction(projectId, relPath, text, baseline.mtimeMs, baseline.size);
    setSaving(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setBaseline({ mtimeMs: r.mtimeMs, size: r.size });
    setSavedText(text);
  }

  return (
    <div className="code-editor flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <File aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{relPath}</span>
          {dirty && <span className="text-xs text-muted-foreground">{t("explorer.unsaved")}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error && <span className="text-xs text-destructive">{t("explorer.saveFailed")} {error}</span>}
          <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? t("common.saving") : t("explorer.save")}
          </Button>
        </div>
      </div>
      {/* 결정 2 §editor — 배경의 읽기 전용 `<pre>`(shiki)가 색을 내고, 위에 겹친 투명 `textarea`가
          캐럿·타이핑을 받는다. 폰트·줄높이·패딩이 두 층에서 한 자도 안 갈려야 겹친다
          (`font-mono text-sm leading-6 p-3`을 양쪽에 그대로 준다). */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border">
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm leading-6 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:whitespace-pre-wrap [&_code]:break-words"
          dangerouslySetInnerHTML={{ __html: html ?? "" }}
        />
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void highlight(text)}
          onScroll={(e) => {
            if (preRef.current) {
              preRef.current.scrollTop = e.currentTarget.scrollTop;
              preRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          spellCheck={false}
          className="relative h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-sm leading-6 text-transparent caret-foreground outline-none"
          aria-label={relPath}
        />
      </div>
      <Button variant="ghost" size="sm" className="w-fit" onClick={onClose}>
        {t("common.close")}
      </Button>
    </div>
  );
}
