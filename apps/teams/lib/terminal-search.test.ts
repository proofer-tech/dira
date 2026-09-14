import { strict as assert } from "node:assert";
import test from "node:test";
import { isShellBoundCtrlF, resultLabel, searchDecorations } from "./terminal-search.ts";

test("isShellBoundCtrlF — 리눅스·윈도우의 Ctrl+F를 잡는다 (§7 §Ctrl+F가 셸로 새면 안 된다)", () => {
  assert.equal(isShellBoundCtrlF({ type: "keydown", ctrlKey: true, metaKey: false, key: "f" }), true);
  assert.equal(isShellBoundCtrlF({ type: "keydown", ctrlKey: true, metaKey: false, key: "F" }), true);
});

test("isShellBoundCtrlF — 맥의 ⌘F는 ctrlKey가 아니라 안 걸린다", () => {
  assert.equal(isShellBoundCtrlF({ type: "keydown", ctrlKey: false, metaKey: true, key: "f" }), false);
});

test("isShellBoundCtrlF — Ctrl+F라도 메타까지 같이 눌렸으면 안 잡는다(정말 의도한 조합 하나만)", () => {
  assert.equal(isShellBoundCtrlF({ type: "keydown", ctrlKey: true, metaKey: true, key: "f" }), false);
});

test("isShellBoundCtrlF — 다른 글자(Ctrl+G)나 keyup은 안 걸린다", () => {
  assert.equal(isShellBoundCtrlF({ type: "keydown", ctrlKey: true, metaKey: false, key: "g" }), false);
  assert.equal(isShellBoundCtrlF({ type: "keyup", ctrlKey: true, metaKey: false, key: "f" }), false);
});

test("searchDecorations — --primary 하나로 넷 다 채운다, 전체 강조만 25% 섞는다", () => {
  const d = searchDecorations("oklch(0.205 0 0)");
  assert.equal(d.matchBackground, "color-mix(in oklab, oklch(0.205 0 0) 25%, transparent)");
  assert.equal(d.activeMatchBackground, "oklch(0.205 0 0)");
  assert.equal(d.matchOverviewRuler, "oklch(0.205 0 0)");
  assert.equal(d.activeMatchColorOverviewRuler, "oklch(0.205 0 0)");
});

test("resultLabel — 질의가 비면 빈칸이다(안 찾은 것과 0건은 다른 사실이다, §30 ③)", () => {
  assert.deepEqual(resultLabel("", null), { label: "", idle: true });
});

test("resultLabel — 0건이면 0/0이고 idle이다", () => {
  assert.deepEqual(resultLabel("xyz", { index: -1, count: 0 }), { label: "0/0", idle: true });
});

test("resultLabel — resultIndex는 0-based, 표기는 1-based다(3/12)", () => {
  assert.deepEqual(resultLabel("xyz", { index: 2, count: 12 }), { label: "3/12", idle: false });
});

test("resultLabel — highlightLimit을 넘겨 resultIndex가 -1이어도 건수가 있으면 1/count로 접는다", () => {
  assert.deepEqual(resultLabel("xyz", { index: -1, count: 2000 }), { label: "1/2000", idle: false });
});
