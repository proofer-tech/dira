/** 보드 `/p/<project>/` — 테이블 · 칸반 · 필터 · 검색 (DESIGN.md §1 보드 · §비주얼 디렉션 §3 밀도).
 *
 *  기본 순서는 **손대지 않은 큐 순서**(birth 오름차순)다. 그래서 열린 티켓의 집합·순서가
 *  그 프로젝트의 `workers/<w>.sh list`와 같게 보인다 — 다르면 GUI가 큐를 거짓으로 그린다.
 *
 *  필터·검색·정렬은 전부 **서버에서** 걸고, 상태는 URL이 담는다(클라이언트 상태 라이브러리 없음).
 *  덕분에 정렬 헤더·필터 해제·뷰 전환은 그냥 `<Link>`고, 클라이언트 코드는 board-ui.tsx의
 *  입력·폴링뿐이다. 두 뷰는 **같은 `rows`**를 그린다 — 읽기·필터 코어를 다시 쓰지 않는다.
 *
 *  칸반에 드래그는 없다: 상태 전이의 주체는 엔진과 티켓 수행 세션이다(DESIGN.md §결정 기록). */
import { stat } from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, X } from "lucide-react";
import { BoardFilter, BoardPolling, BoardSearch } from "@/components/board-ui";
import { EmptyState } from "@/components/empty-state";
import { DepBadge, StatusBadge, daysSince, statusLabel } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HIDE_DONE_STATUSES,
  SORT_KEYS,
  filterTickets,
  inDefaultList,
  isAwaiting,
  listTickets,
  resolveDep,
  sortTickets,
  statusOf,
  type SortKey,
  type Ticket,
} from "@/lib/queue";
import { getProject, listPersonas, resolveConfig } from "@/lib/projects";

// 큐는 GUI 밖에서(cron·세션이) 바뀐다. 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

/** 칸반 레인 **4개**. 순서는 큐를 흐르는 순서다(queue.ts `RANK`와 같다).
 *  라벨은 `<StatusBadge>`에서 가져온다(같은 말을 써야 한다).
 *
 *  `assigned`가 없는 이유(§1 보드 · 사람 요청 `b69e26ce`): 정상 흐름에 없는 상태를 흐름을 그리는
 *  뷰에 레인으로 세우면 비어 있는 게 정상인 컬럼이 화면 폭을 상시 먹고 "여기도 티켓이 지나간다"고
 *  말한다. 그 티켓이 사는 곳은 셸의 알림 배너다(§0-2). **테이블·필터에서는 빼지 않는다** —
 *  빼면 GUI가 CLI `list`보다 덜 보인다. */
const STATUSES = ["open", "blocked", "wip", "done"] as const;

/** 상태 필터 선택지 = 엔진 5상태 + 파생 `답변 대기`(§1 보드 · §요구사항 레이어 결정 5).
 *  **레인 4개와 개수가 다르다** — `assigned`는 필터에 남고(위 `STATUSES` 주석), 답변 대기 카드는
 *  `deps 대기` 레인에 앉고 배지로만 갈린다. */
const STATUS_OPTIONS = ["open", "blocked", "awaiting", "assigned", "wip", "done"] as const;

