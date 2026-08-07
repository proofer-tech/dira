import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

function scripts(pkgPath: string): Record<string, string> {
  return JSON.parse(readFileSync(pkgPath, "utf8")).scripts;
}

/** 580343a7 — dev만 DIRA_MULTI_TOKEN 기본값을 준다. build·start·dist가 이걸 물려받으면
 *  잠금 배포물(dmg)이 플래그 없이도 해금 상태로 빌드된다(§0-13 §잠금 §dev). */
test("DIRA_MULTI_TOKEN 기본값 — dev 스크립트에만 있고 build·start·dist엔 없다", () => {
  const teams = scripts(path.join(here, "package.json"));
  const desktop = scripts(path.join(here, "../desktop/package.json"));
  const DEFAULT = "DIRA_MULTI_TOKEN=${DIRA_MULTI_TOKEN:-1}";

  assert.ok(teams.dev.startsWith(DEFAULT), "apps/teams dev에 기본값이 없다");
  assert.ok(desktop.dev.startsWith(DEFAULT), "apps/desktop dev에 기본값이 없다");

  assert.ok(!teams.build.includes("DIRA_MULTI_TOKEN"), "apps/teams build가 갈렸다");
  assert.ok(!teams.start.includes("DIRA_MULTI_TOKEN"), "apps/teams start가 갈렸다");
  assert.ok(!desktop.build.includes("DIRA_MULTI_TOKEN"), "apps/desktop build가 갈렸다");
  assert.ok(!desktop.dist.includes("DIRA_MULTI_TOKEN"), "apps/desktop dist가 갈렸다");
});
