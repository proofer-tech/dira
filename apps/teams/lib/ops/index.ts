/** op 표(P559 결정 2). 이름이 곧 MCP 도구 이름이다. 무리마다 파일을 나누고 여기서 모은다 -
 *  뒤 티켓(P559-4~8)이 서로 다른 파일에 행을 더한다. `next/*` import 금지. */
import { PERSONA_OPS } from "./persona-ops.ts";
import { TICKET_OPS } from "./ticket-ops.ts";
import { createProjectOp } from "./project.ts";
import {
  cronRegisterOp,
  cronUnregisterOp,
  projectRepairOp,
  REPAIR_KINDS,
  workerCreateOp,
  workerDeleteOp,
  workerListOp,
  workerRetryWorktreeOp,
  workerStopOp,
} from "./worker.ts";
import {
  copyContext,
  getContext,
  getOntology,
  setContext,
  setOntology,
  setProjectSettings,
} from "./settings.ts";

export type Op = {
  description: string;
  /** JSON Schema(MCP `inputSchema`). */
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

export { PROJECT_PICK, opLocale, pickProject } from "./pick.ts";
import { PROJECT_PICK, opLocale, pickProject } from "./pick.ts";

const str = (v: unknown, key: string, required = true): string => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${key} is required`);
    return "";
  }
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
};

const bool = (v: unknown, key: string): boolean | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new Error(`${key} must be a boolean`);
  return v;
};

const items = (v: unknown): { path: string; desc: string }[] => {
  if (!Array.isArray(v)) throw new Error("items must be an array of {path, desc}");
  return v.map((x) => {
    const o = x as { path?: unknown; desc?: unknown };
    if (typeof o?.path !== "string") throw new Error("items[].path must be a string");
    return { path: o.path, desc: typeof o.desc === "string" ? o.desc : "" };
  });
};

const PICK = { ...PROJECT_PICK };

export const OPS: Record<string, Op> = {
  ...PERSONA_OPS,
  ...TICKET_OPS,
  project_create: {
    description:
      "Create a new dira queue in a git repository (scaffold, w1 cron, registry entry, persona colors, default skills). Result: {error?, exists?, created?}. Created files are never rolled back.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "project directory (the git repository)" },
        name: { type: "string", description: "display name" },
        branch: { type: "string", description: "integration branch" },
        ontology: { type: "string", description: "ontology location (optional)" },
        specDoc: { type: "string", description: "spec document path (optional)" },
        id: { type: "string", description: "registry id (optional; derived from the name)" },
      },
      required: ["path", "name", "branch"],
      additionalProperties: false,
    },
    async run(a) {
      return createProjectOp(
        {
          path: str(a.path, "path"),
          name: str(a.name, "name"),
          branch: str(a.branch, "branch"),
          ontology: str(a.ontology, "ontology", false) || undefined,
          specDoc: str(a.specDoc, "specDoc", false) || undefined,
          id: str(a.id, "id", false) || undefined,
        },
        await opLocale(),
      );
    },
  },
  project_ontology_get: {
    description: "Resolved ontology location of a project. Result: {value}.",
    inputSchema: { type: "object", properties: PICK, additionalProperties: false },
    async run(a) {
      return getOntology((await pickProject(a)).root);
    },
  },
  project_ontology_set: {
    description:
      "Set TICKET_ONTOLOGY in every worker file. path must be an existing absolute directory outside any worktree; an empty path resets to the default.",
    inputSchema: {
      type: "object",
      properties: { ...PICK, path: { type: "string", description: "absolute directory, or empty to reset" } },
      required: ["path"],
      additionalProperties: false,
    },
    async run(a) {
      const p = await pickProject(a);
      await setOntology(p.root, str(a.path, "path", false), await opLocale());
      return getOntology(p.root);
    },
  },
  project_context_get: {
    description: "Context path items: the common context.sh and each worker's TICKET_CONTEXT, with existence flags.",
    inputSchema: { type: "object", properties: PICK, additionalProperties: false },
    async run(a) {
      return getContext((await pickProject(a)).root, await opLocale());
    },
  },
  project_context_set: {
    description:
      "Replace context items. With worker: that worker's TICKET_CONTEXT block; without: the common context.sh.",
    inputSchema: {
      type: "object",
      properties: {
        ...PICK,
        worker: { type: "string", description: "worker name (omit for the common context)" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string" }, desc: { type: "string" } },
            required: ["path"],
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    async run(a) {
      const p = await pickProject(a);
      return setContext(p.root, str(a.worker, "worker", false) || undefined, items(a.items), await opLocale());
    },
  },
  project_context_copy: {
    description: "Copy a worker's TICKET_CONTEXT block over another worker's (the receiver's block is replaced).",
    inputSchema: {
      type: "object",
      properties: { ...PICK, from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
    async run(a) {
      const p = await pickProject(a);
      return copyContext(p.root, str(a.from, "from"), str(a.to, "to"), await opLocale());
    },
  },
  project_settings_set: {
    description:
      "Change project settings; only the keys given. integration_branch rewrites every place it is used; slim toggles the slim checkout. Result: {integration_branch?: {branch, changed}, slim?}.",
    inputSchema: {
      type: "object",
      properties: {
        ...PICK,
        integration_branch: { type: "string" },
        slim: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async run(a) {
      const p = await pickProject(a);
      return setProjectSettings(
        p.root,
        { integration_branch: a.integration_branch === undefined ? undefined : str(a.integration_branch, "integration_branch"), slim: bool(a.slim, "slim") },
        await opLocale(),
      );
    },
  },
  worker_list: {
    description: "List the workers of a project: name, status (running|stale|idle|stopped) and whether the crontab has its line.",
    inputSchema: { type: "object", properties: { ...PROJECT_PICK }, additionalProperties: false },
    async run(a) {
      return workerListOp((await pickProject(a)).root);
    },
  },
  worker_create: {
    description:
      "Create a worker (file, then crontab line, then worktree). Result: {ok, message?, created?: {name, path, template, cron, cronError?, registerCmd, unregisterCmd, worktree}}. A failed crontab write keeps the file.",
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_PICK,
        name: { type: "string", description: "worker name, e.g. w2" },
        engine: { type: "string", description: "claude (default) or codex" },
        model: { type: "string", description: "model id (optional)" },
        effort: { type: "string", description: "effort level (optional)" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async run(a) {
      const root = (await pickProject(a)).root;
      return workerCreateOp(root, str(a.name, "name"), str(a.engine, "engine", false) || "claude", str(a.model, "model", false), str(a.effort, "effort", false));
    },
  },
  worker_delete: {
    description: "Remove the worker's crontab line, then delete workers/<name>.sh. Refuses while the worker is running.",
    inputSchema: { type: "object", properties: { ...PROJECT_PICK, name: { type: "string" } }, required: ["name"], additionalProperties: false },
    async run(a) {
      return workerDeleteOp((await pickProject(a)).root, str(a.name, "name"));
    },
  },
  worker_stop: {
    description: "Stop a worker: remove only its crontab line. Running sessions and locks are untouched.",
    inputSchema: { type: "object", properties: { ...PROJECT_PICK, name: { type: "string" } }, required: ["name"], additionalProperties: false },
    async run(a) {
      return workerStopOp((await pickProject(a)).root, str(a.name, "name"), await opLocale());
    },
  },
  worker_retry_worktree: {
    description: "Run the remaining worktree preparation steps again for an existing worker.",
    inputSchema: { type: "object", properties: { ...PROJECT_PICK, name: { type: "string" } }, required: ["name"], additionalProperties: false },
    async run(a) {
      return workerRetryWorktreeOp((await pickProject(a)).root, str(a.name, "name"), await opLocale());
    },
  },
  cron_register: {
    description: "Put the worker's crontab line back (inverse of worker_stop). Result: {ok, message}.",
    inputSchema: { type: "object", properties: { ...PROJECT_PICK, worker: { type: "string" } }, required: ["worker"], additionalProperties: false },
    async run(a) {
      return cronRegisterOp((await pickProject(a)).root, str(a.worker, "worker"), await opLocale());
    },
  },
  cron_unregister: {
    description: "Remove the worker's crontab line only. No-op when absent. Result: {ok, message}.",
    inputSchema: { type: "object", properties: { ...PROJECT_PICK, worker: { type: "string" } }, required: ["worker"], additionalProperties: false },
    async run(a) {
      return cronUnregisterOp((await pickProject(a)).root, str(a.worker, "worker"), await opLocale());
    },
  },
  project_repair: {
    description: `Run one of the screen's fix buttons. kind: ${REPAIR_KINDS.join(" | ")}. self_heal, dispatch_gate, exec_bit and common_source need worker; session_heal takes error, surface and optional checkoutId; gate_dirty discards the integration tree's leftovers; ticket_files issues the cleanup ticket. An unknown kind gives ok:false.`,
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_PICK,
        kind: { type: "string", enum: REPAIR_KINDS },
        worker: { type: "string" },
        error: { type: "string" },
        surface: { type: "string" },
        checkoutId: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    async run(a) {
      return projectRepairOp(
        await pickProject(a),
        str(a.kind, "kind"),
        { worker: str(a.worker, "worker", false), error: str(a.error, "error", false), surface: str(a.surface, "surface", false), checkoutId: str(a.checkoutId, "checkoutId", false) || undefined },
        await opLocale(),
      );
    },
  },
};
