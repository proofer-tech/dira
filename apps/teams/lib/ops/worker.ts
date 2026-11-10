/** 워커 - cron - 고치기 버튼 op 본체(P559-5). `app/**`의 서버 액션이 여기를 부르고 `revalidatePath`만 더한다.
 *  `next/*` import 금지 - `cli.ts`가 화면 서버 없이 돌린다. 결과 모양은 종전 액션의 반환값 그대로다. */
import { randomUUID } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { track } from "../analytics.ts";
import { discardGateDirty } from "../engine.ts";
import { DEFAULT_LOCALE, t, type Locale } from "../i18n.ts";
import { kickIdleWorker } from "../kick.ts";
import { isName } from "../paths.ts";
import { resolveConfig, type Project } from "../projects.ts";
import {
  TICKET_FILES_FIX_MARKER,
  listTickets,
  openFixTicket,
  stemOf,
  ticketAnomalies,
  ticketFilesFixBody,
} from "../queue.ts";
import { selfHeal, type SelfHealOutcome } from "../self-heal.ts";
import { resolveCheckout } from "../source-control.ts";
import {
  ENGINES,
  applyCommonSource,
  applyDispatchGate,
  applyExecBit,
  applySelfHeal,
  createWorker,
  cronRegisterCmd,
  cronUnregisterCmd,
  deleteWorker,
  listWorkers,
  prepareWorktree,
  registerCron,
  startWorker,
  stopWorker,
  type EngineId,
  type WorktreePrep,
} from "../workers.ts";

export type WorkerActionResult = {
  ok: boolean;
  /** 실패 사유. 중단은 성공했을 때도 무엇을 했는지(또는 no-op이었는지) 여기로 알려 준다 */
  message?: string;
  /** 삭제가 crontab 해제 단계에서 멈췄다 = 파일은 그대로다. */
  cronFailed?: boolean;
  /** 생성 성공 시. `cron: false`면 파일은 있고 등록만 실패한 것이다. */
  created?: {
    name: string;
    path: string;
    template: string;
    cron: boolean;
    cronError?: string;
    registerCmd: string;
    unregisterCmd: string;
    worktree: WorktreePrep;
  };
  /** reap 출력 원문 */
  output?: string;
};

export function fail(e: unknown): WorkerActionResult {
  const err = e as Error & { cronFailed?: boolean };
  return { ok: false, message: err.message, cronFailed: err.cronFailed };
}

