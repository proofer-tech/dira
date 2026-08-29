// 판정이 순수 함수라 electron 없이 분기 전부를 밟는다.
// $ cd apps/desktop && pnpm test
import assert from "node:assert/strict";
import test from "node:test";
import { classifyLink } from "./link.ts";

test("classifyLink — 지금 오리진 안이면 internal", () => {
  assert.equal(classifyLink("http://127.0.0.1:7331", "http://127.0.0.1:7331"), "internal");
  assert.equal(classifyLink("http://127.0.0.1:7331/p/foo", "http://127.0.0.1:7331"), "internal");
});

test("classifyLink — 밖의 http/https는 external", () => {
  assert.equal(classifyLink("https://example.com", "http://127.0.0.1:7331"), "external");
});

test("classifyLink — 그 밖의 스킴은 ignore", () => {
  assert.equal(classifyLink("mailto:a@b.com", "http://127.0.0.1:7331"), "ignore");
  assert.equal(classifyLink("file:///etc/passwd", "http://127.0.0.1:7331"), "ignore");
});

test("classifyLink — 되살리기로 오리진이 바뀐 뒤: 새 오리진 주소는 internal, 옛 오리진 주소는 external", () => {
  const oldOrigin = "http://127.0.0.1:7331";
  const newOrigin = "http://127.0.0.1:7332";
  assert.equal(classifyLink(`${newOrigin}/p/foo`, newOrigin), "internal");
  assert.equal(classifyLink(`${oldOrigin}/p/foo`, newOrigin), "external");
});
