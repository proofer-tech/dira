import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kickNewRequest } from "./home-kick.ts";

const snap = (h: string) => `- 새 요구사항 티켓 해시(이번 턴 한 번 · 8-hex · 큐에 없는 값): \`${h}\`\n`;

test("열림 파일이면 kick 1회, 없거나 .wip이면 0회", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hk-"));
  mkdirSync(path.join(root, "tickets"));
  writeFileSync(path.join(root, "tickets", "aaaaaaaa.md"), "x");
  writeFileSync(path.join(root, "tickets", "bbbbbbbb.wip.md"), "x");
  const calls: string[] = [];
  const kick = async (_r: string, h: string) => (calls.push(h), true);
  assert.equal(await kickNewRequest(root, snap("aaaaaaaa"), kick), true);
  assert.equal(await kickNewRequest(root, snap("bbbbbbbb"), kick), false);
  assert.equal(await kickNewRequest(root, snap("cccccccc"), kick), false);
  assert.equal(await kickNewRequest(root, "**큐를 읽지 못했다**", kick), false);
  assert.deepEqual(calls, ["aaaaaaaa"]);
});
