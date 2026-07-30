import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 락 디렉터리(~/.config/fs-tickets/run)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { lockPath, listWorkers, workerSummary } = await import("./workers.ts");

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
