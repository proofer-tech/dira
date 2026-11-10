"use server";

/** 온톨로지 화면의 서버 액션 — 저장 · 새 파일 · 삭제 · 이름변경.
 *
 *  `protocols/actions.ts`와 같은 분담: fs는 `lib/protocols.ts`가, 여기는 프로젝트 id → 기준
 *  디렉터리 해석과 Error 직렬화만 한다. 기준은 해석된 `TICKET_ONTOLOGY`(`resolveConfig`) 하나뿐이다. */
import { revalidatePath } from "next/cache";
import {
  fixOntologySchemaOp,
  publishOntologyImportOp,
  publishOntologyMigrationOp,
  submitSurveyOp,
  type FixTicketResult,
  type OntologyCtx,
  type PublishTicketResult,
} from "@/lib/ops/ontology";
import type { OntologySurveyAnswers } from "@/lib/ontology-seed";
import { t } from "@/lib/i18n";
import { openWithinApp, type OpenResult } from "@/lib/paths";
import { createFile, deleteFile, renameFile, saveFile } from "@/lib/protocols";
import { getProject, readLanguage, resolveConfig } from "@/lib/projects";

export type OntologyResult = {
  ok: boolean;
  message?: string;
  /** 생성·이름변경 후 선택할 상대경로. 화면이 `?file=`을 여기로 옮긴다 */
  rel?: string;
};

async function ctxOf(projectId: string): Promise<OntologyCtx> {
  const locale = await readLanguage();
  const project = await getProject(projectId);
  if (!project) throw new Error(`${t(locale, "ontology.action.unknownProjectPrefix")} ${projectId}`);
  return { project, config: await resolveConfig(project), locale };
}

async function baseOf(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`${t(await readLanguage(), "ontology.action.unknownProjectPrefix")} ${projectId}`);
  }
  return (await resolveConfig(project)).ontology;
}

function fail(e: unknown): OntologyResult {
  return { ok: false, message: (e as Error).message };
}

export async function saveOntologyAction(
  projectId: string,
  rel: string,
  text: string,
  expectedMtimeMs?: number,
): Promise<OntologyResult> {
  try {
    await saveFile(await baseOf(projectId), rel, text, expectedMtimeMs);
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

/** "OS 기본 앱으로 열기" 버튼(§10 §자리 다섯) — `protocols/actions.ts`의 짝(같은 `openWithinApp`). */
export async function openOntologyFileAction(projectId: string, rel: string): Promise<OpenResult> {
  try {
    return await openWithinApp(await baseOf(projectId), rel);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
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

/** 생성 — 설문 4문항 응답 → `SCHEMA.md` 시드(§5-3 §생성 — 설문 4문항). **폼은 여기서 바로
 *  끝난다.** 실제 쓰기(`writeSeed`)를 기다리지 않고 반환한다 — 지금은 결정적 빌더
 *  (`buildOntologySeed`)라 사실상 즉시 끝나지만, 응답 수집과 시드 생성을 구조적으로 가르는
 *  것 자체가 계약이다("폼이 LLM을 안 기다린다"). `home-session.ts`의 `startAsk`가 같은 결로
 *  "띄우고 바로 돌아온다"를 쓴다.
 *
 *  시드가 뜨면 첫 채움(§5-3 §첫 채움)을 잇는다 — `publishOntologyMigrationAction`이 마이그레이션
 *  티켓 한 장을 큐에 발행한다(§5-3: "제출이 마이그레이션 티켓을 자동 발행"). 시드 쓰기와 같은
 *  자리에서 `void`로 띄우므로 이 액션도 첫 채움을 안 기다린다. 발행 액션은 실패해도 던지지 않고
 *  `PublishTicketResult`로 물러난다(자기 안의 try/catch) — 시드는 이미 남은 뒤이므로 이 제출
 *  액션은 그 결과와 상관없이 끝나 있다. */
export async function submitOntologySurveyAction(
  projectId: string,
  answers: OntologySurveyAnswers,
): Promise<OntologyResult> {
  try {
    const c = await ctxOf(projectId);
    void submitSurveyOp(c, answers).catch((e: unknown) => {
      console.error("온톨로지 시드 생성 실패:", e);
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `_ontology/SCHEMA.md`(지도) + 타입·관계마다 정의 파일 + `templates/<타입>.md`까지 한 번에
 *  쓴다(§5-3 §생성·§형식이 vault 레퍼런스로 간다 §①②). 파일마다 `createFile`(O_EXCL) 다음
 *  `saveFile`이다 — 순서를 지키는 이유는 `createFile`이 중간 디렉터리를 만들어 주기 때문이다. */

export type { FixTicketResult, PublishTicketResult };

/** 위반 카드의 `문제해결`(§P230). 판정과 쓰기는 `lib/ops/ontology.ts`다. */
export async function fixOntologySchemaAction(projectId: string): Promise<FixTicketResult> {
  try {
    const r = await fixOntologySchemaOp(await ctxOf(projectId));
    revalidatePath(`/p/${projectId}/ontology`);
    return r;
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function publishOntologyMigrationAction(projectId: string): Promise<PublishTicketResult> {
  try {
    const r = await publishOntologyMigrationOp(await ctxOf(projectId));
    revalidatePath(`/p/${projectId}/ontology`);
    return r;
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function publishOntologyImportAction(projectId: string, folder: string): Promise<PublishTicketResult> {
  try {
    const r = await publishOntologyImportOp(await ctxOf(projectId), folder);
    revalidatePath(`/p/${projectId}/ontology`);
    return r;
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
