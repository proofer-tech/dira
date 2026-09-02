import { test } from "node:test";
import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 토큰(~/.config/dira/oauth-token)을 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

// 층 ②의 저장 전 검증(`verifiedToken`)이 `POST /v1/messages`를 친다 — 테스트가 진짜 네트워크를
// 타지 않게 기본 스텁을 깐다. `401`이 아니면 통과라 CLI가 찍은 값이 그대로 저장된다.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
process.on("exit", () => (globalThis.fetch = realFetch));

const {
  addToken,
  captureEngineProfile,
  deleteEngineProfile,
  deleteToken,
  execClaude,
  findClaude,
  findExecutable,
  hasRegisteredToken,
  isEligible,
  normalizeToken,
  ptyLines,
  pollSetup,
  readAuth,
  readEngineProfileRows,
  readOtherEngineAuth,
  readTokenRows,
  readTokens,
  saveToken,
  setActiveEngineProfile,
  setActiveToken,
  setEngineProfileEnabled,
  setEngineProfileLabel,
  setTokenEnabled,
  setTokenLabel,
  startSetup,
  stopSetup,
  tokenPath,
  tokensPath,
  verifiedToken,
  writeTokens,
} = await import("./auth.ts");
const { multitokenPath, setMultiplayEnabled, setMultitoken } = await import("./projects.ts");

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
  // 앞선 `saveToken` 테스트들이 이 LOCAL의 oauth-token에 이미 값을 남겨 놨다 — 그 값이
  // 마이그레이션으로 eligible한 활성이 되면 addToken이 새 값을 대기로 넣는다(P179).
  // 이 테스트는 "pty가 잡은 값이 저장된다"만 재므로 빈 TICKET_LOCAL로 격리한다.
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-setup-"));
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

test("startSetup — 토막난 토큰(커서 이동 escape·줄바꿈으로 갈린)도 이어 집고, 진행 로그에도 조각이 안 남는다 (§0-4 §개정 `443dd1fa`)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-frag-"));
  // 실측(CLI 2.1.247)의 모양 그대로 세 토막(prefix + 35자 + 61자)이다 — 첫 경계는 커서 이동
  // escape, 둘째 경계는 실제 줄바꿈으로 접는다. 값은 지어낸 것이다(실물을 옮겨 적지 않는다).
  // 토큰 바로 뒤에 붙는 `Store`는 딸려 들어가면 안 되는 낱말이다
  const FRAG1 = "sk-ant-oa";
  const FRAG2 = "B".repeat(35);
  const FRAG3 = "C".repeat(61);
  const TOKEN = FRAG1 + FRAG2 + FRAG3;
  stubClaude(`printf '${FRAG1}\\033[46G${FRAG2}\\r\\n'\nprintf '${FRAG3} Store\\r\\n'\nsleep 60`);
  armPidfile();
  startSetup();
  await until(() => !!pollSetup().savedAt);

  const s = pollSetup();
  assert.strictEqual(s.error, undefined);
  const saved = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
  // 집은 값이 CLI가 찍은 토큰과 글자 하나까지 같다 — `Store`도, 공백·개행도 안 섞인다
  assert.strictEqual(saved, TOKEN);

  // 진행 로그의 가리기도 토막을 잡는다 — 원문 토막이 한 조각도 안 남는다
  assert.ok(!s.lines.some((l) => l.includes(FRAG2)), s.lines.join("|"));
  assert.ok(!s.lines.some((l) => l.includes(FRAG3)), s.lines.join("|"));
  assert.ok(s.lines.some((l) => l.includes("sk-ant-…")), s.lines.join("|"));

  stopSetup();
});

test("startSetup — 토막난 토큰이 서로 다른 청크로 갈려 와도(스케줄링에 안 기댄다) 머리를 다 볼 때까지 잠그지 않는다 (§0-4 §개정 `8f4712a6`)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-split-"));
  // 위 `443dd1fa` 픽스처와 같은 세 토막이지만, 두 `printf` 사이에 실제 간격(`sleep 0.3`)을
  // 끼워 **두 쓰기가 한 번의 read로 붙을 가능성을 없앤다** — PM 세션(2026-09-03)이 이 값으로
  // 로컬·GitHub Actions 러너 양쪽에서 갈린 청크를 재현했다. 첫 청크(FRAG1+FRAG2)는 그 자체로
  // `\r\n`에서 끝나 원문 끝에 닿는다 — 고친 `feed()`가 여기서 확정하면(옛 코드처럼) 44자만
  // 남고 뒤 61자(FRAG3)가 도착할 기회를 잃는다.
  const FRAG1 = "sk-ant-oa";
  const FRAG2 = "D".repeat(35);
  const FRAG3 = "E".repeat(61);
  const TOKEN = FRAG1 + FRAG2 + FRAG3;
  stubClaude(
    `printf '${FRAG1}\\033[46G${FRAG2}\\r\\n'\nsleep 0.3\nprintf '${FRAG3}\\r\\n'\nsleep 60`,
  );
  armPidfile();
  startSetup();
  await until(() => !!pollSetup().savedAt);

  const s = pollSetup();
  assert.strictEqual(s.error, undefined);
  const saved = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
  // 44자(FRAG1+FRAG2)가 아니라 세 토막을 다 이은 값이다 — 고치기 전 이 자리에서 44자가 났다
  // (본문 `## 결과`에 실측 기록)
  assert.strictEqual(saved, TOKEN);
  assert.ok(!s.lines.some((l) => l.includes(FRAG2)), s.lines.join("|"));
  assert.ok(!s.lines.some((l) => l.includes(FRAG3)), s.lines.join("|"));

  stopSetup();
});

