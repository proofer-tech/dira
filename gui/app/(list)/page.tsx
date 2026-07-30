/** 프로젝트 목록·등록 `/` — 앱의 홈. 프로젝트가 0개면 이 화면이 온보딩이다 (DESIGN.md §0 · §7). */
import { homedir } from "node:os";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { CopyCommand } from "@/components/copy-command";
import { StatusBadge } from "@/components/status-badge";
import { RegisterCard, ProjectRowActions } from "@/components/projects-ui";
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
      {/* 루트 셸: 로고만. 내비·전환기를 넣지 않는다 — 목적지가 아직 정해지지 않았다(§4) */}
      <header className="sticky top-0 z-50 flex h-12 items-center border-b bg-background px-6">
        <Link href="/" className="text-sm font-medium">
          fs-tickets
        </Link>
      </header>

      <main className="w-full max-w-3xl space-y-6 px-6 py-6">
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

        {rows.length === 0 ? (
          <Onboarding />
        ) : (
          <>
            <h1 className="text-lg font-semibold">프로젝트</h1>
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
                      <Link href={`/p/${t.id}`} className="hover:underline">
                        {t.name}
                      </Link>
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
            <RegisterCard />
          </>
        )}
      </main>
    </>
  );
}

/** 프로젝트 0개. §6의 `<EmptyState>` 규칙(한 줄 + 버튼 1개)을 여기서만 쓰지 않는다 —
 *  한 줄로는 "무엇을 등록해야 하는지"를 못 알려준다(§8 충돌 기록). */
function Onboarding() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">fs-tickets GUI</h1>
        <p className="text-sm text-muted-foreground">
          등록된 프로젝트가 없습니다. 큐 디렉터리를 등록하면 시작합니다.
        </p>
      </div>
      <RegisterCard />
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          큐 디렉터리는 프로젝트 루트 아래 .fs-tickets 입니다. 안에 tickets/ 와 workers/ 가 있습니다.
        </p>
        <p className="font-mono text-xs text-muted-foreground">~/Projects/myproject/.fs-tickets</p>
        <p className="font-mono text-xs text-muted-foreground">~/Projects/fs-tickets/.fs-tickets</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">어디 있는지 모르겠다면:</p>
        {/* 스캔하는 건 GUI 프로세스가 아니라 사용자의 셸이다 — 경계는 여전히 명시적이다 */}
        <CopyCommand cmd="ls -d ~/Projects/*/.fs-tickets" />
      </div>
    </div>
  );
}
