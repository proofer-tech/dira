/** 프로젝트 목록·등록 `/` — 앱의 홈. 프로젝트가 0개면 이 화면이 온보딩이다 (DESIGN.md §0 · §7). */
import { homedir } from "node:os";
import { Fragment } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { CopyCommand } from "@/components/copy-command";
import { PersonaBadge } from "@/components/persona-badge";
import { StatusBadge } from "@/components/status-badge";
import { BrandMark } from "@/components/project-switcher";
import { ProjectsSection, ProjectRowActions } from "@/components/projects-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { readSummary, readProjects, registryPath } from "@/lib/projects";
import { tildePath } from "@/lib/urls";
import { workerGroups } from "@/lib/workers";

// 레지스트리·큐는 GUI 밖에서(사람·cron이) 바뀐다. 프리렌더하면 빌드 시점 목록이 굳는다.
export const dynamic = "force-dynamic";

/** 자원 줄의 자리 라벨. `w-16`(64px)은 `페르소나` 4자가 12px에서 들어가는 폭이고,
 *  `leading-5`가 있어야 12px 글자가 `h-5` 배지와 같은 중심에 선다(§비주얼 §7). */
const LABEL = "w-16 shrink-0 text-xs leading-5 text-muted-foreground";
/** 값이 0개일 때. **문장이므로 `font-mono`가 아니다**(§비주얼 §3). */
const EMPTY = "text-xs leading-5 text-muted-foreground";

