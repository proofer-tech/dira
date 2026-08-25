import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/analytics.json`을 밟지 않는다. import 전에 건다 — `keymap.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-analytics-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { analyticsPath, readAnalytics, resetSessionForTest, sessionIdentity, setAnalyticsEnabled, track } =
  await import("./analytics.ts");

const FILE = path.join(LOCAL, "analytics.json");

// ── fetch 스텁 — 실제로 GA에 보내지 않는다 ──────────────────────────────────

type Call = { url: string; body: { client_id: string; events: { name: string; params: Record<string, unknown> }[] } };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: { body: string }) => {
  calls.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(null, { status: 204 }); // 204는 본문을 못 갖는다(Response가 던진다)
}) as typeof fetch;
process.on("exit", () => (globalThis.fetch = realFetch));

const realNow = Date.now;
/** 세션 30분 창을 손으로 민다. 모듈이 보는 시계는 `Date.now` 하나다. */
const at = (ms: number) => (Date.now = () => ms);
process.on("exit", () => (Date.now = realNow));

const T0 = 1_770_000_000_000;

function reset(env: { creds?: boolean; enabled?: boolean } = {}) {
  calls = [];
  resetSessionForTest();
  at(T0);
  rmSync(FILE, { force: true });
  if (env.enabled === false) writeFileSync(FILE, JSON.stringify({ enabled: false }));
  if (env.creds === false) {
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GA_API_SECRET;
  } else {
    process.env.GA_MEASUREMENT_ID = "G-TEST1234";
    process.env.GA_API_SECRET = "secret-abc";
  }
  delete process.env.DIRA_APP_VERSION;
}

// ── ① 안 보내는 조건 셋 ─────────────────────────────────────────────────────

test("자격값이 하나라도 없으면 네트워크 호출이 0회다", async () => {
  reset({ creds: false });
  await track("screen_view", { screen: "board" });
  assert.strictEqual(calls.length, 0);

  // 하나만 있는 것도 없는 것이다
  process.env.GA_MEASUREMENT_ID = "G-TEST1234";
  await track("screen_view", { screen: "board" });
  assert.strictEqual(calls.length, 0);

  // 파일도 안 생긴다 — 안 보내는 빌드가 디스크에 흔적을 남기지 않는다
  assert.strictEqual(existsSync(FILE), false);
});

test("enabled: false면 네트워크 호출이 0회다", async () => {
  reset({ enabled: false });
  await track("ticket_create", { kind: "work" });
  await track("app_open", { app_version: "dev", shell: "browser" });
  assert.strictEqual(calls.length, 0);
});

test("전송이 실패해도 던지지 않는다", async () => {
  reset();
  const stub = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  await track("answer_submit", {}); // reject하면 여기서 테스트가 깨진다
  globalThis.fetch = stub;
});

// ── ② 세션 — 30분 경계에서 `app_open`이 앞에 붙는다 ─────────────────────────

test("첫 이벤트 · 30분 경계에서 app_open이 앞에 붙는다", async () => {
  reset();
  process.env.DIRA_APP_VERSION = "0.1.4";

  await track("project_add", { method: "create" });
  assert.deepStrictEqual(
    calls.map((c) => c.body.events[0].name),
    ["app_open", "project_add"],
  );
  assert.deepStrictEqual(calls[0].body.events[0].params, {
    app_version: "0.1.4",
    shell: "desktop", // 버전을 넘기는 셸은 데스크톱뿐이다
    session_id: String(T0),
    engagement_time_msec: 100,
  });

  // 창 안에서는 안 붙고 session_id도 그대로다
  calls = [];
  at(T0 + 29 * 60_000);
  await track("worker_create", { engine: "claude", cron_ok: true });
  assert.deepStrictEqual(
    calls.map((c) => c.body.events[0].name),
    ["worker_create"],
  );
  assert.strictEqual(calls[0].body.events[0].params.session_id, String(T0));

  // 마지막 이벤트로부터 30분을 넘기면 새 세션이고 app_open이 다시 앞에 뜬다
  calls = [];
  const t2 = T0 + 29 * 60_000 + 31 * 60_000;
  at(t2);
  await track("answer_submit", {});
  assert.deepStrictEqual(
    calls.map((c) => c.body.events[0].name),
    ["app_open", "answer_submit"],
  );
  assert.strictEqual(calls[0].body.events[0].params.session_id, String(t2));
  assert.strictEqual(calls[1].body.events[0].params.session_id, String(t2));
});

