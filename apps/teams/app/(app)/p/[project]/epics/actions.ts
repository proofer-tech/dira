"use server";

/** 에픽 화면(`/p/<project>/epics`)의 서버 액션 — 메모리 삭제 하나뿐이다.
 *
 *  **추가·편집 액션은 없다**(DESIGN.md §에픽 §결정 6 — 쓰는 쪽은 세션이다, §5-2와 같은 규칙).
 *  방어는 `deleteEpicMemory` 안에 있다: 클라이언트가 준 파일명은 그 에픽의 `memory/`를
 *  실제로 나열해 나온 목록 안에 있을 때만 지운다. */
import { revalidatePath } from "next/cache";
import { deleteEpicMemory } from "@/lib/epics";
import { getProject } from "@/lib/projects";

export type EpicResult = { ok: boolean; message?: string };

async function projectRoot(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return project.root;
}

export async function deleteEpicMemoryAction(
  projectId: string,
  epic: string,
  file: string,
): Promise<EpicResult> {
  try {
    await deleteEpicMemory(await projectRoot(projectId), epic, file);
    revalidatePath(`/p/${projectId}/epics/${encodeURIComponent(epic)}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
