/** op 표(P559 결정 2). 이름이 곧 MCP 도구 이름이다. 무리마다 파일을 나누고 여기서 모은다 -
 *  뒤 티켓(P559-4~8)이 서로 다른 파일에 행을 더한다. `next/*` import 금지. */
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import { readLanguage, readProjects, type Project } from "../projects.ts";
import { createProjectOp } from "./project.ts";

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
};
