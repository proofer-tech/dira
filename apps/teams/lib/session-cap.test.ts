import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira`를 밟지 않는다 — `i18n.test.ts`와 같은 관용구, import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "session-cap-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { liveSessionCount, readSessionLimit, writeSessionLimit } = await import("./session-cap.ts");

const tmps: string[] = [LOCAL];
process.on("exit", () => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

function makeRoot(tickets: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "session-cap-root-"));
  tmps.push(root);
  mkdirSync(path.join(root, "tickets"));
  for (const [n, body] of Object.entries(tickets)) writeFileSync(path.join(root, "tickets", n), body);
  return root;
}

test("readSessionLimit — 파일 없음은 null(없음), 정수는 그 값, 못 읽는 값은 0 + warn", async () => {
  assert.deepStrictEqual(await readSessionLimit(), { limit: null, warn: false });

  await writeSessionLimit(6);
  assert.deepStrictEqual(await readSessionLimit(), { limit: 6, warn: false });
  assert.strictEqual(readFileSync(path.join(LOCAL, "session-limit"), "utf8"), "6\n");

  writeFileSync(path.join(LOCAL, "session-limit"), "nope\n");
  assert.deepStrictEqual(await readSessionLimit(), { limit: 0, warn: true });
});

test("writeSessionLimit — null은 파일을 지운다(결정 2 '비우고 저장하면 없어진다')", async () => {
  await writeSessionLimit(3);
  assert.deepStrictEqual(await readSessionLimit(), { limit: 3, warn: false });

  await writeSessionLimit(null);
  assert.deepStrictEqual(await readSessionLimit(), { limit: null, warn: false });
  // 이미 없는데 다시 지워도 던지지 않는다(rm force)
  await writeSessionLimit(null);
});

test("writeSessionLimit — 음수·소수는 던진다", async () => {
  await assert.rejects(() => writeSessionLimit(-1));
  await assert.rejects(() => writeSessionLimit(1.5));
});

test("liveSessionCount — `.wip`의 살아 있는 pid:만 센다(session-cap.sh의 live_count와 같은 판정)", async () => {
  const root = makeRoot({
    // 산 세션 — 이 테스트 프로세스 자신의 pid
    "a.wip.md": `---\nticket: a\npid: ${process.pid}\n---\n본문\n`,
    // 죽은 pid — 세지 않는다
    "b.wip.md": `---\nticket: b\npid: ${0x7ffffff0}\n---\n본문\n`,
    // 열린 티켓(.wip 아님) — 세지 않는다
    "c.md": `---\nticket: c\npid: ${process.pid}\n---\n본문\n`,
    // 끝난 티켓(.done) — 세지 않는다
    "d.done.md": `---\nticket: d\npid: ${process.pid}\n---\n본문\n`,
  });
  assert.strictEqual(await liveSessionCount({ root }), 1);
});

test("liveSessionCount — 못 읽는 프로젝트(디렉터리 없음)는 0", async () => {
  assert.strictEqual(await liveSessionCount({ root: path.join(LOCAL, "no-such-project") }), 0);
});
