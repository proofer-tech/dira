/** 커맨드 초안 생성 (요구 4fe66525) - 이름과 프로젝트 맥락으로 `{ steps, env, schedule? }`를 작은 모델이 만든다.
 *
 *  모델은 사람이 고르지 않는다. 이 머신에서 쓸 수 있는 엔진 중 `ENGINE_PRIORITY` 앞쪽을 고르고, 그
 *  엔진의 가장 작은 모델(`SMALLEST_MODEL`)을 붙인다. 모델 호출(`DraftRunner`)은 인자로 주입되어
 *  테스트가 실제 모델 없이 돈다. 이 모듈은 예외를 던지지 않고 결과 값으로 실패를 돌려준다.
 *  환경변수는 **이름만** 프롬프트에 들어간다 - 값을 읽는 코드가 이 파일에 없다. */
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { childEnv } from "./child-env.ts";
import { renderCommand, type CommandSpec, type CommandStep } from "./commands.ts";
import type { EngineId } from "./workers.ts";

export type CommandDraft = Omit<CommandSpec, "name">;

/** 엔진별 가장 작은 모델 - 한 곳의 표다. 근거(2026-10-30 실측):
 *  - claude: `claude --help`의 별칭 `haiku` (`lib/auth.ts` 프로브가 쓰는 가장 싼 모델과 같다).
 *  - codex: `codex debug models`(codex-cli 0.160.0)의 list 중 설명이 "Fast and affordable model for
 *    easier tasks"인 `gpt-6-luna`. (`gpt-reserve`는 `visibility: hide`라 못 쓴다.)
 *  - grok: `grok models`가 내는 이름이 `grok-4.5` 하나뿐이다.
 *  - agy: `agy models`의 flash 계열 중 강도가 가장 낮은 `gemini-3.6-flash-low`.
 *  표의 이름이 `ENGINES[].models`에 있는지는 테스트가 확인한다 - 모델이 낡아 바뀌면 거기서 깨진다. */
export const SMALLEST_MODEL: Record<EngineId, string> = {
  claude: "haiku",
  codex: "gpt-6-luna",
  grok: "grok-4.5",
  agy: "gemini-3.6-flash-low",
};

/** 쓸 수 있는 엔진이 여럿이면 앞쪽이 이긴다. */
export const ENGINE_PRIORITY: readonly EngineId[] = ["claude", "codex", "agy", "grok"];

/** 연결된 엔진(`usable`)에서 하나와 그 가장 작은 모델을 고른다. 하나도 없으면 `null`. */
export function pickEngine(usable: readonly EngineId[]): { engine: EngineId; model: string } | null {
  const engine = ENGINE_PRIORITY.find((e) => usable.includes(e));
  return engine ? { engine, model: SMALLEST_MODEL[engine] } : null;
}

export type DraftContext = {
  /** 프로젝트 루트 `package.json`의 scripts. 이름과 명령 */
  scripts: { name: string; command: string }[];
  /** 등록된 환경변수 **이름**. 값은 여기 없다 */
  envNames: string[];
};

/** 프로젝트 루트(`.dira`의 부모)의 `package.json` scripts를 읽는다. 없거나 깨졌으면 빈 목록. */
export async function readScripts(projectRoot: string): Promise<DraftContext["scripts"]> {
  try {
    const f = path.join(projectRoot, "package.json");
    if (!(await stat(f)).isFile()) return [];
    const s = (JSON.parse(await readFile(f, "utf8")) as { scripts?: unknown }).scripts;
    if (!s || typeof s !== "object") return [];
    return Object.entries(s as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === "string")
      .slice(0, 30)
      .map(([name, command]) => ({ name, command: command.slice(0, 160) }));
  } catch {
    return [];
  }
}

export function buildDraftPrompt(name: string, ctx: DraftContext): string {
  const scripts = ctx.scripts.length ? ctx.scripts.map((s) => `- ${s.name}: ${s.command}`).join("\n") : "(none)";
  const env = ctx.envNames.length ? ctx.envNames.join(", ") : "(none)";
  return `You write a draft of a command for a developer tool. Reply with ONE JSON object and nothing else.
Shape: {"steps":[{"kind":"shell"|"prompt","body":string}],"env":[string],"schedule":string|null}
- steps: 1 to 5 steps that do what the command name says. "shell" is a bash snippet run in the project root. "prompt" is an instruction for an AI agent. Prefer a project script below over inventing a command.
- env: names from the registered list that the steps need. Never invent a name.
- schedule: a 5-field cron expression ONLY if the name says a time or repetition (for example daily at 9am, every Monday); otherwise null.

Command name: ${JSON.stringify(name)}
Project scripts:
${scripts}
Registered environment variable names: ${env}
`;
}

