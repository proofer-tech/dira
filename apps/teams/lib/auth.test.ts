import { test } from "node:test";
import assert from "node:assert";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 토큰(~/.config/dira/oauth-token)을 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { normalizeToken, ptyLines, pollSetup, readAuth, saveToken, startSetup, stopSetup, tokenPath } =
  await import("./auth.ts");

test("tokenPath — TICKET_LOCAL을 존중하고 레지스트리와 같은 디렉터리다", () => {
  assert.strictEqual(tokenPath(), path.join(LOCAL, "oauth-token"));
});

test("readAuth — 파일이 없으면 savedAt이 null", async () => {
  assert.strictEqual((await readAuth()).savedAt, null);
});

test("saveToken — 개행 없이 쓰고, 다시 읽으면 있음으로 나오고, 권한이 0600", async () => {
  await saveToken(normalizeToken("  sk-ant-oat01-abc\n"));

  const raw = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
  assert.strictEqual(raw, "sk-ant-oat01-abc"); // 엔진이 `tr -d '\r\n'`으로 읽는 한 줄
  assert.strictEqual(statSync(tokenPath()).mode & 0o777, 0o600);

  const s = await readAuth();
  assert.match(s.savedAt!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("saveToken — 재발급이 기존 파일의 느슨한 권한을 0600으로 되돌린다", async () => {
  writeFileSync(tokenPath(), "old", { mode: 0o644 });
  await saveToken("sk-ant-oat01-new");
  assert.strictEqual(statSync(tokenPath()).mode & 0o777, 0o600);
});

test("normalizeToken — 비었거나 안에 공백이 있으면 거부, 접두사로는 거르지 않는다", () => {
  assert.throws(() => normalizeToken("   \n "), /비어 있습니다/);
  assert.throws(() => normalizeToken("sk-ant oat"), /공백/);
  assert.throws(() => normalizeToken("sk-ant\noat"), /공백/);
  // 형식은 우리 것이 아니다 — 접두사가 달라도 통과한다(§0-4)
  assert.strictEqual(normalizeToken(" whatever-the-cli-gives "), "whatever-the-cli-gives");
});

// ── ② 발급 — pty 드라이버 (DESIGN.md §0-4) ─────────────────────────────────

/** 픽스처는 **진짜 출력**이다: `script`로 `claude setup-token` 2.1.220을 실제로 몰아
 *  받은 바이트에서 각 모양을 한 줄씩 뽑았다(2026-07-31, `2ef82410`). */
const REAL = [
  "\x1b7\x1b[r\x1b8\x1b[?25h\x1b[?25l\x1b[?2004h\x1b[?2031hWelcome\x1b[9Gto\x1b[12GClaude\x1b[19GCode\x1b[24Gv2.1.220\r\r\n",
  "..........................................................\r\r\n",
  "\x1b[6G*\x1b[46G█████▓▓░\r\r\n",
  "\x1b]11;?\x07\x1b[c\x1b[>0q\x1b[c\x1b[2G✻\x1b[4GOpening\x1b[12Gbrowser\x1b[20Gto\x1b[23Gsign\x1b[28Gin…\r\r\n",
  "\r\x1b[1C\x1b[1A✽\r\r\n",
  "\r\x1b[1C\x1b[1A✢\r\r\n",
  "\r\x1b[1C\x1b[1ABrowser didn't open?\x1b[23GUse the url\x1b[35Gbelow\x1b[41Gto\x1b[44Gsign\x1b[49Gin\r\r\n",
  "\x1b]8;id=105chpj;https://claude.com/cai/oauth/authorize?code=true\x07https://claude.com/cai/oauth/authorize?code=true\x1b]8;;\x07\r\r\n",
  "\x1b[2GPaste\x1b[8Gcode\x1b[13Ghere\x1b[18Gif\x1b[21Gprompted\x1b[30G>\r\r\n",
].join("");

test("ptyLines — 커서 이동은 공백이 된다(걷어내면 낱말이 붙는다)", () => {
  const lines = ptyLines(REAL);
  assert.strictEqual(lines[0], "Welcome to Claude Code v2.1.220");
  assert.ok(lines.includes("✻ Opening browser to sign in…"));
  assert.ok(lines.includes("Browser didn't open? Use the url below to sign in"));
  assert.ok(lines.includes("Paste code here if prompted >"));
  // 통째로 걷어냈을 때의 모양이 하나도 없어야 한다
  assert.ok(!lines.some((l) => /Openingbrowser|Welcometo/.test(l)), lines.join("|"));
});

test("ptyLines — 배너 아스키아트·스피너 프레임·OSC는 남지 않는다", () => {
  const lines = ptyLines(REAL);
  assert.ok(!lines.some((l) => /[█▓░✽✢]|^\.+$/.test(l)), lines.join("|"));
  // OSC 8의 링크 타깃(`\x1b]8;id=...;<URL>\x07`)은 사라지고 본문 URL만 한 번 남는다
  assert.strictEqual(lines.filter((l) => l.includes("oauth/authorize")).length, 1);
  assert.ok(!lines.some((l) => l.includes("id=105chpj")), lines.join("|"));
  assert.ok(!lines.some((l) => l.includes("\x1b")), "escape가 남았다");
});

test("ptyLines — Ink가 다시 그린 같은 줄을 반복하지 않는다", () => {
  assert.deepStrictEqual(ptyLines("a\r\nb\r\nb\r\nb\r\na\r\n"), ["a", "b", "a"]);
});

/** `claude`를 PATH 스텁으로 갈아 끼운다 — `lib/workers.test.ts`의 crontab 스텁과 같은 수법이다.
 *  진짜 CLI를 몰면 사람의 자격증명이 회전한다(§0-4: 세션이 이 흐름을 끝까지 밟지 않는다). */
const BIN = mkdtempSync(path.join(tmpdir(), "fst-bin-"));
process.env.PATH = `${BIN}:${process.env.PATH}`;
process.on("exit", () => rmSync(BIN, { recursive: true, force: true }));

const PIDFILE = path.join(BIN, "pid");
function stubClaude(body: string) {
  writeFileSync(path.join(BIN, "claude"), `#!/bin/sh\necho $$ > ${PIDFILE}\n${body}\n`, {
    mode: 0o755,
  });
}

/** 스텁이 자기 pid를 여기 적는다. **startSetup 전에 지운다** — 앞 테스트가 남긴 값을 읽으면
 *  이미 죽은 pid를 살아 있는지 묻게 된다(실측: 그래서 세 번째 테스트가 헛돌았다). */
function armPidfile() {
  rmSync(PIDFILE, { force: true });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(p: () => boolean, ms = 8_000) {
  for (let i = 0; i < ms / 50 && !p(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(p(), "기다리던 상태가 오지 않았다");
}

test("startSetup — pty로 몰고, 토큰을 집어 저장하고, 프로세스를 남기지 않는다", async () => {
  // pty 폭이 200이어야 토큰이 줄바꿈으로 안 쪼개진다 — 스텁이 그 값을 직접 찍는다
  stubClaude(`stty size\nprintf 'Opening\\033[12Gbrowser\\r\\n'\nprintf 'sk-ant-oat01-${"x".repeat(40)}\\r\\n'\nsleep 60`);
  armPidfile();
  startSetup();
  await until(() => !!pollSetup().savedAt);

  const s = pollSetup();
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.error, undefined);
  assert.ok(s.lines.includes("50 200"), `pty 폭: ${s.lines.join("|")}`); // stty rows cols
  assert.ok(s.lines.includes("Opening browser"));
  // 파일엔 원문이 가지만 **화면엔 안 간다** — CLI가 토큰을 그대로 찍는다
  assert.ok(!s.lines.some((l) => l.includes("xxxx")), s.lines.join("|"));
  assert.ok(s.lines.includes("sk-ant-…"), s.lines.join("|"));
  const saved = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
  assert.strictEqual(saved, `sk-ant-oat01-${"x".repeat(40)}`);

  // `sleep 60`이 남아 있으면 다음 시도가 pty를 못 문다 — 그룹째 죽었는지 확인한다
  const pid = Number(readFileSync(PIDFILE, "utf8").trim());
  await until(() => !alive(pid));
});

test("startSetup — 토큰 없이 끝나면 조용히 실패하지 않는다", async () => {
  stubClaude("echo 'command not found: whatever'\nexit 7");
  armPidfile();
  startSetup();
  await until(() => !pollSetup().running);

  const s = pollSetup();
  assert.strictEqual(s.savedAt, undefined);
  assert.match(s.error!, /토큰을 받지 못한 채 끝났습니다 \(종료 코드 7\)/);
  assert.ok(!s.lines.some((l) => l.includes("__dira_setup_exit")), s.lines.join("|"));
  assert.ok(s.lines.includes("command not found: whatever"), s.lines.join("|"));
  stopSetup();
});

test("stopSetup — 다이얼로그를 닫으면 돌던 자식이 죽는다", async () => {
  stubClaude("sleep 60");
  armPidfile();
  startSetup();
  await until(() => existsSync(PIDFILE));
  const pid = Number(readFileSync(PIDFILE, "utf8").trim());
  await until(() => alive(pid));

  stopSetup();
  assert.strictEqual(pollSetup().running, false);
  await until(() => !alive(pid));
});
