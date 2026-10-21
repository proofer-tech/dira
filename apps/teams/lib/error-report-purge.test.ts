import { test } from "node:test";
import assert from "node:assert";
import { purge, type Store } from "./error-report-purge.ts";

const now = new Date("2026-10-21T03:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);
const call = (auth?: string) =>
  new Request("http://x/api/error-report/purge", { headers: auth ? { authorization: auth } : {} });

function fake(paths: string[]) {
  const removed: string[] = [];
  const store: Store = {
    list: async (c) => (c ? { paths: paths.slice(2) } : { paths: paths.slice(0, 2), cursor: "n" }),
    del: async (p) => void removed.push(...p),
  };
  return { store, removed };
}

test("CRON_SECRET 없음 - 틀린 헤더는 401이고 아무것도 안 지운다", async () => {
  const { store, removed } = fake([`error-reports/${day(200)}/a.json`]);
  delete process.env.CRON_SECRET;
  assert.strictEqual((await purge(call("Bearer x"), store, now)).status, 401);
  process.env.CRON_SECRET = "s";
  try {
    assert.strictEqual((await purge(call(), store, now)).status, 401);
    assert.strictEqual((await purge(call("Bearer x"), store, now)).status, 401);
  } finally {
    delete process.env.CRON_SECRET;
  }
  assert.deepStrictEqual(removed, []);
});

test("91일 전은 지우고 89일 전 - 90일 전은 남긴다(페이지 둘)", async () => {
  const old = `error-reports/${day(91)}/a.json`;
  const old2 = `error-reports/${day(400)}/b.json`;
  const { store, removed } = fake([
    `error-reports/${day(89)}/c.json`, old, `error-reports/${day(90)}/d.json`, old2, "other/x.json",
  ]);
  process.env.CRON_SECRET = "s";
  try {
    const res = await purge(call("Bearer s"), store, now);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { deleted: 2 });
  } finally {
    delete process.env.CRON_SECRET;
  }
  assert.deepStrictEqual(removed, [old, old2]);
});