const TIME_WORDS =
  /매일|매주|매월|매시|매분|아침|저녁|점심|새벽|자정|정오|주말|평일|[월화수목금토일]요일|\d+\s*시|\d+\s*분|every|daily|weekly|monthly|hourly|nightly|\bat\s+\d|\d\s*(?:am|pm)\b|morning|midnight|weekday/i;
const CRON_RE = /^[0-9*/,-]+( [0-9*/,-]+){4}$/;

/** 모델 출력 문자열 -> 초안. 스키마에 어긋나면 `null`. 환경변수는 등록 목록에 있는 이름만 남기고,
 *  스케줄은 이름에 시각 표현이 있고 cron 5필드일 때만 남긴다. */
export function parseDraft(raw: string, name: string, envNames: readonly string[]): CommandDraft | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const o = j as { steps?: unknown; env?: unknown; schedule?: unknown };
  if (!Array.isArray(o.steps) || o.steps.length < 1 || o.steps.length > 8) return null;
  const steps: CommandStep[] = [];
  for (const s of o.steps) {
    const k = (s as { kind?: unknown } | null)?.kind;
    const body = (s as { body?: unknown } | null)?.body;
    if ((k !== "shell" && k !== "prompt") || typeof body !== "string" || !body.trim() || body.length > 4000) return null;
    steps.push({ kind: k, body });
  }
  const env = Array.isArray(o.env)
    ? [...new Set(o.env.filter((e): e is string => typeof e === "string" && envNames.includes(e)))]
    : [];
  const sch = typeof o.schedule === "string" ? o.schedule.trim() : "";
  const draft: CommandDraft = { steps, env, ...(sch && CRON_RE.test(sch) && TIME_WORDS.test(name) ? { schedule: sch } : {}) };
  try {
    renderCommand({ name: name.trim() || "x", ...draft }); // 파일로 쓸 수 있는 모양인지 - 던지면 거절
  } catch {
    return null;
  }
  return draft;
}

export type DraftResult =
  | { ok: true; engine: EngineId; model: string; draft: CommandDraft }
  | { ok: false; reason: "no-engine" | "timeout" | "invalid" | "failed"; message: string };

/** 모델 한 번 호출. 시간 제한은 `signal`로 온다. 던지면 `failed`로 바뀐다. */
export type DraftRunner = (engine: EngineId, model: string, prompt: string, signal: AbortSignal) => Promise<string>;

export const DRAFT_TIMEOUT_MS = 12_000;

export async function generateDraft(
  name: string,
  ctx: DraftContext,
  usable: readonly EngineId[],
  run: DraftRunner,
  timeoutMs = DRAFT_TIMEOUT_MS,
): Promise<DraftResult> {
  const pick = pickEngine(usable);
  if (!pick) return { ok: false, reason: "no-engine", message: "no usable engine is connected" };
  const signal = AbortSignal.timeout(timeoutMs);
  let out: string;
  try {
    out = await Promise.race([
      run(pick.engine, pick.model, buildDraftPrompt(name, ctx), signal),
      new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("timeout")))),
    ]);
  } catch (e) {
    const timedOut = signal.aborted;
    return { ok: false, reason: timedOut ? "timeout" : "failed", message: timedOut ? "timed out" : (e as Error).message };
  }
  const draft = parseDraft(out, name, ctx.envNames);
  return draft ? { ok: true, ...pick, draft } : { ok: false, reason: "invalid", message: "model output did not match the schema" };
}

/** 실제 호출. claude와 codex는 프롬프트를 stdin으로, grok과 agy는 인자로 준다.
 *  ponytail: 엔진마다 한 줄 argv다. 도구 호출이 필요 없는 단발 텍스트라 도구는 끈다/읽기 전용으로 둔다. */
export const spawnRunner =
  (bins: Partial<Record<EngineId, string>>, extraEnv: Record<string, string> = {}): DraftRunner =>
  (engine, model, prompt, signal) =>
    new Promise((resolve, reject) => {
      const bin = bins[engine];
      if (!bin) return reject(new Error(`no executable for ${engine}`));
      const viaStdin = engine === "claude" || engine === "codex";
      const args =
        engine === "claude" ? ["-p", "--model", model, "--no-session-persistence", "--tools", ""]
        : engine === "codex" ? ["exec", "-m", model, "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-"]
        : engine === "grok" ? ["-p", prompt, "-m", model]
        : ["-p", prompt, "--model", model];
      const p = spawn(bin, args, { env: childEnv(extraEnv), stdio: [viaStdin ? "pipe" : "ignore", "pipe", "ignore"], signal });
      let out = "";
      p.stdout!.on("data", (d) => (out += d));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${engine} exited ${code}`))));
      if (viaStdin) p.stdin!.end(prompt);
    });
