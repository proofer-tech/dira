"use server";

/** 페르소나 마켓 배포 — 서버 액션(DESIGN.md §페르소나 마켓 §배포, 티켓 `44a57214`).
 *
 *  버튼과 다이얼로그는 `1c06035e`(P426-6)가 붙인다 — 이 파일은 그 다이얼로그가 부를 액션
 *  셋(페르소나 배포 · 스쿼드의 없는 멤버 판정 · 스쿼드 배포)까지다.
 *
 *  쓰기는 전부 `lib/market.ts`가 진다(버전 디렉터리 `mkdir(recursive:false)` · `meta.json`
 *  원자적 교체). 이 파일이 하는 일은 원본 프로젝트에서 파일을 읽어 그 함수에 넘기고,
 *  스쿼드는 없는 멤버를 먼저 배포하는 순서를 지키는 것뿐이다.
 *
 *  `[project]/actions.ts`와 헬퍼를 못 나눠 쓰는 이유는 `"use server"` 파일의 export가 전부
 *  async 함수여야 해서다(`board/actions.ts`의 그 대가와 같다) — `personasDir` 다섯 줄이
 *  양쪽에 있다. */
import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import {
  deployPersona,
  deploySquad,
  listMarketItems,
  missingMarketMembers,
  type MarketMeta,
} from "@/lib/market";
import {
  getProject,
  listSquads,
  personaFilePath,
  resolveConfig,
  squadMembersFileText,
  squadsDir,
} from "@/lib/projects";

export type DeployResult = { ok: boolean; message?: string; meta?: MarketMeta };
export type MissingMembersResult = { ok: boolean; missing?: string[]; message?: string };

async function requireProject(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`알 수 없는 프로젝트: ${projectId}`);
  return project;
}

async function personasDir(projectId: string): Promise<string> {
  return (await resolveConfig(await requireProject(projectId))).personas;
}

async function readPersonaFiles(
  dir: string,
  name: string,
): Promise<{ profile: string | null; skills: string | null }> {
  const [profile, skills] = await Promise.all([
    personaFilePath(dir, name, "PROFILE.md").then((f) => readFile(f, "utf8")).catch(() => null),
    personaFilePath(dir, name, "skills.md").then((f) => readFile(f, "utf8")).catch(() => null),
  ]);
  return { profile, skills };
}

/** 같은 소유 프로젝트의 마켓 페르소나 이름 목록 — `missingMarketMembers`의 둘째 인자. */
async function marketPersonaNames(owner: string): Promise<string[]> {
  const items = await listMarketItems("persona");
  return items.filter((it) => it.owner === owner).map((it) => it.name);
}

function fail(e: unknown): DeployResult {
  return { ok: false, message: (e as Error).message };
}

export async function deployPersonaAction(
  projectId: string,
  name: string,
  note: string,
  tags: string[],
): Promise<DeployResult> {
  try {
    const project = await requireProject(projectId);
    const files = await readPersonaFiles(await personasDir(projectId), name);
    const meta = await deployPersona(project.id, project.name, name, files, note, tags);
    revalidatePath(`/p/${projectId}/personas`);
    revalidatePath("/market");
    return { ok: true, meta };
  } catch (e) {
    return fail(e);
  }
}

/** 다이얼로그가 배포 확인 전에 부른다 — 없는 멤버가 있으면 같이 배포할지 묻는다(§배포
 *  §스쿼드 배포 1-2). */
export async function missingSquadMembersAction(
  projectId: string,
  squadName: string,
): Promise<MissingMembersResult> {
  try {
    const project = await requireProject(projectId);
    const squad = (await listSquads(squadsDir(project))).find((s) => s.name === squadName);
    if (!squad) throw new Error(`없는 스쿼드: ${squadName}`);
    const missing = missingMarketMembers(
      squad.members.map((m) => m.name),
      await marketPersonaNames(project.id),
    );
    return { ok: true, missing };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 없는 멤버를 하나씩 먼저 배포하고 그 다음 스쿼드를 배포한다(§배포 §스쿼드 배포 3).
 *  멤버가 받는 노트는 스쿼드에 적은 노트와 같다. 도중 하나가 실패하면(순차 `await`이라
 *  뒤 멤버·스쿼드는 시도되지 않는다) 거기서 멈추고 이미 배포된 멤버는 되돌리지 않는다
 *  (§배포 §스쿼드 배포 5). */
export async function deploySquadAction(
  projectId: string,
  squadName: string,
  note: string,
  tags: string[],
): Promise<DeployResult> {
  try {
    const project = await requireProject(projectId);
    const pDir = await personasDir(projectId);
    const squad = (await listSquads(squadsDir(project))).find((s) => s.name === squadName);
    if (!squad) throw new Error(`없는 스쿼드: ${squadName}`);
    const missing = missingMarketMembers(
      squad.members.map((m) => m.name),
      await marketPersonaNames(project.id),
    );
    for (const memberName of missing) {
      const files = await readPersonaFiles(pDir, memberName);
      await deployPersona(project.id, project.name, memberName, files, note, tags);
    }
    const meta = await deploySquad(
      project.id,
      project.name,
      squadName,
      squadMembersFileText(squad.members),
      note,
      tags,
    );
    revalidatePath(`/p/${projectId}/personas`);
    revalidatePath("/market");
    return { ok: true, meta };
  } catch (e) {
    return fail(e);
  }
}
