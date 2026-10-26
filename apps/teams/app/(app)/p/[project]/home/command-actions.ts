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
