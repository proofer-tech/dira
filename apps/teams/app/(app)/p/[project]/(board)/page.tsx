/** 보드 `/p/<project>/` — 테이블 · 칸반 · 필터 · 검색 (DESIGN.md §1 보드 · §비주얼 디렉션 §3 밀도).
 *
 *  읽기의 기본 순서는 **손대지 않은 큐 순서**(birth 오름차순)다. 그래서 열린 티켓의 집합·순서가
 *  그 프로젝트의 `workers/<w>.sh list`와 같게 보인다 — 다르면 GUI가 큐를 거짓으로 그린다.
 *  **테이블만 그리기 직전에 생성일 내림차순으로 뒤집는다**(§테이블 기본 순서 · 요구 `1208e64a`):
 *  200행짜리 표를 여는 사람이 찾는 것은 디스패치 차례가 아니라 방금 무슨 일이 있었나다.
 *  그 CLI 패리티는 칸반 `대기` 레인과 `생성일 ↑` 한 번 클릭이 이어받는다.
 *
 *  필터·검색·정렬은 전부 **서버에서** 걸고, 상태는 URL이 담는다(클라이언트 상태 라이브러리 없음).
 *  덕분에 정렬 헤더·필터 해제·뷰 전환은 그냥 `<Link>`고, 클라이언트 코드는 board-ui.tsx의
 *  입력·폴링뿐이다. 두 뷰는 **같은 `rows`**를 그린다 — 읽기·필터 코어를 다시 쓰지 않는다.
 *
 *  칸반에 드래그는 없다: 상태 전이의 주체는 엔진과 티켓 수행 세션이다(DESIGN.md §결정 기록).
 *
 *  **이 화면에는 로딩 스켈레톤이 없다. 다시 만들지 않는다**(`c2888886` 실측 · `404f08c7` 결정).
 *  보드는 5초 폴링으로 큐를 따라가는 화면인데(§아키텍처 상태 갱신 · §0-2 배너가 이 폴링에 기댄다)
 *  **서스펜스 경계가 `router.refresh()`의 커밋을 먹는다** — 서버는 새 데이터를 주고 브라우저는
 *  그걸 받는데 DOM이 안 바뀐다. 헤드리스 CDP 실측(밖에서 만든 티켓이 화면에 뜨기까지):
 *
 *    라우트 `(board)/loading.tsx`   15초 안에 미반영 · 답변 후 배지 +15.04s
 *    페이지 안 `<Suspense>`          3회 중 2회 15초 안에 미반영 (나머지 +4.20s)
 *    경계 없음(지금)                 +4.17s · +4.21s · +4.42s · 답변 후 배지 +0.51s
 *
 *  경계를 페이지 안 `<Suspense>`로 옮기면 나을 것 같지만 **안 낫는다** — 위 가운데 줄이 그
 *  실측이다(3회 중 2회 실패. 되는 회차는 첫 로드가 느려 fallback이 실제로 떴던 회차다).
 *  스켈레톤은 첫 로드 한 번의 편의고 큐를 안 따라가는 보드는 이 제품이 아니다. 첫 도착은
 *  fs 한 번 읽기라 짧다(실측 +0.03~0.39s) — 상세 화면(§2)이 스켈레톤 없이 사는 것과 같은 이유다. */
import { stat } from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, ChevronsUpDown, X } from "lucide-react";
import {
  BoardDoneLane,
  BoardFilter,
  BoardLaneMotion,
  BoardPolling,
  BoardRelations,
  BoardRows,
  BoardSearch,
} from "@/components/board-ui";
import { EmptyState } from "@/components/empty-state";
import { PersonaBadge } from "@/components/persona-badge";
import { PriorityMeter } from "@/components/priority-meter";
import { DepBadge, StatusBadge, daysSince, statusLabel } from "@/components/status-badge";
import { AnswerDialog, NewTicketDialog, RequestDialog } from "@/components/ticket-ui";
import { WipWorker } from "@/components/worker-mark";
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
  TABLE_DEFAULT_SORT,
  archivesOf,
  awaitingOf,
  filterTickets,
  inDefaultList,
  isAwaiting,
  listTickets,
  depBadges,
  relationEdges,
  resolveDep,
  sortTableRows,
  sortTickets,
  statusOf,
  threadOf,
  type SortKey,
  type Ticket,
} from "@/lib/queue";
import { getProject, listPersonas, readLanguage, resolveConfig } from "@/lib/projects";
import { findStream, lastActivity, sessionIdOf, type StreamEvent } from "@/lib/transcript";
import { doneLimit, rowLimit } from "@/lib/urls";

// 큐는 GUI 밖에서(cron·세션이) 바뀐다. 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

/** 칸반 레인 **3개**. 순서는 큐를 흐르는 순서다(queue.ts `RANK`와 같다).
 *  라벨은 `<StatusBadge>`에서 가져온다(같은 말을 써야 한다).
 *
 *  `blocked`가 없는 이유(§1 보드 · 사람 요청 `bd2062cb`): 막힌 티켓과 안 막힌 티켓은 큐 안의
 *  같은 칸에 있다 — 둘 다 열려 있고 둘 다 아직 디스패치되지 않았고, 막힘은 `deps`가 풀리면
 *  아무도 손대지 않아도 사라진다. 레인은 티켓이 **지나가는 단계**를 그리는 것이고 `deps 대기`는
 *  단계가 아니라 그 단계 안의 사정이다. 갈리는 것은 카드의 주황색 deps 태그뿐이다.
 *
 *  `assigned`가 없는 이유(§1 보드 · 사람 요청 `b69e26ce`): 정상 흐름에 없는 상태를 흐름을 그리는
 *  뷰에 레인으로 세우면 비어 있는 게 정상인 컬럼이 화면 폭을 상시 먹고 "여기도 티켓이 지나간다"고
 *  말한다. 그 티켓이 사는 곳은 셸의 알림 배너다(§0-2). **테이블·필터에서는 빼지 않는다** —
 *  빼면 GUI가 CLI `list`보다 덜 보인다. */
const STATUSES = ["open", "wip", "done"] as const;

/** 상태 필터 선택지 = 엔진 5상태 + 파생 `답변 대기`(§1 보드 · §요구사항 레이어 결정 5).
 *  **레인 3개와 개수가 다르고 그게 정상이다** — 필터는 엔진의 상태를 고르는 것이고(CLI `list`
 *  패리티) 레인은 흐름의 단계를 그린다. `deps 대기`·`답변 대기`는 `대기` 레인에 앉고
 *  `assigned`는 필터에만 남는다. */
const STATUS_OPTIONS = ["open", "blocked", "awaiting", "assigned", "wip", "done"] as const;

