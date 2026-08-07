import { test } from "node:test";
import assert from "node:assert";
import { isLandingOnly, isMultiToken } from "./flags.ts";

test("DIRA_LANDING_ONLY — 없으면 풀 모드, \"1\"일 때만 켜진다", () => {
  const saved = process.env.DIRA_LANDING_ONLY;
  try {
    delete process.env.DIRA_LANDING_ONLY;
    assert.strictEqual(isLandingOnly(), false);
    process.env.DIRA_LANDING_ONLY = "true"; // 정확히 "1"만 켠다
    assert.strictEqual(isLandingOnly(), false);
    process.env.DIRA_LANDING_ONLY = "1";
    assert.strictEqual(isLandingOnly(), true);
  } finally {
    if (saved === undefined) delete process.env.DIRA_LANDING_ONLY;
    else process.env.DIRA_LANDING_ONLY = saved;
  }
});

test("DIRA_MULTI_TOKEN — 없으면 잠김, \"1\"일 때만 해금 (폴라리티가 위와 반대다)", () => {
  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN;
    assert.strictEqual(isMultiToken(), false);
    process.env.DIRA_MULTI_TOKEN = "true"; // 정확히 "1"만 켠다
    assert.strictEqual(isMultiToken(), false);
    process.env.DIRA_MULTI_TOKEN = "1";
    assert.strictEqual(isMultiToken(), true);
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
  }
});
