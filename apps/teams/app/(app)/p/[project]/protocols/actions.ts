"use server";

/** 프로토콜 화면의 서버 액션 — 저장 · 새 파일 · 삭제 · 이름변경.
 *
 *  검증도 파일 조작도 `lib/protocols.ts`가 한다. 이 파일이 하는 일은 **프로젝트 id → 해석된
 *  `TICKET_PROTOCOLS`** 해석과 Error를 직렬화 가능한 결과로 바꾸는 것뿐이다(`workers/actions.ts`와
 *  같은 분담). 기준 디렉터리를 여기서 조립하지 않는다 — `resolveConfig`가 유일한 출처다. */
import { revalidatePath } from "next/cache";
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";
import { openWithinApp, type OpenResult } from "@/lib/paths";
import { createFile, deleteFile, renameFile, saveFile } from "@/lib/protocols";
import { getProject, resolveConfig } from "@/lib/projects";

export type ProtocolResult = {
  ok: boolean;
  message?: string;
  /** 생성·이름변경 후 선택할 상대경로. 화면이 `?file=`을 여기로 옮긴다 */
  rel?: string;
};

/** 등록된 프로젝트의 해석된 프로토콜 디렉터리만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function baseOf(projectId: string, locale: Locale): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`${t(locale, "protocols.action.unknownProjectPrefix")} ${projectId}`);
  return (await resolveConfig(project)).protocols;
}

function fail(e: unknown): ProtocolResult {
  return { ok: false, message: (e as Error).message };
}

export async function saveProtocolAction(
  projectId: string,
  rel: string,
  text: string,
  expectedMtimeMs?: number,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ProtocolResult> {
  try {
    await saveFile(await baseOf(projectId, locale), rel, text, expectedMtimeMs, locale);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true, rel };
  } catch (e) {
    return fail(e);
  }
}

export async function createProtocolAction(
  projectId: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ProtocolResult> {
  try {
    const created = await createFile(await baseOf(projectId, locale), rel, locale);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true, rel: created };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteProtocolAction(
  projectId: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ProtocolResult> {
  try {
    await deleteFile(await baseOf(projectId, locale), rel, locale);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** "OS 기본 앱으로 열기" 버튼(§10 §자리 다섯) — `resolveWithin`을 지난 값만 `open`에 준다
 *  (`openWithinApp`이 그 순서를 한 함수로 묶는다). 저장·삭제와 같은 기준 디렉터리를 쓴다. */
export async function openProtocolFileAction(
  projectId: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<OpenResult> {
  try {
    return await openWithinApp(await baseOf(projectId, locale), rel, locale);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function renameProtocolAction(
  projectId: string,
  from: string,
  to: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ProtocolResult> {
  try {
    const moved = await renameFile(await baseOf(projectId, locale), from, to, locale);
    revalidatePath(`/p/${projectId}/protocols`);
    return { ok: true, rel: moved };
  } catch (e) {
    return fail(e);
  }
}
