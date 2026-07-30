"use server";

/** 페르소나 화면의 서버 액션 — 저장 · 생성 · 삭제.
 *
 *  기준 디렉터리는 **`resolveConfig(tenant).personas`**다. `<루트>/personas`를 조립하지 않는다 —
 *  워커가 `TICKET_PERSONAS`를 재정의한 큐에서는 루트 밖을 편집해야 하고, 경로 방어의 기준도
 *  그 값이다(DESIGN.md §경로 방어).
 *
 *  검증(이름 규칙 · 기준 디렉터리 접두)은 `lib/tenants.ts`에 있다. 이 파일이 하는 일은
 *  테넌트 id → 해석된 디렉터리와, Error를 직렬화 가능한 결과로 바꾸는 것뿐이다. */
import { revalidatePath } from "next/cache";
import {
  createPersona,
  deletePersona,
  getTenant,
  resolveConfig,
  savePersona,
} from "@/lib/tenants";

export type PersonaResult = { ok: boolean; message?: string };

/** 등록된 테넌트의 해석된 페르소나 디렉터리만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function personasDir(tenantId: string): Promise<string> {
  const t = await getTenant(tenantId);
  if (!t) throw new Error(`등록되지 않은 테넌트입니다: ${tenantId}`);
  return (await resolveConfig(t)).personas;
}

function fail(e: unknown): PersonaResult {
  return { ok: false, message: (e as Error).message };
}

export async function savePersonaAction(
  tenantId: string,
  name: string,
  body: string,
): Promise<PersonaResult> {
  try {
    await savePersona(await personasDir(tenantId), name, body);
    revalidatePath(`/t/${tenantId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createPersonaAction(tenantId: string, name: string): Promise<PersonaResult> {
  try {
    await createPersona(await personasDir(tenantId), name.trim());
    revalidatePath(`/t/${tenantId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePersonaAction(tenantId: string, name: string): Promise<PersonaResult> {
  try {
    await deletePersona(await personasDir(tenantId), name);
    revalidatePath(`/t/${tenantId}/personas`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