export async function workerCreateOp(
  root: string,
  name: string,
  engine = "claude",
  model = "",
  effort = "",
  deps: { registerCron?: typeof registerCron } = {},
): Promise<WorkerActionResult> {
  try {
    const worker = name.trim();
    const { path: file, template } = await createWorker(root, worker, engine as EngineId, model, effort);
    // 등록이 실패해도 파일 생성을 되돌리지 않는다. 순서는 파일 -> crontab -> 트리다(§4 생성 4항).
    const cronError = await (deps.registerCron ?? registerCron)(file).then(
      () => undefined,
      (e: Error) => e.message,
    );
    const worktree = await prepareWorktree(root, worker);
    void track("worker_create", {
      engine: ENGINES.find((x) => x.id === engine)?.id ?? "other",
      cron_ok: !cronError,
    });
    return {
      ok: true,
      created: {
        name: worker,
        path: file,
        template,
        cron: !cronError,
        cronError,
        registerCmd: cronRegisterCmd({ path: file }),
        unregisterCmd: cronUnregisterCmd({ path: file }),
        worktree,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function workerRetryWorktreeOp(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ ok: boolean; message?: string; worktree?: WorktreePrep }> {
  try {
    // 방금 만든 워커 파일이 있는 이름만 받는다 - 임의 이름으로 트리를 만들지 못하게 한다.
    if (!isName(name) || !(await stat(path.join(root, "workers", `${name}.sh`)).then(() => true, () => false))) {
      return { ok: false, message: `${t(locale, "workers.create.invalidNamePrefix")} ${name}` };
    }
    return { ok: true, worktree: await prepareWorktree(root, name, locale) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function workerStopOp(root: string, name: string, locale: Locale = DEFAULT_LOCALE): Promise<WorkerActionResult> {
  try {
    const removed = await stopWorker(root, name);
    return { ok: true, message: removed ? t(locale, "workers.stop.removedMessage") : t(locale, "workers.stop.noopMessage") };
  } catch (e) {
    return fail(e);
  }
}

export async function cronRegisterOp(root: string, name: string, locale: Locale = DEFAULT_LOCALE): Promise<WorkerActionResult> {
  try {
    const added = await startWorker(root, name);
    return { ok: true, message: added ? t(locale, "workers.register.addedMessage") : t(locale, "workers.register.noopMessage") };
  } catch (e) {
    return fail(e);
  }
}

/** crontab 줄만 뺀다(`worker_stop`과 같은 효과). 없는 워커는 오류다. */
export async function cronUnregisterOp(root: string, name: string, locale: Locale = DEFAULT_LOCALE): Promise<WorkerActionResult> {
  return workerStopOp(root, name, locale);
}

export async function workerDeleteOp(root: string, name: string): Promise<WorkerActionResult> {
  try {
    await deleteWorker(root, name);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 이름 - 상태 - cron 여부. 화면의 전체 표(`readWorkersPanelAction`)는 화면 조립이라 옮기지 않는다. */
export async function workerListOp(root: string): Promise<{ name: string; status: string; cron: boolean }[]> {
  return (await listWorkers(root)).map((w) => ({ name: w.name, status: w.status, cron: w.cron }));
}

const WORKER_FIXES = {
  common_source: applyCommonSource,
  self_heal: applySelfHeal,
  dispatch_gate: applyDispatchGate,
  exec_bit: applyExecBit,
} as const;

export const REPAIR_KINDS = [...Object.keys(WORKER_FIXES), "gate_dirty", "ticket_files", "session_heal"];

export async function ticketFilesFixOp(
  project: Project,
  locale: Locale,
): Promise<{ ok: true; stem: string } | { ok: false; message: string }> {
  try {
    const config = await resolveConfig(project);
    const existing = openFixTicket(await listTickets(project.root, config), TICKET_FILES_FIX_MARKER);
    if (existing) return { ok: true, stem: existing.stem };

    const anomalies = await ticketAnomalies(project.root, config);
    if (anomalies.length === 0) return { ok: false, message: t(locale, "boardAnomaly.none") };

    // 산출물이라 로케일 무관 한국어 고정이다(§P479).
    const body = ticketFilesFixBody(
      new Date().toISOString(),
      anomalies.map((a) => ({ file: a.file, reason: t("ko", `boardAnomaly.${a.reason}`) })),
    );
    const dir = path.join(project.root, "tickets");
    const stems = new Set((await readdir(dir)).filter((n) => n.endsWith(".md")).map((n) => stemOf(n, config)));
    for (let i = 0; i < 10; i++) {
      const h = randomUUID().slice(0, 8);
      if (stems.has(h)) continue;
      const fh = await open(path.join(dir, `${h}.md`), "wx").catch((e) => {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return null;
        throw e;
      });
      if (!fh) continue;
      try {
        await fh.writeFile(
          [
            "---",
            `ticket: ${h}`,
            `title: 티켓 파일 이상 ${anomalies.length}건 정리`,
            "kind: work",
            "persona: pm",
            `fixes: ${TICKET_FILES_FIX_MARKER}`,
            "---",
            "",
            body,
            "",
          ].join("\n"),
          "utf8",
        );
      } finally {
        await fh.close();
      }
      void track("ticket_create", { kind: "work" });
      await kickIdleWorker(project.root);
      return { ok: true, stem: h };
    }
    throw new Error(t(locale, "ontology.action.hashExhausted"));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function sessionHealOp(
  project: Project,
  error: string,
  surface: string,
  checkoutId?: string,
): Promise<SelfHealOutcome> {
  let cwd = project.root;
  if (checkoutId) {
    const checkout = await resolveCheckout(path.dirname(project.root), checkoutId);
    if (!checkout) return "noop";
    cwd = checkout.path;
  }
  return selfHeal({ error, surface, cwd, project });
}

/** 고치기 버튼 하나. 모르는 `kind`는 `ok: false`다. */
export async function projectRepairOp(
  project: Project,
  kind: string,
  a: { worker?: string; error?: string; surface?: string; checkoutId?: string },
  locale: Locale = DEFAULT_LOCALE,
): Promise<Record<string, unknown> & { ok: boolean }> {
  if (Object.hasOwn(WORKER_FIXES, kind)) {
    if (!a.worker) return { ok: false, message: "worker is required" };
    try {
      await WORKER_FIXES[kind as keyof typeof WORKER_FIXES](project.root, a.worker);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }
  if (kind === "gate_dirty") {
    const run = await discardGateDirty(project.root);
    return { ok: run.ok, output: run.output };
  }
  if (kind === "ticket_files") return ticketFilesFixOp(project, locale);
  if (kind === "session_heal") {
    return { ok: true, outcome: await sessionHealOp(project, a.error ?? "", a.surface ?? "", a.checkoutId) };
  }
  return { ok: false, message: `unknown repair kind: ${kind} (one of ${REPAIR_KINDS.join(", ")})` };
}
