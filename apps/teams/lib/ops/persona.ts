/** 페르소나 - 스쿼드 - 휴지통 - 스킬 op 본체(P559-6, 결정 1). `app/(app)/p/[project]/personas/actions.ts`의 서버 액션이
 *  여기를 부르고 `revalidatePath`만 더한다. 반환값은 종전 액션과 같다(화면 결과 = MCP 결과). `next/*` import 금지. */
import path from "node:path";
import { copyToLocal, resolveHome, type ApmKind, type Home } from "../apm.ts";
import { DEFAULT_LOCALE, t, wrap, type Locale } from "../i18n.ts";
import { parseAssignment } from "../paths.ts";
import {
  checkSquadName,
  createPersona,
  createSquad,
  deletePersona,
  deleteSquad,
  getProject,
  hidePersona,
  listTrashAll,
  personaNames,
  purgeFromTrash,
  resolveConfig,
  restoreFromTrash,
  saveSquadMembers,
  saveSquadRules,
  savePersona,
  setPersonaColor,
  squadNames,
  squadsDir,
  unhidePersona,
  type SquadMember,
  type TrashEntry,
  type TrashKind,
} from "../projects.ts";
import {
  PersonaEngineCustomError,
  SkillInstallError,
  deletePersonaMemory,
  describeNewSkills,
  fetchSkillFromAddress,
  installSkill,
  listInstalledSkills,
  pickedSkills,
  readPersonaOffSkillsFile,
  readPersonaSkillsFile,
  writePersonaEngine,
  writePersonaLimit,
  writePersonaOffSkills,
  writePersonaSkills,
  type Skill,
} from "../skills.ts";
import { issueSquadTicket } from "../squad-tickets.ts";
import { engineRepo, type EngineId } from "../workers.ts";

export type PersonaResult = { ok: boolean; message?: string };
export type InstallSkillResult = { ok: boolean; title?: string; message?: string };
export type SquadTicketResult = { ok: boolean; message?: string; hash?: string };

const unknownProject = (projectId: string) =>
  new Error(wrap(t("ko", "persona.error.unknownProjectPrefix"), projectId, ""));

async function personasDir(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw unknownProject(projectId);
  return (await resolveConfig(project)).personas;
}

async function squadsDirFor(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw unknownProject(projectId);
  return squadsDir(project);
}

/** 쓰기 위치. `<큐>/team/`의 공용(`apm_modules`) 패키지면 거절한다(P506-5) - 서버가 막는다. */
async function writableHome(projectId: string, kind: ApmKind, name: string): Promise<Home> {
  const project = await getProject(projectId);
  if (!project) throw unknownProject(projectId);
  const base = kind === "persona" ? (await resolveConfig(project)).personas : squadsDir(project);
  const home = await resolveHome(project.root, kind, name, base);
  if (home.shared) throw new Error(wrap(t("ko", "persona.shared.blockedPrefix"), name, ""));
  return home;
}

const fail = (e: unknown): PersonaResult => ({ ok: false, message: (e as Error).message });

/** 던지면 `{ok:false}`로 바꿔 돌려주는 래퍼 - 종전 액션 본문의 try/catch와 같다. */
async function guard<T extends PersonaResult>(fn: () => Promise<T>): Promise<T | PersonaResult> {
  try {
    return await fn();
  } catch (e) {
    return fail(e);
  }
}

export const copySharedToLocal = (projectId: string, kind: ApmKind, name: string) =>
  guard(async () => {
    const project = await getProject(projectId);
    if (!project) throw unknownProject(projectId);
    await copyToLocal(project.root, kind, name);
    return { ok: true };
  });

export const personaSave = (projectId: string, name: string, body: string) =>
  guard(async () => {
    const home = await writableHome(projectId, "persona", name);
    await savePersona(home.base, home.name, body);
    return { ok: true };
  });

