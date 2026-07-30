/** 엔진 호출 — 해시 → 경로를 **엔진에게 물어본다**는 것이 이 파일이 검증하는 전부다.
 *  경로를 조립하면 통과할 수 없는 케이스(접미사 붙은 이름·`re-` 폴백·형식 밖 해시)를 고른다. */
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTicket, unassign } from "./engine.ts";
import type { Suffixes } from "./queue.ts";

const DEFAULT: Suffixes = { inProgress: ".wip", done: ".done" };
const KO: Suffixes = { inProgress: "-진행중", done: "-완료" };

const root = mkdtempSync(path.join(tmpdir(), "fst-eng-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "tickets"));
const put = (name: string) =>
  writeFileSync(path.join(root, "tickets", name), "---\ntitle: t\n---\n");
put("aaaa1111.md");
put("bbbb2222.wip.md");
put("re-cccc3333.md");
put("dddd4444-완료.md");

test("findTicket — 접미사·`re-` 폴백은 엔진이 판정한다", async () => {
  const t = (n: string) => path.join(root, "tickets", n);
  assert.strictEqual(await findTicket(root, "aaaa1111", DEFAULT), t("aaaa1111.md"));
  assert.strictEqual(await findTicket(root, "bbbb2222", DEFAULT), t("bbbb2222.wip.md"));
  assert.strictEqual(await findTicket(root, "cccc3333", DEFAULT), t("re-cccc3333.md"));
  assert.strictEqual(await findTicket(root, "zzzz9999", DEFAULT), null); // 없는 해시 = 404
  // 접미사는 테넌트별이다: 기본 접미사로는 `-완료`가 이름의 일부라 안 맞고, 한글 접미사로는 맞는다
  assert.strictEqual(await findTicket(root, "dddd4444", DEFAULT), null);
  assert.strictEqual(await findTicket(root, "dddd4444", KO), t("dddd4444-완료.md"));
});

test("findTicket — 형식 밖 해시는 엔진을 부르지도 않는다", async () => {
  for (const bad of ["../../etc/passwd", "AAAA1111", "a/b", "ab", "한글티켓", ""]) {
    assert.strictEqual(await findTicket(root, bad, DEFAULT), null, bad);
  }
});

// ── 할당 해제 ───────────────────────────────────────────────────────────────
// 상태 전이는 TS로 다시 구현하지 않는다(제약 2). 그래서 여기서 볼 것은 **진짜 워커 스크립트가
// 돌았는가**다: session_id가 비고 진행중 접미사가 떨어졌으면 tick.sh가 한 일이다.

const TICK = fileURLToPath(new URL("../../tick.sh", import.meta.url));

/** 워커 하나짜리 티켓 루트. 워커는 tick.sh를 source하는 두 줄이 전부다(worker.sh.example). */
function scratch(workers: string[]) {
  const r = mkdtempSync(path.join(tmpdir(), "fst-una-"));
  process.on("exit", () => rmSync(r, { recursive: true, force: true }));
  mkdirSync(path.join(r, "tickets"));
  mkdirSync(path.join(r, "workers"));
  for (const w of workers) {
    writeFileSync(path.join(r, "workers", `${w}.sh`), `#!/bin/bash\n. "${TICK}"\n`, { mode: 0o755 });
  }
  return r;
}

test("unassign — 워커 스크립트가 session_id를 비우고 진행중 접미사를 뗀다", async () => {
  const r = scratch(["w1"]);
  // 락·토큰은 머신 로컬로 간다. 테스트가 사람의 ~/.config를 건드리지 않게 돌려둔다.
  process.env.TICKET_LOCAL = path.join(r, "local");
  const wip = path.join(r, "tickets", "eeee5555.wip.md");
  writeFileSync(
    wip,
    "---\nticket: eeee5555\ntitle: 잡힌 티켓\nsession_id: sess-1\nowner: developer / w1\n---\n본문\n",
  );

  const run = await unassign(r, "eeee5555");
  assert.strictEqual(run.ok, true, run.output);
  assert.strictEqual(run.worker, "w1"); // 화면이 `w1.sh unassign <해시>`라고 적는 근거
  assert.match(run.output, /할당 해제: eeee5555/);

  assert.strictEqual(existsSync(wip), false); // 진행중 접미사가 떨어졌다
  const back = path.join(r, "tickets", "eeee5555.md");
  assert.match(readFileSync(back, "utf8"), /^session_id:\s*$/m); // 비었다
});

test("unassign — 워커 0개면 부를 스크립트가 없다(화면은 이 사유로 비활성화한다)", async () => {
  const r = scratch([]);
  writeFileSync(path.join(r, "tickets", "ffff6666.wip.md"), "---\nticket: ffff6666\n---\n");
  const run = await unassign(r, "ffff6666");
  assert.strictEqual(run.ok, false);
  assert.strictEqual(run.worker, null);
  assert.match(run.output, /워커가 없습니다/);
  // 형식 밖 해시는 스크립트를 부르지도 않는다
  assert.strictEqual((await unassign(scratch(["w1"]), "../../x")).ok, false);
});
