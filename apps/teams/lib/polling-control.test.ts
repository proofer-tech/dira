import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatchPollingNow, extendPollingUntil } from "./polling-control.ts";
import { readFm } from "./queue.ts";
import type { Suffixes } from "./queue.ts";

/** 픽스처 큐는 전부 임시 디렉터리다 — `lib/followup.test.ts`와 같은 이유(진짜 `.dira`를 안
 *  건드린다). */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-polling-control-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const SFX: Suffixes = { inProgress: ".wip", done: ".done" };
const root = path.join(tmp, "dira");
const dir = path.join(root, "tickets");
mkdirSync(dir, { recursive: true });

function ticket(stem: string, fm: string[], body: string): string {
  writeFileSync(path.join(dir, `${stem}.md`), ["---", ...fm, "---", "", body].join("\n"));
  return stem;
}

const names = () => new Set(readdirSync(dir));

// ---------- dispatchPollingNow ----------

test("dispatchPollingNow — polling·polling_fails를 비우고 polling_until·polled_at은 남긴다", async () => {
  const stem = ticket(
    "poll0001",
    [
      "ticket: poll0001",
      "title: 외부 빌드를 기다린다",
      "persona: developer",
      "polling: check.sh",
      "polling_until: 2099-01-01T00:00:00+09:00",
      "polled_at: 2026-08-30T10:00:00+09:00",
      "polling_fails: 2",
    ],
    "## 결과\n\n외부 빌드가 끝나기를 기다린다.\n",
  );
  const before = names();

  const r = await dispatchPollingNow(root, SFX, stem, "ko");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ok && r.stem, stem);

  const { fm } = readFm(readFileSync(path.join(dir, `${stem}.md`), "utf8"));
  assert.strictEqual(fm.polling, undefined);
  assert.strictEqual(fm.polling_fails, undefined);
  assert.strictEqual(fm.polling_until, "2099-01-01T00:00:00+09:00");
  assert.strictEqual(fm.polled_at, "2026-08-30T10:00:00+09:00");
  assert.deepStrictEqual(names(), before); // 새 파일 0개
});

test("dispatchPollingNow — polling이 비어 있으면(isPolling 거짓) 거절하고 fm이 안 갈린다", async () => {
  const stem = ticket("poll0002", ["ticket: poll0002", "title: 대기 아님", "persona: developer"], "본문.\n");
  const raw = readFileSync(path.join(dir, `${stem}.md`), "utf8");

  const r = await dispatchPollingNow(root, SFX, stem, "ko");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ok ? "" : r.error, "이 티켓은 지금 폴링 대기 상태가 아닙니다.");
  assert.strictEqual(readFileSync(path.join(dir, `${stem}.md`), "utf8"), raw); // 한 글자도 안 갈림
});

// ---------- extendPollingUntil ----------

test("extendPollingUntil — 파싱되는 미래 시각이면 polling_until 하나만 갈린다", async () => {
  const stem = ticket(
    "poll0003",
    [
      "ticket: poll0003",
      "title: 상한을 늘린다",
      "persona: developer",
      "polling: check.sh",
      "polling_until: 2026-09-01T00:00:00+09:00",
      "polling_fails: 1",
    ],
    "본문.\n",
  );
  const before = names();

  const r = await extendPollingUntil(root, SFX, stem, "2099-01-01T00:00", new Date("2026-08-30T00:00:00Z"), "ko");
  assert.strictEqual(r.ok, true);

  const { fm } = readFm(readFileSync(path.join(dir, `${stem}.md`), "utf8"));
  assert.strictEqual(fm.polling_until, "2099-01-01T00:00");
  assert.strictEqual(fm.polling, "check.sh"); // 나머지 키는 그대로
  assert.strictEqual(fm.polling_fails, "1");
  assert.deepStrictEqual(names(), before); // 새 파일 0개
});

test("extendPollingUntil — 못 읽는 값과 지금보다 앞선 값 둘 다 거절하고 fm이 안 갈린다", async () => {
  const stem = ticket(
    "poll0004",
    ["ticket: poll0004", "title: 거절", "persona: developer", "polling: check.sh", "polling_until: 2026-09-01T00:00:00+09:00"],
    "본문.\n",
  );
  const now = new Date("2026-08-30T00:00:00Z");

  const bad = await extendPollingUntil(root, SFX, stem, "이번 주말쯤", now, "ko");
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.ok ? "" : bad.error, "상한 값을 읽을 수 없습니다.");

  const past = await extendPollingUntil(root, SFX, stem, "2020-01-01T00:00", now, "ko");
  assert.strictEqual(past.ok, false);
  assert.strictEqual(past.ok ? "" : past.error, "상한은 지금보다 뒤여야 합니다.");

  const { fm } = readFm(readFileSync(path.join(dir, `${stem}.md`), "utf8"));
  assert.strictEqual(fm.polling_until, "2026-09-01T00:00:00+09:00"); // 원값 그대로
});