/** 뷰 전환은 `<Link>` 2개다 — `tabs`를 설치하지 않은 이유가 이것이다(DESIGN.md §5). */
const VIEWS = [
  { value: "table", label: "테이블" },
  { value: "kanban", label: "칸반" },
] as const;

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
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: id } = await params;
  const project = await getProject(id);
  if (!project) notFound(); // 레이아웃이 이미 404를 세우지만 페이지도 같이 돈다

  // 연결 안 됨은 셸이 사유 블록으로 받는다(§4-1). 여기서 던지면 그 사유가 덮인다.
  if (!(await stat(project.root).catch(() => null))) return null;

  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) for (const x of [v ?? []].flat()) sp.append(k, x);

  const config = await resolveConfig(project);
  const tickets = await listTickets(project.root, config);

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
  // 건수의 분모는 **기본 목록에 드는 수**다(`kind: answer` 제외 후, §1 보드). `tickets.length`를
  // 쓰면 필터를 안 걸었는데도 `12 / 14건`으로 보여 답변 파일이 필터처럼 읽힌다.
  // `tickets`(전체)는 deps 해석·선택지 목록이 계속 쓴다 — 거기서 답변을 빼면 요구사항의 답변 dep이
  // `큐에 없는 해시`(영구 대기)로 거짓 표시된다.
  const total = tickets.filter((t) => inDefaultList(t, query.kind)).length;
  // 레인 4개 밖으로 떨어지는 행 = `할당됨`. 분모가 아니라 **표시 건수(`rows`)** 기준이다 —
  // 각주는 "지금 화면의 건수와 레인 합계가 왜 다른가"를 설명하는 것이고, 필터가 걸리면
  // 레인도 같이 좁아진다. `rows.length - 레인합계`와 같은 값이다(`statusOf`는 5상태 중 하나).
  const undispatched = rows.filter((t) => statusOf(t) === "assigned").length;

  // 선택지를 하드코딩하지 않는다 — kind는 프로젝트마다 다르고, persona는 그 큐의 페르소나다.
  // persona 목록은 **페르소나 화면과 같은 `listPersonas`**로 만든다. 여기서 `readdir`을 다시
  // 하면 이름 규칙(`NAME_RE`) 밖 디렉터리가 선택지에 들어오고, 그건 `queue.ts`가 `''`로 만드는
  // 값이라 고르면 언제나 0건이다. 프로필 없이 티켓만 참조하는 이름은 `listPersonas`가 넣는다.
  const kinds = [...new Set(tickets.map((t) => t.kind).filter(Boolean))].sort();
  const personas = (await listPersonas(config.personas, tickets)).map((p) => p.name);

  // 링크는 **stem**이다 — 엔진이 찾는 이름이고, 상태가 바뀌어도(접미사) URL이 안 변한다(§식별자).
  const href = (t: Ticket) => `/p/${id}/tickets/${encodeURIComponent(t.stem)}`;
  const qs = (next: URLSearchParams) => (next.toString() ? `?${next}` : `/p/${id}`);

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
      const known = STATUS_OPTIONS.find((s) => s === v);
      return { param: "status", value: v, text: `상태: ${known ? statusLabel(known) : v}` };
    }),
  ];

  /** 뷰 전환 링크 — `sp`를 통째로 복사하므로 필터·검색·정렬이 두 뷰에서 그대로 유지된다.
   *  기본값인 kanban은 파라미터를 **지운다**: 같은 화면을 가리키는 URL이 두 개가 되면 공유 링크가
   *  갈린다(`?view=kanban`으로 들어와도 물론 칸반이다 — 모르는 값도 칸반으로 떨어진다). */
  const view = sp.get("view") === "table" ? "table" : "kanban";
  const viewHref = (v: (typeof VIEWS)[number]["value"]) => {
    const next = new URLSearchParams(sp);
    if (v === "table") next.set("view", v);
    else next.delete("view");
    return qs(next);
  };

  /** 필터 0건 — 두 뷰가 **같은 문구·같은 해제 배지**를 쓴다. 빈 큐와 문구가 다른 이유는 §6이다
   *  (원인이 다르면 다음 행동도 다르다). */
  const noMatch = (
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
      {/* 필터만 지운다 — 뷰는 남긴다. 초기화가 칸반으로 되돌리면 테이블에서 필터를 지울 수 없다 */}
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={view === "table" ? `/p/${id}?view=table` : `/p/${id}`} />}
      >
        필터 초기화
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <BoardPolling />

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">보드</h1>
        {/* 요구 접수는 같은 화면의 모드다(§3). 내비를 5개로 늘리지 않고 여기로만 들어간다 */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/p/${id}/tickets/new?mode=req`} />}
          >
            요구 접수
          </Button>
          <Button size="sm" nativeButton={false} render={<Link href={`/p/${id}/tickets/new`} />}>
            티켓 발행
          </Button>
        </div>
      </div>

      {total === 0 ? (
        // 빈 큐 — 필터 0건과 다른 문구다(§6). 원인이 다르므로 다음 행동도 다르다.
        <EmptyState
          text="열린 티켓 없음"
          action={
            <Button size="sm" nativeButton={false} render={<Link href={`/p/${id}/tickets/new`} />}>
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
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: statusLabel(s) }))}
              preset={{ label: "완료 숨기기", values: HIDE_DONE_STATUSES }}
            />
            <div className="ml-auto flex items-center gap-2">
              {VIEWS.map((v) => (
                <Button
                  key={v.value}
                  size="sm"
                  variant={view === v.value ? "secondary" : "ghost"}
                  nativeButton={false}
                  aria-current={view === v.value ? "page" : undefined}
                  render={<Link href={viewHref(v.value)} />}
                >
                  {v.label}
                </Button>
              ))}
              <span className="text-xs tabular-nums text-muted-foreground">
                {rows.length === total ? `티켓 ${total}건` : `티켓 ${rows.length} / ${total}건`}
                {/* 레인 4개에 `할당됨`이 없어서 칸반에서는 레인 합계 < 표시 건수가 된다.
                    어긋난 숫자를 설명 없이 두지 않는다(§1 보드) — 그 티켓으로 가는 링크는
                    배너가 갖고 있다(§0-2). 0건이면 어긋나지 않으므로 각주도 없다 */}
                {view === "kanban" && undispatched > 0 && (
                  <span className="ml-1">(디스패치되지 않는 {undispatched}건은 상단 알림)</span>
                )}
              </span>
            </div>
          </div>

          {view === "kanban" ? (
            <div className="space-y-4">
              {/* 필터 0건이라도 **컬럼은 남긴다** — 컬럼이 사라지면 필터를 지운 건지 데이터가
                  없는 건지 구분이 안 된다(테이블 헤더를 남기는 것과 같은 이유, §6) */}
              {rows.length === 0 && (
                <div className="rounded-md border border-dashed px-6 py-6">{noMatch}</div>
              )}
              {/* 레인 4개 × w-72는 1440에 안 들어간다 — 가로 스크롤로 넘긴다(§4 사이드바를 안 쓰는 이유).
                  `-mx-1 px-1`은 스크롤 컨테이너의 클리핑 여백이다: <Card>의 테두리는 `ring-1`(=
                  border box **밖에** 그리는 box-shadow)이라 카드가 컨테이너 끝에 딱 붙으면
                  양끝 카드의 왼/오른쪽 테두리가 잘려 카드가 열려 보인다. 음수 마진으로 되돌려
                  컬럼은 페이지 거터(main px-6)에 그대로 정렬시킨다 */}
              <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
                {STATUSES.map((s) => {
                  // 컬럼 배정은 테이블 상태 컬럼과 **같은 판정**이다(queue.ts statusOf 하나뿐).
                  const group = rows.filter((t) => statusOf(t) === s);
                  return (
                    <div key={s} className="w-72 shrink-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={s} />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {group.length}건
                        </span>
                      </div>
                      {group.length === 0 ? (
                        // <EmptyState>는 화면 하나의 빈 상태용이다(py-10 + 1차 액션 버튼). 레인
                        // 4개에 그걸 깔면 같은 버튼이 4개 생긴다 — 여기선 건수 0만 말한다.
                        <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                          0건
                        </p>
                      ) : (
                        group.map((t) => (
                          // 카드 전체가 상세로 가는 링크다(테이블 행과 같은 규칙 — 행 액션 버튼이
                          // 없어서 안전하다). deps 배지는 늘어난 링크 위에 뜬다.
                          <Card
                            key={t.path}
                            className="relative gap-2 px-4 focus-within:bg-muted/50 hover:bg-muted/50"
                          >
                            {/* 칸반 카드는 레인이 상태를 말하므로 배지를 달지 않는다 — 예외가
                                `답변 대기`다. 자기 레인 없이 `deps 대기`에 앉으므로 카드
                                자신이 하위 종류임을 말해야 한다(§1 보드 요구사항 항) */}
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                href={href(t)}
                                className="rounded-sm font-mono text-xs after:absolute after:inset-0"
                              >
                                {t.hash}
                              </Link>
                              {isAwaiting(t) && (
                                <StatusBadge status="awaiting" days={daysSince(t.mtime)} />
                              )}
                            </div>
                            {/* 카드 title은 2줄까지(§6). 전문은 `title` 속성으로 본다 */}
                            <span className="line-clamp-2 text-sm" title={t.title}>
                              {t.title || "(제목 없음)"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t.kind || "—"} · {t.persona || "—"}
                            </span>
                            {t.deps.length > 0 && (
                              // 미충족 건수를 **글자로** 먼저 말한다(색만으로 하지 않는다). 어느
                              // 해시가 막고 있는지는 <DepBadge>의 아이콘+해시가 개별로 말한다.
                              <span className="relative z-10 flex flex-wrap items-center gap-1">
                                <span className="text-xs text-muted-foreground">
                                  deps{t.unmet.length > 0 && ` · 미충족 ${t.unmet.length}`}
                                </span>
                                {t.deps.map((d) => {
                                  const hit = resolveDep(tickets, d, config);
                                  return (
                                    <DepBadge
                                      key={d}
                                      hash={d}
                                      kind={
                                        !hit ? "missing" : t.unmet.includes(d) ? "unmet" : "met"
                                      }
                                      href={hit ? href(hit) : undefined}
                                    />
                                  );
                                })}
                              </span>
                            )}
                          </Card>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
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
                    {noMatch}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((t) => (
                  // 행 전체가 상세로 가는 링크다 — 해시 셀의 링크를 행 크기로 늘린다(§7 대비:
                  // 여기는 행 액션 버튼이 없어서 행 링크가 안전하다). deps 배지는 그 위에 뜬다.
                  <TableRow key={t.path} className="relative h-9 focus-within:bg-muted/50">
                    <TableCell className="px-3 py-0">
                      {isAwaiting(t) ? (
                        <StatusBadge status="awaiting" days={daysSince(t.mtime)} />
                      ) : (
                        <StatusBadge status={statusOf(t)} />
                      )}
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
          )}
        </>
      )}
    </div>
  );
}
