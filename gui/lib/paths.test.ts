import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expandHome, isHash, isName, isTenantId, resolveWithin } from "./paths.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "fst-paths-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const base = path.join(tmp, "personas"); // 기준 디렉터리(루트 밖일 수 있는 그 디렉터리)
const outside = path.join(tmp, "secrets");
mkdirSync(base);
mkdirSync(outside);
mkdirSync(path.join(base, "developer"));
writeFileSync(path.join(base, "developer", "PROFILE.md"), "ok");
writeFileSync(path.join(outside, "id_rsa"), "비밀");
symlinkSync(outside, path.join(base, "escape")); // 기준 안에서 밖을 가리키는 심링크

test("이름·해시·id 규칙", () => {
  assert.ok(isName("developer") && isName("w1") && isName("a_b-c"));
  assert.ok(!isName("../../.ssh/id_rsa") && !isName("한글") && !isName(""));
  assert.ok(isHash("bacdf72b") && isHash("re-6544fd23"));
  assert.ok(!isHash("ABC1") && !isHash("abc") && !isHash("a/b/c"));
  assert.ok(isTenantId("fs-tickets") && !isTenantId("Fs_Tickets"));
});

test("expandHome", () => {
  assert.strictEqual(expandHome("~"), homedir());
  assert.strictEqual(expandHome("~/x"), path.join(homedir(), "x"));
  assert.strictEqual(expandHome("/abs/x"), "/abs/x");
  assert.strictEqual(expandHome("~notauser/x"), "~notauser/x");
});

test("기준 안 경로는 통과 — 아직 없는 파일도", async () => {
  assert.strictEqual(
    await resolveWithin(base, "developer/PROFILE.md"),
    path.join(await realBase(), "developer", "PROFILE.md"),
  );
  assert.strictEqual(
    await resolveWithin(base, "새페르소나/PROFILE.md"),
    path.join(await realBase(), "새페르소나", "PROFILE.md"),
  );
  assert.strictEqual(await resolveWithin(base, "."), await realBase());
});

test("탈출 거부 — ../ · 절대경로 · ~ · 심링크", async () => {
  await assert.rejects(() => resolveWithin(base, "../secrets/id_rsa"), /기준 디렉터리 밖/);
  await assert.rejects(() => resolveWithin(base, "developer/../../secrets"), /기준 디렉터리 밖/);
  await assert.rejects(() => resolveWithin(base, "/etc/passwd"), /기준 디렉터리 밖/);
  await assert.rejects(() => resolveWithin(base, "~/.ssh/id_rsa"), /기준 디렉터리 밖/);
  // 심링크는 문자열 비교로 못 막는다 — realpath 후 판정한다
  await assert.rejects(() => resolveWithin(base, "escape/id_rsa"), /기준 디렉터리 밖/);
  await assert.rejects(() => resolveWithin(base, "escape/새파일"), /기준 디렉터리 밖/);
  // 접두 문자열만 같은 형제 디렉터리(personas-evil)도 밖이다
  mkdirSync(path.join(tmp, "personas-evil"), { recursive: true });
  await assert.rejects(() => resolveWithin(base, "../personas-evil/x"), /기준 디렉터리 밖/);
});

async function realBase(): Promise<string> {
  return await import("node:fs/promises").then((fs) => fs.realpath(base));
}
