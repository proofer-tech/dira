/** 티켓 상세 `/p/<project>/tickets/[hash]` — frontmatter 표 · 본문 · 관계 · 액션
 *  (DESIGN.md §2 티켓 상세 · 제약 2 상태 전이 위임 · 제약 5 `.wip` 편집 금지).
 *
 *  **해시로 경로를 조립하지 않는다.** 형식 검증을 통과한 해시를 `tickets.py find`에 물어
 *  실제 파일을 받고, 못 찾으면 404다(§경로 방어). */
import { stat } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { SessionStream } from "@/components/session-stream";
import { DepBadge, StatusBadge, daysSince } from "@/components/status-badge";
import { WipWorker } from "@/components/worker-mark";
import {
  DeleteTicketButton,
  FrontmatterTable,
  NewTicketDialog,
  TicketEditForm,
  UnassignButton,
  WipBodyPolling,
} from "@/components/ticket-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { findTicket } from "@/lib/engine";
import { buildVault } from "@/lib/markdown-wikilinks";
import { listTree } from "@/lib/protocols";
import {
  archivedBy,
  archivesOf,
  awaitingOf,
  awaitingUnlocked,
  bodyWithoutQuestions,
  continuedOf,
  defaultAnswerOf,
  depBadges,
  derivedFrom,
  isAwaiting,
  lastQuestionOptions,
  listTickets,
  planOf,
  referrers,
  reqOf,
  resolveDep,
  statusOf,
  threadOf,
  type Ticket,
} from "@/lib/queue";
import { getProject, listPersonas, ontologyDir, resolveConfig } from "@/lib/projects";
import { findStream, sessionIdOf } from "@/lib/transcript";
import { decodeHash, engineCan } from "@/lib/urls";
import { holderEngine, listWorkers } from "@/lib/workers";

// 큐는 GUI 밖에서(cron·세션이) 바뀐다. 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

/** 관계 절의 티켓 한 줄 — 상태 배지 + stem 링크. 세 목록(막는 것 · 요구사항 · 나온 티켓)이 같은 모양이다. */
function TicketLine({ t, href }: { t: Ticket; href: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={statusOf(t)} />
      {/* 오른쪽 단(352px)에서 title에 남는 폭이 ≈200px(≈14자)다 — 잘린 문장을 툴팁이 받는다
          (§6 "title은 truncate + 툴팁 전문"). 해시는 자르지 않는다 */}
      <Link href={href} title={t.title} className="truncate text-sm hover:underline">
        <span className="font-mono text-xs text-muted-foreground">{t.hash}</span> {t.title}
      </Link>
    </div>
  );
}

