/** `mcp-keepalive.sh` - 임시 HOME + PATH 앞의 가짜 crontab으로 진짜 bash를 돌려 세 갈래를 밟는다. */
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "mcp-keepalive.sh");
const repo = join(here, "..", "..");

function setup(tab: string | null) {
  const home = mkdtempSync(join(tmpdir(), "kal-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const store = join(home, "crontab.txt");
  if (tab !== null) writeFileSync(store, tab);
  writeFileSync(
    join(bin, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then [ -f "${store}" ] && cat "${store}" || exit 1; else cat > "${store}"; fi\n`,
  );
  chmodSync(join(bin, "crontab"), 0o755);
  const engine = join(home, "engine");
  mkdirSync(engine);
  for (const f of ["mcp_server.py", "mcp_tools.py", "tickets.py", "tick.sh"]) cpSync(join(repo, f), join(engine, f));
  // 가짜 mdfind: mdfind.out을 그대로 낸다
  writeFileSync(join(bin, "mdfind"), `#!/bin/sh\n[ -f "${home}/mdfind.out" ] && cat "${home}/mdfind.out"; exit 0\n`);
  chmodSync(join(bin, "mdfind"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, DIRA_APPS_DIR: join(home, "SysApps") };
  const json = join(home, ".config/dira/run/mcp.json");
  const run = (arg: string, app?: string) => {
    const r = spawnSync("bash", app === undefined ? [script, arg] : [script, arg, app], { env, encoding: "utf8", timeout: 30_000 });
    // 서버 stderr는 임시 HOME의 mcp.log에만 남는다 - 실패하면 CI 로그에 꺼내 둔다
    if (r.status !== 0) {
      const log = join(home, ".config/dira/run/mcp.log");
      const ps = spawnSync("ps", ["-axo", "pid,ppid,stat,etime,command"], { encoding: "utf8" }).stdout;
      console.error(
        `keepalive exit=${r.status} signal=${r.signal}\nstderr:\n${r.stderr}\nmcp.log:\n${existsSync(log) ? readFileSync(log, "utf8") : "(없음)"}\nps:\n${ps.split("\n").filter((l) => /mcp_server|nohup|setsid/.test(l)).join("\n")}`,
      );
    }
    return r;
  };
  const read = () => JSON.parse(readFileSync(json, "utf8"));
  const kill = () => {
    try {
      process.kill(read().pid, "SIGTERM");
    } catch {}
  };
  return { home, store, engine, tick: join(engine, "tick.sh"), run, json, read, kill };
}

async function toolsList(url: string, token: string) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  return r.status;
}

test("죽어 있으면 띄우고 살아 있으면 안 건드린다 - 두 번 띄워도 url-token이 같다", async () => {
  const s = setup("* * * * * x\n");
  try {
    assert.equal(s.run(s.tick).status, 0);
    const a = s.read();
    assert.equal(statSync(s.json).mode & 0o777, 0o600);
    assert.equal(await toolsList(a.url, a.token), 200);
    assert.equal(a.token.length, 64);

    const before = readFileSync(s.json, "utf8");
    const mt = statSync(s.json).mtimeMs;
    assert.equal(s.run(s.tick).status, 0);
    assert.equal(readFileSync(s.json, "utf8"), before);
    assert.equal(statSync(s.json).mtimeMs, mt);
    assert.equal(readFileSync(s.store, "utf8"), "* * * * * x\n");

    // 서버를 죽이고 다시 띄운다: 새 pid, 같은 token, 포트가 비어 있었으면 같은 url
    process.kill(a.pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(s.run(s.tick).status, 0);
    const b = s.read();
    assert.notEqual(b.pid, a.pid);
    assert.equal(b.token, a.token);
    if (a.url.endsWith(":47823/mcp")) assert.equal(b.url, a.url);
    assert.equal(await toolsList(b.url, b.token), 200);
  } finally {
    s.kill();
  }
});

test("엔진이 없으면 서버-mcp.json-mcp 디렉터리-keepalive 줄이 사라지고 남의 줄은 바이트 그대로", async () => {
  const other = "# 메모\n\n*/5 * * * * echo \"/x/w1.sh\"\n0 3 * * * echo  '남의   줄'\n";
  const mine = `* * * * * "/h/.config/dira/mcp/keepalive.sh" "/e/tick.sh" >> /h/mcp.log 2>&1\n`;
  const s = setup(other + mine);
  try {
    assert.equal(s.run(s.tick).status, 0);
    const { pid } = s.read();
    assert.ok(existsSync(join(s.home, ".config/dira/mcp")));
    const r = s.run(join(s.home, "없는엔진/tick.sh"));
    assert.equal(r.status, 0);
    await new Promise((x) => setTimeout(x, 300));
    assert.throws(() => process.kill(pid, 0));
    assert.ok(!existsSync(s.json));
    assert.ok(!existsSync(join(s.home, ".config/dira/mcp")));
    assert.equal(readFileSync(s.store, "utf8").trimEnd(), other.trimEnd());
  } finally {
    s.kill();
  }
});

test("인자가 빈 문자열이면 아무것도 안 뺀다", () => {
  const tab = `* * * * * "/h/.config/dira/mcp/keepalive.sh" "/e/tick.sh"\n`;
  const s = setup(tab);
  mkdirSync(join(s.home, ".config/dira/mcp"), { recursive: true });
  assert.equal(s.run("").status, 0);
  assert.equal(readFileSync(s.store, "utf8"), tab);
  assert.ok(existsSync(join(s.home, ".config/dira/mcp")));
  assert.ok(!existsSync(s.json));
});

// ---- P570: 앱 삭제 판정과 정리 ----
function p570() {
  const s = setup(null);
  const edir = s.engine;
  const w1 = join(s.home, "ws/workers/w1.sh"); // 이 엔진을 source한다
  const w2 = join(s.home, "ws/workers/w2.sh"); // 다른 엔진
  mkdirSync(dirname(w1), { recursive: true });
  writeFileSync(w1, `source "${edir}/tick.sh"\n`);
  writeFileSync(w2, `source "/다른/엔진/tick.sh"\n`);
  const keep = `# dira-worker "${w2}"\n0 3 * * * echo  '남의   줄'\n`;
  const gone = [
    `* * * * * "/h/.config/dira/mcp/keepalive.sh" "${s.tick}" "/없는/dira.app" >> /h/mcp.log 2>&1\n`,
    `* * * * * python3 "${edir}/dispatch.py" sweep >> /h/sweep.log 2>&1\n`,
    `# dira-worker "${w1}"\n`,
  ];
  const tab = gone.join("") + keep;
  writeFileSync(s.store, tab);
  const run = join(s.home, ".config/dira/run");
  const missing = join(run, "app-missing");
  const app = join(s.home, "없는/dira.app");
  const backdate = () => writeFileSync(missing, String(Math.floor(Date.now() / 1000) - 660));
  return { s, tab, keep, gone, run, missing, app, backdate, edir };
}

test("P570 1: 앱이 없어도 10분 유예, 지나면 줄 셋이 빠지고 남의 줄은 그대로, 뺀 줄은 기록된다", () => {
  const t = p570();
  assert.equal(t.s.run(t.s.tick, t.app).status, 0);
  assert.equal(readFileSync(t.s.store, "utf8"), t.tab);
  assert.ok(existsSync(t.missing));
  t.backdate();
  assert.equal(t.s.run(t.s.tick, t.app).status, 0);
  assert.equal(readFileSync(t.s.store, "utf8"), t.keep);
  assert.equal(readFileSync(join(t.run, "uninstalled.crontab"), "utf8"), t.gone.join(""));
  assert.ok(!existsSync(t.missing));
});

test("P570 2: 휴지통 경로는 삭제로 보고 다른 경로는 삭제로 보지 않고 app-missing을 지운다", () => {
  const t = p570();
  writeFileSync(join(t.s.home, "mdfind.out"), join(t.s.home, ".Trash/dira.app") + "\n");
  t.s.run(t.s.tick, t.app);
  assert.ok(existsSync(t.missing));
  t.backdate();
  t.s.run(t.s.tick, t.app);
  assert.equal(readFileSync(t.s.store, "utf8"), t.keep);

  const u = p570();
  u.s.run(u.s.tick, u.app);
  assert.ok(existsSync(u.missing));
  writeFileSync(join(u.s.home, "mdfind.out"), "/Users/x/Desktop/dira.app\n");
  u.s.run(u.s.tick, u.app);
  assert.ok(!existsSync(u.missing));
  assert.equal(readFileSync(u.s.store, "utf8"), u.tab);
});

test("P570 3: 엔진이 없으면 유예 없이 정리하고, 첫째 인자가 비거나 crontab -l이 실패하면 쓰지 않는다", () => {
  const t = p570();
  rmSync(t.s.tick);
  assert.equal(t.s.run(t.s.tick).status, 0);
  assert.equal(readFileSync(t.s.store, "utf8"), t.keep);

  const u = p570();
  u.s.run("", u.app);
  assert.equal(readFileSync(u.s.store, "utf8"), u.tab);
  rmSync(u.s.store); // crontab -l 실패
  rmSync(u.s.tick);
  assert.equal(u.s.run(u.s.tick).status, 0);
  assert.ok(!existsSync(u.s.store));
});

test("P570 4: 둘째 인자가 없거나 비면 번들과 mdfind가 없어도 삭제 판정을 하지 않는다", () => {
  const t = p570();
  try {
    t.s.run(t.s.tick);
    t.s.run(t.s.tick, "");
    assert.ok(!existsSync(t.missing));
    assert.equal(readFileSync(t.s.store, "utf8"), t.tab);
  } finally {
    t.s.kill();
  }
});

test("P570 5: 정리하면 그 엔진의 sweep 데몬이 SIGTERM을 받고 다른 프로세스는 살아 있다", async () => {
  const t = p570();
  const daemon = spawn("sh", ["-c", `sleep 300; : "${t.edir}/dispatch.py" sweep`], { stdio: "ignore" });
  const other = spawn("sh", ["-c", `sleep 300; : "${t.edir}/dispatch.py" poll`], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 200));
    rmSync(t.s.tick);
    assert.equal(t.s.run(t.s.tick).status, 0);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(daemon.signalCode === "SIGTERM" || daemon.exitCode !== null);
    assert.equal(other.exitCode, null);
    assert.equal(other.signalCode, null);
  } finally {
    daemon.kill("SIGKILL");
    other.kill("SIGKILL");
  }
});