test("startSetup — 발급 성공 뒤 CLI 안내문이 낱말 사이 공백 없이 커서 이동 escape로 이어져도 저장이 막히지 않는다 (§0-4 §개정 P359-2)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-tail-"));
  const TOKEN = "sk-ant-oat01-" + "x".repeat(40); // 53자
  // 신고(`eabc009b`, CLI 2.1.258)의 화면을 재구성한다 — 값은 지어낸 것이다. CLI가 발급 성공
  // 뒤에 붙이는 안내문이 Ink 레이아웃(낱말마다 절대 컬럼 배치)에서 낱말 사이 공백 없이 커서
  // 이동 escape(CHA)로만 이어진다. 붙는 꼬리(27자)가 지금 `MAX_TRIM`(24자)보다 길다.
  const TAIL_WORDS = ["Make", "sure", "to", "copy", "it", "now", "as", "you", "won"];
  const GLUED_TAIL = TAIL_WORDS.map((w) => `\\033[1G${w}`).join("");
  stubClaude(
    `printf 'Long-lived authentication token created successfully!\\r\\n'\n` +
      `printf 'Your OAuth token (valid for 1 year): ${TOKEN}${GLUED_TAIL}\\r\\n'\nsleep 60`,
  );
  armPidfile();

  // 401이 아니라 진짜 토큰 길이(53)에서만 성공을 준다 — 안내문까지 삼킨 값은 전부 401이다
  const { lens } = await withFetch(
    (n) => (n === TOKEN.length ? 200 : 401),
    async () => {
      startSetup();
      await until(() => !!pollSetup().savedAt || !!pollSetup().error);
    },
  );

  const s = pollSetup();
  assert.strictEqual(s.error, undefined, s.error);
  const saved = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
  assert.strictEqual(saved, TOKEN); // 앞도 뒤도 CLI 문구가 한 자도 안 붙는다
  assert.ok(
    !s.lines.some((l) => l.includes("Makesuretocopyitnowasyouwon")),
    s.lines.join("|"),
  ); // 진행 로그에도 토큰 조각이 안 남는다
  assert.ok(s.lines.some((l) => l.includes("sk-ant-…")), s.lines.join("|"));
  assert.deepStrictEqual(lens, [TOKEN.length + 27, TOKEN.length]); // 낱말 경계 하나만 더 물어 끝난다

  stopSetup();
});

test("startSetup — 토큰을 잡고 저장이 기록되기 전에 폴링이 끼어도 running:false+savedAt 없음+error 없음인 순간이 없다 (§0-13 §저장이 끝나면)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-window-"));
  stubClaude(`printf 'sk-ant-oat01-${"y".repeat(40)}\\r\\n'\nsleep 60`);
  armPidfile();
  startSetup();

  // `addToken()`의 저장이 끝날 때까지, 매 틱마다 촘촘히 읽는다 — settled 잠금과 savedAt 기록
  // 사이의 창을 한 번이라도 잡으면 실패다.
  const deadline = Date.now() + 8_000;
  let sawEmptyWindow = false;
  let s = pollSetup();
  while (Date.now() < deadline && s.savedAt === undefined && s.error === undefined) {
    if (!s.running) {
      sawEmptyWindow = true;
      break;
    }
    await new Promise((r) => setImmediate(r));
    s = pollSetup();
  }
  assert.ok(!sawEmptyWindow, "running:false + savedAt 없음 + error 없음인 창을 관측했다");
  assert.ok(s.savedAt, "저장이 기록되지 않고 창이 끝났다");

  stopSetup();
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

/** `.app`은 PATH가 launchd 기본값이라 `~/.local/bin/claude`가 안 보인다(`bcf66f01`).
 *  그 환경을 PATH로 그대로 재현한다 — 사람이 읽을 사유가 나와야 하고, `종료 코드 127`은 실패다. */
test("startSetup — claude가 PATH에 없으면 사유가 사람 말이다 (127이 아니다)", () => {
  stubClaude("exit 0"); // 스텁은 있지만 PATH에서 그 디렉터리를 뺀다
  const real = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"; // launchd 기본값
  try {
    assert.strictEqual(findClaude(), null);
    const s = startSetup();
    assert.strictEqual(s.running, false);
    assert.match(s.error!, /PATH에서 claude를 찾지 못했습니다/);
    assert.ok(!/종료 코드/.test(s.error!), s.error);
  } finally {
    process.env.PATH = real;
  }
  // 스텁이 다시 보이면 그 절대경로를 집는다 — 셸의 PATH 해석에 기대지 않는다
  assert.strictEqual(findClaude(), path.join(BIN, "claude"));
});

/** 층 ⓪ — 화면이 그리는 값은 `readAuth().cli`고 그 판정은 층 ②가 모는 `findClaude()` 그대로다.
 *  두 벌로 적으면 "있다고 했는데 눌렀더니 없다"가 생긴다(§0-4 ⓪). 픽스처는 위 PATH 스텁 그대로다. */
test("readAuth — CLI 경로를 같이 돌려주고, 없으면 null이다 (판정은 findClaude 하나)", async () => {
  stubClaude("exit 0");
  assert.strictEqual((await readAuth()).cli, path.join(BIN, "claude"));
  assert.strictEqual((await readAuth()).cli, findClaude()); // 화면이 보는 값 = 버튼이 쓰는 값

  const real = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"; // launchd 기본값 = 스텁이 안 보인다
  try {
    assert.strictEqual((await readAuth()).cli, null);
  } finally {
    process.env.PATH = real;
  }
});

