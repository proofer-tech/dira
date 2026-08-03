import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_WINDOW_MS,
  engineLimits,
  formatTokens,
  lastRateLimits,
  listUsage,
  parseLogName,
  RATE_WINDOW_MS,
  usageRates,
} from "./usage.ts";

/** 픽스처 큐 하나. 로그 디렉터리까지 만들어 준다. */
function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "usage-"));
  mkdirSync(path.join(root, "workers", "logs"), { recursive: true });
  return root;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** tick.sh:264와 같은 이름을 만든다: `<YYYYMMDD>-<HHMMSS>-<워커>-<해시>.log` (로컬 시각). */
function logName(minsAgo: number, worker: string, hash: string): string {
  const d = new Date(Date.now() - minsAgo * 60_000);
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const t = `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
  return `${day}-${t}-${worker}-${hash}.log`;
}

/** 세션 로그 = stderr 여러 줄 + 마지막에 엔진 JSON 한 줄(`tick.sh:294·364`). */
function putLog(root: string, file: string, rec: object | null): string {
  const full = path.join(root, "workers", "logs", file);
  writeFileSync(full, "세션 stderr\n" + (rec === null ? "아직 안 끝났다" : JSON.stringify(rec)) + "\n");
  return full;
}

/** 실측 모양(2026-08-01). 넷 말고도 필드가 많고 우리는 넷만 더한다. */
const usage = (i: number, o: number, cc: number, cr: number) => ({
  is_error: false,
  total_cost_usd: 9.99, // 읽지 않는다 (§0-8 Q3=(a))
  usage: {
    input_tokens: i,
    output_tokens: o,
    cache_creation_input_tokens: cc,
    cache_read_input_tokens: cr,
    service_tier: "standard",
  },
});

test("parseLogName — 워커 이름에 `-`가 들어가도 가운데 전부가 이름이다", () => {
  assert.equal(parseLogName("20260801-145504-w6-3c56c1c3.log")?.worker, "w6");
  // `split("-")[2]`였다면 `dev`가 된다
  assert.equal(parseLogName("20260801-145504-dev-box-2-3c56c1c3.log")?.worker, "dev-box-2");
  // 앞 2필드는 고정이다 — 시각이 로컬로 풀린다
  const p = parseLogName("20260801-145504-w6-3c56c1c3.log");
  assert.equal(new Date(p!.at).getHours(), 14);
  assert.equal(new Date(p!.at).getMinutes(), 55);
  // 우리 이름이 아닌 것은 null (runner.log·cron.log가 같은 트리에 있다)
  for (const n of ["runner.log", "cron.log", "20260801-w6-abc.log", "x-y-z.log"]) {
    assert.equal(parseLogName(n), null, n);
  }
});

test("listUsage — 창 안만 · 워커별 합 · 토큰 못 읽은 세션은 unaccounted", async () => {
  const root = makeRoot();
  //                                      = 1+2+3+4 = 10
  putLog(root, logName(10, "w1", "aaaaaaaa"), usage(1, 2, 3, 4));
  putLog(root, logName(20, "w1", "bbbbbbbb"), usage(10, 20, 30, 40)); // w1 합 = 110
  putLog(root, logName(30, "dev-box-2", "cccccccc"), usage(0, 0, 0, 7)); // `-` 이름
  // 창 밖 + **안 끝난** 로그. 열었다면 unaccounted가 1 늘고, 안 열었으면 아무 일도 없다.
  putLog(root, logName(60 * 9, "w1", "dddddddd"), null);
  // 창 밖 + 끝난 로그. 열었다면 합에 들어간다.
  putLog(root, logName(60 * 9, "w1", "eeeeeeee"), usage(0, 0, 0, 1_000_000));
  // 창 안 + 안 끝난 로그 → 합에 안 들어가고 unaccounted로 센다
  putLog(root, logName(5, "w2", "ffffffff"), null);
  // 마지막 줄이 JSON이지만 `usage`가 없다(stderr의 hook JSON — 실측에 실재한다).
  // 0으로 단정하지 않는다 = 아직 안 끝난 것으로 본다.
  putLog(root, logName(5, "w2", "99999999"), { hook_event: "PreToolUse", exit_code: 0 });

  const u = await listUsage(root, DEFAULT_WINDOW_MS);
  assert.deepEqual(u.byWorker, { w1: 110, "dev-box-2": 7 });
  assert.equal(u.total, 117);
  assert.equal(u.unaccounted, 2); // 창 밖 미완료는 세지 않는다 = 열지 않았다
});

test("listUsage — 끝난 로그는 캐시하고 안 끝난 로그는 캐시하지 않는다", async () => {
  const root = makeRoot();
  const done = putLog(root, logName(10, "w1", "aaaaaaaa"), usage(0, 0, 0, 100));
  const wip = logName(10, "w2", "bbbbbbbb");
  putLog(root, wip, null);

  const first = await listUsage(root);
  assert.deepEqual(first, { byWorker: { w1: 100 }, total: 100, unaccounted: 1 });

  // 끝난 파일의 내용을 갈아 끼운다. 다시 열었다면 값이 바뀐다 — 안 바뀌면 캐시가 산 것이다.
  writeFileSync(done, JSON.stringify(usage(0, 0, 0, 999_999)) + "\n");
  // 안 끝났던 파일이 끝났다. 캐시했다면 이 값은 영영 안 보인다.
  putLog(root, wip, usage(0, 0, 0, 5));

  const second = await listUsage(root);
  assert.deepEqual(second, { byWorker: { w1: 100, w2: 5 }, total: 105, unaccounted: 0 });
});

test("formatTokens — 0은 빈칸이 아니고 큰 수는 읽히게 줄인다", () => {
  assert.equal(formatTokens(0), "0"); // 화면이 `—` 대신 이걸 그린다
  assert.equal(formatTokens(995), "995");
  assert.equal(formatTokens(1_234), "1.2k");
  assert.equal(formatTokens(18_432), "18k"); // 가수가 10 이상이면 소수는 소음이다
  assert.equal(formatTokens(2_600_000), "2.6M");
  assert.equal(formatTokens(215_000_000), "215M");
  // 반올림 경계 — `1000k`가 나오면 안 된다
  assert.equal(formatTokens(999_499), "999k");
  assert.equal(formatTokens(999_500), "1.0M");
});

// ── 판정 2 (엔진별 잔여) ──────────────────────────────────────────────────

test("lastRateLimits — 마지막 것이 이긴다 · 잘린 줄을 건너뛴다 · 없으면 null", () => {
  const line = (pct: number | null, ts: string) =>
    JSON.stringify({
      timestamp: ts,
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: pct === null ? null : { used_percent: pct, window_minutes: 43200, resets_at: 1787984956 },
          secondary: null,
          plan_type: "free",
        },
      },
    });

  // 한 세션에 여러 번 실린다 — **마지막이 최신이다**
  const two = ["{\"type\":\"session_meta\"}", line(42, "a"), "{\"type\":\"response_item\"}", line(44, "b")];
  assert.equal(lastRateLimits(two.join("\n")).primary.used_percent, 44);

  // 세션이 쓰는 중이라 마지막 줄이 잘렸다 — 그 앞 줄로 물러난다(사유를 지어내지 않는다)
  assert.equal(lastRateLimits([line(42, "a"), line(44, "b").slice(0, 60)].join("\n")).primary.used_percent, 42);

  // 한도에 닿으면 codex가 수를 아예 안 싣는다. `rate_limits`는 있고 `primary`만 null이다
  assert.equal(lastRateLimits(line(null, "a")).primary, null);

  // 턴이 없던 세션 — `token_count`가 아예 없다
  assert.equal(lastRateLimits("{\"type\":\"session_meta\"}\n"), null);
  assert.equal(lastRateLimits(""), null);
});

test("engineLimits — 원본 모르는 엔진은 사유뿐 · TTL 안에서는 다시 안 부른다", async () => {
  // 게이지를 그릴 수 없는 엔진은 `{ error }`다. 빈 트랙도 `0%`도 만들지 않는다(§0-8 판정 2).
  const first = await engineLimits(["mystery-engine", "mystery-engine"]);
  assert.deepEqual(Object.keys(first), ["mystery-engine"]); // 중복은 접힌다 = 호출도 한 번이다
  assert.ok("error" in first["mystery-engine"]);
  assert.match(first["mystery-engine"].error, /원본을 모릅니다/);

  // TTL(60초) 안이면 **같은 객체**가 돌아온다 — 캐시가 값이 아니라 Promise를 들고 있다는 증거고,
  // 이게 "5초 폴링마다 외부 호출을 하지 않는다"의 실체다.
  const second = await engineLimits(["mystery-engine"]);
  assert.strictEqual(second["mystery-engine"], first["mystery-engine"]);
});

// ── 소모 속도 (§0-8 판정 4) ─────────────────────────────────────────────────

/** 트랜스크립트 픽스처 하나. `<projects>/<enc(<root>/worktrees/)><나머지>/<sid>.jsonl`이고
 *  **mtime을 가장 최신 레코드 시각에 맞춘다** — 창 밖 파일을 `mtime`만 보고 건너뛰는 경로가
 *  진짜 파일에서 그대로 도는지 재려면 그 값이 진짜여야 한다. */
function putTranscript(
  projects: string,
  root: string,
  rest: string,
  recs: { minsAgo: number; id: string; tokens: number }[],
): void {
  const enc = (p: string) => p.replace(/[^a-zA-Z0-9]/g, "-");
  const dir = path.join(projects, enc(path.join(root, "worktrees") + path.sep) + rest);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "11111111-2222-3333-4444-555555555555.jsonl");
  const lines = recs.map((r) =>
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(Date.now() - r.minsAgo * 60_000).toISOString(),
      message: { id: r.id, usage: { input_tokens: r.tokens } },
    }),
  );
  // assistant가 아닌 줄은 안 센다(실측 파일의 절반이 그것이다)
  lines.push('{"type":"user","message":{"role":"user"}}');
  writeFileSync(file, lines.join("\n") + "\n");
  const newest = (Date.now() - Math.min(...recs.map((r) => r.minsAgo)) * 60_000) / 1000;
  utimesSync(file, newest, newest);
}

/** 큐 픽스처에 워크트리를 세운다 — 이게 있어야 접두 규칙이 `worktrees/` 갈래로 간다. */
function makeTreeRoot(): { root: string; projects: string } {
  const root = makeRoot();
  mkdirSync(path.join(root, "worktrees", "w1"), { recursive: true });
  return { root, projects: mkdtempSync(path.join(tmpdir(), "projects-")) };
}

test("usageRates — `message.id` 중복은 한 번만 센다", async () => {
  const { root, projects } = makeTreeRoot();
  // 스트리밍이 한 응답을 여러 줄로 적는다(실측 78 레코드 → 고유 54).
  putTranscript(projects, root, "w1", [
    { minsAgo: 1, id: "msg_A", tokens: 600 },
    { minsAgo: 1, id: "msg_A", tokens: 600 },
    { minsAgo: 1, id: "msg_A", tokens: 600 },
    { minsAgo: 2, id: "msg_B", tokens: 400 },
  ]);
  const rates = await usageRates(root, [{ worker: "w1", engine: "claude" }], projects);
  // 1000 토큰 ÷ 창 10분. 중복을 안 접었다면 220이다
  assert.deepEqual(rates, { claude: 100 });
});

test("usageRates — 창 밖 레코드도 창 밖 파일도 안 센다", async () => {
  const { root, projects } = makeTreeRoot();
  const out = RATE_WINDOW_MS / 60_000 + 5; // 창(10분) 밖
  // 창 안 파일 안의 창 밖 레코드 — 파일은 열리고 레코드가 걸러진다
  putTranscript(projects, root, "w1", [
    { minsAgo: 1, id: "msg_A", tokens: 300 },
    { minsAgo: out, id: "msg_OLD", tokens: 9_000_000 },
  ]);
  // 통째로 창 밖인 파일 — **mtime만 보고 안 연다**
  putTranscript(projects, root, "w2", [{ minsAgo: out, id: "msg_OLD2", tokens: 9_000_000 }]);
  const rates = await usageRates(
    root,
    [
      { worker: "w1", engine: "claude" },
      { worker: "w2", engine: "claude" },
    ],
    projects,
  );
  assert.deepEqual(rates, { claude: 30 });
});

test("usageRates — 칸마다 그 엔진을 무는 워커만 · 원본 없는 엔진은 키가 없다", async () => {
  const { root, projects } = makeTreeRoot();
  putTranscript(projects, root, "w1", [{ minsAgo: 1, id: "a", tokens: 500 }]);
  putTranscript(projects, root, "w2", [{ minsAgo: 1, id: "b", tokens: 700 }]);
  // 워크트리 **하위 디렉터리**에서 뜬 세션도 그 워커의 것이다(`…-worktrees-w2-apps-desktop`)
  putTranscript(projects, root, "w2-apps-desktop", [{ minsAgo: 1, id: "c", tokens: 300 }]);
  // 등록이 풀린 워커 — 무는 엔진이 없으니 어느 칸에도 안 든다
  putTranscript(projects, root, "w9", [{ minsAgo: 1, id: "d", tokens: 9_000_000 }]);

  const rates = await usageRates(
    root,
    [
      { worker: "w1", engine: "claude" },
      { worker: "w2", engine: "codex" },
    ],
    projects,
  );
  // codex는 `~/.claude/projects/`에 세션이 없다 — `0`이 아니라 **키가 통째로 없다**.
  // w2 쪽 1000 토큰이 claude 칸에 새지 않는 것도 여기서 갈린다.
  assert.deepEqual(rates, { claude: 50 });
});
