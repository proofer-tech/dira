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
  deletePersonaMemory,
  listInstalledSkills,
  pickedSkills,
  readPersonaSkillsFile,
  writePersonaEngine,
  writePersonaLimit,
  writePersonaSkills,
  type Skill,
} from "@/lib/skills";
import type { EngineId } from "@/lib/workers";

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

/** 동시 워커 상한 저장(DESIGN.md §5-4 §화면). **빈 값이면 파일을 지운다**(= 상한 없음).
 *
 *  **받는 것은 입력칸의 문자열 그대로다.** 숫자로 파싱하는 자리가 서버 하나여야 한다 —
 *  클라이언트 검증은 검증이 아니고, `<input type="number">`도 사람이 아무거나 칠 수 있다.
 *  `0`은 유효한 값이다(그 페르소나 일시 정지 — §5-4 표). */
export async function savePersonaLimitAction(
  projectId: string,
  name: string,
  value: string,
): Promise<PersonaResult & { limit?: number | null }> {
  try {
    const text = value.trim();
    if (text !== "" && !/^\d+$/.test(text)) {
      throw new Error(`상한은 0 이상의 정수여야 합니다: ${value}`);
    }
    const limit = text === "" ? null : Number(text);
    await writePersonaLimit(await personasDir(projectId), name, limit);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true, limit };
  } catch (e) {
    return fail(e);
  }
}

/** 페르소나별 실행 엔진 저장(§제약 1 §결정 기록 §열한 번째 · §23 컨트롤 재사용).
 *  **`engine`이 `null`이면 파일을 지운다**(= 지정 없음 — 그 페르소나는 워커 자신의 엔진을 쓴다).
 *
 *  카탈로그 검증(모르는 엔진·셸 메타문자가 든 모델)은 `writePersonaEngine`(→`renderEngineBlock`→
 *  `engineArgv`) 안에서 던진다 — 이 액션은 그 문 하나를 통과시킬 뿐이다(§23 ④와 같은 신뢰 경계). */
export async function savePersonaEngineAction(
  projectId: string,
  name: string,
  engine: string | null,
  model: string,
): Promise<PersonaResult & { engine?: { engineId: EngineId; model: string } | null }> {
  try {
    const result = await writePersonaEngine(
      await personasDir(projectId),
      name,
      engine as EngineId | null,
      model,
    );
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true, engine: result };
  } catch (e) {
    return fail(e);
  }
}

/** 메모리 파일 하나 삭제(DESIGN.md §5-2 §화면). **추가·편집 액션은 없다** — 쓰는 쪽이 세션이다.
 *
 *  방어는 `deletePersonaMemory` 안에 있다: 클라이언트가 준 파일명은 그 페르소나의 `memory/`를
 *  실제로 나열해 나온 목록 안에 있을 때만 지운다. 여기서 경로를 조립하지 않는다. */
export async function deletePersonaMemoryAction(
  projectId: string,
  name: string,
  file: string,
): Promise<PersonaResult> {
  try {
    await deletePersonaMemory(await personasDir(projectId), name, file);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
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
