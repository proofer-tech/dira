"use server";

/** 프로토콜 화면의 서버 액션 — 저장 · 새 파일 · 삭제 · 이름변경.
 *
 *  검증도 파일 조작도 `lib/protocols.ts`가 한다. 이 파일이 하는 일은 **프로젝트 id → 해석된
 *  `TICKET_PROTOCOLS`** 해석과 Error를 직렬화 가능한 결과로 바꾸는 것뿐이다(`workers/actions.ts`와
 *  같은 분담). 기준 디렉터리를 여기서 조립하지 않는다 — `resolveConfig`가 유일한 출처다. */
import { revalidatePath } from "next/cache";
import { createFile, deleteFile, renameFile, saveFile } from "@/lib/protocols";
import { getProject, resolveConfig } from "@/lib/projects";

export type ProtocolResult = {
  ok: boolean;
  message?: string;
  /** 생성·이름변경 후 선택할 상대경로. 화면이 `?file=`을 여기로 옮긴다 */
  rel?: string;
};

/** 등록된 프로젝트의 해석된 프로토콜 디렉터리만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function baseOf(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return (await resolveConfig(project)).protocols;
}

function fail(e: unknown): ProtocolResult {
  return { ok: false, message: (e as Error).message };
}

export async function saveProtocolAction(
  projectId: string,
  rel: string,
  text: string,
): Promise<ProtocolResult> {
  try {
    await saveFile(await baseOf(projectId), rel, text);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true, rel };
  } catch (e) {
    return fail(e);
  }
}

export async function createProtocolAction(projectId: string, rel: string): Promise<ProtocolResult> {
  try {
    const created = await createFile(await baseOf(projectId), rel);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true, rel: created };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteProtocolAction(projectId: string, rel: string): Promise<ProtocolResult> {
  try {
    await deleteFile(await baseOf(projectId), rel);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameProtocolAction(
  projectId: string,
  from: string,
  to: string,
): Promise<ProtocolResult> {
  try {
    const moved = await renameFile(await baseOf(projectId), from, to);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true, rel: moved };
  } catch (e) {
    return fail(e);
  }
}
