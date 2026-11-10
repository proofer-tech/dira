/** op - 프로토콜 - 에픽 - 커맨드 - 일정(P559-7). 서버 액션이 하던 일을 `lib/*.ts` 함수 호출 그대로 여기서 한다.
 *  `next/*` import 금지 - `cli.ts`가 화면 서버 없이 돌린다. index.ts가 `FILE_OPS`를 OPS에 펼친다. */
import path from "node:path";
import { COMMAND_ID_RE, createCommand, deleteCommand, listCommands, updateCommand, type CommandSpec } from "../commands.ts";
import { createEpic, deleteEpicMemory, saveEpicReadme } from "../epics.ts";
import { createSchedule, deleteSchedule, readLastCommandRun, readScheduleViews } from "../home-session.ts";
import { createFile, deleteFile, renameFile, saveProtocolFile } from "../protocols.ts";
import { resolveConfig } from "../projects.ts";
import type { Op } from "./index.ts";

type Pick = (input: Record<string, unknown>) => Promise<import("../projects.ts").Project>;
type Loc = () => Promise<import("../i18n.ts").Locale>;

const S = (description: string) => ({ type: "string", description });
const PICK = {
  id: S("registry id of the project"),
  root: S("queue root (.dira) of the project; defaults to $TICKET_ROOT"),
};
const need = (v: unknown, key: string): string => {
  if (typeof v !== "string" || v === "") throw new Error(`${key} is required`);
  return v;
};
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: { ...PICK, ...properties },
  required,
  additionalProperties: false,
});

/** 서버 액션과 같은 모양의 결과를 던지는 쪽으로 바꾼다: `ok:false`는 오류로 던진다(결정 3). */
function okOrThrow<T extends { ok: boolean; error?: string }>(r: T): T {
  if (!r.ok) throw new Error(r.error || "failed");
  return r;
}

const SPEC_SCHEMA = {
  type: "object",
  description: "command spec",
  properties: {
    name: S("command name (single line)"),
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { enum: ["shell", "prompt"] }, body: S("step body") },
        required: ["kind", "body"],
      },
    },
    env: { type: "array", items: { type: "string" }, description: "env var names (values are never stored)" },
    schedule: S("schedule (optional)"),
  },
  required: ["name", "steps"],
};

function specOf(v: unknown): CommandSpec {
  if (!v || typeof v !== "object") throw new Error("spec is required");
  const s = v as Record<string, unknown>;
  if (typeof s.name !== "string" || !Array.isArray(s.steps)) throw new Error("spec needs name and steps");
  return {
    name: s.name,
    steps: s.steps.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { kind: o.kind as "shell" | "prompt", body: typeof o.body === "string" ? o.body : "" };
    }),
    env: Array.isArray(s.env) ? s.env.map(String) : [],
    schedule: typeof s.schedule === "string" ? s.schedule : undefined,
  };
}

