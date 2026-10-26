/** 커맨드 실행 파일(`<프로젝트>/.dira/commands/<id>.sh`)의 읽기 쓰기 (DESIGN.md §P535 결정 2-3).
 *
 *  파일 하나가 정본이다. 앱은 `# dira-command: 1` 머리와 `# step:` 표지만 해석하고, 그 밖의 줄은
 *  보존한다. 환경변수 값은 파일에 적지 않는다(이름만). `dir` 인자는 `<프로젝트>/.dira/commands`다. */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type CommandStep = { kind: "shell" | "prompt"; body: string };
export type CommandSpec = { name: string; steps: CommandStep[]; env: string[]; schedule?: string };
/** `extra`는 머리와 첫 단계 사이에서 앱이 만들지 않은 줄(손편집)이다. */
export type CommandEntry =
  | { id: string; editable: true; spec: CommandSpec; extra: string }
  | { id: string; editable: false };

export const COMMAND_ID_RE = /^[0-9a-f]{8}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAGIC = "# dira-command: 1";
const PRELUDE = ['set -euo pipefail', 'cd "$(dirname "$0")/../.."'];
const STEP_MARK = /^# step: (shell|prompt)$/;
const PROMPT_OPEN = /^claude -p "\$\(cat <<'(DIRA_PROMPT\d*)'$/;

const trimEnd = (s: string) => s.replace(/\n+$/, "");

/** 입력 검증 — 잘못이면 사유를 던진다. */
function validate(spec: CommandSpec): void {
  if (!spec.name.trim() || /[\r\n]/.test(spec.name)) throw new Error("이름이 비었거나 여러 줄입니다");
  if (!spec.steps.length) throw new Error("단계가 하나 이상 필요합니다");
  for (const s of spec.steps) {
    if (!trimEnd(s.body).trim()) throw new Error("비어 있는 단계가 있습니다");
    if (s.kind !== "shell" && s.kind !== "prompt") throw new Error("단계 종류가 잘못되었습니다");
    if (/^# step: /m.test(s.body)) throw new Error("본문에 단계 표지 줄을 넣을 수 없습니다");
    if (s.body.includes("\r")) throw new Error("본문에 CR을 넣을 수 없습니다");
  }
  for (const e of spec.env) if (!ENV_NAME_RE.test(e)) throw new Error(`환경변수 이름이 잘못되었습니다: ${e}`);
  if (spec.schedule !== undefined && (!spec.schedule.trim() || /[\r\n]/.test(spec.schedule)))
    throw new Error("스케줄이 잘못되었습니다");
}

export function renderCommand(spec: CommandSpec, extra = ""): string {
  validate(spec);
  const out = ["#!/usr/bin/env bash", MAGIC, `# name: ${spec.name.trim()}`];
  if (spec.env.length) out.push(`# env: ${spec.env.join(",")}`);
  if (spec.schedule) out.push(`# schedule: ${spec.schedule.trim()}`);
  out.push(...PRELUDE);
  if (extra) out.push(trimEnd(extra));
  for (const s of spec.steps) {
    out.push(`# step: ${s.kind}`);
    const body = trimEnd(s.body);
    if (s.kind === "shell") {
      out.push(body);
      continue;
    }
    const lines = body.split("\n");
    let delim = "DIRA_PROMPT";
    for (let n = 1; lines.includes(delim); n++) delim = `DIRA_PROMPT${n}`;
    out.push(`claude -p "$(cat <<'${delim}'`, body, delim, `)"`);
  }
  return out.join("\n") + "\n";
}

/** 머리가 없으면 `null`(편집 불가). 모양이 안 맞는 prompt 블록은 shell 단계로 읽어 줄을 보존한다. */
export function parseCommand(text: string): { spec: CommandSpec; extra: string } | null {
  const lines = text.split("\n");
  if (lines[0] !== "#!/usr/bin/env bash" || lines[1] !== MAGIC) return null;
  let i = 2;
  const head: Record<string, string> = {};
  for (; i < lines.length; i++) {
    const m = /^# (name|env|schedule): (.*)$/.exec(lines[i]!);
    if (!m) break;
    head[m[1]!] = m[2]!;
  }
  if (!head.name) return null;
  const extra: string[] = [];
  const pre = [...PRELUDE];
  for (; i < lines.length && !STEP_MARK.test(lines[i]!); i++) {
    if (lines[i] === pre[0]) pre.shift();
    else extra.push(lines[i]!);
  }
  const steps: CommandStep[] = [];
  while (i < lines.length) {
    const kind = STEP_MARK.exec(lines[i]!)![1] as "shell" | "prompt";
    const block: string[] = [];
    for (i++; i < lines.length && !STEP_MARK.test(lines[i]!); i++) block.push(lines[i]!);
    while (block.length && block[block.length - 1] === "") block.pop();
    const open = kind === "prompt" ? PROMPT_OPEN.exec(block[0] ?? "") : null;
    if (open && block.length >= 3 && block[block.length - 2] === open[1] && block[block.length - 1] === ')"') {
      steps.push({ kind: "prompt", body: block.slice(1, -2).join("\n") });
    } else {
      steps.push({ kind: "shell", body: block.join("\n") });
    }
  }
  const spec: CommandSpec = {
    name: head.name,
    steps,
    env: head.env ? head.env.split(",") : [],
    ...(head.schedule ? { schedule: head.schedule } : {}),
  };
  return { spec, extra: trimEnd(extra.join("\n")) };
}

function fileOf(dir: string, id: string): string {
  if (!COMMAND_ID_RE.test(id)) throw new Error("커맨드 id가 잘못되었습니다");
  return path.join(dir, `${id}.sh`);
}

/** 디렉터리 자체가 심링크면 밖으로 나가므로 거부한다. */
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error("commands 디렉터리가 심링크입니다");
}

