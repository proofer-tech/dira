import { test } from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server.js";
import type { RequestInit } from "next/dist/server/web/spec-extension/request.js";
import { proxy } from "./proxy.ts";

function req(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:7331"), init);
}

function isPassthrough(res: Response) {
  return res.headers.get("x-middleware-next") === "1";
}

test("풀 모드(플래그 없음) — 화면·액션 전부 통과", () => {
  delete process.env.DIRA_LANDING_ONLY;
  assert.ok(isPassthrough(proxy(req("/p/dira"))));
  assert.ok(isPassthrough(proxy(req("/api/awaiting"))));
  assert.ok(
    isPassthrough(proxy(req("/", { method: "POST", headers: { "next-action": "abc" } }))),
  );
});

test("랜딩-only — /p/**·/api/**가 404 (메서드 무관)", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    assert.strictEqual(proxy(req("/p/dira")).status, 404);
    assert.strictEqual(proxy(req("/p/dira/workers")).status, 404);
    assert.strictEqual(proxy(req("/api/awaiting")).status, 404);
    assert.strictEqual(proxy(req("/api/work")).status, 404);
    assert.strictEqual(
      proxy(req("/p/dira", { method: "POST", headers: { "next-action": "abc" } })).status,
      404,
    );
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("랜딩-only — 홈의 서버 액션(POST + next-action)이 거절된다", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    const res = proxy(req("/", { method: "POST", headers: { "next-action": "abc" } }));
    assert.strictEqual(res.status, 403);
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("랜딩-only — 홈 GET(액션 아님)은 그대로 통과", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    assert.ok(isPassthrough(proxy(req("/"))));
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});