/** `kind:` → 화면 문구(§1 보드 §보드가 `kind`를 한글로 말한다). **선택지 목록이 아니라 라벨
 *  대응표다** — `kind`는 프로젝트마다 다르므로 표에 없는 값은 파일에 적힌 그대로 그린다
 *  (`KIND_LABELS[v] ?? v`. 상태 필터의 `known ? statusLabel(known) : v`와 같은 모양). */
const KIND_LABELS: Record<string, string> = {
  work: "작업",
  request: "요구사항",
  feedback: "피드백",
  answer: "답변",
};

/** 뷰 전환은 `<Link>` 2개다 — `tabs`를 설치하지 않은 이유가 이것이다(DESIGN.md §5). */
const VIEWS = [
  { value: "table", label: "테이블" },
  { value: "kanban", label: "칸반" },
] as const;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "status", label: "상태" },
  { key: "hash", label: "해시" },
  { key: "title", label: "제목" },
  { key: "kind", label: "분류" },
  { key: "persona", label: "페르소나" },
  { key: "deps", label: "의존성" },
  { key: "created", label: "생성일" },
  { key: "owner", label: "담당" },
];

/** CLI `list`와 같은 표기(`%Y-%m-%d %H:%M`). 서버에서 만든다 — 로컬 도구라 서버와 브라우저가
 *  같은 타임존이고, 클라이언트에서 포맷하면 하이드레이션만 시끄러워진다. */
