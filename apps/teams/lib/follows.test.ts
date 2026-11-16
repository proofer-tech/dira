import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LOCAL = mkdtempSync(path.join(tmpdir(), "follows-"));
process.env.TICKET_LOCAL = LOCAL;
const { readFollows, toggleFollow, isFollowing, ackFollow, doneFollows, followsPath } = await import("./follows.ts");

const t = (done: boolean) => ({ done, hash: "h", title: "T", continued: "" });
const lookup = async (p: string) =>
  p === "a" ? { name: "A", tickets: new Map([["x", t(true)], ["y", t(false)]]) } : null;

test("읽기: 파일이 없으면 빈 목록", async () => {
  assert.deepEqual(await readFollows(), []);
  assert.equal(existsSync(followsPath()), false);
});

test("토글: 켜면 항목이 생기고 다시 누르면 사라진다", async () => {
  assert.equal(await toggleFollow("a", "x"), true);
  assert.equal(await isFollowing("a", "x"), true);
  const [f] = JSON.parse(readFileSync(followsPath(), "utf8"));
  assert.deepEqual(Object.keys(f), ["project", "stem", "at"]);
  assert.equal(await toggleFollow("a", "x"), false);
  assert.deepEqual(await readFollows(), []);
});

test("done 판정과 삭제 정리", async () => {
  await toggleFollow("a", "x");
  await toggleFollow("a", "y");
  await toggleFollow("a", "gone");
  await toggleFollow("zz", "q"); // 미등록 프로젝트는 남긴다
  const out = await doneFollows(lookup);
  assert.deepEqual(out.map((o) => [o.stem, o.projectName, o.continued]), [["x", "A", ""]]);
  assert.deepEqual((await readFollows()).map((f) => f.stem), ["x", "y", "q"]);
});

test("ack: 지우고, 없는 항목도 통과한다", async () => {
  await ackFollow("a", "x");
  await ackFollow("a", "nope");
  assert.deepEqual((await readFollows()).map((f) => f.stem), ["y", "q"]);
});
