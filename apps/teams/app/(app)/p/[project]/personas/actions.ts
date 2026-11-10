"use server";

/** 페르소나 화면의 서버 액션 - 껍데기다(P559-6). 본체는 `lib/ops/persona.ts`에 있고 MCP op가 같은 함수를 부른다.
 *  이 파일은 성공했을 때 `revalidatePath`만 더한다. */
import { revalidatePath } from "next/cache";
import path from "node:path";
import { resolveHome, type ApmKind } from "@/lib/apm";
import { DEFAULT_LOCALE, t, wrap, type Locale } from "@/lib/i18n";
import * as op from "@/lib/ops/persona";
import { openInApp, type OpenResult } from "@/lib/paths";
import { getProject, personaFilePath, resolveConfig, type SquadMember, type TrashEntry, type TrashKind } from "@/lib/projects";
import {
  extractSkillArchive,
  installSkill,
  listInstalledSkills,
  type Skill,
  type SkillUpload,
} from "@/lib/skills";

export type PersonaResult = op.PersonaResult;
export type InstallSkillResult = op.InstallSkillResult;
export type SquadTicketResult = op.SquadTicketResult;

/** 성공한 뒤에만 화면을 다시 그린다. */
async function done<T extends { ok: boolean }>(projectId: string, r: Promise<T>, layout = false): Promise<T> {
  const res = await r;
  if (res.ok) {
    if (layout) revalidatePath(`/p/${projectId}`, "layout");
    else revalidatePath(`/p/${projectId}/personas`);
  }
  return res;
}

export async function copySharedToLocalAction(projectId: string, kind: ApmKind, name: string): Promise<PersonaResult> {
  return done(projectId, op.copySharedToLocal(projectId, kind, name));
}
export async function savePersonaAction(projectId: string, name: string, body: string): Promise<PersonaResult> {
  return done(projectId, op.personaSave(projectId, name, body));
}

/** "OS 기본 앱으로 열기" 버튼 - 화면 상호작용이라 op가 없다. */
export async function openPersonaProfileAction(projectId: string, name: string): Promise<OpenResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(wrap(t("ko", "persona.error.unknownProjectPrefix"), projectId, ""));
    const base = (await resolveConfig(project)).personas;
    const home = await resolveHome(project.root, "persona", name, base);
    return await openInApp(await personaFilePath(home.base, home.name, "PROFILE.md"));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function createPersonaAction(projectId: string, name: string): Promise<PersonaResult> {
  return done(projectId, op.personaCreate(projectId, name));
}
export async function createSquadAction(projectId: string, name: string): Promise<PersonaResult> {
  return done(projectId, op.squadCreate(projectId, name));
}
export async function saveSquadMembersAction(projectId: string, name: string, members: SquadMember[]): Promise<PersonaResult> {
  return done(projectId, op.squadMembersSet(projectId, name, members));
}
export async function saveSquadRulesAction(projectId: string, name: string, rules: string): Promise<PersonaResult> {
  return done(projectId, op.squadRulesSet(projectId, name, rules));
}
export async function deleteSquadAction(projectId: string, name: string): Promise<PersonaResult> {
  return done(projectId, op.squadDelete(projectId, name));
}
/** 색은 레지스트리에 쓰고 표시 지점이 여러 화면이라 `/p/<id>` 전체를 다시 그린다. */
export async function setPersonaColorAction(projectId: string, name: string, color: string | null): Promise<PersonaResult> {
  return done(projectId, op.personaColorSet(projectId, name, color), true);
}
export async function savePersonaSkillsAction(
  projectId: string,
  name: string,
  picked: string[],
  offPicked: string[],
): Promise<PersonaResult & { skills?: Skill[]; chars?: number; offSkills?: Skill[] }> {
  return done(projectId, op.personaSkillsSet(projectId, name, picked, offPicked));
}

/** 스킬 설치. 주소 갈래는 op와 같고, 파일 업로드 갈래(한 장 - 폴더 - `.skill`)는 화면에만 있다(P559 결정 8). */
export async function installSkillAction(
  formData: FormData,
  locale: Locale = DEFAULT_LOCALE,
): Promise<InstallSkillResult & { installed?: Skill[]; name?: string }> {
  const address = formData.get("address");
  if (typeof address === "string" && address !== "") return op.skillInstallAddress(address, locale);
  try {
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    const paths = formData.getAll("path").map(String);
    if (files.length === 0 || files.length !== paths.length) {
      throw new Error(wrap(t("ko", "persona.skill.fileCountMismatchPrefix"), `${files.length} / ${paths.length}`, ""));
    }
    const uploads: SkillUpload[] =
      files.length === 1 && files[0].name.endsWith(".skill")
        ? await extractSkillArchive(Buffer.from(await files[0].arrayBuffer()), files[0].name, undefined, locale)
        : await Promise.all(
            files.map(async (file, i) => ({
              path: paths[i],
              bytes: Buffer.from(await file.arrayBuffer()),
              originalName: file.name,
            })),
          );
    const skill = await installSkill(uploads, undefined, locale);
    return { ok: true, installed: await listInstalledSkills(), name: skill.name };
  } catch (e) {
    return op.installFail(e);
  }
}

export async function savePersonaLimitAction(
  projectId: string,
  name: string,
  value: string,
): Promise<PersonaResult & { limit?: number | null }> {
  return done(projectId, op.personaLimitSet(projectId, name, value));
}
export async function savePersonaEngineAction(
  projectId: string,
  name: string,
  engine: string | null,
  model: string,
  effort = "",
  force = false,
): ReturnType<typeof op.personaEngineSet> {
  return done(projectId, op.personaEngineSet(projectId, name, engine, model, effort, force));
}
export async function deletePersonaMemoryAction(projectId: string, name: string, file: string): Promise<PersonaResult> {
  return done(projectId, op.personaMemoryDelete(projectId, name, file));
}
export async function deletePersonaAction(projectId: string, name: string): Promise<PersonaResult> {
  return done(projectId, op.personaDelete(projectId, name));
}
export async function hidePersonaAction(projectId: string, name: string): Promise<PersonaResult> {
  return done(projectId, op.personaHide(projectId, name));
}
export async function unhidePersonaAction(projectId: string, name: string): Promise<PersonaResult> {
  return done(projectId, op.personaUnhide(projectId, name));
}
export async function listTrashAction(projectId: string): Promise<TrashEntry[]> {
  return op.trashList(projectId);
}
export async function restoreTrashAction(projectId: string, kind: TrashKind, entry: string): Promise<PersonaResult> {
  return done(projectId, op.trashRestore(projectId, kind, entry));
}
export async function purgeTrashAction(projectId: string, kind: TrashKind, entry: string): Promise<PersonaResult> {
  return done(projectId, op.trashPurge(projectId, kind, entry));
}

export async function createSquadDesignTicketAction(
  projectId: string,
  name: string,
  description: string,
  assignee: string,
): Promise<SquadTicketResult> {
  const r = await op.squadDesignTicket(projectId, name, description, assignee);
  if (r.ok) revalidatePath(`/p/${projectId}/board`);
  return r;
}
export async function issueSquadReviewTicketAction(projectId: string, name: string): Promise<SquadTicketResult> {
  const r = await op.squadReviewTicket(projectId, name);
  if (r.ok) revalidatePath(`/p/${projectId}/board`);
  return r;
}
