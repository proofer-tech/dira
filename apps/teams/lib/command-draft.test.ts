import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildDraftPrompt, ENGINE_PRIORITY, generateDraft, parseDraft, pickEngine, readScripts, SMALLEST_MODEL,
  type DraftRunner,
} from "./command-draft.ts";
import { ENGINES } from "./workers.ts";

const ctx = { scripts: [{ name: "build", command: "next build" }], envNames: ["API_KEY", "DB_URL"] };
const reply = (o: unknown): DraftRunner => async () => "```json\n" + JSON.stringify(o) + "\n```";
const ok = { steps: [{ kind: "shell", body: "pnpm build" }], env: ["API_KEY"], schedule: null };

test("엔진 선택 - claude만이면 haiku, codex만이면 codex의 가장 작은 모델, 없으면 null", () => {
  assert.deepEqual(pickEngine(["claude"]), { engine: "claude", model: "haiku" });
  assert.deepEqual(pickEngine(["codex"]), { engine: "codex", model: SMALLEST_MODEL.codex });
  assert.deepEqual(pickEngine(["codex", "claude"]), { engine: "claude", model: "haiku" });
  assert.equal(pickEngine([]), null);
});

test("표의 모델 이름은 ENGINES 목록에 있고 우선순위는 모든 엔진을 덮는다", () => {
  for (const e of ENGINES) {
    assert.ok(e.models.includes(SMALLEST_MODEL[e.id]), `${e.id}: ${SMALLEST_MODEL[e.id]}`);
    assert.ok(ENGINE_PRIORITY.includes(e.id));
  }
});

test("생성 - 엔진이 없으면 모델을 안 부르고 no-engine", async () => {
  let called = false;
  const r = await generateDraft("x", ctx, [], async () => ((called = true), ""));
  assert.deepEqual([r.ok, !r.ok && r.reason, called], [false, "no-engine", false]);
});

test("생성 - 정상 출력은 초안이 되고 목록 밖 환경변수 이름은 버려진다", async () => {
  const r = await generateDraft("빌드", ctx, ["claude"], reply({ ...ok, env: ["API_KEY", "NOPE", "API_KEY"] }));
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.draft, { steps: [{ kind: "shell", body: "pnpm build" }], env: ["API_KEY"] });
  assert.equal(r.ok && r.model, "haiku");
});

test("스케줄 - 이름에 시각 표현이 있을 때만 남고 cron 5필드여야 한다", async () => {
  const s = { ...ok, schedule: "0 9 * * *" };
  const a = await generateDraft("매일 아침 9시 빌드", ctx, ["claude"], reply(s));
  assert.equal(a.ok && a.draft.schedule, "0 9 * * *");
  const b = await generateDraft("빌드", ctx, ["claude"], reply(s));
  assert.ok(b.ok && !("schedule" in b.draft));
  const c = await generateDraft("매주 월요일 빌드", ctx, ["claude"], reply({ ...ok, schedule: "every monday" }));
  assert.ok(c.ok && !("schedule" in c.draft));
});

test("스키마 위반은 invalid, 실행 오류는 failed, 시간 초과는 timeout - 던지지 않는다", async () => {
  const bad = [
    "not json", "{}", JSON.stringify({ steps: [] }), JSON.stringify({ steps: [{ kind: "x", body: "a" }] }),
    JSON.stringify({ steps: [{ kind: "shell", body: "  " }] }),
    JSON.stringify({ steps: [{ kind: "shell", body: "a\n# step: shell\nb" }] }),
  ];
  for (const raw of bad) {
    const r = await generateDraft("x", ctx, ["claude"], async () => raw);
    assert.deepEqual([r.ok, !r.ok && r.reason], [false, "invalid"], raw);
  }
  const f = await generateDraft("x", ctx, ["claude"], async () => { throw new Error("boom"); });
  assert.deepEqual([f.ok, !f.ok && f.reason], [false, "failed"]);
  const t = await generateDraft("x", ctx, ["claude"], () => new Promise(() => {}), 30);
  assert.deepEqual([t.ok, !t.ok && t.reason], [false, "timeout"]);
});

test("환경변수 값은 프롬프트와 로그에 안 들어간다 - 이름만", async () => {
  process.env.API_KEY = "sekret-value-123";
  const logs: string[] = [];
  const orig = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = (...a: unknown[]) => void logs.push(a.join(" "));
  let seen = "";
  try {
    await generateDraft("x", ctx, ["claude"], async (_e, _m, prompt) => ((seen = prompt), JSON.stringify(ok)));
  } finally {
    [console.log, console.error, console.warn] = orig;
    delete process.env.API_KEY;
  }
  assert.ok(seen.includes("API_KEY") && !seen.includes("sekret-value-123"));
  assert.equal(logs.join("").includes("sekret-value-123"), false);
  assert.ok(!buildDraftPrompt("x", ctx).includes("sekret"));
});

test("readScripts - package.json scripts를 읽고 없으면 빈 목록", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "draft-"));
  assert.deepEqual(await readScripts(d), []);
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { dev: "next dev", n: 1 } }));
  assert.deepEqual(await readScripts(d), [{ name: "dev", command: "next dev" }]);
});
