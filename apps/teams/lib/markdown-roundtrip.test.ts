import { test } from "node:test";
import assert from "node:assert";
import { byteDiffCount, measure, splicedRoundTrip, fullSerializeRoundTrip } from "./markdown-roundtrip.ts";

// 이 큐(도그푸딩 큐)를 절대 만지지 않는다 — 제약 1. 실제 티켓 코퍼스에서 뽑은 모양을 그대로 흉내낸
// 픽스처만 쓴다.
const TICKET_LIKE = `---
ticket: 98052584
title: 예시 티켓
session_id: b6e04897-9543-44e0-9807-fd5d83fc7a92
---

## Goal

옆 티켓 <hash>를 참고한다. \`assigned_at\`은 코드스팬 안이라 안 센다.

## Done when

- [ ] 첫째
- [x] 둘째

| 무엇 | 값 |
|---|---|
| a | 1 |

\`\`\`
<코드펜스 안의 hash>와 session_id는 그대로 남아야 한다
\`\`\`
`;

const PLAIN = "그냥 문단 하나뿐이다.\n";

test("ⓐ mdast position splice — 원문 그대로(항등)", () => {
  for (const src of [TICKET_LIKE, PLAIN, ""]) {
    assert.strictEqual(splicedRoundTrip(src), src);
    assert.strictEqual(byteDiffCount(splicedRoundTrip(src), src), 0);
  }
});

test("ⓑ full mdast serialize — 표·체크박스·밑줄·frontmatter에서 갈린다", () => {
  const out = fullSerializeRoundTrip(TICKET_LIKE);
  assert.notStrictEqual(out, TICKET_LIKE);
  assert.ok(byteDiffCount(out, TICKET_LIKE) > 0);
});

test("measure — 카테고리별 집계", () => {
  const sources: Array<[string, string]> = [
    ["a.md", TICKET_LIKE],
    ["b.md", PLAIN],
  ];
  const spliced = measure(splicedRoundTrip, sources);
  assert.strictEqual(spliced.files, 2);
  assert.strictEqual(spliced.filesDiffered, 0);
  assert.strictEqual(spliced.bytesDiffered, 0);
  assert.strictEqual(spliced.byCategory["표"].files, 1);
  assert.strictEqual(spliced.byCategory["표"].differed, 0);
  assert.strictEqual(spliced.byCategory["체크박스"].files, 1);
  assert.strictEqual(spliced.byCategory["코드펜스"].files, 1);
  assert.strictEqual(spliced.byCategory["맨 <…>"].files, 1);
  assert.strictEqual(spliced.byCategory["낱말 안 밑줄"].files, 1);

  const full = measure(fullSerializeRoundTrip, sources);
  assert.strictEqual(full.filesDiffered, 1); // TICKET_LIKE만 갈린다, PLAIN은 살아남는다
  assert.ok(full.bytesDiffered > 0);
});