export default async function Home() {
  const home = homedir();

  // 레지스트리가 깨졌으면 GUI가 고쳐 쓰려 들지 않는다 — 원문 + 파일 경로를 보여주고 사람이 연다.
  let registryError: string | null = null;
  let projects: Awaited<ReturnType<typeof readProjects>> = [];
  try {
    projects = await readProjects();
  } catch (e) {
    registryError = (e as Error).message;
  }

  const rows = await Promise.all(
    projects.map(async (t) => ({
      ...t,
      shortRoot: tildePath(t.root, home),
      summary: await readSummary(t),
    })),
  );

  return (
    <>
      {/* 루트 셸: 마크만. 내비·전환기를 넣지 않는다 — 목적지가 아직 정해지지 않았다(§4).
          href는 `/` = 자기 자신이다(§14: 프로젝트가 정해지지 않았다). */}
      <header className="sticky top-0 z-50 flex h-12 items-center border-b bg-background px-6">
        <BrandMark href="/" />
      </header>

      {/* 등록 폼이 다이얼로그로 내려가면서 이 화면은 테이블 화면이 됐다 — 폼 폭 규칙(3xl)은
          폼이 서는 자리만 문다(§비주얼 §7 폭 항) */}
      <main className="w-full max-w-4xl space-y-6 px-6 py-6">
        {registryError && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>프로젝트 레지스트리를 읽지 못했습니다</AlertTitle>
            <AlertDescription className="grid gap-2">
              <span className="font-mono text-xs break-all">{registryError}</span>
              <CopyCommand cmd={`open -e "${registryPath()}"`} />
            </AlertDescription>
          </Alert>
        )}

        {/* `h1`·등록·생성 트리거·결과 슬롯이 한 클라이언트 조각이다 — 트리거는 `h1` 우측인데
            결과 카드는 목록 아래 슬롯에 떠야 한다(§비주얼 §7). 목록이 0↔1로 바뀌어도 이 조각은
            자리를 안 옮긴다: 옮기면 remount로 해석 결과 표가 사라진다(§0 마지막 항) */}
        <ProjectsSection empty={rows.length === 0}>
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="h-9">
                  <TableHead className="h-9 px-3 text-xs">이름</TableHead>
                  <TableHead className="h-9 px-3 text-xs">경로</TableHead>
                  {/* 칸반 레인 3개(§1)와 수가 안 맞는 이유는 이 한 문장뿐이다 */}
                  <TableHead
                    className="h-9 px-3 text-right text-xs"
                    title="파일이 열려 있는 티켓 — 대기·deps 대기·할당됨을 포함합니다"
                  >
                    열림
                  </TableHead>
                  <TableHead className="h-9 px-3 text-right text-xs">진행중</TableHead>
                  <TableHead className="h-9 px-3 text-right text-xs">완료</TableHead>
                  <TableHead className="h-9 px-3 text-xs">연결</TableHead>
                  <TableHead className="h-9 px-3 text-right text-xs">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t, i) => (
                  // 한 프로젝트가 `TableRow` 2개다(§비주얼 §7). hover를 끄는 이유: 두 줄 중 한 줄만
                  // 밝아지면 블록이 반으로 갈려 보이고, 이 행에는 행 단위 클릭 대상이 없다.
                  // 블록의 경계는 hover가 아니라 **마지막 줄의 `border-b`**가 짓는다.
                  <Fragment key={t.id}>
                    <TableRow
                      className={`h-9 hover:bg-transparent ${t.summary.connected ? "border-b-0" : ""}`}
                    >
                      {/* 이 셀만 링크다 — 행 전체를 링크로 만들면 액션 버튼과 겹친다 */}
                      <TableCell className="px-3 py-0 text-sm">
                        <span className="flex items-center gap-2">
                          <Link href={`/p/${t.id}`} className="hover:underline">
                            {t.name}
                          </Link>
                          {/* 프로젝트에 들어가기 전에 정체를 알린다(§0). 배너는 여기 두지 않는다 —
                            이 화면은 프로젝트 스코프가 아니고 이 배지가 목적지를 이미 가리킨다.
                            건수는 배지 밖 숫자다: 라벨(`할당됨`)은 <StatusBadge> 하나가 정하고
                            건수는 상태가 아니라 이 행의 사실이다. 0건인 행에는 아무것도 없다 */}
                          {t.summary.assigned.length > 0 && (
                            <span className="flex items-center gap-1">
                              <StatusBadge status="assigned" />
                              <span className="text-xs tabular-nums text-status-stale">
                                {t.summary.assigned.length}
                              </span>
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell
                        className="max-w-[16rem] truncate px-3 py-0 font-mono text-xs text-muted-foreground"
                        title={t.root}
                      >
                        {t.shortRoot}
                      </TableCell>
                      {/* 연결 안 됨이면 세 자리를 전부 비운다. 0이 아니다 — 못 읽은 것과 0건은
                        다른 사실이다(§0). 세 수를 서로 다르게 칠하지 않는다(§비주얼 §7) */}
                      <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                        {t.summary.connected ? t.summary.open : ""}
                      </TableCell>
                      <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                        {t.summary.connected ? t.summary.wip : ""}
                      </TableCell>
                      <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                        {t.summary.connected ? t.summary.done : ""}
                      </TableCell>
                      <TableCell className="px-3 py-0">
                        <StatusBadge status={t.summary.connected ? "connected" : "disconnected"} />
                      </TableCell>
                      <TableCell className="px-3 py-0">
                        <ProjectRowActions
                          id={t.id}
                          name={t.name}
                          shortRoot={t.shortRoot}
                          first={i === 0}
                          last={i === rows.length - 1}
                        />
                      </TableCell>
                    </TableRow>
                    {/* 자원 줄 — 들어가기 전에 그 프로젝트가 무엇을 갖고 있는지 본다(§0).
                      **연결 안 됨 행에는 이 줄이 아예 없다** — `페르소나 없음`은 "0명"이라는
                      주장인데 큐를 못 읽었으므로 셀 수가 없다(첫 줄의 수 3칸과 같은 규칙).
                      정렬이 필요한 것은 위 셀에 남기고 길이가 흔들리는 것만 여기로 내렸다.
                      링크도 버튼도 없다 — 이 화면의 클릭 목적지는 이름 링크 하나다. */}
                    {t.summary.connected && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={7}
                          className="space-y-1 px-3 pt-0 pb-2 whitespace-normal"
                        >
                          <div className="flex items-start gap-2">
                            <span className={LABEL}>페르소나</span>
                            {t.summary.personas.length > 0 ? (
                              // 자르지 않는다 — `외 3개`로 접으면 무엇을 갖고 있는지를 못 본다(§0).
                              // 점만 쓰지 않는다: 프로젝트마다 페르소나 집합이 달라 같은 색이
                              // 행마다 다른 사람을 뜻한다(§12).
                              <span className="flex flex-wrap gap-1">
                                {t.summary.personas.map((p) => (
                                  <PersonaBadge key={p} name={p} color={t.personaColors?.[p]} />
                                ))}
                              </span>
                            ) : (
                              <span className={EMPTY}>없음</span>
                            )}
                          </div>
                          <div className="flex items-start gap-2">
                            <span className={LABEL}>워커</span>
                            {t.summary.workers.length > 0 ? (
                              // 워커 수만큼 배지를 세우지 않는다 — 라벨이 대부분 같은 글자라
                              // 반복이 이 줄에서 제일 넓은 요소가 된다. 상태별로 묶고 이름을 뒤에.
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                {workerGroups(t.summary.workers).map((g) => (
                                  <span
                                    key={g.status}
                                    className="flex items-center gap-1 whitespace-nowrap"
                                  >
                                    <StatusBadge status={g.status} />
                                    <span className="font-mono text-xs">{g.names.join(" ")}</span>
                                  </span>
                                ))}
                              </span>
                            ) : (
                              // 해석 결과 표가 쓰는 문구 그대로 — 같은 사실을 두 자리에서 다른
                              // 말로 하지 않는다(app/actions.ts 워커 행)
                              <span className={EMPTY}>없음 — 이 큐는 돌지 않습니다</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </ProjectsSection>

        {rows.length === 0 && <OnboardingHelp />}
      </main>
    </>
  );
}

/** 프로젝트 0개. §6의 `<EmptyState>` 규칙(한 줄 + 버튼 1개)을 여기서만 쓰지 않는다 —
 *  한 줄로는 "무엇을 등록해야 하는지"를 못 알려준다(§8 충돌 기록). 등록 카드 앞줄(안내 문구)은
 *  `<ProjectsSection>` 안에 있다 — 그 카드가 `h1`과 붙어 서야 하기 때문이다.
 *  목록이 생기면 이 산문은 통째로 사라진다(§비주얼 §7). */
function OnboardingHelp() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          큐 디렉터리는 프로젝트 루트 아래 .dira 입니다. 안에 tickets/ 와 workers/ 가 있습니다.
        </p>
        <p className="font-mono text-xs text-muted-foreground">~/Projects/myproject/.dira</p>
        <p className="font-mono text-xs text-muted-foreground">~/Projects/dira/.dira</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">어디 있는지 모르겠다면:</p>
        {/* 스캔하는 건 GUI 프로세스가 아니라 사용자의 셸이다 — 경계는 여전히 명시적이다 */}
        <CopyCommand cmd="ls -d ~/Projects/*/.dira" />
      </div>
    </div>
  );
}
