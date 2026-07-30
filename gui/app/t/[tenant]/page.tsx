/** 보드 `/t/<tenant>/` — 테이블 · 필터 · 검색 (DESIGN.md §1 보드 · §비주얼 디렉션 §3 밀도).
 *
 *  기본 순서는 **손대지 않은 큐 순서**(birth 오름차순)다. 그래서 열린 티켓의 집합·순서가
 *  그 테넌트의 `workers/<w>.sh list`와 같게 보인다 — 다르면 GUI가 큐를 거짓으로 그린다.
 *
 *  필터·검색·정렬은 전부 **서버에서** 걸고, 상태는 URL이 담는다(클라이언트 상태 라이브러리 없음).
 *  덕분에 정렬 헤더와 필터 해제는 그냥 `<Link>`고, 클라이언트 코드는 board-ui.tsx의 입력·폴링뿐이다.
 *
 *  칸반 뷰(`?view=`)는 2356df56이 채운다. */
import { readdir, stat } from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, X } from "lucide-react";
import { BoardFilter, BoardPolling, BoardSearch } from "@/components/board-ui";
import { EmptyState } from "@/components/empty-state";
import { DepBadge, StatusBadge, statusLabel } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SORT_KEYS,
  filterTickets,
  listTickets,
  resolveDep,
  sortTickets,
  statusOf,
  type SortKey,
  type Ticket,
} from "@/lib/queue";
import { getTenant, resolveConfig } from "@/lib/tenants";

// 큐는 GUI 밖에서(cron·세션이) 바뀐다. 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

/** 티켓 5상태 — 필터 선택지. 라벨은 `<StatusBadge>`에서 가져온다(같은 말을 써야 한다). */
const STATUSES = ["open", "blocked", "assigned", "wip", "done"] as const;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "status", label: "상태" },
  { key: "hash", label: "해시" },
  { key: "title", label: "title" },
  { key: "kind", label: "kind" },
  { key: "persona", label: "persona" },
  { key: "deps", label: "deps" },
  { key: "created", label: "생성일" },
  { key: "owner", label: "owner" },
];

/** CLI `list`와 같은 표기(`%Y-%m-%d %H:%M`). 서버에서 만든다 — 로컬 도구라 서버와 브라우저가
 *  같은 타임존이고, 클라이언트에서 포맷하면 하이드레이션만 시끄러워진다. */
