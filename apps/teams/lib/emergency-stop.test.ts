import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira`와 진짜 crontab을 밟지 않는다 - import 전에 건다.
const TMP = mkdtempSync(path.join(tmpdir(), "emergency-stop-"));
const LOCAL = path.join(TMP, "local");
mkdirSync(LOCAL, { recursive: true });
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const es = await import("./emergency-stop.ts");
const { cronLine } = await import("./workers.ts");
const STATE = path.join(LOCAL, "emergency-stop.json");

const worker = (n: string) => {
  const p = path.join(TMP, "root", "workers", `${n}.sh`);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "#!/bin/bash\n");
  return p;
};
const W = ["w1", "w2", "w3"].map(worker);
const HUMAN = "0 9 * * 1 /usr/local/bin/backup.sh   # 사람 줄\n";
const REAPER = "* * * * * /Users/x/.dira/reaper.sh >> /tmp/r.log 2>&1\n";
const cron = () => W.map((p) => `${cronLine({ path: p })}\n`).join("") + REAPER + HUMAN;

test("수용조건 1 - 일괄 해제는 워커 줄만 빼고 나머지 바이트가 같다, 재등록은 워커 줄을 되돌린다", () => {
  const text = cron();
  const off = es.cronUnregisterAll(text, W);
  assert.strictEqual(off, REAPER + HUMAN);
  const on = es.cronRegisterAll(off, W);
  for (const p of W) for (const line of cronLine({ path: p }).split("\n")) assert.ok(on.split("\n").includes(line));
  assert.ok(on.includes(REAPER) && on.includes(HUMAN));
});

function fakes(calls: string[], cronText: string) {
  let cur = cronText;
  const pids = new Set([4242]);
  return {
    cur: () => cur,
    deps: {
      targets: async () => [
        { root: "/q", path: W[0], effName: "w1", cron: true, lockPid: 4242, holding: "abcd1234" },
        { root: "/q", path: W[1], effName: "w2", cron: true, lockPid: null, holding: null },
        { root: "/q", path: W[2], effName: "w3", cron: true, lockPid: null, holding: null },
      ],
      roots: async () => ["/q"],
      readCrontab: async () => cur,
      writeCrontab: async (t: string) => {
        calls.push(`crontab-write:${existsSync(STATE) ? "state-first" : "NO-STATE"}`);
        cur = t;
      },
      kill: (pid: number, sig: string) => {
        calls.push(`kill:${pid}:${sig}`);
        if (pid === -4242 && sig === "SIGTERM") pids.delete(4242);
      },
      alive: (pid: number) => pids.has(pid),
      unassign: async (_r: string, stem: string, ...rest: unknown[]) => {
        calls.push(`unassign:${stem}:${rest.length === 0 ? "no-force" : "FORCE"}`);
        return { ok: true, output: "" };
      },
      kick: async () => {
        calls.push("kick");
        return true;
      },
      sleep: async () => {},
      poolPgids: async () => [9001],
      termWaitMs: 400,
    },
  };
}

test("수용조건 2 - 켜기 순서: 상태 파일 -> crontab 1회 -> 세션 kill -> unassign(--force 없음) -> 브라우저 kill, kick 0회", async () => {
  const calls: string[] = [];
  const f = fakes(calls, cron());
  const r = await es.enableEmergencyStop(f.deps);
  assert.deepStrictEqual(calls, [
    "crontab-write:state-first",
    "kill:-4242:SIGTERM",
    "unassign:abcd1234:no-force",
    "kill:-9001:SIGTERM",
  ]);
  assert.ok(!calls.includes("kick"));
  assert.strictEqual(f.cur(), REAPER + HUMAN);
  assert.deepStrictEqual(
    { w: r.workersRemoved, s: r.sessionsKilled, b: r.backlog, br: r.browsersKilled, f: r.failures },
    { w: 3, s: 1, b: ["abcd1234"], br: 1, f: [] },
  );
  assert.deepStrictEqual(JSON.parse(readFileSync(STATE, "utf8")).workers, W);
  // 켜져 있는 동안 다시 켜도 훑지 않는다
  const again = await es.enableEmergencyStop(f.deps);
  assert.strictEqual(again.alreadyOn, true);
  assert.strictEqual(calls.length, 4);
});

test("수용조건 3 - 상태 파일 on이면 kickIdleWorker는 false이고 자식이 안 뜬다, 지우면 true", async () => {
  const root = path.join(TMP, "kickroot");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  const py = path.join(TMP, "fake-dispatch.py");
  writeFileSync(py, "import sys,pathlib\npathlib.Path(sys.argv[2], 'ran').write_text('x')\n");
  process.env.DIRA_DISPATCH_PY = py;
  const { kickIdleWorker } = await import("./kick.ts");
  assert.ok(existsSync(STATE)); // 앞 테스트가 켠 상태
  assert.strictEqual(await kickIdleWorker(root), false);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(!existsSync(path.join(root, "ran")));
  rmSync(STATE);
  assert.strictEqual(await kickIdleWorker(root), true);
  for (let i = 0; i < 30 && !existsSync(path.join(root, "ran")); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(path.join(root, "ran")));
});

test("수용조건 4 - 끄기는 지금도 파일이 있는 워커만 다시 넣고 상태 파일을 지운다", async () => {
  const calls: string[] = [];
  const f = fakes(calls, cron());
  await es.enableEmergencyStop({ ...f.deps, poolPgids: async () => [] });
  rmSync(W[1]); // 켠 사이 워커 하나가 지워졌다
  const r = await es.disableEmergencyStop(f.deps);
  assert.deepStrictEqual({ r: r.restored, s: r.skippedMissing, k: r.kicked, f: r.failures }, { r: 2, s: 1, k: 1, f: [] });
  const lines = f.cur().split("\n");
  for (const p of [W[0], W[2]]) for (const l of cronLine({ path: p }).split("\n")) assert.ok(lines.includes(l));
  assert.ok(!f.cur().includes(W[1]));
  assert.ok(!existsSync(STATE));
});

test("워커 생성-재등록은 비상정지 중 거부된다", async () => {
  writeFileSync(STATE, JSON.stringify({ on: true, at: "x", workers: [] }));
  const { createWorker, registerCron } = await import("./workers.ts");
  await assert.rejects(createWorker(path.join(TMP, "root"), "wx"), /비상정지/);
  await assert.rejects(registerCron(W[0]), /비상정지/);
  assert.ok(!existsSync(path.join(TMP, "root", "workers", "wx.sh")));
  rmSync(STATE);
});
