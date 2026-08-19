"use server";

/** 에픽 화면(`/p/<project>/epics`)의 서버 액션 — 메모리 삭제와 README 저장.
 *
 *  **`memory/`는 세션 몫이다**(DESIGN.md §에픽 §결정 6 — §5-2와 같은 규칙) — 삭제만 있고
 *  추가·편집은 없다. `README.md`는 갈린다 — 제목·내용은 사람이 화면에서 고치는 자리가
 *  §에픽 결정 19-2가 연 자리다. 판정·쓰기는 전부 `lib/epics.ts`의 `saveEpicReadme`가 한다
 *  (`createEpic`이 `lib/epics.ts`에 위임하는 것과 같은 짝) — 여기가 하는 일은 프로젝트 id를
 *  실물로 바꾸고 성공 시 이 화면을 다시 그리는 것뿐이다. */
import { revalidatePath } from "next/cache";
import { deleteEpicMemory, saveEpicReadme, type CreateEpicResult } from "@/lib/epics";
import { getProject } from "@/lib/projects";

export type EpicResult = { ok: boolean; message?: string };

async function projectRoot(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return project.root;
}

export async function saveEpicReadmeAction(
  projectId: string,
  epic: string,
  title: string,
  body: string,
): Promise<CreateEpicResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "other", error: `등록되지 않은 프로젝트입니다: ${projectId}` };
  const r = await saveEpicReadme(project.root, epic, title, body);
  if (r.ok) revalidatePath(`/p/${projectId}/epics/${encodeURIComponent(epic)}`);
  return r;
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
