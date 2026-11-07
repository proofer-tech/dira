/** 앱이 워커 밖에서 claude를 부르는 보조 호출(커맨드 초안, 스킬 설명)의 인자와 실행 (스펙 P554).
 *  하니스(사람 전역 설정, MCP, 스킬, 도구)를 전부 걷어 낸 단발 텍스트 호출이다. */
import { spawn } from "node:child_process";
import { childEnv } from "./child-env.ts";

/** P554 결정 1의 플래그. `skip`에 든 것은 뺀다(결정 3 폴백). 프롬프트는 stdin이다. */
export function auxClaudeArgs(model: string, skip: readonly string[] = []): string[] {
  const flags: string[][] = [
    ["--tools", ""],
    ["--setting-sources", ""],
    ["--strict-mcp-config"],
    ["--disable-slash-commands"],
    ["--no-session-persistence"],
  ];
  return [
    "-p", "--model", model, "--output-format", "json",
    ...flags.filter((f) => !skip.includes(f[0])).flat(),
  ];
}

export const auxClaudeEnv = (extra: Record<string, string> = {}) => childEnv({ ...extra, MAX_THINKING_TOKENS: "0" });

/** `--output-format json` 봉투 -> 본문. 오류 봉투나 모양이 다르면 던진다. */
export function parseAuxOutput(stdout: string): string {
  const j = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
  if (j.is_error || typeof j.result !== "string") throw new Error("claude returned an error result");
  return j.result;
}

const UNKNOWN_OPT = /unknown option '?(--[a-z-]+)/i;

function once(bin: string, args: string[], prompt: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"], signal });
    let stdout = "", stderr = "";
    p.stdout!.on("data", (d) => (stdout += d));
    p.stderr!.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout, stderr }));
    p.stdin!.on("error", () => {});
    p.stdin!.end(prompt);
  });
}

/** 보조 호출 한 번. 모르는 플래그로 죽으면 그 플래그를 빼고 한 번 더 부른다(결정 3). 던지면 호출부가 접는다. */
export async function runAuxClaude(
  bin: string, model: string, prompt: string,
  opts: { env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<string> {
  const env = auxClaudeEnv(opts.env);
  let r = await once(bin, auxClaudeArgs(model), prompt, env, opts.signal);
  if (r.code !== 0) {
    const bad = UNKNOWN_OPT.exec(r.stderr)?.[1];
    if (!bad) throw new Error(`claude exited ${r.code}`);
    r = await once(bin, auxClaudeArgs(model, [bad]), prompt, env, opts.signal);
    if (r.code !== 0) throw new Error(`claude exited ${r.code}`);
  }
  return parseAuxOutput(r.stdout);
}
