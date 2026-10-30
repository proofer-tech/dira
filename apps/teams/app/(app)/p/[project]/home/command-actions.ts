"use server";

/** 커맨드(`<프로젝트>/.dira/commands/<id>.sh`) 서버 액션 넷 — 목록 · 만들기 · 고치기 · 지우기
 *  (DESIGN.md §P535). 판정과 파일 쓰기는 전부 `lib/commands.ts`고 여기는 프로젝트 검증 + 위임이다.
 *  디렉터리는 등록된 프로젝트의 `.dira/commands` 하나뿐이고 id는 8자 hex만 받는다(신뢰 경계). */
import path from "node:path";
import {
  createCommand, deleteCommand, listCommands, updateCommand,
  type CommandEntry, type CommandSpec,
} from "@/lib/commands";
import { readLastCommandRun } from "@/lib/home-session";
import { getProject } from "@/lib/projects";
import { readFile } from "node:fs/promises";
import { findClaude, readOtherEngineAuth, tokenPath } from "@/lib/auth";
import { generateDraft, readScripts, spawnRunner, type DraftResult } from "@/lib/command-draft";
import { callEnvBridgeFull } from "@/lib/project-env";
import type { EngineId } from "@/lib/workers";

export type CommandResult = { ok: true; commands: CommandEntry[] } | { ok: false; error: string };

async function run(projectId: string, fn: (dir: string) => Promise<unknown>): Promise<CommandResult> {
  try {
    const project = await getProject(projectId);
    if (!project) return { ok: false, error: `unknown project ${projectId}` };
    const dir = path.join(project.root, "commands");
    await fn(dir);
    return { ok: true, commands: await listCommands(dir) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function listCommandsAction(projectId: string): Promise<CommandResult> {
  return run(projectId, async () => {});
}

export async function createCommandAction(projectId: string, spec: CommandSpec): Promise<CommandResult> {
  return run(projectId, (dir) => createCommand(dir, spec));
}

export async function updateCommandAction(projectId: string, id: string, spec: CommandSpec): Promise<CommandResult> {
  return run(projectId, (dir) => updateCommand(dir, id, spec));
}

export async function deleteCommandAction(projectId: string, id: string): Promise<CommandResult> {
  return run(projectId, (dir) => deleteCommand(dir, id));
}

/** 몸통이 그리는 마지막 예약 실행(시각, 종료 코드, 로그 끝 200줄). 아직 안 돌았으면 null. */
export async function lastCommandRunAction(projectId: string, id: string) {
  return readLastCommandRun(projectId, id);
}

/** 이름 하나로 단계 / 환경변수 / 스케줄 초안을 만든다. 실패는 던지지 않고 `ok: false`로 돌려준다. */
export async function draftCommandAction(projectId: string, name: string): Promise<DraftResult> {
  try {
    const project = await getProject(projectId);
    if (!project) return { ok: false, reason: "failed", message: `unknown project ${projectId}` };
    const bins: Partial<Record<EngineId, string>> = {};
    const claude = findClaude();
    if (claude) bins.claude = claude;
    for (const o of await readOtherEngineAuth()) {
      if (o.cli && (o.credPath || o.engine === "agy")) bins[o.engine] = o.cli;
    }
    const tok = (await readFile(tokenPath(), "utf8").catch(() => "")).replace(/[\r\n]/g, "").trim();
    const envRes = await callEnvBridgeFull(project.root, { op: "list" }).catch(() => null);
    const envNames = envRes?.ok ? (envRes.data as { items: { name: string }[] }).items.map((i) => i.name) : [];
    const ctx = { scripts: await readScripts(path.dirname(project.root)), envNames };
    return await generateDraft(
      name,
      ctx,
      Object.keys(bins) as EngineId[],
      spawnRunner(bins, tok ? { CLAUDE_CODE_OAUTH_TOKEN: tok } : {}),
    );
  } catch (e) {
    return { ok: false, reason: "failed", message: (e as Error).message };
  }
}
