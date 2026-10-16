/** 마이그레이션 러너 연결 (DESIGN.md P505 "언제 도는가" - "화면 (오버레이)" API).
 *
 *  적용 로직은 여기 없다 - 엔진의 `migrate.py`를 자식 프로세스로 부르고 상태 파일을 읽을 뿐이다.
 *  `key`는 레지스트리 id(또는 `machine`)만 받고 경로는 레지스트리에서 찾는다(신뢰 경계). */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, utimes, writeFile, open } from "node:fs/promises";
import path from "node:path";
import { childEnv } from "./child-env.ts";
import { isLandingOnly } from "./flags.ts";
import { localDir } from "./paths.ts";
import { readProjects } from "./projects.ts";
import { engineRepo } from "./workers.ts";
import type { MigrationStatus } from "./migration-view.ts";

export type MigrationAction = "retry" | "skip" | "wait";

export const statusPath = () => path.join(localDir(), "run", "migrate-status.json");

/** `DIRA_ENGINE`(없으면 기존 엔진 경로 유도)의 `migrate.py`. 없으면 null. */
export function migratePy(): string | null {
  const repo = engineRepo();
  if (!("path" in repo)) return null;
  const py = path.join(repo.path, "migrate.py");
  return existsSync(py) ? py : null;
}

export async function readStatus(): Promise<MigrationStatus | null> {
  try {
    const s = JSON.parse(await readFile(statusPath(), "utf8"));
    return Array.isArray(s?.rows) ? (s as MigrationStatus) : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const run = (py: string, args: string[]) =>
  new Promise<{ rc: number; out: string }>((resolve) => {
    execFile("python3", [py, ...args], { env: childEnv(), timeout: 30_000 }, (err, stdout) => {
      const rc = err ? (typeof err.code === "number" ? err.code : 2) : 0;
      resolve({ rc, out: stdout.toString() });
    });
  });

/** `migrate.py check --all`. 미적용(건너뜀 제외)이 있으면 `<key> <id>` 줄들. 러너가 없으면 []. */
export async function pendingLines(): Promise<string[]> {
  const py = migratePy();
  if (!py) return [];
  const { rc, out } = await run(py, ["check", "--all"]);
  return rc === 1 ? out.split("\n").filter(Boolean) : [];
}

function launch(args: string[]): boolean {
  const py = migratePy();
  if (!py) return false;
  try {
    const child = spawn("python3", [py, ...args], { detached: true, stdio: "ignore", env: childEnv() });
    child.on("error", () => {}); // 던지지 않는다 - 게이트가 막고 있고 다음 폴링이 다시 본다
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** 미적용이 있는데 러너가 없으면 띄운다(기다리지 않는다). 락은 러너가 잡으므로 두 번 띄워도 rc 3으로 끝난다.
 *  ponytail: 끝난 상태 파일에 `실패` 행이 남아 있으면 폴링이 자동 재시도하지 않는다(무한 재시도 방지) -
 *  서버 기동(`force`)과 `다시 시도` 버튼만 다시 띄운다. */
export async function ensureRunner(force = false): Promise<{ status: MigrationStatus | null; pending: string[] }> {
  if (isLandingOnly()) return { status: null, pending: [] };
  let status = await readStatus();
  const pending = await pendingLines();
  if (pending.length === 0) return { status, pending };
  const running = !!status && status.finished_at === null && alive(status.pid);
  const failedStays = !!status?.finished_at && status.rows.some((r) => r.state === "실패");
  if (!running && (force || !failedStays) && launch(["apply", "--all", "--status", statusPath()])) {
    await new Promise((r) => setTimeout(r, 300)); // 러너가 상태 파일을 첫 쓰기 하기를 잠깐 기다린다
    status = await readStatus();
  }
  return { status, pending };
}

export class MigrationError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** `POST /api/migrations`. `key`는 레지스트리 id 또는 `machine`뿐이다. */
export async function act(action: string, key: unknown): Promise<void> {
  if (action !== "retry" && action !== "skip" && action !== "wait") throw new MigrationError(400, "action");
  if (typeof key !== "string") throw new MigrationError(400, "key");
  const py = migratePy();
  if (!py) throw new MigrationError(503, "migrate.py 없음");
  const project = (await readProjects()).find((p) => p.id === key);
  if (!project && key !== "machine") throw new MigrationError(404, "key");
  const root = project?.root;

  if (action === "wait") {
    const f = path.join(localDir(), "run", `migrate-wait-${key}`);
    await mkdir(path.dirname(f), { recursive: true });
    await (await open(f, "a")).close();
    const now = new Date();
    await utimes(f, now, now);
  } else if (action === "retry") {
    // ponytail: 상태 파일이 이 프로젝트 한 행으로 바뀐다(나머지는 이미 끝난 행이다). 다른 러너가 돌면 rc 3으로 조용히 끝난다
    launch(root ? ["apply", "--root", root, "--status", statusPath()] : ["apply", "--all", "--status", statusPath()]);
  } else {
    if (!root) throw new MigrationError(400, "machine 항목은 건너뛸 수 없다");
    const { rc } = await run(py, ["skip", "--root", root]);
    if (rc !== 0) throw new MigrationError(500, "skip 실패");
    await markSkipped(key);
  }
}

/** 러너가 끝난 뒤의 `실패` 행은 러너가 다시 쓰지 않으므로 여기서 `건너뜀`으로 맞춘다. */
async function markSkipped(key: string): Promise<void> {
  const s = await readStatus();
  const row = s?.rows.find((r) => r.key === key);
  if (!s || !row || row.state !== "실패") return;
  row.state = "건너뜀";
  row.error = "";
  const tmp = `${statusPath()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s));
  await rename(tmp, statusPath());
}
