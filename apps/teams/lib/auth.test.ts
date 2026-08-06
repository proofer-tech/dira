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
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 토큰(~/.config/dira/oauth-token)을 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const {
  addToken,
  buildAuthorizeUrl,
  deleteToken,
  findClaude,
  findExecutable,
  isEligible,
  normalizeToken,
  profileEmail,
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

// ── ② 발급 — dira 자체 OAuth (DESIGN.md §0-13 §라벨 §확정, P180-2) ────────────

test("buildAuthorizeUrl — client_id·PKCE·스코프·redirect_uri가 로컬 포트를 문다", () => {
  const url = new URL(buildAuthorizeUrl({ challenge: "chal123", state: "st1", port: 54321 }));
  assert.strictEqual(url.origin + url.pathname, "https://platform.claude.com/oauth/authorize");
  assert.strictEqual(url.searchParams.get("client_id"), "9d1c250a-e61b-44d9-88ed-5944d1962f5e");
  assert.strictEqual(url.searchParams.get("response_type"), "code");
  assert.strictEqual(url.searchParams.get("redirect_uri"), "http://127.0.0.1:54321/callback");
  assert.strictEqual(url.searchParams.get("code_challenge"), "chal123");
  assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(url.searchParams.get("state"), "st1");
  // setup-token의 user:inference 하나에 user:profile을 더한다 — 그 이상은 안 묻는다
  assert.strictEqual(url.searchParams.get("scope"), "user:inference user:profile");
});

test("profileEmail — account.email을 뽑고, 모양이 다르면 null이다(실측 응답 그대로)", () => {
  assert.strictEqual(profileEmail({ account: { email: "a@b.com" } }), "a@b.com");
  assert.strictEqual(profileEmail({ account: { email: "" } }), null);
  assert.strictEqual(profileEmail({ account: {} }), null);
  assert.strictEqual(profileEmail({ account: null }), null);
  assert.strictEqual(profileEmail({}), null);
  assert.strictEqual(profileEmail(null), null);
  assert.strictEqual(profileEmail("문자열"), null);
});

/** `claude`를 PATH 스텁으로 갈아 끼운다 — `lib/workers.test.ts`의 crontab 스텁과 같은 수법이다.
 *  층 ⓪(준비물 표시)·다른 엔진 판정이 이 스텁을 여전히 쓴다(층 ②는 더 이상 claude를 안 문다). */
const BIN = mkdtempSync(path.join(tmpdir(), "fst-bin-"));
process.env.PATH = `${BIN}:${process.env.PATH}`;
process.on("exit", () => rmSync(BIN, { recursive: true, force: true }));

// 실제 브라우저가 뜨면 안 된다(§0-4와 같은 태도 — 테스트가 부작용을 밟지 않는다). BIN이 PATH
// 맨 앞이라 macOS `open`을 무해한 스텁으로 가린다.
writeFileSync(path.join(BIN, "open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

function stubClaude(body: string) {
  writeFileSync(path.join(BIN, "claude"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

async function until(p: () => boolean, ms = 8_000) {
  for (let i = 0; i < ms / 50 && !p(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(p(), "기다리던 상태가 오지 않았다");
}

/** 층 ②가 여는 로컬 콜백 서버를 직접 두드린다 — 브라우저 흉내다. 전역 `fetch`는 토큰
 *  교환·profile GET 두 외부 호출을 가로채므로, 우리 자신의 로컬 요청은 node:http로 보낸다
 *  (아니면 스텁이 이 요청도 가로채 "예상 밖 URL"로 던진다). */
function hitLocalCallback(port: number, params: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    httpGet(`http://127.0.0.1:${port}/callback?${qs}`, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    }).on("error", reject);
  });
}

/** 폴링용 — 아직 안 왔으면 `undefined`(던지지 않는다, `until`이 재시도할 수 있게). */
function findAuthorizeUrl(lines: string[]): URL | undefined {
  const line = lines.find((l) => l.startsWith("http"));
  return line ? new URL(line) : undefined;
}

function authorizeUrlFrom(lines: string[]): URL {
  const u = findAuthorizeUrl(lines);
  assert.ok(u, `authorize URL이 진행 로그에 없다: ${lines.join("|")}`);
  return u!;
}

function portFrom(u: URL): number {
  return Number(u.searchParams.get("redirect_uri")!.match(/:(\d+)\/callback$/)![1]);
}

/** 토큰 교환·profile GET 두 외부 호출만 가로챈다 — 우리 로컬 서버로 가는 요청은 이 스텁을
 *  안 거친다(`hitLocalCallback`이 node:http를 직접 쓴다). */
function stubOAuthFetch(opts: {
  token?: () => Response;
  profile?: () => Response;
}): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/v1/oauth/token")) {
      return opts.token ? opts.token() : new Response(JSON.stringify({ access_token: "sk-ant-oat01-stub" }), { status: 200 });
    }
    if (String(url).includes("/api/oauth/profile")) {
      return opts.profile ? opts.profile() : new Response(JSON.stringify({ account: { email: "stub@example.com" } }), { status: 200 });
    }
    throw new Error(`예상 밖 fetch: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

test("startSetup — 로컬 콜백으로 코드를 받으면 토큰을 교환하고 profile GET으로 라벨을 채운다", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-oauth-"));
  const restore = stubOAuthFetch({});
  try {
    startSetup();
    await until(() => findAuthorizeUrl(pollSetup().lines) !== undefined);
    const authUrl = authorizeUrlFrom(pollSetup().lines);
    const port = portFrom(authUrl);
    const state = authUrl.searchParams.get("state")!;

    const status = await hitLocalCallback(port, { code: "test-code", state });
    assert.strictEqual(status, 302); // 성공 페이지로 리다이렉트한다

    await until(() => !!pollSetup().savedAt);
    const s = pollSetup();
    assert.strictEqual(s.running, false);
    assert.strictEqual(s.error, undefined);

    const saved = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath(), "utf8"));
    assert.strictEqual(saved, "sk-ant-oat01-stub");
    assert.strictEqual((await readTokenRows())[0].label, "stub@example.com");
  } finally {
    restore();
  }
});

test("startSetup — state가 안 맞으면 거부하고 토큰 교환을 시도하지 않는다(CSRF)", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-oauth-badstate-"));
  let tokenCalls = 0;
  const restore = stubOAuthFetch({
    token: () => {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "sk-ant-oat01-should-not-happen" }), { status: 200 });
    },
  });
  try {
    startSetup();
    await until(() => findAuthorizeUrl(pollSetup().lines) !== undefined);
    const port = portFrom(authorizeUrlFrom(pollSetup().lines));

    const status = await hitLocalCallback(port, { code: "test-code", state: "wrong" });
    assert.strictEqual(status, 400);

    await until(() => !pollSetup().running);
    assert.strictEqual(pollSetup().savedAt, undefined);
    assert.strictEqual(tokenCalls, 0, "잘못된 state인데 토큰 교환을 시도했다");
  } finally {
    restore();
  }
});

test("startSetup — profile GET이 실패해도 토큰은 저장되고 라벨은 계정 N 폴백이다", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-oauth-noprofile-"));
  const restore = stubOAuthFetch({
    token: () => new Response(JSON.stringify({ access_token: "sk-ant-oat01-noprofile" }), { status: 200 }),
    profile: () => new Response(null, { status: 403 }),
  });
  try {
    startSetup();
    await until(() => findAuthorizeUrl(pollSetup().lines) !== undefined);
    const authUrl = authorizeUrlFrom(pollSetup().lines);
    const port = portFrom(authUrl);
    const state = authUrl.searchParams.get("state")!;

    await hitLocalCallback(port, { code: "c", state });
    await until(() => !!pollSetup().savedAt);

    const s = pollSetup();
    assert.strictEqual(s.error, undefined, "profile 실패가 발급 자체를 깨뜨렸다");
    assert.ok(s.lines.some((l) => l.includes("403")), s.lines.join("|")); // 사유가 진행 로그에 남는다
    assert.strictEqual((await readTokenRows())[0].label, "계정 1"); // 행 편집이 폴백이다(P180-1)
  } finally {
    restore();
  }
});

test("stopSetup — 다이얼로그를 닫으면 로컬 서버가 닫힌다", async () => {
  process.env.TICKET_LOCAL = mkdtempSync(path.join(tmpdir(), "fst-auth-oauth-stop-"));
  startSetup();
  await until(() => findAuthorizeUrl(pollSetup().lines) !== undefined);
  const port = portFrom(authorizeUrlFrom(pollSetup().lines));

  stopSetup();
  assert.strictEqual(pollSetup().running, false);
  await assert.rejects(() => hitLocalCallback(port, { code: "x", state: "y" }));
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
