/** 해시 → 경로 조회(`findTicket`)와 상태 전이(`unassign`).
 *
 *  조회는 `tickets.py find`의 미러가 답한다(38b11db5 — 스폰이 요청마다 160~360ms였다). 그래서
 *  여기서 볼 것은 **판정이 엔진과 같은가**다: 경로를 조립하면 통과할 수 없는 케이스(접미사 붙은
 *  이름·`re-` 폴백·형식 밖 해시·`ticket:`이 파일명과 갈린 티켓)를 고른다.
 *  find_any 자체의 패리티(엔진 출력과 줄 단위 대조)는 `queue.test.ts`가 고정한다. */
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { findTicket, runWorker, unassign } from "./engine.ts";
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

test("findTicket — 접미사·`re-` 폴백을 엔진과 같이 판정한다", async () => {
  const t = (n: string) => path.join(root, "tickets", n);
  assert.strictEqual(await findTicket(root, "aaaa1111", DEFAULT), t("aaaa1111.md"));
  assert.strictEqual(await findTicket(root, "bbbb2222", DEFAULT), t("bbbb2222.wip.md"));
  assert.strictEqual(await findTicket(root, "cccc3333", DEFAULT), t("re-cccc3333.md"));
  assert.strictEqual(await findTicket(root, "zzzz9999", DEFAULT), null); // 없는 해시 = 404
  // 접미사는 프로젝트별이다: 기본 접미사로는 `-완료`가 이름의 일부라 안 맞고, 한글 접미사로는 맞는다
  assert.strictEqual(await findTicket(root, "dddd4444", DEFAULT), null);
  assert.strictEqual(await findTicket(root, "dddd4444", KO), t("dddd4444-완료.md"));
});

/** a606dd0e — 보드는 `Ticket.hash`(frontmatter 우선)로 링크를 걸고 조회는 stem으로 했다.
 *  둘이 갈리는 티켓은 화면이 링크한 URL이 404였다. 여기서 판정을 고정한다:
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
  // `ticket:` 없는 한글 파일명 = 엔진이 디스패치하는 티켓. 해시 = stem이라 폴백 없이 맞는다
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

test("findTicket — 경로가 될 수 있는 해시는 큐를 보지도 않는다", async () => {
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

const TICK = fileURLToPath(new URL("../../../tick.sh", import.meta.url));

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

/** §2-5 — 산 세션은 종료 코드 `3`으로 거부되고, `--force`면 그 세션을 끊고 풀린다.
 *
 *  **판정은 코드다. 거부 문구가 아니다**: 화면이 문구를 정규식으로 읽으면 문구를 고치는 순간
 *  확인 다이얼로그가 조용히 사라진다. 그래서 여기서 고정하는 것은 `run.code === 3` 하나다.
 *
 *  산 pid는 진짜로 만든다(`sleep`) — `ps`가 답해야 `tick.sh`의 생존 판정이 돈다. 조상 사슬
 *  면제에는 안 걸린다: 이 자식은 워커 스크립트의 **형제**지 조상이 아니다(주인 세션이 자기 손으로
 *  푸는 경로만 면제다). 부모 `tick.sh`가 없는 손 클레임 모양이라 푸는 것은 강제 경로 자신이다.
 *
 *  **16초쯤 걸린다** — 강제 경로가 부모의 release를 15초까지 기다린 뒤 자기가 푼다(`tick.sh:136`).
 *  줄일 방법은 엔진의 유예를 건드리는 것뿐인데 그건 읽기 전용이고, 그 기다림 자체가 이 경로다. */
test("unassign — 산 세션은 코드 3으로 거부하고 --force면 끊고 푼다", async () => {
  const r = scratch(["w1"]);
  process.env.TICKET_LOCAL = path.join(r, "local");
  const wip = path.join(r, "tickets", "aaaa9999.wip.md");
  // 3600s: 이 픽스처의 생존 창이 실측(느린 환경에서 두 unassign 호출 합계 78s)보다
  // 넉넉해야 한다 — 짧으면 자연 만료가 강제 경로의 kill보다 먼저 와서 `ps`가 이미
  // 죽었다고 답하고, 그러면 강제 경로 자체가 아니라 결정 9(자진 해제) 문구가 나온다
  // (8eb1397d — `sleep 30`은 20~30s대 python3/bash 호출 지연이 겹치면 굶는다).
  const victim = spawn("sleep", ["3600"], { stdio: "ignore" });
  try {
    writeFileSync(
      wip,
      `---\nticket: aaaa9999\ntitle: 산 세션이 물고 있다\nsession_id: sess-live\npid: ${victim.pid}\nowner: developer / w1\n---\n본문\n`,
    );

    // 플래그 없이는 종전대로 거부다 — 티켓은 `.wip` 그대로고 코드가 3이다
    const denied = await unassign(r, "aaaa9999");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, 3, denied.output); // ← 화면이 확인을 띄우는 계약
    assert.strictEqual(existsSync(wip), true);

    // 강제 — 세션이 죽고 티켓이 백로그로 돌아간다
    const forced = await unassign(r, "aaaa9999", true);
    assert.strictEqual(forced.ok, true, forced.output);
    assert.strictEqual(forced.code, 0);
    assert.match(forced.output, /강제 할당 해제: aaaa9999/);
    assert.strictEqual(existsSync(wip), false); // 진행중 접미사가 떨어졌다
    const back = readFileSync(path.join(r, "tickets", "aaaa9999.md"), "utf8");
    assert.match(back, /^session_id:\s*$/m);
    assert.match(back, /^pid:\s*$/m);
    assert.strictEqual(victim.killed || victim.exitCode !== null || victim.signalCode !== null, true);
  } finally {
    victim.kill("SIGKILL"); // 거부 쪽에서 죽으면 `sleep`이 남는다
  }
});

/** 죽은 세션은 `--force`가 붙어도 종전 경로다(§2-5 — 플래그가 갈라 놓는 자리는 거부하던 한 곳뿐).
 *  회귀다: 강제가 별도 전이를 만들면 여기서 문구가 갈린다. */
test("unassign — 죽은 세션은 --force가 붙어도 종전 경로다", async () => {
  const r = scratch(["w1"]);
  process.env.TICKET_LOCAL = path.join(r, "local");
  writeFileSync(
    path.join(r, "tickets", "bbbb8888.wip.md"),
    "---\nticket: bbbb8888\ntitle: 죽은 세션\nsession_id: sess-dead\n---\n본문\n",
  );
  const run = await unassign(r, "bbbb8888", true);
  assert.strictEqual(run.ok, true, run.output);
  assert.strictEqual(run.code, 0);
  assert.match(run.output, /할당 해제: bbbb8888/); // `강제 할당 해제`가 아니다
});

/** 모르는 플래그는 사용법(코드 `2`)이다 — `3`과 갈려야 화면이 확인을 안 띄운다. */
test("unassign — 코드가 갈래를 가른다(2는 사용법이라 확인이 아니다)", async () => {
  const r = scratch(["w1"]);
  process.env.TICKET_LOCAL = path.join(r, "local");
  const run = await runWorker(r, "w1", ["unassign", "cccc7777", "--forse"]);
  assert.strictEqual(run.ok, false);
  assert.strictEqual(run.code, 2);
});