function when(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 히트 하나 → `.wip` 카드 바닥에 붙은 스트립. 클래스 두 줄은 §비주얼 §36 §값 표를 그대로
 *  옮긴 것이다(사람 요구 `b646dd4a` — 면 · 모션 · 크기).
 *
 *  **새 컴포넌트를 만들지 않는다**(§36 §인벤토리 — 새 커스텀 0 · 새 색 토큰 0 · 새 npm 0):
 *  한 카드에 한 번 쓰는 JSX라 이 함수가 만든 노드를 `<Card>`의 마지막 자식으로 놓는다.
 *
 *  **그릇이 둘인 이유는 `box-sizing: border-box`다** — `h-3.5`와 `pt-2 border-t`를 같은
 *  요소에 주면 글자가 상자 밖으로 밀린다. 바깥이 면을, 안이 글자를 든다.
 *
 *  `aria-hidden`은 **바깥**에 붙는다 — 선까지 통째로 숨는다. 5초마다 갈리는 글이라 붙이면
 *  스크린리더가 카드마다 계속 말한다. `aria-live`도 `role="status"`도 안 붙는다(§18이 같은
 *  이유로 거절했다). 정본은 §2-3이고 카드 전체가 이미 거기로 가는 링크라 이 줄에는 링크도
 *  툴팁도 안 붙인다(§1-1 §뽑는 못).
 *
 *  **면은 전폭 규칙선이고 칠하지 않는다**(§36 §고른 값 ①). `-mx-4`가 카드 `px-4`를 상쇄해
 *  선이 카드 양 끝에 닿고(`티켓 속성`과 갈리는 것이 색도 크기도 아니라 이 사실이다),
 *  `px-4`가 글자를 제자리로 되돌리고, `-mb-2`가 카드 아래 16px 중 8px을 먹는다 —
 *  보이는 리듬이 8 / 선 / 8 / 줄 / 8이고 넷 다 카드가 이미 쓰는 값이라 새 간격 값이 0이다.
 *  칠하면 대비가 갈린다: 라이트에서 불투명하게 쓸 수 있는 값이 `--surface`(4.53) 하나뿐이고
 *  반투명은 카드 호버가 밑에서 비쳐 4.44로 미달이다. 선은 밑면을 한 칸도 안 건드린다.
 *
 *  **모션은 `wip-shimmer` 하나**(`globals.css` — 켜는 것과 끄는 것이 거기 한 블록에 있다).
 *  `prefers-reduced-motion` 처방을 이 파일에 흩어 놓지 않는 것이 계약이다(§36 §고른 값 ② ·
 *  §검증 — 그 grep이 이 파일에서 0이어야 한다). 셋 중 둘만 붙으면 화면은 멀쩡해 보이는데
 *  계약만 깨진다.
 *
 *  `h-3.5`가 있는 이유(§36 §실측 §줄 상자): Geist Mono의 인라인 박스가 strut보다 높아서
 *  mono가 섞인 줄만 줄 상자가 11px에서 15px이 된다(12px 시절엔 17px이었다 — 갈리는 수가
 *  두 크기 모두 1px이다). 빼면 줄이 `tool_use`↔`text`로 갈릴 때마다(p50 8.6초) **카드가
 *  1px씩 흔들린다.** 짝 토큰(`--text-2xs--line-height`)으로도 안 잡힌다 — 줄 상자는 인라인
 *  박스들의 합집합이라 strut을 못 이긴다.
 *
 *  갈리는 축은 **서체 하나**다: `label`은 도구명이라 항상 mono, `summary`는 §9 판정
 *  (`summaryMono`)을 그대로 받아 쓴다. 알파는 1.0이다 — 호버(`card-tint`)에서 대비가 4.53까지
 *  내려가므로 `/70`·`/80`을 얹으면 4.5:1이 깨진다(§36 §실측 §대비). `text-muted-foreground`가
 *  사라진 것은 `wip-shimmer`가 **그 토큰을** 그라디언트 양 끝과 `reduce` 정본으로 직접 들기
 *  때문이다(값이 갈린 것이 아니다). `흐릿하게`는 이제 `text-2xs`(11px)가 낸다.
 *
 *  구분자 ` · `는 **둘 다 있을 때만** 넣는다. assistant `text`는 `label`·`summary`가 둘 다
 *  비므로(실측 히트의 13.9%) §2-1과 같은 처방으로 `body`의 첫 줄을 세운다 — 리더도 §2-1도
 *  안 고치고 **소비자가 정하는 판정 한 줄**이다(§36). */
function wipLine(e: StreamEvent | null) {
  if (!e) return null;
  const summary = e.label ? e.summary : e.body.split("\n")[0];
  if (!e.label && !summary.trim()) return null; // 세울 글자가 없으면 줄도 없다(§1-1 §없을 때)
  return (
    <div aria-hidden className="-mx-4 -mb-2 border-t px-4 pt-2">
      <div className="h-3.5 truncate text-2xs wip-shimmer">
        {e.label && <span className="font-mono">{e.label}</span>}
        {e.label && summary ? " · " : null}
        {summary && <span className={e.summaryMono ? "font-mono" : undefined}>{summary}</span>}
      </div>
    </div>
  );
}

/** 완료 카드 하단의 아카이브 한 줄(§5-3 §표시 규약 ③) — 그릇·간격은 위 `wipLine`과 **같은 값**이다
 *  (§비주얼 §36 ①. 사람이 그 스트립을 이름으로 지목했다 — 새 유틸 0 · 새 토큰 0 · 새 간격 값 0).
 *
 *  갈리는 셋만 적는다. **`wip-shimmer`는 안 붙인다**: 그 빛이 말하는 것은 *지금 갱신되고 있다*인데
 *  이 줄의 글자는 폴링으로 안 갈린다(§5-3 §개정 ② 첫 행 — 두 줄이 건드리는 속성이 아예 다르다).
 *  **줄에 `aria-hidden` 없음**: `.wip` 줄이 그걸 다는 이유는 5초마다 갈리는 글이라서고, 이 줄은
 *  안 갈리는 **링크**라 숨기면 포커스만 잡히는 보이지 않는 링크가 된다. **`relative z-10`**:
 *  카드 전체가 이미 `after:inset-0` 링크라 deps 배지·`AnswerDialog`와 같은 층에 올려야 눌린다 —
 *  보드에서 아카이브 티켓으로 가는 유일한 길이다.
 *
 *  **표식 하나가 §18의 밝기로 숨쉰다**(§비주얼 §42 — 사람 요구 `2f9fce51`이 '아카이브' 인지와
 *  '진행중' 인지 둘을 요구했다). 아이콘이 앞의 것을, 모션이 뒤의 것을 말한다. 붙는 곳은 **표식
 *  자신**이고 글자·링크·스트립에는 안 붙는다 — `opacity`는 자식 전부를 먹어서 부모에 붙이면
 *  글자가 알파 0.3까지 같이 내려간다(§18 §함정). 12px은 14px 줄 상자에 위아래 1px씩 남는 값이라
 *  카드 높이가 안 는다(`size-3.5`는 여유가 0이다). `globals.css`는 0줄 갈린다 — §18 재사용이다.
 *
 *  문구는 셋뿐이고 **상태 배지를 안 쓴다**: 카드의 배지는 *이 카드의 상태*를 말하는 자리라
 *  같은 실루엣이 다른 티켓의 상태를 말하면 사람이 완료 카드를 `진행중`으로 읽는다. 해시도 안
 *  세운다 — 카드에 이미 대상 해시가 있어서 둘째 해시가 서면 어느 것이 이 카드인지 흔들린다. */
function archiveLine(a: Ticket | undefined, href: (t: Ticket) => string) {
  if (!a) return null;
  return (
    <div className="-mx-4 -mb-2 border-t px-4 pt-2">
      <div className="h-3.5 truncate text-2xs">
        <Link href={href(a)} className="relative z-10 inline-flex items-center gap-1">
          <Archive
            aria-hidden
            className="size-3 shrink-0 animate-wip-pulse motion-reduce:animate-none"
          />
          <span>
            {isAwaiting(a) ? "아카이빙 답변 대기" : a.state === "wip" ? "아카이빙중" : "아카이빙 대기"}
          </span>
        </Link>
      </div>
    </div>
  );
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
  const locale = await readLanguage(); // 우선순위 미터의 sr-only 문구뿐(§비주얼 §49) — 화면 나머지는 아직 미이행

  // 상태만 **기본값이 있다**(§1 보드 · 사람 요청 `38108932`): `status`가 URL에 하나도 없을 때
  // 상태 6개가 전부 들어간다 — 완료는 기본으로 보인다. 방금 끝난 티켓까지 지우지 않으려고
  // 되돌린 값이고, 분량은 칸반 `완료` 레인의 자르기(`DONE_LANE_LIMIT`)가 받는다.
  // 하나라도 실려 있으면 실린 값이 전부다 — `?status=done`은 완료만이고 기본값이 섞이지 않는다.
  // `filterTickets`는 이 값을 그대로 받는다(판정은 무수정이다).
  const query = {
    kind: sp.getAll("kind"),
    persona: sp.getAll("persona"),
    status: sp.has("status") ? sp.getAll("status") : [...STATUS_OPTIONS],
    q: sp.get("q") ?? "",
  };
  const sortParam = sp.get("sort");
  const sortKey = SORT_KEYS.find((k) => k === sortParam) ?? null; // 모르는 값은 큐 순서로 떨어진다
  const desc = sp.get("dir") === "desc";
  const rows = sortTickets(filterTickets(tickets, query), sortKey, desc);
  // 테이블만 기본 순서가 다르다 — 생성일 내림차순(§1 보드 §테이블 기본 순서). 뒤집는 자리가
  // 여기(테이블 렌더 직전)인 이유: 아래 칸반·건수·관계선은 전부 `rows`(큐 순서)를 그대로 쓴다.
  // 파라미터가 실려 있으면 `rows`와 같은 순서다(같은 키·같은 방향이라 결과가 같다).
  const tableRows = sortTableRows(rows, sortKey, desc);
  // 표뷰가 **실제로 그리는** 행 수(§성능 예산 §초과분 ②). 자르는 자리가 정렬 **뒤**인 것이
  // 계약이다 — 위 `sortTickets`·`sortTableRows`를 거친 목록의 앞 n행이라 표가 큐를 거짓으로
  // 그리지 않는다. 건수 줄(`total`)도 관계선도 이 값을 안 본다. 칸반은 무관하다(레인 자르기는
  // 종전 그대로다). 값의 유도는 `lib/urls.ts`의 `rowLimit` 하나다 — 바디가 그 수에 30을 더해
  // 다음 URL을 만든다.
  const shownRows = rowLimit(sp.get("rows"));
  // 건수의 분모는 **기본 목록에 드는 수**다(`kind: answer` 제외 후, §1 보드). `tickets.length`를
  // 쓰면 필터를 안 걸었는데도 `12 / 14건`으로 보여 답변 파일이 필터처럼 읽힌다.
  // `tickets`(전체)는 deps 해석·선택지 목록이 계속 쓴다 — 거기서 답변을 빼면 요구사항의 답변 dep이
  // `큐에 없는 해시`(영구 대기)로 거짓 표시된다.
  const total = tickets.filter((t) => inDefaultList(t, query.kind, query.persona)).length;
  // 레인 3개 밖으로 떨어지는 행 = `할당됨`. 분모가 아니라 **표시 건수(`rows`)** 기준이다 —
  // 각주는 "지금 화면의 건수와 레인 합계가 왜 다른가"를 설명하는 것이고, 필터가 걸리면
  // 레인도 같이 좁아진다. `rows.length - 레인합계`와 같은 값이다(`statusOf`는 5상태 중 하나).
  const undispatched = rows.filter((t) => statusOf(t) === "assigned").length;
  // 실효 상태 집합에 `done`이 없으면 완료가 화면에서 빠진다 — 그 사실을 건수 옆 한 줄이 말한다.
  // 기본 화면에는 URL 파라미터가 없어서 `applied` 배지도 `필터 초기화`도 없다: 이 줄이 완료로 가는
  // 유일한 길이다. 세는 방법은 **다른 필터(kind·persona·검색)를 그대로 두고 상태만 완료로** 바꾼
  // 같은 `filterTickets`다 — 판정을 여기서 다시 쓰면 건수와 목록이 갈린다.
  const hiddenDone = query.status.includes("done")
    ? 0
    : filterTickets(tickets, { ...query, status: ["done"] }).length;

  // 선택지를 하드코딩하지 않는다 — kind는 프로젝트마다 다르고, persona는 그 큐의 페르소나다.
  // persona 목록은 **페르소나 화면과 같은 `listPersonas`**로 만든다. 여기서 `readdir`을 다시
  // 하면 이름 규칙(`NAME_RE`) 밖 디렉터리가 선택지에 들어오고, 그건 `queue.ts`가 `''`로 만드는
  // 값이라 고르면 언제나 0건이다. 프로필 없이 티켓만 참조하는 이름은 `listPersonas`가 넣는다.
  const kinds = [...new Set(tickets.map((t) => t.kind).filter(Boolean))].sort();
  const profiles = await listPersonas(config.personas, tickets);
  const personas = profiles.map((p) => p.name);
  // 색은 레지스트리에 있고 **티켓 목록과 같은 서버 렌더에 실린다**(§비주얼 §12 로딩) — 점 자리
  // 스켈레톤이 없는 이유다. `?? {}`가 여기 한 번뿐인 이유: 아래로 넘길 때마다 붙이면 한 자리를
  // 빼먹은 화면이 점을 통째로 잃는다(색 없음이 아니라 배지가 안 그려진다).
  const colors = project.personaColors ?? {};

  // 발행 다이얼로그의 선택지 둘. **보드가 이미 읽은 것을 넘긴다** — `readdir`도 큐 스캔도 다시
  // 하지 않는다(§3).
  //  - persona는 위 필터 목록과 **다르다**: `body !== null`(= PROFILE.md가 있다)만 남긴다.
  //    프로필 없이 티켓만 참조하는 이름(엔진의 WARN)은 새 티켓의 선택지가 아니다.
  //  - deps가 가리키는 이름은 frontmatter의 `ticket:`이 아니라 상태 접미사를 뗀 파일명(`stem`)이다.
  //    큐 순서를 뒤집는다 — 방금 만든 티켓에 엮는 경우가 대부분이고, 뒤집으면 그게 목록 맨 위다.
  const personaChoices = profiles.filter((p) => p.body !== null).map((p) => p.name);
  const depOptions = tickets
    .map((t) => ({ hash: t.stem, title: t.title, met: t.state === "done", duedate: t.fm.duedate ?? "" }))
    .reverse();

  // 링크는 **stem**이다 — 엔진이 찾는 이름이고, 상태가 바뀌어도(접미사) URL이 안 변한다(§식별자).
  const href = (t: Ticket) => `/p/${id}/tickets/${encodeURIComponent(t.stem)}`;
  // 서버가 그리는 링크는 전부 이걸 지난다(정렬 헤더 · 필터 해제 · 전체 보기 · 완료만 · 뷰 전환).
  // **`rows`·`done`을 지운다** — 그 링크들이 데려가는 곳은 다른 목록이라 처음 몫부터가 맞다
  // (§1 §되감기 · §완료 항). 클라이언트 쪽 같은 규칙은 `board-ui.tsx`의 `useUrlNav`에 있다.
  const qs = (next: URLSearchParams) => {
    next.delete("rows");
    next.delete("done");
    return next.toString() ? `?${next}` : `/p/${id}`;
  };

  /** 헤더 클릭 3단계: 오름차순 → 내림차순 → 기본 복귀. 정렬을 끌 방법이 없으면 기본 순서를
   *  다시 못 본다. 돌아가는 곳은 파라미터가 없는 화면이고 그 테이블은 생성일 내림차순이다
   *  (§테이블 기본 순서). `생성일`은 마지막 두 칸이 같은 순서를 그리지만(파라미터 유무만
   *  다르다) **특례를 만들지 않는다** — 규칙이 8컬럼에 하나여야 한다. */
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

  /** `완료 N건 숨김` 링크의 목적지 = 상태 6값이 실린 URL. 프리셋 `전체 보기`와 같은 화면이고
   *  다른 파라미터(검색·정렬·뷰)는 그대로 남는다. */
  const allStatusHref = (() => {
    const next = new URLSearchParams(sp);
    next.delete("status");
    for (const s of STATUS_OPTIONS) next.append("status", s);
    return qs(next);
  })();

  const applied = [
    ...query.kind.map((v) => ({ param: "kind", value: v, text: `분류: ${KIND_LABELS[v] ?? v}` })),
    ...query.persona.map((v) => ({ param: "persona", value: v, text: `페르소나: ${v}` })),
    // 여기만 `query`가 아니라 **URL 그대로**다 — 배지는 "사람이 건 필터"의 목록이고 기본값은
    // 사람이 건 게 아니다. 기본 화면에 배지 5개와 `필터 초기화`가 뜨면 안 된다(§1 보드).
    ...sp.getAll("status").map((v) => {
      const known = STATUS_OPTIONS.find((s) => s === v);
      return { param: "status", value: v, text: `상태: ${known ? statusLabel(known) : v}` };
    }),
  ];

  /** 뷰 전환 링크 — `sp`를 통째로 복사하므로 필터·검색·정렬이 두 뷰에서 그대로 유지된다.
   *  기본값인 kanban은 파라미터를 **지운다**: 같은 화면을 가리키는 URL이 두 개가 되면 공유 링크가
   *  갈린다(`?view=kanban`으로 들어와도 물론 칸반이다 — 모르는 값도 칸반으로 떨어진다). */
  const view = sp.get("view") === "table" ? "table" : "kanban";
  /** 호버 관계선의 간선(§1 보드 · §비주얼 §17) — **칸반에서만** 만든다(테이블은 무수정이다).
   *  fs 읽기가 늘지 않는다: 위에서 이미 읽은 `tickets`를 `depBadges`와 같은 조회로 훑는다.
   *  범위가 `rows`인 이유 — 필터·검색에 걸린 티켓은 카드가 없어 그릴 수 없다. `완료` 레인
   *  20건 자르기와 레인 세로 스크롤은 여기서 못 보므로 클라이언트가 DOM·rect로 마저 거른다. */
  const relations =
    view === "kanban" ? relationEdges(tickets, config, new Set(rows.map((t) => t.stem))) : null;
  /** `.wip` 카드가 **방금 한 일** 한 줄(§1-1 · 모양은 §비주얼 §36) — 카드와 **같은 프레임**에
   *  서버에서 계산한다. 새 클라이언트 컴포넌트 0 · 새 Server Action 0 · 새 폴링 루프 0 ·
   *  새 라우트 0이고, 갱신은 종전 5초 폴링(`BoardPolling`)의 서버 렌더가 그냥 낸다.
   *
   *  읽는 범위가 두 겹으로 좁다. **칸반에서만** 돌고(`?view=table`은 트랜스크립트 읽기 0회 —
   *  위 `relations`와 같은 분기다), 그 안에서도 **지금 그려지는 `진행중` 레인 카드**뿐이다:
   *  `rows`는 필터·검색을 이미 통과한 목록이고 진행중 레인은 자르기가 없어서(`DONE_LANE_LIMIT`은
   *  완료 몫이다) 이 필터가 곧 화면의 카드 집합이다. 실측 비용은 5건에 약 9ms다(§1-1 §비용).
   *
   *  실패는 전부 `null`이고 그 카드에는 **줄이 없다** — `session_id` 없음 · 글롭 매치 ≠ 1(codex
   *  큐는 트랜스크립트가 아예 없다) · 히트 0 · 읽기 실패가 사람에게 같은 뜻이다(§1-1 §없을 때). */
  const wipLines =
    view === "kanban"
      ? new Map(
          await Promise.all(
            rows
              .filter((t) => statusOf(t) === "wip")
              .map(async (t) => {
                const sid = sessionIdOf(t.fm);
                const s = sid ? await findStream(sid) : null;
                return [t.path, wipLine(s ? await lastActivity(s.file, s.grok) : null)] as const;
              }),
          ),
        )
      : null;
  /** 대상 path → 그 카드에 설 아카이브 티켓(§5-3 §표시 규약 ③). **fs 0건** — 위에서 이미 읽은
   *  `tickets`를 한 번 훑을 뿐이라 새 라우트·Server Action·폴링이 0이고 §성능 예산이 무수정이다.
   *
   *  거르는 둘이 계약이다. **아카이브가 `.done`이면 줄이 없다**(끝난 아카이브는 기본 상태라
   *  말할 값이 0이다 — 안 그러면 완료 레인 20장이 전부 같은 문장을 인다). **대상이 `.done`일
   *  때만** 선다: 발행부터 rename까지 몇 초 대상이 `.wip`인 창이 있는데 그때는 `.wip` 줄이
   *  이긴다(같은 슬롯이라 겹치지 않는다). 대상이 둘 이상이면 `birth`가 가장 큰 하나만 — 줄이
   *  둘이 되면 카드 높이가 갈린다. */
  const archives = new Map<string, Ticket>();
  for (const a of tickets) {
    const key = archivesOf(a);
    if (!key || a.state === "done") continue;
    const target = resolveDep(tickets, key, config);
    if (!target || target.state !== "done") continue;
    const prev = archives.get(target.path);
    if (!prev || a.birth > prev.birth) archives.set(target.path, a);
  }
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
    // 보드만 자기 높이를 뷰포트에 맞춘다(§1 · §비주얼 §4). 셸 → `main` → 여기 → 스트립 → 레인이
    // 한 사슬이고 **한 칸이라도 `min-h-0`이 빠지면** 그 칸이 내용만큼 늘어나 문서가 도로 길어진다.
    // 위에서 고정되는 것(h1 · 툴바)은 그대로 두고 마지막 칸(레인 · 테이블 바디)만 flex-1이다.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <BoardPolling />

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">보드</h1>
        {/* 발행도 접수도 라우트가 아니라 **이 화면의 다이얼로그**다(§3) — 눌러도 URL이 안 바뀌므로
            필터·검색·뷰·스크롤이 그대로 남고 취소가 곧 닫기다. 내비를 5개로 늘리지 않는다.
            `요구 접수`가 primary·오른쪽이다(사람 요청 `08e23555`) */}
        <div className="flex items-center gap-2">
          <NewTicketDialog
            project={id}
            personas={personaChoices}
            colors={colors}
            deps={depOptions}
            personaDir={config.personas}
            variant="outline"
            hotkey
          />
          <RequestDialog project={id} />
        </div>
      </div>

      {total === 0 ? (
        // 빈 큐 — 필터 0건과 다른 문구다(§6). 원인이 다르므로 다음 행동도 다르다.
        <EmptyState
          text="열린 티켓 없음"
          // 버튼은 여전히 1개고(§6) 우상단과 **같은 다이얼로그**를 연다. 변종만 기본값이다 —
          // 큐가 비었다는 신호에 대한 다음 행동은 발행이다(§3).
          action={
            <NewTicketDialog
              project={id}
              personas={personaChoices}
              colors={colors}
              deps={depOptions}
              personaDir={config.personas}
              hotkey
            />
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <BoardSearch />
            <BoardFilter
              param="kind"
              label="분류"
              options={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] ?? k }))}
            />
            <BoardFilter
              param="persona"
              label="페르소나"
              options={personas.map((p) => ({ value: p, label: p, color: colors[p] }))}
              dot
            />
            <BoardFilter
              param="status"
              label="상태"
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: statusLabel(s) }))}
              // 기본이 6개 전부이므로 1클릭으로 접을 값어치가 있는 쪽은 `완료 숨기기`다
              // (슬롯은 1개 그대로다). `defaults`는 팝오버 체크·트리거 라벨이 **실효값**을
              // 그리게 한다: 파라미터가 없어도 6개가 전부 체크된다.
              defaults={[...STATUS_OPTIONS]}
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
              {/* `shrink-0`은 idle 워커 풀이 이 줄을 떠난 뒤에도 남는다(풀은 이제 셸 하단 바다 —
                  §1-2 §자리 개정). 이 큐의 실제 문구에서는 **있으나 없으나 같고**(390·768·1440에서
                  건수 157.4 × 16 · 1줄 · 넘침 0으로 동일), 갈리는 것은 최장 문구(건수 + 완료 숨김
                  + 칸반 각주)뿐이다: 없으면 390에서 **두 줄이 되어 툴바가 108 → 112px**로 자라고
                  그만큼 레인이 짧아진다(§1 §보드는 세로로 화면에 맞는다의 고정 요소 넷 중 하나다).
                  붙여 두면 한 줄로 남는다 — 그 폭에서 문서는 이미 가로로 흐르고 있다(레인 138px) */}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {rows.length === total ? `티켓 ${total}건` : `티켓 ${rows.length} / ${total}건`}
                {/* 완료가 빠졌다는 사실은 여기서만 말한다 — 두 뷰 공통이고 0건 화면에서도 뜬다
                    (큐가 완료뿐이면 이 링크가 유일한 출구다). 상태 6값 URL로 간 화면에서는
                    실효 집합에 `done`이 있으므로 이 줄이 사라진다 */}
                {hiddenDone > 0 && (
                  <>
                    {" · "}
                    <Link
                      href={allStatusHref}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      완료 {hiddenDone}건 숨김
                    </Link>
                  </>
                )}
                {/* 레인 3개에 `할당됨`이 없어서 칸반에서는 레인 합계 < 표시 건수가 된다.
                    어긋난 숫자를 설명 없이 두지 않는다(§1 보드) — 그 티켓으로 가는 링크는
                    배너가 갖고 있다(§0-2). 0건이면 어긋나지 않으므로 각주도 없다 */}
                {view === "kanban" && undispatched > 0 && (
                  <span className="ml-1">(디스패치되지 않는 {undispatched}건은 상단 알림)</span>
                )}
              </span>
            </div>
          </div>

          {view === "kanban" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {/* 필터 0건이라도 **컬럼은 남긴다** — 컬럼이 사라지면 필터를 지운 건지 데이터가
                  없는 건지 구분이 안 된다(테이블 헤더를 남기는 것과 같은 이유, §6) */}
              {rows.length === 0 && (
                <div className="rounded-md border border-dashed px-6 py-6">{noMatch}</div>
              )}
              {/* 레인은 이 스트립의 가로를 균등하게 나눠 갖는다(`flex-1`) — 남는 폭이 없다(§1 보드).
                  `min-w-72`(288)가 하한이라 스트립이 896px보다 좁아지면 거기서 멈추고 그때만
                  가로 스크롤로 넘긴다(§4 사이드바를 안 쓰는 이유).
                  `-mx-1 px-1`은 스크롤 컨테이너의 클리핑 여백이다: <Card>의 테두리는 `ring-1`(=
                  border box **밖에** 그리는 box-shadow)이라 카드가 컨테이너 끝에 딱 붙으면
                  양끝 카드의 왼/오른쪽 테두리가 잘려 카드가 열려 보인다. 음수 마진으로 되돌려
                  컬럼은 페이지 거터(main px-6)에 그대로 정렬시킨다.
                  세로는 여기서 멈춘다 — 스트립이 남은 높이를 전부 먹고(`min-h-0 flex-1`)
                  세로 스크롤은 레인 안에서 일어난다(§1). 두 축이 공존한다: 여기가 가로다 */}
              {/* `relative`는 호버 관계선의 좌표 원점이다(§비주얼 §17) — 오버레이가 이 스크롤
                  컨테이너의 `absolute` 자식이라 콘텐츠와 함께 스크롤한다(가로 추종이 공짜다).
                  이 줄에 더한 것은 그 한 클래스뿐이다 */}
              <div className="relative -mx-1 flex min-h-0 flex-1 gap-4 overflow-x-auto px-1 pb-2">
                {STATUSES.map((s) => {
                  // 컬럼 배정은 테이블 상태 컬럼과 **같은 판정**이다(queue.ts statusOf 하나뿐) —
                  // 렌더 직전에 `blocked → 대기`만 한 번 접는다. 레인 배정은 표현이지 상태가
                  // 아니므로 이 접기는 여기 있고 `queue.ts`에 `laneOf`를 만들지 않는다(§1 보드).
                  const group = rows.filter(
                    (t) => (statusOf(t) === "blocked" ? "open" : statusOf(t)) === s,
                  );
                  // `완료` 레인은 **최근 것부터**다. `rows`의 순서를 믿지 않고 `birth`로 다시
                  // 정렬한다 — `?sort=`는 칸반에도 살아 있어서 정렬을 걸면 "최근 20건"이
                  // "제목순 20건"이 된다(URL 정렬은 이 레인에 끼어들지 않는다).
                  // 자르는 것은 카드뿐이다: 아래 머리 건수는 `group.length`(자르기 전) 그대로다.
                  // 어느 화면에서든(기본 보드 · `?status=done` 포함) `doneLimit(?done=)`장만
                  // 그린다 — `trimDone` 갈래는 없다(§1 §완료 항, 요구 `79cad792`).
                  let cards = group;
                  if (s === "done") {
                    cards = [...group].sort((a, b) => b.birth - a.birth).slice(0, doneLimit(sp.get("done")));
                  }
                  const trimmed = group.length - cards.length;
                  const cardEls = cards.map((t) => (
                    // 카드 전체가 상세로 가는 링크다(테이블 행과 같은 규칙 — 행 액션 버튼이
                    // 없어서 안전하다). deps 배지는 늘어난 링크 위에 뜬다.
                    <Card
                      key={t.path}
                      // 관계선이 상대를 찾는 이름이다(§1: 못 찾으면 안 그린다). 링크·엔진과
                      // 같은 `stem`이라 `relationEdges`가 준 간선과 그냥 맞는다
                      data-stem={t.stem}
                      className="card-tint relative gap-2 px-4"
                    >
                      {/* 칸반 카드는 레인이 상태를 말하므로 배지를 달지 않는다 — 예외가
                          `답변 대기`다. 자기 레인 없이 `대기`에 앉고, 답변 stem은 큐에
                          없는 해시라 deps 태그가 `?`로만 떠서 "사람이 답할 차례"라는
                          말을 못 한다. 그래서 이 배지 하나만 남는다(§1 보드 요구사항 항).
                          `deps 대기`는 배지를 얹지 않는다 — 아래 deps 줄의 주황색
                          <DepBadge>가 그 표시다(사람 요청 `bd2062cb`) */}
                      <div className="flex items-start justify-between gap-2">
                        {/* 우선순위 미터(§비주얼 §49) — 해시 줄, `<Link>` 앞. 흐름 안이라
                            `<Card>`의 `overflow-hidden` 기본값에 안 닿는다(테이블 해시 셀과
                            같은 자리·같은 그릇, §49 §자리). */}
                        <span className="inline-flex items-center gap-1">
                          <PriorityMeter priority={t.priority} locale={locale} />
                          {/* §비주얼 §31 ① 갈래 A — 밑줄 없음. 링크임은 카드의
                              `card-tint` 호버 + 커서 + 이 앵커에 걸리는 포커스 링이 말한다 */}
                          <Link
                            href={href(t)}
                            className="rounded-sm font-mono text-xs text-muted-foreground after:absolute after:inset-0"
                          >
                            {t.hash}
                          </Link>
                        </span>
                        {isAwaiting(t) && (
                          <StatusBadge status="awaiting" days={daysSince(t.mtime)} />
                        )}
                      </div>
                      {/* 카드 title은 2줄까지(§6). 전문은 `title` 속성으로 본다 */}
                      <span className="line-clamp-2 text-sm" title={t.title}>
                        {t.title || "(제목 없음)"}
                      </span>
                      {/* 배지가 줄 안에 섞이므로 flex다 — 텍스트 baseline 정렬에 맡기면
                          20px 배지가 줄을 밀어 카드마다 높이가 갈린다.
                          `flex-wrap`은 워커 마크 몫이다(§비주얼 §19 잘림): 워커 이름은
                          식별자라 안 자르고, 길면 카드가 한 줄 자라며 배지를 안 민다 */}
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {t.kind ? (KIND_LABELS[t.kind] ?? t.kind) : "—"} ·
                        {t.persona ? (
                          <PersonaBadge
                            name={t.persona}
                            color={colors[t.persona]}
                            state={t.state}
                          />
                        ) : (
                          "—"
                        )}
                        <WipWorker t={t} />
                      </span>
                      {t.deps.length > 0 && (
                        // 라벨은 세어주지 않는다 — 어느 해시가 무엇인지는 <DepBadge>가
                        // 색·아이콘으로, 스크린리더에는 배지 안 `sr-only` 문구로 말한다.
                        <span className="relative z-10 flex flex-wrap items-center gap-1">
                          <span className="text-xs text-muted-foreground">deps</span>
                          {depBadges(tickets, t, config).map((d) => (
                            <DepBadge
                              key={d.hash}
                              hash={d.hash}
                              kind={d.kind}
                              href={d.hit ? href(d.hit) : undefined}
                            />
                          ))}
                        </span>
                      )}
                      {/* 답변은 여기서 바로 단다(§1 요구사항 항, 사람 요청 `14c88df4`) —
                          상세와 같은 스레드(`threadOf`) · 같은 폼 · 같은 액션이다. 판정은
                          위 배지와 **같은 식**이고, 테이블 행에는 붙이지 않는다(§1 행 액션 없음).
                          자리는 카드 맨 아래다: 위는 티켓이 무엇인가고 여기부터가 할 수 있는
                          일이다(deps 배지도 같은 `z-10` 층에 있다) */}
                      {isAwaiting(t) && (
                        <AnswerDialog
                          project={id}
                          hash={t.stem}
                          title={t.title}
                          answerFile={`${awaitingOf(t)}${config.done}.md`}
                          thread={threadOf(tickets, t, config)}
                        />
                      )}
                      {/* **카드의 마지막 자식** — 이 세션이 방금 한 일 한 줄(§1-1 ·
                          §비주얼 §36). `.wip`에만 있다: 진행중 레인 카드만 위에서 읽었고
                          나머지는 `wipLines`에 키가 아예 없다(완료 카드에 세우면
                          갱신이 멈춘 자리에서 `방금`이 거짓말이다). 위 `AnswerDialog`와
                          자리를 다투지 않는다 — `isAwaiting`은 `state === "open"`만
                          참이라 한 카드에 둘이 같이 서지 않는다.
                          **완료 카드에는 아카이브 한 줄이 같은 슬롯에 선다**(§5-3
                          §표시 규약 ③): 두 Map의 조건이 `.wip`↔`.done`으로 배타라
                          한 카드가 둘을 같이 들 수 없다.
                          간격은 8 / 선 / 8 / 줄 / 8이다: 위 8px은 `<Card>`의 `gap-2`,
                          선 아래 8px은 `pt-2`, 카드 바닥까지 8px은 `py-4`(16)에서
                          `-mb-2`(8)를 뺀 값이다(§36 §자리와 간격 — 새 간격 값 0) */}
                      {wipLines?.get(t.path) ?? archiveLine(archives.get(t.path), href)}
                    </Card>
                  ));
                  return (
                    // 레인 높이는 스트립이 준다(flex 기본 stretch) — 머리는 그 위에 고정으로 남고
                    // 카드 스택만 스크롤한다. 머리를 스크롤러 안에 넣고 sticky를 걸지 않는 이유는
                    // §1에 있다: 건수는 레인 전체에 대한 진술이라 흔들릴 이유가 없다.
                    // `bg-surface rounded-lg border p-2`는 표면 층이다(§비주얼 §33) — 레인 셋이
                    // 같은 종류의 반복이라 셋 다 면을 든다. 가르는 것은 면 대 페이지(1.04)가 아니라
                    // **면 사이의 거터**다. `ring-1`이 아니라 `border`인 이유: 이 컬럼은
                    // `overflow-x-auto` 스트립 안이고 ring은 border box 밖이라 양끝에서 잘린다.
                    // 패딩이 상자 안이라 `flex-1 min-w-72` 폭 배분·레인 피치(304)는 안 바뀌고,
                    // 카드만 18px(테두리 2 + 패딩 16) 좁아진다. 그 8px을 여기서 내는 이유는
                    // 카드에 가로 여백이 없어서다(홈 패널은 줄이 이미 내므로 안 준다).
                    <div key={s} className="flex min-w-72 flex-1 flex-col gap-2 rounded-lg border bg-surface p-2">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={s} />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {group.length}건
                        </span>
                      </div>
                      {/* `-m-1 p-1`은 위 스트립의 `-mx-1 px-1`과 **같은 이유**다 — 세로 overflow가
                          새 클리핑 상자를 만들어 <Card>의 `ring-1`(border box 밖 box-shadow)이
                          네 변에서 잘린다. 음수 마진이 그 여백을 되돌려 간격은 종전 그대로다 */}
                      {/* `data-lane`은 관계선의 **보이는 판정**이 재는 상자다(§1) — 카드가
                          이 스크롤러의 보이는 상자와 안 겹치면 그 획을 안 그린다 */}
                      <div
                        data-lane
                        className="-m-1 min-h-0 flex-1 space-y-2 overflow-y-auto p-1"
                      >
                        {group.length === 0 && rows.length > 0 ? (
                          // <EmptyState>는 화면 하나의 빈 상태용이다(py-10 + 1차 액션 버튼). 레인
                          // 3개에 그걸 깔면 같은 버튼이 3개 생긴다 — 여기선 건수 0만 말한다.
                          // 전체 0건일 땐 위 블록이 이미 말했으므로 이 자리표시자는 안 그린다(§6).
                          <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                            0건
                          </p>
                        ) : s === "done" ? (
                          // 완료 레인만 무한스크롤이다(§1 §완료 항, 요구 `79cad792`) — 감시행이
                          // 보이면 `?done=`을 20 올려 나머지를 이어 그린다. 잘린 나머지로 가는
                          // 옛 출구 링크는 죽었다: 스크롤이 그 자리에서 같은 일(신호 + 이동)을 한다.
                          <BoardDoneLane more={trimmed > 0}>{cardEls}</BoardDoneLane>
                        ) : (
                          cardEls
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* 레인 뒤에 온다 — 카드 위(§17 z 층)에 뜨고 자기 크기를 갖지 않는다.
                    호버·포커스 위임과 좌표 측정은 전부 여기 안이다(§1 상태는 URL에 없다) */}
                {relations && <BoardRelations relations={relations} />}
                {/* 두 번째 `absolute` 자식 — 폴링으로 레인이 갈린 카드의 고스트가 나는 층
                    (§비주얼 §20). 관계선과 같은 스트립·같은 좌표계·같은 z를 쓴다 */}
                <BoardLaneMotion />
              </div>
            </div>
          ) : (
            /* 바디가 스크롤러고 헤더 행은 그 안에서 고정이다(§1) — 뷰를 토글해도 페이지 높이가
               안 변한다. 세로 스크롤을 **shadcn Table의 컨테이너**(이미 `overflow-x-auto`인 그
               div)에 걸어야 한다: `sticky`의 기준은 가장 가까운 스크롤 상자라, 바깥에 새
               스크롤러를 두면 헤더가 그 스크롤을 못 따라간다(컨테이너가 그 사이에 낀다).
               컨테이너는 className을 안 받으므로(shadcn CLI 산출물 — 손대지 않는다) 부모에서
               자식 선택자로 준다. */
            <div className="min-h-0 flex-1 [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-y-auto">
              <Table>
                {/* 헤더 행은 스크롤러 안에서 고정이다(§1). `thead`에 걸고 셀에도 배경을 준다 —
                    `thead`만으로는 collapse된 표에서 셀 배경이 없어 행이 비쳐 보인다 */}
                <TableHeader className="sticky top-0 z-20">
                  <TableRow className="h-9 hover:bg-transparent">
                    {COLUMNS.map(({ key, label }) => {
                      // 파라미터가 없으면 화면이 `생성일` 내림차순으로 서 있다 — 그 자리에서
                      // 헤더도 활성 + `ArrowDown`이다(§1 보드. 아니면 헤더가 거짓말을 한다).
                      // 클릭 3단계는 이 표시와 무관하게 `sortHref`가 실제 `sortKey`로 정한다 —
                      // `생성일`에 특례가 없다.
                      const active = key === (sortKey ?? TABLE_DEFAULT_SORT);
                      const Icon = !active
                        ? ChevronsUpDown
                        : desc || !sortKey
                          ? ArrowDown
                          : ArrowUp;
                      return (
                        // 배경은 셀이 든다(위 `thead` 주석). 행의 `border-b`는 collapse된 표에서
                        // 고정된 헤더를 안 따라오므로 밑줄을 `inset` 그림자로 셀에 직접 그린다
                        // (색은 같은 `--border` 토큰).
                        <TableHead
                          key={key}
                          className="h-9 bg-background px-3 text-xs font-medium shadow-[inset_0_-1px_0_var(--border)]"
                        >
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
                  {tableRows.length === 0 ? (
                    // 필터 0건 — 헤더는 남긴다(컬럼이 사라지면 필터를 지운 건지 데이터가 없는 건지
                    // 구분이 안 된다). 문구·액션이 빈 큐와 다른 이유도 같다(§6).
                    <TableRow className="hover:bg-transparent">
                      {/* 검색어가 길면 그 한 줄이 표를 넓힌다 — `colSpan` 셀은 `whitespace-normal`(§6). */}
                      <TableCell colSpan={COLUMNS.length} className="px-3 py-6 whitespace-normal">
                        {noMatch}
                      </TableCell>
                    </TableRow>
                  ) : (
                    // 행은 여기서 **앞 `shownRows`개만** 그린다 — 바닥에 닿으면 `BoardRows`가
                    // `?rows=`를 30 올려 다음 몫을 받아 온다(§1 보드 §테이블 바디는 30행씩 ·
                    // §성능 예산 §초과분 ②). 건수 줄은 이 값과 무관하다.
                    <BoardRows more={tableRows.length > shownRows}>
                      {tableRows.slice(0, shownRows).map((t) => (
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
                            {/* §비주얼 §49 — 미터는 해시 셀 **안**, 링크 **앞**이라 새 열이 안 는다.
                                장식이라 `<Link>` 밖에 둔다(행 전체가 이미 링크다) */}
                            <span className="inline-flex items-center gap-1">
                              <PriorityMeter priority={t.priority} locale={locale} />
                              {/* §비주얼 §31 ② 갈래 A — ①과 같다. 밑줄 없음 */}
                              <Link
                                href={href(t)}
                                className="rounded-sm font-mono text-xs text-muted-foreground after:absolute after:inset-0"
                              >
                                {t.hash}
                              </Link>
                            </span>
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
                          <TableCell className="px-3 py-0 text-sm">
                            {t.kind ? (KIND_LABELS[t.kind] ?? t.kind) : "—"}
                          </TableCell>
                          {/* 배지가 셀의 `text-sm`을 대체한다(§비주얼 §12) — 셀에 남은 `text-sm`은
                              배지가 없는 `—`(담당 없음) 한 글자용이다. Badge는 제 `text-xs`를 갖는다 */}
                          <TableCell className="px-3 py-0 text-sm">
                            {t.persona ? (
                              <PersonaBadge
                                name={t.persona}
                                color={colors[t.persona]}
                                state={t.state}
                              />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-0">
                            {t.deps.length === 0 ? (
                              <span className="text-sm text-muted-foreground">—</span>
                            ) : (
                              // 배지는 늘어난 행 링크 위에 뜨게 둔다 — 안 그러면 deps 클릭이 행에 먹힌다
                              <span className="relative z-10 flex items-center gap-1">
                                {depBadges(tickets, t, config).map((d) => (
                                  <DepBadge
                                    key={d.hash}
                                    hash={d.hash}
                                    kind={d.kind}
                                    href={d.hit ? href(d.hit) : undefined}
                                  />
                                ))}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-0 text-xs tabular-nums text-muted-foreground">
                            {when(t.birth)}
                          </TableCell>
                          <TableCell className="px-3 py-0">
                            {/* 값·컬럼 무수정 — 전문이 그대로 남고 그 안의 워커 이름만 마크로 선다
                                (§비주얼 §19 ②). 폭 제약·`title` 툴팁도 종전 그대로다 */}
                            <span
                              className="block max-w-[24ch] truncate font-mono text-xs text-muted-foreground"
                              title={t.fm.owner ?? ""}
                            >
                              <WipWorker t={t} full />
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </BoardRows>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
