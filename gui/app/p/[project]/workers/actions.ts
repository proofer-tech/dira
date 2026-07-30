"use server";

/** 워커 화면의 서버 액션 — 생성 · 삭제 · reap.
 *
 *  crontab은 건드리지 않는다(제약 4): 등록·해제는 `lib/workers.ts`가 만든 명령어를 화면이
 *  복사시키고 사람이 실행한다. 여기서 하는 파일 조작은 `workers/<name>.sh` 하나뿐이다.
 *
 *  검증과 문구는 `lib/`에 있다. 이 파일이 하는 일은 **프로젝트 id → 등록된 root** 해석과
 *  Error를 직렬화 가능한 결과로 바꾸는 것뿐이다(클라이언트로 Error는 못 넘어간다). */
import { revalidatePath } from "next/cache";
import { runWorker } from "@/lib/engine";
import { getProject } from "@/lib/projects";
import {
  copyContext,
  createWorker,
  cronRegisterCmd,
  cronUnregisterCmd,
  deleteWorker,
  writeContext,
  type WorkerContext,
} from "@/lib/workers";

export type WorkerActionResult = {
  ok: boolean;
  message?: string;
  /** 생성 성공 시 — 화면이 이어서 crontab 등록 명령어를 보여준다 */
  created?: { name: string; path: string; template: string; registerCmd: string; unregisterCmd: string };
  /** reap 출력 원문 */
  output?: string;
};

/** 등록된 프로젝트의 root만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function rootOf(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return project.root;
}

function fail(e: unknown): WorkerActionResult {
  return { ok: false, message: (e as Error).message };
}

export async function createWorkerAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(projectId);
    const { path, template } = await createWorker(root, name.trim());
    revalidatePath(`/p/${projectId}`, "layout"); // 목록·전환기의 워커 요약도 같이 바뀐다
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
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    await deleteWorker(await rootOf(projectId), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── 컨텍스트 경로 (TICKET_CONTEXT 블록 전체 치환) ───────────────────────────

/** 성공하면 서버가 다시 읽은 항목(존재 여부 포함)을 넘긴다 — 화면이 저장 직후 체크 표시를
 *  갱신하고, 방금 넣은 경로가 정말 있는지 그 자리에서 보인다. */
export type ContextResult = { ok: boolean; message?: string; context?: WorkerContext };

export async function saveContextAction(
  projectId: string,
  name: string,
  items: { path: string; desc: string }[],
): Promise<ContextResult> {
  try {
    const context = await writeContext(await rootOf(projectId), name, items);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, context };
  } catch (e) {
    return fail(e);
  }
}

/** 워커 간 복사. 받는 워커의 블록을 **통째로** 바꾼다 — 화면이 그 사실을 먼저 알린다. */
export async function copyContextAction(
  projectId: string,
  from: string,
  to: string,
): Promise<ContextResult> {
  try {
    const context = await copyContext(await rootOf(projectId), from, to);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, context };
  } catch (e) {
    return fail(e);
  }
}

/** 스테일 수거. 판정도 rename도 엔진이 한다 — 출력을 그대로 보여준다(제약 2). */
export async function reapWorkerAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const r = await runWorker(await rootOf(projectId), name, ["reap"]);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: r.ok, output: r.output || "수거할 스테일 티켓이 없습니다." };
  } catch (e) {
    return fail(e);
  }
}