export const personaCreate = (projectId: string, name: string) =>
  guard(async () => {
    const trimmed = name.trim();
    // 스쿼드와 한 이름공간이다(§5-5 §값).
    const squads = await squadNames(await squadsDirFor(projectId));
    if (squads.includes(trimmed)) throw new Error(wrap(t("ko", "persona.error.squadNameTakenPrefix"), trimmed, ""));
    await createPersona(await personasDir(projectId), trimmed);
    return { ok: true };
  });

export const squadCreate = (projectId: string, name: string) =>
  guard(async () => {
    const trimmed = name.trim();
    const personas = await personaNames(await personasDir(projectId));
    if (personas.includes(trimmed)) throw new Error(wrap(t("ko", "persona.error.personaNameTakenPrefix"), trimmed, ""));
    await createSquad(await squadsDirFor(projectId), trimmed);
    return { ok: true };
  });

export const squadMembersSet = (projectId: string, name: string, members: SquadMember[]) =>
  guard(async () => {
    const home = await writableHome(projectId, "squad", name);
    await saveSquadMembers(home.base, home.name, members);
    return { ok: true };
  });

export const squadRulesSet = (projectId: string, name: string, rules: string) =>
  guard(async () => {
    const home = await writableHome(projectId, "squad", name);
    await saveSquadRules(home.base, home.name, rules);
    return { ok: true };
  });

export const squadDelete = (projectId: string, name: string) =>
  guard(async () => {
    await deleteSquad(await squadsDirFor(projectId), name);
    return { ok: true };
  });

export const personaColorSet = (projectId: string, name: string, color: string | null) =>
  guard(async () => {
    await setPersonaColor(projectId, name, color);
    return { ok: true };
  });

export const personaSkillsSet = (
  projectId: string,
  name: string,
  picked: string[],
  offPicked: string[],
): Promise<PersonaResult & { skills?: Skill[]; chars?: number; offSkills?: Skill[] }> =>
  guard(async () => {
    const dir = await personasDir(projectId);
    const home = await writableHome(projectId, "persona", name);
    const [{ skills: currentActive }, { skills: currentOff }, installed] = await Promise.all([
      readPersonaSkillsFile(home.base, home.name),
      readPersonaOffSkillsFile(dir, name),
      listInstalledSkills(),
    ]);
    const rawActive = pickedSkills(picked, currentActive, [...currentOff, ...installed]);
    const newActive = await describeNewSkills(rawActive, currentActive);
    const activeNames = new Set(newActive.map((s) => s.name));
    const newOff = pickedSkills(offPicked, currentOff, [...currentActive, ...installed]).filter(
      (s) => !activeNames.has(s.name),
    );
    await Promise.all([
      writePersonaSkills(home.base, home.name, newActive),
      writePersonaOffSkills(dir, name, newOff),
    ]);
    const [active, off] = await Promise.all([
      readPersonaSkillsFile(home.base, home.name),
      readPersonaOffSkillsFile(dir, name),
    ]);
    return { ok: true, skills: active.skills, chars: active.chars, offSkills: off.skills };
  });

