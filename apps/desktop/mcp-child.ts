/** 엔진 MCP 자식(P476-3)의 순수 판정 - 재기동 정책과 `mcp.json` 쓰기-지우기. electron도 자식 프로세스도
 *  만지지 않아 `mcp-child.test.ts`가 창 없이 분기를 밟는다(`revive.ts`와 같은 관용구). 계약 정본은
 *  docs/DESIGN.md P476 §값 표(떠 있음 기록 - 다시 띄우기). */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RESTART_DELAY_MS = 1000;
export const CRASH_LIMIT = 5;
export const CRASH_WINDOW_MS = 60_000;

/** 죽음 시각 기록(`history`)에 이번 죽음 `now`를 더해 다음 행동을 정한다. 창 안 죽음이 한도에 닿으면
 *  멈춘다. 사용자가 멈춤 항목을 누르면 호출 쪽이 `history`를 빈 배열로 되돌린다. */
export function onMcpExit(history: number[], now: number): { action: "restart" | "stop"; history: number[]; delayMs: number } {
  const h = [...history.filter((t) => now - t < CRASH_WINDOW_MS), now];
  return { action: h.length >= CRASH_LIMIT ? "stop" : "restart", history: h, delayMs: RESTART_DELAY_MS };
}

export type McpRecord = { url: string; token: string; pid: number; started_at: string };

export const mcpJsonPath = (local: string) => join(local, "run", "mcp.json");

/** 0600으로 원자 교체한다. 토큰이 들어 있어 다른 사용자가 못 읽어야 한다. */
export function writeMcpJson(local: string, rec: McpRecord) {
  const f = mcpJsonPath(local);
  mkdirSync(join(local, "run"), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
}

/** `pid`를 주면 그 자식이 쓴 파일일 때만 지운다(재기동으로 이미 새 값이 쓰였으면 건드리지 않는다). */
export function removeMcpJson(local: string, pid?: number) {
  const f = mcpJsonPath(local);
  try {
    if (pid !== undefined && JSON.parse(readFileSync(f, "utf8")).pid !== pid) return;
  } catch {
    return;
  }
  rmSync(f, { force: true });
}

export const mcpStoppedLabel = (locale: string) =>
  locale.toLowerCase().startsWith("ko") ? "MCP 서버가 멈췄습니다 - 다시 시작" : "MCP server stopped - restart";
