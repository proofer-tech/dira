import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSelfish, selfishHeartbeat, startSelfish, stopSelfish, type OsaRunner } from "./selfish-server.ts";

async function setup(files: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "selfish-"));
  process.env.TICKET_LOCAL = dir;
  for (const [k, v] of Object.entries(files)) await writeFile(path.join(dir, k), v);
  return dir;
}
const read = (p: string) => readFile(p, "utf8").catch(() => null);
const noLogs = { readLogs: async () => [], quitTimeoutMs: 200, pollMs: 20 };

function fake(apps: string[], stuck: string[] = []) {
  const quits: string[] = [];
  const run: OsaRunner = async (script) => {
    const m = /^quit app "(.*)"$/.exec(script);
    if (m) {
      quits.push(m[1]!);
      if (!stuck.includes(m[1]!)) apps = apps.filter((a) => a !== m[1]);
      return "";
    }
    return apps.join(", ");
  };
  return { run, quits };
}

test("켜기: 제외 목록 밖 이름에만 quit이 가고 안 내려간 이름은 left에 남는다", async () => {
  await setup();
  const f = fake(["Finder", "Slack", "Foo VPN", "Stuck", "Safari"], ["Stuck"]);
  const cfg = await startSelfish({}, { ...noLogs, run: f.run });
  assert.deepEqual(f.quits.sort(), ["Safari", "Slack", "Stuck"]);
  assert.deepEqual(cfg.active!.quit, ["Safari", "Slack"]);
  assert.deepEqual(cfg.active!.left, ["Stuck"]);
});

test("cap 9: session-limit이 9를 거쳐 원래 값 / 없음으로 돌아온다, null이면 안 바뀐다", async () => {
  const dir = await setup({ "session-limit": "4\n", "selfish.json": JSON.stringify({ cap: 9 }) });
  const f = fake([]);
  await startSelfish({}, { ...noLogs, run: f.run });
  assert.equal((await read(path.join(dir, "session-limit")))?.trim(), "9");
  await stopSelfish({}, noLogs);
  assert.equal((await read(path.join(dir, "session-limit")))?.trim(), "4");

  const dir2 = await setup({ "selfish.json": JSON.stringify({ cap: 9 }) });
  await startSelfish({}, { ...noLogs, run: f.run });
  assert.equal((await read(path.join(dir2, "session-limit")))?.trim(), "9");
  await stopSelfish({}, noLogs);
  assert.equal(await read(path.join(dir2, "session-limit")), null);

  const dir3 = await setup({ "session-limit": "5\n" });
  await startSelfish({}, { ...noLogs, run: f.run });
  assert.equal((await read(path.join(dir3, "session-limit")))?.trim(), "5");
  await stopSelfish({}, noLogs);
  assert.equal((await read(path.join(dir3, "session-limit")))?.trim(), "5");
});

test("until이 지난 active는 하트비트 한 번에 꺼지고 selfish-log.jsonl이 한 줄 는다", async () => {
  const now = Date.now();
  const dir = await setup({
    "selfish.json": JSON.stringify({
      active: { since: new Date(now - 3_600_000).toISOString(), until: new Date(now - 1000).toISOString(), saved_limit: null, cap: null, quit: ["Slack"], left: [] },
    }),
  });
  await selfishHeartbeat(now, noLogs);
  assert.equal((await readSelfish()).active, null);
  const lines = (await read(path.join(dir, "selfish-log.jsonl")))!.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!).quit, ["Slack"]);
});

test("예약 저장은 권한 확인이 먼저고, 거절되면 저장되지 않는다", async () => {
  const dir = await setup();
  const { saveSelfishSettings } = await import("./selfish-server.ts");
  const deny: OsaRunner = async () => {
    throw new Error("Not authorized to send Apple events (-1743)");
  };
  const r = await saveSelfishSettings({ schedule: { start: "0 23 * * *", end: "0 7 * * *" }, cap: null, exclude: [] }, deny);
  assert.equal(r.ok, false);
  assert.match(r.error!, /-1743/);
  assert.equal(await read(path.join(dir, "selfish.json")), null);
  const ok = await saveSelfishSettings({ schedule: { start: "0 23 * * *", end: "0 7 * * *" }, cap: 3, exclude: ["Foo"] }, fake([]).run, 1000);
  assert.equal(ok.ok, true);
  const cfg = await readSelfish();
  assert.equal(cfg.cap, 3);
  assert.equal(cfg.last_start_due, 1000);
});
