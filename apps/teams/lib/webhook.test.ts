import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/webhook.json`을 밟지 않는다. import 전에 건다 — `analytics.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-webhook-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const {
  readWebhookUrl,
  setWebhookUrl,
  webhookPath,
  webhookBody,
  webhookDelta,
  webhookText,
  maskWebhookUrl,
  testSendWebhook,
  webhookTick,
  resetWebhookSeenForTest,
} = await import("./webhook.ts");
const { addProject } = await import("./projects.ts");

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

// projectName을 project(id)와 다르게 둔다 — webhookText가 조용히 id로 되돌아가는 회귀를 잡는다.
const item = (project: string, stem: string) => ({
  project,
  projectName: `${project} teams`,
  stem,
  hash: `${project}-${stem}`,
  title: `t-${stem}`,
});

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

test("webhookText — 언어별 template에 셋을 갈아 끼운다, 프로젝트 자리는 표시 이름이다", () => {
  const i = item("myproj", "abc");
  assert.equal(webhookText("ko", i), "답변 대기: t-abc - myproj teams (myproj-abc)");
  assert.equal(webhookText("en", i), "Awaiting answer: t-abc - myproj teams (myproj-abc)");
});

test("webhookBody — 키가 정확히 다섯이고 stem·큐 루트가 안 들어간다, project 키는 id 그대로다", () => {
  const i = item("myproj", "abc");
  const body = webhookBody("ko", i, 1_770_000_000_000);
  assert.deepEqual(Object.keys(body).sort(), ["at", "hash", "project", "text", "title"]);
  assert.equal(body.project, "myproj");
  assert.ok(body.text.includes("myproj teams"));
  assert.equal(body.hash, "myproj-abc");
  assert.equal(body.title, "t-abc");
  assert.equal(body.at, new Date(1_770_000_000_000).toISOString());
  assert.ok(!JSON.stringify(body).includes("stem"));
});

// ── 가린 요약 — 자릿수가 아니라 구조로 자른다(§비주얼 §45 ⑪ (3)) ────────────

test("maskWebhookUrl — 경로가 있으면 스킴+호스트만 남기고 접는다, 뒤 4자를 안 남긴다", () => {
  assert.equal(maskWebhookUrl("https://hooks.slack.com/services/T00/B00/xxxxxxxxxxxx"), "https://hooks.slack.com/…");
});

test("maskWebhookUrl — 경로가 없으면 접힘 표시를 안 붙인다", () => {
  assert.equal(maskWebhookUrl("https://example.com"), "https://example.com");
});

test("maskWebhookUrl — 쿼리·프래그먼트만 있어도 접는다", () => {
  assert.equal(maskWebhookUrl("https://example.com?x=1"), "https://example.com/…");
  assert.equal(maskWebhookUrl("https://example.com#x"), "https://example.com/…");
});

// ── 테스트 보내기 — 주소가 없으면 실패를 반환한다 (§0-10 §화면) ──────────────

test("testSendWebhook — 주소가 없으면 ok:false다(fetch를 안 부른다)", async () => {
  await setWebhookUrl("");
  const r = await testSendWebhook();
  assert.equal(r.ok, false);
});

test("testSendWebhook — 답변 대기가 0건이면 자리표시 본문을 실제로 보내고 ok:true다", async () => {
  const received: unknown[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  // `setWebhookUrl`은 https만 받는다 — 로컬 서버를 가리키려고 파일을 직접 쓴다
  // (analytics.test.ts의 그 관용구, `setWebhookUrl`이 지키는 규칙과 겹치지 않는다).
  writeFileSync(webhookPath(), JSON.stringify({ url: `http://127.0.0.1:${port}/hook` }));

  const r = await testSendWebhook();
  server.close();

  assert.equal(r.ok, true);
  assert.equal(received.length, 1);
  assert.deepEqual(Object.keys(received[0] as object).sort(), ["at", "hash", "project", "text", "title"]);
  assert.equal((received[0] as { hash: string }).hash, "-"); // 큐 0건 — 자리표시(project/stem/hash/title = "-")
});

// ── 델타 집합을 안 건드린다 — 테스트가 본 것을 <봤다>고 적으면 그 사건이 영영 안 나간다 ────

test("testSendWebhook — 델타 집합(__diraWebhookSeen)을 안 건드린다", async () => {
  resetWebhookSeenForTest();
  // 아무도 안 듣는 로컬 포트 — 연결이 빠르게 거절돼 실패 갈래를 태운다. 요지는 응답이 아니라
  // 이 호출이 웹훅 tick의 씨뿌리기 상태(globalThis.__diraWebhookSeen)를 건드리지 않는다는 것.
  writeFileSync(webhookPath(), JSON.stringify({ url: "https://127.0.0.1:9/unreachable" }));
  await testSendWebhook();
  assert.equal((globalThis as { __diraWebhookSeen?: unknown }).__diraWebhookSeen, undefined);
});

// ── 재획득 — 소유자였다가 뺏기고 되찾으면 그 박은 다시 씨 뿌리기다 (티켓 2e5f2b25) ──────

test("webhookTick — justRegainedOwnership이 서면 옛 seen이 있어도 조용히 씨만 다시 뿌린다, 다음 박부터 델타를 보낸다", async () => {
  resetWebhookSeenForTest();

  const projRoot = mkdtempSync(path.join(tmpdir(), "fst-webhook-proj-"));
  const dira = path.join(projRoot, ".dira");
  mkdirSync(path.join(dira, "tickets"), { recursive: true });
  const proj = await addProject("wh-proj", dira, "wh-proj");
  const fm = (o: Record<string, string>) =>
    "---\n" + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n---\n";
  writeFileSync(
    path.join(dira, "tickets", "r0000001.md"),
    fm({ ticket: "r0000001", title: "질문 1", kind: "request", deps: "[a1111111]", awaiting: "a1111111" }),
  );

  const received: unknown[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  writeFileSync(webhookPath(), JSON.stringify({ url: `http://127.0.0.1:${port}/hook` }));

  // 이 프로세스가 전에 소유자였던 적 있다고 흉내낸다 — 옛 씨 뿌리기 집합에 이미 값이 있다
  // (그중 "stale/project"는 지금 큐에 없는, 다른 서버 창에서 이미 나갔던 것).
  (globalThis as { __diraWebhookSeen?: Set<string> }).__diraWebhookSeen = new Set(["stale/project"]);

  await webhookTick(Date.now(), true); // 재획득 박
  assert.equal(received.length, 0, "재획득 박은 아무것도 안 보낸다");
  const seenAfterRegain = (globalThis as { __diraWebhookSeen?: Set<string> }).__diraWebhookSeen;
  assert.deepEqual([...(seenAfterRegain ?? [])], ["wh-proj/r0000001"]); // 기준선이 지금 집합으로 다시 섰다

  // 다음 박(재획득 신호 0)에서 새로 생긴 답변 대기만 델타로 나간다
  writeFileSync(
    path.join(dira, "tickets", "r0000002.md"),
    fm({ ticket: "r0000002", title: "질문 2", kind: "request", deps: "[a2222222]", awaiting: "a2222222" }),
  );
  await webhookTick(Date.now());
  server.close();

  assert.equal(received.length, 1);
  assert.equal((received[0] as { hash: string }).hash, "r0000002");
  assert.equal((received[0] as { project: string }).project, proj.id);
  rmSync(projRoot, { recursive: true, force: true });
});
