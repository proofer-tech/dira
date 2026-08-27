import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 진짜 락 디렉터리(~/.config/dira)를 밟지 않는다. import 전에 건다(`workers.test.ts`와 같은 관용구).
const LOCAL = mkdtempSync(path.join(tmpdir(), "pool-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  POOL_DISPATCHER_SH,
  applyPoolLimit,
  borrowPoolWorker,
  createPoolWorker,
  deletePoolWorker,
  listBorrowedPoolWorkers,
  listPoolWorkers,
  poolDir,
  poolWorkerFullStatus,
  readPoolLimit,
  returnPoolWorker,
  startPoolWorker,
  stopPoolWorker,
  writePoolLimit,
} = await import("./pool.ts");
const { scaffold } = await import("./scaffold.ts");
const { lockPath } = await import("./workers.ts");

/** 락은 디렉터리 + 안의 pid 파일 — `workers.test.ts`의 `putLock`과 같은 관용구다. */
function putLock(workersDir: string, name: string, pid: number) {
  const dir = lockPath(workersDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "pid"), String(pid));
}

const tmps: string[] = [];
const tmp = (prefix: string) => {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  tmps.push(d);
  return d;
};
process.on("exit", () => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const execFileP = promisify(execFile);

// ── §4-16 결정 2 — 픽스처: tickets/·workers/ 평면 큐 하나(git 없이, 셸 shim으로 선정 로직만 잰다) ──

function mkQueue(base: string, id: string, tickets: number): { id: string; root: string } {
  const root = path.join(base, id, ".dira");
  mkdirSync(path.join(root, "tickets"), { recursive: true });
  mkdirSync(path.join(root, "workers"), { recursive: true });
  for (let i = 0; i < tickets; i++) {
    writeFileSync(path.join(root, "tickets", `t${i}.md`), `---\nticket: t${i}\n---\n\n## Goal\nx\n`);
  }
  return { id, root };
}

function writeRegistry(local: string, projects: { id: string; root: string }[]): void {
  writeFileSync(
    path.join(local, "gui-projects.json"),
    JSON.stringify({ version: 1, projects: projects.map((p) => ({ id: p.id, name: p.id, root: p.root })) }),
  );
}

/** 실제 dryrun/tick 대신 마커 로그 한 줄을 남기는 shim — 디스패처의 **선정 로직**만 잰다(느린
 *  실제 세션 없이). 워크트리 자동 생성·이름 충돌 같은 shim 생성 자체의 계약은 아래
 *  `borrowPoolWorker` 구획이 진짜 `scaffold`+git으로 잰다. */
function stubShim(root: string, poolName: string, markerLog: string, label: string, sleepSec = 0): void {
  const file = path.join(root, "workers", `${poolName}.sh`);
  const body =
    sleepSec > 0
      ? `#!/bin/bash\necho START-${label} >> ${JSON.stringify(markerLog)}\nsleep ${sleepSec}\necho END-${label} >> ${JSON.stringify(markerLog)}\n`
      : `#!/bin/bash\necho DISPATCHED-${label} >> ${JSON.stringify(markerLog)}\n`;
  writeFileSync(file, body, { mode: 0o755 });
}

function runDispatcher(dispatcherPath: string, local: string): string {
  return execFileSync("bash", [dispatcherPath], {
    encoding: "utf8",
    env: { ...process.env, TICKET_LOCAL: local },
  });
}

/** 진짜 crontab을 안 건드리는 PATH 스텁(`workers.test.ts`의 `withLiveCrontab`과 같은 관용구) —
 *  `-l`과 `crontab -`이 같은 파일을 본다. `poolWorkerFullStatus`·`startPoolWorker`가 이 파일을
 *  읽고 쓴다. */
function withLiveCrontab(text: string) {
  const bin = tmp("pool-cronbin-");
  const tab = path.join(bin, "tab.txt");
  writeFileSync(tab, text);
  writeFileSync(
    path.join(bin, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat ${JSON.stringify(tab)}; else cat > ${JSON.stringify(tab + ".new")} && mv ${JSON.stringify(tab + ".new")} ${JSON.stringify(tab)}; fi\n`,
    { mode: 0o755 },
  );
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return {
    tab: () => readFileSync(tab, "utf8"),
    restore: () => {
      process.env.PATH = prev;
    },
  };
}

test("POOL_DISPATCHER_SH — 진짜 bash·python3로 문법 확인 (§4-16 결정 2)", () => {
  const dir = tmp("pool-syn-");
  const file = path.join(dir, "x.sh");
  writeFileSync(file, POOL_DISPATCHER_SH, { mode: 0o755 });
  execFileSync("bash", ["-n", file]);
  const m = /<<'PY'\n([\s\S]*?)\nPY\n/.exec(POOL_DISPATCHER_SH);
  assert.ok(m, "임베드 python3 블록을 못 찾았다");
  execFileSync("python3", ["-c", `compile(open(${JSON.stringify("/dev/stdin")}).read(), "embedded", "exec")`], {
    input: m![1],
  });
});

test("createPoolWorker·listPoolWorkers·deletePoolWorker — 파일 목록이 곧 풀이다 (§4-16 결정 2)", async () => {
  const local = tmp("pool-cd-");
  process.env.TICKET_LOCAL = local;
  const prev = poolDir();
  assert.strictEqual(prev, path.join(local, "pool"));

  const { path: file } = await createPoolWorker("pool-1");
  assert.strictEqual(readFileSync(file, "utf8"), POOL_DISPATCHER_SH);
  assert.strictEqual(statSync(file).mode & 0o777, 0o755);
  assert.deepStrictEqual(await listPoolWorkers(), [{ name: "pool-1", path: file }]);

  // O_EXCL — 있는 공통 워커를 덮지 않는다
  await assert.rejects(createPoolWorker("pool-1"), /EEXIST/);

  // 파일만 있고 crontab에는 아직 없다 — §비주얼 §68 ① 4상태 그대로(shim이 아니라 풀 파일이라
  // 판정 넷이 전부 참이다). 등록은 `createPoolWorkerAction`이 이 함수 다음에 한다(§4-16 결정 5).
  const c = withLiveCrontab("");
  try {
    assert.strictEqual(await poolWorkerFullStatus("pool-1"), "stopped");
    assert.strictEqual(await startPoolWorker("pool-1"), true);
    assert.match(c.tab(), /pool-1\.sh/);
    assert.strictEqual(await poolWorkerFullStatus("pool-1"), "idle"); // 만든 직후 등록하면 idle이다
    assert.strictEqual(await startPoolWorker("pool-1"), false); // 이미 등록 = no-op

    assert.strictEqual(await stopPoolWorker("pool-1"), true);
    assert.strictEqual(await poolWorkerFullStatus("pool-1"), "stopped");
    assert.strictEqual(await stopPoolWorker("pool-1"), false); // 이미 미등록 = no-op

    // 삭제는 crontab 줄부터 뺀다 — 등록된 채로 지워도 crontab에 파일 없는 줄이 안 남는다.
    await startPoolWorker("pool-1");
    await deletePoolWorker("pool-1");
    assert.doesNotMatch(c.tab(), /pool-1\.sh/);
  } finally {
    c.restore();
  }
  assert.deepStrictEqual(await listPoolWorkers(), []);
  await assert.rejects(deletePoolWorker("pool-1"), /없는 공통 워커/);
});

test("readPoolLimit·writePoolLimit — §4-16 결정 3: 0/없음 = 안 빌린다, 못 읽는 값은 경고", async () => {
  const dir = tmp("pool-limit-");
  // 파일 없음 — §68 ④ §트리거 값: `null`이지 `0`이 아니다(화면이 `없음`으로 그린다)
  assert.deepStrictEqual(await readPoolLimit(dir), { limit: null, warn: false });

  await writePoolLimit(dir, 3);
  assert.deepStrictEqual(await readPoolLimit(dir), { limit: 3, warn: false });
  assert.strictEqual(readFileSync(path.join(dir, "pool-limit"), "utf8"), "3\n");

  for (const bad of ["abc", "-1", "", "  "]) {
    writeFileSync(path.join(dir, "pool-limit"), bad);
    assert.deepStrictEqual(await readPoolLimit(dir), { limit: 0, warn: true }, `bad=${JSON.stringify(bad)}`);
  }

  await writePoolLimit(dir, 0);
  assert.deepStrictEqual(await readPoolLimit(dir), { limit: 0, warn: false });
  await assert.rejects(writePoolLimit(dir, -1), /정수/);
  await assert.rejects(writePoolLimit(dir, 1.5), /정수/);
});

// ── 디스패처 선정 로직 — Done when 1~5 (임시 큐, 셸 shim) ──────────────────

test("풀 디스패처 — 슬롯이 하나라 같은 공통 워커가 동시에 두 번 안 돈다", async () => {
  const local = tmp("pool-slot-local-");
  process.env.TICKET_LOCAL = local;
  const base = tmp("pool-slot-proj-");
  const A = mkQueue(base, "A", 1);
  writeRegistry(local, [A]);
  writeFileSync(path.join(A.root, "pool-limit"), "1\n");
  const marker = path.join(local, "marker.log");
  stubShim(A.root, "pool-1", marker, "A", 1.2);

  const { path: dispatcher } = await createPoolWorker("pool-1");
  const first = spawn("bash", [dispatcher], { env: { ...process.env, TICKET_LOCAL: local } });
  let firstOut = "";
  first.stdout.on("data", (d) => (firstOut += d));
  await new Promise((r) => setTimeout(r, 300)); // 먼저 뜬 쪽이 슬롯을 잡을 시간을 준다

  const secondOut = runDispatcher(dispatcher, local);
  assert.match(secondOut, /SKIP pool-1/);

  await new Promise((resolve) => first.on("exit", resolve));
  const log = readFileSync(marker, "utf8");
  assert.strictEqual(log, "START-A\nEND-A\n"); // 둘째는 아무것도 안 남겼다
});

test("풀 디스패처 — 임시 큐 둘에 열린 티켓 한 장씩, 두 번 돌리면 한 번씩 잡힌다", async () => {
  const local = tmp("pool-rr-local-");
  process.env.TICKET_LOCAL = local;
  const base = tmp("pool-rr-proj-");
  const A = mkQueue(base, "A", 1);
  const B = mkQueue(base, "B", 1);
  writeRegistry(local, [A, B]);
  writeFileSync(path.join(A.root, "pool-limit"), "1\n");
  writeFileSync(path.join(B.root, "pool-limit"), "1\n");
  const marker = path.join(local, "marker.log");
  stubShim(A.root, "pool-1", marker, "A");
  stubShim(B.root, "pool-1", marker, "B");

  const { path: dispatcher } = await createPoolWorker("pool-1");
  runDispatcher(dispatcher, local);
  runDispatcher(dispatcher, local);
  const lines = readFileSync(marker, "utf8").trim().split("\n").sort();
  assert.deepStrictEqual(lines, ["DISPATCHED-A", "DISPATCHED-B"]);
});

test("풀 디스패처 — pool-limit이 0이거나 없으면 열린 티켓이 있어도 한 번도 안 잡힌다 (runner.log 무성장)", async () => {
  const local = tmp("pool-lim0-local-");
  process.env.TICKET_LOCAL = local;
  const base = tmp("pool-lim0-proj-");
  const noLimit = mkQueue(base, "no-limit", 1); // pool-limit 파일 자체가 없다
  const zero = mkQueue(base, "zero", 1);
  writeFileSync(path.join(zero.root, "pool-limit"), "0\n");
  writeRegistry(local, [noLimit, zero]);
  const marker = path.join(local, "marker.log");
  stubShim(noLimit.root, "pool-1", marker, "no-limit");
  stubShim(zero.root, "pool-1", marker, "zero");

  const { path: dispatcher } = await createPoolWorker("pool-1");
  const out = runDispatcher(dispatcher, local);
  assert.strictEqual(out, "");
  assert.strictEqual(existsSync(marker), false); // shim이 한 번도 안 불렸다
  assert.strictEqual(existsSync(path.join(noLimit.root, "workers", "runner.log")), false);
  assert.strictEqual(existsSync(path.join(zero.root, "workers", "runner.log")), false);
});

test("풀 디스패처 — 공통 워커 둘 + 상한 1인 큐에 동시에 하나만 들어간다", async () => {
  const local = tmp("pool-cap-local-");
  process.env.TICKET_LOCAL = local;
  const base = tmp("pool-cap-proj-");
  const A = mkQueue(base, "A", 1);
  writeRegistry(local, [A]);
  writeFileSync(path.join(A.root, "pool-limit"), "1\n");
  const marker = path.join(local, "marker.log");
  stubShim(A.root, "pool-1", marker, "1", 1.2);
  stubShim(A.root, "pool-2", marker, "2", 1.2);

  const { path: d1 } = await createPoolWorker("pool-1");
  const { path: d2 } = await createPoolWorker("pool-2");

  const first = spawn("bash", [d1], { env: { ...process.env, TICKET_LOCAL: local } });
  await new Promise((r) => setTimeout(r, 300));
  const secondOut = runDispatcher(d2, local);
  assert.strictEqual(secondOut, ""); // 후보가 없다(A는 이미 상한) — SKIP 줄도 없다, 조용히 끝난다
  await new Promise((resolve) => first.on("exit", resolve));
  assert.strictEqual(readFileSync(marker, "utf8"), "START-1\nEND-1\n"); // pool-2는 한 번도 안 들어갔다
});

test("풀 디스패처 — 열린 티켓이 0장인 큐는 후보가 아니다", async () => {
  const local = tmp("pool-empty-local-");
  process.env.TICKET_LOCAL = local;
  const base = tmp("pool-empty-proj-");
  const empty = mkQueue(base, "empty", 0);
  writeRegistry(local, [empty]);
  writeFileSync(path.join(empty.root, "pool-limit"), "1\n");
  const marker = path.join(local, "marker.log");
  stubShim(empty.root, "pool-1", marker, "empty");

  const { path: dispatcher } = await createPoolWorker("pool-1");
  const out = runDispatcher(dispatcher, local);
  assert.strictEqual(out, "");
  assert.strictEqual(existsSync(marker), false);
});

// ── shim 워커 — Done when 6·7·9 (진짜 git + scaffold) ───────────────────────

function makeRepo(): { base: string; root: string } {
  const base = tmp("pool-repo-");
  const git = (...args: string[]) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(path.join(base, "README.md"), "# t\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { base, root: path.join(base, ".dira") };
}

test("borrowPoolWorker — shim 생성 즉시 워크트리가 없고, 한 번 돌리면 통합 게이트가 만든다 (§4-16 결정 2)", async () => {
  const { base } = makeRepo();
  const { root } = await scaffold(base, { branch: "main" });

  const { path: shimPath } = await borrowPoolWorker(root, "pool-1");
  assert.strictEqual(readFileSync(shimPath, "utf8").split("\n")[1], "# dira-pool: pool-1"); // 둘째 줄 표식

  const tree = path.join(root, "worktrees", "pool-1");
  assert.strictEqual(existsSync(tree), false); // 빌린 직후 — 워크트리 없음

  execFileSync("bash", [shimPath, "dryrun"], { encoding: "utf8" });
  assert.strictEqual((await stat(tree)).isDirectory(), true);
  const { stdout } = await execFileP("realpath", [path.join(tree, ".dira")]);
  assert.strictEqual(stdout.trim(), await execFileP("realpath", [root]).then((r) => r.stdout.trim()));

  // 반납 — shim이 사라진다(티켓을 안 물고 있으니 막히지 않는다)
  await returnPoolWorker(root, "pool-1");
  assert.strictEqual(existsSync(shimPath), false);
});

test("borrowPoolWorker — 이름이 겹치면 거절하고 그 파일은 안 갈린다 (§4-16 결정 2)", async () => {
  const { base } = makeRepo();
  const { root } = await scaffold(base, { branch: "main" });
  const w1 = readFileSync(path.join(root, "workers", "w1.sh"), "utf8");
  const fooFile = path.join(root, "workers", "foo.sh");
  writeFileSync(fooFile, w1, { mode: 0o755 });
  const before = readFileSync(fooFile, "utf8");

  await assert.rejects(borrowPoolWorker(root, "foo"), /이미 같은 이름의 프로젝트 워커/);
  assert.strictEqual(readFileSync(fooFile, "utf8"), before);

  // 이미 빌린 상태(shim이 이미 있다)는 멱등하게 통과한다
  const first = await borrowPoolWorker(root, "pool-1");
  const second = await borrowPoolWorker(root, "pool-1");
  assert.strictEqual(first.path, second.path);
  assert.strictEqual(readFileSync(first.path, "utf8"), readFileSync(second.path, "utf8"));
});

test("returnPoolWorker — shim이 아닌 프로젝트 워커는 이 경로로 안 지운다", async () => {
  const { base } = makeRepo();
  const { root } = await scaffold(base, { branch: "main" });
  await assert.rejects(returnPoolWorker(root, "w1"), /공통 워커 shim이 아닙니다/);
  assert.strictEqual(existsSync(path.join(root, "workers", "w1.sh")), true);
});

// ── applyPoolLimit — Done when 28c4d25f 3·4·5 (상한 저장 ↔ shim 전원 반영) ──────

test("applyPoolLimit — 1 이상으로 저장하면 공통 워커 전원의 shim이 들어가고, 0으로 되돌리면 전부 빠진다", async () => {
  process.env.TICKET_LOCAL = tmp("pool-apply-a-local-"); // poolDir()가 이 값을 본다 — 딴 테스트와 안 섞는다
  const { base } = makeRepo();
  const { root } = await scaffold(base, { branch: "main" });
  await createPoolWorker("pool-1");
  await createPoolWorker("pool-2");

  const up = await applyPoolLimit(root, 3);
  assert.deepStrictEqual(up, { blocked: [] });
  assert.deepStrictEqual(await listBorrowedPoolWorkers(root), ["pool-1", "pool-2"]);
  assert.deepStrictEqual(await readPoolLimit(root), { limit: 3, warn: false });

  const down = await applyPoolLimit(root, 0);
  assert.deepStrictEqual(down, { blocked: [] });
  assert.deepStrictEqual(await listBorrowedPoolWorkers(root), []);
  assert.deepStrictEqual(await readPoolLimit(root), { limit: 0, warn: false });
});

test("applyPoolLimit — 이름이 겹치면 통째로 던지고 pool-limit은 안 쓴다", async () => {
  process.env.TICKET_LOCAL = tmp("pool-apply-b-local-");
  const { base } = makeRepo();
  const { root } = await scaffold(base, { branch: "main" });
  const w1 = readFileSync(path.join(root, "workers", "w1.sh"), "utf8");
  writeFileSync(path.join(root, "workers", "pool-1.sh"), w1, { mode: 0o755 });
  await createPoolWorker("pool-1");

  await assert.rejects(applyPoolLimit(root, 2), /이미 같은 이름의 프로젝트 워커/);
  assert.deepStrictEqual(await readPoolLimit(root), { limit: null, warn: false }); // 안 쓰였다
});

test("applyPoolLimit — 티켓을 물고 있는 shim은 안 지워지고 blocked로 사유가 뜬다", async () => {
  process.env.TICKET_LOCAL = tmp("pool-apply-c-local-");
  const { base } = makeRepo();
  const { root } = await scaffold(base, { branch: "main" });
  await createPoolWorker("pool-1");
  await createPoolWorker("pool-2");
  await applyPoolLimit(root, 1);

  // pool-1만 티켓을 물고 있는 것으로 만든다(락 + 살아 있는 pid)
  putLock(path.join(root, "workers"), "pool-1", process.pid);

  const { blocked } = await applyPoolLimit(root, 0);
  assert.strictEqual(blocked.length, 1);
  assert.strictEqual(blocked[0].name, "pool-1");
  assert.match(blocked[0].reason, /티켓을 물고 있습니다/);
  // 막힌 것은 남고, 안 막힌 것은 마저 지워졌다 — pool-limit은 그래도 0으로 쓰인다(사실이다)
  assert.deepStrictEqual(await listBorrowedPoolWorkers(root), ["pool-1"]);
  assert.deepStrictEqual(await readPoolLimit(root), { limit: 0, warn: false });
});
