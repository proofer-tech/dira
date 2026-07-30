import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listTickets } from "./queue.ts";

// 진짜 락 디렉터리(~/.config/fs-tickets/run)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  createWorker,
  cronRegisterCmd,
  cronUnregisterCmd,
  deleteWorker,
  lockPath,
  listWorkers,
  workerSummary,
} = await import("./workers.ts");

const SFX = { inProgress: ".wip", done: ".done" };

const tmps: string[] = [LOCAL];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** 락은 디렉터리 + 안의 pid 파일. tick.sh와 같은 모양으로 만든다. */
function putLock(workersDir: string, name: string, pid: number | null) {
  const dir = lockPath(workersDir, name);
  mkdirSync(dir, { recursive: true });
  if (pid !== null) writeFileSync(path.join(dir, "pid"), String(pid));
}

test("lockPath — tick.sh의 파이썬 sha1과 한 글자도 다르지 않다", () => {
  const workers = "/Users/x/Projects/p/.fs-tickets/workers";
  // tick.sh: LOCK="$LOCAL/run/$TICKET_NAME-$(python3 -c 'sha1(argv[1])[:8]' "$WORKERS/$TICKET_NAME").lock"
  const h = execFileSync(
    "python3",
    [
      "-c",
      "import hashlib,sys;print(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:8])",
      `${workers}/w1`,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.strictEqual(lockPath(workers, "w1"), path.join(LOCAL, "run", `w1-${h}.lock`));
});

test("listWorkers — running · stale · stopped 판정", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(root);
  const dir = path.join(root, "workers");
  mkdirSync(dir);
  for (const n of ["w1.sh", "w2.sh", "w3.sh", "runner.log"]) {
    writeFileSync(path.join(dir, n), "#!/bin/bash\n");
  }

  putLock(dir, "w1", process.pid); // 이 테스트 프로세스는 살아 있다
  putLock(dir, "w2", 0x7ffffff0); // 있을 수 없는 pid = 죽은 락

  const ws = await listWorkers(root);
  assert.deepStrictEqual(
    ws.map((w) => `${w.name}:${w.status}`),
    ["w1:running", "w2:stale", "w3:stopped"], // .sh 아닌 파일은 워커가 아니다
  );
  assert.strictEqual(ws[0].lockPid, process.pid);
  // crontab에 없는 워커는 stopped다. 이 판정이 뒤집히면 요약이 거짓말을 한다.
  assert.strictEqual(workerSummary(ws), "running 1 / stale 1 / stopped 1");
  assert.strictEqual(workerSummary([]), "—");
});

test("listWorkers — workers/ 없으면 빈 배열(등록 검증은 tickets/만 있어도 통과한다)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(root);
  assert.deepStrictEqual(await listWorkers(root), []);
});

/** 워커·티켓이 있는 큐 하나. `<root>` 반환. */
function makeRoot(workers: Record<string, string>, tickets: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(root);
  mkdirSync(path.join(root, "workers"));
  mkdirSync(path.join(root, "tickets"));
  for (const [n, body] of Object.entries(workers)) writeFileSync(path.join(root, "workers", n), body);
  for (const [n, body] of Object.entries(tickets)) writeFileSync(path.join(root, "tickets", n), body);
  return root;
}

test("TICKET_NAME 재정의 — 락·로그는 파일명이 아니라 실효 이름으로 간다 (tick.sh 37·87행)", async () => {
  const root = makeRoot({
    // README §워커 레퍼런스의 실제 예시: 파일명과 TICKET_NAME이 다르다
    "a.sh": '#!/bin/bash\nTICKET_NAME="reviewer"\nTICKET_ENGINE=(codex exec --json "{prompt}")\n',
  });
  const dir = path.join(root, "workers");
  writeFileSync(path.join(dir, "runner.log"), "2026-07-30 13:19:01 [reviewer] SKIP 물고 있다\n");
  putLock(dir, "reviewer", process.pid); // 파일명 a가 아니라 reviewer로 잡힌다

  const [w] = await listWorkers(root);
  assert.strictEqual(w.name, "a"); // 액션이 가리키는 건 파일이다
  assert.strictEqual(w.status, "running"); // 파일명으로 찾았으면 stopped로 거짓말했다
  assert.strictEqual(w.engine, 'codex exec --json "{prompt}"');
  assert.match(w.lastLog!, /\[reviewer\] SKIP/);
});