/** 주소 한 줄로 스킬을 설치한다(업로드 갈래는 화면 액션에만 있다). */
export async function skillInstallAddress(
  address: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<InstallSkillResult & { installed?: Skill[]; name?: string }> {
  try {
    const skill = await installSkill(await fetchSkillFromAddress(address, locale), undefined, locale);
    return { ok: true, installed: await listInstalledSkills(), name: skill.name };
  } catch (e) {
    return installFail(e);
  }
}

/** 화면 액션의 업로드 갈래도 같은 실패 모양을 쓴다. */
export function installFail(e: unknown): InstallSkillResult {
  if (e instanceof SkillInstallError) return { ok: false, title: e.message, message: e.detail };
  return { ok: false, title: t("ko", "persona.skill.installFailedTitle"), message: (e as Error).message };
}

export async function skillList(): Promise<Skill[]> {
  return listInstalledSkills();
}

export const personaLimitSet = (
  projectId: string,
  name: string,
  value: string,
): Promise<PersonaResult & { limit?: number | null }> =>
  guard(async () => {
    const text = value.trim();
    if (text !== "" && !/^\d+$/.test(text)) throw new Error(wrap(t("ko", "persona.limit.invalidPrefix"), value, ""));
    const limit = text === "" ? null : Number(text);
    await writePersonaLimit(await personasDir(projectId), name, limit);
    return { ok: true, limit };
  });

export async function personaEngineSet(
  projectId: string,
  name: string,
  engine: string | null,
  model: string,
  effort = "",
  force = false,
): Promise<PersonaResult & { engine?: { engineId: EngineId; model: string; effort: string } | null; custom?: string }> {
  try {
    const result = await writePersonaEngine(
      await personasDir(projectId),
      name,
      engine as EngineId | null,
      model,
      effort,
      force,
    );
    return { ok: true, engine: result };
  } catch (e) {
    if (e instanceof PersonaEngineCustomError) return { ok: false, message: e.message, custom: e.raw };
    return fail(e);
  }
}

export const personaMemoryDelete = (projectId: string, name: string, file: string) =>
  guard(async () => {
    await deletePersonaMemory(await personasDir(projectId), name, file);
    return { ok: true };
  });

export const personaDelete = (projectId: string, name: string) =>
  guard(async () => {
    await deletePersona(await personasDir(projectId), name);
    return { ok: true };
  });

export const personaHide = (projectId: string, name: string) =>
  guard(async () => {
    await hidePersona(await personasDir(projectId), name);
    return { ok: true };
  });

export const personaUnhide = (projectId: string, name: string) =>
  guard(async () => {
    await unhidePersona(await personasDir(projectId), name);
    return { ok: true };
  });

export async function trashList(projectId: string): Promise<TrashEntry[]> {
  return listTrashAll(await personasDir(projectId), await squadsDirFor(projectId));
}

async function trashBase(projectId: string, kind: TrashKind): Promise<string> {
  return kind !== "squad" ? personasDir(projectId) : squadsDirFor(projectId);
}

export const trashRestore = (projectId: string, kind: TrashKind, entry: string) =>
  guard(async () => {
    await restoreFromTrash(await trashBase(projectId, kind), kind, entry);
    return { ok: true };
  });

export const trashPurge = (projectId: string, kind: TrashKind, entry: string) =>
  guard(async () => {
    await purgeFromTrash(await trashBase(projectId, kind), entry);
    return { ok: true };
  });

async function issueSquad(
  projectId: string,
  kind: "design" | "review",
  name: string,
  opts: { description?: string; assignee?: string },
): Promise<SquadTicketResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw unknownProject(projectId);
    const repo = engineRepo();
    if ("error" in repo) throw new Error(repo.error);
    const { persona, squad } = parseAssignment(opts.assignee ?? "");
    const hash = await issueSquadTicket(project.root, path.join(repo.path, "templates"), kind, name.trim(), {
      description: opts.description,
      persona,
      squad,
    });
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function squadDesignTicket(
  projectId: string,
  name: string,
  description: string,
  assignee: string,
): Promise<SquadTicketResult> {
  try {
    const trimmed = name.trim();
    await checkSquadName(await squadsDirFor(projectId), trimmed);
    if (!description.trim()) throw new Error(t("ko", "persona.create.designDescRequired"));
    const personas = await personaNames(await personasDir(projectId));
    if (personas.includes(trimmed)) throw new Error(wrap(t("ko", "persona.error.personaNameTakenPrefix"), trimmed, ""));
    const squads = await squadNames(await squadsDirFor(projectId));
    if (squads.includes(trimmed)) throw new Error(wrap(t("ko", "persona.error.squadNameTakenPrefix"), trimmed, ""));
  } catch (e) {
    return fail(e);
  }
  return issueSquad(projectId, "design", name, { description: description.replace(/\r\n/g, "\n"), assignee });
}

export async function squadReviewTicket(projectId: string, name: string): Promise<SquadTicketResult> {
  try {
    const squads = await squadNames(await squadsDirFor(projectId));
    if (!squads.includes(name)) throw new Error(wrap(t("ko", "persona.error.unknownSquadPrefix"), name, ""));
  } catch (e) {
    return fail(e);
  }
  return issueSquad(projectId, "review", name, { assignee: `squad:${name}` });
}
