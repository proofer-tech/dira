/** 프로젝트 스코프 셸 — 헤더·내비·전환기 (DESIGN.md §0-1 · 비주얼 디렉션 §4).
 *
 *  프로젝트는 URL이 담는다. 모듈 전역에 "현재 프로젝트"를 두지 않는다 — 서버 컴포넌트는 동시에
 *  여러 요청을 처리하므로 전역에 담으면 엉뚱한 큐에 쓰는 사고가 난다. */
import { homedir } from "node:os";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDot, CloudOff, TriangleAlert, Unplug } from "lucide-react";
import {
  BrandMark,
  RefreshButton,
  ProjectNav,
  ProjectSwitcher,
} from "@/components/project-switcher";
import { SettingsDialog } from "@/components/settings-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { readAuth } from "@/lib/auth";
import { readSummary, readProjects } from "@/lib/projects";
import { engineName } from "@/lib/workers";
import { tildePath } from "@/lib/urls";

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
        assigned: s.assigned, // §0-2 배너용. 전환기는 이 필드를 쓰지 않는다
        // §0-5 배너용. `readSummary`가 이미 `listWorkers`를 불렀으므로 워커를 다시 읽지 않는다.
        // 정상 상태에서는 항상 빈 배열이고 그때 배너 노드가 아예 없다.
        failures: s.workers.flatMap((w) =>
          w.lastFailure ? [{ name: w.name, reason: w.lastFailure.reason }] : [],
        ),
        // §0-4 인증 배너용. claude 엔진 워커가 있는가 — **못 읽었으면 판정 불가 = true**다
        // (판정 불가를 "괜찮다"로 바꾸면 §0-4가 닫으려던 침묵이 그대로 돌아온다).
        // 워커도 `readSummary`가 이미 읽어 둔 것이다 — 새 fs 읽기 0(§성능 예산).
        claude: !s.connected || s.workers.some((w) => engineName(w.engine) === "claude"),
      };
    }),
  );
  const current = items.find((t) => t.id === id)!;
  // 토큰은 머신당 하나라 프로젝트 요약에 들어 있지 않다(§0-4). 증상("내 큐가 안 돈다")이
  // 나타나는 화면이 여기라 판정도 여기서 한다. 값은 헤더 `설정` 버튼과 배너 CTA가 같이 쓴다 —
  // 진입점 둘이 같은 컴포넌트를 두 번 쓰고 전역 상태는 만들지 않는다(§0-4).
  const rawAuth = await readAuth();
  const auth = {
    path: tildePath(rawAuth.path, home),
    savedAt: rawAuth.savedAt,
    // 헤더 버튼의 `인증 필요`는 머신 스코프라 **등록된 프로젝트 전부**를 보고 끈다 —
    // 전부 읽었고 전부 claude가 0일 때만 꺼진다(§0-4). 배너는 그 프로젝트만 본다(`current.claude`).
    claudeUsed: items.some((t) => t.claude),
  };

  return (
    <>
      <header className="sticky top-0 z-50 flex h-12 items-center gap-6 border-b bg-background px-6">
        {/* href는 그 프로젝트의 첫 화면 = 지금은 보드다 — `/`(프로젝트 관리)로 가는 길은
            전환기 하단 항목 하나로 남는다(§4). 나머지 값은 루트 셸과 같다(§14 · BrandMark). */}
        <BrandMark href={`/p/${id}`} />
        <ProjectNav id={id} />
        {/* 우측 끝은 전환기 오른쪽의 `설정`이다 — 두 셸이 같은 자리에 같은 것을 갖는다
            (§비주얼 §4). 헤더의 `gap-6`이 아니라 이 둘 사이는 `gap-2`라 묶어서 오른쪽으로 민다 */}
        <div className="ml-auto flex items-center gap-2">
          <ProjectSwitcher projects={items} currentId={id} />
          <SettingsDialog auth={auth} />
        </div>
      </header>

      {/* 스크롤하는 것은 이 `main`이다(§비주얼 §4). `min-h-0`이 없으면 flex 자식 기본값
          (`min-height: auto`)이 내용만큼 늘어나 문서가 도로 길어진다. flex 컬럼인 이유는
          배너다: 배너가 뜨면 남는 높이가 줄어 보드가 그만큼 짧아진다(§1) */}
      <main className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        {/* 디스패치되지 않는 티켓 알림 (§0-2). 셸에 있으므로 보드뿐 아니라 워커·페르소나·
            프로토콜에도 뜬다 — 그래야 "해결 전까지 보인다"가 성립한다. dismiss·읽음 상태가 없다:
            폴링이 매번 다시 판정하므로 0건이 되면 이 노드가 사라지고, 안 되면 남는다.
            0건이면 `보류 없음`을 말하지 않는다 — 정상 상태에서 켜진 경고는 안 읽히게 된다. */}
        {/* 인증 배너 (§0-4). 토큰 파일이 없으면 `tick.sh:61`이 매 tick마다 조용히 `exit 0`한다 —
            화면에는 "티켓이 `대기`인데 아무 일도 안 일어난다"만 보인다. 그 침묵을 여기서 깬다.
            **세 번째 `Alert` 변종이다** — 새 컴포넌트 0개. dismiss도 없다: 토큰 파일이 생기면
            이 판정이 저절로 꺼진다(§0-2와 같은 논리). 아래 두 배너보다 먼저 선다 —
            인증이 없으면 그 프로젝트에서 아무것도 안 돈다.
            **토큰은 Claude 전용이다**(§0-4): `tick.sh:52`·`60`은 `TICKET_ENGINE[0]`의 basename이
            `claude`일 때만 이 파일을 읽고 그때만 디스패치를 막는다. 그래서 이 프로젝트의 워커를
            읽었고 claude가 0이면 세우지 않는다 — 못 읽었으면(연결 안 됨) 종전대로 세운다. */}
        {!auth.savedAt && current.claude && (
          <Alert role="status" className="max-w-3xl">
            <TriangleAlert aria-hidden className="text-status-stale" />
            <AlertTitle>Claude 인증이 없어 티켓이 디스패치되지 않습니다</AlertTitle>
            <AlertDescription className="grid gap-3 text-foreground">
              <span>Claude 장기 토큰이 없어 워커가 매번 조용히 종료합니다.</span>
              {/* CTA는 행의 오른쪽 끝이다(§비주얼 §4-3). **`/`로 보내지 않는다** — 그 자리에서
                  헤더 버튼과 같은 다이얼로그를 연다. 이동이 0회가 된다(§0-4) */}
              <span className="flex justify-end">
                <SettingsDialog auth={auth} trigger="link" />
              </span>
            </AlertDescription>
          </Alert>
        )}
        {/* 외부 요인 실패 (§0-5 · §비주얼 §4-4). **네 번째 `Alert` 변종이다** — 새 컴포넌트 0.
            인증 아래, 할당됨 위다: 인증이 없으면 아무것도 안 돌고, 이건 워커 전원이 멈추며,
            할당됨은 티켓 몇 건이다(위로 갈수록 범위가 넓다). dismiss도 만료도 없다 —
            `lastFailure`의 신선도 창 10분과 다음 성공 tick이 판정을 저절로 끈다.
            색이 stale이 아니라 blocked인 이유: 이건 **사람이 아무것도 안 해도 꺼진다**(§4-4). */}
        {current.connected && current.failures.length > 0 && (
          <Alert role="status" className="max-w-3xl">
            <CloudOff aria-hidden className="text-status-blocked" />
            <AlertTitle>세션이 즉시 실패하는 워커 {current.failures.length}개</AlertTitle>
            <AlertDescription className="grid gap-3 text-foreground">
              <span>디스패치는 계속 돌지만 세션이 즉시 실패하고 티켓은 백로그로 돌아갑니다.</span>
              {/* `grid gap-2` — 한 워커가 한 줄에서 시작한다. flex-wrap이면 두 워커가 한 줄에
                  섞여 어느 사유가 누구 것인지가 무너진다(§4-4). 상위 N개로 자르지 않는다 */}
              <span className="grid gap-2">
                {current.failures.map((f) => (
                  <span key={f.name} className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs">{f.name}</span>
                    {/* 엔진이 준 문자열 그대로다 — 번역도 분류도 자르기도 하지 않는다.
                        `break-all`이 아닌 이유: `7:40pm`이 갈리면 이 배너의 유일한 실행 정보가
                        깨진다(§4-4 줄바꿈) */}
                    <span className="min-w-0 font-mono text-xs break-words">{f.reason}</span>
                  </span>
                ))}
              </span>
              <span>사유가 가리키는 시각이 지나면 다음 tick이 저절로 집습니다.</span>
            </AlertDescription>
          </Alert>
        )}
        {current.connected && current.assigned.length > 0 && (
          // role은 status로 내린다 — 사건이 아니라 해결 전까지 상주하는 상태고, 5초 폴링이
          // 셸을 다시 렌더하므로 assertive면 재낭독 위험이 있다(§4-2 라이브 리전).
          <Alert role="status" className="max-w-3xl">
            {/* 배지와 같은 아이콘·같은 색이다(§비주얼 §2 이상 상태) — destructive가 아니다 */}
            <CircleDot aria-hidden className="text-status-stale" />
            {/* 제목이 받는 건 건수 하나다 — 위험 문장은 본문 첫 줄로 내린다(§4-2) */}
            <AlertTitle>디스패치되지 않는 티켓 {current.assigned.length}건</AlertTitle>
            {/* text-foreground로 덮는다 — 기본 muted-foreground는 --muted 위에서 4.34로 AA
                미달이라(§1 함정 1) 배경에 따라 통과·미달이 갈리는 색을 상주 경고 본문에 두지 않는다 */}
            <AlertDescription className="grid gap-3 text-foreground">
              <span>큐에서 영구 제외되고 reap도 손대지 않습니다.</span>
              {/* 상위 N건으로 자르지 않는다 — 이 상태가 여럿이면 그게 더 큰 사건이다 */}
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {current.assigned.map((t) => (
                  <span key={t.stem} className="flex items-center gap-1">
                    {/* 링크는 stem이다 — 상태가 바뀌어도 URL이 안 변한다(§식별자) */}
                    <Link
                      href={`/p/${id}/tickets/${encodeURIComponent(t.stem)}`}
                      className="rounded-sm font-mono text-xs underline"
                    >
                      {t.hash}
                    </Link>
                    <StatusBadge status="assigned" />
                  </span>
                ))}
              </span>
              <span>티켓 상세의 할당 해제로 되돌립니다.</span>
            </AlertDescription>
          </Alert>
        )}
        {current.connected ? (
          children
        ) : (
          // 경로가 없는 건 파괴가 아니라 부재다 — destructive를 쓰지 않는다(§8).
          <Alert className="max-w-3xl">
            <Unplug aria-hidden className="text-status-stale" />
            <AlertTitle>프로젝트 &quot;{current.name}&quot;의 큐를 읽을 수 없습니다</AlertTitle>
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
    </>
  );
}
