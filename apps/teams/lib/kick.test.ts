import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const { kickIdleWorker, kickTicket, kickRequest } = await import("./kick.ts");

const tmps: string[] = [];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** 가짜 `dispatch.py` - argv를 `ran.txt`에 한 줄로 남기고 끝난다. 진짜 세션은 안 뜬다. */
function fakeDispatch(): { root: string; ran: string } {
  const root = mkdtempSync(path.join(tmpdir(), "kick-root-"));
  tmps.push(root);
  const ran = path.join(root, "ran.txt");
  const py = path.join(root, "dispatch.py");
  writeFileSync(py, `import sys\nopen(${JSON.stringify(ran)}, "a").write(" ".join(sys.argv[1:]) + "\\n")\n`);
  process.env.DIRA_DISPATCH_PY = py;
  return { root, ran };
}

async function waitFor(file: string, ms = 3000): Promise<string> {
  for (let i = 0; i < ms / 20 && !existsSync(file); i++) await sleep(20);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

test("kickIdleWorker - 해시 없이 --reason direct로 부른다", async () => {
  const { root, ran } = fakeDispatch();
  assert.strictEqual(await kickIdleWorker(root), true);
  assert.strictEqual(await waitFor(ran), `run ${root} --reason direct`);
});

test("kickTicket - --reason direct --hash h", async () => {
  const { root, ran } = fakeDispatch();
  assert.strictEqual(await kickTicket(root, "abcd1234"), true);
  assert.strictEqual(await waitFor(ran), `run ${root} --reason direct --hash abcd1234`);
});

test("kickRequest - --reason request --hash h", async () => {
  const { root, ran } = fakeDispatch();
  assert.strictEqual(await kickRequest(root, "abcd1234"), true);
  assert.strictEqual(await waitFor(ran), `run ${root} --reason request --hash abcd1234`);
});

test("경로가 될 수 있는 해시는 아무것도 안 띄운다(신뢰 경계)", async () => {
  const { root, ran } = fakeDispatch();
  assert.strictEqual(await kickTicket(root, "../../etc/passwd"), false);
  assert.strictEqual(await kickRequest(root, "../x"), false);
  await sleep(300);
  assert.strictEqual(existsSync(ran), false);
});

test("python3나 모듈이 없어도 던지지 않는다", async () => {
  process.env.DIRA_DISPATCH_PY = "/nonexistent/dispatch.py";
  await assert.doesNotReject(kickIdleWorker("/nonexistent-root"));
});

test("dispatch.py를 못 찾으면 runner.log에 KICK-SKIP 한 줄", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kick-skip-"));
  tmps.push(root);
  mkdirSync(path.join(root, "workers"));
  delete process.env.DIRA_DISPATCH_PY;
  const prev = process.env.HOME;
  process.env.HOME = root; // bin/engines 후보를 비운다
  process.env.DIRA_ENGINE = root; // tick.sh 없는 엔진 -> engineRepo 실패
  try {
    assert.strictEqual(await kickRequest(root, "abcd1234"), false);
  } finally {
    process.env.HOME = prev;
    delete process.env.DIRA_ENGINE;
  }
  assert.match(readFileSync(path.join(root, "workers", "runner.log"), "utf8"), /\[dispatch\] KICK-SKIP request abcd1234/);
});