test("findClaude — 실행 권한이 없거나 디렉터리면 건너뛴다", () => {
  const shadow = mkdtempSync(path.join(tmpdir(), "fst-shadow-"));
  process.on("exit", () => rmSync(shadow, { recursive: true, force: true }));
  mkdirSync(path.join(shadow, "claude")); // 디렉터리도 X_OK를 통과한다
  const noexec = mkdtempSync(path.join(tmpdir(), "fst-noexec-"));
  process.on("exit", () => rmSync(noexec, { recursive: true, force: true }));
  writeFileSync(path.join(noexec, "claude"), "#!/bin/sh\n", { mode: 0o644 });

  const real = process.env.PATH;
  process.env.PATH = `${shadow}:${noexec}:${BIN}`;
  try {
    assert.strictEqual(findClaude(), path.join(BIN, "claude")); // 앞의 둘을 넘어간다
  } finally {
    process.env.PATH = real;
  }
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

// ── 여러 계정 — `tokens.json` 그릇 (DESIGN.md §0-13) ─────────────────────────
//
// 위 테스트들이 이미 `tokenPath()`(oauth-token)를 여러 번 써 놓은 LOCAL이라, 마이그레이션·
// 손편집 판정을 깨끗한 전제에서 재려고 **이 구획만 다른 TICKET_LOCAL**을 쓴다. `tokenPath()`·
// `tokensPath()`는 호출마다 `process.env.TICKET_LOCAL`을 다시 읽으므로(재-import 불필요) 안전하다.
const LOCAL2 = mkdtempSync(path.join(tmpdir(), "fst-auth-tokens-"));
process.on("exit", () => rmSync(LOCAL2, { recursive: true, force: true }));

const sha256_12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

test("isEligible — enabled && (exhaustedUntil이 없거나 지났다), 그 한 줄", () => {
  assert.strictEqual(isEligible({ enabled: true, exhaustedUntil: null }), true);
  assert.strictEqual(isEligible({ enabled: false, exhaustedUntil: null }), false);
  const now = Math.floor(Date.now() / 1000);
  assert.strictEqual(isEligible({ enabled: true, exhaustedUntil: now + 60 }, now), false); // 아직 남아 있다
  assert.strictEqual(isEligible({ enabled: true, exhaustedUntil: now - 1 }, now), true); // 창이 지났다
});

test("hasRegisteredToken — §0-10 ① 문구가 갈리는 그 판정. eligible을 안 본다", () => {
  assert.strictEqual(hasRegisteredToken({}), false); // (a) 등록 0개 — 종전 문구
  assert.strictEqual(hasRegisteredToken({ claude: { active: "", tokens: [] } }), false);
  const exhausted = { id: "x", token: "t", addedAt: "", enabled: false, exhaustedUntil: 0 };
  assert.strictEqual(
    hasRegisteredToken({ claude: { active: "x", tokens: [exhausted] } }),
    true, // (b) 등록은 있고 전부 비활성/소진 — 새 문구. eligible 판정은 안 쓴다
  );
});

test("마이그레이션 — tokens.json이 없고 oauth-token만 있으면 항목 하나로 들여온다", async () => {
  process.env.TICKET_LOCAL = LOCAL2; // 이 구획부터 TICKET_LOCAL을 갈아 끼운다(위 §안내)
  assert.ok(!existsSync(tokensPath()));
  await saveToken("sk-ant-oat01-migrate-me");

  const file = await readTokens();
  const entry = file.claude!.tokens[0];
  assert.strictEqual(file.claude!.tokens.length, 1);
  assert.strictEqual(entry.token, "sk-ant-oat01-migrate-me");
  assert.strictEqual(entry.id, sha256_12("sk-ant-oat01-migrate-me"));
  assert.strictEqual(entry.enabled, true);
  assert.strictEqual(file.claude!.active, entry.id);
  // 잃는 것이 0이다 — oauth-token 내용이 그대로다
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-migrate-me");
  // tokens.json도 0600이다
  assert.strictEqual(statSync(tokensPath()).mode & 0o777, 0o600);
});

test("addToken — 같은 토큰을 두 번 추가해도 항목이 늘지 않는다(같은 id)", async () => {
  const a = await addToken("sk-ant-oat01-dup");
  const b = await addToken("sk-ant-oat01-dup");
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(a.id, sha256_12("sk-ant-oat01-dup"));

  const file = await readTokens();
  assert.strictEqual(file.claude!.tokens.filter((t) => t.id === a.id).length, 1);
});

test("addToken — 빈 목록에 첫 토큰을 넣으면 활성이 되고 oauth-token이 쓰인다(개행 없는 한 줄 · 0600)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-addactive-"));
  process.env.TICKET_LOCAL = local; // 이 테스트 구획은 빈 상태에서 재야 하므로 별도 LOCAL

  await addToken("sk-ant-oat01-first");
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-first");
  assert.strictEqual(statSync(tokenPath()).mode & 0o777, 0o600);

  const file = await readTokens();
  assert.strictEqual(file.claude!.active, sha256_12("sk-ant-oat01-first"));
});

test("addToken — eligible한 활성이 있으면 새로 추가해도 active가 안 움직인다(대기로 들어간다, P179)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-addpending-"));
  process.env.TICKET_LOCAL = local;
  await addToken("sk-ant-oat01-first"); // 첫 토큰 — eligible 0이었으므로 활성이 된다

  await addToken("sk-ant-oat01-second");
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-first", "active가 움직였다");

  const file = await readTokens();
  assert.strictEqual(file.claude!.active, sha256_12("sk-ant-oat01-first"));
  const second = file.claude!.tokens.find((t) => t.id === sha256_12("sk-ant-oat01-second"));
  assert.ok(second, "새 항목이 목록에 없다");

  // 중복 추가(이미 대기인 second를 다시 추가)도 active를 안 움직인다
  await addToken("sk-ant-oat01-second");
  assert.strictEqual((await readTokens()).claude!.active, sha256_12("sk-ant-oat01-first"));
});

test("addToken — eligible이 0이면(전부 소진/비활성) 새 토큰이 활성이 된다(§0-13 §화면, reconcileActive 재사용)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-addrevive-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-onlyone"); // 유일한 토큰 — 활성이다
  await setTokenEnabled(a.id, false); // eligible 0 — oauth-token이 지워진다
  assert.ok(!existsSync(tokenPath()));

  await addToken("sk-ant-oat01-fresh");
  const file = await readTokens();
  assert.strictEqual(file.claude!.active, sha256_12("sk-ant-oat01-fresh"), "eligible 0인데 새 토큰이 활성이 안 됐다");
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-fresh");
});

test("손편집 들여오기 — oauth-token이 목록 어느 것과도 안 맞으면 덮어쓰지 않고 새 항목으로 들여온다", async () => {
  const before = await readTokens();
  const beforeCount = before.claude!.tokens.length;

  writeFileSync(tokenPath(), "sk-ant-oat01-hand-edited", { mode: 0o600 });
  const after = await readTokens();

  assert.strictEqual(after.claude!.tokens.length, beforeCount + 1);
  const entry = after.claude!.tokens.find((t) => t.token === "sk-ant-oat01-hand-edited");
  assert.ok(entry, "손편집 값이 새 항목으로 안 들어왔다");
  assert.strictEqual(after.claude!.active, entry!.id);
  // 옛 항목들은 그대로다 — 조용히 지우지 않는다
  assert.ok(before.claude!.tokens.every((t) => after.claude!.tokens.some((u) => u.id === t.id)));
});

test("eligible이 0이 되면 oauth-token을 지운다", async () => {
  const id = sha256_12("sk-ant-oat01-solo");
  await writeTokens({
    claude: { active: id, tokens: [{ id, token: "sk-ant-oat01-solo", addedAt: "x", enabled: true, exhaustedUntil: null }] },
  });
  assert.ok(existsSync(tokenPath()));

  await writeTokens({
    claude: { active: id, tokens: [{ id, token: "sk-ant-oat01-solo", addedAt: "x", enabled: false, exhaustedUntil: null }] },
  });
  assert.ok(!existsSync(tokenPath()), "eligible 0인데 oauth-token이 안 지워졌다");
});

