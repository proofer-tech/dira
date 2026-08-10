import { test } from "node:test";
import assert from "node:assert/strict";
import { blockBreaks, joinBlocks, replaceBlock, splitBlocks } from "./markdown-editor-blocks.ts";

test("안 고치면 바이트가 그대로다 (못 ①)", () => {
  const source = "# 제목\n\n본문 한 줄.\n\n- [ ] 하나\n- [x] 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  assert.equal(joinBlocks(splitBlocks(source)), source);
});

test("빈 문자열도 항등이다", () => {
  assert.equal(joinBlocks(splitBlocks("")), "");
  assert.equal(joinBlocks(splitBlocks("\n")), "\n");
});

test("블록 하나만 갈아 끼우면 그 밖은 안 갈린다 (못 ① 둘째 반쪽)", () => {
  const source = "첫 블록.\n\n둘째 블록.\n\n셋째 블록.\n";
  const split = splitBlocks(source);
  assert.equal(split.blocks.length, 3);
  const leading = split.blocks[1].match(/^\n*/)?.[0] ?? "";
  const out = replaceBlock(split, 1, `${leading}둘째 블록 고침.`);
  assert.equal(out, "첫 블록.\n\n둘째 블록 고침.\n\n셋째 블록.\n");
});

test("firstHeadingIndex — untilHeading 경계(lib/markdown-breaks.ts와 같은 판정)", () => {
  const withHeading = splitBlocks("첫 줄.\n둘째 줄.\n\n## 결과\n\n뒤 문단.\n");
  assert.equal(withHeading.firstHeadingIndex, 1);
  const noHeading = splitBlocks("첫 줄.\n둘째 줄.\n");
  assert.equal(noHeading.firstHeadingIndex, null);
});

test("blockBreaks — untilHeading은 첫 heading 앞만 all, 나머지는 undefined", () => {
  const { firstHeadingIndex } = splitBlocks("첫 문단.\n\n## 결과\n\n뒤 문단.\n");
  assert.equal(blockBreaks(0, "untilHeading", firstHeadingIndex), "all");
  assert.equal(blockBreaks(1, "untilHeading", firstHeadingIndex), undefined); // heading 자신
  assert.equal(blockBreaks(2, "untilHeading", firstHeadingIndex), undefined); // heading 뒤
  assert.equal(blockBreaks(0, "untilHeading", null), "all"); // heading이 아예 없으면 전부 앞
});

test("blockBreaks — all·undefined는 블록과 무관하게 그대로 걸린다", () => {
  assert.equal(blockBreaks(3, "all", 0), "all");
  assert.equal(blockBreaks(3, undefined, 0), undefined);
});
