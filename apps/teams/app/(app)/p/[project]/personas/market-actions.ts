"use server";

/** 페르소나 마켓 배포 서버 액션 - 껍데기다(P559-6). 본체는 `lib/ops/market.ts`에 있다. */
import { revalidatePath } from "next/cache";
import type { Bump } from "@/lib/market";
import * as op from "@/lib/ops/market";

export type DeployResult = op.DeployResult;
export type MissingMembersResult = op.MissingMembersResult;

function refresh(projectId: string, r: op.DeployResult): op.DeployResult {
  if (r.ok) {
    revalidatePath(`/p/${projectId}/personas`);
    revalidatePath("/market");
  }
  return r;
}

export async function deployPersonaAction(
  projectId: string,
  name: string,
  note: string,
  tags: string[],
  bump: Bump = "patch",
): Promise<DeployResult> {
  return refresh(projectId, await op.marketDeployPersona(projectId, name, note, tags, bump));
}

export async function missingSquadMembersAction(projectId: string, squadName: string): Promise<MissingMembersResult> {
  return op.marketMissingMembers(projectId, squadName);
}

export async function deploySquadAction(
  projectId: string,
  squadName: string,
  note: string,
  tags: string[],
  bump: Bump = "patch",
): Promise<DeployResult> {
  return refresh(projectId, await op.marketDeploySquad(projectId, squadName, note, tags, bump));
}
