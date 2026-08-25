import { test } from "node:test";
import assert from "node:assert";

/** 28f72b69 — `next/dist/lib/static-env.js`의 `getNextConfigEnv`는 `env`의 값이
 *  `value != null`일 때만 빌드 시각 치환 규칙을 만든다. 빌드 시각에 `DIRA_MULTI_TOKEN`이
 *  `undefined`(잠금 빌드)면 이 값도 그대로 `undefined`가 되어 치환 자체가 안 생기고, 컴파일된
 *  서버 청크에 `process.env.DIRA_MULTI_TOKEN` 표현식이 남아 런타임 프로세스 env로 매 요청
 *  재평가된다 — 잠금 방향이 정확히 안 굳는다(실측: 잠금 build 후 런타임에 값을 주면 풀린다).
 *  `next.config.ts`의 `env.DIRA_MULTI_TOKEN`은 항상 정의된 문자열("0"/"1")이어야 한다 — 그래야
 *  어느 방향이든 Next 번들러가 리터럴로 굽는다. `flags.test.ts`처럼 `isMultiToken()`을 직접
 *  부르는 테스트는 `next.config.ts`를 안 거치므로 이 결함을 못 잡는다(그건 이미 통과했었다). */
test("next.config env.DIRA_MULTI_TOKEN — 없어도 undefined를 안 흘리고 \"0\"으로 고정한다", async () => {
  const saved = process.env.DIRA_MULTI_TOKEN;
  try {
    delete process.env.DIRA_MULTI_TOKEN;
    const { default: locked } = await import("./next.config.ts?locked-28f72b69");
    assert.strictEqual(locked.env.DIRA_MULTI_TOKEN, "0");

    process.env.DIRA_MULTI_TOKEN = "1";
    const { default: unlocked } = await import("./next.config.ts?unlocked-28f72b69");
    assert.strictEqual(unlocked.env.DIRA_MULTI_TOKEN, "1");

    process.env.DIRA_MULTI_TOKEN = "true"; // 정확히 "1"만 해금
    const { default: bogus } = await import("./next.config.ts?bogus-28f72b69");
    assert.strictEqual(bogus.env.DIRA_MULTI_TOKEN, "0");
  } finally {
    if (saved === undefined) delete process.env.DIRA_MULTI_TOKEN;
    else process.env.DIRA_MULTI_TOKEN = saved;
  }
});
