import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WINDOW_MS, formatTokens, listUsage, parseLogName } from "./usage.ts";

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
