// P487-2 이기적 모드 서버. 판정은 selfish-mode.ts, 여기는 파일과 osascript 부작용이다.
import { execFile } from "node:child_process";
import { appendFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "./paths.ts";
import { readProjects } from "./projects.ts";
import { writeSessionLimit } from "./session-cap.ts";
import { isValidWhen } from "./urls.ts";
import {
  buildReport, filterQuitTargets, judgeSelfish, parseSelfishConfig, type SelfishConfig, type SelfishReport,
} from "./selfish-mode.ts";

/** `osascript -e <script>`의 stdout. 테스트가 가짜를 넣는다. */
export type OsaRunner = (script: string, timeoutMs: number) => Promise<string>;

export const realRunner: OsaRunner = (script, timeoutMs) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script], { timeout: timeoutMs }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  );

const LIST_SCRIPT =
  'tell application "System Events" to get name of every application process whose background only is false';
export const QUIT_TIMEOUT_MS = 10_000;

const cfgPath = () => path.join(localDir(), "selfish.json");
const logPath = () => path.join(localDir(), "selfish-log.jsonl");
const limitPath = () => path.join(localDir(), "session-limit");

export async function readSelfish(): Promise<SelfishConfig> {
  return parseSelfishConfig(await readFile(cfgPath(), "utf8").catch(() => null));
}

async function writeSelfish(cfg: SelfishConfig): Promise<void> {
  const tmp = `${cfgPath()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  await rename(tmp, cfgPath());
}

export async function listApps(run: OsaRunner): Promise<string[]> {
  return (await run(LIST_SCRIPT, 15_000)).split(",").map((s) => s.trim()).filter(Boolean);
}

/** 권한 확인: 목록 조회 한 번. 거절되면 사유 글자를 돌려준다. */
export async function checkPermission(run: OsaRunner = realRunner): Promise<{ ok: boolean; error?: string }> {
  try {
    await listApps(run);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type SelfishDeps = {
  run?: OsaRunner;
  quitTimeoutMs?: number;
  pollMs?: number;
  /** 등록 프로젝트의 runner.log 읽기. 기본은 gui-projects.json의 root 아래. */
  readLogs?: () => Promise<{ project: string; text: string }[]>;
};

async function defaultLogs() {
  const projects = await readProjects();
  return Promise.all(
    projects.map(async (p) => ({
      project: p.name,
      text: await readFile(path.join(p.root, "workers", "runner.log"), "utf8").catch(() => ""),
    })),
  );
}

/** 켜기. 강제 종료는 없다: `quit app` 뒤 timeout 안에 목록에서 안 사라지면 `left`에 적고 둔다. */
export async function startSelfish(
  opts: { now?: number; until?: number | null } = {},
  deps: SelfishDeps = {},
): Promise<SelfishConfig> {
  const run = deps.run ?? realRunner;
  const timeout = deps.quitTimeoutMs ?? QUIT_TIMEOUT_MS;
  const poll = deps.pollMs ?? 500;
  const cfg = await readSelfish();
  if (cfg.active) return cfg;
  const now = opts.now ?? Date.now();
  const targets = filterQuitTargets(await listApps(run), cfg.exclude);
  const savedLimit = (await readFile(limitPath(), "utf8").catch(() => null))?.trim() ?? null;
  const quit: string[] = [];
  const left: string[] = [];
  await Promise.all(
    targets.map(async (name) => {
      await run(`quit app "${name.replace(/["\\]/g, "\\$&")}"`, timeout).catch(() => {});
      const end = Date.now() + timeout;
      let gone = false;
      for (;;) {
        gone = !(await listApps(run).catch(() => [name])).includes(name);
        if (gone || Date.now() >= end) break;
        await new Promise((r) => setTimeout(r, poll));
      }
      (gone ? quit : left).push(name);
    }),
  );
  if (cfg.cap !== null) await writeSessionLimit(cfg.cap);
  const next: SelfishConfig = {
    ...cfg,
    active: {
      since: new Date(now).toISOString(),
      until: opts.until != null ? new Date(opts.until).toISOString() : null,
      saved_limit: savedLimit,
      cap: cfg.cap,
      quit: quit.sort(),
      left: left.sort(),
    },
  };
  await writeSelfish(next);
  return next;
}

