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
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";
import {
  cronRegisterOp,
  fail,
  workerCreateOp,
  workerDeleteOp,
  workerRetryWorktreeOp,
  workerStopOp,
  type WorkerActionResult,
} from "@/lib/ops/worker";
import { getProject } from "@/lib/projects";
import { setOntology } from "@/lib/ops/settings";
import {
  applyCommonSource,
  applyDispatchGate,
  applyExecBit,
  applySelfHeal,
  copyContext,
  writeCommonContext,
  writeContext,
  type WorkerContext,
  type WorktreePrep,
} from "@/lib/workers";

/** 등록된 프로젝트의 root만 만진다. URL 조각으로 임의 경로를 열지 않는다. */
async function rootOf(projectId: string, locale: Locale = DEFAULT_LOCALE): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`${t(locale, "resolve.unknownProjectPrefix")} ${projectId}`);
  return project.root;
}

export async function createWorkerAction(
  projectId: string,
  name: string,
  /** 고른 엔진·모델 (§4-3). 기본값은 화면과 같은 `claude` + `모델 지정 안 함`이고, **값 검증은
   *  서버가 한다** — `createWorker`가 `engineArgv`로 모르는 엔진·셸 메타문자를 거부한다. */
  engine: string = "claude",
  model: string = "",
  effort: string = "",
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(projectId, locale);
    const r = await workerCreateOp(root, name, engine, model, effort);
    revalidatePath(`/p/${projectId}`, "layout"); // 목록 - 전환기의 워커 요약도 같이 바뀐다
    return r;
  } catch (e) {
    return fail(e);
  }
}

/** 워크트리 단계 실패가 A/S를 지난 뒤 남은 단계를 한 번 더 실행한다(§P470, `workers.create.worktree`).
 *  `prepareWorktree`가 이미 있는 트리 - 풀리는 심링크를 건너뛰는 멱등이라 끝난 단계는 다시 안
 *  돈다. 이름은 클라이언트 입력이라 **방금 만든 워커 파일이 있는 이름만** 받는다 - 임의 이름으로
 *  트리를 만들지 못하게 한다. */
export async function retryWorktreeAction(
  projectId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ ok: boolean; message?: string; worktree?: WorktreePrep }> {
  try {
    return await workerRetryWorktreeOp(await rootOf(projectId, locale), name, locale);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 중단 — crontab 줄만 뺀다. 진행중 세션도 락도 안 건드린다(제약 4). */
export async function stopWorkerAction(
  projectId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(projectId, locale);
    const r = await workerStopOp(root, name, locale);
    revalidatePath(`/p/${projectId}`, "layout");
    return r;
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(projectId, locale);
    const r = await cronRegisterOp(root, name, locale);
    revalidatePath(`/p/${projectId}`, "layout");
    return r;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWorkerAction(
  projectId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    const root = await rootOf(projectId, locale);
    const r = await workerDeleteOp(root, name);
    revalidatePath(`/p/${projectId}`, "layout");
    return r;
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<ContextResult> {
  try {
    const context = await writeContext(await rootOf(projectId, locale), name, items);
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<ContextResult> {
  try {
    const context = await writeCommonContext(await rootOf(projectId, locale), items);
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    await applyCommonSource(await rootOf(projectId, locale), name);
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    await applySelfHeal(await rootOf(projectId, locale), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `<루트>/dispatch-gate.sh`를 없으면 만들고 `source` 줄을 `. tick.sh` 위에 끼운다 (§4-14 §소급).
 *  이 줄이 없으면 받는 트리가 더러워도 그냥 디스패치되고 push에서만 막힌다. 이미 있으면 no-op이다. */
export async function applyDispatchGateAction(
  projectId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    await applyDispatchGate(await rootOf(projectId, locale), name);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `no-exec` 결함(§0-21 결정 3)의 복구 버튼. `applyExecBit`가 이 워커 파일 하나만 `chmod`한다 —
 *  다른 워커 파일의 모드는 이 액션이 손대지 않는다. */
/** 실패하면 §0-25의 A/S가 화면 쪽(`workers-ui.tsx`)에서 한 번 돈다(결정 7-8) — 이 액션은 자기
 *  조작 한 번만 하고 결과를 그대로 돌려준다. */
export async function applyExecBitAction(
  projectId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    await applyExecBit(await rootOf(projectId, locale), name);
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<ContextResult> {
  try {
    const context = await copyContext(await rootOf(projectId, locale), from, to);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, context };
  } catch (e) {
    return fail(e);
  }
}

// ── 온톨로지 자리 (§5-3 §온톨로지 자리를 워커가 재정의한다, 티켓 cd662a73) ────────

/** `TICKET_ONTOLOGY` 저장 — 워커 전부에 같은 값을 쓴다(Done when 2). `value`가 빈 문자열이면
 *  기본값 가정으로 되돌린다(그 줄을 지운다, Done when 5) — 별도의 초기화 액션을 안 만든다.
 *  검증(`validateOntologyInput`)이 던지면 **어느 파일도 안 건드리고** 사유를 그대로 넘긴다
 *  (§6 에러 3요소, `fail()`이 이미 하는 일). */
export async function saveOntologyAction(
  projectId: string,
  value: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    await setOntology(await rootOf(projectId, locale), value, locale);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 스테일 수거. 판정도 rename도 엔진이 한다 — 출력을 그대로 보여준다(제약 2). */
export async function reapWorkerAction(
  projectId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerActionResult> {
  try {
    const r = await runWorker(await rootOf(projectId, locale), name, ["reap"]);
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: r.ok, output: r.output || t(locale, "workers.reap.noStaleOutput") };
  } catch (e) {
    return fail(e);
  }
}