// ── 화면 — 목록 · 활성화/비활성화 · 삭제 (DESIGN.md §0-13 §화면 · P169-2) ───────
//
// 이 구획도 깨끗한 전제가 필요해서(위 손편집 테스트가 LOCAL2에 항목을 여럿 남겨 놨다) 새
// TICKET_LOCAL을 쓴다.
const LOCAL3 = mkdtempSync(path.join(tmpdir(), "fst-auth-rows-"));
process.on("exit", () => rmSync(LOCAL3, { recursive: true, force: true }));

test("readTokenRows — label 기본값·가린 값·상태 넷을 그대로 낸다", async () => {
  process.env.TICKET_LOCAL = LOCAL3;
  const a = await addToken("sk-ant-oat01-aaaaaaaaaaaaaaaaaaaa", "A계정"); // 첫 토큰 — 활성이다
  const b = await addToken("sk-ant-oat01-bbbbbbbbbbbbbbbbbbbb"); // label 없음 → 계정 n, 대기로 들어간다(P179)
  await setTokenEnabled(a.id, false); // 활성(a)을 끄면 그 자리에서 b로 넘어간다

  const rows = await readTokenRows();
  assert.strictEqual(rows.length, 2);

  const rowA = rows.find((r) => r.id === a.id)!;
  assert.strictEqual(rowA.label, "A계정");
  assert.ok(!rowA.masked.includes(a.token), "가린 값에 원문이 그대로 있다");
  assert.match(rowA.masked, /^sk-ant-oat…[a-z]{4}$/);
  assert.deepStrictEqual(rowA.status, { kind: "disabled" });

  const rowB = rows.find((r) => r.id === b.id)!;
  assert.strictEqual(rowB.label, "계정 2"); // 순번은 배열 순서다 — b가 두 번째로 추가됐다
  assert.deepStrictEqual(rowB.status, { kind: "active" }); // 지금 oauth-token에 있는 것
});

test("readTokenRows — eligible이 0이 되면 active가 가리키던 그 항목도 활성으로 안 보인다", async () => {
  // active를 옮길 데가 없으면 `active` 필드는 그 자리에 머문다(reconcileActive) — 하지만
  // `oauth-token`은 이미 지워졌으므로 화면이 그 항목을 `활성`으로 그리면 거짓말이다
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-noeligible-"));
  process.env.TICKET_LOCAL = local;
  const now = Math.floor(Date.now() / 1000);
  const a = await addToken("sk-ant-oat01-lastone"); // 유일한 토큰 — 활성이다

  await writeTokens({
    claude: {
      active: a.id,
      tokens: [{ id: a.id, token: "sk-ant-oat01-lastone", addedAt: "x", enabled: false, exhaustedUntil: now + 999 }],
    },
  });
  assert.ok(!existsSync(tokenPath()), "eligible 0인데 oauth-token이 안 지워졌다");

  const rows = await readTokenRows();
  assert.strictEqual(rows.length, 1);
  assert.notStrictEqual(rows[0].status.kind, "active", "지워진 oauth-token을 여전히 활성으로 그린다");
  assert.strictEqual(rows[0].status.kind, "disabled"); // enabled:false가 이겼다(§0-13 §상태 표시 순서)
});

// ── §0-18 §동시사용 — eligible 전부가 활성이다 (요구 8eaa1a74) ──────────────────

test("readTokenRows — 동시사용을 켜면 eligible 전부가 active고 pending은 0개다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-simul-on-"));
  process.env.TICKET_LOCAL = local;
  try {
    const a = await addToken("sk-ant-oat01-simul-aaaa"); // 활성
    const b = await addToken("sk-ant-oat01-simul-bbbb"); // 켜기 전이면 대기
    const c = await addToken("sk-ant-oat01-simul-cccc"); // 켜기 전이면 대기
    await setTokenEnabled(c.id, false); // eligible에서 뺀다 — 켜져도 이건 그대로 disabled다

    await setMultiplayEnabled(true);
    const rows = await readTokenRows();
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.find((r) => r.id === a.id)!.status, { kind: "active" });
    assert.deepStrictEqual(rows.find((r) => r.id === b.id)!.status, { kind: "active" });
    assert.deepStrictEqual(rows.find((r) => r.id === c.id)!.status, { kind: "disabled" });
    assert.ok(!rows.some((r) => r.status.kind === "pending"), "동시사용에서 pending이 남았다");

    // `tokens.json`이 실제로 가리키는 것은 a 하나뿐이다 — 배지는 셋 다 active지만 shared는 하나뿐
    assert.strictEqual(rows.find((r) => r.id === a.id)!.shared, true);
    assert.strictEqual(rows.find((r) => r.id === b.id)!.shared, false);
    assert.strictEqual(rows.find((r) => r.id === c.id)!.shared, false);
  } finally {
    await setMultiplayEnabled(false);
  }
});

test("readTokenRows — 동시사용 중 한 행을 비활성화하면 그 행만 갈린다(재시작 없이 같은 읽기)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-simul-toggle-"));
  process.env.TICKET_LOCAL = local;
  try {
    const a = await addToken("sk-ant-oat01-simul2-aaaa");
    const b = await addToken("sk-ant-oat01-simul2-bbbb");
    await setMultiplayEnabled(true);

    assert.deepStrictEqual((await readTokenRows()).find((r) => r.id === b.id)!.status, { kind: "active" });

    await setTokenEnabled(b.id, false);
    const rows = await readTokenRows();
    assert.deepStrictEqual(rows.find((r) => r.id === b.id)!.status, { kind: "disabled" });
    assert.deepStrictEqual(rows.find((r) => r.id === a.id)!.status, { kind: "active" }); // 나머지는 그대로다
  } finally {
    await setMultiplayEnabled(false);
  }
});

test("readTokenRows — 동시사용을 끄면 같은 읽기에서 대기가 돌아온다(재시작 불필요)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-simul-off-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-simul3-aaaa");
  const b = await addToken("sk-ant-oat01-simul3-bbbb");

  await setMultiplayEnabled(true);
  assert.deepStrictEqual((await readTokenRows()).find((r) => r.id === b.id)!.status, { kind: "active" });

  await setMultiplayEnabled(false);
  const rows = await readTokenRows();
  assert.deepStrictEqual(rows.find((r) => r.id === a.id)!.status, { kind: "active" });
  assert.deepStrictEqual(rows.find((r) => r.id === b.id)!.status, { kind: "pending" });
});

