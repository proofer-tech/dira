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
import { t, wrap } from "@/lib/i18n";
import {
  createPersona,
  createSquad,
  deletePersona,
  deleteSquad,
  getProject,
  personaNames,
  resolveConfig,
  saveSquadMembers,
  saveSquadRules,
  savePersona,
  setPersonaColor,
  squadNames,
  squadsDir,
  type SquadMember,
} from "@/lib/projects";
import {
  deletePersonaMemory,
  extractSkillArchive,
  fetchSkillFromAddress,
  installSkill,
  listInstalledSkills,
  PersonaEngineCustomError,
  pickedSkills,
  readPersonaOffSkillsFile,
  readPersonaSkillsFile,
  SkillInstallError,
  writePersonaEngine,
  writePersonaLimit,
  writePersonaOffSkills,
  writePersonaSkills,
  type Skill,
  type SkillUpload,
} from "@/lib/skills";
import type { EngineId } from "@/lib/workers";

export type PersonaResult = { ok: boolean; message?: string };

/** import 실패 — 갈래별 두 조각(§비주얼 §25 ⑤). `title`은 `<Failure>`의 `AlertTitle`,
 *  `message`는 `AlertDescription`(mono)이다 — 다른 액션의 `PersonaResult.message` 한 칸과
 *  달리 여기만 둘로 갈리는 이유가 그 절이 §6 에러 3요소를 두 슬롯에 나눠 담기 때문이다. */
export type InstallSkillResult = { ok: boolean; title?: string; message?: string };

