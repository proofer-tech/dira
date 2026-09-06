/** `lib/pty.ts` — 진짜 `script`+`sh`로 돌린다(`source-control.test.ts`의 근거와 같다: pty가
 *  실제로 셸을 여는가·cwd가 먹히는가·죽이면 없어지는가는 셸 자신의 출력·`ps`가 정본이다). */
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PTY_LIMIT,
  extractLastCommand,
  killPty,
  openPty,
  pidOf,
  ptyAlive,
  ptyStatuses,
  restartPty,
  subscribePty,
  writePty,
} from "./pty.ts";

const tmps: string[] = [];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

function tmpDir(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pty-")));
  tmps.push(dir);
  return dir;
}

/** 조건이 참이 될 때까지 짧게 폴링한다 — pty 출력은 비동기다. 5초 안에 안 되면 실패로 던진다. */
async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("openPty spawns a real shell in the chosen cwd", async () => {
  const cwd = tmpDir();
  const opened = openPty(cwd, "/bin/sh");
  assert.ok("id" in opened);
  const { id } = opened as { id: string };
  let out = "";
  const sub = subscribePty(id, (s) => (out += s));
  assert.ok(sub);
  writePty(id, "pwd\n");
  await waitFor(() => out.includes(cwd));
  killPty(id);
});

test("ls --color=always emits SGR escapes", async () => {
  const cwd = tmpDir();
  // 일반 파일은 기본 LSCOLORS에서 색이 없다 - 디렉터리라야 뜬다(실측: `a.txt`만 두면 이 검증이
  // 늘 통과 못 한다. 컬러가 붙는 항목이 최소 하나 있어야 한다).
  execFileSync("mkdir", [path.join(cwd, "subdir")]);
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  let out = "";
  subscribePty(id, (s) => (out += s));
  writePty(id, "ls --color=always\n");
  await waitFor(() => out.includes("\x1b["));
  killPty(id);
});

test("closing a tab sends SIGTERM and the process group goes away", async () => {
  const cwd = tmpDir();
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  await waitFor(() => ptyAlive(id));
  const gpid = pidOf(id)!;
  assert.equal(killPty(id), true);
  assert.equal(ptyAlive(id), false);
  assert.equal(killPty(id), false); // 두 번째는 이미 없다
  // 그룹 자체가 없어졌는지 `ps`가 아니라 시그널 0(존재만 묻고 안 죽인다)으로 확인한다 —
  // SIGTERM은 비동기라 아주 짧게 기다린다.
  await waitFor(() => {
    try {
      process.kill(-gpid, 0);
      return false; // 아직 있다
    } catch {
      return true; // ESRCH — 그룹이 없다
    }
  }, 2000);
});

test("PTY_LIMIT caps concurrent ptys and the next one is refused", async () => {
  const cwd = tmpDir();
  const ids: string[] = [];
  for (let i = 0; i < PTY_LIMIT; i++) {
    const opened = openPty(cwd, "/bin/sh");
    assert.ok("id" in opened, `slot ${i} should open`);
    ids.push((opened as { id: string }).id);
  }
  const ninth = openPty(cwd, "/bin/sh");
  assert.deepEqual(ninth, { error: "limit" });
  for (const id of ids) killPty(id);
});

test("restartPty never reconnects a live pty — it replaces it with a fresh process", async () => {
  const cwd = tmpDir();
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  let firstOut = "";
  const sub = subscribePty(id, (s) => (firstOut += s));
  writePty(id, "echo first-$$\n");
  await waitFor(() => firstOut.includes("first-"));
  sub?.unsubscribe();

  const restarted = restartPty(id, cwd, "/bin/sh");
  assert.deepEqual(restarted, { id });
  let secondOut = "";
  subscribePty(id, (s) => (secondOut += s));
  writePty(id, "echo second\n");
  await waitFor(() => secondOut.includes("second"));
  assert.ok(!secondOut.includes("first-")); // 새 프로세스 — 옛 화면이 안 이어진다
  killPty(id);
});

// §11-6 결정 2 — extractLastCommand 단위 테스트. 프롬프트 셋 - 없음 - ANSI - 200자 초과.
test("extractLastCommand picks the text after the last $ prompt", () => {
  assert.equal(extractLastCommand("user@host:~$ pwd"), "pwd");
});

test("extractLastCommand picks the text after the last % prompt", () => {
  assert.equal(extractLastCommand("host% ls -la"), "ls -la");
});

test("extractLastCommand picks the text after the last # prompt", () => {
  assert.equal(extractLastCommand("root@host:~# whoami"), "whoami");
});

test("extractLastCommand returns the whole line when no prompt marker is present", () => {
  assert.equal(extractLastCommand("just some echoed text"), "just some echoed text");
});

test("extractLastCommand strips ANSI escapes before picking the command", () => {
  assert.equal(extractLastCommand("\x1b[32muser@host\x1b[0m$ \x1b[1mls\x1b[0m"), "ls");
});

test("extractLastCommand caps the result at 200 characters", () => {
  const long = "a".repeat(250);
  const picked = extractLastCommand(`$ ${long}`);
  assert.equal(picked.length, 200);
  assert.equal(picked, long.slice(0, 200));
});

test("writePty records the last command the moment Enter is seen, including recalled history", async () => {
  const cwd = tmpDir();
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  let out = "";
  subscribePty(id, (s) => (out += s));
  // 한 번에 몰아 쓰지 않는다 — xterm이 키 하나마다 `writePty`를 부르는 실제 흐름과 같다.
  // 엔터가 별도 호출로 와야 그 순간 `backlog`에 이미 에코된 "echo hi"가 들어 있다(§11-6 결정 2).
  writePty(id, "echo hi");
  await waitFor(() => out.includes("echo hi"));
  writePty(id, "\r");
  // pty 출력은 `\r\n`이다 — echo의 결과 줄 "hi\r\n"을 기다린다("hi\n"은 영영 안 나온다).
  await waitFor(() => out.includes("hi\r\n"));
  assert.equal(ptyStatuses([id])[id].lastCommand, "echo hi");
  killPty(id);
});

test("ptyStatuses reports working while a foreground job runs and idle once it ends", async () => {
  const cwd = tmpDir();
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  await waitFor(() => ptyAlive(id));
  await waitFor(() => !ptyStatuses([id])[id].working, 3000); // 프롬프트만 뜬 직후는 유휴다
  writePty(id, "sleep 2\r");
  await waitFor(() => ptyStatuses([id])[id].working, 3000);
  await waitFor(() => !ptyStatuses([id])[id].working, 5000);
  killPty(id);
});

test("ptyStatuses reports alive: false for a closed pty", () => {
  const cwd = tmpDir();
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  killPty(id);
  assert.deepEqual(ptyStatuses([id])[id], { lastCommand: "", working: false, alive: false });
});
