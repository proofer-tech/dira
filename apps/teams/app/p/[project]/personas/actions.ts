"use server";

/** 페르소나 화면의 서버 액션 — 저장 · 생성 · 삭제.
 *
 *  기준 디렉터리는 **`resolveConfig(project).personas`**다. `<루트>/personas`를 조립하지 않는다 —
 *  워커가 `TICKET_PERSONAS`를 재정의한 큐에서는 루트 밖을 편집해야 하고, 경로 방어의 기준도
 *  그 값이다(DESIGN.md §경로 방어).
 *
 *  검증(이름 규칙 · 기준 디렉터리 접두)은 `lib/projects.ts`에 있다. 이 파일이 하는 일은
 *  프로젝트 id → 해석된 디렉터리와, Error를 직렬화 가능한 결과로 바꾸는 것뿐이다. */
import { revalidatePath } from "next/cache";
import {
  createPersona,
  deletePersona,
  getProject,
  resolveConfig,
  savePersona,
  setPersonaColor,
} from "@/lib/projects";
import {
  listInstalledSkills,
  pickedSkills,
  readPersonaSkillsFile,
  writePersonaSkills,
  type Skill,
} from "@/lib/skills";

export type PersonaResult = { ok: boolean; message?: string };

/** 등록된 프로젝트의 해석된 페르소나 디렉터리만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function personasDir(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return (await resolveConfig(project)).personas;
}

function fail(e: unknown): PersonaResult {
  return { ok: false, message: (e as Error).message };
}

export async function savePersonaAction(
  projectId: string,
  name: string,
  body: string,
): Promise<PersonaResult> {
  try {
    await savePersona(await personasDir(projectId), name, body);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createPersonaAction(projectId: string, name: string): Promise<PersonaResult> {
  try {
    await createPersona(await personasDir(projectId), name.trim());
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 색은 **레지스트리**에 쓴다(DESIGN.md §5) — 이 액션만 큐를 아예 열지 않는 이유다.
 *  `PROFILE.md`가 없는 페르소나(`body: null`)도 고를 수 있다: 색은 큐의 사실이 아니라 표시 취향이고
 *  키는 이름이라 파일이 없어도 성립한다. 표시 지점이 여러 화면이라 `/p/<id>` 전체를 revalidate한다. */
export async function setPersonaColorAction(
  projectId: string,
  name: string,
  color: string | null,
): Promise<PersonaResult> {
  try {
    await setPersonaColor(projectId, name, color);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 스킬 목록 저장 — 0개면 `writePersonaSkills`가 파일을 지운다(DESIGN.md §5-1).
 *
 *  **받는 것은 고른 이름뿐이다.** 설명은 서버가 파일과 `SKILL.md`에서 읽어 채운다(`pickedSkills`) —
 *  클라이언트가 준 문자열이 그대로 큐의 파일이 되지 않고, 다이얼로그의 `저장`과 목록의 `제거`가
 *  같은 한 경로를 쓴다.
 *
 *  **쓴 뒤 그 파일을 다시 읽어 돌려준다.** 접힌 줄의 자수는 `skills.md` **파일 전체**를 세는데
 *  (§비주얼 §25) 사람이 손으로 덧붙인 산문까지 든 값이라 클라이언트가 계산할 수 없다. 화면이
 *  저장 직후에 참인 수를 그리는 길이 이 한 번의 되읽기다 — 두 번째 왕복을 만들지 않는다. */
export async function savePersonaSkillsAction(
  projectId: string,
  name: string,
  picked: string[],
): Promise<PersonaResult & { skills?: Skill[]; chars?: number }> {
  try {
    const dir = await personasDir(projectId);
    const [{ skills: current }, installed] = await Promise.all([
      readPersonaSkillsFile(dir, name),
      listInstalledSkills(),
    ]);
    await writePersonaSkills(dir, name, pickedSkills(picked, current, installed));
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true, ...(await readPersonaSkillsFile(dir, name)) };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePersonaAction(projectId: string, name: string): Promise<PersonaResult> {
  try {
    await deletePersona(await personasDir(projectId), name);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
