import { test } from "node:test";
import assert from "node:assert";
import { snapScrollTopToLineGrid } from "./scroll-grid.ts";

test("0 — 패딩 안, 그대로", () => {
  assert.equal(snapScrollTopToLineGrid(0, 10000), 0);
});

test("12 — 패딩 경계, 그대로", () => {
  assert.equal(snapScrollTopToLineGrid(12, 10000), 12);
});

test("13 — 패딩 밖, 한 줄 올림", () => {
  assert.equal(snapScrollTopToLineGrid(13, 10000), 36);
});

test("최대 초과 — 올린 값이 최대를 넘으면 한 칸(24) 내린다", () => {
  assert.equal(snapScrollTopToLineGrid(13, 30), 12);
});
