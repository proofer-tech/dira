/** 엔진 호출 — 해시 → 경로를 **엔진에게 물어본다**는 것이 이 파일이 검증하는 전부다.
 *  경로를 조립하면 통과할 수 없는 케이스(접미사 붙은 이름·`re-` 폴백·형식 밖 해시)를 고른다. */
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTicket, unassign } from "./engine.ts";
import { listTickets, type Suffixes } from "./queue.ts";

const DEFAULT: Suffixes = { inProgress: ".wip", done: ".done" };
const KO: Suffixes = { inProgress: "-진행중", done: "-완료" };

const root = mkdtempSync(path.join(tmpdir(), "fst-eng-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "tickets"));
const put = (name: string, fm = "") =>
  writeFileSync(path.join(root, "tickets", name), `---\ntitle: t\n${fm}---\n`);
put("aaaa1111.md");
put("bbbb2222.wip.md");
put("re-cccc3333.md");
put("dddd4444-완료.md");
// 해시 ≠ 파일명 stem. `Ticket.hash`는 frontmatter 우선이라 보드가 URL에 싣는 건 이 값이다
put("한글파일명.md", "ticket: hangul-nfc\n");
put("한글파일명NFD.wip.md".normalize("NFD"), "ticket: hangul-nfd\n");
put("순수한글.md"); // `ticket:` 없음 → 해시 = stem. 엔진이 디스패치하는 티켓이다
put("물고있는한글.wip.md".normalize("NFD")); // `ticket:` 없는 .wip → 해시에 접미사가 들어간다

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

/** a606dd0e — 보드는 `Ticket.hash`(frontmatter 우선)로 링크를 걸고 조회는 stem으로 했다.
 *  둘이 갈리는 티켓은 화면이 링크한 URL이 404였다. 여기서 판정을 못박는다:
 *  **보드가 URL에 실을 수 있는 값은 전부 파일로 해석된다.** */
test("findTicket — 해시가 파일명 stem과 갈려도 찾는다", async () => {
  const t = (n: string) => path.join(root, "tickets", n);
  const listed = await listTickets(root, DEFAULT);
  const hashOf = (stem: string) =>
    listed.find((x) => path.basename(x.path).normalize("NFC").startsWith(stem))!.hash;

  // frontmatter 해시 — stem으로는 안 맞는다. 이게 보드가 그렸던 404다
  assert.strictEqual(hashOf("한글파일명."), "hangul-nfc");
  assert.strictEqual(await findTicket(root, "hangul-nfc", DEFAULT), t("한글파일명.md"));
  // NFD로 저장된 파일도 같다. 반환은 파일시스템 원본 표기여서 NFC 비교로 확인한다
  assert.strictEqual(hashOf("한글파일명NFD"), "hangul-nfd");
  const nfd = await findTicket(root, "hangul-nfd", DEFAULT);
  assert.strictEqual(nfd?.normalize("NFC"), t("한글파일명NFD.wip.md").normalize("NFC"));
  // `ticket:` 없는 한글 파일명 = 엔진이 디스패치하는 티켓. 해시 = stem이고 엔진이 직접 답한다
  assert.strictEqual(hashOf("순수한글"), "순수한글");
  assert.strictEqual(await findTicket(root, "순수한글", DEFAULT), t("순수한글.md"));
  // `ticket:` 없는 `.wip` 티켓은 해시에 접미사가 들어간다(`ticket_hash`가 stem을 그대로 쓴다).
  // 옛 규칙 `^[a-z0-9-]{4,40}$`은 `.`도 걸렀다 — 이 해시로는 URL을 만들 수 없었다.
  const wip = "물고있는한글.wip";
  assert.strictEqual(hashOf("물고있는한글"), wip);
  const got = await findTicket(root, wip, DEFAULT);
  assert.strictEqual(got?.normalize("NFC"), t("물고있는한글.wip.md").normalize("NFC"));
  // 반대 방향은 열리지 않는다: 없는 frontmatter 해시는 여전히 404다
  assert.strictEqual(await findTicket(root, "hangul-nope", DEFAULT), null);
});

test("findTicket — 경로가 될 수 있는 해시는 엔진을 부르지도 않는다", async () => {
  for (const bad of ["../../etc/passwd", "a/b", "..", ".hidden", "a\0b", ""]) {
    assert.strictEqual(await findTicket(root, bad, DEFAULT), null, JSON.stringify(bad));
  }
  // 형식은 통과하지만 큐에 없는 이름 = 404 (판정은 파일 목록이 한다)
  for (const miss of ["AAAA1111", "ab", "한글티켓"]) {
    assert.strictEqual(await findTicket(root, miss, DEFAULT), null, miss);
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
