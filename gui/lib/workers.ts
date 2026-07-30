/** 워커 파일·락·crontab 판정 (DESIGN.md §워커 상태 판정).
 *
 *  ponytail: 지금 필요한 건 **상태 요약**뿐이다(테넌트 목록의 `running 1 / idle 1`, 전환기 항목).
 *  물고 있는 티켓·runner.log 테일·TICKET_CONTEXT 파싱은 워커 화면 티켓(60d49d89)이 여기에 더한다.
 *  락 경로 조립·pid 생존·crontab 판정은 그 티켓도 같은 함수를 쓴다 — 두 번 구현하면 갈린다. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expandHome } from "./paths.ts";

export type WorkerStatus = "running" | "idle" | "stopped" | "stale";

export type Worker = {
  name: string;
  path: string;
  status: WorkerStatus;
  lockPid: number | null;
};

/** tick.sh와 **같이** 조립한다:
 *  `${TICKET_LOCAL:-~/.config/fs-tickets}/run/<이름>-<sha1(<workers 절대경로>/<이름>)[:8]>.lock`
 *
 *  `TICKET_LOCAL`은 테넌트별이 아니라 머신 전역이라 모든 테넌트의 락이 한 디렉터리에 섞인다.
 *  해시에 workers 절대경로가 들어 있어 이름이 같은 `w1`끼리도 충돌하지 않는다. 그래서 반대로
 *  **락 디렉터리에서 워커를 역추적하지 않고** 워커 파일 목록에서 락을 찾는다. */
export function lockPath(workersDir: string, name: string): string {
  const local = process.env.TICKET_LOCAL || path.join(homedir(), ".config", "fs-tickets");
  const h = createHash("sha1").update(path.join(workersDir, name)).digest("hex").slice(0, 8);
  return path.join(expandHome(local), "run", `${name}-${h}.lock`);
}

/** 락은 디렉터리다(`mkdir`가 원자적 획득). 안의 `pid` 파일이 소유 프로세스다. */
async function lockOf(dir: string): Promise<{ held: boolean; pid: number | null }> {
  const held = await stat(dir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!held) return { held: false, pid: null };
  const raw = await readFile(path.join(dir, "pid"), "utf8").catch(() => "");
  const pid = Number.parseInt(raw.trim(), 10);
  return { held: true, pid: Number.isInteger(pid) && pid > 0 ? pid : null };
}

/** `kill -0`. EPERM은 남의 프로세스지만 **살아 있다**는 뜻이다. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ponytail: 테넌트마다 한 번 부른다(테넌트는 한 자릿수). 캐시하면 사람이 crontab을 고친 걸
// GUI가 못 보므로, 느려지면 요청 단위 캐시를 넣는다.
async function crontabText(): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // crontab 없음·비어 있음 = 등록된 워커 없음
  }
}

/** 테넌트의 워커 전부. 이름 순.
 *
 *  | status | 판정 |
 *  |---|---|
 *  | running | 락 있음 + pid 생존 |
 *  | stale | 락 있음 + pid 죽음(또는 pid 파일이 없다 — tick.sh도 이걸 회수 대상으로 본다) |
 *  | idle | 락 없음 + crontab 등록됨 |
 *  | stopped | 락 없음 + crontab 미등록 | */
export async function listWorkers(root: string): Promise<Worker[]> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".sh"))
    .sort();
  if (names.length === 0) return [];

  const cron = await crontabText();
  const out: Worker[] = [];
  for (const file of names) {
    const name = file.slice(0, -3);
    const full = path.join(dir, file);
    const { held, pid } = await lockOf(lockPath(dir, name));
    out.push({
      name,
      path: full,
      // crontab 한 줄은 인용부호가 붙기도 하므로 절대경로 부분일치로 본다(제약 4: 읽기 전용).
      status: held ? (pid && alive(pid) ? "running" : "stale") : cron.includes(full) ? "idle" : "stopped",
      lockPid: pid,
    });
  }
  return out;
}

/** `running 1 / idle 1` — 0인 종류는 뺀다. 워커 0개면 `—`(DESIGN.md §7 목록 행). */
export function workerSummary(workers: Worker[]): string {
  const order: WorkerStatus[] = ["running", "stale", "idle", "stopped"];
  const parts = order
    .map((s) => [s, workers.filter((w) => w.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`);
  return parts.length ? parts.join(" / ") : "—";
}