test("readTokenRows — `사용` 버튼 조건(eligible && !shared)이 동시사용 켬/끔에서 만드는 집합이 종전과 같다", async () => {
  // 종전 조건은 `status.kind === "pending"`이었다. 새 조건은
  // `(kind === "active" || kind === "pending") && !shared`다 — 꺼진 상태에서는 `active`
  // 행이 항상 `shared`이므로(오직 `active`가 가리키는 항목만 그 kind를 받는다) 두 조건이
  // 만드는 집합이 글자 그대로 같다(§검증 5).
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-button-parity-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-parity-aaaa");
  const b = await addToken("sk-ant-oat01-parity-bbbb");
  await addToken("sk-ant-oat01-parity-cccc");

  const oldButtonSet = (rows: { id: string; status: { kind: string } }[]) =>
    rows.filter((r) => r.status.kind === "pending").map((r) => r.id);
  const newButtonSet = (rows: { id: string; status: { kind: string }; shared: boolean }[]) =>
    rows
      .filter((r) => (r.status.kind === "active" || r.status.kind === "pending") && !r.shared)
      .map((r) => r.id);

  const offRows = await readTokenRows();
  assert.deepStrictEqual(new Set(newButtonSet(offRows)), new Set(oldButtonSet(offRows)));
  assert.deepStrictEqual(new Set(newButtonSet(offRows)), new Set([b.id, offRows.find((r) => r.id !== a.id && r.id !== b.id)!.id]));

  await setMultiplayEnabled(true);
  try {
    const onRows = await readTokenRows();
    // 동시사용에서는 shared가 아닌 eligible 전부가 여전히 버튼을 받는다 — 배지만 바뀌었다
    assert.deepStrictEqual(new Set(newButtonSet(onRows)), new Set(oldButtonSet(offRows)));
  } finally {
    await setMultiplayEnabled(false);
  }
});

test("setTokenEnabled — 활성 토큰을 비활성화하면 그 자리에서 다음 eligible로 넘어간다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-rotate-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-rotate-a"); // 첫 토큰 — 활성이다
  const b = await addToken("sk-ant-oat01-rotate-b"); // eligible 활성(a)이 있으므로 대기다(P179)

  await setTokenEnabled(a.id, false); // 활성(a)을 끈다 — b로 넘어가야 한다
  const file = await readTokens();
  assert.strictEqual(file.claude!.active, b.id, "다음 eligible(b)로 안 넘어갔다");
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-rotate-b");

  // 남은 것마저 꺼지면 eligible이 0이다 — oauth-token이 지워진다(막지 않는다)
  await setTokenEnabled(b.id, false);
  assert.ok(!existsSync(tokenPath()));
});

test("deleteToken — 활성 토큰을 지워도 다음 eligible로 넘어가고, 마지막 하나도 막지 않는다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-delete-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-del-a"); // 첫 토큰 — 활성이다
  const b = await addToken("sk-ant-oat01-del-b"); // eligible 활성(a)이 있으므로 대기다(P179)

  await deleteToken(a.id); // 활성 토큰을 지운다 — b로 넘어가야 한다
  let file = await readTokens();
  assert.strictEqual(file.claude!.tokens.length, 1);
  assert.strictEqual(file.claude!.active, b.id);
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-del-b");

  await deleteToken(b.id); // 마지막 하나 — 막지 않는다
  file = await readTokens();
  assert.strictEqual(file.claude!.tokens.length, 0);
  assert.ok(!existsSync(tokenPath()));
});

test("setActiveToken — `대기` 행의 `사용`이 그 id를 활성으로 만들고 oauth-token을 다시 쓴다(P179)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-use-"));
  process.env.TICKET_LOCAL = local;
  await addToken("sk-ant-oat01-use-a"); // 첫 토큰 — 활성이 된다
  const b = await addToken("sk-ant-oat01-use-b"); // 대기다(P179)

  await setActiveToken(b.id);
  const file = await readTokens();
  assert.strictEqual(file.claude!.active, b.id);
  assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-use-b");

  // 목록에 없는 id는 조용히 무시한다 — active가 안 바뀐다
  await setActiveToken("no-such-id");
  assert.strictEqual((await readTokens()).claude!.active, b.id);
});

test("setTokenLabel — label만 갈고, 지우면(빈 값) 계정 N 순번으로 돌아간다 (P180-1)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-label-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-label-a"); // 첫 토큰 — 활성이다
  await addToken("sk-ant-oat01-label-b"); // eligible 활성(a)이 있으므로 대기다(P179)

  await setTokenLabel(a.id, "a@example.com");
  let rows = await readTokenRows();
  assert.strictEqual(rows.find((r) => r.id === a.id)!.label, "a@example.com");
  assert.strictEqual(rows.find((r) => r.id === a.id)!.rawLabel, "a@example.com");
  // token·id·enabled·exhaustedUntil·active는 그대로다 — label 한 줄만 갈렸다
  let file = await readTokens();
  const entryA = file.claude!.tokens.find((t) => t.id === a.id)!;
  assert.strictEqual(entryA.token, "sk-ant-oat01-label-a");
  assert.strictEqual(entryA.enabled, true);
  assert.strictEqual(entryA.exhaustedUntil, null);
  assert.strictEqual(file.claude!.active, a.id);

  await setTokenLabel(a.id, "   "); // 공백만 — 빈 값과 같다
  rows = await readTokenRows();
  const rowA = rows.find((r) => r.id === a.id)!;
  assert.strictEqual(rowA.label, "계정 1");
  assert.strictEqual(rowA.rawLabel, "");
  file = await readTokens();
  assert.strictEqual("label" in file.claude!.tokens.find((t) => t.id === a.id)!, false);
});

// ── 잠금 — 배포물은 계정 하나다 (DESIGN.md §0-13 §잠금, 티켓 1b7c785f) ──────────────
//
// 이 파일의 나머지 테스트는 전부 해금(package.json의 `test` 스크립트가 `DIRA_MULTI_TOKEN=1`을
// 준다)을 가정한다. 아래만 그 값을 지역적으로 지워 잠금 빌드를 흉내낸다 — `flags.test.ts`와
// 같은 save/restore 관용구다.

