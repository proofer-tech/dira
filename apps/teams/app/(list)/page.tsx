/** 프로젝트 목록·등록 `/` — 앱의 홈. 프로젝트가 0개면 이 화면이 온보딩이다 (DESIGN.md §0 · §7). */
import { homedir } from "node:os";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { CopyCommand } from "@/components/copy-command";
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
import { workerSummary } from "@/lib/workers";

// 레지스트리·큐는 GUI 밖에서(사람·cron이) 바뀐다. 프리렌더하면 빌드 시점 목록이 굳는다.
export const dynamic = "force-dynamic";

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
                  <TableHead className="h-9 px-3 text-right text-xs">열림</TableHead>
                  <TableHead className="h-9 px-3 text-xs">워커</TableHead>
                  <TableHead className="h-9 px-3 text-xs">연결</TableHead>
                  <TableHead className="h-9 px-3 text-right text-xs">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t, i) => (
                  <TableRow key={t.id} className="h-9">
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
                    {/* 연결 안 됨이면 카운트를 비운다. 0이 아니다 */}
                    <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                      {t.summary.connected ? t.summary.open : ""}
                    </TableCell>
                    <TableCell className="px-3 py-0 text-xs tabular-nums">
                      {t.summary.connected ? workerSummary(t.summary.workers) : ""}
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