/** 등록된 프로젝트의 해석된 페르소나 디렉터리만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function personasDir(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(wrap(t("ko", "persona.error.unknownProjectPrefix"), projectId, ""));
  return (await resolveConfig(project)).personas;
}

/** 스쿼드 디렉터리 — `ontologyDir`과 같은 근거로 워커 재정의를 안 연다(§5-5 §값). */
async function squadsDirFor(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(wrap(t("ko", "persona.error.unknownProjectPrefix"), projectId, ""));
  return squadsDir(project);
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
    const trimmed = name.trim();
    // 스쿼드와 한 이름공간이다(§5-5 §값) — 겹치면 §할당 입구 둘에서 항목이 구별되지 않는다.
    const squads = await squadNames(await squadsDirFor(projectId));
    if (squads.includes(trimmed))
      throw new Error(wrap(t("ko", "persona.error.squadNameTakenPrefix"), trimmed, ""));
    await createPersona(await personasDir(projectId), trimmed);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 스쿼드 생성(DESIGN.md §5-5). 페르소나와 한 이름공간이라 겹치면 거부한다 — `NAME_RE` 검사가
 *  이미 서 있는 그 자리에 목록 조회 한 번이 는다(§5-5 §값). */
export async function createSquadAction(projectId: string, name: string): Promise<PersonaResult> {
  try {
    const trimmed = name.trim();
    const personas = await personaNames(await personasDir(projectId));
    if (personas.includes(trimmed))
      throw new Error(wrap(t("ko", "persona.error.personaNameTakenPrefix"), trimmed, ""));
    await createSquad(await squadsDirFor(projectId), trimmed);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 멤버 저장(DESIGN.md §5-5 §화면) — 고른 이름 + 역할을 목록 순서로 한 줄씩, 0개면 빈 파일. */
export async function saveSquadMembersAction(
  projectId: string,
  name: string,
  members: SquadMember[],
): Promise<PersonaResult> {
  try {
    await saveSquadMembers(await squadsDirFor(projectId), name, members);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `rules` 저장(DESIGN.md §5-5 §개정) — 빈 값이면 파일을 지운다. */
export async function saveSquadRulesAction(
  projectId: string,
  name: string,
  rules: string,
): Promise<PersonaResult> {
  try {
    await saveSquadRules(await squadsDirFor(projectId), name, rules);
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSquadAction(projectId: string, name: string): Promise<PersonaResult> {
  try {
    await deleteSquad(await squadsDirFor(projectId), name);
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

/** 스킬 목록 저장 — 0개면 `writePersonaSkills`·`writePersonaOffSkills`가 그 파일을 지운다
 *  (DESIGN.md §5-1 §n:m 배정과 비활성). **한 창구다** — 다이얼로그의 `저장`, 활성 줄의 `제거`,
 *  비활성 줄의 `제거`·`끄기`·`켜기`가 전부 이 액션을 부른다. 매번 **두 목록을 함께** 보낸다.
 *
 *  **받는 것은 고른 이름뿐이다.** 설명은 서버가 두 파일과 `SKILL.md`에서 읽어 채운다
 *  (`pickedSkills`) — 클라이언트가 준 문자열이 그대로 큐의 파일이 되지 않는다. 이름이 어느
 *  파일에서 왔는지 안 가리므로 `pickedSkills`를 두 번 부를 때 서로의 현재 목록을 상대 쪽의
 *  "설치본" 자리에 얹는다 — 활성<->비활성 사이를 옮겨도 설명을 잃지 않는다.
 *
 *  **활성이 이긴다**(§5-1 §충돌) — 두 목록에 같은 이름이 남으면 비활성에서 뺀다. 손으로 두
 *  파일에 같은 이름을 넣어 둔 경우도, 다이얼로그가 비활성 이름을 체크해 활성으로 올린 경우도
 *  이 한 줄이 같이 처리한다.
 *
 *  **쓴 뒤 그 파일들을 다시 읽어 돌려준다.** 접힌 줄의 자수는 `skills.md` **파일 전체**를 세는데
 *  (§비주얼 §25) 사람이 손으로 덧붙인 산문까지 든 값이라 클라이언트가 계산할 수 없다. 화면이
 *  저장 직후에 참인 수를 그리는 길이 이 한 번의 되읽기다 — 두 번째 왕복을 만들지 않는다. */
export async function savePersonaSkillsAction(
  projectId: string,
  name: string,
  picked: string[],
  offPicked: string[],
): Promise<PersonaResult & { skills?: Skill[]; chars?: number; offSkills?: Skill[] }> {
  try {
    const dir = await personasDir(projectId);
    const [{ skills: currentActive }, { skills: currentOff }, installed] = await Promise.all([
      readPersonaSkillsFile(dir, name),
      readPersonaOffSkillsFile(dir, name),
      listInstalledSkills(),
    ]);
    const newActive = pickedSkills(picked, currentActive, [...currentOff, ...installed]);
    const activeNames = new Set(newActive.map((s) => s.name));
    const newOff = pickedSkills(offPicked, currentOff, [...currentActive, ...installed]).filter(
      (s) => !activeNames.has(s.name),
    );
    await Promise.all([
      writePersonaSkills(dir, name, newActive),
      writePersonaOffSkills(dir, name, newOff),
    ]);
    revalidatePath(`/p/${projectId}/personas`);
    const [active, off] = await Promise.all([
      readPersonaSkillsFile(dir, name),
      readPersonaOffSkillsFile(dir, name),
    ]);
    return { ok: true, skills: active.skills, chars: active.chars, offSkills: off.skills };
  } catch (e) {
    return fail(e);
  }
}

/** import — 첨부한 스킬을 이 머신에 설치한다(DESIGN.md §5-1 §import · §비주얼 §25 ⑤).
 *
 *  **페르소나도 프로젝트도 안 받는다** — 설치는 머신의 사실이지 페르소나의 사실이 아니다(§5-1).
 *  큐를 안 열고 `skills.md`도 안 건드린다: 그 파일은 여전히 `저장`이 쓴다. `revalidatePath`가
 *  없는 것도 같은 이유다 — 서버 컴포넌트가 다시 읽을 파일이 없다.
 *
 *  받는 것은 `file` 여러 개 + **같은 순서의 `path` 여러 개**다(화면이 한 장 모드는 `path`를
 *  `SKILL.md` 하나로, 폴더 모드는 `webkitRelativePath`의 첫 성분을 뗀 값으로 채운다). `File.name`을
 *  `originalName`으로 같이 넘긴다 — 한 장 모드에서 고른 파일명이 `SKILL.md`가 아닐 수 있고,
 *  §비주얼 §25 ⑤ 표의 갈래 1(name 없음)이 그 이름을 사유에 적는다.
 *
 *  **셋째 입구(`.skill`)는 화면이 보내는 모양이 한 장 모드와 같다** — 파일 한 장 + `path`
 *  `SKILL.md`다(§비주얼 §25 ⑤). 통로가 하나뿐이라는 §5-1의 계약대로, 파일 이름이 `.skill`로
 *  끝나면 그 zip을 `installSkill`에 넣기 **전에** `extractSkillArchive`로 먼저 푼다. zip이
 *  아니거나 안에 `SKILL.md`가 없으면 `extractSkillArchive` 자신이 갈래 7 - 8로 거절한다.
 *
 *  **넷째 입구(주소 한 줄)는 `file`/`path` 대신 `address` 하나를 받는다**(§5-1 §넷째 입구 -
 *  §비주얼 §25 ⑦). `fetchSkillFromAddress`(`b4b3a8c0`)가 정규화 - 받기 - 상한을 다 지고
 *  `SkillUpload[]`를 낸 뒤, 그 아래는 파일 갈래와 **같은 `installSkill`**로 들어간다 — 통로가
 *  하나라는 것의 내용이다.
 *
 *  설치 뒤 `listInstalledSkills()`를 **다시 읽어 후보 목록 전체를 돌려준다** — 화면은 서버가 본
 *  것을 그린다(`savePersonaSkillsAction`과 같은 규약). 실패는 `SkillInstallError`의 두 조각
 *  (`message`·`detail`)을 `title`·`message`로 그대로 옮긴다 — 갈래마다 사유가 다르다. */
export async function installSkillAction(
  formData: FormData,
): Promise<InstallSkillResult & { installed?: Skill[]; name?: string }> {
  try {
    const address = formData.get("address");
    let uploads: SkillUpload[];
    if (typeof address === "string" && address !== "") {
      uploads = await fetchSkillFromAddress(address);
    } else {
      const files = formData.getAll("file").filter((f): f is File => f instanceof File);
      const paths = formData.getAll("path").map(String);
      if (files.length === 0 || files.length !== paths.length) {
        throw new Error(
          wrap(t("ko", "persona.skill.fileCountMismatchPrefix"), `${files.length} / ${paths.length}`, ""),
        );
      }
      uploads =
        files.length === 1 && files[0].name.endsWith(".skill")
          ? await extractSkillArchive(Buffer.from(await files[0].arrayBuffer()), files[0].name)
          : await Promise.all(
              files.map(async (file, i) => ({
                path: paths[i],
                bytes: Buffer.from(await file.arrayBuffer()),
                originalName: file.name,
              })),
            );
    }
    const skill = await installSkill(uploads);
    return { ok: true, installed: await listInstalledSkills(), name: skill.name };
  } catch (e) {
    if (e instanceof SkillInstallError) return { ok: false, title: e.message, message: e.detail };
    return { ok: false, title: t("ko", "persona.skill.installFailedTitle"), message: (e as Error).message };
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
      throw new Error(wrap(t("ko", "persona.limit.invalidPrefix"), value, ""));
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
 *  `engineArgv`) 안에서 던진다 — 이 액션은 그 문 하나를 통과시킬 뿐이다(§23 ④와 같은 신뢰 경계).
 *
 *  **지금 파일이 커스텀 값(`PersonaEngineCustomError`)이면 `force` 없이는 거절한다** — 화면이
 *  그 원문(`custom`)을 받아 확인 다이얼로그를 띄우고, 사람이 확인하면 `force: true`로 다시
 *  부른다(`77ca2128`, PROFILE.md §파일 쓰기). */
export async function savePersonaEngineAction(
  projectId: string,
  name: string,
  engine: string | null,
  model: string,
  force = false,
): Promise<PersonaResult & { engine?: { engineId: EngineId; model: string } | null; custom?: string }> {
  try {
    const result = await writePersonaEngine(
      await personasDir(projectId),
      name,
      engine as EngineId | null,
      model,
      force,
    );
    revalidatePath(`/p/${projectId}/personas`);
    return { ok: true, engine: result };
  } catch (e) {
    if (e instanceof PersonaEngineCustomError) return { ok: false, message: e.message, custom: e.raw };
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
