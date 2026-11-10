/** 프로젝트 생성 op 본체(P559-1, 결정 1). `app/actions.ts`의 `createProject`가 여기를 부르고 화면에 필요한
 *  `done` 보기와 `revalidatePath`만 더한다. `next/*` import 금지 - `cli.ts`가 화면 서버 없이 돌린다. */
import path from "node:path";
import { track } from "../analytics.ts";
import { DEFAULT_LOCALE, t, type Locale } from "../i18n.ts";
import { assignPersonaColors } from "../persona-colors.ts";
import {
  ProjectError,
  addProject,
  personaNames,
  setPersonaColor,
  validateOntologyInput,
  type Project,
} from "../projects.ts";
import { preflight, scaffold } from "../scaffold.ts";
import {
  DEFAULT_SKILLS,
  SkillInstallError,
  defaultSkillsFor,
  fetchSkillFromAddress,
  hasNoslopLinter,
  installSkill,
  listInstalledSkills,
  writePersonaSkills,
} from "../skills.ts";
import { cronRegisterCmd, registerCron, writeOntology } from "../workers.ts";

export type OpError = { code: string; message: string; dup?: { id: string; name: string } };

export type CreateResult = {
  error?: OpError;
  /** `.dira`가 이미 있어서 **아무것도 만들지 않았다**(답변 4(b)). `queue`면 등록으로 보낸다. */
  exists?: { queue: boolean; root: string; message: string };
  /** 만든 것. `cron: false`면 파일은 다 있고 등록만 실패한 것이다. */
  created?: {
    root: string;
    repo: string;
    written: number;
    skipped: string[];
    cron: boolean;
    cronError?: string;
    registerCmd: string;
    /** 온톨로지 자리 칸이 거절됐다 - 만들기는 되돌리지 않는다. */
    ontologyError?: string;
    /** 받는 트리의 `receive.denyCurrentBranch`가 이미 다른 값이라 안 건드렸다. */
    denyCurrentBranchNote?: string;
    gitRepoError?: string;
    apmError?: string;
    skills: { installed: number; skipped: number; failed: number };
  };
  needId?: boolean;
  /** 등록까지 끝났을 때 새 프로젝트(화면이 해석 결과 표를 그릴 때 쓴다). */
  project?: Project;
};

export type CreateInput = {
  path: string;
  name: string;
  branch: string;
  specDoc?: string;
  ontology?: string;
  id?: string;
};

export function errorState(e: unknown): Pick<CreateResult, "error" | "needId"> {
  if (e instanceof ProjectError) {
    return {
      error: { code: e.code, message: e.message, dup: e.dup ? { id: e.dup.id, name: e.dup.name } : undefined },
      needId: e.code === "needId" || e.code === "dupId" || e.code === "badId",
    };
  }
  // 예상 못 한 실패는 원문을 그대로 보여준다. 삼키지 않는다(DESIGN.md §6 에러 3요소).
  return { error: { code: "unknown", message: (e as Error).message } };
}

/** 없는 큐를 만든다: `preflight` -> `scaffold` -> `registerCron(w1.sh)` -> `addProject`.
 *
 *  **어느 단계에서 실패해도 만든 파일을 되돌리지 않는다**(§0-3). 그 경로에 사람의 파일이 있을 수 있고,
 *  `wx`로 덮지 않는 것이 이 기능의 유일한 방어다. crontab 등록 실패는 성공 보고를 막지 않는다. */
