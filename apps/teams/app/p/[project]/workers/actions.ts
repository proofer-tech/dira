"use server";

/** 워커 화면의 서버 액션 — 생성 · 중단 · 재등록 · 삭제 · reap.
 *
 *  crontab은 **그 프로젝트의 워커 줄만** 쓴다(제약 4). 계산도 쓰기도 `lib/workers.ts`에 있고,
 *  등록이 실패하면 그때만 종전의 복사 명령어로 되돌아간다.
 *
 *  검증과 문구는 `lib/`에 있다. 이 파일이 하는 일은 **프로젝트 id → 등록된 root** 해석과
 *  Error를 직렬화 가능한 결과로 바꾸는 것뿐이다(클라이언트로 Error는 못 넘어간다). */
import { revalidatePath } from "next/cache";
import { runWorker } from "@/lib/engine";
import { getProject } from "@/lib/projects";
import {
  applyCommonSource,
  applySelfHeal,
  copyContext,
  createWorker,
  cronRegisterCmd,
  cronUnregisterCmd,
  deleteWorker,
  prepareWorktree,
  registerCron,
  startWorker,
  stopWorker,
  writeCommonContext,
  writeContext,
  type WorkerContext,
  type WorktreePrep,
} from "@/lib/workers";

export type WorkerActionResult = {
  ok: boolean;
  /** 실패 사유. 중단은 성공했을 때도 무엇을 했는지(또는 no-op이었는지) 여기로 말한다 */
  message?: string;
  /** 삭제가 **crontab 해제 단계에서** 멈췄다 = 파일은 그대로다. 화면이 해제 명령어를
   *  이 경우에만 보여준다(파일 삭제 실패에 같은 명령을 권하면 거짓 안내다) */
  cronFailed?: boolean;
  /** 생성 성공 시. `cron: false`면 파일은 있고 등록만 실패한 것이다 — 화면이 사유와
   *  종전의 등록 명령어를 보여주고 사람이 셸에서 마무리한다 */
  created?: {
    name: string;
    path: string;
    template: string;
    cron: boolean;
    cronError?: string;
    registerCmd: string;
    unregisterCmd: string;
    /** 서버가 실제로 실행한 워크트리 3단계의 결과 (§4 생성 4항). 성공이면 화면에
     *  `CopyCommand`가 없다 — 남은 명령은 실패했을 때만 생긴다 */
    worktree: WorktreePrep;
  };
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
  const err = e as Error & { cronFailed?: boolean };
  return { ok: false, message: err.message, cronFailed: err.cronFailed };
}

export async function createWorkerAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(projectId);
    const worker = name.trim();
    const { path, template } = await createWorker(root, worker);
    // **등록이 실패해도 파일 생성을 되돌리지 않는다** — 만든 것을 지우면 사람이 이름을 다시
    // 정해야 한다. 실패는 `cronError`로 넘기고 화면이 등록 명령어를 그 자리에 보여준다.
    const cronError = await registerCron(path).then(
      () => undefined,
      (e: Error) => e.message,
    );
    // 순서는 **파일 → crontab → 트리**다(§4 생성 4항). 트리가 실패해도 파일도 crontab도
    // 되돌리지 않는다 — 둘 다 트리와 무관하게 유효하고, 등록을 사람 손에 되돌리면
    // `44f876aa`가 없앤 speed bump가 다른 이름으로 돌아온다.
    const worktree = await prepareWorktree(root, worker);
    revalidatePath(`/p/${projectId}`, "layout"); // 목록·전환기의 워커 요약도 같이 바뀐다
    return {
      ok: true,
      created: {
        name: worker,
        path,
        template,
        cron: !cronError,
        cronError,
        registerCmd: cronRegisterCmd({ path }),
        unregisterCmd: cronUnregisterCmd({ path }),
        worktree,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

/** 중단 — crontab 줄만 뺀다. 진행중 세션도 락도 안 건드린다(제약 4). */
export async function stopWorkerAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const removed = await stopWorker(await rootOf(projectId), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return {
      ok: true,
      message: removed
        ? "crontab에서 뺐습니다 — 이 워커는 더 이상 새 티켓을 물지 않습니다."
        : "이미 crontab에 없었습니다 — 바꾼 것이 없습니다.",
    };
  } catch (e) {
    return fail(e);
  }
}

/** 재등록 — crontab 줄만 다시 넣는다. `중단`의 역방향이고 등록은 생성이 쓰는 `registerCron`
 *  그대로다(§4 재등록: 새 계산도 새 명령 문자열도 만들지 않는다). 성공 판정도 생성과 같다 —
 *  종료코드가 아니라 다시 읽은 crontab이고, 그 확인은 `registerCron` 안에 이미 있다. */
export async function registerWorkerAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    const added = await startWorker(await rootOf(projectId), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return {
      ok: true,
      message: added
        ? "crontab에 넣었습니다 — 1분 뒤부터 티켓을 물어갑니다."
        : "이미 crontab에 있었습니다 — 바꾼 것이 없습니다.",
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

/** 공통 컨텍스트(`<루트>/context.sh`) 항목 치환 (§4-1). 워커 파일은 안 건드린다 —
 *  워커는 이 파일을 `.` 할 뿐이라 여기 한 번 쓰면 전원에게 반영된다. */
export async function saveCommonContextAction(
  projectId: string,
  items: { path: string; desc: string }[],
): Promise<ContextResult> {
  try {
    const context = await writeCommonContext(await rootOf(projectId), items);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, context };
  } catch (e) {
    return fail(e);
  }
}

/** `source` 줄이 없는 워커에 그 한 줄을 넣는다 (§4-1). 이 줄이 없으면 그 워커는 공통을 못 받는다.
 *  이미 있으면 no-op이고, 넣을 자리를 짚을 수 없으면 쓰지 않고 사유를 넘긴다. */
export async function applyCommonSourceAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    await applyCommonSource(await rootOf(projectId), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `<루트>/self-heal.sh`를 없으면 만들고 `source` 줄을 `. tick.sh` 위에 끼운다 (§4-4 §소급).
 *  이 줄이 없으면 dira를 지워도 그 워커의 cron 줄이 crontab에 남는다. 이미 있으면 no-op이다. */
export async function applySelfHealAction(
  projectId: string,
  name: string,
): Promise<WorkerActionResult> {
  try {
    await applySelfHeal(await rootOf(projectId), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
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
