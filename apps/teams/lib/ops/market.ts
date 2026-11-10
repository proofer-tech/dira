/** 마켓 op 본체(P559-6, 결정 1). `app/(app)/market/actions.ts`와 `.../personas/market-actions.ts`의 서버 액션이 여기를
 *  부르고 `revalidatePath`만 더한다. `next/*` import 금지. */
import { readFile } from "node:fs/promises";
import { hasTeam, installTeam, packageNames } from "../apm.ts";
import { DEFAULT_LOCALE, t, wrap, type Locale } from "../i18n.ts";
import {
  appendInstall,
  deployPersona,
  deploySquad,
  firstLine,
  getMarketItem,
  importPersona,
  importSquad,
  importToTeam,
  listMarketItems,
  missingMarketMembers,
  previewTeamUpdate,
  projectsThatImported,
  teamImports,
  type Bump,
  type FileDiff,
  type ImportReason,
  type MarketItem,
  type MarketItemDetail,
  type MarketKind,
  type MarketMeta,
} from "../market.ts";
import {
  getProject,
  listSquads,
  personaFilePath,
  readProjects,
  resolveConfig,
  setMarketInstall,
  squadMembersFileText,
  squadsDir,
} from "../projects.ts";

export type ImportResult =
  | { ok: true; as: string; missingInMarket?: string[]; coImported?: string[] }
  | { ok: false; conflict?: true; message: string };
export type MarketCardItem = MarketItem & { profileFirstLine: string; installedIn: string[] };
export type DeployResult = { ok: boolean; message?: string; meta?: MarketMeta };
export type MissingMembersResult = { ok: boolean; missing?: string[]; message?: string };

export async function marketPaneData(
  locale: Locale,
): Promise<{ items: MarketCardItem[]; projects: { id: string; name: string; team: boolean }[] }> {
  const [items, rawProjects] = await Promise.all([listMarketItems(), readProjects(locale)]);
  const projects = await Promise.all(
    rawProjects.map(async (p) => (hasTeam(p.root) ? { ...p, market: await teamImports(p.root) } : p)),
  );
  const rows: MarketCardItem[] = await Promise.all(
    items.map(async (item) => {
      const detail = item.kind === "persona" ? await getMarketItem("persona", item.owner, item.name) : null;
      return {
        ...item,
        profileFirstLine: detail?.profile ? firstLine(detail.profile) : "",
        installedIn: projectsThatImported(item.kind, item.owner, item.name, projects),
      };
    }),
  );
  return { items: rows, projects: projects.map((p) => ({ id: p.id, name: p.name, team: hasTeam(p.root) })) };
}

function reasonMessage(reason: ImportReason, asName: string, locale: Locale): string {
  if (reason === "conflict") return t(locale, "market.import.conflict");
  if (reason === "invalidName") return wrap(t(locale, "projects.notAMarketEntryNamePrefix"), asName, "");
  return t(locale, "market.import.notFound");
}

async function importTeam(
  kind: MarketKind,
  owner: string,
  name: string,
  projectId: string,
  to: string,
  overwrite: boolean,
  locale: Locale,
  version?: string,
): Promise<ImportResult> {
  const project = (await getProject(projectId))!;
  const existing = kind === "squad" ? await packageNames(project.root, "persona") : [];
  const r = await importToTeam(kind, owner, name, project.root, to, overwrite, version, existing);
  if (!r.ok) {
    if (r.reason === "conflict") return { ok: false, conflict: true, message: t(locale, "market.import.conflict") };
    return { ok: false, message: reasonMessage(r.reason, to, locale) };
  }
  await installTeam(project.root);
  await appendInstall({ at: new Date().toISOString(), kind, owner, name, v: r.version, project: projectId, as: to });
  return { ok: true, as: to, missingInMarket: r.missingInMarket, coImported: r.coImported };
}

