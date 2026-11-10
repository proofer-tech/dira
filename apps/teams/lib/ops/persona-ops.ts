/** 페르소나 - 스쿼드 - 휴지통 - 스킬 - 마켓 op 표(P559-6). `index.ts`의 `OPS`가 펼쳐 넣는다. 인자는 서버 액션의 인자를
 *  이름 붙인 객체이고, `FormData`였던 것은 문자열 필드다(결정 8). 반환값은 같은 이름 액션과 같다. */
import type { Op } from "./index.ts";
import { PROJECT_PICK, opLocale, pickProject } from "./pick.ts";
import * as m from "./market.ts";
import * as p from "./persona.ts";

type In = Record<string, unknown>;
type Prop = Record<string, unknown>;

function str(v: unknown, key: string, required = true): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${key} is required`);
    return "";
  }
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}
function strs(v: unknown, key: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${key} must be an array of strings`);
  return v as string[];
}
function bool(v: unknown): boolean {
  return v === true;
}
const kindOf = (v: unknown, key = "kind"): "persona" | "squad" => {
  const k = str(v, key);
  if (k !== "persona" && k !== "squad") throw new Error(`${key} must be persona or squad`);
  return k;
};
const bumpOf = (v: unknown): "patch" | "minor" | "major" => {
  const b = str(v, "bump", false) || "patch";
  if (b !== "patch" && b !== "minor" && b !== "major") throw new Error("bump must be patch, minor or major");
  return b;
};

const S = (description: string): Prop => ({ type: "string", description });
const NAME = S("persona or squad name");

/** 프로젝트를 고르는 op. `extra`가 입력 속성, `required`가 필수 키다. */
function projectOp(
  description: string,
  extra: Record<string, Prop>,
  required: string[],
  run: (projectId: string, a: In) => Promise<unknown>,
): Op {
  return {
    description,
    inputSchema: { type: "object", properties: { ...PROJECT_PICK, ...extra }, required, additionalProperties: false },
    async run(a) {
      return run((await pickProject(a)).id, a);
    },
  };
}

/** 프로젝트를 안 고르는 op(머신 전체: 스킬, 마켓 목록). */
function plainOp(description: string, extra: Record<string, Prop>, required: string[], run: (a: In) => Promise<unknown>): Op {
  return { description, inputSchema: { type: "object", properties: extra, required, additionalProperties: false }, run };
}

const MEMBERS: Prop = {
  type: "array",
  description: "squad members in order",
  items: {
    type: "object",
    properties: { name: { type: "string" }, role: { type: "string" } },
    required: ["name"],
  },
};

