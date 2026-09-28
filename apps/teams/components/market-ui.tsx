"use client";

/** `/market`의 클라이언트 조각 — 카드 격자 · 탭 · 검색 · 태그 필터 · 항목 상세 · 가져오기
 *  (DESIGN.md §페르소나 마켓 §화면, §비주얼 §79, 티켓 `0aac85ef`).
 *
 *  fs를 만지는 건 서버 액션뿐이다(`app/(app)/market/actions.ts`) — `personas-ui.tsx`와 같은
 *  자리 규칙이다. 판정(검색·태그 AND)은 클라이언트에서 한다(§화면의 ponytail 줄) — 항목이
 *  수백을 넘으면 그때 서버로 내린다. */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, CircleCheck, Search, Star, TriangleAlert, X } from "lucide-react";
import {
  getMarketItemDetailAction,
  importPersonaAction,
  importSquadAction,
  loadMarketPaneData,
  toggleFavoriteAction,
  type ImportResult,
  type MarketCardItem,
} from "@/app/(app)/market/actions";
import type { MarketItemDetail, MarketKind } from "@/lib/market";
import { matchesMarketSearch } from "@/lib/market-search";
import type { Locale } from "@/lib/i18n";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale, useT } from "@/components/language-provider";

type Project = { id: string; name: string };
type Tab = MarketKind;

function wr(prefix: string, mid: string, suffix: string): string {
  return [prefix, mid, suffix].filter(Boolean).join(" ");
}

export function MarketPane({
  locale,
  items,
  projects,
  onImported,
}: {
  locale: Locale;
  items: MarketCardItem[];
  projects: Project[];
  /** 가져오기가 끝난 뒤(다이얼로그를 안 닫고) 목록을 다시 읽으려는 부모에게 알린다
   *  (§페르소나 마켓 §화면 - 다이얼로그로 연다 결정 3). `/market` 페이지는 안 줘도 된다 —
   *  그 화면은 `revalidatePath`로 이미 다시 읽는다. */
  onImported?: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("persona");
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [favorites, setFavorites] = useState(() => new Set(items.filter((i) => i.favorite).map((i) => i.id)));
  const [selected, setSelected] = useState<MarketCardItem | null>(null);

  const tabItems = useMemo(() => items.filter((i) => i.kind === tab), [items, tab]);
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const i of tabItems) for (const tag of i.tags) seen.add(tag);
    return [...seen];
  }, [tabItems]);
  // ponytail: 판정을 서버에 안 내린다 — 머신 한 대의 목록이라 색인을 안 만든다(§페르소나 마켓
  // §화면). 항목이 수백을 넘으면 그때 서버로 내린다.
  const filtered = useMemo(
    () =>
      tabItems.filter(
        (i) =>
          matchesMarketSearch(i, i.profileFirstLine, search) &&
          activeTags.every((tag) => i.tags.includes(tag)),
      ),
    [tabItems, search, activeTags],
  );

  const toggleTag = (tag: string) =>
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const toggleFavorite = (item: MarketCardItem) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    void toggleFavoriteAction(item.id);
  };

  if (items.length === 0) {
    return (
      <EmptyState
        text={t("market.empty.title")}
        action={<p className="text-xs text-muted-foreground">{t("market.empty.hint")}</p>}
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-lg font-semibold">{t("market.title")}</h1>
          <p className="text-xs text-muted-foreground">
            {wr(t("market.itemCountPrefix"), String(filtered.length), t("market.itemCountSuffix"))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line">
              <TabsTrigger value="persona" className="flex-none">
                {t("market.tab.persona")}
              </TabsTrigger>
              <TabsTrigger value="squad" className="flex-none">
                {t("market.tab.squad")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <InputGroup className="h-8 max-w-xs ml-auto">
            <InputGroupAddon>
              <Search aria-hidden className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("market.search.placeholder")}
              aria-label={t("market.search.ariaLabel")}
            />
          </InputGroup>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const on = activeTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  variant={on ? "default" : "secondary"}
                  className="cursor-pointer"
                  onClick={() => toggleTag(tag)}
                >
                  {on && <Check aria-hidden className="size-3" />}
                  {tag}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <FilterEmpty
          search={search}
          activeTags={activeTags}
          onClearSearch={() => setSearch("")}
          onClearTag={toggleTag}
          onReset={() => {
            setSearch("");
            setActiveTags([]);
          }}
        />
      ) : (
        <div className="-m-1 grid gap-3 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] p-1">
          {filtered.map((item) => (
            <MarketCard
              key={item.id}
              item={item}
              favorite={favorites.has(item.id)}
              onOpen={() => setSelected(item)}
              onToggleFavorite={() => toggleFavorite(item)}
            />
          ))}
        </div>
      )}

      {selected && (
        <ItemDialog
          locale={locale}
          item={selected}
          projects={projects}
          favorite={favorites.has(selected.id)}
          onToggleFavorite={() => toggleFavorite(selected)}
          onClose={() => setSelected(null)}
          onImported={onImported}
        />
      )}
    </>
  );
}

