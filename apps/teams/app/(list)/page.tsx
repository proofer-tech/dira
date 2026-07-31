/** 프로젝트 목록·등록 `/` — 앱의 홈. 프로젝트가 0개면 이 화면이 온보딩이다 (DESIGN.md §0 · §7). */
import { homedir } from "node:os";
import { TriangleAlert } from "lucide-react";
import { CopyCommand } from "@/components/copy-command";
import { BrandMark } from "@/components/project-switcher";
import { ProjectsSection, ProjectRows, type ProjectRow } from "@/components/projects-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { readAuth } from "@/lib/auth";
import { readSummary, readProjects, registryPath } from "@/lib/projects";
import { tildePath } from "@/lib/urls";
import { workerGroups } from "@/lib/workers";

// 레지스트리·큐는 GUI 밖에서(사람·cron이) 바뀐다. 프리렌더하면 빌드 시점 목록이 굳는다.
export const dynamic = "force-dynamic";

export default async function Home() {
  const home = homedir();

  // 인증은 **머신당 하나**다 — 프로젝트마다 있지 않아 이 화면이 그 자리다(§0-4 자리 표).
  const auth = await readAuth();

  // 레지스트리가 깨졌으면 GUI가 고쳐 쓰려 들지 않는다 — 원문 + 파일 경로를 보여주고 사람이 연다.
  let registryError: string | null = null;
  let projects: Awaited<ReturnType<typeof readProjects>> = [];
  try {
    projects = await readProjects();
  } catch (e) {
    registryError = (e as Error).message;
  }

  // 행이 그리는 것만 담는다 — `Worker` 전체가 아니라 `workerGroups`의 결과다.
  // 이 표는 **엘리먼트가 아니라 값으로** 클라이언트에 건너간다(`<ProjectRows>` 주석의 회귀 근거).
  const rows: ProjectRow[] = await Promise.all(
    projects.map(async (t) => {
      const s = await readSummary(t);
      return {
        id: t.id,
        name: t.name,
        root: t.root,
        shortRoot: tildePath(t.root, home),
        connected: s.connected,
        open: s.open,
        wip: s.wip,
        done: s.done,
        assigned: s.assigned.length,
        personas: s.personas.map((p) => ({ name: p, color: t.personaColors?.[p] })),
        workers: workerGroups(s.workers),
      };
    }),
  );

  return (
    <>
      {/* 루트 셸: 마크만. 내비·전환기를 넣지 않는다 — 목적지가 아직 정해지지 않았다(§4).
          href는 `/` = 자기 자신이다(§14: 프로젝트가 정해지지 않았다). */}
      <header className="sticky top-0 z-50 flex h-12 items-center border-b bg-background px-6">
        <BrandMark href="/" />
      </header>

      {/* 스크롤하는 것은 이 `main`이다(§비주얼 §4). 폭 상한은 **안쪽 상자**가 든다 —
          `main`에 걸면 스크롤바가 화면 오른쪽이 아니라 896px 자리에 선다 */}
      <main className="min-h-0 w-full flex-1 overflow-y-auto">
        {/* 등록 폼이 다이얼로그로 내려가면서 이 화면은 테이블 화면이 됐다 — 폼 폭 규칙(3xl)은
            폼이 서는 자리만 문다(§비주얼 §7 폭 항) */}
        <div className="w-full max-w-4xl space-y-6 px-6 py-6">
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
          <ProjectsSection
            empty={rows.length === 0}
            auth={{ path: tildePath(auth.path, home), savedAt: auth.savedAt }}
            home={home}
          >
            {rows.length > 0 && <ProjectRows rows={rows} />}
          </ProjectsSection>

          {rows.length === 0 && <OnboardingHelp />}
        </div>
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
