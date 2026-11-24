/** `cron-restore.ts` - 기록 파일과 지금 crontab으로 새 본문을 계산한다. */
import assert from "node:assert/strict";
import test from "node:test";
import { restoreCron, restoredName } from "./cron-restore.ts";

const mine = `# dira-worker "/w/a.sh"\n*/5 * * * * "/w/a.sh"\n`;
const other = `# 메모\n0 3 * * * echo  '남의   줄'\n`;

test("(가) 기록 파일이 없으면 변경 없음이고 옮기지 않는다", () => {
  assert.deepEqual(restoreCron(other, null), { next: null, archive: false });
});

test("(나) 일부만 있으면 없는 줄만 끝에 덧붙이고 남의 줄은 그대로이며 기록을 옮긴다", () => {
  const r = restoreCron(other + `# dira-worker "/w/a.sh"\n`, mine);
  assert.equal(r.next, other + `# dira-worker "/w/a.sh"\n*/5 * * * * "/w/a.sh"\n`);
  assert.equal(r.archive, true);
  assert.equal(restoreCron("", mine).next, mine);
  assert.equal(restoreCron("x", mine).next, "x\n" + mine); // 끝 개행이 없는 본문
});

test("(다) 모두 있으면 변경 없음이지만 기록은 옮긴다", () => {
  assert.deepEqual(restoreCron(other + mine, mine), { next: null, archive: true });
  assert.deepEqual(restoreCron(other, "\n"), { next: null, archive: true });
});

test("기록의 중복 줄은 한 번만 덧붙인다", () => {
  assert.equal(restoreCron("", mine + mine).next, mine);
});

test("옮길 이름에 UTC 시각이 들어간다", () => {
  assert.equal(restoredName(new Date("2026-11-24T04:55:00.123Z")), "uninstalled.crontab.restored-20261124T045500Z");
});
