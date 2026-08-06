import { test } from "node:test";
import assert from "node:assert";
import { lineDiff } from "./edit-diff.ts";

test("교체 — 한 줄이 다른 줄로 바뀌면 공통 줄 사이에 -/+ 한 쌍", () => {
  assert.deepEqual(lineDiff("가\n나\n다", "가\n바\n다"), [
    { kind: " ", text: "가" },
    { kind: "-", text: "나" },
    { kind: "+", text: "바" },
    { kind: " ", text: "다" },
  ]);
});

test("삽입만 — old가 new의 부분열이면 +만 나온다", () => {
  assert.deepEqual(lineDiff("가\n다", "가\n나\n다"), [
    { kind: " ", text: "가" },
    { kind: "+", text: "나" },
    { kind: " ", text: "다" },
  ]);
});

test("삭제만 — new가 old의 부분열이면 -만 나온다", () => {
  assert.deepEqual(lineDiff("가\n나\n다", "가\n다"), [
    { kind: " ", text: "가" },
    { kind: "-", text: "나" },
    { kind: " ", text: "다" },
  ]);
});

test("동일 문자열 — 전부 공통 줄, +/- 없음 (§9 빈 상태를 세우지 않는다)", () => {
  const s = "가\n나\n다";
  assert.deepEqual(
    lineDiff(s, s),
    s.split("\n").map((text) => ({ kind: " ", text })),
  );
});

test("빈 문자열 — old만 비면 전부 +, new만 비면 전부 -, 둘 다 비면 빈 배열", () => {
  assert.deepEqual(lineDiff("", "가\n나"), [
    { kind: "+", text: "가" },
    { kind: "+", text: "나" },
  ]);
  assert.deepEqual(lineDiff("가\n나", ""), [
    { kind: "-", text: "가" },
    { kind: "-", text: "나" },
  ]);
  assert.deepEqual(lineDiff("", ""), []);
});

test("꼬리 개행 — 한쪽에만 있어도 빈 부호 줄이 서지 않는다", () => {
  assert.deepEqual(lineDiff("가\n", "가"), [{ kind: " ", text: "가" }]);
  assert.deepEqual(lineDiff("가", "가\n"), [{ kind: " ", text: "가" }]);
});
