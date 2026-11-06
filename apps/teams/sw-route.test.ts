import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// package.json이 type: module이라 .js를 require할 수 없다 - 워커처럼 고전 스크립트로 평가한다.
const classifyRequest = new Function(`${readFileSync(new URL("./public/sw-route.js", import.meta.url), "utf8")}; return classifyRequest;`)() as (
  r: unknown,
  origin: string,
) => string;
const O = "http://127.0.0.1:7331";
const req = (url: string, o: { method?: string; mode?: string; h?: Record<string, string> } = {}) => ({
  method: o.method ?? "GET",
  url: O + url,
  mode: o.mode ?? "no-cors",
  headers: { get: (k: string) => o.h?.[k] ?? null },
});

test("정적 자산은 캐시 우선", () => {
  for (const u of ["/_next/static/chunks/a.js", "/fonts/w.woff2", "/icon.svg", "/offline.html"]) assert.equal(classifyRequest(req(u), O), "static", u);
});
test("API, RSC, 서버 액션, POST, 타 오리진은 손대지 않는다", () => {
  assert.equal(classifyRequest(req("/api/x"), O), "pass");
  assert.equal(classifyRequest(req("/p/a?_rsc=1", { mode: "navigate" }), O), "pass");
  assert.equal(classifyRequest(req("/p/a", { h: { RSC: "1" } }), O), "pass");
  assert.equal(classifyRequest(req("/p/a", { method: "POST", mode: "navigate" }), O), "pass");
  assert.equal(classifyRequest(req("/p/a", { h: { "Next-Action": "x" } }), O), "pass");
  assert.equal(classifyRequest({ ...req("/fonts/a"), url: "https://evil.test/fonts/a" }, O), "pass");
});
test("화면 이동은 navigate, 그 밖의 GET은 pass", () => {
  assert.equal(classifyRequest(req("/p/a", { mode: "navigate" }), O), "navigate");
  assert.equal(classifyRequest(req("/p/a"), O), "pass");
});