export async function createProjectOp(
  input: CreateInput,
  locale: Locale = DEFAULT_LOCALE,
  deps: { registerCron?: typeof registerCron } = {},
): Promise<CreateResult> {
  const register = deps.registerCron ?? registerCron;
  let created: CreateResult["created"] | undefined;
  // 한국어 갈래는 화면 언어가 정한다(P483) - 만들기 폼에 체크 칸이 없다.
  const korean = locale === "ko";
  try {
    const branch = String(input.branch ?? "").trim();
    if (!branch) {
      // 비면 push 절차가 자리표시자로 남아 세션이 추측한다(§0-3 자리표시자 표).
      return { error: { code: "branch", message: t(locale, "project.branchRequired") } };
    }
    const pre = await preflight(String(input.path ?? ""), locale);
    if (!pre.ok) return { exists: { queue: pre.queue, root: pre.root, message: pre.message } };

    const made = await scaffold(
      input.path,
      { branch, specDoc: input.specDoc?.trim() || undefined },
      locale,
    );

    // 온톨로지 자리: scaffold 다음, registerCron 앞. 비면 아무것도 안 쓴다. 거절돼도 되돌리지 않는다.
    let ontologyError: string | undefined;
    const ontologyInput = input.ontology?.trim();
    if (ontologyInput) {
      try {
        const resolved = await validateOntologyInput(made.root, ontologyInput, locale);
        await writeOntology(made.root, resolved);
      } catch (e) {
        ontologyError = (e as Error).message;
      }
    }

    const workerPath = path.join(made.root, "workers", "w1.sh");
    const cronError = await register(workerPath).then(
      () => undefined,
      (e: Error) => e.message,
    );
    created = {
      root: made.root,
      repo: made.repo,
      written: made.written.length,
      skipped: made.skipped,
      cron: !cronError,
      cronError,
      ontologyError,
      denyCurrentBranchNote: made.denyCurrentBranchNote,
      gitRepoError: made.gitRepoError,
      apmError: made.apmError,
      registerCmd: cronRegisterCmd({ path: workerPath }),
      skills: { installed: 0, skipped: 0, failed: 0 },
    };

    const project = await addProject(input.name, made.root, input.id?.trim() || undefined, locale);
    // 스캐폴딩만 되고 등록이 실패하면 여기 안 온다 - 프로젝트가 하나 는 것이 이 이벤트다(§0-11).
    void track("project_add", { method: "create" });

    // 새 프로젝트는 페르소나 색을 갖고 태어난다(결정 5) - 실패해도 생성 자체는 막지 않는다.
    try {
      const names = await personaNames(path.join(made.root, "personas"));
      const colors = assignPersonaColors(names);
      for (const [persona, color] of Object.entries(colors)) {
        await setPersonaColor(project.id, persona, color, locale);
      }
    } catch {
      // 색 없이 태어난 프로젝트는 종전 모습 그대로다 - 사람이 눌러서 고르면 된다.
    }

    // 새 프로젝트는 스킬을 받아서 태어난다(결정 8-9, P483) - 실패해도 생성 자체는 막지 않는다.
    // 동시에 받는다(결정 8) - 직렬이면 최악이 타임아웃 곱하기 행 수다.
    try {
      const linterOk = korean ? await hasNoslopLinter() : false;
      const targets = DEFAULT_SKILLS.filter((s) => !s.requiresKorean || (korean && linterOk));
      const results = await Promise.allSettled(
        targets.map(async (s) => installSkill(await fetchSkillFromAddress(s.address, locale), undefined, locale)),
      );
      const conflictMessage = t("ko", "persona.skill.installNameConflict");
      let installedN = 0;
      let skippedN = 0;
      let failedN = 0;
      for (const r of results) {
        if (r.status === "fulfilled") installedN++;
        // 이름이 이미 있어 나는 mkdir EEXIST는 실패가 아니라 건너뜀이다 - 사람이 쓰던 것이 이긴다.
        else if (r.reason instanceof SkillInstallError && r.reason.message === conflictMessage) skippedN++;
        else failedN++;
      }
      created.skills = { installed: installedN, skipped: skippedN, failed: failedN };
      const installed = await listInstalledSkills();
      const skillPersonas = await personaNames(path.join(made.root, "personas"));
      for (const persona of skillPersonas) {
        await writePersonaSkills(
          path.join(made.root, "personas"),
          persona,
          defaultSkillsFor(persona, installed, korean),
        );
      }
    } catch {
      // 스킬 없이 태어난 프로젝트는 종전 모습 그대로다 - `skills.md`가 0장일 뿐이다.
    }

    return { created, project };
  } catch (e) {
    const state: CreateResult = { ...errorState(e), created };
    // 파일은 이미 놓였는데 레지스트리 등록만 실패한 경우. 다음 행동은 "다시 만들기"가 아니라 "그 경로를 등록하기"다.
    if (created && state.error) {
      state.error.message += ` ${t(locale, "project.createdRegisterFailedPrefix")} ${created.root}${t(locale, "project.createdRegisterFailedSuffix")}`;
    }
    return state;
  }
}