async function readEntry(dir: string, id: string): Promise<CommandEntry | null> {
  const f = fileOf(dir, id);
  let st;
  try {
    st = await fs.lstat(f);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const parsed = parseCommand(await fs.readFile(f, "utf8"));
  return parsed ? { id, editable: true, ...parsed } : { id, editable: false };
}

export async function listCommands(dir: string): Promise<CommandEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const ids = names.flatMap((n) => (n.endsWith(".sh") && COMMAND_ID_RE.test(n.slice(0, -3)) ? [n.slice(0, -3)] : []));
  const entries = await Promise.all(ids.sort().map((id) => readEntry(dir, id)));
  return entries.filter((e): e is CommandEntry => e !== null);
}

export async function createCommand(dir: string, spec: CommandSpec): Promise<string> {
  const text = renderCommand(spec);
  await ensureDir(dir);
  for (let tries = 0; tries < 5; tries++) {
    const id = randomBytes(4).toString("hex");
    try {
      const fh = await fs.open(fileOf(dir, id), "wx", 0o755); // O_EXCL
      try {
        await fh.writeFile(text);
        await fh.chmod(0o755); // umask가 깎은 비트를 되돌린다
      } finally {
        await fh.close();
      }
      return id;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("id를 만들지 못했습니다");
}

/** 편집 불가 파일은 거부한다. 손편집 줄(`extra`)과 단계 본문은 그대로 다시 쓴다. */
export async function updateCommand(dir: string, id: string, spec: CommandSpec): Promise<void> {
  const cur = await readEntry(dir, id);
  if (!cur) throw new Error("커맨드가 없습니다");
  if (!cur.editable) throw new Error("편집할 수 없는 커맨드입니다");
  const f = fileOf(dir, id);
  await fs.writeFile(f, renderCommand(spec, cur.extra));
  await fs.chmod(f, 0o755);
}

export async function deleteCommand(dir: string, id: string): Promise<void> {
  const f = fileOf(dir, id);
  await fs.rm(f, { force: true });
  await fs.rm(f.replace(/\.sh$/, ".log"), { force: true });
}
