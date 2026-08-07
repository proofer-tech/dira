/** `config.ts`의 `transformPageData`(canonical·og·twitter 11줄)와 `sitemap: { hostname }`
 *  한 줄이 `app/meta.ts`·`app/sitemap.ts`로 옮겨 온 것을 잰다(§SEO ①② · §사이트 기반).
 *  값의 정본은 앞 산출물이라 여기 적은 문자열은 그 산출물에서 그대로 읽은 것이다. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ORIGIN,
  docNames,
  docPath,
  pageMetadata,
  pageUrls,
  rootNames,
  titleOf,
} from "./app/(site)/meta.ts";

test("사이트맵이 앞 산출물과 같은 URL 집합이다", () => {
  const urls = pageUrls;
  // 앞 산출물 실측: 랜딩 1 + `privacy`·`terms` 2 + 매뉴얼 22 = 25. `404`는 안 든다.
  assert.equal(urls.length, 25);
  assert.equal(new Set(urls).size, 25, "중복 URL이 있다");
  for (const u of urls) {
    assert.ok(u.startsWith(`${ORIGIN}/`), `절대 URL이 아니다: ${u}`);
    // `cleanUrls: true`가 내던 모양이다 — `.html`도 `index` 조각도 안 붙는다.
    assert.doesNotMatch(u, /\.html$|\/index$/, `URL이 갈렸다: ${u}`);
  }
  for (const p of ["/", "/docs/", "/docs/install", "/privacy", "/terms"]) {
    assert.ok(urls.includes(`${ORIGIN}${p}`), `사이트맵에 ${p}이 없다`);
  }
});

test("페이지마다 canonical·og·twitter 열한 줄", () => {
  const m = pageMetadata("/docs/install", "설치");
  assert.equal(m.title, "설치 | dira");
  assert.equal(m.alternates?.canonical, "https://dira.proofer.tech/docs/install");
  const og = m.openGraph as Record<string, unknown>;
  assert.equal(og.type, "website");
  assert.equal(og.siteName, "dira");
  assert.equal(og.locale, "ko_KR");
  assert.equal(og.url, "https://dira.proofer.tech/docs/install");
  assert.equal(og.title, "설치");
  // 절대 URL이어야 한다 — 상대 경로는 플랫폼이 못 읽는다.
  assert.deepEqual(og.images, [
    { url: "https://dira.proofer.tech/og.png", width: 1200, height: 630 },
  ]);
  assert.equal((m.twitter as { card: string }).card, "summary_large_image");
  // 랜딩만 `titleTemplate: false`였다 — 사이트 이름이 안 붙는다.
  assert.equal(pageMetadata("/", "dira - 로컬", { suffix: false }).title, "dira - 로컬");
});

test("description은 `||`다 — 빈 문자열이면 사이트 기본값이 나간다", () => {
  const fallback = pageMetadata("/x", "T", { description: "" }).description;
  assert.match(String(fallback), /^티켓을 큐에 넣으면/);
  assert.equal(pageMetadata("/x", "T").description, fallback, "안 주면 같은 값이 나가야 한다");
  assert.equal(pageMetadata("/x", "T", { description: "자기 것" }).description, "자기 것");
  // og:description도 같은 값이다(앞 산출물 25장이 두 자리에 같은 문장을 실었다).
  const og = pageMetadata("/x", "T").openGraph as { description: string };
  assert.equal(og.description, fallback);
});

test("제목은 첫 h1이다 — 24장 전부 1행이 그 헤딩이다", () => {
  const files = [...docNames.map((n) => `docs/${n}.md`), ...rootNames.map((n) => `${n}.md`)];
  assert.equal(files.length, 24);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const first = src.split("\n")[0];
    assert.match(first, /^# \S/, `${f}: 1행이 h1이 아니다`);
    assert.equal(titleOf(src), first.slice(2).trim(), f);
  }
  // h1이 없으면 사이트 이름으로 떨어진다(앞 산출물의 `<title>` 폴백과 같다).
  assert.equal(titleOf("본문만 있다"), "dira");
});

test("`docs/index`는 URL이 `/docs/`다", () => {
  assert.equal(docPath("index"), "/docs/");
  assert.equal(docPath("install"), "/docs/install");
});
