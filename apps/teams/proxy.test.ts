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

test("랜딩-only — /market도 404다(§페르소나 마켓 §화면)", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    assert.strictEqual(proxy(req("/market")).status, 404);
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("풀 모드 — /market은 통과한다", () => {
  delete process.env.DIRA_LANDING_ONLY;
  assert.ok(isPassthrough(proxy(req("/market"))));
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

test("랜딩-only - /api/error-report 하나만 통과하고 나머지 /api/**는 404다", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    assert.ok(isPassthrough(proxy(req("/api/error-report", { method: "POST" }))));
    assert.ok(isPassthrough(proxy(req("/api/error-report/purge"))));
    assert.strictEqual(proxy(req("/api/error-report/purge/x")).status, 404);
    assert.strictEqual(proxy(req("/api/error-reports")).status, 404);
    assert.strictEqual(proxy(req("/api/awaiting")).status, 404);
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("P548 - 랜딩-only: 헤더 없음과 ko는 200, en은 /en 302이고 셋 다 Vary에 Accept-Language가 있다", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    for (const h of [{} as Record<string, string>, { "accept-language": "ko" }, { "accept-language": "ko-KR,ko;q=0.9,en;q=0.8" }]) {
      const r = proxy(req("/", { headers: h }));
      assert.ok(isPassthrough(r));
      assert.match(r.headers.get("vary") ?? "", /Accept-Language/);
    }
    const en = proxy(req("/", { headers: { "accept-language": "en-US,en;q=0.9" } }));
    assert.strictEqual(en.status, 302);
    assert.strictEqual(new URL(en.headers.get("location")!).pathname, "/en");
    assert.match(en.headers.get("vary") ?? "", /Accept-Language/);
    const doc = proxy(req("/docs/install", { headers: { "accept-language": "en" } }));
    assert.strictEqual(new URL(doc.headers.get("location")!).pathname, "/en/docs/install");
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("P548 - 쿠키가 Accept-Language를 이긴다(ko는 안 보내고 en은 보낸다)", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    const ko = proxy(req("/", { headers: { "accept-language": "en", cookie: "dira-locale=ko" } }));
    assert.ok(isPassthrough(ko));
    const en = proxy(req("/privacy", { headers: { cookie: "dira-locale=en" } }));
    assert.strictEqual(en.status, 302);
    assert.strictEqual(new URL(en.headers.get("location")!).pathname, "/en/privacy");
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("P548 - /en/**는 한국어 라우트로 rewrite되고 x-site-locale: en이 실린다(어떤 헤더로도)", () => {
  for (const mode of ["1", undefined]) {
    if (mode) process.env.DIRA_LANDING_ONLY = mode;
    else delete process.env.DIRA_LANDING_ONLY;
    try {
      for (const [from, to] of [["/en", "/"], ["/en/docs/install", "/docs/install"], ["/en/privacy", "/privacy"], ["/en/terms", "/terms"]]) {
        const r = proxy(req(from, { headers: { "accept-language": "ko", cookie: "dira-locale=ko" } }));
        assert.strictEqual(new URL(r.headers.get("x-middleware-rewrite")!).pathname, to);
        assert.strictEqual(r.headers.get("x-middleware-request-x-site-locale"), "en");
      }
    } finally {
      delete process.env.DIRA_LANDING_ONLY;
    }
  }
});

test("P548 - 밖에서 보낸 x-site-locale은 한국어 주소에서 지워진다", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    const r = proxy(req("/docs/install", { headers: { "x-site-locale": "en" } }));
    assert.ok(isPassthrough(r));
    assert.ok(!r.headers.get("x-middleware-override-headers")?.includes("x-site-locale") || r.headers.get("x-middleware-request-x-site-locale") === null);
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});

test("P548 - /en/p/dira는 공개 주소가 아니다(랜딩-only 404가 아니라 통과해 라우트 404)", () => {
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    assert.ok(isPassthrough(proxy(req("/en/p/dira"))));
  } finally {
    delete process.env.DIRA_LANDING_ONLY;
  }
});