export const PERSONA_OPS: Record<string, Op> = {
  persona_create: projectOp("Create a persona (name rules and the squad shared namespace apply). Result: {ok, message?}.", { name: NAME }, ["name"], (id, a) => p.personaCreate(id, str(a.name, "name"))),
  persona_save: projectOp("Overwrite a persona's PROFILE.md. Result: {ok, message?}.", { name: NAME, body: S("PROFILE.md text") }, ["name", "body"], (id, a) => {
    if (typeof a.body !== "string") throw new Error("body must be a string");
    return p.personaSave(id, str(a.name, "name"), a.body);
  }),
  persona_delete: projectOp("Move a persona to the trash (restorable with trash_restore).", { name: NAME }, ["name"], (id, a) => p.personaDelete(id, str(a.name, "name"))),
  persona_hide: projectOp("Hide a profile-less persona name from the list.", { name: NAME }, ["name"], (id, a) => p.personaHide(id, str(a.name, "name"))),
  persona_unhide: projectOp("Unhide a persona name.", { name: NAME }, ["name"], (id, a) => p.personaUnhide(id, str(a.name, "name"))),
  persona_copy_shared_to_local: projectOp("Copy a shared team package (persona or squad) to a local one.", { kind: S("persona | squad"), name: NAME }, ["kind", "name"], (id, a) => p.copySharedToLocal(id, kindOf(a.kind), str(a.name, "name"))),
  persona_color_set: projectOp("Set a persona's display color in the registry; empty color clears it.", { name: NAME, color: S("color token; empty clears") }, ["name"], (id, a) => p.personaColorSet(id, str(a.name, "name"), str(a.color, "color", false) || null)),
  persona_skills_set: projectOp(
    "Set a persona's active and disabled skill lists by name (descriptions are read by the server). Result: {ok, skills?, chars?, offSkills?}.",
    { name: NAME, picked: { type: "array", items: { type: "string" }, description: "active skill names" }, offPicked: { type: "array", items: { type: "string" }, description: "disabled skill names" } },
    ["name", "picked"],
    (id, a) => p.personaSkillsSet(id, str(a.name, "name"), strs(a.picked, "picked"), strs(a.offPicked, "offPicked")),
  ),
  persona_limit_set: projectOp("Set a persona's concurrent worker limit (digits as a string; empty removes the limit, 0 pauses).", { name: NAME, value: S("digits or empty") }, ["name"], (id, a) => p.personaLimitSet(id, str(a.name, "name"), str(a.value, "value", false))),
  persona_engine_set: projectOp(
    "Set a persona's engine (empty engine removes the setting). A custom existing value needs force: true.",
    { name: NAME, engine: S("engine id; empty removes"), model: S("model"), effort: S("effort"), force: { type: "boolean" } },
    ["name"],
    (id, a) => p.personaEngineSet(id, str(a.name, "name"), str(a.engine, "engine", false) || null, str(a.model, "model", false), str(a.effort, "effort", false), bool(a.force)),
  ),
  persona_memory_delete: projectOp("Delete one memory file of a persona.", { name: NAME, file: S("memory file name") }, ["name", "file"], (id, a) => p.personaMemoryDelete(id, str(a.name, "name"), str(a.file, "file"))),

  squad_create: projectOp("Create a squad (shares the namespace with personas).", { name: NAME }, ["name"], (id, a) => p.squadCreate(id, str(a.name, "name"))),
  squad_members_set: projectOp("Set a squad's members (empty list writes an empty file).", { name: NAME, members: MEMBERS }, ["name", "members"], (id, a) => {
    if (!Array.isArray(a.members)) throw new Error("members must be an array");
    const members = a.members.map((x) => {
      const o = (x ?? {}) as In;
      return { name: str(o.name, "members[].name"), role: str(o.role, "members[].role", false) };
    });
    return p.squadMembersSet(id, str(a.name, "name"), members as never);
  }),
  squad_rules_set: projectOp("Set a squad's rules text (empty deletes the file).", { name: NAME, rules: S("rules text") }, ["name"], (id, a) => p.squadRulesSet(id, str(a.name, "name"), str(a.rules, "rules", false))),
  squad_delete: projectOp("Move a squad to the trash.", { name: NAME }, ["name"], (id, a) => p.squadDelete(id, str(a.name, "name"))),
  squad_design_ticket: projectOp(
    "Issue a design ticket that makes a squad from a description. Result: {ok, hash?, message?}.",
    { name: NAME, description: S("what the squad is for"), assignee: S("assignee, e.g. persona name or squad:<name>") },
    ["name", "description"],
    (id, a) => p.squadDesignTicket(id, str(a.name, "name"), str(a.description, "description"), str(a.assignee, "assignee", false)),
  ),
  squad_review_ticket: projectOp("Issue a review ticket for a squad.", { name: NAME }, ["name"], (id, a) => p.squadReviewTicket(id, str(a.name, "name"))),

  trash_list: projectOp("List trashed personas and squads (newest first).", {}, [], (id) => p.trashList(id)),
  trash_restore: projectOp("Restore a trash entry (fails without touching anything if the name exists).", { kind: S("persona | squad"), entry: S("trash entry name from trash_list") }, ["kind", "entry"], (id, a) => p.trashRestore(id, kindOf(a.kind), str(a.entry, "entry"))),
  trash_purge: projectOp("Permanently delete one trash entry.", { kind: S("persona | squad"), entry: S("trash entry name from trash_list") }, ["kind", "entry"], (id, a) => p.trashPurge(id, kindOf(a.kind), str(a.entry, "entry"))),

  skill_list: plainOp("List skills installed on this machine.", {}, [], () => p.skillList()),
  skill_install: plainOp("Install a skill from an address (URL or repo path). Uploads are not supported.", { address: S("skill address") }, ["address"], async (a) => p.skillInstallAddress(str(a.address, "address"), await opLocale())),

  market_list: plainOp("List market cards and registered projects (installedIn marks where each item was imported).", {}, [], async () => m.marketPaneData(await opLocale())),
  market_item: plainOp("Read one market item's detail (PROFILE.md or members, skills.md).", { kind: S("persona | squad"), owner: S("owner project id"), name: S("item name") }, ["kind", "owner", "name"], (a) => m.marketItemDetail(kindOf(a.kind), str(a.owner, "owner"), str(a.name, "name"))),
  market_import: projectOp(
    "Import a market persona or squad into the project. Result: {ok, as?, conflict?, message?}. overwrite re-imports.",
    { kind: S("persona | squad"), owner: S("owner project id"), name: S("item name"), as: S("local name; defaults to name"), overwrite: { type: "boolean" }, version: S("version for team projects") },
    ["kind", "owner", "name"],
    async (id, a) => m.marketImport(kindOf(a.kind), str(a.owner, "owner"), str(a.name, "name"), id, str(a.as, "as", false), bool(a.overwrite), await opLocale(), str(a.version, "version", false) || undefined),
  ),
  market_update_preview: projectOp("Diff before updating an imported item (team projects only; null otherwise).", { kind: S("persona | squad"), owner: S("owner project id"), name: S("item name") }, ["kind", "owner", "name"], (id, a) => m.marketUpdatePreview(kindOf(a.kind), str(a.owner, "owner"), str(a.name, "name"), id)),
  market_deploy_persona: projectOp(
    "Publish a persona to the market. Result: {ok, meta?, message?}.",
    { name: NAME, note: S("release note"), tags: { type: "array", items: { type: "string" } }, bump: S("patch | minor | major") },
    ["name"],
    (id, a) => m.marketDeployPersona(id, str(a.name, "name"), str(a.note, "note", false), strs(a.tags, "tags"), bumpOf(a.bump)),
  ),
  market_missing_members: projectOp("List squad members missing from the market (deploy them first).", { squad: S("squad name") }, ["squad"], (id, a) => m.marketMissingMembers(id, str(a.squad, "squad"))),
  market_deploy_squad: projectOp(
    "Publish a squad to the market, deploying missing member personas first.",
    { squad: S("squad name"), note: S("release note"), tags: { type: "array", items: { type: "string" } }, bump: S("patch | minor | major") },
    ["squad"],
    (id, a) => m.marketDeploySquad(id, str(a.squad, "squad"), str(a.note, "note", false), strs(a.tags, "tags"), bumpOf(a.bump)),
  ),
};
