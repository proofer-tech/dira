/** 프로젝트 스코프 셸 — 헤더·내비·전환기 (DESIGN.md §0-1 · 비주얼 디렉션 §4).
 *
 *  프로젝트는 URL이 담는다. 모듈 전역에 "현재 프로젝트"를 두지 않는다 — 서버 컴포넌트는 동시에
 *  여러 요청을 처리하므로 전역에 담으면 엉뚱한 큐에 쓰는 사고가 난다. */
import { homedir } from "node:os";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDot, Unplug } from "lucide-react";
import {
  BrandMark,
  RefreshButton,
  ProjectNav,
  ProjectSwitcher,
} from "@/components/project-switcher";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { readSummary, readProjects } from "@/lib/projects";
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
      };
    }),
  );
  const current = items.find((t) => t.id === id)!;

  return (
    <>
      <header className="sticky top-0 z-50 flex h-12 items-center gap-6 border-b bg-background px-6">
        {/* href는 그 프로젝트의 첫 화면 = 지금은 보드다 — `/`(프로젝트 관리)로 가는 길은
            전환기 하단 항목 하나로 남는다(§4). 나머지 값은 루트 셸과 같다(§14 · BrandMark). */}
        <BrandMark href={`/p/${id}`} />
        <ProjectNav id={id} />
        <ProjectSwitcher projects={items} currentId={id} />
      </header>

      <main className="w-full space-y-6 px-6 py-6">
        {/* 디스패치되지 않는 티켓 알림 (§0-2). 셸에 있으므로 보드뿐 아니라 워커·페르소나·
            프로토콜에도 뜬다 — 그래야 "해결 전까지 보인다"가 성립한다. dismiss·읽음 상태가 없다:
            폴링이 매번 다시 판정하므로 0건이 되면 이 노드가 사라지고, 안 되면 남는다.
            0건이면 `보류 없음`을 말하지 않는다 — 정상 상태에서 켜진 경고는 안 읽히게 된다. */}
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
