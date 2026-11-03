/** 비상정지 서버 (DESIGN.md P545). 상태 파일 하나(`<localDir()>/emergency-stop.json`)가 판정이다.
 *
 *  켜기는 **순서가 계약이다**(결정 3): 상태 파일 -> crontab 한 번의 쓰기 -> 세션 kill -> unassign ->
 *  브라우저 kill. 파일이 먼저인 이유는 이후 단계 사이에 화면이 `kick`으로 새 세션을 띄우지 못하게
 *  하려는 것이다. 한 항목이 실패해도 나머지를 계속하고 실패는 결과에 적는다.
 *
 *  crontab 읽기-쓰기, kill, unassign, kick은 `Deps`로 주입한다 - 테스트가 진짜 crontab과 진짜 세션을
 *  밟지 않는다. 기본값은 지연 import다(`workers.ts`가 게이트 때문에 이 파일을 부르므로 순환을 피한다). */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { localDir } from "./paths.ts";
import { alive, cronRegister, cronUnregister } from "./workers.ts";

type State = { on: true; at: string; workers: string[] };

const stateFile = () => path.join(localDir(), "emergency-stop.json");

function parseState(raw: string): State | null {
  try {
    const j = JSON.parse(raw) as Partial<State>;
    if (j.on !== true) return null;
    const workers = Array.isArray(j.workers) ? j.workers.filter((w): w is string => typeof w === "string") : [];
    return { on: true, at: typeof j.at === "string" ? j.at : "", workers };
  } catch {
    return null; // ponytail: 깨진 파일은 꺼짐으로 본다. 쓰기는 rename이라 반쯤 쓴 파일은 안 생긴다
  }
}

