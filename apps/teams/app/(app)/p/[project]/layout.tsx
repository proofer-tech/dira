/** 프로젝트 스코프 셸 — 헤더·내비·전환기 (DESIGN.md §0-1 · 비주얼 디렉션 §4).
 *
 *  프로젝트는 URL이 담는다. 모듈 전역에 "현재 프로젝트"를 두지 않는다 — 서버 컴포넌트는 동시에
 *  여러 요청을 처리하므로 전역에 담으면 엉뚱한 큐에 쓰는 사고가 난다. */
import { homedir } from "node:os";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Bell,
  CircleDot,
  Clock,
  CloudOff,
  MessageSquareReply,
  RotateCcw,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  BrandMark,
  MarkFailuresReadButton,
  MarkResumeReadButton,
  NotificationPopover,
  RefreshButton,
  ProjectNav,
  ProjectSwitcher,
} from "@/components/project-switcher";
import { SettingsDialog, type AuthView } from "@/components/settings-dialog";
import { StatusBadge, daysSince, statusLabel } from "@/components/status-badge";
import { RequestDialog, UnassignButton } from "@/components/ticket-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readAuth, readOtherEngineAuth } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import type { ResumeEvent } from "@/lib/machine-state";
import { readSummary, readProjects, readLanguage } from "@/lib/projects";
import type { DueAlert } from "@/lib/queue";
import { engineLimits, formatTokens, listUsage, usageRates, type EngineLimit } from "@/lib/usage";
import { engineName, workerGroups } from "@/lib/workers";
import { dateTimeLabel, remainingLabel, tildePath, timeLabel } from "@/lib/urls";
import { cn } from "@/lib/utils";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ project: string }>;
}) {
  const { project: id } = await params;
  const home = homedir();
  const projects = await readProjects();
  // 등록 안 된 프로젝트는 404다. 경로를 조립해 읽어보지 않는다 — 등록된 root가 이 앱의 권한 범위다.
  if (!projects.some((t) => t.id === id)) notFound();

  // 전환기 항목의 카운트는 팔레트를 열 때 세지 않고 여기서 한 번에 센다(프로젝트는 한 자릿수).
  const items = await Promise.all(
    projects.map(async (t) => {
      const s = await readSummary(t);
      return {
        id: t.id,
        name: t.name,
        shortRoot: tildePath(t.root, home),
        open: s.open,
        running: s.workers.filter((w) => w.status === "running").length,
        connected: s.connected,
        error: s.error,
        assigned: s.assigned, // §0-2 알림용. 전환기는 이 필드를 쓰지 않는다
        // §0-10 ④ 알림용. 판정은 `readSummary`가 `isAwaiting`으로 이미 했다 — 새 fs 읽기 0
        awaiting: s.awaiting,
        // §0-10 ⑦ 알림용(§1-4). 판정은 `readSummary`가 `dueAlertOf`로 이미 했다 — 새 fs 읽기 0
        due: s.due,
        // §0-10 ⑤⑥ 알림용(§0-14). 프로젝트마다 값이 같다(머신 스코프) — 전환기는 이 필드를 쓰지 않는다
        machine: s.machine,
        // §0-10 ③의 `할당 해제`가 부를 워커. 티켓 상세와 **같은 규칙**이다(`workers[0]`) —
        // 어느 워커 스크립트든 같은 큐를 되돌리므로 첫 번째면 된다. 0개면 컴포넌트가 비활성 + 사유다
        worker: s.workers[0]?.name ?? null,
        // §0-5 알림용. `readSummary`가 이미 `listWorkers`를 불렀으므로 워커를 다시 읽지 않는다.
        // 정상 상태에서는 항상 빈 배열이고 그때 항목 노드가 아예 없다.
        // `log`·`at`은 `읽음으로 표시`가 쓰는 키다(§0-5 §읽음 처리 — 단위가 워커가 아니라
        // **실패 하나**고 그 키가 로그 파일명이다). 화면에 그리는 것은 여전히 이름과 사유뿐이다.
        failures: s.workers.flatMap((w) =>
          w.lastFailure
            ? [
                {
                  name: w.name,
                  reason: w.lastFailure.reason,
                  log: w.lastFailure.log,
                  at: w.lastFailure.at,
                },
              ]
            : [],
        ),
        // §0-4 인증 배너용. claude 엔진 워커가 있는가 — **못 읽었으면 판정 불가 = true**다
        // (판정 불가를 "괜찮다"로 바꾸면 §0-4가 닫으려던 침묵이 그대로 돌아온다).
        // 워커도 `readSummary`가 이미 읽어 둔 것이다 — 새 fs 읽기 0(§성능 예산).
        claude: !s.connected || s.workers.some((w) => engineName(w.engine) === "claude"),
        // §0-8 하단 status bar용. 엔진 목록은 **그 프로젝트 워커들의 `engineName`**에서 온다 —
        // 배너가 쓰는 그 함수 그대로다(두 벌 적지 않는다). 소비량 폴백은 워커별 합을 엔진으로
        // 접어야 해서 실효 이름도 같이 든다. `readSummary`가 이미 읽은 워커라 **새 fs 읽기 0**.
        engines: s.workers.map((w) => ({ worker: w.effName, engine: engineName(w.engine) })),
        // §1-2 idle 워커 풀용. 바로 위 `engines` 행과 **같은 `s.workers`**를 한 번 더 접는
        // 것뿐이라 새 fs 읽기 0 · 서브프로세스 0이고, 보드 툴바에서 종전 워커 조회 1회가
        // 통째로 빠진다(§1-2 §비용). 빈 그룹은 안 담기므로 `groups.length > 0`이 곧 **워커 > 0**이다.
        groups: workerGroups(s.workers),
      };
    }),
  );
  const current = items.find((t) => t.id === id)!;
  const root = projects.find((t) => t.id === id)!.root;
  // 칸의 순서 = 워커가 선 순서. 중복은 접는다 — 같은 엔진을 무는 워커가 둘이어도 한도는 하나다.
  const engines = [...new Set(current.engines.map((w) => w.engine))].filter(Boolean);
  // idle 워커 풀의 값(§1-2 · §비주얼 §38). 필터도 검색도 이 값을 안 좁힌다 — 셸이 그리므로
  // 구조적으로 못 좁힌다. `idle`이 0개면 값 자리에 문장이 온다(§38 §문구 둘). `전원 running`은
  // `running`이 하나라도 있을 때만 참이다 — `crontab -l`이 실패하면 전원 `stopped`가 되고
  // 그때는 아는 것만 말한다(`없음`).
  const idle = current.groups.find((g) => g.status === "idle");
  const idlePool =
    idle?.names.join(" ") ??
    (current.groups.some((g) => g.status === "running") ? "없음 — 전원 running" : "없음");
  // 토큰은 머신당 하나라 프로젝트 요약에 들어 있지 않다(§0-4). 증상("내 큐가 안 돈다")이
  // 나타나는 화면이 여기라 판정도 여기서 한다. 값은 헤더 `설정` 버튼과 배너 CTA가 같이 쓴다 —
  // 진입점 둘이 같은 컴포넌트를 두 번 쓰고 전역 상태는 만들지 않는다(§0-4).
  const rawAuth = await readAuth();
  // §4-3 카탈로그 나머지 엔진의 상태 층 — 판정 없이 사실만(§0-4 §개정 `b0966e66`).
  const otherEngines = await readOtherEngineAuth();
  // ⑦의 문구만 이 사전을 쓴다(§1-4) — ①~⑥은 아직 안 옮겨졌다, 이 티켓 몫이 아니다.
  const locale = await readLanguage();
  const auth = {
    path: tildePath(rawAuth.path, home),
    savedAt: rawAuth.savedAt,
    // 층 ⓪은 **찾은 절대경로 그대로**다 — 여러 벌 깔린 맥에서 어느 것을 쓰는지가 그 줄에 있다(§0-4 ⓪)
    cli: rawAuth.cli,
    // 헤더 버튼의 `인증 필요`는 머신 스코프라 **등록된 프로젝트 전부**를 보고 끈다 —
    // 전부 읽었고 전부 claude가 0일 때만 꺼진다(§0-4). 배너는 그 프로젝트만 본다(`current.claude`).
    claudeUsed: items.some((t) => t.claude),
    otherEngines,
  };

  // 셸 알림 종이 세는 일곱 (§0-10). **판정식은 §0-14 · §0-4 · §0-5 · §0-2 · 결정 5 · §1-4가
  // 그대로 갖는다** — 아래 일곱은 그 절들이 쓰던 조건 그대로이고 바뀐 것은 그리는 자리와 문구뿐이다.
  // 순서는 ⑤→⑥→①→②→③→④→⑦다(§0-14 — 머신이 큐보다 넓다. 네트워크가 없으면 인증이 있어도
  // 아무것도 안 된다). ①~④ 안에서는 종전 순서 그대로다: 인증이 없으면 아무것도 안 돌고, 다음이
  // 워커 전원, 마지막이 티켓 몇 건이다. ③과 ④는 둘 다 티켓이라 범위가 같고, 그때는 **사고가
  // 설계보다 위**다(③은 엔진이 만들지 않는 조합이고 ④는 왕복의 정상 단계다 — ④가 종에 드는
  // 것은 이상 상태라서가 아니라 사람이 답을 써야 그 큐가 다시 돌기 때문이다. §0-10 *④는 왜 여기
  // 드나* · 결정 4는 무수정이다). ⑤⑥은 `current.connected`를 안 건다 — 머신 상태는 큐를 못
  // 읽어도 참이다(§0-14). **⑦이 맨 아래인 이유도 순서 항과 같은 자다** — 마감은 큐가 막힌
  // 상태가 아니라 사람이 스스로 건 약속이고, 위 여섯이 뜬 판에서는 그것들이 먼저 풀려야 마감도 산다.
  const alerts = {
    offline: current.machine.offline,
    resume: current.machine.resume !== null,
    auth: !auth.savedAt && current.claude,
    failures: current.connected && current.failures.length > 0,
    assigned: current.connected && current.assigned.length > 0,
    awaiting: current.connected && current.awaiting.length > 0,
    due: current.connected && current.due.length > 0,
  };
  // 배지는 **켜진 알림의 개수 0~7**이다 — 건수를 합치지 않는다(⑤⑥이 들어와 4에서 6이 됐고,
  // ⑦이 들어와 7이 됐다 — §0-14 · §1-4).
  const alertCount = Object.values(alerts).filter(Boolean).length;
  const alertLabel = alertCount > 0 ? `알림 ${alertCount}건` : "알림 없음";

  return (
    <>
      <header className="sticky top-0 z-50 flex h-12 items-center gap-6 border-b bg-background px-6">
        {/* href는 그 프로젝트의 첫 화면 = **홈**이다(§7 · §비주얼 §4가 예고한 이동). 보드의 URL은
            안 움직인다 — `/p/<project>/`는 그대로다. `/`(프로젝트 관리)로 가는 길은 전환기 하단
            항목 하나로 남는다(§4). 나머지 값은 루트 셸과 같다(§14 · BrandMark). */}
        <BrandMark href={`/p/${id}/home`} />
        <ProjectNav id={id} />
        {/* 우측 끝은 전환기 오른쪽의 `설정`이다 — 두 셸이 같은 자리에 같은 것을 갖는다
            (§비주얼 §4). 헤더의 `gap-6`이 아니라 이 둘 사이는 `gap-2`라 묶어서 오른쪽으로 민다 */}
        <div className="ml-auto flex items-center gap-2">
          {/* 기능 → 매뉴얼(§상호 링크). `[종] [전환기] [설정]`(§0-10 · §비주얼 §28 ①) 앞에 붙여
              그 셋의 순서·`설정`이 우측 맨 끝이라는 못은 안 건드린다. 랜딩-only는 `/p/**` 자체가
              404라 이 자리를 따로 안 가린다. */}
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/docs/" />}>
            매뉴얼
          </Button>
          {/* 순서는 `[종] [전환기] [설정]`이다(§0-10 자리 · §비주얼 §28 ①). `설정`이 우측 맨 끝이라는
              §비주얼 §4의 못은 안 뽑는다 — 루트 셸(`/`)에는 종이 없고 거기도 `설정`이 끝이다.
              묶음의 `gap-2`는 무수정이고 종이 새 간격을 만들지 않는다 */}
          {/* 그릇이 `Popover`가 아니라 `NotificationPopover`인 이유는 그 컴포넌트 주석에 있다
              (§28 ④ `누르면` — 안에서 화면을 바꾸는 링크를 누르면 닫는다). 트리거·내용 마크업은
              **여기 그대로**다: 열림 상태 하나만 클라이언트로 넘어갔고 이 레이아웃은 서버 컴포넌트다 */}
          <NotificationPopover>
            {/* 배너가 들고 있던 `role="status"`(polite)를 종 옆의 라이브 리전이 물려받는다
                (§0-10 접근성). **팝오버 안에 두지 않는다** — 닫혀 있는 동안 DOM에 없으면
                낭독되지 않는다. 5초 폴링이 같은 문자열을 다시 그려도 텍스트가 안 바뀌면 낭독이
                없다(§비주얼 §4-2가 assertive를 polite로 내린 그 근거) */}
            <span role="status" className="sr-only">
              {alertLabel}
            </span>
            <PopoverTrigger
              render={
                // `disabled`가 아니다 — 0건이어도 눌리고 열린다(§0-10 답 `Q2=(나)`).
                // `relative`는 배지의 기준 상자다. 켜진 종에는 색을 안 준다(ghost 기본 currentColor).
                <Button variant="ghost" size="icon" aria-label={alertLabel} className="relative">
                  {/* `BellRing`·`BellDot`을 쓰지 않는다 — 켜짐/꺼짐은 **색만** 가른다(§비주얼 §28 ①).
                      크기는 Button 기본(size-4)이라 클래스로 다시 주지 않는다 */}
                  <Bell aria-hidden className={alertCount === 0 ? "text-muted-foreground" : undefined} />
                  {alertCount > 0 && (
                    // 솔리드다 — 종의 획 위에 겹치는 유일한 배지라 면이 불투명해야 한다(§28 ②).
                    // 수를 읽는 것은 트리거의 접근가능 이름이라 여긴 `aria-hidden`이다.
                    <Badge
                      aria-hidden
                      className="absolute top-0.5 right-0.5 h-4 min-w-4 justify-center rounded-full border-transparent bg-status-stale px-1 leading-none text-background"
                    >
                      {alertCount}
                    </Badge>
                  )}
                </Button>
              }
            />
            {/* 폭은 전환기 팔레트와 같은 448px이다 — 헤더 우측에서 열리는 상자 둘의 왼쪽 끝이
                어긋나지 않는다(§28 ④). 넘치면 스크롤한다: **상위 N건으로 자르지 않는다**
                (§0-2 · §0-5 · §0-10). `5rem` = 헤더 48 + sideOffset 4 + status bar 28 */}
            <PopoverContent
              align="end"
              className="max-h-[calc(100vh-5rem)] w-[28rem] overflow-y-auto"
            >
              <NotificationItems
                id={id}
                auth={auth}
                alerts={alerts}
                resume={current.machine.resume}
                failures={current.failures}
                assigned={current.assigned}
                awaiting={current.awaiting}
                worker={current.worker}
                due={current.due}
                locale={locale}
              />
            </PopoverContent>
          </NotificationPopover>
          <ProjectSwitcher projects={items} currentId={id} />
          <SettingsDialog auth={auth} />
        </div>
      </header>

      {/* 스크롤하는 것은 이 `main`이다(§비주얼 §4). `min-h-0`이 없으면 flex 자식 기본값
          (`min-height: auto`)이 내용만큼 늘어나 문서가 도로 길어진다.
          **배너 자리는 비었다**(§0-10) — `Alert` 셋이 헤더의 알림 종으로 갔고 본문이 그만큼
          위로 올라온다. 알림 유무로 보드 높이가 흔들리던 것이 없어진다 */}
      <main className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        {current.connected ? (
          <>
            {/* 요구 접수 다이얼로그 — **버튼 없이 `r`만 듣는다**(§3 · §0-6 `board.request`).
                요구는 워커 화면에서 세션이 죽는 걸 보다가, 티켓 상세를 읽다가 생긴다 —
                보드로 한 번 이동하게 하면 그 이동이 요구를 삼킨다. 보드에도 이 컴포넌트가
                있지만 그쪽은 버튼이고 키를 안 듣는다(§0-4 `SettingsDialog`과 같은 모양).
                **`connected`일 때만 선다**: 못 읽는 큐에는 접수해도 파일을 못 쓰는데,
                열리고 나서 실패 사유를 보여 주면 사람이 글을 다 쓴 뒤에 잃는다(§3). */}
            <RequestDialog project={id} trigger="hotkey" />
            {children}
          </>
        ) : (
          // 경로가 없는 건 파괴가 아니라 부재다 — destructive를 쓰지 않는다(§8).
          <Alert className="max-w-3xl">
            <Unplug aria-hidden className="text-status-stale" />
            <AlertTitle>프로젝트 &quot;{current.name}&quot;의 .dira를 읽을 수 없습니다</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span className="font-mono text-xs break-all">{current.error}</span>
              <span className="flex items-center gap-4">
                <RefreshButton />
                <Link href="/" className="text-sm underline">
                  프로젝트 관리
                </Link>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </main>

      {/* 토큰 status bar (§0-8 그릇 · §비주얼 §26). `sticky`도 `fixed`도 아니다 — 스크롤이
          `main` 안에 갇혀 있어(§비주얼 §4) 헤더 다음 형제로 서기만 하면 뷰포트 바닥에 붙는다.
          `footer`가 `body` 직계라 `contentinfo` 랜드마크가 공짜다(`role`을 손으로 안 붙인다).
          **워커가 0개면 노드 자체가 없다** — 빈 28px을 남기면 보드가 이유 없이 짧아진다.
          버튼이 0개고 `aria-live`도 없다: 이 바는 말하기만 한다(§0-8 · §26 ①).
          **조건이 `엔진 > 0`이 아니라 `워커 > 0`이다**(§1-2 §빈 상태 둘) — `TICKET_ENGINE`을
          못 읽은 워커만 있으면 엔진 칸이 0개인데, 그때도 idle 풀은 말할 것이 있다. 엔진 칸이
          0개여도 높이는 `h-7` 그대로다.
          **`flex-wrap`이 아니다** — 감으면 28이 56이 되고 그게 §0-8 판정 3이 "얇은 한 줄"로
          못 박은 그것이다. 세 단계(`lg` 속도 · `md` 리셋 · `sm` 게이지)를 다 거치고도 넘치면
          `ml-auto` idle 풀이 먼저 0폭이 되고 그다음 넘친 칸이 `overflow-hidden`으로 잘린다.
          // ponytail: 엔진 2개는 어느 폭에서도 안 넘친다. 3개는 360–439 · 640–751 · 768–963 ·
          // 1024–1202에서 넘치고 1203px부터 다 선다 — 오늘 이 큐의 엔진은 1개다.
          // 3개가 실재하면 그때 넷째 단계를 본다. */}
      {current.groups.length > 0 && (
        <footer className="flex h-7 shrink-0 items-center gap-6 overflow-hidden border-t bg-background px-6">
          {/* 값을 여기서 `await`하면 외부 GET(최대 5초)이 셸 전체를 붙잡아 보드가 그만큼 늦는다.
              경계를 세워 **껍데기와 엔진 이름을 먼저 세우고 게이지·`%`는 도착하면 채운다**
              (§26 ⑧ 로딩 — 스켈레톤도 스피너도 없다. 높이가 처음부터 28px이라 아무것도 안 밀린다).
              폴링 갱신은 transition이라 fallback이 다시 뜨지 않는다. */}
          <Suspense
            fallback={engines.map((e) => (
              <EngineCell key={e} engine={e} />
            ))}
          >
            <EngineCells root={root} workers={current.engines} engines={engines} />
          </Suspense>
          {/* idle 워커 풀 — 바의 마지막 자식 · `ml-auto`로 오른쪽 끝(§비주얼 §38 §자리).
              **그릇을 안 갖는다**: 이 바에 그릇이 하나도 없어서 얹으면 유일하게 누를 것처럼
              보인다. 주어가 머신(엔진 한도)에서 프로젝트(이 큐의 워커)로 바뀌는 것은 넓은 폭에선
              빈칸이, 좁은 폭에선 앞머리 `Clock`이 긋는다 — `·`는 엔진 칸의 절 구분자라 안 쓴다.
              `Suspense` 밖이라 껍데기와 같이 즉시 선다(값이 이미 손에 있다 — §38 §다섯 상태 로딩).
              묶는 컴포넌트를 안 만든다 — `// ponytail: 두 번째 자리가 생기면 그때 묶는다` */}
          <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Clock aria-hidden className="size-3 shrink-0" />
            {/* 라벨은 §2 워커 4상태 표의 말이다 — 손으로 적지 않는다(`유휴`를 만들지 않는다).
                `sr-only` 접두어로 낭독이 `idle 워커 w3 w9`가 된다: 앞에 읽히는 것이 엔진 한도라
                낱말 하나로 주어를 안 바꾸면 `idle`이 엔진의 상태로 들린다(§38 §접근성) */}
            <span className="shrink-0">
              {statusLabel("idle")}
              <span className="sr-only"> 워커</span>
            </span>
            {/* 자른다 — 이 바는 `h-7` + `overflow-hidden`이라 감기면 **세로로** 잘려 라벨까지
                사라진다(§1-2 §자르기 개정). `truncate`는 값 `<span>`에만 걸고(풀에 걸면 `…`가
                안 선다) 부모의 `min-w-0`이 그것을 실제로 걸리게 한다. `max-w-*`는 없다 —
                바의 마지막 요소라 뒤에 밀 것이 없고, 상한을 얹으면 넓은 화면에서 이유 없이 자른다 */}
            <span className="truncate font-mono" title={idlePool}>
              {idlePool}
            </span>
          </div>
        </footer>
      )}
    </>
  );
}

/** 알림 종 팝오버의 내용 (§0-10 문구 표 · §비주얼 §28 ⑤).
 *
 *  항목 하나가 배너 하나를 대신한다 — 해부(아이콘 열 16px + `gap-x-2`)는 `Alert`의 것 그대로고
 *  그릇만 `div`다. `Alert`로 감싸지 않는 이유: `--popover`가 `--card`와 같은 값이라 같은 색
 *  상자 안에 같은 색 상자가 여섯 서고, 사람이 치우라고 한 사각형 더미가 팝오버 안으로 이사한다.
 *  **꺼진 알림은 항목이 아예 없다** — 회색으로 눕히지 않는다. */
function NotificationItems({
  id,
  auth,
  alerts,
  resume,
  failures,
  assigned,
  awaiting,
  worker,
  due,
  locale,
}: {
  id: string;
  auth: AuthView;
  alerts: {
    offline: boolean;
    resume: boolean;
    auth: boolean;
    failures: boolean;
    assigned: boolean;
    awaiting: boolean;
    due: boolean;
  };
  resume: ResumeEvent | null;
  failures: { name: string; reason: string; log: string; at: string }[];
  assigned: { hash: string; stem: string }[];
  awaiting: { hash: string; stem: string; mtime: number }[];
  worker: string | null;
  due: { hash: string; stem: string; alert: DueAlert }[];
  locale: Locale;
}) {
  const rows = [
    // ⑤ 오프라인(§0-14). 살아 있는 판정이다 — 재접속되면 다음 박에 저절로 꺼진다. 버튼도
    // 나열도 없다(§0-10 문구 표 ⑤) — 행이 셋(제목·본문·문장)뿐이라 ①~④와 달리 `grid gap-2`
    // 나열 블록이 없다.
    alerts.offline && (
      <>
        <Unplug aria-hidden className="mt-0.5 size-4 text-status-stale" />
        <p className="col-start-2 text-sm font-medium">네트워크가 끊겨 있습니다</p>
        <p className="col-start-2 text-sm text-foreground">
          세션이 열리지 못하고 티켓은 그때마다 대기로 돌아갑니다. 연결이 돌아오면 저절로
          재개됩니다.
        </p>
        <p className="col-start-2 text-sm text-foreground">Wi-Fi 또는 유선 연결을 확인하세요.</p>
      </>
    ),
    // ⑥ 복귀(§0-14). 유일하게 과거를 말하는 항목이고 신선도 10분이 그것을 이력이 아니게 한다.
    // 제목은 kind로 갈린다 — `Moon` 같은 한 획으로 둘을 덮지 않는 것과 같은 이유로 문구도 하나가
    // 아니다. 시각 표기는 `timeLabel`이 아니라 `dateTimeLabel`이다(§비주얼 §28 ⑤ — 다른 날에도
    // 시각을 안 버린다).
    resume && (
      <>
        <RotateCcw aria-hidden className="mt-0.5 size-4 text-status-blocked" />
        <p className="col-start-2 text-sm font-medium">
          {resume.kind === "slept" ? "잠자기에서 복귀했습니다" : "꺼져 있다가 켜졌습니다"}
        </p>
        <p className="col-start-2 text-sm text-foreground">
          {dateTimeLabel(resume.from)}부터 {dateTimeLabel(resume.to)}까지 큐가 멈춰 있었습니다.
          잃은 것은 없습니다 — 이미 다시 돌고 있습니다.
        </p>
        <p className="col-start-2 text-sm text-foreground">고칠 일은 없습니다.</p>
        {/* ②와 같은 벌 — 행의 오른쪽 끝(§비주얼 §4-3). ⑤는 무수정이다(§0-14 §읽음 처리 — 살아
            있는 판정이라 붙이지 않는다). */}
        <span className="col-start-2 flex justify-end">
          <MarkResumeReadButton toMs={resume.to} />
        </span>
      </>
    ),
    // ① 인증 (§0-4). 토큰 파일이 없으면 `tick.sh:61`이 매 tick마다 조용히 `exit 0`한다 —
    // 화면에는 "티켓이 `대기`인데 아무 일도 안 일어난다"만 보인다. 그 침묵을 여기서 깬다.
    alerts.auth && (
      <>
        <TriangleAlert aria-hidden className="mt-0.5 size-4 text-status-stale" />
        <p className="col-start-2 text-sm font-medium">Claude 토큰이 없습니다</p>
        {/* `text-muted-foreground`를 안 쓴다 — 배경에 따라 통과·미달이 갈리는 색을 읽어야 하는
            유일한 문장에 두지 않는다(§1 함정 1 · §비주얼 §4-2가 배너에서 덮은 그 오버라이드) */}
        <p className="col-start-2 text-sm text-foreground">
          워커가 티켓을 집어도 세션을 못 열고 그대로 끝냅니다.
        </p>
        {/* CTA는 행의 오른쪽 끝이다(§비주얼 §4-3). **`/`로 보내지 않는다** — 그 자리에서
            헤더 버튼과 같은 다이얼로그를 연다. 이동이 0회가 된다(§0-4) */}
        <span className="col-start-2 flex justify-end">
          <SettingsDialog auth={auth} trigger="link" />
        </span>
      </>
    ),
    // ② 외부 요인 실패 (§0-5). 색이 stale이 아니라 blocked인 이유: 이건 **사람이 아무것도
    // 안 해도 꺼진다**(§비주얼 §4-4). 만료도 dismiss도 없다 — `lastFailure`의 신선도 창
    // 10분과 다음 성공 tick이 판정을 저절로 끈다.
    alerts.failures && (
      <>
        <CloudOff aria-hidden className="mt-0.5 size-4 text-status-blocked" />
        <p className="col-start-2 text-sm font-medium">
          세션이 열리자마자 죽는 워커 {failures.length}개
        </p>
        <p className="col-start-2 text-sm text-foreground">
          티켓은 그때마다 대기로 정확히 돌아옵니다. 잃는 것은 없습니다.
        </p>
        {/* `grid gap-2` — 한 워커가 한 줄에서 시작한다. flex-wrap이면 두 워커가 한 줄에 섞여
            어느 사유가 누구 것인지가 무너진다(§4-4). 상위 N개로 자르지 않는다 */}
        <div className="col-start-2 grid gap-2">
          {failures.map((f) => (
            <span key={f.name} className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-xs">{f.name}</span>
              {/* 엔진이 준 문자열 그대로다 — 번역도 분류도 자르기도 하지 않는다.
                  `break-all`이 아닌 이유: `7:40pm`이 갈리면 이 항목의 유일한 실행 정보가
                  깨진다(§4-4 줄바꿈). 폭이 줄어 최장 사유가 1줄 → 2줄이 된다(§28 ⑤) */}
              <span className="min-w-0 font-mono text-xs break-words">{f.reason}</span>
            </span>
          ))}
        </div>
        {/* 큐를 움직이는 조작은 여전히 0개다(§0-5 답 `Q2=(a)`) — 아래 버튼은 큐를 안 건드리고
            보는 것만 바꾼다(§0-5 §읽음 처리). 문구는 §0-10 문구 표 ②가 정본이다 */}
        <p className="col-start-2 text-sm text-foreground">
          사유에 적힌 시각이 지나면 저절로 다시 집습니다 — 고칠 일은 없습니다.
        </p>
        {/* 항목 하나에 **하나**다 — 나열의 워커마다 붙지 않는다(§0-10). 자리는 문장 아래 자기
            행의 오른쪽 끝이다(§비주얼 §28 ⑤: 문장이 이미 2줄이라 옆에 붙이면 3줄이 된다).
            그릇은 ①의 CTA 행과 같은 마크업이고 버튼 벌은 ③의 `할당 해제`에서 물려받는다 */}
        <span className="col-start-2 flex justify-end">
          <MarkFailuresReadButton project={id} failures={failures} />
        </span>
      </>
    ),
    // ③ 아무도 집지 않는 티켓 (§0-2). 배지와 같은 아이콘·같은 색이다(§비주얼 §2 이상 상태) —
    // destructive가 아니다. 상위 N건으로 자르지 않는다: 이 상태가 여럿이면 그게 더 큰 사건이다.
    alerts.assigned && (
      <>
        <CircleDot aria-hidden className="mt-0.5 size-4 text-status-stale" />
        <p className="col-start-2 text-sm font-medium">
          아무도 집지 않는 티켓 {assigned.length}건
        </p>
        <p className="col-start-2 text-sm text-foreground">
          워커가 잡아 둔 채 놓지 않아서, 이 티켓들은 순서가 와도 넘어갑니다.
        </p>
        <div className="col-start-2 grid gap-2">
          {assigned.map((t) => (
            // 한 행이 두 줄이고 그 사이는 `gap-1`이다 — 붙은 두 줄이 한 티켓임을 간격이 말한다.
            <div key={t.stem} className="grid gap-1">
              <span className="flex items-center gap-1">
                {/* 링크는 stem이다 — 상태가 바뀌어도 URL이 안 변한다(§식별자) */}
                {/* §비주얼 §31 ④ 갈래 B — 이 자리의 유일한 링크라 `underline`은 남는다 */}
                <Link
                  href={`/p/${id}/tickets/${encodeURIComponent(t.stem)}`}
                  className="rounded-sm font-mono text-xs text-muted-foreground underline"
                >
                  {t.hash}
                </Link>
                <StatusBadge status="assigned" />
              </span>
              {/* 새 서버 액션이 아니다 — 티켓 상세가 쓰는 그 컴포넌트다(제약 2: claim/release를
                  TS로 다시 구현하지 않는다). 성공 `Alert`·실패 `<Failure>`도 그 안에 이미 있고
                  이 행 아래 그대로 뜬다. 버튼이 행 오른쪽 끝이 아닌 이유는 §비주얼 §4-3 예외 2다
                  (조작 대상은 바로 윗줄의 해시다).
                  **`ghost={false}`**: 켜면 행마다 세 줄짜리 문단이 하나 더 서는데 그 말을 위
                  본문이 항목 머리에서 이미 하고, 쓰는 낱말이 `select`·`reap`이다(§비주얼 §28 ⑤).
                  `hash`에 stem을 넘긴다 — 엔진 인자는 파일명이다(AGENTS.md §식별자) */}
              <UnassignButton
                project={id}
                hash={t.stem}
                worker={worker}
                assigned
                ghost={false}
                wip={false}
              />
            </div>
          ))}
        </div>
      </>
    ),
    // ④ 답변을 기다리는 티켓 (§요구사항 레이어 결정 5 · §0-10 ④). **이상 상태가 아니다** —
    // 아이콘·색은 §2 `답변 대기` 배지 그대로이고(②와 같은 blocked 축: 밖의 조건이 풀리면 열린다.
    // 여기서 그 조건은 *사람의 답*이다) `--status-stale`을 쓰는 것은 여전히 ①③뿐이다.
    // 판정은 `isAwaiting` 하나이므로 보드의 배지와 갈릴 수 없다. `잠금 없는 답변 대기`는
    // 저절로 빠진다 — 그건 그 함수가 이미 false로 본다(§0-10 이 절이 정하지 않는 것).
    alerts.awaiting && (
      <>
        <MessageSquareReply aria-hidden className="mt-0.5 size-4 text-status-blocked" />
        <p className="col-start-2 text-sm font-medium">
          답변을 기다리는 티켓 {awaiting.length}건
        </p>
        {/* `요구사항`이라고 안 적는다 — `awaiting`은 `kind: request`만의 것이 아니다.
            `reap`이 자동 회수 상한을 넘길 때 아무 티켓에나 건다(§0-10) */}
        <p className="col-start-2 text-sm text-foreground">
          사람이 답을 써야 이 티켓들이 다시 큐에 뜹니다. 고장난 것은 없습니다.
        </p>
        <div className="col-start-2 grid gap-2">
          {/* 나열 순서는 큐 순서 그대로다 — 오래된 것을 위로 올리지 않는다(§0-10: 순서를
              판정하기 시작하면 그 판정이 두 번째 진실이 된다). 상위 N건으로도 안 자른다 */}
          {awaiting.map((t) => (
            // 한 행이 **한 줄**이다(③과 갈리는 지점 — 둘째 줄이 없다).
            <span key={t.stem} className="flex items-center gap-1">
              {/* §비주얼 §31 ⑤ — ④와 같다 */}
              <Link
                href={`/p/${id}/tickets/${encodeURIComponent(t.stem)}`}
                className="rounded-sm font-mono text-xs text-muted-foreground underline"
              >
                {t.hash}
              </Link>
              {/* 경과일은 `<StatusBadge>`가 이미 그린다(`daysSince(mtime)`) — 여기서 새로
                  계산하지 않는다. 0일이면 라벨이 `답변 대기` 하나고 그 판단도 배지 안에 있다 */}
              <StatusBadge status="awaiting" days={daysSince(t.mtime)} />
              {/* **링크지 버튼이 아니다** — 답변 폼은 `textarea` 하나가 아니라 `O_EXCL`로
                  파일을 만드는 폼이고, 448px 팝오버에 두 벌째를 그리면 같은 서버 액션의
                  진입점이 둘이 된다(§0-10 ④). 그래서 그 폼이 이미 사는 자리로 보낸다.
                  자리는 행의 오른쪽 끝(`ml-auto`)이다 — ③의 버튼이 왼쪽인 근거(조작 대상이
                  윗줄에 있다 · 회색 문구를 데려온다)가 여기엔 둘 다 없고, 배지 폭이 경과일
                  자릿수로 갈려서 이어 붙이면 링크가 행마다 다른 x에 선다(§비주얼 §28 ④).
                  모양은 ①의 CTA와 같은 벌이다(`text-sm underline`) */}
              <Link
                href={`/p/${id}/tickets/${encodeURIComponent(t.stem)}`}
                className="ml-auto rounded-sm text-sm underline"
              >
                답변 쓰기
              </Link>
            </span>
          ))}
        </div>
      </>
    ),
    // ⑦ 마감을 못 지킬 티켓 (§1-4 §종 항목 ⑦ · §0-10 ⑦). 판정 둘(지난 마감 · 5시간 안에 dep
    // 막힘)은 `dueAlertOf`(큐 파일만 읽는다, 예측 0) — `readSummary`가 이미 걸러 `due`로 왔다.
    // 아이콘·색은 새 마크 0개 규칙(§1-4 §발행)이라 ①과 같은 `TriangleAlert` + stale을 그대로
    // 쓴다 — ③처럼 사고이지 ④처럼 왕복의 정상 단계가 아니다.
    alerts.due && (
      <>
        <TriangleAlert aria-hidden className="mt-0.5 size-4 text-status-stale" />
        <p className="col-start-2 text-sm font-medium">
          {t(locale, "bell.due.titlePrefix")} {due.length}
          {t(locale, "bell.due.titleSuffix")}
        </p>
        <p className="col-start-2 text-sm text-foreground">{t(locale, "bell.due.body")}</p>
        {/* ⑦은 남은 시간을 나열에만 적는다(§0-10) — 가장 급한 것을 제목으로 끌어올리지 않는다.
            다음 행동이 링크인 이유는 ④와 같다: 고칠 것이 판단(마감을 미루거나 deps를 걷거나
            우선순위를 올린다)이라 팝오버의 버튼 하나가 그중 하나를 대신 고르면 안 된다. */}
        <div className="col-start-2 grid gap-2">
          {due.map((d) => (
            <span key={d.stem} className="flex items-center gap-1">
              <Link
                href={`/p/${id}/tickets/${encodeURIComponent(d.stem)}`}
                className="rounded-sm font-mono text-xs text-muted-foreground underline"
              >
                {d.hash}
              </Link>
              <span className="text-sm text-foreground">
                {d.alert.overdue
                  ? t(locale, "bell.due.overdue")
                  : `${remainingLabel(d.alert.remainingMs, locale)} ${t(locale, "bell.due.blockedMiddle")} ${d.alert.unmetCount}${t(locale, "bell.due.blockedSuffix")}`}
              </span>
              <Link
                href={`/p/${id}/tickets/${encodeURIComponent(d.stem)}`}
                className="ml-auto rounded-sm text-sm underline"
              >
                {t(locale, "bell.due.openTicket")}
              </Link>
            </span>
          ))}
        </div>
      </>
    ),
  ].filter(Boolean);

  // 0건이어도 팝오버는 열린다 — 사라진 것은 경고고 남은 것은 그릇이다(§0-10 답 `Q2=(나)`).
  // `<EmptyState>`를 그대로 쓴다: 팝오버라고 예외를 만들면 그 컴포넌트가 강제하려던 것이
  // 여기서 처음 샌다(§비주얼 §6 · §28 ⑥). 버튼도 아이콘도 없다.
  if (rows.length === 0) return <EmptyState text="알림 없음" />;
  return rows.map((row, i) => (
    // 구분선은 두 번째 항목부터다 — `gap-2.5`만으로는 다섯 줄짜리 항목 셋이 어디서 끊기는지
    // 안 읽힌다. 배너 시절 `Alert` 테두리가 하던 일이고 `pt-2.5`가 그 간격 한가운데다(§28 ④).
    <div
      key={i}
      className={cn(
        "grid grid-cols-[1rem_1fr] items-start gap-x-2 gap-y-1",
        i > 0 && "border-t pt-2.5",
      )}
    >
      {row}
    </div>
  ));
}

/** 잔여를 읽어 칸을 채운다. **읽는 주체는 서버다**(§0-8) — 토큰은 여기서 나가지 않고
 *  브라우저로 가는 것은 `%`와 리셋 시각뿐이다. 외부 호출은 `engineLimits`의 TTL 캐시 뒤에 있다. */
async function EngineCells({
  root,
  workers,
  engines,
}: {
  root: string;
  workers: { worker: string; engine: string }[];
  engines: string[];
}) {
  // 소모 속도는 트랜스크립트 스캔(30초 TTL)이고 한도는 외부 GET이라 **따로 도착한다**(§26 ⑧).
  // 직렬로 `await`하면 스캔이 GET 뒤에 줄을 서므로 같이 띄운다 — 둘 다 자기 캐시 뒤에 있다.
  const [limits, rates] = await Promise.all([engineLimits(engines), usageRates(root, workers)]);
  // 소비량은 **게이지가 못 선 칸에서만** 쓴다(§26 ⑤). 전부 정상이면 로그를 아예 안 읽는다.
  const usage = engines.some((e) => "error" in limits[e]) ? await listUsage(root) : null;
  // 트랙의 k번째 구간은 `%`를 가진 k번째 칸의 것이다(§26 ② §매핑) — 칸과 같은 `engines` 순회에서
  // 값 있는 엔진만 골라 그 순서 그대로 구간을 만든다. 두 목록을 따로 만들지 않는다.
  const segments = engines
    .map((e) => limits[e])
    .filter((limit): limit is { usedPercent: number; resetsAt: number | null } => !("error" in limit));
  return (
    <>
      {/* 바 전체의 스택 바 하나 — 엔진 칸을 떠나 트랙의 첫 자식이 됐다(§26 ③). 값을 못 구한
          엔진은 구간을 안 얻으므로 폭이 `96 × 구간 수`다. 전부 폴백이면 노드 자체가 없다. */}
      {segments.length > 0 && (
        <div
          aria-hidden
          className="hidden h-2 shrink-0 overflow-hidden rounded-full bg-muted sm:flex"
        >
          {segments.map((limit, i) => (
            // 구간 경계는 안 그린다 — 필이 구간 왼쪽에 정렬되므로 필의 왼쪽 끝이 경계다(§26 ③).
            <div key={i} className="h-full w-24 shrink-0">
              <div
                className={cn(
                  "h-full",
                  limit.usedPercent >= 90 ? "bg-status-stale" : "bg-muted-foreground",
                )}
                style={{ width: `${Math.min(100, Math.max(0, limit.usedPercent))}%` }}
              />
            </div>
          ))}
        </div>
      )}
      {engines.map((e) => (
        <EngineCell
          key={e}
          engine={e}
          limit={limits[e]}
          // **키가 없는 엔진은 이 항목이 통째로 빠진다**(오늘 codex — `~/.claude/projects/`는
          // claude가 쓰는 파일이다). 창 안에 세션이 없어서 나온 진짜 `0`은 키가 있는 `0`이라
          // `0 토큰/분`으로 선다. `undefined`와 `0`이 그 둘을 가른다(§0-8 판정 4)
          rate={rates[e]}
          // 그 엔진을 무는 워커들의 합이다. 키는 로그 파일명에서 온 **실효 `TICKET_NAME`**이고
          // NFC로 맞추는 것은 `parseLogName`이 readdir의 NFD를 정규화하기 때문이다(워커 화면과 같다).
          tokens={
            usage
              ? workers
                  .filter((w) => w.engine === e)
                  .reduce((n, w) => n + (usage.byWorker[w.worker.normalize("NFC")] ?? 0), 0)
              : 0
          }
        />
      ))}
    </>
  );
}

/** 한 엔진 칸 (§비주얼 §26 ②·③·⑤). 셋 중 하나다 —
 *  **도착 전**(`limit`이 없다: 이름만) · **값**(`%` + 리셋 — 게이지는 `EngineCells`의 스택 바가
 *  대신 그린다) · **못 구함**(소비량 + 사유). 어느 쪽이든 높이는 같다: 바가 `h-7` 고정 +
 *  `items-center`이고 들어오는 것이 전부 `text-xs`(16px)다. */
function EngineCell({
  engine,
  limit,
  tokens = 0,
  rate,
}: {
  engine: string;
  limit?: EngineLimit;
  tokens?: number;
  rate?: number;
}) {
  const value = limit && !("error" in limit) ? limit : null;
  // 임계는 **사용률 90% 하나**다(§26 ③). 단계를 둘로 나누지 않는다 — 색은 예외 하나만 표시한다.
  const over = !!value && value.usedPercent >= 90;
  // 소모 속도(§26 ② 다섯째 슬롯). 정상 칸과 폴백 칸(⑤)에 **한 글자도 같은 것**이 서므로
  // 여기서 한 번 만들어 두 자리에 넣는다 — 두 벌 적으면 갈릴 자리가 생긴다.
  // 잉크가 `--muted-foreground`인 것은 이 칸에서 **주어가 다른 유일한 값**이기 때문이다
  // (프로젝트 스코프 · 창 10분). 임계 90%에서도 색이 안 바뀐다 — 한도의 수가 아니다.
  // `lg` 미만에서 **먼저** 빠진다(⑦): 빠져도 남은 넷의 뜻이 안 갈리는 유일한 값이다.
  const rateSlot = rate === undefined ? null : (
    <span
      className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums lg:inline"
      title="최근 10분 · 이 프로젝트의 워커 세션"
    >
      · {formatTokens(rate)} 토큰/분
    </span>
  );
  return (
    <div className="flex items-center gap-2">
      {/* §23의 `엔진` 열과 같은 서체·같은 자르기다. 전문은 `title`에 남는다 */}
      <code className="max-w-32 shrink-0 truncate font-mono text-xs" title={engine}>
        {engine}
      </code>
      {value && (
        <>
          {/* 게이지는 이 칸을 떠나 바 전체의 스택 바 하나가 됐다(§26 ③ — `56dae0e6` 개정).
              이 칸이 얻는 것은 그 트랙 안의 구간 하나이고, `%`를 가진 몇 번째 칸인지가 매핑이다
              (`EngineCells`가 같은 `engines` 순회로 만든다 — 두 목록을 안 따로 만든다).
              `사용` 두 글자가 이 `%`의 단위다 — 없으면 쓴 쪽인지 남은 쪽인지 화면만 봐서 못 가른다.
              `tabular-nums`가 없으면 폴링마다 자릿수 폭이 흔들려 옆 칸이 밀린다 */}
          <span className={cn("text-xs whitespace-nowrap tabular-nums", over && "text-status-stale")}>
            {Math.round(value.usedPercent)}% 사용
          </span>
          {/* 자리는 `% 사용` **바로 다음 · 리셋 시각 앞**이다(§26 ②) — 요구가 말한 `한도 옆`에
              리셋 시각이 끼어 앉지 않는다. 구분자는 이 칸의 절 구분자 `·` 그대로다 */}
          {rateSlot}
          {/* `resets_at`이 없으면 **이 항목만** 빠진다. 칸이 통째로 폴백으로 넘어가지 않는다(§26 ④) */}
          {value.resetsAt !== null && (
            <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums md:inline">
              · {timeLabel(value.resetsAt)} 리셋
            </span>
          )}
        </>
      )}
      {limit && "error" in limit && (
        <>
          {/* 게이지를 안 그린다 — 빈 트랙도 `0%`도 회색 막대도 없다(§0-8 판정 2). 그 자리에
              판정 1의 소비량이 선다. `1.2M`으로 줄이지 않는다: 여기가 이 바의 유일한 절대 수다 */}
          <span className="text-xs whitespace-nowrap tabular-nums">
            {tokens.toLocaleString()} 토큰
          </span>
          {/* 이 칸에만 절대 수 둘이 나란히 선다(창 5시간 누적 · 창 10분 속도). 같은 사실이
              아니라는 것을 **단위 · 잉크 · `title`** 셋이 말한다(§26 ⑤) — 안 갈라 두면
              "120만 중 250만" 같은 없는 관계로 읽힌다. 좁아져도 사유는 안 뺀다 */}
          {rateSlot}
          {/* 색도 아이콘도 안 쓴다 — 에러가 아니라 **부재**다. 원인 원문은 삼키지 않고
              네이티브 `title`에 남긴다(얇은 한 줄에 블록을 세울 자리가 없다 — §26 ⑤) */}
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            title={limit.error}
          >
            · 한도를 읽을 수 없습니다
          </span>
        </>
      )}
    </div>
  );
}
