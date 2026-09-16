import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira`를 밟지 않는다 — `session-cap.test.ts`와 같은 관용구, import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "browser-pool-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { listBrowserPoolHashes } = await import("./browser-pool.ts");

process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

function slot(name: string, content: string | null): void {
  const dir = path.join(LOCAL, "browser-pool", name);
  mkdirSync(dir, { recursive: true });
  if (content !== null) writeFileSync(path.join(dir, "hash"), content);
}

test("listBrowserPoolHashes — 풀 디렉터리가 없으면 빈 배열", async () => {
  assert.deepStrictEqual(await listBrowserPoolHashes(), []);
});

test("listBrowserPoolHashes — 슬롯마다 hash 파일 한 줄을 읽는다, 관문 밖·빈 값은 건너뛴다", async () => {
  slot("slot-a", "aabbccdd\n");
  slot("slot-b", "11223344");
  slot("slot-c", "../etc/passwd"); // 관문(`isValidCdpHash`) 밖 — 손상된 슬롯
  slot("slot-d", null); // hash 파일 자체가 없다 — 회수 중인 슬롯
  const hashes = await listBrowserPoolHashes();
  assert.deepStrictEqual([...hashes].sort(), ["11223344", "aabbccdd"]);
});