/** 끄기: 상한 복원, 보고 한 줄 기록, active 비우기. 앱은 다시 안 띄운다. */
export async function stopSelfish(
  opts: { now?: number } = {},
  deps: SelfishDeps = {},
): Promise<SelfishReport | null> {
  const cfg = await readSelfish();
  const a = cfg.active;
  if (!a) return null;
  if (a.cap !== null) {
    if (a.saved_limit === null) await rm(limitPath(), { force: true });
    else await writeSessionLimit(Number(a.saved_limit)).catch(() => {});
  }
  const report = buildReport(a, new Date(opts.now ?? Date.now()).toISOString(), await (deps.readLogs ?? defaultLogs)());
  await appendFile(logPath(), JSON.stringify(report) + "\n", "utf8");
  await writeSelfish({ ...cfg, active: null });
  return report;
}

/** 하트비트 한 박. `until`이 지났으면 끄고, 예약 판정이 start/end를 내면 따른다. */
export async function selfishHeartbeat(nowMs: number, deps: SelfishDeps = {}): Promise<void> {
  let cfg = await readSelfish();
  if (cfg.active?.until && Date.parse(cfg.active.until) <= nowMs) {
    await stopSelfish({ now: nowMs }, deps);
    cfg = await readSelfish();
  }
  if (!cfg.schedule) return;
  const created = (await stat(cfgPath()).catch(() => null))?.mtimeMs ?? nowMs;
  const d = judgeSelfish(cfg, nowMs, created);
  if (d.startDue === null && d.endDue === null) return;
  // 회차를 먼저 기록한다: 켜기가 10초 넘게 걸려도 다음 박이 같은 회차를 또 돌리지 않는다.
  await writeSelfish({
    ...cfg,
    last_start_due: d.startDue ?? cfg.last_start_due,
    last_end_due: d.endDue ?? cfg.last_end_due,
  });
  if (d.action === "start") await startSelfish({ now: nowMs }, deps);
  else if (d.action === "end") await stopSelfish({ now: nowMs }, deps);
}

/** 지금 켜면 내려갈 앱 목록(미리보기). 첫 호출이 macOS 자동화 권한 창을 띄운다. */
export async function previewTargets(run: OsaRunner = realRunner): Promise<{ ok: boolean; targets: string[]; error?: string }> {
  try {
    return { ok: true, targets: filterQuitTargets(await listApps(run), (await readSelfish()).exclude) };
  } catch (e) {
    return { ok: false, targets: [], error: (e as Error).message };
  }
}

export type SelfishSettingsInput = { schedule: { start: string; end: string } | null; cap: number | null; exclude: string[] };

/** 설정 저장. 예약이 있으면 권한 확인이 먼저고, 거절되면 아무것도 저장하지 않는다. */
export async function saveSelfishSettings(
  input: SelfishSettingsInput,
  run: OsaRunner = realRunner,
  nowMs: number = Date.now(),
): Promise<{ ok: boolean; error?: string }> {
  const { schedule, cap, exclude } = input;
  if (schedule && !(isValidWhen(schedule.start) && isValidWhen(schedule.end))) return { ok: false, error: "invalid schedule" };
  if (cap !== null && !(Number.isInteger(cap) && cap >= 0)) return { ok: false, error: "invalid cap" };
  if (!exclude.every((n) => typeof n === "string")) return { ok: false, error: "invalid exclude" };
  if (schedule) {
    const perm = await checkPermission(run);
    if (!perm.ok) return perm;
  }
  const cfg = await readSelfish();
  const changed = JSON.stringify(cfg.schedule) !== JSON.stringify(schedule);
  // 예약이 새로 생기거나 바뀌면 그 시점이 기준이다: 저장 전에 지난 회차가 소급해서 돌지 않는다.
  await writeSelfish({
    ...cfg,
    schedule,
    cap,
    exclude: exclude.map((n) => n.trim()).filter(Boolean),
    last_start_due: changed ? nowMs : cfg.last_start_due,
    last_end_due: changed ? nowMs : cfg.last_end_due,
  });
  return { ok: true };
}

export async function readLastRun(): Promise<SelfishReport | null> {
  const text = await readFile(logPath(), "utf8").catch(() => "");
  const last = text.trim().split("\n").pop();
  try {
    return last ? (JSON.parse(last) as SelfishReport) : null;
  } catch {
    return null;
  }
}