test("addToken — 잠김에서는 append가 아니라 active 자리 교체다(항목이 안 는다) (§0-13 §잠금 계약 ①, 판정은 multitoken 파일로도 갈린다 §0-18)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-lock-add-"));
  process.env.TICKET_LOCAL = local;
  try {
    // 플래그 대신 파일로 잠근다 — `DIRA_MULTI_TOKEN=1`(package.json test 스크립트)이 켜져
    // 있어도 파일이 이긴다(§0-18 §판정 한 자리)
    await setMultitoken(false);

    const a = await addToken("sk-ant-oat01-lock-a"); // 빈 목록 — 항목 하나로 시작
    assert.strictEqual((await readTokens()).claude!.tokens.length, 1);

    const b = await addToken("sk-ant-oat01-lock-b"); // 잠김 — a의 자리를 갈아 끼운다
    const file = await readTokens();
    assert.strictEqual(file.claude!.tokens.length, 1); // 항목이 안 늘었다
    assert.strictEqual(file.claude!.active, b.id);
    assert.strictEqual(readFileSync(tokenPath(), "utf8"), "sk-ant-oat01-lock-b");
    void a;
  } finally {
    rmSync(multitokenPath(), { force: true });
  }
});

test("readTokenRows — 잠김에서는 행이 active 하나뿐이다 (§0-13 §잠금 계약 ②)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-lock-rows-"));
  process.env.TICKET_LOCAL = local;
  const a = await addToken("sk-ant-oat01-lockrows-a"); // 해금 상태로 심는다 — 활성
  await addToken("sk-ant-oat01-lockrows-b"); // 대기

  assert.strictEqual((await readTokenRows()).length, 2); // 지금은 해금이다

  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN; // 잠금 빌드로 같은 파일을 연다
    const rows = await readTokenRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, a.id);
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
  }
});

test("잠금 — 항목 3개짜리 tokens.json을 잠금 빌드로 열고 추가·삭제해도 나머지 항목이 그대로다 (§0-13 §잠금 계약 ③)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-lock-fixture-"));
  process.env.TICKET_LOCAL = local;

  // 픽스처를 writeTokens로 직접 심는다 — "이미 여러 개인 tokens.json을 잠금 빌드가 만난다"를
  // 그대로 흉내낸다(§0-13 §잠금 계약 ③이 막으려는 그 상황).
  const activeA = {
    id: "a".repeat(12),
    token: "sk-ant-oat01-fixture-a",
    addedAt: "2026-08-01T00:00:00.000Z",
    enabled: true,
    exhaustedUntil: null,
  };
  const untouchedB = {
    id: "b".repeat(12),
    label: "B계정",
    token: "sk-ant-oat01-fixture-b",
    addedAt: "2026-08-02T00:00:00.000Z",
    enabled: true,
    exhaustedUntil: null,
  };
  const untouchedC = {
    id: "c".repeat(12),
    label: "C계정",
    token: "sk-ant-oat01-fixture-c",
    addedAt: "2026-08-03T00:00:00.000Z",
    enabled: false,
    exhaustedUntil: null,
  };
  await writeTokens({ claude: { active: activeA.id, tokens: [activeA, untouchedB, untouchedC] } });

  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN; // 잠금 빌드

    const rows = await readTokenRows();
    assert.strictEqual(rows.length, 1); // 계약 ②
    assert.strictEqual(rows[0].id, activeA.id);

    const x = await addToken("sk-ant-oat01-fixture-x"); // 추가 — active 자리(a) 교체
    let file = await readTokens();
    assert.strictEqual(file.claude!.tokens.length, 3); // 계약 ① — 3개 그대로
    assert.strictEqual(file.claude!.active, x.id);
    assert.deepStrictEqual(file.claude!.tokens[1], untouchedB); // b는 손 안 댔다
    assert.deepStrictEqual(file.claude!.tokens[2], untouchedC); // c도 손 안 댔다

    await deleteToken(x.id); // 지금 보이는 유일한 행(방금 활성이 된 x)을 지운다
    file = await readTokens();
    assert.strictEqual(file.claude!.tokens.length, 2);
    assert.deepStrictEqual(file.claude!.tokens[0], untouchedB); // 계약 ③ — 나머지가 그대로다
    assert.deepStrictEqual(file.claude!.tokens[1], untouchedC);
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
  }
});

// ── 다른 엔진의 상태 층 — 판정 없이 사실만 (DESIGN.md §0-4 §개정 `b0966e66`) ─────────

test("findExecutable — 일반화한 탐색이 findClaude와 같은 경로를 낸다", () => {
  // BIN에는 이미 위에서 만든 `claude` 스텁이 있다 — 이름만 바꿔 부르면 같은 값이어야 한다
  assert.strictEqual(findExecutable("claude"), findClaude());
  assert.strictEqual(findExecutable("생전-없는-실행파일"), null);
});

// ── execClaude — exec 대상 판정, findClaude(표시용)와 따로 (DESIGN.md §24 §개정) ────────

test("execClaude — 고정 경로($TICKET_LOCAL/bin/dira)가 실행 가능하면 findClaude보다 그것을 우선한다", () => {
  // 앞선 테스트 구획들이 process.env.TICKET_LOCAL을 각자 갈아 끼워 놨다 — 이 테스트만의 값으로 격리한다
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-exec-"));
  const realLocal = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  const fixed = path.join(local, "bin", "dira");
  mkdirSync(path.dirname(fixed), { recursive: true });
  writeFileSync(fixed, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  try {
    stubClaude("exit 0"); // PATH에도 있지만 고정 경로가 이긴다
    assert.strictEqual(execClaude(), fixed);
    assert.notStrictEqual(execClaude(), findClaude());
  } finally {
    process.env.TICKET_LOCAL = realLocal;
    rmSync(local, { recursive: true, force: true });
  }
});

test("execClaude — 고정 경로가 없거나 실행 불가면 findClaude()로 떨어진다", () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-auth-exec-"));
  const realLocal = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  const fixed = path.join(local, "bin", "dira");
  try {
    stubClaude("exit 0");
    assert.strictEqual(execClaude(), findClaude()); // 고정 경로가 아예 없다

    mkdirSync(path.dirname(fixed), { recursive: true });
    writeFileSync(fixed, "#!/bin/sh\nexit 0\n", { mode: 0o644 }); // 있지만 실행 권한 없음
    assert.strictEqual(execClaude(), findClaude());
  } finally {
    process.env.TICKET_LOCAL = realLocal;
    rmSync(local, { recursive: true, force: true });
  }
});