test("주석 처리된 할당문은 설정이 아니다 (worker.sh.example이 통째로 주석이다)", async () => {
  const root = makeRoot({
    "w1.sh": '#!/bin/bash\n# TICKET_NAME="w9"\n# TICKET_ENGINE=(codex exec)\n. "$HOME/x/tick.sh"\n',
  });
  const [w] = await listWorkers(root);
  assert.strictEqual(w.name, "w1");
  assert.match(w.engine, /^claude -p /); // tick.sh 기본값
  // 주석의 TICKET_NAME=w9를 먹었다면 락을 엉뚱한 이름으로 찾는다
  putLock(path.join(root, "workers"), "w1", process.pid);
  assert.strictEqual((await listWorkers(root))[0].status, "running");
});

test("holding — .wip 티켓의 owner에서 워커를 되짚는다 (tick.sh 207행 표기)", async () => {
  const root = makeRoot(
    { "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" },
    {
      "aaa1.wip.md": "---\nticket: aaa1\nowner: developer / w1-064007b2\n---\n본문\n",
      // 완료된 티켓의 owner는 기록이지 현재가 아니다 — 여기 걸리면 안 된다
      "bbb2.done.md": "---\nticket: bbb2\nowner: qa / w2-deadbeef\n---\n본문\n",
    },
  );
  const tickets = await listTickets(root, SFX);
  const ws = await listWorkers(root, tickets);
  assert.deepStrictEqual(
    ws.map((w) => [w.name, w.holding]),
    [
      ["w1", "aaa1"],
      ["w2", null],
    ],
  );
  // 티켓을 안 넘기면 항상 null이다(테넌트 목록 요약이 그렇게 부른다)
  assert.strictEqual((await listWorkers(root))[0].holding, null);
});

test("cron 명령어 — 공백·작은따옴표가 든 경로를 셸이 한 인자로 받는다", () => {
  // 실제로 있는 큐다: 구글 공유 드라이브 경로에 공백과 한글이 들어간다
  const p = "/Users/x/공유 드라이브/it's/workers/w1.sh";
  const expected = `* * * * * "${p}" >> "/Users/x/공유 드라이브/it's/workers/cron.log" 2>&1`;
  // 등록 명령의 echo 부분만 떼어 진짜 셸에 먹인다 — crontab을 건드리지 않고 인용만 검증한다
  const cmd = cronRegisterCmd({ path: p })
    .replace("(crontab -l 2>/dev/null; ", "(")
    .replace(") | crontab -", ")");
  assert.strictEqual(execFileSync("sh", ["-c", cmd], { encoding: "utf8" }).trimEnd(), expected);
  assert.ok(cronUnregisterCmd({ path: p }).includes("grep -Fv"));
});

test("createWorker — 기존 워커를 템플릿으로 755 생성, 덮어쓰기·워커 0개는 거부", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\nTICKET_CWD=/tmp\n. tick.sh\n" });
  const { path: file, template } = await createWorker(root, "w2");
  assert.strictEqual(template, "w1.sh");
  assert.strictEqual(statSync(file).mode & 0o777, 0o755);
  assert.strictEqual(execFileSync("cat", [file], { encoding: "utf8" }), "#!/bin/bash\nTICKET_CWD=/tmp\n. tick.sh\n");
  // O_EXCL: 돌고 있는 워커를 덮어쓰지 않는다
  await assert.rejects(createWorker(root, "w2"), /EEXIST/);
  await assert.rejects(createWorker(root, "../evil"), /영문·숫자/);
  // 워커 0개면 템플릿이 없다 — 엔진 코드 위치를 GUI가 모른다
  await assert.rejects(createWorker(makeRoot({}), "w1"), /템플릿으로 쓸 워커가 없습니다/);
});

test("deleteWorker — running은 막는다(락과 세션이 붕 뜬다)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" });
  putLock(path.join(root, "workers"), "w1", process.pid);
  await assert.rejects(deleteWorker(root, "w1"), /티켓을 물고 있습니다/);
  await deleteWorker(root, "w2");
  assert.deepStrictEqual((await listWorkers(root)).map((w) => w.name), ["w1"]);
});