export async function marketImport(
  kind: MarketKind,
  owner: string,
  name: string,
  projectId: string,
  asName: string,
  overwrite = false,
  locale: Locale = DEFAULT_LOCALE,
  version?: string,
): Promise<ImportResult> {
  try {
    const project = await getProject(projectId);
    if (!project) return { ok: false, message: `${t(locale, "projects.unknownProjectIdPrefix")} ${projectId}` };
    const to = asName.trim() || name;
    if (hasTeam(project.root)) return await importTeam(kind, owner, name, projectId, to, overwrite, locale, version);
    const config = await resolveConfig(project);
    const r =
      kind === "persona"
        ? await importPersona(owner, name, config.personas, to, overwrite)
        : await importSquad(owner, name, squadsDir(project), config.personas, to, overwrite);
    if (!r.ok) {
      if (r.reason === "conflict") return { ok: false, conflict: true, message: t(locale, "market.import.conflict") };
      return { ok: false, message: reasonMessage(r.reason, to, locale) };
    }
    const item = await getMarketItem(kind, owner, name);
    const v = item!.latest; // r.ok가 참이면 방금 이 항목을 읽어 썼으므로 여기서 없을 수 없다
    await appendInstall({ at: new Date().toISOString(), kind, owner, name, v, project: projectId, as: to });
    await setMarketInstall(projectId, kind === "persona" ? "personas" : "squads", to, { owner, name, v }, locale);
    return kind === "persona"
      ? { ok: true, as: to }
      : { ok: true, as: to, missingInMarket: (r as { missingInMarket?: string[] }).missingInMarket, coImported: (r as { coImported?: string[] }).coImported };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function marketUpdatePreview(
  kind: MarketKind,
  owner: string,
  name: string,
  projectId: string,
): Promise<{ version: string; files: FileDiff[] } | null> {
  const project = await getProject(projectId);
  if (!project || !hasTeam(project.root)) return null;
  return previewTeamUpdate(kind, owner, name, project.root);
}

export async function marketItemDetail(kind: MarketKind, owner: string, name: string): Promise<MarketItemDetail | null> {
  return getMarketItem(kind, owner, name);
}

// --- 배포 ---

async function requireProject(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`알 수 없는 프로젝트: ${projectId}`);
  return project;
}

async function readPersonaFiles(dir: string, name: string): Promise<{ profile: string | null; skills: string | null }> {
  const [profile, skills] = await Promise.all([
    personaFilePath(dir, name, "PROFILE.md").then((f) => readFile(f, "utf8")).catch(() => null),
    personaFilePath(dir, name, "skills.md").then((f) => readFile(f, "utf8")).catch(() => null),
  ]);
  return { profile, skills };
}

async function marketPersonaNames(owner: string): Promise<string[]> {
  const items = await listMarketItems("persona");
  return items.filter((it) => it.owner === owner).map((it) => it.name);
}

const deployFail = (e: unknown): DeployResult => ({ ok: false, message: (e as Error).message });

export async function marketDeployPersona(
  projectId: string,
  name: string,
  note: string,
  tags: string[],
  bump: Bump = "patch",
): Promise<DeployResult> {
  try {
    const project = await requireProject(projectId);
    const files = await readPersonaFiles((await resolveConfig(project)).personas, name);
    return { ok: true, meta: await deployPersona(project.id, project.name, name, files, note, tags, bump) };
  } catch (e) {
    return deployFail(e);
  }
}

export async function marketMissingMembers(projectId: string, squadName: string): Promise<MissingMembersResult> {
  try {
    const project = await requireProject(projectId);
    const squad = (await listSquads(squadsDir(project))).find((s) => s.name === squadName);
    if (!squad) throw new Error(`없는 스쿼드: ${squadName}`);
    const missing = missingMarketMembers(squad.members.map((m) => m.name), await marketPersonaNames(project.id));
    return { ok: true, missing };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function marketDeploySquad(
  projectId: string,
  squadName: string,
  note: string,
  tags: string[],
  bump: Bump = "patch",
): Promise<DeployResult> {
  try {
    const project = await requireProject(projectId);
    const pDir = (await resolveConfig(project)).personas;
    const squad = (await listSquads(squadsDir(project))).find((s) => s.name === squadName);
    if (!squad) throw new Error(`없는 스쿼드: ${squadName}`);
    const missing = missingMarketMembers(squad.members.map((m) => m.name), await marketPersonaNames(project.id));
    for (const memberName of missing) {
      const files = await readPersonaFiles(pDir, memberName);
      await deployPersona(project.id, project.name, memberName, files, note, tags, bump);
    }
    const meta = await deploySquad(project.id, project.name, squadName, squadMembersFileText(squad.members), note, tags, bump);
    return { ok: true, meta };
  } catch (e) {
    return deployFail(e);
  }
}