test("readOtherEngineAuth — codex·grok은 파일 유무로 문구가 갈리고, agy는 상시 문구다", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fst-auth-home-"));
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));

  const before = await readOtherEngineAuth(home);
  assert.deepStrictEqual(
    before.map((e) => e.engine),
    ["codex", "grok", "agy"],
  );
  assert.strictEqual(before.find((e) => e.engine === "codex")!.credPath, null);
  assert.strictEqual(before.find((e) => e.engine === "grok")!.credPath, null);
  const agy = before.find((e) => e.engine === "agy")!;
  assert.strictEqual(agy.credPath, null);
  assert.strictEqual(agy.credMtime, null); // 키체인이라 파일 유무를 애초에 안 잰다

  mkdirSync(path.join(home, ".codex"), { recursive: true });
  writeFileSync(path.join(home, ".codex", "auth.json"), "{}");

  const after = await readOtherEngineAuth(home);
  const codex = after.find((e) => e.engine === "codex")!;
  assert.strictEqual(codex.credPath, path.join(home, ".codex", "auth.json"));
  assert.match(codex.credMtime!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.strictEqual(after.find((e) => e.engine === "grok")!.credPath, null); // grok은 안 갈렸다
});

test("readOtherEngineAuth — CLI 탐색은 findExecutable(엔진 실행파일 이름) 그대로다", async () => {
  writeFileSync(path.join(BIN, "codex"), "#!/bin/sh\n", { mode: 0o755 });
  const rows = await readOtherEngineAuth(mkdtempSync(path.join(tmpdir(), "fst-auth-home2-")));
  assert.strictEqual(rows.find((e) => e.engine === "codex")!.cli, path.join(BIN, "codex"));
  // 이 머신에 진짜 grok·agy가 깔려 있을 수 있다(§0-4는 그걸 몰라야 한다는 계약이 아니다) —
  // 값이 없다는 것이 아니라 **같은 판정 함수를 부른다는 것**을 잰다
  assert.strictEqual(rows.find((e) => e.engine === "grok")!.cli, findExecutable("grok"));
  assert.strictEqual(rows.find((e) => e.engine === "agy")!.cli, findExecutable("agy"));
});

// ── codex · grok 프로필 — 계정 목록 (DESIGN.md §0-23 §그릇 §잠금 §화면) ────────────

/** `~/.codex` 자리의 픽스처 — `auth.json` 하나(권한 `0600`)를 든 홈 디렉터리다. */
function makeEngineHome(rel: string): string {
  const home = mkdtempSync(path.join(tmpdir(), "fst-auth-enginehome-"));
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, rel), { recursive: true });
  writeFileSync(path.join(home, rel, "auth.json"), '{"ok":true}', { mode: 0o600 });
  return home;
}

function engineDir(engine: "codex" | "grok", id: string): string {
  return path.join(path.dirname(tokensPath()), "engines", engine, id);
}

test("captureEngineProfile — 원본을 통째로 복사한다. 디렉터리 0700, 안의 파일은 원본 권한 그대로", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-capture-")); // 빈 상태에서 잰다
  const home = makeEngineHome(".codex");
  const entry = await captureEngineProfile("codex", home);

  const dir = engineDir("codex", entry.id);
  assert.strictEqual(statSync(dir).mode & 0o777, 0o700);
  assert.strictEqual(readFileSync(path.join(dir, "auth.json"), "utf8"), '{"ok":true}');
  assert.strictEqual(statSync(path.join(dir, "auth.json")).mode & 0o777, 0o600);

  // 첫 담기 — 곧바로 활성이고 tokens.json에는 이름표뿐이다(`token` 칸이 없다)
  const file = await readTokens();
  assert.strictEqual(file.codex!.active, entry.id);
  assert.deepStrictEqual(file.codex!.profiles, [entry]);
  assert.ok(!("token" in entry));
});

test("captureEngineProfile — 원본이 없으면 던진다(버튼이 이미 막지만 방어로 한 번 더 잰다)", async () => {
  const emptyHome = mkdtempSync(path.join(tmpdir(), "fst-auth-nohome-"));
  process.on("exit", () => rmSync(emptyHome, { recursive: true, force: true }));
  await assert.rejects(() => captureEngineProfile("codex", emptyHome));
});

test("captureEngineProfile — claude 토큰을 쓰는 동안 codex 프로필이 안 사라진다(TokensFile 여러 키)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-multikey-"));
  const home = makeEngineHome(".codex");
  const entry = await captureEngineProfile("codex", home);

  await addToken("sk-ant-oat01-fixture-multi"); // claude 쪽 writeTokens 호출

  const file = await readTokens();
  assert.strictEqual(file.codex!.profiles.length, 1); // codex 항목이 살아 있다
  assert.strictEqual(file.codex!.profiles[0].id, entry.id);
  assert.ok(file.claude!.tokens.some((t) => t.token === "sk-ant-oat01-fixture-multi"));
});

test("captureEngineProfile · setEngineProfileEnabled · deleteEngineProfile — 잠금 밖에서는 append, 활성/삭제가 claude와 같은 판정", async () => {
  process.env.DIRA_MULTI_TOKEN = "1";
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-grokflow-"));
  const homeA = makeEngineHome(".grok");
  const homeB = makeEngineHome(".grok");

  const a = await captureEngineProfile("grok", homeA);
  const b = await captureEngineProfile("grok", homeB);
  let file = await readTokens();
  assert.strictEqual(file.grok!.profiles.length, 2); // append — 안 겹친다
  assert.strictEqual(file.grok!.active, a.id); // 활성은 안 움직인다(eligible한 활성이 이미 있다)

  await setEngineProfileEnabled("grok", a.id, false); // 활성을 끄면 다음 eligible(b)로 넘어간다
  file = await readTokens();
  assert.strictEqual(file.grok!.active, b.id);

  await setEngineProfileLabel("grok", b.id, "  둘째 계정  ");
  const rows = await readEngineProfileRows("grok");
  assert.strictEqual(rows.find((r) => r.id === b.id)!.label, "둘째 계정"); // trim

  await deleteEngineProfile("grok", b.id); // 항목 + engines/grok/<id>/ 둘 다 지운다
  file = await readTokens();
  assert.strictEqual(file.grok!.profiles.length, 1);
  assert.strictEqual(existsSync(engineDir("grok", b.id)), false);
  assert.strictEqual(existsSync(engineDir("grok", a.id)), true); // a는 그대로다
});

