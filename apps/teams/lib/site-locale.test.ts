import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  acceptLanguageLocale,
  countryLocale,
  pickManuscript,
  resolvePublicLocale,
} from "./site-locale.ts";

test("acceptLanguageLocale — ko/en만 고르고 지역 접미사는 앞 두 글자로 본다", () => {
  assert.equal(acceptLanguageLocale("en-US,en;q=0.9"), "en");
  assert.equal(acceptLanguageLocale("ko-KR,ko;q=0.9,en;q=0.8"), "ko");
  assert.equal(acceptLanguageLocale("ja,de;q=0.8"), undefined, "ko도 en도 없으면 못 고른다");
  assert.equal(acceptLanguageLocale(null), undefined);
  assert.equal(acceptLanguageLocale(undefined), undefined);
});

test("countryLocale — KR만 ko, 나머지는 en, 헤더 자체가 없으면 undefined", () => {
  assert.equal(countryLocale("KR"), "ko");
  assert.equal(countryLocale("US"), "en");
  assert.equal(countryLocale("JP"), "en");
  assert.equal(countryLocale(null), undefined);
});

test("resolvePublicLocale — 풀 모드는 language.json만 보고 쿠키·헤더는 무시한다", async () => {
  const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-site-locale-full-"));
  const savedLocal = process.env.TICKET_LOCAL;
  const savedFlag = process.env.DIRA_LANDING_ONLY;
  try {
    process.env.TICKET_LOCAL = LOCAL;
    delete process.env.DIRA_LANDING_ONLY;
    writeFileSync(path.join(LOCAL, "language.json"), JSON.stringify({ locale: "en" }));
    // 쿠키·헤더가 다른 값을 가리켜도 풀 모드는 머신 설정을 이긴다.
    assert.equal(await resolvePublicLocale("ko", "ko-KR,ko;q=0.9", "KR"), "en");
  } finally {
    rmSync(LOCAL, { recursive: true, force: true });
    if (savedLocal === undefined) delete process.env.TICKET_LOCAL;
    else process.env.TICKET_LOCAL = savedLocal;
    if (savedFlag === undefined) delete process.env.DIRA_LANDING_ONLY;
    else process.env.DIRA_LANDING_ONLY = savedFlag;
  }
});

test("resolvePublicLocale — 랜딩-only 판정 체인: 쿠키 > Accept-Language > 접속지 > ko", async () => {
  const saved = process.env.DIRA_LANDING_ONLY;
  try {
    process.env.DIRA_LANDING_ONLY = "1";
    assert.equal(await resolvePublicLocale("en", "ko-KR,ko;q=0.9", "KR"), "en", "쿠키가 최우선");
    assert.equal(
      await resolvePublicLocale(undefined, "en-US,en;q=0.9", "KR"),
      "en",
      "브라우저 언어가 접속지보다 우선",
    );
    assert.equal(await resolvePublicLocale(undefined, undefined, "KR"), "ko");
    assert.equal(await resolvePublicLocale(undefined, undefined, "US"), "en");
    // 필수 단언 — 헤더가 하나도 없는 요청은 ko로 떨어진다(접속지를 모르는 자리이지 한국 밖이 아니다).
    assert.equal(await resolvePublicLocale(undefined, undefined, undefined), "ko");
  } finally {
    if (saved === undefined) delete process.env.DIRA_LANDING_ONLY;
    else process.env.DIRA_LANDING_ONLY = saved;
  }
});

test("pickManuscript — en/ 미러가 있으면 그것을, 없으면 한국어 원본으로 떨어진다", () => {
  const BASE = mkdtempSync(path.join(tmpdir(), "fst-manuscript-"));
  try {
    mkdirSync(path.join(BASE, "en"), { recursive: true });
    writeFileSync(path.join(BASE, "terms.md"), "# 약관\n");
    writeFileSync(path.join(BASE, "en", "terms.md"), "# Terms\n");
    writeFileSync(path.join(BASE, "privacy.md"), "# 개인정보\n");

    assert.equal(pickManuscript("en", "terms.md", BASE), "# Terms\n", "en 미러가 있으면 그것");
    assert.equal(pickManuscript("ko", "terms.md", BASE), "# 약관\n", "ko는 항상 원본");
    // 필수 단언 — en/ 원고가 없는 장은 빈 화면·404 없이 한국어로 뜬다.
    assert.equal(pickManuscript("en", "privacy.md", BASE), "# 개인정보\n");
  } finally {
    rmSync(BASE, { recursive: true, force: true });
  }
});
