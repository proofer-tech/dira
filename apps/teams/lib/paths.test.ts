import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expandHome, isHash, isName, isProjectId, isRealDirectory, resolveWithin } from "./paths.ts";

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
  // 해시는 파일명 stem일 수 있다 — 엔진이 디스패치하는 이름을 GUI가 거르면 안 된다(a606dd0e)
  assert.ok(isHash("순수한글") && isHash("ABC1") && isHash("두 단어") && isHash("a.b"));
  // 막는 건 경로가 될 수 있는 것뿐: 경로 구분자·제어문자·`.` 시작
  assert.ok(!isHash("a/b/c") && !isHash("../../etc/passwd") && !isHash("a\\b"));
  assert.ok(!isHash(".") && !isHash("..") && !isHash(".hidden") && !isHash(""));
  assert.ok(!isHash("a\0b") && !isHash("a\nb") && !isHash("x".repeat(256)));
  assert.ok(isProjectId("dira") && !isProjectId("Dira_Teams"));
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

test("isRealDirectory — import(§5-3 §import ①)의 폴더 검사", async () => {
  assert.ok(await isRealDirectory(base)); // 절대경로 + 실재하는 디렉터리
  assert.ok(!(await isRealDirectory("developer"))); // 상대경로는 거절
  assert.ok(!(await isRealDirectory(path.join(tmp, "없는-폴더")))); // 없는 경로는 거절
  assert.ok(!(await isRealDirectory(path.join(base, "developer", "PROFILE.md")))); // 파일은 거절
});

test("isRealDirectory — `~`도 편다(§7 다른 경로 칸과 같은 관용구, b7f7178f)", async () => {
  // startImport가 이 함수 하나로 세션을 띄울지 거절할지 가른다 — 여기서 참이면 그 관문을 지나
  // `newConversation` + `startAsk`로 간다(actions.ts:168).
  const home0 = process.env.HOME;
  process.env.HOME = tmp; // expandHome이 homedir()을 그대로 쓰므로 여기서 고정한다
  try {
    mkdirSync(path.join(tmp, "importable"));
    assert.ok(await isRealDirectory("~")); // 홈 자체
    assert.ok(await isRealDirectory("~/importable")); // 홈 아래 실재 디렉터리
    assert.ok(!(await isRealDirectory("~/없는-폴더"))); // 홈 아래라도 없으면 거절
    assert.ok(!(await isRealDirectory(""))); // 빈 문자열은 종전대로 거절
  } finally {
    process.env.HOME = home0;
  }
});

async function realBase(): Promise<string> {
  return await import("node:fs/promises").then((fs) => fs.realpath(base));
}
