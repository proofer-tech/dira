/** 티켓 편집 - 폴링 - 온톨로지 쓰기 - 비상 정지 읽기 op(P559-8). `next/*` import 금지. */
import { emergencyState } from "../emergency-stop.ts";
import { createFile, deleteFile, renameFile, saveFile } from "../protocols.ts";
import { resolveConfig } from "../projects.ts";
import {
  fixOntologySchemaOp,
  ontologyMetricsOp,
  publishOntologyImportOp,
  publishOntologyMigrationOp,
  submitSurveyOp,
} from "./ontology.ts";
import { opLocale, pickProject, PROJECT_PICK } from "./pick.ts";
import {
  deleteTicketOp,
  dispatchPollingNowOp,
  extendPollingOp,
  followupOp,
  oneKeyUpdates,
  retryBackoffOp,
  saveFrontmatterOp,
  saveTicketOp,
  setEpicOp,
  ticketCtx,
} from "./ticket.ts";

type Op = { description: string; inputSchema: Record<string, unknown>; run: (input: Record<string, unknown>) => Promise<unknown> };

const str = (v: unknown, key: string, required = true): string => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${key} is required`);
    return "";
  }
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: { ...PROJECT_PICK, ...properties },
  required,
  additionalProperties: false,
});
const S = (description: string) => ({ type: "string", description });
const HASH = S("ticket hash (8 hex) or stem");

function ticketOps(): Record<string, Op> {
  const tc = async (a: Record<string, unknown>) => ticketCtx(await pickProject(a), await opLocale());
  return {
    ticket_save: {
      description:
        "Edit an OPEN ticket: title, kind, assignment ('persona:<name>' or 'squad:<name>'), priority 1-5, duedate and body. Other frontmatter keys are kept. .wip and .done tickets are refused. Result: {ok, stem} | {ok:false, error}.",
      inputSchema: obj(
        { hash: HASH, title: S("title"), kind: S("work | request | feedback"), persona: S("persona:<name> | squad:<name>"), priority: { type: "integer", minimum: 1, maximum: 5 }, duedate: S("ISO 8601 without offset; empty clears it"), body: S("ticket body after the frontmatter") },
        ["hash", "title", "kind", "persona", "body"],
      ),
      async run(a) {
        return saveTicketOp(await tc(a), str(a.hash, "hash"), {
          title: str(a.title, "title"),
          kind: str(a.kind, "kind"),
          persona: str(a.persona, "persona"),
          priority: a.priority,
          duedate: str(a.duedate, "duedate", false),
          body: typeof a.body === "string" ? a.body : "",
        });
      },
    },
    ticket_frontmatter_set: {
      description:
        "Set or delete one frontmatter key of an OPEN ticket; the body stays byte for byte. Omit value to delete the key. Form keys (title, kind, persona, squad, priority, duedate) and engine keys are refused. Result: {ok, stem} | {ok:false, error}.",
      inputSchema: obj({ hash: HASH, key: S("frontmatter key"), value: S("one-line value; omit to delete") }, ["hash", "key"]),
      async run(a) {
        const c = await tc(a);
        const value = a.value === undefined || a.value === null ? undefined : str(a.value, "value", false);
        return saveFrontmatterOp(c, str(a.hash, "hash"), oneKeyUpdates(c, str(a.key, "key"), value));
      },
    },
    ticket_epic_set: {
      description: "Put an OPEN ticket in an epic (epic: key); empty epic removes it. Result: {ok, stem} | {ok:false, reason, error}.",
      inputSchema: obj({ hash: HASH, epic: S("epic name; empty removes") }, ["hash"]),
      async run(a) {
        return setEpicOp(await tc(a), str(a.hash, "hash"), str(a.epic, "epic", false));
      },
    },
    ticket_delete: {
      description: "Delete an OPEN ticket file. .wip and .done tickets are refused. Result: {ok, message?}.",
      inputSchema: obj({ hash: HASH }, ["hash"]),
      async run(a) {
        return deleteTicketOp(await tc(a), str(a.hash, "hash"));
      },
    },
    ticket_followup: {
      description: "Open a follow-up ticket continuing a finished or running one. Result: the followup outcome ({ok, ...}).",
      inputSchema: obj({ hash: HASH, text: S("follow-up request"), attachments: { type: "array", items: { type: "string" } } }, ["hash", "text"]),
      async run(a) {
        const att = Array.isArray(a.attachments) ? a.attachments.map(String) : [];
        return followupOp(await tc(a), str(a.hash, "hash"), str(a.text, "text"), att);
      },
    },
    polling_dispatch_now: {
      description: "End a polling wait early and dispatch the ticket now. Result: {ok, stem} | {ok:false, error}.",
      inputSchema: obj({ hash: HASH }, ["hash"]),
      async run(a) {
        return dispatchPollingNowOp(await tc(a), str(a.hash, "hash"));
      },
    },
    polling_extend: {
      description: "Extend the polling deadline (polling_until) of a waiting ticket. Result: {ok, stem} | {ok:false, error}.",
      inputSchema: obj({ hash: HASH, until: S("new ISO 8601 deadline") }, ["hash", "until"]),
      async run(a) {
        return extendPollingOp(await tc(a), str(a.hash, "hash"), str(a.until, "until"));
      },
    },
    backoff_retry_now: {
      description: "Clear the retry back-off mark so the ticket is dispatched again now. Result: {ok, stem} | {ok:false, error}.",
      inputSchema: obj({ hash: HASH }, ["hash"]),
      async run(a) {
        return retryBackoffOp(await tc(a), str(a.hash, "hash"));
      },
    },
  };
}

function ontologyOps(): Record<string, Op> {
  const oc = async (a: Record<string, unknown>) => {
    const project = await pickProject(a);
    return { project, config: await resolveConfig(project), locale: await opLocale() };
  };
  /** 파일 연산: 던지면 {ok:false, message}로 바꾼다(화면 액션과 같은 모양). */
  const file = async (a: Record<string, unknown>, run: (base: string) => Promise<Record<string, unknown>>) => {
    try {
      return { ok: true, ...(await run((await oc(a)).config.ontology)) };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };
  const REL = S("path relative to the ontology root");
  return {
    ontology_save: {
      description: "Overwrite an ontology file. Pass expectedMtimeMs (from a read) to refuse a stale overwrite. Result: {ok, rel} | {ok:false, message}.",
      inputSchema: obj({ rel: REL, text: S("new file text"), expectedMtimeMs: { type: "number" } }, ["rel", "text"]),
      async run(a) {
        const rel = str(a.rel, "rel");
        const mt = typeof a.expectedMtimeMs === "number" ? a.expectedMtimeMs : undefined;
        return file(a, async (base) => (await saveFile(base, rel, typeof a.text === "string" ? a.text : "", mt), { rel }));
      },
    },
    ontology_create: {
      description: "Create a new empty ontology file (fails if it exists). Result: {ok, rel} | {ok:false, message}.",
      inputSchema: obj({ rel: REL }, ["rel"]),
      async run(a) {
        return file(a, async (base) => ({ rel: await createFile(base, str(a.rel, "rel")) }));
      },
    },
    ontology_delete: {
      description: "Delete an ontology file. Result: {ok} | {ok:false, message}.",
      inputSchema: obj({ rel: REL }, ["rel"]),
      async run(a) {
        return file(a, async (base) => (await deleteFile(base, str(a.rel, "rel")), {}));
      },
    },
    ontology_rename: {
      description: "Rename or move an ontology file inside the ontology root. Result: {ok, rel} | {ok:false, message}.",
      inputSchema: obj({ from: REL, to: REL }, ["from", "to"]),
      async run(a) {
        return file(a, async (base) => ({ rel: await renameFile(base, str(a.from, "from"), str(a.to, "to")) }));
      },
    },
    ontology_fix_schema: {
      description: "Open (or reuse) the ticket that fixes ontology schema violations. Result: {ok, stem} | {ok:false, message}.",
      inputSchema: obj({}),
      async run(a) {
        return fixOntologySchemaOp(await oc(a)).catch((e) => ({ ok: false, message: (e as Error).message }));
      },
    },
    ontology_publish_migration: {
      description: "Open (or reuse) the ontology migration ticket. Result: {ok, stem} | {ok:false, message}.",
      inputSchema: obj({}),
      async run(a) {
        return publishOntologyMigrationOp(await oc(a)).catch((e) => ({ ok: false, message: (e as Error).message }));
      },
    },
    ontology_publish_import: {
      description: "Open (or reuse) the ticket that imports a folder into the ontology. Result: {ok, stem} | {ok:false, message}.",
      inputSchema: obj({ folder: S("absolute path of an existing directory") }, ["folder"]),
      async run(a) {
        return publishOntologyImportOp(await oc(a), str(a.folder, "folder")).catch((e) => ({ ok: false, message: (e as Error).message }));
      },
    },
    ontology_survey_submit: {
      description: "Write the ontology seed from the 4 survey answers, then open the migration ticket. Waits until both are done. Result: {ok} | {ok:false, message}.",
      inputSchema: obj({ answers: { type: "object", description: "survey answers (see lib/ontology-seed.ts OntologySurveyAnswers)" } }, ["answers"]),
      async run(a) {
        if (typeof a.answers !== "object" || a.answers === null) throw new Error("answers is required");
        try {
          await submitSurveyOp(await oc(a), a.answers as never);
          return { ok: true };
        } catch (e) {
          return { ok: false, message: (e as Error).message };
        }
      },
    },
    ontology_metrics: {
      description: "Compute ontology metrics (schema violations etc.). metrics is null when there is no dira-format ontology. Result: {ok, metrics} | {ok:false, message}.",
      inputSchema: obj({}),
      async run(a) {
        return ontologyMetricsOp(await oc(a));
      },
    },
  };
}

export const TICKET_OPS: Record<string, Op> = {
  ...ticketOps(),
  ...ontologyOps(),
  emergency_stop_get: {
    description: "Read the emergency stop state: {on, at}. Read-only; turning it on or off is done by a person in the app.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const s = emergencyState();
      return { on: s !== null, at: s?.at ?? null };
    },
  },
};
