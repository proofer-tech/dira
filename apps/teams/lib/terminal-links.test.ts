import { strict as assert } from "node:assert";
import test from "node:test";
import { cellsToString, findTerminalLinks, linkCellRange, type TerminalCell } from "./terminal-links.ts";

test("findTerminalLinks — 줄 안의 http · https URL을 위치와 함께 찾는다", () => {
  const line = "echo https://example.com 하고 http://a.b/c 도 있다";
  const links = findTerminalLinks(line);
  assert.equal(links.length, 2);
  assert.equal(links[0].start, line.indexOf("https://example.com"));
  assert.equal(links[0].text, "https://example.com");
  assert.equal(links[1].start, line.indexOf("http://a.b/c"));
  assert.equal(links[1].text, "http://a.b/c");
});

test("findTerminalLinks — 다른 스킴(§11-15 결정 3의 http·https 경계)은 안 잡는다", () => {
  assert.deepEqual(findTerminalLinks("ftp://x.y/z"), []);
  assert.deepEqual(findTerminalLinks("javascript:alert(1)"), []);
  assert.deepEqual(findTerminalLinks("그냥 문자열"), []);
});

test("findTerminalLinks — 꼬리 구두점을 URL에서 뗀다", () => {
  const links = findTerminalLinks("(https://example.com/a,b).");
  assert.equal(links.length, 1);
  assert.equal(links[0].text, "https://example.com/a,b");
});

// 줄 문자열을 xterm 셀 목록으로 흉내 낸다 - 한글은 폭 2 + 뒤 칸 폭 0.
function cellsOf(line: string): TerminalCell[] {
  const cells: TerminalCell[] = [];
  for (const ch of line) {
    const wide = /[\u3131-\uD7A3]/.test(ch);
    cells.push({ chars: ch, width: wide ? 2 : 1 });
    if (wide) cells.push({ chars: "", width: 0 });
  }
  return cells;
}

function rangeOf(line: string) {
  const cells = cellsOf(line);
  const text = cellsToString(cells);
  assert.equal(text, line);
  const m = findTerminalLinks(text)[0];
  return linkCellRange(cells, m.start, m.text.length);
}

test("linkCellRange - 한글 뒤 URL은 셀 열로 밀린다", () => {
  assert.deepEqual(rangeOf("다음 주소에서 코드를 승인하세요: http://localhost:3000/connect"), { start: 34, end: 62 });
});

test("linkCellRange - ASCII 줄은 문자열 인덱스와 같다", () => {
  assert.deepEqual(rangeOf("see http://a.b/c"), { start: 5, end: 16 });
});

test("linkCellRange - URL 뒤의 한글은 범위에 영향이 없다", () => {
  assert.deepEqual(rangeOf("http://a.b 다음"), { start: 1, end: 10 });
});