export function fileOps(pick: Pick, locale: Loc): Record<string, Op> {
  const protocols = async (a: Record<string, unknown>) => (await resolveConfig(await pick(a))).protocols;
  const cmdDir = async (a: Record<string, unknown>) => path.join((await pick(a)).root, "commands");
  const cmdId = (a: Record<string, unknown>) => {
    const id = need(a.command_id, "command_id");
    if (!COMMAND_ID_RE.test(id)) throw new Error("command_id must be 8 hex characters");
    return id;
  };
  return {
    protocol_create: {
      description: "Create an empty protocol file (relative path under the queue's protocols dir). Result: {rel}.",
      inputSchema: schema({ rel: S("relative path, e.g. sub/GUIDE.md") }, ["rel"]),
      async run(a) {
        return { rel: await createFile(await protocols(a), need(a.rel, "rel"), await locale()) };
      },
    },
    protocol_save: {
      description: "Overwrite a protocol file. Pass expectedMtimeMs to refuse when it changed since you read it.",
      inputSchema: schema(
        { rel: S("relative path"), text: S("file content"), expectedMtimeMs: { type: "number" } },
        ["rel", "text"],
      ),
      async run(a) {
        const mt = typeof a.expectedMtimeMs === "number" ? a.expectedMtimeMs : undefined;
        await saveProtocolFile(await protocols(a), need(a.rel, "rel"), String(a.text ?? ""), mt, await locale());
        return { rel: a.rel };
      },
    },
    protocol_rename: {
      description: "Rename or move a protocol file (never overwrites). Result: {rel}.",
      inputSchema: schema({ from: S("current relative path"), to: S("new relative path") }, ["from", "to"]),
      async run(a) {
        return { rel: await renameFile(await protocols(a), need(a.from, "from"), need(a.to, "to"), await locale()) };
      },
    },
    protocol_delete: {
      description: "Delete a protocol file (directories are refused).",
      inputSchema: schema({ rel: S("relative path") }, ["rel"]),
      async run(a) {
        await deleteFile(await protocols(a), need(a.rel, "rel"), await locale());
        return { deleted: a.rel };
      },
    },
    epic_create: {
      description: "Create epics/<key>/README.md (title as the first line). Refuses an existing epic.",
      inputSchema: schema({ key: S("epic key, e.g. P600"), title: S("epic title") }, ["key", "title"]),
      async run(a) {
        okOrThrow(await createEpic((await pick(a)).root, need(a.key, "key"), need(a.title, "title"), await locale()));
        return { key: a.key };
      },
    },
    epic_readme_save: {
      description: "Overwrite an epic README (title + body). Creates the epic directory when missing.",
      inputSchema: schema({ epic: S("epic key"), title: S("title"), body: S("body") }, ["epic", "title", "body"]),
      async run(a) {
        okOrThrow(
          await saveEpicReadme((await pick(a)).root, need(a.epic, "epic"), String(a.title ?? ""), String(a.body ?? ""), await locale()),
        );
        return { epic: a.epic };
      },
    },
    epic_memory_delete: {
      description: "Delete one epic memory file (memory/<file>).",
      inputSchema: schema({ epic: S("epic key"), file: S("memory file name") }, ["epic", "file"]),
      async run(a) {
        await deleteEpicMemory((await pick(a)).root, need(a.epic, "epic"), need(a.file, "file"), await locale());
        return { deleted: a.file };
      },
    },
    command_list: {
      description: "List commands (commands/<id>.sh). Entries with editable:false are hand-written files.",
      inputSchema: schema({}),
      async run(a) {
        return listCommands(await cmdDir(a));
      },
    },
    command_create: {
      description: "Create commands/<8-hex>.sh (mode 755) from a spec. Result: {id}.",
      inputSchema: schema({ spec: SPEC_SCHEMA }, ["spec"]),
      async run(a) {
        return { id: await createCommand(await cmdDir(a), specOf(a.spec)) };
      },
    },
    command_update: {
      description: "Rewrite an editable command from a spec (hand-edited extra lines are kept).",
      inputSchema: schema({ command_id: S("8-hex id"), spec: SPEC_SCHEMA }, ["command_id", "spec"]),
      async run(a) {
        await updateCommand(await cmdDir(a), cmdId(a), specOf(a.spec));
        return { id: a.command_id };
      },
    },
    command_delete: {
      description: "Delete a command file and its log.",
      inputSchema: schema({ command_id: S("8-hex id") }, ["command_id"]),
      async run(a) {
        await deleteCommand(await cmdDir(a), cmdId(a));
        return { deleted: a.command_id };
      },
    },
    command_last_run: {
      description: "Last scheduled run of a command (time, exit code, log tail), or null.",
      inputSchema: schema({ command_id: S("8-hex id") }, ["command_id"]),
      async run(a) {
        return readLastCommandRun((await pick(a)).id, cmdId(a));
      },
    },
    schedule_list: {
      description: "List the project's home schedules.",
      inputSchema: schema({}),
      async run(a) {
        return readScheduleViews((await pick(a)).id);
      },
    },
    schedule_create: {
      description: "Add a home schedule: `when` (cron / once syntax the screen accepts) runs `prompt`. Refuses an invalid when or empty prompt.",
      inputSchema: schema({ when: S("when"), prompt: S("prompt"), persona: S("persona (optional)") }, ["when", "prompt"]),
      async run(a) {
        const p = await pick(a);
        const row = await createSchedule(
          p.id,
          need(a.when, "when"),
          need(a.prompt, "prompt"),
          typeof a.persona === "string" && a.persona ? a.persona : undefined,
        );
        if (!row) throw new Error("invalid when or empty prompt");
        return { schedule: row, schedules: await readScheduleViews(p.id) };
      },
    },
    schedule_delete: {
      description: "Delete a home schedule by id (a missing id is a success).",
      inputSchema: schema({ schedule_id: S("schedule id") }, ["schedule_id"]),
      async run(a) {
        const p = await pick(a);
        await deleteSchedule(p.id, need(a.schedule_id, "schedule_id"));
        return { schedules: await readScheduleViews(p.id) };
      },
    },
  };
}