test("client_id는 파일의 install_id고 session_id는 파일에 안 쓴다", async () => {
  reset();
  await track("feedback_submit", {});
  const saved = JSON.parse(readFileSync(FILE, "utf8"));
  assert.deepStrictEqual(Object.keys(saved), ["install_id"]); // 담기는 키는 둘뿐, 세션은 없다
  assert.strictEqual(calls[0].body.client_id, saved.install_id);
  // 두 번째 실행이 같은 id를 쓴다(설치 한 벌 = 영구)
  calls = [];
  resetSessionForTest();
  await track("feedback_submit", {});
  assert.strictEqual(calls[0].body.client_id, saved.install_id);
});

// ── ③ 익명 규칙 — 이 기능의 유일한 유출 표면 ────────────────────────────────

test("페이로드에 경로·프로젝트 이름·티켓 해시·제목이 없다", async () => {
  reset();
  process.env.DIRA_APP_VERSION = "0.1.4";
  await track("screen_view", { screen: "ticket" });
  await track("ticket_create", { kind: "request" });
  await track("worker_create", { engine: "codex", cron_ok: false });
  await track("project_add", { method: "register" });

  const dump = JSON.stringify(calls.map((c) => c.body));
  for (const leak of [LOCAL, ".dira", "/Users", "dira", "1c3d96b0", "developer", "w3", "tickets"]) {
    assert.ok(!dump.includes(leak), `${leak}이(가) 페이로드에 있다`);
  }
  // 값은 개수·불리언·우리가 정한 enum뿐이다
  for (const c of calls) {
    for (const [k, v] of Object.entries(c.body.events[0].params)) {
      assert.ok(["string", "number", "boolean"].includes(typeof v), k);
    }
  }
  // 화면은 enum 하나다 — URL이 아니다
  assert.strictEqual(calls[1].body.events[0].params.screen, "ticket");
  // client_id는 UUID다(사람·머신을 유추할 값이 아니다)
  assert.match(calls[0].body.client_id, /^[0-9a-f-]{36}$/);
});

test("전송 URL은 mp/collect 하나고 자격값은 쿼리로만 간다", async () => {
  reset();
  await track("answer_submit", {});
  assert.ok(calls.every((c) => c.url.startsWith("https://www.google-analytics.com/mp/collect?")));
  assert.ok(calls[0].url.includes("measurement_id=G-TEST1234"));
  assert.ok(!JSON.stringify(calls[0].body).includes("secret-abc"));
});

// ── ④ 끄기·경로 ────────────────────────────────────────────────────────────

test("analyticsPath — TICKET_LOCAL을 존중하고 레지스트리와 같은 디렉터리다", () => {
  assert.strictEqual(analyticsPath(), FILE);
});

test("readAnalytics/setAnalyticsEnabled — 기본 켜짐, 끈 사실만 남는다", async () => {
  reset();
  assert.deepStrictEqual(await readAnalytics(), { configured: true, enabled: true });

  await setAnalyticsEnabled(false);
  assert.deepStrictEqual(await readAnalytics(), { configured: true, enabled: false });
  assert.strictEqual(JSON.parse(readFileSync(FILE, "utf8")).enabled, false);

  await setAnalyticsEnabled(true);
  assert.strictEqual("enabled" in JSON.parse(readFileSync(FILE, "utf8")), false); // 바꾼 것만 남는다
  assert.strictEqual((await readAnalytics()).enabled, true);

  reset({ creds: false });
  assert.deepStrictEqual(await readAnalytics(), { configured: false, enabled: true });
});

test("sessionIdentity — 통계를 껐어도 두 값을 준다 (§0-12 폼)", async () => {
  reset({ enabled: false });
  const a = await sessionIdentity();
  assert.match(a.installId, /^[0-9a-f-]{36}$/);
  assert.strictEqual(a.sessionId, String(T0));
  // 폼을 다시 그려도 같은 id다
  at(T0 + 60_000);
  assert.deepStrictEqual(await sessionIdentity(), { installId: a.installId, sessionId: a.sessionId });
  assert.strictEqual(calls.length, 0); // 조회는 전송이 아니다
});

test("깨진 analytics.json은 던지지 않고 흡수한다", async () => {
  reset();
  writeFileSync(FILE, "{ 이건 JSON이 아니다");
  assert.deepStrictEqual(await readAnalytics(), { configured: true, enabled: true });
  await track("answer_submit", {});
  assert.strictEqual(calls.length, 2); // app_open + answer_submit
});
