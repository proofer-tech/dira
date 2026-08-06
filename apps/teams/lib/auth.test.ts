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

const {
  addToken,
  deleteToken,
  findClaude,
  findExecutable,
  isEligible,
  normalizeToken,
  ptyLines,
  pollSetup,
  readAuth,
  readOtherEngineAuth,
  readTokenRows,
  readTokens,
  saveToken,
  setActiveToken,
  setTokenEnabled,
  setTokenLabel,
  startSetup,
  stopSetup,
  tokenPath,
  tokensPath,
  writeTokens,
} = await import("./auth.ts");

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
  assert.strictEqual(isEligible({ enabled: true, exhaustedUntil: now + 60 }, now), false); // 아직 산다
  assert.strictEqual(isEligible({ enabled: true, exhaustedUntil: now - 1 }, now), true); // 창이 지났다
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

// ── 다른 엔진의 상태 층 — 판정 없이 사실만 (DESIGN.md §0-4 §개정 `b0966e66`) ─────────

test("findExecutable — 일반화한 탐색이 findClaude와 같은 경로를 낸다", () => {
  // BIN에는 이미 위에서 만든 `claude` 스텁이 있다 — 이름만 바꿔 부르면 같은 값이어야 한다
  assert.strictEqual(findExecutable("claude"), findClaude());
  assert.strictEqual(findExecutable("생전-없는-실행파일"), null);
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
