import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 마켓(~/.config/dira/market/)을 밟지 않는다. import 전에 건다(projects.test.ts 선례).
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-market-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  getMarketItem,
  listInstalls,
  listMarketItems,
  marketDir,
  marketItemId,
  needsUpdate,
  parseMarketItemId,
  readFavorites,
  toggleFavorite,
} = await import("./market.ts");

function seedPersona(owner: string, name: string, latest: number, tags: string[] = []) {
  const dir = path.join(marketDir(), "personas", owner, name);
  mkdirSync(path.join(dir, `v${latest}`), { recursive: true });
  writeFileSync(path.join(dir, `v${latest}`, "PROFILE.md"), `# ${name}\n`, "utf8");
  writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      kind: "persona",
      owner,
      ownerName: owner,
      name,
      tags,
      latest,
      versions: Array.from({ length: latest }, (_, i) => ({
        v: i + 1,
        at: "2026-09-19T18:00:00+09:00",
        note: `v${i + 1}`,
      })),
    }),
    "utf8",
  );
  return dir;
}

test("needsUpdate — 설치 버전이 latest보다 낮을 때만 참", () => {
  assert.equal(needsUpdate(1, 2), true);
  assert.equal(needsUpdate(2, 2), false);
  assert.equal(needsUpdate(3, 2), false);
});

test("marketItemId · parseMarketItemId — 조립과 되돌리기가 왕복한다", () => {
  const id = marketItemId("persona", "dira", "writer");
  assert.equal(id, "persona:dira/writer");
  assert.deepEqual(parseMarketItemId(id), { kind: "persona", owner: "dira", name: "writer" });
});

test("parseMarketItemId — 모양이 아니면 null", () => {
  assert.equal(parseMarketItemId("dira/writer"), null);
  assert.equal(parseMarketItemId("plugin:dira/writer"), null);
});

test("listMarketItems — 마켓 디렉터리가 없으면 빈 목록(오류 아님)", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "fst-market-empty-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = empty;
  try {
    assert.deepEqual(await listMarketItems(), []);
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("listMarketItems · getMarketItem — 심어 둔 페르소나를 목록·상세로 읽는다", async () => {
  seedPersona("dira", "writer", 2, ["글"]);

  const items = await listMarketItems("persona");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "persona:dira/writer");
  assert.equal(items[0].latest, 2);
  assert.equal(items[0].favorite, false);

  const detail = await getMarketItem("persona", "dira", "writer");
  assert.ok(detail);
  assert.equal(detail?.profile, "# writer\n");
  assert.equal(detail?.skills, null); // skills.md를 안 심었다 — null이지 오류가 아니다
  assert.equal(detail?.versions.length, 2);
});

test("getMarketItem — 없는 항목은 null", async () => {
  assert.equal(await getMarketItem("persona", "dira", "no-such"), null);
});

test("readFavorites · toggleFavorite — 왕복", async () => {
  const id = marketItemId("persona", "dira", "writer");
  assert.deepEqual(await readFavorites(), []);
  assert.deepEqual(await toggleFavorite(id), [id]);
  assert.deepEqual(await readFavorites(), [id]);
  assert.deepEqual(await toggleFavorite(id), []);
});

test("listInstalls — installs.jsonl이 없으면 빈 목록, 깨진 줄은 건너뛴다", async () => {
  mkdirSync(marketDir(), { recursive: true });
  const { writeFileSync: write } = await import("node:fs");
  write(
    path.join(marketDir(), "installs.jsonl"),
    [
      JSON.stringify({ at: "t1", kind: "persona", owner: "dira", name: "writer", v: 1, project: "pofol", as: "writer" }),
      "{ 깨진 줄",
      JSON.stringify({ at: "t2", kind: "persona", owner: "dira", name: "writer", v: 2, project: "pofol", as: "writer" }),
      JSON.stringify({ at: "t3", kind: "persona", owner: "dira", name: "other", v: 1, project: "pofol", as: "other" }),
    ].join("\n"),
    "utf8",
  );

  const rows = await listInstalls("persona", "dira", "writer");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.v), [1, 2]);
});