/** 동기다 - `kick.ts`의 `launch`가 동기라서. 파일이 없거나 `on`이 true가 아니면 null이다. */
export function emergencyState(): State | null {
  try {
    return parseState(readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

export const emergencyOn = () => emergencyState() !== null;

// ponytail: 한국어 한 벌. 한-영 문구는 P545-2가 i18n에 넣는다.
export const EMERGENCY_REFUSAL = "비상정지 중입니다. 끄기 전에는 워커를 만들거나 다시 등록할 수 없습니다.";

export type Failure = { item: string; reason: string };
export type EnableResult = {
  alreadyOn: boolean;
  at: string;
  workersRemoved: number;
  sessionsKilled: number;
  backlog: string[];
  browsersKilled: number;
  failures: Failure[];
};
export type DisableResult = { restored: number; skippedMissing: number; kicked: number; failures: Failure[] };

/** 켤 때 훑는 워커 한 개 - `Worker`의 부분집합이다(테스트가 같은 모양을 만든다). */
export type StopTarget = { root: string; path: string; effName: string; cron: boolean; lockPid: number | null; holding: string | null };

export type Deps = {
  targets: () => Promise<StopTarget[]>;
  roots: () => Promise<string[]>;
  readCrontab: () => Promise<string>;
  writeCrontab: (text: string) => Promise<void>;
  /** 음수 pid는 프로세스 그룹이다(`process.kill`과 같다). */
  kill: (pid: number, sig: "SIGTERM" | "SIGKILL") => void;
  alive: (pid: number) => boolean;
  unassign: (root: string, stem: string) => Promise<{ ok: boolean; output: string }>;
  kick: (root: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  /** 브라우저 풀 슬롯의 pgid 파일들. */
  poolPgids: () => Promise<number[]>;
  termWaitMs: number;
};

/** 텍스트 -> 텍스트. 워커 줄이 아닌 줄(`reaper.sh`, 사람의 잡)은 바이트 그대로다. */
export const cronUnregisterAll = (text: string, workerPaths: string[]) =>
  workerPaths.reduce((acc, p) => cronUnregister(acc, p), text);
export const cronRegisterAll = (text: string, workerPaths: string[]) =>
  workerPaths.reduce((acc, p) => cronRegister(acc, p), text);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const validPid = (n: number) => Number.isInteger(n) && n > 1;

async function defaultDeps(): Promise<Deps> {
  const { readProjects, resolveConfig } = await import("./projects.ts");
  const { listWorkers } = await import("./workers.ts");
  const { unassign } = await import("./engine.ts");
  const { kickIdleWorker } = await import("./kick.ts");
  const { listTickets } = await import("./queue.ts");
  const run = promisify(execFile);
  return {
    roots: async () => (await readProjects()).map((p) => p.root),
    targets: async () => {
      const out: StopTarget[] = [];
      for (const p of await readProjects()) {
        for (const w of await listWorkers(p.root, await listTickets(p.root, await resolveConfig(p)))) {
          out.push({ root: p.root, path: w.path, effName: w.effName, cron: w.cron, lockPid: w.lockPid, holding: w.holding });
        }
      }
      return out;
    },
    readCrontab: async () => {
      try {
        return (await run("crontab", ["-l"])).stdout;
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        if (!err.stdout && /no crontab for/i.test(err.stderr ?? "")) return "";
        throw e;
      }
    },
    writeCrontab: (text) =>
      new Promise<void>((resolve, reject) => {
        const c = execFile("crontab", ["-"], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
        c.stdin!.end(text);
      }),
    kill: (pid, sig) => process.kill(pid, sig),
    alive,
    unassign: async (root, stem) => unassign(root, stem),
    kick: kickIdleWorker,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    poolPgids: async () => {
      const dir = path.join(localDir(), "browser-pool");
      const out: number[] = [];
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory()) continue;
        const raw = await readFile(path.join(dir, e.name, "pgid"), "utf8").catch(() => "");
        out.push(Number.parseInt(raw.trim(), 10));
      }
      return out;
    },
    termWaitMs: 10000,
  };
}

async function writeState(s: State): Promise<void> {
  const f = stateFile();
  await mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s), { flag: "wx" });
  await rename(tmp, f);
}

/** 그룹 kill을 먼저, 그룹이 없으면(리더가 아니면) 그 pid 하나를 쏜다. */
function killTree(d: Deps, pid: number, sig: "SIGTERM" | "SIGKILL"): void {
  try {
    d.kill(-pid, sig);
  } catch {
    d.kill(pid, sig);
  }
}

export async function enableEmergencyStop(inject?: Partial<Deps>): Promise<EnableResult> {
  const prior = emergencyState();
  const res: EnableResult = {
    alreadyOn: prior !== null,
    at: prior?.at ?? "",
    workersRemoved: 0,
    sessionsKilled: 0,
    backlog: [],
    browsersKilled: 0,
    failures: [],
  };
  // 이미 켜져 있으면 다시 훑지 않는다 - 지금 crontab은 비어 있어 `workers`를 덮어쓰면 끄기가 되살릴 것을 잃는다.
  if (prior) return res;
  const d: Deps = { ...(await defaultDeps()), ...inject };
  const fail = (item: string, e: unknown) => res.failures.push({ item, reason: msg(e) });

  const targets = await d.targets();
  const registered = targets.filter((t) => t.cron).map((t) => t.path);
  // 3-1. 상태 파일이 먼저다. 이것을 못 쓰면 정지가 성립하지 않으므로 여기서만 중단한다.
  res.at = new Date().toISOString();
  await writeState({ on: true, at: res.at, workers: registered });

  // 3-2. crontab 한 번의 쓰기
  try {
    const before = await d.readCrontab();
    const next = cronUnregisterAll(before, registered);
    if (next !== before) await d.writeCrontab(next);
    res.workersRemoved = registered.length;
  } catch (e) {
    fail("crontab", e);
  }

  // 3-3. 세션 kill - 락이 잡혀 있고 pid가 살아 있는 워커
  const killed: StopTarget[] = [];
  const live = targets.filter((t) => t.lockPid !== null && validPid(t.lockPid) && d.alive(t.lockPid));
  for (const t of live) {
    try {
      killTree(d, t.lockPid!, "SIGTERM");
      killed.push(t);
    } catch (e) {
      fail(`session ${t.effName}`, e);
    }
  }
  for (let waited = 0; waited < d.termWaitMs && killed.some((t) => d.alive(t.lockPid!)); waited += 200) await d.sleep(200);
  for (const t of killed) {
    if (!d.alive(t.lockPid!)) continue;
    try {
      killTree(d, t.lockPid!, "SIGKILL");
    } catch (e) {
      fail(`session ${t.effName}`, e);
    }
  }
  res.sessionsKilled = killed.length;

  // 3-4. 끝낸 세션이 물고 있던 .wip를 백로그로 - `--force` 없이, kick 없이
  for (const t of killed) {
    if (!t.holding) continue;
    try {
      const r = await d.unassign(t.root, t.holding);
      if (r.ok) res.backlog.push(t.holding);
      else fail(`unassign ${t.holding}`, r.output);
    } catch (e) {
      fail(`unassign ${t.holding}`, e);
    }
  }

  // 3-5. 브라우저 풀 슬롯
  try {
    for (const pgid of new Set(await d.poolPgids())) {
      if (!validPid(pgid) || pgid === process.pid) continue;
      try {
        d.kill(-pgid, "SIGTERM");
        res.browsersKilled++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") fail(`browser ${pgid}`, e);
      }
    }
  } catch (e) {
    fail("browser-pool", e);
  }
  return res;
}

export async function disableEmergencyStop(inject?: Partial<Deps>): Promise<DisableResult> {
  const res: DisableResult = { restored: 0, skippedMissing: 0, kicked: 0, failures: [] };
  const state = emergencyState();
  if (!state) return res;
  const d: Deps = { ...(await defaultDeps()), ...inject };
  const present = state.workers.filter((w) => existsSync(w));
  res.skippedMissing = state.workers.length - present.length;
  try {
    const before = await d.readCrontab();
    const next = cronRegisterAll(before, present);
    if (next !== before) await d.writeCrontab(next);
    res.restored = present.length;
  } catch (e) {
    // 되살리지 못했으면 상태 파일을 남긴다 - 지우면 이 목록이 사라져 다시 시도할 수 없다.
    res.failures.push({ item: "crontab", reason: msg(e) });
    return res;
  }
  await unlink(stateFile()).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") res.failures.push({ item: "state", reason: msg(e) });
  });
  for (const root of await d.roots()) {
    if (await d.kick(root).catch(() => false)) res.kicked++;
  }
  return res;
}
