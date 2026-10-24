import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSlim, setSlim, slimOn, type SlimRun } from "./slim.ts";

const q = () => mkdtempSync(path.join(tmpdir(), "slim-"));
const status = { enabled: true, eligible: true, state: "empty", last_active: "2026-10-24T00:00:00+09:00", reason: null };

function fake(over: Partial<Record<"empty" | "fill", { rc: number; out: string }>> = {}) {
  const calls: string[] = [];
  const run: SlimRun = async (cmd, root) => {
    calls.push(`${cmd} ${root}`);
    if (cmd === "status") return { rc: 0, out: JSON.stringify(status) };
    return over[cmd] ?? { rc: 0, out: "" };
  };
  return { calls, run };
}

test("켜면 on을 쓰고 empty, 끄면 on이 아니고 fill을 부른다", async () => {
  const root = q();
  const f = fake();
  await setSlim(root, true, f.run);
  assert.equal(await slimOn(root), true);
  assert.equal(f.calls[0], `empty ${root}`);
  await setSlim(root, false, f.run);
  assert.equal(await slimOn(root), false);
  assert.notEqual(readFileSync(path.join(root, "slim-checkout"), "utf8").trim(), "on");
  assert.ok(f.calls.includes(`fill ${root}`));
});

test("eligible false와 state 값은 status JSON 그대로 나온다", async () => {
  const run: SlimRun = async () => ({
    rc: 0,
    out: JSON.stringify({ ...status, eligible: false, state: "full" }),
  });
  const v = await readSlim(q(), run);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "full");
});

test("empty가 rc 2로 거절하면 켜짐은 남고 사유가 message에 실린다", async () => {
  const root = q();
  const f = fake({ empty: { rc: 2, out: JSON.stringify({ reason: "사람 작업이 있습니다" }) } });
  const v = await setSlim(root, true, f.run);
  assert.equal(await slimOn(root), true);
  assert.equal(v.message, "사람 작업이 있습니다");
});