test("captureEngineProfile — 잠금 빌드에서는 append가 아니라 active 자리 교체다(§0-23 §잠금 계약 ①)", async () => {
  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN; // 잠금 빌드
    process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-codexlock-"));

    const homeA = makeEngineHome(".codex");
    const a = await captureEngineProfile("codex", homeA);
    let file = await readTokens();
    assert.strictEqual(file.codex!.profiles.length, 1);

    const homeB = makeEngineHome(".codex");
    const b = await captureEngineProfile("codex", homeB);
    file = await readTokens();
    assert.strictEqual(file.codex!.profiles.length, 1); // 계약 ① — 항목 수가 안 늘었다
    assert.strictEqual(file.codex!.active, b.id);
    assert.strictEqual(file.codex!.profiles[0].id, b.id);
    // a의 디렉터리는 지우지 않는다(§0-23 §잠금 계약 ③과 같은 결 — 지우는 손은 `삭제` 하나뿐)
    assert.strictEqual(existsSync(engineDir("codex", a.id)), true);
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
  }
});

test("readEngineProfileRows — 잠금 빌드에서는 행이 최대 하나고, 이미 여러 개인 파일을 만나도 항목·디렉터리를 안 지운다(§0-23 §잠금 계약 ②③)", async () => {
  const activeA: import("./auth.ts").ProfileEntry = {
    id: "a".repeat(12),
    addedAt: "2026-08-01T00:00:00.000Z",
    enabled: true,
    exhaustedUntil: null,
  };
  const untouchedB: import("./auth.ts").ProfileEntry = {
    id: "b".repeat(12),
    label: "B계정",
    addedAt: "2026-08-02T00:00:00.000Z",
    enabled: true,
    exhaustedUntil: null,
  };
  await writeTokens({ codex: { active: activeA.id, profiles: [activeA, untouchedB] } });

  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN; // 잠금 빌드

    const rows = await readEngineProfileRows("codex");
    assert.strictEqual(rows.length, 1); // 계약 ②
    assert.strictEqual(rows[0].id, activeA.id);

    const file = await readTokens();
    assert.strictEqual(file.codex!.profiles.length, 2); // 계약 ③ — 항목을 안 지운다(읽기만으로는)
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
  }
});

test("setActiveEngineProfile — 목록에 없는 id는 조용히 무시한다(방어)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-noop-"));
  const home = makeEngineHome(".grok");
  const entry = await captureEngineProfile("grok", home);
  await setActiveEngineProfile("grok", "생전-없는-id");
  const file = await readTokens();
  assert.strictEqual(file.grok!.active, entry.id); // 안 바뀌었다
});

// ── 층 ② 저장 전 검증 — 재그리기 잔여물을 떼어 낸다 (auth.ts `verifiedToken`) ────────────
//
// `foldRaw`가 커서 이동을 지우고 이어 붙이므로 Ink 재그리기가 토큰 뒤에 달라붙고, 상한 없는
// `TOKEN_RE`가 그것까지 삼킨다(실측 2026-08-29: 113자 401 / 앞 108자 200).

/** `globalThis.fetch`를 잠깐 바꿔 낀다 — 진짜 네트워크를 안 탄다. `byLen`이 길이별 상태를 준다. */
async function withFetch<T>(
  byLen: (n: number) => number | "throw",
  body: () => Promise<T>,
): Promise<{ result: T; lens: number[] }> {
  const orig = globalThis.fetch;
  const lens: number[] = [];
  globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
    const tok = init.headers.authorization.slice("Bearer ".length);
    lens.push(tok.length);
    const st = byLen(tok.length);
    if (st === "throw") throw new Error("네트워크 끊김");
    return new Response("{}", { status: st });
  }) as unknown as typeof fetch;
  try {
    return { result: await body(), lens };
  } finally {
    globalThis.fetch = orig;
  }
}

test("verifiedToken — 깨끗하게 잡힌 값은 그대로, 호출은 한 번뿐이다", async () => {
  const tok = "sk-ant-oat01-" + "x".repeat(95); // 108자
  const { result, lens } = await withFetch(
    () => 200,
    () => verifiedToken(tok),
  );
  assert.deepStrictEqual(result, { token: tok });
  assert.deepStrictEqual(lens, [108]); // 트림을 안 돈다 — 보통 경우가 호출 하나다
});

test("verifiedToken — 뒤에 붙은 재그리기 잔여물을 떼고 인증되는 값을 고른다", async () => {
  const real = "sk-ant-oat01-" + "x".repeat(95); // 108자
  const { result, lens } = await withFetch(
    (n) => (n === real.length ? 200 : 401),
    () => verifiedToken(real + "AbC9z"), // 실측과 같은 5자 잔여물
  );
  assert.deepStrictEqual(result, { token: real });
  assert.deepStrictEqual(lens, [113, 112, 111, 110, 109, 108]); // 뒤에서 한 자씩
});

test("verifiedToken — 판정은 200이 아니라 `401이 아니다`다(한도에 닿은 계정은 429다)", async () => {
  const tok = "sk-ant-oat01-" + "x".repeat(95);
  const { result, lens } = await withFetch(
    () => 429,
    () => verifiedToken(tok),
  );
  assert.deepStrictEqual(result, { token: tok }); // 429는 멀쩡한 토큰이다 — 자르지 않는다
  assert.deepStrictEqual(lens, [108]);
});

test("verifiedToken — 어느 길이도 인증이 안 되면 사유를 돌려준다(쓰레기를 안 담는다)", async () => {
  const { result } = await withFetch(
    () => 401,
    () => verifiedToken("sk-ant-oa01-" + "x".repeat(122)),
  );
  assert.ok("error" in result, "error를 돌려줘야 한다");
});

test("verifiedToken — gapCuts를 주면 그 경계부터 확인해 MAX_TRIM 상한 밖의 잔여물도 뗀다", async () => {
  const real = "sk-ant-oat01-" + "x".repeat(95); // 108자
  const glued = real + "y".repeat(40); // 40자 잔여물 — MAX_TRIM(24자)보다 길어 gapCuts 없인 못 뗀다
  const { result, lens } = await withFetch(
    (n) => (n === real.length ? 200 : 401),
    () => verifiedToken(glued, undefined, [real.length]),
  );
  assert.deepStrictEqual(result, { token: real });
  assert.deepStrictEqual(lens, [glued.length, real.length]); // 경계 하나만 더 물어 끝난다
});

test("verifiedToken — 한 번도 못 물어봤으면(네트워크 단절) 잡은 값을 그대로 둔다", async () => {
  const tok = "sk-ant-oat01-" + "x".repeat(95);
  const { result } = await withFetch(
    () => "throw",
    () => verifiedToken(tok),
  );
  assert.deepStrictEqual(result, { token: tok }); // 인증을 연결 상태에 걸지 않는다
});