/** 입구 둘(홈 머리 · 페르소나 화면 머리)이 그대로 쓰는 다이얼로그 그릇(§페르소나 마켓 §화면 -
 *  다이얼로그로 연다, 티켓 `71c41084`). 트리거 모양만 자리마다 다르고 — `settings-dialog.tsx`의
 *  `trigger` 값 패턴과 같은 이유다: 부르는 쪽 하나가 서버 컴포넌트라 JSX를 못 넘긴다 — 나머지는
 *  이 컴포넌트 하나가 진다. 목록은 열릴 때마다 `loadMarketPaneData`로 새로 읽는다(§결정 3) —
 *  `/market` 페이지의 최초 읽기와 같은 액션이라 조립 로직이 두 벌이 안 된다. */
export function MarketDialog({ trigger }: { trigger: "landing" | "persona" }) {
  const locale = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: MarketCardItem[]; projects: Project[] } | "loading" | "error">(
    "loading",
  );

  const reload = useCallback(() => {
    setData("loading");
    void loadMarketPaneData(locale)
      .then(setData)
      .catch(() => setData("error"));
  }, [locale]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  return (
    <>
      {trigger === "landing" ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {t("market.title")}
        </button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("market.title")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("market.title")}</DialogTitle>
          </DialogHeader>
          {data === "loading" ? (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[104px]" />
              ))}
            </div>
          ) : data === "error" ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>{t("market.error.title")}</AlertTitle>
              <AlertDescription>
                <Button variant="outline" size="sm" onClick={reload}>
                  {t("errorBoundary.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <MarketPane locale={locale} items={data.items} projects={data.projects} onImported={reload} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterEmpty({
  search,
  activeTags,
  onClearSearch,
  onClearTag,
  onReset,
}: {
  search: string;
  activeTags: string[];
  onClearSearch: () => void;
  onClearTag: (tag: string) => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10">
      <p className="text-sm text-muted-foreground">
        {search.trim()
          ? `${t("market.filter.emptyQueryPrefix")}"${search.trim()}"${t("market.filter.emptyQuerySuffix")}`
          : t("market.filter.emptyTagOnly")}
      </p>
      <div className="flex flex-wrap justify-center gap-1">
        {search.trim() && (
          <Badge variant="outline" className="gap-1">
            {t("market.filter.searchBadgePrefix")} {search.trim()}
            <button type="button" aria-label={t("common.cancel")} onClick={onClearSearch}>
              <X aria-hidden className="size-3" />
            </button>
          </Badge>
        )}
        {activeTags.map((tag) => (
          <Badge key={tag} variant="outline" className="gap-1">
            {t("market.filter.tagBadgePrefix")} {tag}
            <button type="button" aria-label={t("common.cancel")} onClick={() => onClearTag(tag)}>
              <X aria-hidden className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={onReset}>
        {t("market.filter.reset")}
      </Button>
    </div>
  );
}

function MarketCard({
  item,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  item: MarketCardItem;
  favorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const t = useT();
  const visibleTags = item.tags.slice(0, 3);
  const extraTags = item.tags.length - visibleTags.length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="card-tint relative flex cursor-pointer flex-col gap-2 rounded-xl bg-card px-3 py-3 text-sm text-card-foreground ring-1 ring-foreground/10"
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-sm">{item.name}</span>
        <button
          type="button"
          className="ml-auto self-center rounded-md p-1 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={t("market.favorite.ariaLabel")}
          aria-pressed={favorite}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Star aria-hidden className={favorite ? "size-4 fill-current text-foreground" : "size-4 text-muted-foreground"} />
        </button>
      </div>
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 grow truncate" title={item.ownerName}>
          {item.ownerName}
        </span>
        <span className="shrink-0 font-mono tabular-nums">v{item.latest}</span>
        {item.installedIn.length > 0 && (
          <span className="shrink-0" title={item.installedIn.join(", ")}>
            <CircleCheck aria-hidden className="inline size-3.5" />{" "}
            {wr(t("market.card.installedLabel"), String(item.installedIn.length), "")}
          </span>
        )}
      </div>
      {item.tags.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-1">
          {visibleTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="max-w-32 truncate" title={tag}>
              {tag}
            </Badge>
          ))}
          {extraTags > 0 && <Badge variant="outline">{t("market.card.moreTagsPrefix")}{extraTags}</Badge>}
        </div>
      )}
    </div>
  );
}

type Mode = "detail" | "import" | "result";

