import { strict as assert } from "node:assert";
import test from "node:test";
import { findTerminalLinks } from "./terminal-links.ts";

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
