import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira`를 밟지 않는다 — `session-cap.test.ts`와 같은 관용구, import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "browser-pool-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { listBrowserPoolSlots } = await import("./browser-pool.ts");

process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

function slot(
  name: string,
  files: { hash?: string | null; pid?: string | null; owner?: string | null; busy?: string | null },
): void {
  const dir = path.join(LOCAL, "browser-pool", name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    if (content !== null && content !== undefined) writeFileSync(path.join(dir, file), content);
  }
}

test("listBrowserPoolSlots — 풀 디렉터리가 없으면 빈 목록", async () => {
  assert.deepStrictEqual(await listBrowserPoolSlots(), { slots: [], hasDeadSlot: false });
});

test("listBrowserPoolSlots — hash 관문 밖·빈 값은 건너뛴다", async () => {
  slot("slot-a", { hash: "aabbccdd\n", pid: String(process.pid) });
  slot("slot-b", { hash: "../etc/passwd", pid: String(process.pid) }); // 관문 밖 — 손상된 슬롯
  slot("slot-c", {}); // hash 파일 자체가 없다 — 회수 중인 슬롯
  const { slots, hasDeadSlot } = await listBrowserPoolSlots();
  assert.deepStrictEqual(
    slots.map((s) => s.hash).sort(),
    ["aabbccdd"],
  );
  assert.strictEqual(hasDeadSlot, false);
});

test("listBrowserPoolSlots — pid가 죽은 슬롯은 목록에서 빠지고 hasDeadSlot이 선다", async () => {
  slot("slot-dead", { hash: "deadbeef", pid: "999999" }); // 살아 있을 리 없는 pid
  const { slots, hasDeadSlot } = await listBrowserPoolSlots();
  assert.ok(!slots.some((s) => s.hash === "deadbeef"));
  assert.strictEqual(hasDeadSlot, true);
});

test("listBrowserPoolSlots — owner·busy를 같이 읽는다. owner 없으면 null, busy는 pid 생사로 켜진다", async () => {
  slot("slot-owned", { hash: "11223344", pid: String(process.pid), owner: "worker:w3", busy: String(process.pid) });
  slot("slot-bare", { hash: "55667788", pid: String(process.pid) }); // 옛 슬롯 — owner 없음
  slot("slot-stale-busy", { hash: "99aabbcc", pid: String(process.pid), busy: "999999" }); // 죽은 busy pid
  const { slots } = await listBrowserPoolSlots();
  const byHash = Object.fromEntries(slots.map((s) => [s.hash, s]));
  assert.deepStrictEqual(byHash["11223344"], { hash: "11223344", owner: "worker:w3", busy: true });
  assert.deepStrictEqual(byHash["55667788"], { hash: "55667788", owner: null, busy: false });
  assert.deepStrictEqual(byHash["99aabbcc"], { hash: "99aabbcc", owner: null, busy: false });
});
