import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/webhook.json`을 밟지 않는다. import 전에 건다 — `analytics.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-webhook-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { readWebhookUrl, setWebhookUrl, webhookPath, webhookBody, webhookDelta, webhookText } =
  await import("./webhook.ts");

// ── 저장 한 쌍 — `https`만 받는다 · 권한 0600 ────────────────────────────────

test("setWebhookUrl — https 주소를 저장하면 읽힌다 · 권한이 0600이다", async () => {
  await setWebhookUrl("https://hooks.slack.com/services/x");
  assert.equal(await readWebhookUrl(), "https://hooks.slack.com/services/x");
  assert.equal(statSync(webhookPath()).mode & 0o777, 0o600);
});

test("setWebhookUrl — http는 거절되고 파일이 한 바이트도 안 갈린다", async () => {
  rmSync(webhookPath(), { force: true });
  await assert.rejects(() => setWebhookUrl("http://example.com/hook"));
  assert.equal(existsSync(webhookPath()), false); // 거절 전 상태가 그대로다 — 파일이 안 생겼다

  await setWebhookUrl("https://example.com/hook");
  const before = statSync(webhookPath()).mtimeMs;
  await assert.rejects(() => setWebhookUrl("not-a-url"));
  assert.equal(statSync(webhookPath()).mtimeMs, before); // 있던 파일도 안 갈린다
  assert.equal(await readWebhookUrl(), "https://example.com/hook");
});

test("setWebhookUrl — 빈 문자열은 끈다, readWebhookUrl이 null이다", async () => {
  await setWebhookUrl("https://example.com/hook");
  await setWebhookUrl("");
  assert.equal(await readWebhookUrl(), null);
});

test("readWebhookUrl — 파일이 없으면 null이다(꺼진 상태가 기본)", async () => {
  rmSync(webhookPath(), { force: true });
  assert.equal(await readWebhookUrl(), null);
});

// ── 델타 — 첫 스캔은 조용히 씨를 뿌린다 · 직전 집합과의 차집합만 ────────────

const item = (project: string, stem: string) => ({ project, stem, hash: `${project}-${stem}`, title: `t-${stem}` });

test("webhookDelta — seen=null(첫 스캔)이면 toSend가 0건이다 · keys는 채워진다", () => {
  const items = [item("p1", "a"), item("p1", "b")];
  const { toSend, keys } = webhookDelta(items, null);
  assert.deepEqual(toSend, []);
  assert.deepEqual([...keys].sort(), ["p1/a", "p1/b"]);
});

test("webhookDelta — 직전 집합과의 차집합만 낸다", () => {
  const seen = new Set(["p1/a"]);
  const items = [item("p1", "a"), item("p1", "b"), item("p2", "a")];
  const { toSend, keys } = webhookDelta(items, seen);
  assert.deepEqual(
    toSend.map((i) => `${i.project}/${i.stem}`),
    ["p1/b", "p2/a"],
  );
  assert.deepEqual([...keys].sort(), ["p1/a", "p1/b", "p2/a"]);
});

test("webhookDelta — 사라진 티켓은 안 보낸다(풀린 것을 알리지 않는다)", () => {
  const seen = new Set(["p1/a", "p1/gone"]);
  const { toSend } = webhookDelta([item("p1", "a")], seen);
  assert.deepEqual(toSend, []);
});

// ── 본문 조립 — 키 다섯, 담지 않는 것 ────────────────────────────────────────

test("webhookText — 언어별 template에 셋을 갈아 끼운다", () => {
  const i = item("myproj", "abc");
  assert.equal(webhookText("ko", i), "답변 대기: t-abc - myproj (myproj-abc)");
  assert.equal(webhookText("en", i), "Awaiting answer: t-abc - myproj (myproj-abc)");
});

test("webhookBody — 키가 정확히 다섯이고 stem·큐 루트가 안 들어간다", () => {
  const i = item("myproj", "abc");
  const body = webhookBody("ko", i, 1_770_000_000_000);
  assert.deepEqual(Object.keys(body).sort(), ["at", "hash", "project", "text", "title"]);
  assert.equal(body.project, "myproj");
  assert.equal(body.hash, "myproj-abc");
  assert.equal(body.title, "t-abc");
  assert.equal(body.at, new Date(1_770_000_000_000).toISOString());
  assert.ok(!JSON.stringify(body).includes("stem"));
});