export default async function TicketDetail({
  params,
}: {
  params: Promise<{ project: string; hash: string }>;
}) {
  const { project: id, hash: raw } = await params;
  // Next는 라우트 파라미터를 **퍼센트 인코딩된 원문 세그먼트로** 넘긴다(실측 16.2.12) — 보드가
  // `encodeURIComponent(t.hash)`로 링크를 걸므로 한글 해시가 `%EC%88%9C…`로 도착해 404였다.
  // 여기가 URL을 읽는 유일한 지점이라 여기서 한 번만 푼다. 액션·자식 컴포넌트에는 푼 값이 간다.
  const hash = decodeHash(raw);
  const project = await getProject(id);
  if (!project) notFound(); // 레이아웃이 이미 404를 세우지만 페이지도 같이 돈다

  // 연결 안 됨은 셸이 사유 블록으로 받는다(§4-1). 여기서 404를 던지면 그 사유가 404로 덮인다.
  if (!(await stat(project.root).catch(() => null))) return null;

  const config = await resolveConfig(project);
  const file = await findTicket(project.root, hash, config);
  if (!file) notFound();

  // 위키링크 vault(§비주얼 §10 §위키링크) — 이 프로젝트의 온톨로지. 이름 집합은 여기서 한 번
  // 읽고 아래 모든 렌더·편집 자리(본문 · 스레드 · 세션 스트림 · 복제 다이얼로그)에 그대로 흘린다.
  const ontologyTree = await listTree(ontologyDir(project));
  const vault = buildVault(ontologyTree, (rel) => `/p/${id}/ontology?file=${encodeURIComponent(rel)}`);

  // §1-4 §계산 시점 — 한 번 읽어 이 렌더 전부(스캔·아래 "남은" 계산)에 같은 시각을 쓴다.
  const now = new Date();
  const tickets = await listTickets(project.root, config, now);
  const nfc = (s: string) => s.normalize("NFC");
  const ticket = tickets.find((t) => nfc(t.path) === nfc(file));

  // 파일은 있는데 엔진 scan이 무시하는 경우(frontmatter 없음·닫는 `---` 없음)다. 404가 아니다 —
  // 없는 티켓이 아니라 **엔진에게 안 보이는 파일**이고, 그 차이가 고칠 방법을 알려준다.
  if (!ticket) {
    return (
      <Alert className="max-w-3xl">
        <TriangleAlert aria-hidden className="text-status-stale" />
        <AlertTitle>이 파일은 큐에 뜨지 않습니다 — frontmatter가 없습니다</AlertTitle>
        <AlertDescription className="grid gap-2">
          <span className="font-mono text-xs break-all">{file}</span>
          <span>
            첫 줄이 <span className="font-mono">---</span>이고 닫는{" "}
            <span className="font-mono">---</span>이 있어야 엔진이 티켓으로 봅니다. 손으로 열어
            고치세요.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  // 티켓을 같이 넘긴다 — `holding`이 차야 이 티켓을 **물고 있는 워커**를 되짚을 수 있다
  // (아래 `holderEngine`, §4-3 판정). 큐는 이미 위에서 한 번 읽었고 여기서 다시 읽지 않는다.
  const workers = await listWorkers(project.root, tickets);
  // 선행 = deps **전부**(미충족으로 걸러내지 않는다). 종류·순서 판정은 보드와 같은 헬퍼가 한다.
  const deps = depBadges(tickets, ticket, config);
  const blocked = referrers(tickets, ticket, config); // 후행 = 이 티켓을 deps로 둔 것 = 역참조
  // 유효 우선순위 상속(§1-3 §값을 넣는 자리 셋). 유효가 원값보다 크면 그 값을 물려준 후행이
  // **직접** referrer 중에 반드시 있다(`effectiveFromGraph`가 직계 waiter의 유효값을 그대로
  // 물려받는 재귀라서다) — `.done` 후행은 그래프 밖이라 자기 값(기본 3)을 들고 있어 후보에서 뺀다.
  const priorityInheritedFrom =
    ticket.effective !== ticket.priority
      ? blocked.find((r) => r.state !== "done" && r.effective === ticket.effective)?.hash
      : undefined;
  // 마감 파생 한 줄(§1-4 §화면) — 파생이 명시값을 덮고 있으면(baseline !== priority) "남은"을
  // 잰다. `effectiveDue`는 baseline이 파생일 때 반드시 값이 있다(derivePriority가 null이면
  // 파생도 null이라 baseline은 원값 priority로 남는다).
  // ms만 넘긴다 — 문구 조립(로케일 포함)은 `ticket-ui.tsx`가 한다(§0-16, 이 컴포넌트는
  // 서버라 로케일을 안 읽는다, `4f7def31`).
  const remainingMs =
    ticket.baseline !== ticket.priority && ticket.effectiveDue
      ? ticket.effectiveDue.getTime() - now.getTime()
      : null;
  // 역전 판정 재료(§1-4 §역전) — direct 선행·후행의 own duedate. `deps`(위 badges)의 `hit`은
  // 큐에 없는 해시·미충족이어도 값이 있으면 채워진다(선행 실체가 있으면 마감도 있을 수 있다).
  const precedentDuedates = deps
    .filter((d) => d.hit)
    .map((d) => ({ hash: d.hit!.hash, duedate: d.hit!.fm.duedate ?? "" }));
  const followerDuedates = blocked.map((t) => ({ hash: t.hash, duedate: t.fm.duedate ?? "" }));
  // 관계 링크도 **stem**이다 (보드와 같은 규칙 — §식별자)
  const href = (t: Ticket) => `/p/${id}/tickets/${encodeURIComponent(t.stem)}`;

  // 출처/파생 (§요구사항 레이어 결정 5). `deps` 관계와 **섞지 않는다** — 선후가 아니라 출처다.
  const req = reqOf(ticket);
  const reqTicket = req ? resolveDep(tickets, req, config) : null;
  const derived = derivedFrom(tickets, ticket, config);

  // 아카이브 (§5-3 §표시 규약 ④). 양방향이고 그릇은 위 출처/파생 그대로다 — 새 컴포넌트 0.
  // `deps`와도 `req`와도 섞지 않는다: 선후도 출처도 아니라 **이 티켓을 기록으로 옮긴 티켓**이다.
  const archives = archivesOf(ticket);
  const archiveTarget = archives ? resolveDep(tickets, archives, config) : null;

  // 이어받기 (§P294 §미완으로 끝나는 세션 결정 3). 같은 `resolveDep` — 새 컴포넌트 0.
  // 큐에 없는 stem이면 `continuedTarget`이 `null`이라 배지에 링크를 안 넘긴다(끊긴 값에
  // 화면이 안 깨진다).
  const continued = continuedOf(ticket);
  const continuedTarget = continued ? resolveDep(tickets, continued, config) : null;
  const archivers = archivedBy(tickets, ticket, config);

  // 세션 스트림 (§2-1). 갈림길은 **세션이 붙은 적이 있는가** 하나다(§9 빈 상태 표):
  // `session_id`가 없거나 UUID가 아니면 절 자체를 감추고(상태 배지가 이미 말한다), 있는데
  // 글롭 매치가 0개·2개 이상이면 `트랜스크립트 없음`이다. **어느 쪽도 에러로 그리지 않는다.**
  // 출처가 둘이다(claude · grok) — 어느 쪽이든 여기서는 **파일이 하나 있나**로만 쓴다(§4-3 §grok).
  const sessionId = sessionIdOf(ticket.fm);
  const transcript = sessionId ? await findStream(sessionId) : null;
  // 갈림길이 하나 늘었다: **이 티켓을 물고 있는 워커의 엔진**(§4-3 · §비주얼 §23 ⑤). 그 엔진에
  // 없는 기능이 있으면 화면이 그걸 말한다 — 진입점을 지우지 않는다. 완료 티켓은 아무도 안 물고
  // 있어 `null`이고, 그때는 종전 빈 상태 그대로다(추측해서 문구를 고르지 않는다).
  const engine = holderEngine(workers, ticket.stem);

  // 요구사항 왕복 스레드 — 보드 카드의 답변 다이얼로그와 **같은 함수**가 엮는다(§1 · §2).
  const thread = threadOf(tickets, ticket, config);
  const answerOptions = lastQuestionOptions(thread);

  // 읽기 전용 본문 — 스레드가 데려간 `## 질문 n` 절을 뺀 것. 편집 폼은 아래에서 원문을 쓴다.
  const bodyRead = bodyWithoutQuestions(ticket.body);

  // 진행 계획(§2-11① · §비주얼 §59) — `## 진행 계획` 절이 없으면 빈 배열이고 그때 진행 기록은
  // 개정 전 화면 그대로다(`<SessionStream>` 기본값과 같은 판정).
  const plans = planOf(ticket.body);

  // 편집 폼의 persona select 선택지. **보드의 발행 다이얼로그와 같은 규칙**이다(§2 편집 항):
  // `listPersonas` 결과 중 `body !== null`(= PROFILE.md가 있다). 여기서 `readdir`을 다시 하면
  // 이름 규칙 밖 디렉터리가 선택지에 들어온다 — 이미 읽은 `config`·`tickets`를 넘긴다.
  const personas = (await listPersonas(config.personas, tickets))
    .filter((p) => p.body !== null)
    .map((p) => p.name);

  // 답변 대기인가 — 입력칸의 답변 모드이자 절이 서는 세 조건 중 하나다(§2-3 ①·③).
  // `.wip`은 `isAwaiting`의 `state === "open"`이 구조적으로 막는다(제약 5).
  const awaiting = isAwaiting(ticket);

  // **`진행 기록` 절**(§2-3 · §비주얼 §29) — 종전 절 셋(답변 카드 · 세션 스트림 · 질문·답변)이
  // 한 절 · 한 스크롤 상자 · 한 입력칸이 됐다. 절은 **한 번만 만든다**: 자리가 둘이라
  // (§2-3 ④ · §비주얼 §11 순서 줄) 조건을 두 자리에 흩뿌리면 둘이 어긋나 절이 사라지거나 두
  // 벌로 뜬다 — 여기서 만들고 아래는 `above` 하나로 꽂을 자리만 고른다.
  //
  // **절이 서는 조건이 넷이다**(§2-3 ①의 셋 + §2-11④ 넷째 — `## 진행 계획`이 있다). 종전엔
  // `session_id` 하나였고, 그러면 **한 번도 디스패치된 적 없는 요구사항의 답변칸이 통째로
  // 사라진다**(보드에서 접수한 요구가 정확히 그 모양이다). 넷째가 없으면 **회수된 열림 티켓**
  // (reap이 `session_id`를 지운다 — `tickets.py` `REAP_CLEAR`)이 남긴 계획도 같이 사라진다 —
  // 그 화면이 말하는 것이 정확히 "어디까지 갔나"다.
  const progressSection =
    sessionId || thread.length > 0 || awaiting || plans.length > 0 ? (
      <section className="space-y-2">
        {/* 스트림이 없는 엔진(오늘 codex)이면 트랜스크립트가 **있을 수 없다**(§4-3 표) —
            그래도 컴포넌트를 세운다:
            왜 없는지와 참견 폼의 사유가 그 안에 있고, 두 진입점(여기 · 워커 행)이 같은
            조각을 그린다(§비주얼 §23 ⑤). 스레드·답변 대기·계획만 있는 경우(극단 A — 세션이
            붙은 적 없는 요구사항 · 회수된 열림 티켓)도 여기로 온다: 상자는 `max-h`가 되고
            **스트림이 없다는 말을 하지 않는다**(§29 ④ — `대기` 배지가 이미 말한다). */}
        {transcript || engineCan("stream", engine) === false || thread.length > 0 || awaiting || plans.length > 0 ? (
          <SessionStream
            project={id}
            stem={ticket.stem}
            live={ticket.state === "wip"}
            engine={engine}
            thread={thread}
            plans={plans}
            answerOptions={answerOptions}
            defaultAnswer={defaultAnswerOf(ticket)}
            // 스트림 지분이 있는가 = 트랜스크립트 파일 하나다(§29 ② — 고정 높이와 머리 줄의 근거)
            stream={!!transcript}
            awaiting={awaiting}
            answerFile={awaiting ? `${awaitingOf(ticket)}${config.done}.md` : undefined}
            vault={vault}
          />
        ) : (
          <>
            {/* 이름이 `세션 스트림`이 아닌 이유: 이 절이 이제 세션이 안 남긴 것(사람이 쓴 답변)도
                든다. `질문·답변`이 아닌 이유도 같다 — `진행 기록`은 **이 티켓에 무슨 일이
                있었나** 한 가지를 가리킨다(§0-9 · §2-3 ①). `Card`가 아니라 `<section>` + `h2`다.
                `SessionStream`이 서는 분기에서는 그 컴포넌트가 이 h2를 머리 줄에 물고 간다
                (§비주얼 §29 ③ P173) — 여기는 상자 안이 통째로 빌 때만 남는 자리다. */}
            <h2 className="text-sm font-medium">진행 기록</h2>
            {/* 상자 안이 통째로 빌 때만 남는 자리다(§29 ④ 빈 상태 3행). 액션이 없다 — 사람이 할
                일이 없다(§9). `action` 자리엔 왜 없는지 사람이 직접 쳐 볼 글롭을 넣는다.
                **여기 남는 것은 "왜"를 모르는 경우뿐이다**(§비주얼 §23 ⑤): 완료 티켓
                리플레이처럼 되짚을 워커가 없어 엔진을 모르는 자리. 참이고, 왜인지 모르는 채로
                참이다 — 없는 값을 추측해 `codex입니다`라고 쓰지 않는다. */}
            <EmptyState
              text="트랜스크립트 없음"
              action={
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {`~/.claude/projects/*/${sessionId}.jsonl`}
                </span>
              }
            />
          </>
        )}
      </section>
    ) : null;

  // 자리 — **볼 것이 있으면 본문 위, 부재의 사유만 그리면 본문 아래**(§2-3 ④. 종전 규칙
  // `42ed33bc`, 답 `7208f987` = (c)가 조건 하나만 넓어진 채 그대로 선다). 갈리는 값은 종전과
  // 같은 성격이다: 볼 것이 있는가. 부재의 사유만 그리는 절은 본문을 밀 값이 없다.
  const above = !!transcript || thread.length > 0 || awaiting;

  // 복사 다이얼로그의 deps 선택지. 보드와 **같은 한 줄**이다(§3 — deps가 가리키는 이름은
  // `ticket:`이 아니라 stem이고, 큐 순서를 뒤집어야 방금 만든 티켓이 맨 위다).
  // 이미 읽은 `tickets`를 넘긴다 — `readdir`도 큐 스캔도 다시 하지 않는다.
  const depOptions = tickets
    .map((t) => ({ hash: t.stem, title: t.title, met: t.state === "done", duedate: t.fm.duedate ?? "" }))
    .reverse();

  return (
    // 폭은 **여기 한 곳이 문다**(§비주얼 §11 `max-w-3xl` 재판정): 1단일 때 768로 종전과 같고,
    // 2단일 때 왼쪽 단이 896(mono 93자)에서 멈춘다. 절이 자기 폭을 다시 정하면 이중 제한이다.
    // `mx-auto`는 쓰지 않는다 — 보드·워커가 `px-6` 왼쪽 정렬이라 이 화면만 가운데 오면 제목이 튄다.
    <div className="max-w-3xl space-y-6 xl:max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-lg font-semibold">{ticket.title || "(제목 없음)"}</h1>
          {/* 보드와 **같은 말**을 쓴다 — 같은 티켓이 한쪽에서 `deps 대기`, 다른 쪽에서
              `답변 대기`로 보이면 배지가 상태 표현의 유일한 출처인 의미가 없다(§1 보드) */}
          {isAwaiting(ticket) ? (
            <StatusBadge status="awaiting" days={daysSince(ticket.mtime)} />
          ) : (
            <StatusBadge
              status={statusOf(ticket)}
              continued={!!continued}
              href={continuedTarget ? href(continuedTarget) : undefined}
            />
          )}
          <span className="font-mono text-xs text-muted-foreground">{ticket.hash}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 복사는 **상태 3종 전부**에서 보인다 — 원본을 읽기만 하므로 `.wip`도 막을 이유가 없고,
              완료가 읽기 전용이 되면 "같은 일을 조건만 바꿔 다시" 하는 자리가 여기뿐이다(§2 복사).
              frontmatter는 **원문**을 넘긴다: `ticket.persona`는 `PERSONA_RE`를 못 넘긴 값을 ''로
              만든 것이라 사본이 조용히 페르소나를 잃는다(편집 폼이 같은 이유로 `fm`을 넘긴다). */}
          <NewTicketDialog
            project={id}
            personas={personas}
            colors={project.personaColors}
            deps={depOptions}
            personaDir={config.personas}
            variant="outline"
            copy={{
              stem: ticket.stem,
              title: ticket.fm.title ?? "",
              kind: ticket.fm.kind ?? "",
              persona: ticket.fm.persona ?? "",
              body: ticket.body,
            }}
            vault={vault}
          />
          {/* 열린 티켓만 지운다. 사유가 둘이라 문장을 넘긴다 — 툴팁이 그대로 쓴다 */}
          <DeleteTicketButton
            project={id}
            hash={hash}
            title={ticket.title}
            locked={
              ticket.state === "wip"
                ? "진행중 티켓은 삭제할 수 없습니다 — 세션에 할당된 티켓입니다"
                : ticket.state === "done"
                  ? "완료 티켓은 삭제할 수 없습니다 — 불변 기록입니다"
                  : null
            }
          />
        </div>
      </div>

      {/* 2단(§2 · §비주얼 §11). 왼쪽 = 이 화면에 온 이유(읽고 쓰는 것), 오른쪽 = 그동안 곁눈으로
          참조하는 값. 왼쪽이 `minmax(0,1fr)`인 것은 본문의 긴 경로 한 줄이 트랙을 밀어 오른쪽을
          찌그러뜨리지 않게 하기 위해서다. 가로 갭이 세로 리듬(24)보다 커야(32) 두 단이 갈린다 —
          그래서 구분선을 넣지 않는다. `xl`(1280) 미만은 1단이고, 왼쪽이 DOM에서 먼저라
          `order-*` 없이 왼쪽이 위로 온다(탭 순서 = 시각 순서). */}
      <div className="grid gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {/* 표시값으로는 엔진이 이 티켓을 못 찾는다 — 그 사실을 아는 유일한 자리가 여기다.
              화면의 해시를 사람이 `deps:`에 옮겨 적으면 선행이 `.done`이 돼도 영구 대기다(§식별자).
              판정은 `listTickets`가 엔진과 같은 조회(`find_any`)로 한 것이다 — 문자열 비교가 아니다. */}
          {!ticket.hashResolves && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>
                표시값 <span className="font-mono">{ticket.hash}</span>로는 엔진이 이 티켓을 찾지
                못합니다
              </AlertTitle>
              <AlertDescription className="grid gap-2">
                <span>
                  frontmatter <span className="font-mono">ticket:</span>이 파일명과 다릅니다. 엔진은
                  파일명으로만 찾으므로 <span className="font-mono">deps:</span>에는{" "}
                  <b className="font-mono">{ticket.stem}</b>을 적어야 합니다 — 표시값을 적으면 이
                  티켓이
                  <span className="font-mono"> .done</span>이 돼도 후행이 영구 대기입니다.
                </span>
                <span>
                  고치려면 <span className="font-mono">ticket:</span>을{" "}
                  <span className="font-mono">{ticket.stem}</span>으로 맞추거나 파일 이름을
                  바꾸세요.
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* 표시만 있고 잠금이 없다 — PM이 `awaiting`을 쓰고 `deps`에 안 걸었다. 조용히 두면
              사람이 답하기 전에 워커가 이 티켓을 집어 간다(§요구사항 레이어 결정 5) */}
          {awaitingUnlocked(ticket) && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>잠금 없는 답변 대기 — 이 티켓은 답변 전에 디스패치된다</AlertTitle>
              <AlertDescription>
                <span>
                  <span className="font-mono">awaiting: {awaitingOf(ticket)}</span>가 있는데{" "}
                  <span className="font-mono">deps</span>에 그 해시가 없습니다. 엔진은{" "}
                  <span className="font-mono">deps</span>만 보므로 답변 없이도 이 티켓이 큐에 뜹니다
                  — 요구사항의 <span className="font-mono">deps</span>에{" "}
                  <span className="font-mono">{awaitingOf(ticket)}</span>를 넣으세요.
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* `.done`은 이 큐의 불변 기록이다 — `.wip`과 **다른 사유로** 잠긴다(사람 요청
              `17e24fbc`, 답변 `432f9c40`). 진행중은 기다리면 풀리고 완료는 영영 안 풀리므로
              같은 문장을 쓰지 않는다. 파일이 사라졌을 때 무엇이 부서지는지를 적는다 —
              "읽기 전용입니다"만으로는 사람이 터미널에서 지우고 후행을 굶긴다. */}
          {ticket.state === "done" && (
            <Alert>
              <Lock aria-hidden className="text-status-done" />
              <AlertTitle>완료 티켓은 읽기 전용입니다</AlertTitle>
              <AlertDescription>
                완료는 이 큐의 불변 기록입니다 — 후행의 <span className="font-mono">deps</span>{" "}
                해소와 <span className="font-mono">req:</span> 역참조가 이 파일의 존재에 걸려 있어
                편집·삭제·할당 해제를 막습니다. 담당 세션 기록(
                <span className="font-mono">session_id</span>·<span className="font-mono">owner</span>
                )은 누가 한 일인지를 남기려고 그대로 둡니다. 이어서 할 일이 있으면 새 티켓을
                만드세요.
              </AlertDescription>
            </Alert>
          )}

          {/* 할당됨일 때만 보인다 — 그 판정은 컴포넌트 안에서 한다(해제 후 출력을 남기려면 여기서
              조건부로 렌더하면 안 된다). 상태 전이는 엔진 소관이라 워커 스크립트를 부른다(제약 2).
              **`.wip` 잠금 `Alert`도 이 컴포넌트가 그린다**(§2 · 사람 요구 `bfb1374a`) — 버튼이
              그 카드 안 오른쪽 끝에 붙는데 카드를 여기 두면 상태를 든 버튼만 넘길 수가 없다.
              `.done` 잠금 `Alert`는 위에 그대로 있다(둘은 배타라 화면 순서가 안 바뀐다).
              마크만 서버가 그려 넘긴다 — `WipWorker`는 `node:fs`를 타서 클라이언트로 못 간다.

              **`.done`에서는 `assigned`를 끈다**(사람 요구 `8ec6cd6d`). 디스패치된 티켓은
              완료돼도 `session_id`를 들고 있어 `assigned`가 거의 항상 참인데, 거기서 해제는 큐를
              바꾸지 못하고(`release`가 뗄 접미사가 없고 `select`·`reap` 어느 쪽도 완료를 안 본다)
              `clear`가 담당 세션 기록만 지운다. `assigned`·`wip`이 둘 다 거짓이면 이 컴포넌트가
              통째로 사라진다 — 비활성 버튼이 아니라 없는 것이고, 사유는 위 잠금 `Alert`가 말한다.
              서버 액션 `unassignTicket`도 같은 판정을 한 번 더 한다(화면 제약은 검증이 아니다). */}
          <UnassignButton
            project={id}
            hash={hash}
            worker={workers[0]?.name ?? null}
            assigned={ticket.assigned && ticket.state !== "done"}
            ghost={ticket.state === "open" && ticket.assigned}
            wip={ticket.state === "wip"}
            mark={<WipWorker t={ticket} />}
          />

          {/* 볼 것이 있으면 여기다 — 본문 위(§2-3 ④). 스트림·왕복을 보러 여는 화면에서 본문을
              지나 스크롤하지 않고, 답변 대기 요구사항에서는 이 절이 **사실상 제목 직하**다
              (`14c88df4`의 근거가 여기서 유지된다 — 그 위에는 "무엇을 할 수 없는가"만 남는다).
              대가는 알고 고른 것이다: 절이 580px이라 1440×900에서 본문 시작이 접힌 자리 아래로
              내려간다. **답이 달려도 절이 안 움직인다**(`9feae652`가 만든 두 번째 자리는
              없어졌다) — 같은 티켓을 두 번 여는 사람이 같은 지도를 받는다. */}
          {above && progressSection}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">본문</h2>
            {/* `.wip`이면 이 절이 파일을 따라간다(§2-4 ③) — 세션이 `## Done when` 상자를 켜는
                대로 새로고침 없이 바뀐다. 판정은 **상태 하나**고 엔진을 안 본다: `.done`은 불변
                기록이고 열림은 편집 폼이라(사람이 쓰던 글) 둘 다 이 조각을 안 세운다. 기준선
                mtime은 큐 스캔이 이미 읽어 둔 값이라 `stat`이 늘지 않는다. */}
            {ticket.state === "wip" && (
              <WipBodyPolling project={id} stem={ticket.stem} mtime={ticket.mtime} />
            )}
            {/* **열린 티켓만 편집 폼이다.** `.wip`(세션이 물고 있다)과 `.done`(불변 기록)은 같은
                읽기 전용 자리를 쓴다 — 사유는 위 Alert가 각자 말한다. 판정을 상태 하나로 두는
                이유: `!== "open"`이면 나중에 상태가 늘어도 기본이 읽기 전용이다. */}
            {ticket.state !== "open" ? (
              // 읽기만 한다 — 원문일 이유가 없다(§비주얼 §10). 편집 폼 쪽은 종전대로 원문이다.
              // `## 질문 n`은 빼고 그린다 — 아래 스레드가 답까지 짝지어 들고 있는 유일한 출처다.
              // 걸러낸 뒤 남는 게 없으면 제목만 남는 절이 아니라 빈 상태다.
              // 요구 접수는 입력칸 값을 그대로 본문으로 쓴다(§3) — 그 앞부분만 사람이 친
              // 줄바꿈을 그린다(§10 면제). 뒤에 붙는 `## 결과`는 에이전트가 감은 글이라
              // **같은 본문 안에서 갈린다**: 첫 `heading`에서 멈추는 변환이라 블록은 하나다
              // (쪼개면 루트의 `[&>:first-child]:mt-0`이 뒤쪽에도 걸려 `mt-6`이 죽는다).
              bodyRead ? (
                <Markdown
                  text={bodyRead}
                  breaks={ticket.fm.kind === "request" ? "untilHeading" : undefined}
                  vault={vault}
                />
              ) : (
                <EmptyState text="본문 없음" />
              )
            ) : (
              // 폼에는 frontmatter **원문**을 넣는다. `ticket.persona`는 PERSONA_RE를 못 넘긴 값을
              // ''로 만든 것이라, 그대로 저장하면 사람이 적어둔 값을 조용히 지운다.
              <TicketEditForm
                project={id}
                hash={hash}
                title={ticket.fm.title ?? ""}
                kind={ticket.fm.kind ?? ""}
                persona={ticket.fm.persona ?? ""}
                priority={ticket.priority}
                effective={ticket.effective}
                inheritedFrom={priorityInheritedFrom}
                duedate={ticket.fm.duedate ?? ""}
                duedateBaseline={ticket.baseline}
                remainingMs={remainingMs}
                precedentDuedates={precedentDuedates}
                followerDuedates={followerDuedates}
                personas={personas}
                colors={project.personaColors}
                body={ticket.body}
                vault={vault}
              />
            )}
          </section>

          {/* 부재의 사유만 그리면 종전 자리 — 왼쪽 단 마지막이다(§2-3 ④). 따라갈 사건이 0개고
              스레드도 답변 대기도 없어 그리는 것이 안내 한 줄뿐이라(codex 안내 ·
              `트랜스크립트 없음`) 본문을 밀 값이 없다. */}
          {!above && progressSection}
        </div>

        {/* 오른쪽 단 — 왼쪽을 스크롤하는 동안 따라다닌다(§2). 세 값이 한 벌이다:
            `self-start`가 없으면 그리드 아이템이 왼쪽 단 높이만큼 늘어나 `sticky`가 움직일
            여지를 잃고(다 맞는데 안 따라다닌다), `top-0`은 스크롤 상자(`main`)의 **콘텐츠 박스**
            위 = 뷰포트 72px이며(헤더 `h-12` 48 + `main`의 `py-6` 24 — sticky 기준은 스크롤러의
            패딩만큼 안쪽이다, 1440×900 실측), `max-h`의 4.5rem은 거기서 뷰포트 바닥까지의
            높이라 **그 72와 같은 수여야** 바닥이 안 잘린다.
            **`top-18`이 아니다**: 스크롤 주체가 문서에서 `main`으로 내려가면서(§비주얼 §4)
            기준이 뷰포트 위가 아니게 됐다. 화면에 보이는 자리는 종전과 같은 72px다.
            후행이 20건이면 이 단이 뷰포트보다 길어지는데 그때 `overflow-y-auto`가 받는다. */}
        <div className="min-w-0 space-y-6 xl:sticky xl:top-0 xl:max-h-[calc(100vh-4.5rem)] xl:self-start xl:overflow-y-auto">
          <section className="space-y-2">
            <h2 className="text-sm font-medium">frontmatter</h2>
            {/* `table-fixed`가 §비주얼 §11의 216px 값 열을 **실제로** 만든다. 기본 `auto`에서는
                `session_id` 36자의 min-content가 표를 352px 밖으로 밀고, `Table` 컨테이너의
                `overflow-x-auto`가 그걸 가로 스크롤로 받아 값이 잘려 보인다(1440 실측).
                `break-words`는 min-content 기여를 바꾸지 않으므로 폭을 고정해야 줄이 접힌다.
                기본 노출을 `assigned_at`까지로 줄이는 토글(§43 ①)은 클라이언트 상태라
                `FrontmatterTable`(ticket-ui.tsx)이 가진다. */}
            <FrontmatterTable fm={ticket.fm} file={path.basename(ticket.path)} />
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium">관계</h2>
            {/* **선행을 unmet으로 걸러내지 않는다**(§2, `b9775505`) — 걸러면 충족된 선행이 라벨 없이
                떠서 `막고 있는 것 없음` 바로 밑에 배지가 붙고 한 라벨 안에서 두 문장이 서로를 부정했다.
                막혀 있는지는 머리의 상태 배지가 말하고, 개별 해시의 상태는 배지 아이콘이 말한다.
                한 줄로 합친다(§43 ②) — `[선행 배지들] → 이 티켓 → [후행 배지들]`. 후행도
                `TicketLine`(제목 포함) 대신 `DepBadge`로 그린다 — 선행과 같은 모양이라야 한 줄에
                자연스럽게 섞인다. 선행·후행 둘 다 0건이어도 이 행은 남는다 — "이 티켓" 칩이
                막힌 것 없음도 진술한다. */}
            <div className="flex flex-wrap items-center gap-2">
              {deps.map((d) => (
                <DepBadge
                  key={d.hash}
                  hash={d.hash}
                  kind={d.kind}
                  href={d.hit ? href(d.hit) : undefined}
                />
              ))}
              {deps.length > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              )}
              <Badge variant="secondary">이 티켓</Badge>
              {blocked.length > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              )}
              {blocked.map((t) => (
                <DepBadge
                  key={t.path}
                  hash={t.hash}
                  kind={t.state === "done" ? "met" : "unmet"}
                  href={href(t)}
                />
              ))}
            </div>

            {/* 출처/파생 — 같은 절 안이지만 구분선으로 갈라 둔다(§2 "`deps` 관계와 섞지 않는다").
                작업 티켓엔 `요구사항` 한 줄, 요구사항엔 나온 티켓 목록. 둘 다 없는 평범한 티켓엔
                아무것도 안 붙는다 — `kind: request`일 때만 "아직 없다"를 말할 값이 있다. */}
            {(req || derived.length > 0 || ticket.kind === "request") && (
              <div className="space-y-4 border-t pt-4">
                {req && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">요구사항</p>
                    {reqTicket ? (
                      <TicketLine t={reqTicket} href={href(reqTicket)} />
                    ) : (
                      // 큐에 없는 stem — deps `missing` 배지와 같은 처리다. 사유만 바꾼다:
                      // `req`는 엔진 잠금이 아니라서 이 티켓이 굶지는 않는다(출처를 잃을 뿐이다).
                      <DepBadge
                        hash={req}
                        kind="missing"
                        hint="큐에 없는 요구사항 stem — 출처를 따라갈 수 없다"
                      />
                    )}
                  </div>
                )}
                {(derived.length > 0 || ticket.kind === "request") && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">이 요구사항에서 나온 티켓</p>
                    {derived.length === 0 ? (
                      <EmptyState text="아직 쪼갠 티켓 없음" />
                    ) : (
                      <div className="space-y-1">
                        {derived.map((t) => (
                          <TicketLine key={t.path} t={t} href={href(t)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 아카이브 — 같은 절의 다섯째 줄이고 양방향이다(§5-3 §표시 규약 ④). 보드에서는 이
                관계가 대상 카드 하단 한 줄로 서고, 여기서는 양쪽 상세가 서로를 가리킨다.
                아카이브가 없는 평범한 티켓엔 아무것도 안 붙는다 — 말할 값이 0이다. */}
            {(archives || archivers.length > 0) && (
              <div className="space-y-4 border-t pt-4">
                {archives && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">아카이브 대상</p>
                    {archiveTarget ? (
                      <TicketLine t={archiveTarget} href={href(archiveTarget)} />
                    ) : (
                      // 큐에 없는 stem — `req:`와 같은 처리다. 사유만 바꾼다: 아카이브 키도
                      // 엔진 잠금이 아니라서 이 티켓이 굶지는 않는다(대상을 잃을 뿐이다).
                      <DepBadge
                        hash={archives}
                        kind="missing"
                        hint="큐에 없는 아카이브 대상 stem — 대상을 따라갈 수 없다"
                      />
                    )}
                  </div>
                )}
                {archivers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">아카이브</p>
                    <div className="space-y-1">
                      {archivers.map((t) => (
                        <TicketLine key={t.path} t={t} href={href(t)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
