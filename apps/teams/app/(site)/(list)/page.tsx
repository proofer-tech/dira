/** `/` — 랜딩(공개 사이트)과 프로젝트 목록이 같은 URL에서 만난다(§한 코드베이스, 요구
 *  `80fe164a`). `index.md`(`layout: page`) + `Landing.vue`가 여기로 왔던 그 자리(§사이트 기반
 *  §갈아 끼우는 것)에 목록이 더 얹힌다 — `version.ts`가 `node:fs`로 읽으므로 이 줄은 서버에
 *  남아야 한다.
 *
 *  이 파일이 하는 일은 예전 `(list)/page.tsx`(프로젝트 레지스트리 읽기)와 예전 site
 *  `page.tsx`(버전 읽고 `<Landing>` 렌더)를 합치는 것뿐이다 — 헤더·등록 다이얼로그·설정·
 *  레지스트리 오류 배너 같은 나머지 조립은 **이 티켓이 안 한다**(§홈 표 — 폭·간격·버튼은
 *  P199-3(designer)이 정하고 P199-4가 조립한다). 여기서 넘기는 것은 히어로 CTA 자리에
 *  설 목록 표 하나뿐이다.
 *
 *  ponytail: 레지스트리를 못 읽으면 목록 없이 조용히 접는다(빈 배열) — 예전 `registryError`
 *  배너·등록 다이얼로그·설정 다이얼로그는 걷힌 `<ProjectsSection>`과 한 조각이다. 복원이
 *  필요해지면 P199-4가 그 조각째 다시 잇는다. */
import { homedir } from "node:os";
import { ProjectRows, type ProjectRow } from "@/components/projects-ui";
import { isLandingOnly } from "@/lib/flags";
import { readProjects, readSummary } from "@/lib/projects";
import { tildePath } from "@/lib/urls";
import { workerGroups } from "@/lib/workers";
import { diraVersion } from "../../../version";
import Landing from "../landing";
import { pageMetadata } from "../meta";
// 홈은 랜딩 전역 CSS(`../landing.tsx`가 이미 무는 `fonts.css`·`landing.css`)와 tailwind 리셋을
// **둘 다 문다**(§한 코드베이스 §부딪히는 것 ②) — 목록 표가 shadcn(tailwind)이라서다.
// 다른 사이트 페이지(`/docs/**`·`/privacy`·`/terms`)는 이 리셋이 필요 없어 여기서만 문다.
import "../../globals.css";

// `index.md`가 `titleTemplate: false`였던 유일한 장이라 `<title>`에 사이트 이름이 안 붙는다.
export const metadata = pageMetadata("/", "dira - 로컬 멀티 에이전트 매니지먼트 시스템", {
  suffix: false,
});

// 레지스트리·큐는 GUI 밖에서(사람·cron이) 바뀐다. 프리렌더하면 빌드 시점 목록이 굳는다.
export const dynamic = "force-dynamic";

export default async function Page() {
  const home = homedir();

  let rows: ProjectRow[] = [];
  // 랜딩-only는 이 절을 통째로 건너뛴다 — 레지스트리 읽기 0회가 §플래그의 fs 요건이다.
  if (!isLandingOnly()) {
    try {
      const projects = await readProjects();
      const summaries = await Promise.all(
        projects.map(async (t) => ({ project: t, summary: await readSummary(t) })),
      );
      rows = summaries.map(({ project: t, summary: s }) => ({
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
      }));
    } catch {
      // 레지스트리를 못 읽어도 랜딩은 선다 — 목록 자리가 그냥 빈다.
    }
  }

  return (
    <Landing version={diraVersion}>
      {rows.length > 0 && <ProjectRows rows={rows} />}
    </Landing>
  );
}