function ItemDialog({
  locale,
  item,
  projects,
  favorite,
  onToggleFavorite,
  onClose,
  onImported,
}: {
  locale: Locale;
  item: MarketCardItem;
  projects: Project[];
  favorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onImported?: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<MarketItemDetail | null | "loading">("loading");
  const [mode, setMode] = useState<Mode>("detail");
  const [targetId, setTargetId] = useState(projects[0]?.id ?? "");
  const [asName, setAsName] = useState(item.name);
  const [overwrite, setOverwrite] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMarketItemDetailAction(item.kind, item.owner, item.name).then(setDetail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.kind, item.owner, item.name]);

  // `overwrite`를 인자로 받는다 — "덮어쓰기" 버튼이 `setOverwrite(true)` 뒤 바로 이 함수를
  // 부르면, 그 state 갱신은 다음 렌더에나 반영되어 이 클로저는 여전히 옛 `overwrite`를 본다.
  // 상태를 안 거치고 그 값을 직접 넘겨 그 타이밍 문제를 피한다.
  const submitImport = (withOverwrite = overwrite) =>
    start(async () => {
      setConflict(false);
      const action = item.kind === "persona" ? importPersonaAction : importSquadAction;
      const r = await action(item.owner, item.name, targetId, asName, withOverwrite, locale);
      if (!r.ok && r.conflict) {
        setConflict(true);
        return;
      }
      setResult(r);
      setMode("result");
      if (r.ok) onImported?.();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-baseline gap-2">
            <DialogTitle className="font-mono text-lg font-semibold">{item.name}</DialogTitle>
            <span className="text-xs text-muted-foreground truncate">{item.ownerName}</span>
            <span className="font-mono tabular-nums text-xs text-muted-foreground">v{item.latest}</span>
            <button
              type="button"
              className="self-center rounded-md p-1 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={t("market.favorite.ariaLabel")}
              aria-pressed={favorite}
              onClick={onToggleFavorite}
            >
              <Star aria-hidden className={favorite ? "size-4 fill-current text-foreground" : "size-4 text-muted-foreground"} />
            </button>
            {mode === "detail" && (
              <Button size="sm" className="ml-auto self-center" onClick={() => setMode("import")}>
                {t("market.detail.importButton")}
              </Button>
            )}
          </div>
        </DialogHeader>

        {mode === "detail" && (
          <DetailBody locale={locale} item={item} detail={detail} />
        )}

        {mode === "import" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="market-import-target">{t("market.import.targetLabel")}</Label>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("market.import.noProjects")}</p>
              ) : (
                <Select value={targetId} onValueChange={(v) => setTargetId(v ?? "")}>
                  <SelectTrigger id="market-import-target" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="market-import-name">{t("market.import.nameLabel")}</Label>
              <Input
                id="market-import-name"
                ref={nameInput}
                className="font-mono"
                value={asName}
                onChange={(e) => {
                  setAsName(e.target.value);
                  setConflict(false);
                  setOverwrite(false);
                }}
              />
            </div>
            {conflict && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>{t("market.import.conflict")}</AlertTitle>
                <AlertDescription className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setOverwrite(true);
                      submitImport(true);
                    }}
                  >
                    {t("market.import.overwriteChoice")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      nameInput.current?.focus();
                      nameInput.current?.select();
                    }}
                  >
                    {t("market.import.renameChoice")}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode("detail")}>
                {t("common.cancel")}
              </Button>
              <Button disabled={pending || !targetId || !asName.trim()} onClick={() => submitImport()}>
                {t("market.import.submit")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === "result" && result && (
          <div className="space-y-4">
            {result.ok ? (
              <>
                <p className="text-sm">
                  {t("market.import.successTitle")} <span className="font-mono">{result.as}</span>
                </p>
                {result.coImported && result.coImported.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("market.import.coImportedPrefix")} {result.coImported.join(", ")}
                  </p>
                )}
                {result.missingInMarket && result.missingInMarket.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("market.import.missingMembersPrefix")} {result.missingInMarket.join(", ")}
                  </p>
                )}
              </>
            ) : (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertDescription className="font-mono text-xs break-all">{result.message}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose render={<Button />}>{t("common.close")}</DialogClose>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  locale,
  item,
  detail,
}: {
  locale: Locale;
  item: MarketCardItem;
  detail: MarketItemDetail | null | "loading";
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      {detail === "loading" ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
      ) : detail === null ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{t("market.import.notFound")}</AlertDescription>
        </Alert>
      ) : (
        <>
          {item.kind === "persona" ? (
            <Markdown text={detail.profile ?? ""} locale={locale} />
          ) : (
            <ul className="space-y-1 font-mono text-sm">
              {(detail.members ?? "")
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l !== "")
                .map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          {item.kind === "persona" && (
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">{t("market.detail.skillsLabel")}</h3>
              {detail.skills ? (
                <Markdown text={detail.skills} locale={locale} />
              ) : (
                <EmptyState text={t("market.detail.skillsEmpty")} />
              )}
            </div>
          )}
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t("market.detail.versionsLabel")}</h3>
            <ul className="space-y-1">
              {[...item.versions].reverse().map((v) => (
                <li key={v.v} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono tabular-nums">v{v.v}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{v.at}</span>
                  <span className="min-w-0 text-sm">{v.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
