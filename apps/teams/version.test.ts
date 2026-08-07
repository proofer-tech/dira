/** 랜딩의 버전 표기가 실제 릴리스와 갈리지 않게 잠근다.
 *  손으로 적으면 `release.yml`이 master마다 bump하는 동안 영구히 어긋난다
 *  (실측 2026-08-02: 반나절에 0.1.4 → 0.1.5). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diraVersion } from "./version.ts";

test("diraVersion이 apps/desktop/package.json의 version과 같다", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"),
  );
  assert.equal(diraVersion, pkg.version);
  assert.match(diraVersion, /^\d+\.\d+\.\d+$/);
});
