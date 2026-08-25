/** `/` — 랜딩(공개 사이트)과 프로젝트 목록이 같은 URL에서 만난다(§한 코드베이스, 요구
 *  `80fe164a`). `index.md`(`layout: page`) + `Landing.vue`가 여기로 왔던 그 자리(§사이트 기반
 *  §갈아 끼우는 것)에 목록이 더 얹힌다 — `version.ts`가 `node:fs`로 읽으므로 이 줄은 서버에
 *  남아야 한다.
 *
 *  풀 모드(`fullMode`)에서 헤더 버튼 셋·다섯 상태(§한 코드베이스 §홈 · §비주얼 §46)를 조립한다.
 *  레지스트리·인증 읽기는 전부 여기(서버)에서 나고 `<Landing>`은 값만 받는다 — 클라이언트가
 *  `node:fs`를 못 읽어서다(위 `landing.tsx`의 그 줄과 같은 이유). 랜딩-only는 이 블록을 통째로
 *  건너뛴다 — 레지스트리·인증·워커 파일 읽기 0회가 §플래그의 fs 요건이다(§한 코드베이스 §플래그). */
import { homedir } from "node:os";
import { readAuth, readOtherEngineAuth } from "@/lib/auth";
import { type AuthView } from "@/components/settings-dialog";
import { LanguageProvider } from "@/components/language-provider";
import { ProjectRows, type ProjectRow } from "@/components/projects-ui";
import { UpdateToast } from "@/components/update-toast";
import { isLandingOnly } from "@/lib/flags";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { readLanguage, readProjects, readSummary, registryPath } from "@/lib/projects";
import { tildePath } from "@/lib/urls";
import { engineName, workerGroups } from "@/lib/workers";
import { diraVersion } from "../../../version";
import Landing from "../landing";
import { pageMetadata } from "../meta";
// 홈은 랜딩 전역 CSS(`../landing.tsx`가 이미 무는 `fonts.css`, `globals.css`가 싣는 `landing.css`)와
// tailwind 리셋을 **둘 다 문다**(§한 코드베이스 §부딪히는 것 ②) — 목록 표가 shadcn(tailwind)이라서다.
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
  const fullMode = !isLandingOnly();

  let rows: ProjectRow[] = [];
  let registryError: { message: string; openCmd: string } | null = null;
  let auth: AuthView | null = null;
  // §0-16 §설정 노드 — 헤더 `설정`(트리거 `text`)이 여기서만 뜬다(fullMode). 랜딩-only는
  // 그 다이얼로그 자체가 없으니 읽을 이유가 없다 — 위 §플래그 fs 요건과 같은 선이다.
  let locale = DEFAULT_LOCALE;

  if (fullMode) {
    // 인증은 머신당 하나다(§0-4 자리 표) — 레지스트리 성패와 무관하게 읽는다. 헤더 `설정`이
    // 등록된 프로젝트가 0건이거나 레지스트리가 깨져도 그대로 동작해야 해서다.
    const rawAuth = await readAuth();
    const otherEngines = await readOtherEngineAuth();
    locale = await readLanguage();

    // 레지스트리가 깨졌으면 GUI가 고쳐 쓰려 들지 않는다 — 원문 + 여는 명령을 보여주고
    // 사람이 연다. 랜딩 절 전부는 그대로 뜬다(§비주얼 §46 ⑤ 레지스트리 오류 상태).
    let projects: Awaited<ReturnType<typeof readProjects>> = [];
    try {
      projects = await readProjects();
    } catch (e) {
      registryError = { message: (e as Error).message, openCmd: `open -e "${registryPath()}"` };
    }

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

    // 헤더 `설정`의 `인증 필요`는 끄는 쪽에 증거가 필요하다(§0-4) — 등록된 프로젝트 전부에서
    // claude 엔진이 0일 때만 끈다. 못 읽은 프로젝트·프로젝트 0건은 판정 불가 = 세운다.
    const claudeUsed =
      summaries.length === 0 ||
      summaries.some(
        ({ summary: s }) => !s.connected || s.workers.some((w) => engineName(w.engine) === "claude"),
      );
    auth = {
      path: tildePath(rawAuth.path, home),
      savedAt: rawAuth.savedAt,
      cli: rawAuth.cli,
      claudeUsed,
      otherEngines,
    };
  }

  return (
    <LanguageProvider locale={locale}>
      <Landing
        version={diraVersion}
        fullMode={fullMode}
        empty={rows.length === 0}
        registryError={registryError}
        auth={auth}
        home={home}
      >
        {rows.length > 0 && <ProjectRows rows={rows} />}
      </Landing>
      {/* T1(§릴리스 - 자동 업데이트 §표면이 창 안으로 들어온다, 요구 `1c5db160`) - 창이 처음 여는
          화면이 홈이라 `(app)/layout.tsx`와 같은 자리가 여기도 떠야 한다. 브라우저·랜딩-only에서는
          `useIsDesktop()`이 `false`라 이 컴포넌트가 그 자리에서 바로 `null`이다 - 새로 뜨는 것도
          fs 읽기도 늘지 않는다. */}
      <UpdateToast />
    </LanguageProvider>
  );
}
