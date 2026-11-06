import { test } from "node:test";
import assert from "node:assert/strict";
type Item = { item: string; position: number };
type Crumbs = { itemListElement: Item[] };
type Json = Record<string, unknown> & { offers: Record<string, unknown> };
import { breadcrumbJsonLd, homeJsonLd, jsonLdString, RELEASES_URL } from "./app/(site)/jsonld.ts";

test("홈 JSON-LD - SoftwareApplication 필수 속성과 Organization", () => {
  const [app, org] = homeJsonLd() as Json[];
  assert.equal(app["@type"], "SoftwareApplication");
  assert.equal(app.alternateName, "디라");
  assert.equal(app.applicationCategory, "DeveloperApplication");
  assert.equal(app.operatingSystem, "macOS");
  assert.equal(app.downloadUrl, RELEASES_URL);
  assert.ok(app.offers.price !== undefined && app.offers.priceCurrency);
  assert.equal(org["@type"], "Organization");
  assert.equal(org.url, "https://proofer.tech");
});

test("BreadcrumbList - 목차는 둘, 다른 장은 셋, 전부 절대 주소", () => {
  const l = { home: "홈", manual: "매뉴얼", page: "설치" };
  const idx = breadcrumbJsonLd("index", l) as Crumbs;
  const inst = breadcrumbJsonLd("install", l) as Crumbs;
  assert.equal(idx.itemListElement.length, 2);
  assert.equal(inst.itemListElement.length, 3);
  assert.deepEqual(inst.itemListElement.map((i: Item) => i.item), [
    "https://dira.proofer.tech/", "https://dira.proofer.tech/docs/", "https://dira.proofer.tech/docs/install",
  ]);
  assert.deepEqual(inst.itemListElement.map((i: Item) => i.position), [1, 2, 3]);
});

test("jsonLdString - < 를 이스케이프한다", () => {
  assert.ok(!jsonLdString({ a: "</script><b>" }).includes("<"));
});
