/** op 표(P559 결정 2). 이름이 곧 MCP 도구 이름이다. 무리마다 파일을 나누고 여기서 모은다 -
 *  뒤 티켓(P559-4~8)이 서로 다른 파일에 행을 더한다. `next/*` import 금지. */
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import { readLanguage, readProjects, type Project } from "../projects.ts";
import { createProjectOp } from "./project.ts";
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

/** 프로젝트를 고르는 op의 공용 입력 조각. */
export const PROJECT_PICK = {
  id: { type: "string", description: "registry id of the project" },
  root: { type: "string", description: "queue root (.dira) of the project; defaults to $TICKET_ROOT" },
} as const;

/** 프로젝트 고르기(결정 2): `id` | `root` | `TICKET_ROOT`. 등록되지 않은 큐는 오류다. */
export async function pickProject(input: Record<string, unknown>): Promise<Project> {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const root = typeof input.root === "string" ? input.root.trim() : "";
  const projects = await readProjects();
  if (id) {
    const p = projects.find((x) => x.id === id);
    if (!p) throw new Error(`no registered project with id: ${id}`);
    return p;
  }
  const want = root || process.env.TICKET_ROOT || "";
  if (!want) throw new Error("id, root or TICKET_ROOT is required");
  const norm = (s: string) => s.normalize("NFC").replace(/\/+$/, "");
  const p = projects.find((x) => norm(x.root) === norm(want));
  if (!p) throw new Error(`queue is not registered: ${want}`);
  return p;
}

/** 언어는 `language.json`을 읽는다(`readLanguage`와 같다). */
export async function opLocale(): Promise<Locale> {
  return readLanguage().catch(() => DEFAULT_LOCALE);
}

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
};
