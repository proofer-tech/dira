"use server";

/** 워커 화면의 서버 액션 — 생성 · 삭제 · reap.
 *
 *  crontab은 건드리지 않는다(제약 4): 등록·해제는 `lib/workers.ts`가 만든 명령어를 화면이
 *  복사시키고 사람이 실행한다. 여기서 하는 파일 조작은 `workers/<name>.sh` 하나뿐이다.
 *
 *  검증과 문구는 `lib/`에 있다. 이 파일이 하는 일은 **테넌트 id → 등록된 root** 해석과
 *  Error를 직렬화 가능한 결과로 바꾸는 것뿐이다(클라이언트로 Error는 못 넘어간다). */
import { revalidatePath } from "next/cache";
import { runWorker } from "@/lib/engine";
import { getTenant } from "@/lib/tenants";
import { createWorker, cronRegisterCmd, cronUnregisterCmd, deleteWorker } from "@/lib/workers";

export type WorkerActionResult = {
  ok: boolean;
  message?: string;
  /** 생성 성공 시 — 화면이 이어서 crontab 등록 명령어를 보여준다 */
  created?: { name: string; path: string; template: string; registerCmd: string; unregisterCmd: string };
  /** reap 출력 원문 */
  output?: string;
};

/** 등록된 테넌트의 root만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function rootOf(tenantId: string): Promise<string> {
  const t = await getTenant(tenantId);
  if (!t) throw new Error(`등록되지 않은 테넌트입니다: ${tenantId}`);
  return t.root;
}

function fail(e: unknown): WorkerActionResult {
  return { ok: false, message: (e as Error).message };
}

export async function createWorkerAction(
  tenantId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(tenantId);
    const { path, template } = await createWorker(root, name.trim());
    revalidatePath(`/t/${tenantId}`, "layout"); // 목록·전환기의 워커 요약도 같이 바뀐다
    return {
      ok: true,
      created: {
        name: name.trim(),
        path,
        template,
        registerCmd: cronRegisterCmd({ path }),
        unregisterCmd: cronUnregisterCmd({ path }),
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWorkerAction(
  tenantId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    await deleteWorker(await rootOf(tenantId), name);
    revalidatePath(`/t/${tenantId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 스테일 수거. 판정도 rename도 엔진이 한다 — 출력을 그대로 보여준다(제약 2). */
export async function reapWorkerAction(
  tenantId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const r = await runWorker(await rootOf(tenantId), name, ["reap"]);
    revalidatePath(`/t/${tenantId}`, "layout");
    return { ok: r.ok, output: r.output || "수거할 스테일 티켓이 없습니다." };
  } catch (e) {
    return fail(e);
  }
}
