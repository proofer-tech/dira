/** 랜딩의 버전 표기가 실제 릴리스와 갈리지 않게 잠근다.
 *  손으로 적으면 `release.yml`이 master마다 bump하는 동안 영구히 어긋난다
 *  (실측 2026-08-02: 반나절에 0.1.4 → 0.1.5). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// 도그푸딩 세션엔 DIRA_APP_VERSION이 이미 앰비언트로 걸려 있다 - import 전에 걷어낸다
// (`analytics.test.ts`와 같은 관용구 - 모듈 top-level 상수가 import 시점에 그 값을 굳힌다).
delete process.env.DIRA_APP_VERSION;
const { diraVersion } = await import("./version.ts");

test("diraVersion이 apps/desktop/package.json의 version과 같다", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"),
  );
  assert.equal(diraVersion, pkg.version);
  assert.match(diraVersion, /^\d+\.\d+\.\d+$/);
});

// version.ts는 import 시점(모듈 평가 단계)에 cwd의 부모/desktop/package.json을 읽으므로
// "cwd에 desktop/package.json이 없을 때" 같은 케이스는 같은 프로세스 안에서 cwd를 바꿔도
// 재현할 수 없다 - 자식 프로세스를 그 cwd로 띄워 실제로 import시킨다.
const versionUrl = new URL("./version.ts", import.meta.url).href;

function importIn(cwd: string, env: Record<string, string> = {}): string {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(versionUrl)}).then(m=>process.stdout.write(m.diraVersion))`],
    { cwd, encoding: "utf8", env: { ...process.env, ...env } },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("cwd에 ../desktop/package.json이 없으면 diraVersion이 unknown이 된다", () => {
  const root = mkdtempSync(join(tmpdir(), "dira-version-"));
  const cwd = join(root, "teams");
  mkdirSync(cwd, { recursive: true });
  try {
    delete process.env.DIRA_APP_VERSION;
    const out = importIn(cwd, { DIRA_APP_VERSION: "" });
    assert.equal(out, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("../desktop/package.json이 있어도 JSON이 깨졌으면 unknown이 된다", () => {
  const root = mkdtempSync(join(tmpdir(), "dira-version-"));
  const cwd = join(root, "teams");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(root, "desktop"), { recursive: true });
  writeFileSync(join(root, "desktop", "package.json"), "{ not json");
  try {
    const out = importIn(cwd, { DIRA_APP_VERSION: "" });
    assert.equal(out, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("../desktop/package.json에 version 키가 없으면 unknown이 된다", () => {
  const root = mkdtempSync(join(tmpdir(), "dira-version-"));
  const cwd = join(root, "teams");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(root, "desktop"), { recursive: true });
  writeFileSync(join(root, "desktop", "package.json"), JSON.stringify({ name: "dira" }));
  try {
    const out = importIn(cwd, { DIRA_APP_VERSION: "" });
    assert.equal(out, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("../desktop/package.json이 정상이면 그 version을 그대로 쓴다", () => {
  const root = mkdtempSync(join(tmpdir(), "dira-version-"));
  const cwd = join(root, "teams");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(root, "desktop"), { recursive: true });
  writeFileSync(join(root, "desktop", "package.json"), JSON.stringify({ version: "9.9.9" }));
  try {
    const out = importIn(cwd, { DIRA_APP_VERSION: "" });
    assert.equal(out, "9.9.9");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DIRA_APP_VERSION이 있으면 파일과 무관하게 그 값이 우선한다", () => {
  const root = mkdtempSync(join(tmpdir(), "dira-version-"));
  const cwd = join(root, "teams");
  mkdirSync(cwd, { recursive: true });
  try {
    const out = importIn(cwd, { DIRA_APP_VERSION: "7.7.7" });
    assert.equal(out, "7.7.7");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
