/** 엔진 MCP 상태 (DESIGN.md P476 §화면). 앱이 `~/.config/dira/run/mcp.json`에 적는 `{url, token, pid}`를
 *  읽고, `pid`가 살아 있는지로 판정한다. 파일 없음 / pid 죽음 / 살아 있음 세 갈래다.
 *  server-only(`node:*`) - 클라이언트는 액션이 돌려준 값만 쓴다. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { registryPath } from "./projects.ts";

export type McpStatus =
  | { state: "none" | "dead" }
  | { state: "alive"; url: string; httpConfig: string };

export const MCP_STDIO_CONFIG = '{"command":"dira","args":["mcp"]}';

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // 남의 프로세스여도 산 것이다
  }
};

export function mcpJsonPath(): string {
  return path.join(path.dirname(registryPath()), "run", "mcp.json");
}

export function readMcpStatus(file = mcpJsonPath(), alive: (pid: number) => boolean = pidAlive): McpStatus {
  let rec: { url?: unknown; token?: unknown; pid?: unknown };
  try {
    rec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { state: "none" };
  }
  if (typeof rec.url !== "string" || typeof rec.token !== "string" || !Number.isInteger(rec.pid)) {
    return { state: "none" };
  }
  if (!alive(rec.pid as number)) return { state: "dead" };
  return {
    state: "alive",
    url: rec.url,
    httpConfig: JSON.stringify({ type: "http", url: rec.url, headers: { Authorization: `Bearer ${rec.token}` } }),
  };
}
