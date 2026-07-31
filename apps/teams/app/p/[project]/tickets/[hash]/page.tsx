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
import {
  AnswerCard,
  AnswerThread,
  DeleteTicketButton,
  NewTicketDialog,
  TicketEditForm,
  UnassignButton,
} from "@/components/ticket-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { findTicket } from "@/lib/engine";
import {
  awaitingOf,
  awaitingUnlocked,
  depBadges,
  derivedFrom,
  isAwaiting,
  listTickets,
  referrers,
  reqOf,
  resolveDep,
  statusOf,
  threadOf,
  type Ticket,
} from "@/lib/queue";
import { getProject, listPersonas, resolveConfig } from "@/lib/projects";
import { findTranscript, sessionIdOf } from "@/lib/transcript";
import { decodeHash } from "@/lib/urls";
import { listWorkers } from "@/lib/workers";

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
        <span className="font-mono text-xs">{t.hash}</span> {t.title}
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

  const tickets = await listTickets(project.root, config);
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

  const workers = await listWorkers(project.root);
  // 선행 = deps **전부**(미충족으로 걸러내지 않는다). 종류·순서 판정은 보드와 같은 헬퍼가 한다.
  const deps = depBadges(tickets, ticket, config);
  const blocked = referrers(tickets, ticket, config); // 후행 = 이 티켓을 deps로 둔 것 = 역참조
  // 관계 링크도 **stem**이다 (보드와 같은 규칙 — §식별자)
  const href = (t: Ticket) => `/p/${id}/tickets/${encodeURIComponent(t.stem)}`;

  // 출처/파생 (§요구사항 레이어 결정 5). `deps` 관계와 **섞지 않는다** — 선후가 아니라 출처다.
  const req = reqOf(ticket);
  const reqTicket = req ? resolveDep(tickets, req, config) : null;
  const derived = derivedFrom(tickets, ticket, config);

  // 세션 스트림 (§2-1). 갈림길은 **세션이 붙은 적이 있는가** 하나다(§9 빈 상태 표):
  // `session_id`가 없거나 UUID가 아니면 절 자체를 감추고(상태 배지가 이미 말한다), 있는데
  // 글롭 매치가 0개·2개 이상이면 `트랜스크립트 없음`이다. **어느 쪽도 에러로 그리지 않는다.**
  const sessionId = sessionIdOf(ticket.fm);
  const transcript = sessionId ? await findTranscript(sessionId) : null;

  // 요구사항 왕복 스레드 — 보드 카드의 답변 다이얼로그와 **같은 함수**가 엮는다(§1 · §2).
  const thread = threadOf(tickets, ticket, config);

  // 편집 폼의 persona select 선택지. **보드의 발행 다이얼로그와 같은 규칙**이다(§2 편집 항):
  // `listPersonas` 결과 중 `body !== null`(= PROFILE.md가 있다). 여기서 `readdir`을 다시 하면
  // 이름 규칙 밖 디렉터리가 선택지에 들어온다 — 이미 읽은 `config`·`tickets`를 넘긴다.
  const personas = (await listPersonas(config.personas, tickets))
    .filter((p) => p.body !== null)
    .map((p) => p.name);

  // 복사 다이얼로그의 deps 선택지. 보드와 **같은 한 줄**이다(§3 — deps가 가리키는 이름은
  // `ticket:`이 아니라 stem이고, 큐 순서를 뒤집어야 방금 만든 티켓이 맨 위다).
  // 이미 읽은 `tickets`를 넘긴다 — `readdir`도 큐 스캔도 다시 하지 않는다.
  const depOptions = tickets
    .map((t) => ({ hash: t.stem, title: t.title, met: t.state === "done" }))
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
            <StatusBadge status={statusOf(ticket)} />
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
          />
          {/* 열린 티켓만 지운다. 사유가 둘이라 문장을 넘긴다 — 툴팁이 그대로 쓴다 */}
          <DeleteTicketButton
            project={id}
            hash={hash}
            title={ticket.title}
            locked={
              ticket.state === "wip"
                ? "진행중 티켓은 삭제할 수 없습니다 — 세션이 물고 있습니다"
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
        <div className="space-y-6">
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

          {/* `.wip`은 지금 세션이 그 파일로 일하고 있다 — 잠금 사유를 그 자리에 적는다(제약 5) */}
          {ticket.state === "wip" && (
            <Alert>
              <Lock aria-hidden className="text-status-active" />
              <AlertTitle>세션이 물고 있습니다 — 편집·삭제 잠금</AlertTitle>
              <AlertDescription>
                진행중 티켓은 읽기만 합니다. 세션이 죽었다면 아래 <b>할당 해제</b>로 큐에 되돌린 뒤
                편집하세요.
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
                편집·삭제를 막습니다. 이어서 할 일이 있으면 새 티켓을 만드세요.
              </AlertDescription>
            </Alert>
          )}

          {/* 할당됨일 때만 보인다 — 그 판정은 컴포넌트 안에서 한다(해제 후 출력을 남기려면 여기서
              조건부로 렌더하면 안 된다). 상태 전이는 엔진 소관이라 워커 스크립트를 부른다(제약 2) */}
          <UnassignButton
            project={id}
            hash={hash}
            worker={workers[0]?.name ?? null}
            assigned={ticket.assigned}
            ghost={ticket.state === "open" && ticket.assigned}
          />

          {/* 답변 대기일 때만. `.wip`은 `isAwaiting`의 state 조건이 구조적으로 막는다(제약 5).
              자리는 **제목 직하**다(§2, 사람 요청 `14c88df4`) — 이 화면을 여는 이유가 답을 쓰는 것
              하나인데 종전은 본문 편집 폼까지 지나야 답변칸이 나왔다. 잠금 Alert·할당 해제는 이 위에
              남는다: "무엇을 할 수 없는가"가 액션보다 앞이다. */}
          {isAwaiting(ticket) && (
            <AnswerCard
              project={id}
              hash={hash}
              answerFile={`${awaitingOf(ticket)}${config.done}.md`}
              thread={thread}
            />
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">본문</h2>
            {/* **열린 티켓만 편집 폼이다.** `.wip`(세션이 물고 있다)과 `.done`(불변 기록)은 같은
                읽기 전용 자리를 쓴다 — 사유는 위 Alert가 각자 말한다. 판정을 상태 하나로 두는
                이유: `!== "open"`이면 나중에 상태가 늘어도 기본이 읽기 전용이다. */}
            {ticket.state !== "open" ? (
              // 읽기만 한다 — 원문일 이유가 없다(§비주얼 §10). 편집 폼 쪽은 종전대로 원문이다
              <Markdown text={ticket.body} />
            ) : (
              // 폼에는 frontmatter **원문**을 넣는다. `ticket.persona`는 PERSONA_RE를 못 넘긴 값을
              // ''로 만든 것이라, 그대로 저장하면 사람이 적어둔 값을 조용히 지운다.
              <TicketEditForm
                project={id}
                hash={hash}
                title={ticket.fm.title ?? ""}
                kind={ticket.fm.kind ?? ""}
                persona={ticket.fm.persona ?? ""}
                personas={personas}
                colors={project.personaColors}
                body={ticket.body}
              />
            )}
          </section>

          {/* 답이 달린 뒤의 같은 스레드 — 읽기 전용 기록이다(§2 · 사람 요청 `9feae652`).
              답은 `<A>.done.md`에 따로 살아서, 답변 카드가 사라지면(`isAwaiting`이 꺼진다)
              답변 본문이 화면 어디에도 없었다. 조건은 하나다: 카드가 없고 스레드가 있으면 뜬다 —
              상태를 따로 묻지 않는다(대기 중에는 카드가 이미 같은 스레드를 들고 있어서, 두 벌이
              뜨지 않는 것도 이 조건이 같이 준다). 입력칸도 `답변 달기`도 없다. */}
          {!isAwaiting(ticket) && thread.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">질문·답변</h2>
              <AnswerThread thread={thread} />
            </section>
          )}

          {/* 세션 스트림(§2-1)은 왼쪽 단 마지막이다. §비주얼 §9 `h-[32rem]`은 이 배치를 안 묻는다 —
              고정 높이 + 자체 스크롤이라 페이지 어디에 놓이든 절(564px)이 한 화면(852px)에 담긴다.
              종전 주석이 근거로 삼던 "frontmatter 표 다음"이라는 서술이 틀렸던 것이고 수는 맞았다
              (§비주얼 §11 재판정). 페이지 높이에 맡기지 않는 둘째 근거는 그대로다: 2094줄
              트랜스크립트가 페이지를 늘리면 브라우저 스크롤과 자동 스크롤이 서로를 민다. */}
          {sessionId && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">세션 스트림</h2>
              {transcript ? (
                <SessionStream project={id} stem={ticket.stem} live={ticket.state === "wip"} />
              ) : (
                // 액션이 없다 — 사람이 할 일이 없다(§9). `action` 자리엔 왜 없는지 사람이 직접 쳐 볼
                // 글롭을 넣는다. "Claude 세션이 아닙니다"라고 말하지 않는다: 화면은 못 찾았다는 것만
                // 알고 왜 없는지는 모른다(Codex 티켓도 `session_id`를 갖는다 — `tick.sh:124`).
                <EmptyState
                  text="트랜스크립트 없음"
                  action={
                    <span className="font-mono text-xs break-all text-muted-foreground">
                      {`~/.claude/projects/*/${sessionId}.jsonl`}
                    </span>
                  }
                />
              )}
            </section>
          )}
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
        <div className="space-y-6 xl:sticky xl:top-0 xl:max-h-[calc(100vh-4.5rem)] xl:self-start xl:overflow-y-auto">
          <section className="space-y-2">
            <h2 className="text-sm font-medium">frontmatter</h2>
            {/* `table-fixed`가 §비주얼 §11의 216px 값 열을 **실제로** 만든다. 기본 `auto`에서는
                `session_id` 36자의 min-content가 표를 352px 밖으로 밀고, `Table` 컨테이너의
                `overflow-x-auto`가 그걸 가로 스크롤로 받아 값이 잘려 보인다(1440 실측).
                `break-words`는 min-content 기여를 바꾸지 않으므로 폭을 고정해야 줄이 접힌다. */}
            <Table className="table-fixed">
              <TableBody>
                {Object.entries(ticket.fm).map(([k, v]) => (
                  <TableRow key={k} className="h-9">
                    {/* 최장 키 `assigned_at` 11자 ≈ 84 + `px-3` 24 = 108 ≤ 112. `w-40`은 352px
                        안에서 키 열이 값 열보다 넓어진다 */}
                    <TableCell className="w-28 px-3 py-0 text-sm text-muted-foreground">
                      {k}
                    </TableCell>
                    {/* 값은 거의 다 식별자·경로·시각이다. 문장인 title만 예외로 읽는 글꼴.
                        `break-all`이 아니라 `break-words`다 — 216px 값 열에서 `session_id`가
                        넘치는데 전자는 16진수 한가운데를, 후자는 하이픈·`/`에서 끊는다.
                        `whitespace-normal`은 shadcn `TableCell`의 `whitespace-nowrap`을 벗기는
                        값이다 — 안 벗기면 `break-words`가 걸릴 자리가 아예 없어 값이 잘린다 */}
                    <TableCell className="px-3 py-0 whitespace-normal">
                      <span className={k === "title" ? "text-sm" : "font-mono text-xs break-words"}>
                        {v || "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="h-9">
                  <TableCell className="w-28 px-3 py-0 text-sm text-muted-foreground">
                    파일
                  </TableCell>
                  <TableCell className="px-3 py-0 font-mono text-xs break-words whitespace-normal">
                    {path.basename(ticket.path)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium">관계</h2>
            {/* **선행을 unmet으로 걸러내지 않는다**(§2, `b9775505`) — 걸러면 충족된 선행이 라벨 없이
                떠서 `막고 있는 것 없음` 바로 밑에 배지가 붙고 한 라벨 안에서 두 문장이 서로를 부정했다.
                막혀 있는지는 머리의 상태 배지가 말하고, 개별 해시의 상태는 배지 아이콘이 말한다.
                라벨은 건수를 세어주지 않는다 — 보드 카드와 같은 문구다(사람 요청 `1f2ac454`). */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">선행 — 이 티켓의 deps</p>
              {deps.length === 0 ? (
                <EmptyState text="선행 없음" />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {deps.map((d) => (
                    <DepBadge
                      key={d.hash}
                      hash={d.hash}
                      kind={d.kind}
                      href={d.hit ? href(d.hit) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">후행 — 이 티켓을 deps로 둔 티켓</p>
              {blocked.length === 0 ? (
                <EmptyState text="후행 없음" />
              ) : (
                <div className="space-y-1">
                  {blocked.map((t) => (
                    <TicketLine key={t.path} t={t} href={href(t)} />
                  ))}
                </div>
              )}
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
          </section>
        </div>
      </div>
    </div>
  );
}
