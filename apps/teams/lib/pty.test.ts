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
  killAllPtys,
  killPty,
  openPty,
  pidOf,
  ptyAlive,
  ptyStatuses,
  registerShutdownHandlers,
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

// zsh의 bracketed paste 모드 토글(`\x1b[?2004h`)처럼 `?`가 낀 CSI — 실측(zsh 실제 pty)에서
// 이 자리를 안 걷어내면 <마지막 명령>에 그 원문이 그대로 남는다.
test("extractLastCommand strips CSI escapes with a private-mode `?` parameter", () => {
  assert.equal(extractLastCommand("\x1b[?2004hhost% pwd"), "pwd");
});

// 버그 1 (0268315f) — OSC(창 제목·cwd 알림) 이스케이프가 매 프롬프트마다 붙는 커스텀 셸
// (이 머신의 zsh + starship류)에서 <마지막 명령>이 그 원문에 멈춰 다시 안 갈리던 사례.
test("extractLastCommand strips OSC title/cwd escapes before picking the command", () => {
  assert.equal(
    extractLastCommand("\x1b]0;user@host: ~/dir\x07\x1b]7;file:///dir\x07host% pwd"),
    "pwd",
  );
});

test("extractLastCommand strips OSC escapes even without a $/%/# marker", () => {
  assert.equal(extractLastCommand("\x1b]2;title\x07\x1b]1;dir\x07pwd"), "pwd");
});

// 이 티켓 — DECKPAM/DECKPNM(`\x1b=` · `\x1b>`)처럼 대괄호 없는 2바이트 이스케이프는
// ANSI_ESCAPE(CSI)·OSC_ESCAPE 둘 다 못 잡아 그대로 남았다(8b1d625c 실측).
test("extractLastCommand strips a bare DECKPAM/DECKPNM escape with no bracket", () => {
  assert.equal(extractLastCommand("\x1b=host% pwd"), "pwd");
  assert.equal(extractLastCommand("\x1b>pwd"), "pwd");
});

test("extractLastCommand caps the result at 200 characters, keeping the tail", () => {
  const long = "b".repeat(50) + "a".repeat(250); // 앞뒤가 다른 문자라야 방향을 실측한다
  const picked = extractLastCommand(`$ ${long}`);
  assert.equal(picked.length, 200);
  assert.equal(picked, long.slice(-200)); // 최신(뒤)이 남아야 한다 — 앞이 남으면 회귀
});

// 버그 2 (8b1d625c) — zsh 라인 에디터가 키 하나마다 "공백으로 지우기 - \r - 프롬프트 -
// 지금까지 친 글자"째 다시 찍는 실제 로그인 셸(AWS 프로필 + git 화살표 한 줄, $/%/# 로
// 안 끝난다). backlog 마지막 줄에 이 재그리기가 키 입력 수만큼 이어 붙는데, `\r` 뒤만
// 남기지 않으면 200자 상한이 맨 앞(첫 키 재그리기)에서 걸려 실제로 친 명령이 절대 안
// 드러난다(실측 원문은 8b1d625c.wip.md 참고).
function zshRedraw(typed: string): string {
  return `${" ".repeat(118)}\r \r\r AWS: Backend_Developer-282059277666  🔑   ~/Projects/dira  ↱ master  \x1b=${typed}`;
}

test("extractLastCommand follows a zsh full-line redraw prompt through every keystroke, not just the first", () => {
  // "sleep 20"을 한 글자씩 친 재그리기가 이어 붙은 모양 — 실제 backlog가 이렇게 쌓인다.
  const partials = ["s", "sl", "sle", "slee", "sleep", "sleep ", "sleep 2", "sleep 20"];
  const backlogLine = partials.map(zshRedraw).join("");
  assert.ok(extractLastCommand(backlogLine).endsWith("sleep 20"));

  // 다음 명령을 이어 쳐도(누적된 옛 재그리기 위에 새로 쌓여도) 최신 값으로 갈린다.
  const nextLine = backlogLine + ["e", "ec", "ech", "echo", "echo ", "echo z"].map(zshRedraw).join("");
  assert.ok(extractLastCommand(nextLine).endsWith("echo z"));
  assert.ok(!extractLastCommand(nextLine).endsWith("sleep 20")); // 첫 글자에 안 멈춘다
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

// 이 티켓 — §11-1 §개정. 서버가 정상 종료할 때 `kill <pid>`(SIGTERM)만 받고, 열려 있던 pty가
// 죽은 부모 밑에서 `ppid 1`로 재입양되지 않고 죽는지를 잰다.
test("killAllPtys terminates every open pty's process group", async () => {
  const cwd = tmpDir();
  const a = openPty(cwd, "/bin/sh") as { id: string };
  const b = openPty(cwd, "/bin/sh") as { id: string };
  await waitFor(() => ptyAlive(a.id) && ptyAlive(b.id));
  const gpidA = pidOf(a.id)!;
  const gpidB = pidOf(b.id)!;
  killAllPtys();
  assert.equal(ptyAlive(a.id), false);
  assert.equal(ptyAlive(b.id), false);
  for (const gpid of [gpidA, gpidB]) {
    await waitFor(() => {
      try {
        process.kill(-gpid, 0);
        return false; // 아직 있다 — ppid 1로 남았으면 이 자리가 영영 안 풀린다
      } catch {
        return true; // ESRCH — 그룹이 없다
      }
    }, 2000);
  }
});

// 이 파일이 Server Action 번들·라우트 핸들러 번들 두 벌로 로드돼도(머리 주석의 `globalThis`
// 실측과 같은 원인) 종료 훅은 한 번만 걸려야 한다 — 안 그러면 종료 한 번에 killAllPtys가
// 여러 번 돈다.
test("registerShutdownHandlers attaches SIGTERM/SIGINT/exit listeners only once", () => {
  const before = {
    term: process.listenerCount("SIGTERM"),
    int: process.listenerCount("SIGINT"),
    exit: process.listenerCount("exit"),
  };
  registerShutdownHandlers();
  registerShutdownHandlers();
  registerShutdownHandlers();
  assert.equal(process.listenerCount("SIGTERM"), before.term + 1);
  assert.equal(process.listenerCount("SIGINT"), before.int + 1);
  assert.equal(process.listenerCount("exit"), before.exit + 1);
});

test("ptyStatuses reports alive: false for a closed pty", () => {
  const cwd = tmpDir();
  const { id } = openPty(cwd, "/bin/sh") as { id: string };
  killPty(id);
  assert.deepEqual(ptyStatuses([id])[id], { lastCommand: "", working: false, alive: false });
});
