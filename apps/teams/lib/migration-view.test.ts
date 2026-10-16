import { test } from "node:test";
import assert from "node:assert/strict";
import { mmss, needsOverlay, overlayShown, waitExpired, type MigrationRow, type MigrationState } from "./migration-view.ts";

const row = (state: MigrationState, extra: Partial<MigrationRow> = {}): MigrationRow => ({
  key: "a", name: "a", root: "/x", state, item: "", desc: "", desc_en: "", sessions: 0, waited_s: 0,
  error: "", log: "", backup: "", ...extra,
});

test("진행 행이 있으면 덮고, 완료 - 건너뜀뿐이면 안 덮는다", () => {
  assert.equal(needsOverlay([row("완료"), row("진행")]), true);
  for (const s of ["대기", "세션 대기", "실패"] as const) assert.equal(needsOverlay([row(s)]), true);
  assert.equal(needsOverlay([row("완료"), row("건너뜀")]), false);
  assert.equal(needsOverlay(undefined), false);
});

test("모두 끝나면 1초 뒤 걷힌다", () => {
  const done = [row("완료")];
  assert.equal(overlayShown(done, 1000, 1999), true);
  assert.equal(overlayShown(done, 1000, 2000), false);
  assert.equal(overlayShown(done, null, 0), false);
  assert.equal(overlayShown([row("진행")], null, 0), true);
});

test("세션 대기 20분 넘으면 버튼 조건", () => {
  assert.equal(waitExpired(row("세션 대기", { waited_s: 1199 })), false);
  assert.equal(waitExpired(row("세션 대기", { waited_s: 1200 })), true);
  assert.equal(waitExpired(row("진행", { waited_s: 9999 })), false);
  assert.equal(mmss(65), "01:05");
});
