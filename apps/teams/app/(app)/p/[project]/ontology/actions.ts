"use server";

/** 온톨로지 화면의 서버 액션 — 저장 · 새 파일 · 삭제 · 이름변경.
 *
 *  `protocols/actions.ts`와 같은 분담: fs는 `lib/protocols.ts`가, 여기는 프로젝트 id → 기준
 *  디렉터리 해석과 Error 직렬화만 한다. 기준은 `ontologyDir()` 하나뿐이다(재정의를 안 연다). */
import { revalidatePath } from "next/cache";
import { createFile, deleteFile, renameFile, saveFile } from "@/lib/protocols";
import { getProject, ontologyDir } from "@/lib/projects";

export type OntologyResult = {
  ok: boolean;
  message?: string;
  /** 생성·이름변경 후 선택할 상대경로. 화면이 `?file=`을 여기로 옮긴다 */
  rel?: string;
};

async function baseOf(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return ontologyDir(project);
}

function fail(e: unknown): OntologyResult {
  return { ok: false, message: (e as Error).message };
}

export async function saveOntologyAction(
  projectId: string,
  rel: string,
  text: string,
): Promise<OntologyResult> {
  try {
    await saveFile(await baseOf(projectId), rel, text);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, rel };
  } catch (e) {
    return fail(e);
  }
}

export async function createOntologyAction(projectId: string, rel: string): Promise<OntologyResult> {
  try {
    const created = await createFile(await baseOf(projectId), rel);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, rel: created };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteOntologyAction(projectId: string, rel: string): Promise<OntologyResult> {
  try {
    await deleteFile(await baseOf(projectId), rel);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameOntologyAction(
  projectId: string,
  from: string,
  to: string,
): Promise<OntologyResult> {
  try {
    const moved = await renameFile(await baseOf(projectId), from, to);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, rel: moved };
  } catch (e) {
    return fail(e);
  }
}
