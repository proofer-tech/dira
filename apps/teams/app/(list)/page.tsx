/** 프로젝트 목록·등록 `/` — 앱의 홈. 프로젝트가 0개면 이 화면이 온보딩이다 (DESIGN.md §0 · §7). */
import { homedir } from "node:os";
import { ProjectsSection, ProjectRows, type ProjectRow } from "@/components/projects-ui";
import { readAuth } from "@/lib/auth";
import { readSummary, readProjects, registryPath } from "@/lib/projects";
import { tildePath } from "@/lib/urls";
import { engineName, workerGroups } from "@/lib/workers";

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
  const summaries = await Promise.all(
    projects.map(async (t) => ({ project: t, summary: await readSummary(t) })),
  );
  const rows: ProjectRow[] = summaries.map(({ project: t, summary: s }) => ({
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

  // 헤더 버튼의 `인증 필요`를 **끄는 쪽에 증거가 필요하다**(§0-4): 등록된 프로젝트를 전부 읽었고
  // 그 전부에서 claude 엔진이 0일 때만 끈다. 못 읽은 프로젝트·프로젝트 0건은 판정 불가 = 세운다
  // (토큰이 없는 사람은 대개 프로젝트도 0개다). 워커는 `readSummary`가 이미 읽었다 — fs 읽기 0.
  const claudeUsed =
    summaries.length === 0 ||
    summaries.some(
      ({ summary: s }) => !s.connected || s.workers.some((w) => engineName(w.engine) === "claude"),
    );

  // 헤더 행(`h1` + 액션)이 헤더 바에 서면서 **셸까지 이 조각이 그린다**(§비주얼 §4 루트 셸 항).
  // 서버가 `<header>`를 그리고 버튼만 클라이언트로 내리면 헤더 행과 결과 슬롯이 두 트리로 갈려
  // 등록 성공 시 해석 결과 카드가 사라진다(§0 마지막 항). 레지스트리 오류는 값으로 넘긴다 —
  // `registryPath()`가 서버 전용이라 문자열만 건너간다.
  return (
    <ProjectsSection
      empty={rows.length === 0}
      auth={{ path: tildePath(auth.path, home), savedAt: auth.savedAt, cli: auth.cli, claudeUsed }}
      home={home}
      registryError={
        registryError ? { message: registryError, openCmd: `open -e "${registryPath()}"` } : null
      }
    >
      {rows.length > 0 && <ProjectRows rows={rows} />}
    </ProjectsSection>
  );
}
