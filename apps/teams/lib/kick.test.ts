import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// 진짜 락 디렉터리(~/.config/dira/run)를 밟지 않는다. import 전에 건다(workers.test.ts와 같다).
const LOCAL = mkdtempSync(path.join(tmpdir(), "kick-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { kickIdleWorker, kickTicket } = await import("./kick.ts");
const { lockPath } = await import("./workers.ts");

const tmps: string[] = [LOCAL];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** `crontab -l`을 가로챈다 — 진짜 crontab을 읽으면 이 머신의 등록 상태에 따라 idle 판정이
 *  흔들린다. `execFile("crontab")`은 PATH로 찾으므로 스텁을 앞에 붙이면 된다
 *  (workers.test.ts의 `withFakeCrontab`과 같은 수법. `"use server"` 파일이 아니라 그냥
 *  테스트 파일이지만 서로 import하지 않는 게 이 디렉터리 관례라 열 줄을 두 벌 둔다). */
function withFakeCrontab(text: string): () => void {
  const bin = mkdtempSync(path.join(tmpdir(), "kick-bin-"));
  tmps.push(bin);
  const out = path.join(bin, "out.txt");
  writeFileSync(out, text);
  writeFileSync(path.join(bin, "crontab"), `#!/bin/sh\ncat ${JSON.stringify(out)}\n`, {
    mode: 0o755,
  });
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return () => {
    process.env.PATH = prev;
  };
}

/** 워커 3개짜리 픽스처 큐. **스폰 대상은 즉시 끝나는 스텁 `.sh`**라 진짜 세션이 안 뜬다 —
 *  자기 이름을 `ran.txt`에 한 줄 적고 끝난다. 그 파일이 "무엇이 떴나"의 증거다. */
function fixture(): { root: string; dir: string; ran: string } {
  const root = mkdtempSync(path.join(tmpdir(), "kick-root-"));
  tmps.push(root);
  const dir = path.join(root, "workers");
  mkdirSync(dir, { recursive: true });
  const ran = path.join(root, "ran.txt");
  for (const n of ["w1", "w2", "w3"]) {
    writeFileSync(path.join(dir, `${n}.sh`), `#!/bin/sh\necho ${n} >> ${JSON.stringify(ran)}\n`, {
      mode: 0o755,
    });
  }
  return { root, dir, ran };
}

/** tick.sh와 같은 모양의 락 — 디렉터리 + 안의 pid 파일. */
function putLock(dir: string, name: string, pid: number) {
  const lock = lockPath(dir, name);
  mkdirSync(lock, { recursive: true });
  writeFileSync(path.join(lock, "pid"), String(pid));
}

/** detach spawn은 결과를 안 기다린다 — 스텁이 파일을 쓸 때까지 짧게 본다. */
async function waitFor(file: string, ms = 3000): Promise<string> {
  for (let i = 0; i < ms / 20 && !existsSync(file); i++) await sleep(20);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

test("kickIdleWorker — running/stopped 섞인 목록에서 idle 하나를 띄운다", async () => {
  const { root, dir, ran } = fixture();
  putLock(dir, "w1", process.pid); // 이 테스트 프로세스는 살아 있다 = running
  // w2만 crontab에 있다 = idle. w3은 락도 cron도 없다 = stopped.
  const restore = withFakeCrontab(`* * * * * "${path.join(dir, "w2.sh")}" >> /dev/null 2>&1\n`);
  try {
    assert.strictEqual(await kickIdleWorker(root), "w2");
    assert.strictEqual(await waitFor(ran), "w2"); // running도 stopped도 안 떴다
  } finally {
    restore();
  }
});

test("kickIdleWorker — idle이 0개면 아무것도 안 띄운다", async () => {
  const { root, dir, ran } = fixture();
  putLock(dir, "w1", process.pid);
  const restore = withFakeCrontab(""); // 등록된 워커 없음 = w2·w3은 stopped
  try {
    assert.strictEqual(await kickIdleWorker(root), null);
    await sleep(300); // 떴다면 이 사이에 파일이 생긴다
    assert.strictEqual(existsSync(ran), false);
  } finally {
    restore();
  }
});

test("kickIdleWorker — 워커가 없는 큐에서도 던지지 않는다(액션은 kick 실패로 실패하지 않는다)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kick-root-"));
  tmps.push(root);
  assert.strictEqual(await kickIdleWorker(root), null);
});

test("kickTicket — idle 워커를 골라 `tick <해시>`로 지목 디스패치한다", async () => {
  const { root, dir, ran } = fixture();
  putLock(dir, "w1", process.pid); // running
  const restore = withFakeCrontab(`* * * * * "${path.join(dir, "w2.sh")}" >> /dev/null 2>&1\n`);
  try {
    assert.strictEqual(await kickTicket(root, "abcd1234"), "w2");
    // 인자 없는 kickIdleWorker의 스텁은 이름만 적지만, 이 스텁은 args도 적는다 — 넘긴 args가
    // `["tick", hash]`인지는 아래 args 전용 스텁으로 따로 본다(이 스텁은 이름만 검증).
    assert.strictEqual(await waitFor(ran), "w2");
  } finally {
    restore();
  }
});

test("kickTicket — 넘기는 args가 정확히 `tick <해시>`다", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kick-root-"));
  tmps.push(root);
  const dir = path.join(root, "workers");
  mkdirSync(dir, { recursive: true });
  const ran = path.join(root, "ran.txt");
  writeFileSync(path.join(dir, "w1.sh"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(ran)}\n`, {
    mode: 0o755,
  });
  const restore = withFakeCrontab(`* * * * * "${path.join(dir, "w1.sh")}" >> /dev/null 2>&1\n`);
  try {
    assert.strictEqual(await kickTicket(root, "abcd1234"), "w1");
    assert.strictEqual(await waitFor(ran), "tick abcd1234");
  } finally {
    restore();
  }
});

test("kickTicket — idle이 0개면 아무것도 안 띄운다", async () => {
  const { root, dir, ran } = fixture();
  putLock(dir, "w1", process.pid);
  const restore = withFakeCrontab("");
  try {
    assert.strictEqual(await kickTicket(root, "abcd1234"), null);
    await sleep(300);
    assert.strictEqual(existsSync(ran), false);
  } finally {
    restore();
  }
});

test("kickTicket — 경로가 될 수 있는 해시는 워커를 보지도 않는다(신뢰 경계)", async () => {
  const { root } = fixture();
  const restore = withFakeCrontab("");
  try {
    assert.strictEqual(await kickTicket(root, "../../etc/passwd"), null);
  } finally {
    restore();
  }
});
