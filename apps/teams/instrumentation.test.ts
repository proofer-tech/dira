import { test } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "./instrumentation.ts";

// FIFO는 아무도 안 쓰면 읽기가 영원히 블록한다 — register()가 레지스트리를 실제로
// 건드리는지 잡음 없이 잰다(모킹이 아니라 진짜 fs 호출을 상대로).
test("랜딩-only — register()가 레지스트리를 안 읽는다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-instrumentation-"));
  execSync(`mkfifo ${JSON.stringify(path.join(dir, "gui-projects.json"))}`);
  const savedLocal = process.env.TICKET_LOCAL;
  const savedFlag = process.env.DIRA_LANDING_ONLY;
  process.env.TICKET_LOCAL = dir;
  process.env.DIRA_LANDING_ONLY = "1";
  try {
    await Promise.race([
      register(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("레지스트리(FIFO)를 읽으려 했다 — 500ms 안에 안 끝났다")), 500),
      ),
    ]);
  } finally {
    if (savedLocal === undefined) delete process.env.TICKET_LOCAL;
    else process.env.TICKET_LOCAL = savedLocal;
    if (savedFlag === undefined) delete process.env.DIRA_LANDING_ONLY;
    else process.env.DIRA_LANDING_ONLY = savedFlag;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NEXT_RUNTIME=edge — 플래그 무관하게 즉시 반환", async () => {
  const saved = process.env.NEXT_RUNTIME;
  process.env.NEXT_RUNTIME = "edge";
  try {
    await assert.doesNotReject(register());
  } finally {
    if (saved === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = saved;
  }
});