function when(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function Board({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant: id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound(); // 레이아웃이 이미 404를 세우지만 페이지도 같이 돈다

  // 연결 안 됨은 셸이 사유 블록으로 받는다(§4-1). 여기서 던지면 그 사유가 덮인다.
  if (!(await stat(tenant.root).catch(() => null))) return null;

  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) for (const x of [v ?? []].flat()) sp.append(k, x);

  const config = await resolveConfig(tenant);
  const tickets = await listTickets(tenant.root, config);

  const query = {
    kind: sp.getAll("kind"),
    persona: sp.getAll("persona"),
    status: sp.getAll("status"),
    q: sp.get("q") ?? "",
  };
  const sortParam = sp.get("sort");
  const sortKey = SORT_KEYS.find((k) => k === sortParam) ?? null; // 모르는 값은 큐 순서로 떨어진다
  const desc = sp.get("dir") === "desc";
  const rows = sortTickets(filterTickets(tickets, query), sortKey, desc);

  // 선택지를 하드코딩하지 않는다 — kind는 테넌트마다 다르고, persona는 그 큐의 페르소나다.
  // 프로필이 없는데 티켓이 참조하는 persona도 선택지에 남긴다(엔진은 WARN만 남기고 그냥 돈다).
  const kinds = [...new Set(tickets.map((t) => t.kind).filter(Boolean))].sort();
  const profiles = (await readdir(config.personas, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const personas = [
    ...new Set([...profiles, ...tickets.map((t) => t.persona).filter(Boolean)]),
  ].sort();

  const href = (t: Ticket) => `/t/${id}/tickets/${encodeURIComponent(t.hash)}`;
  const qs = (next: URLSearchParams) => (next.toString() ? `?${next}` : `/t/${id}`);

  /** 헤더 클릭 3단계: 오름차순 → 내림차순 → 큐 순서로 복귀. 정렬을 끌 방법이 없으면
   *  기본 순서(= CLI와 같은 순서)를 다시 못 본다. */
  const sortHref = (key: SortKey) => {
    const next = new URLSearchParams(sp);
    if (sortKey === key && desc) {
      next.delete("sort");
      next.delete("dir");
    } else if (sortKey === key) {
      next.set("dir", "desc");
    } else {
      next.set("sort", key);
      next.delete("dir");
    }
    return qs(next);
  };

  /** 필터값 하나만 뺀 URL — 0건 화면의 `[kind: work ×]` 배지가 쓴다. */
  const withoutHref = (param: string, value: string) => {
    const next = new URLSearchParams(sp);
    const kept = next.getAll(param).filter((v) => v !== value);
    next.delete(param);
    for (const v of kept) next.append(param, v);
    return qs(next);
  };

  const applied = [
    ...query.kind.map((v) => ({ param: "kind", value: v, text: `kind: ${v}` })),
    ...query.persona.map((v) => ({ param: "persona", value: v, text: `persona: ${v}` })),
    ...query.status.map((v) => {
      const known = STATUSES.find((s) => s === v);
      return { param: "status", value: v, text: `상태: ${known ? statusLabel(known) : v}` };
    }),
  ];

  return (
    <div className="space-y-4">
      <BoardPolling />

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">보드</h1>
        <Button size="sm" nativeButton={false} render={<Link href={`/t/${id}/tickets/new`} />}>
          티켓 발행
        </Button>
      </div>

      {tickets.length === 0 ? (
        // 빈 큐 — 필터 0건과 다른 문구다(§6). 원인이 다르므로 다음 행동도 다르다.
        <EmptyState
          text="열린 티켓 없음"
          action={
            <Button size="sm" nativeButton={false} render={<Link href={`/t/${id}/tickets/new`} />}>
              티켓 발행
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <BoardSearch />
            <BoardFilter
              param="kind"
              label="kind"
              options={kinds.map((k) => ({ value: k, label: k }))}
            />
            <BoardFilter
              param="persona"
              label="persona"
              options={personas.map((p) => ({ value: p, label: p }))}
            />
            <BoardFilter
              param="status"
              label="상태"
              options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {rows.length === tickets.length
                ? `티켓 ${tickets.length}건`
                : `티켓 ${rows.length} / ${tickets.length}건`}
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="h-9 hover:bg-transparent">
                {COLUMNS.map(({ key, label }) => {
                  const active = sortKey === key;
                  const Icon = !active ? ChevronsUpDown : desc ? ArrowDown : ArrowUp;
                  return (
                    <TableHead key={key} className="h-9 px-3 text-xs font-medium">
                      <Link
                        href={sortHref(key)}
                        aria-label={`${label} 정렬`}
                        className={`inline-flex items-center gap-1 rounded-sm ${
                          active ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {label}
                        <Icon aria-hidden className="size-3.5 opacity-60" />
                      </Link>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                // 필터 0건 — 헤더는 남긴다(컬럼이 사라지면 필터를 지운 건지 데이터가 없는 건지
                // 구분이 안 된다). 문구·액션이 빈 큐와 다른 이유도 같다(§6).
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMNS.length} className="px-3 py-6">
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-sm text-muted-foreground">
                        {query.q ? `"${query.q}"와 일치하는 티켓 0건` : "조건에 맞는 티켓 0건"}
                      </p>
                      {applied.length > 0 && (
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {applied.map((a) => (
                            <Badge
                              key={`${a.param}:${a.value}`}
                              variant="secondary"
                              render={<Link href={withoutHref(a.param, a.value)} />}
                            >
                              {a.text}
                              <X aria-hidden className="size-3.5" />
                            </Badge>
                          ))}
                        </div>
                      )}
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/t/${id}`} />}>
                        필터 초기화
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((t) => (
                  // 행 전체가 상세로 가는 링크다 — 해시 셀의 링크를 행 크기로 늘린다(§7 대비:
                  // 여기는 행 액션 버튼이 없어서 행 링크가 안전하다). deps 배지는 그 위에 뜬다.
                  <TableRow key={t.path} className="relative h-9 focus-within:bg-muted/50">
                    <TableCell className="px-3 py-0">
                      <StatusBadge status={statusOf(t)} />
                    </TableCell>
                    <TableCell className="px-3 py-0">
                      <Link
                        href={href(t)}
                        className="rounded-sm font-mono text-xs after:absolute after:inset-0"
                      >
                        {t.hash}
                      </Link>
                    </TableCell>
                    {/* title은 자르고 전문은 `title` 속성으로 본다(§6). tooltip은 클라이언트
                        컴포넌트라 행마다 하나씩 두면 테이블이 통째로 클라이언트가 된다 */}
                    <TableCell className="px-3 py-0">
                      {/* 폭 상한은 1440에서 컬럼 8개가 다 들어가도록 잡은 값이다(§4 사이드바를
                          쓰지 않는 이유). deps가 4개 넘게 달린 행은 가로 스크롤로 넘긴다 */}
                      <span className="block max-w-[34ch] truncate text-sm" title={t.title}>
                        {t.title || "(제목 없음)"}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-0 text-sm">{t.kind || "—"}</TableCell>
                    <TableCell className="px-3 py-0 text-sm">{t.persona || "—"}</TableCell>
                    <TableCell className="px-3 py-0">
                      {t.deps.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        // 배지는 늘어난 행 링크 위에 뜨게 둔다 — 안 그러면 deps 클릭이 행에 먹힌다
                        <span className="relative z-10 flex items-center gap-1">
                          {t.deps.map((d) => {
                            const hit = resolveDep(tickets, d, config);
                            return (
                              <DepBadge
                                key={d}
                                hash={d}
                                kind={!hit ? "missing" : t.unmet.includes(d) ? "unmet" : "met"}
                                href={hit ? href(hit) : undefined}
                              />
                            );
                          })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-0 text-xs tabular-nums text-muted-foreground">
                      {when(t.birth)}
                    </TableCell>
                    <TableCell className="px-3 py-0">
                      <span
                        className="block max-w-[24ch] truncate font-mono text-xs text-muted-foreground"
                        title={t.fm.owner ?? ""}
                      >
                        {t.fm.owner || "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
