// $ cd apps/desktop && node --test server-port.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listenOnce, pickPort } from "./server-port.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "sp-")), "server-port");

test("pickPort - 파일이 없으면 빈 포트를 받아 적는다", async () => {
  const f = file();
  const p = await pickPort(f);
  assert.equal(readFileSync(f, "utf8").trim(), String(p));
});

test("pickPort - 기억한 포트가 비어 있으면 그대로 쓴다", async () => {
  const f = file();
  const free = await listenOnce(0);
  writeFileSync(f, `${free}\n`);
  assert.equal(await pickPort(f), free);
});

test("pickPort - 기억한 포트가 점유되면 다른 포트로 떨어지고 파일을 덮는다", async () => {
  const f = file();
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const busy = (s.address() as { port: number }).port;
  writeFileSync(f, `${busy}\n`);
  try {
    const p = await pickPort(f);
    assert.notEqual(p, busy);
    assert.equal(readFileSync(f, "utf8").trim(), String(p));
  } finally { s.close(); }
});
