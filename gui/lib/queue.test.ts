/** 패리티 테스트 — listTickets()의 판정이 `tickets.py`와 같은지.
 *
 *  같은 픽스처 큐에 대해 `python3 tickets.py list <픽스처>`의 출력과, listTickets() 결과를
 *  같은 형식으로 찍은 문자열을 **글자 단위로** 비교한다. 눈으로 맞추지 않는다. */
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterTickets,
  listTickets,
  referrers,
  resolveDep,
  sortTickets,
  statusOf,
  stemOf,
  writeTicket,
  type Suffixes,
  type Ticket,
} from "./queue.ts";

const PY = fileURLToPath(new URL("../../tickets.py", import.meta.url));
const DEFAULT: Suffixes = { inProgress: ".wip", done: ".done" };

function pyList(root: string, env: Record<string, string> = {}): string {
  return execFileSync("python3", [PY, "list", root], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"], // 하위 디렉터리 픽스처가 legacy WARN을 내므로 stderr는 버린다
    env: { ...process.env, ...env },
  });
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** tickets.py main()의 `list` 출력 형식을 그대로 재현한다. */
function tsList(tickets: Ticket[]): string {
  const open = tickets.filter((t) => t.state === "open");
  if (!open.length) return "열린 티켓 없음\n";
  return (
    open
      .map((t) => {
        const d = new Date(t.birth);
        const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
        const mark = t.assigned
          ? "할당됨 " + (t.fm.session_id ?? "")
          : t.unmet.length
            ? "deps 대기 " + t.unmet.join(",")
            : "대기";
        return `${when}  ${t.hash.padEnd(12)} ${(t.kind || "-").padEnd(9)} ${(t.persona || "-").padEnd(10)} ${mark}`;
      })
      .join("\n") + "\n"
  );
}

const roots: string[] = [];
function newRoot(): string {
  const r = mkdtempSync(path.join(tmpdir(), "fsq-"));
  mkdirSync(path.join(r, "tickets"));
  roots.push(r);
  return r;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** birth 동률로 순서가 흔들리는 걸 막는다(python과 JS의 부동소수 반올림이 갈릴 수 있다). */
async function write(root: string, name: string, body: string) {
  writeFileSync(path.join(root, "tickets", name), body);
  await sleep(5);
}

process.on("exit", () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// ── 픽스처 1: 기본 접미사 ────────────────────────────────────────────────────

const fm = (o: Record<string, string>) =>
  "---\n" +
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n") +
  "\n---\n";

async function buildDefaultFixture(): Promise<string> {
  const r = newRoot();
  // 정상
  await write(
    r,
    "aaaa1111.md",
    fm({ ticket: "aaaa1111", title: "정상 티켓", kind: "work", persona: "developer" }) +
      "\n## Goal\n본문이다\n",
  );
  // frontmatter 없음 -> 엔진이 무시한다
  await write(r, "bbbb2222.md", "# 그냥 마크다운\n프론트매터가 없다\n");
  // 닫는 --- 없음 -> 엔진이 무시한다
  await write(r, "cccc3333.md", "---\nticket: cccc3333\ntitle: 안 닫힌 것\n\n본문\n");
  // .wip
  await write(
    r,
    "dddd4444.wip.md",
    fm({ ticket: "dddd4444", title: "진행중", kind: "work", session_id: "sess-dddd" }),
  );
  // .done
  await write(r, "eeee5555.done.md", fm({ ticket: "eeee5555", title: "완료", kind: "work" }));
  // 한글 파일명 NFC — ticket: 없음(해시가 파일명에서 나온다)
  await write(r, "한글티켓.md".normalize("NFC"), fm({ title: "한글 NFC", kind: "request" }));
  // 한글 파일명 NFD
  await write(r, "테스트.md".normalize("NFD"), fm({ title: "한글 NFD", kind: "feedback" }));
  // deps 인라인 — aaaa1111(열림·미충족) + eeee5555(완료·충족)
  await write(
    r,
    "ffff6666.md",
    fm({ ticket: "ffff6666", title: "인라인 deps", kind: "work", deps: "[aaaa1111, eeee5555]" }),
  );
  // deps 블록 리스트 — dddd4444(.wip·미충족) + eeee5555(충족)
  await write(
    r,
    "gggg7777.md",
    "---\nticket: gggg7777\ntitle: 블록 deps\nkind: work\ndeps:\n  - dddd4444\n  - eeee5555\n---\n",
  );
  // 오타 deps 해시 -> 큐에 없으므로 보수적으로 미충족
  await write(r, "hhhh8888.md", fm({ ticket: "hhhh8888", title: "오타 deps", deps: "[zzzz9999]" }));
  // session_id 있음 -> 할당됨
  await write(
    r,
    "iiii9999.md",
    fm({ ticket: "iiii9999", title: "할당된 것", kind: "work", persona: "qa", session_id: "sess-iiii" }),
  );
  // 하위 디렉터리 안 파일 -> 큐는 평면이라 무시된다
  mkdirSync(path.join(r, "tickets", "sub"));
  writeFileSync(
    path.join(r, "tickets", "sub", "jjjj0000.md"),
    fm({ ticket: "jjjj0000", title: "하위 디렉터리", kind: "work" }),
  );
  // 숨김 파일 -> 무시
  await write(r, ".hidden.md", fm({ ticket: "hidden", title: "숨김" }));
  return r;
}

test("패리티 — 기본 접미사(.wip/.done) 큐", async () => {
  const root = await buildDefaultFixture();
  const tickets = await listTickets(root, DEFAULT);
  assert.strictEqual(tsList(tickets), pyList(root));
});

test("파생 판정 — 상태·해시·deps·본문·평면 큐", async () => {
  const root = await buildDefaultFixture();
  const tickets = await listTickets(root, DEFAULT);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;

  // frontmatter 없음 / 닫는 --- 없음 / 하위 디렉터리 / 숨김 파일은 큐에 없다
  assert.deepStrictEqual(
    tickets.map((t) => t.hash).sort(),
    [
      "aaaa1111",
      "dddd4444",
      "eeee5555",
      "ffff6666",
      "gggg7777",
      "hhhh8888",
      "iiii9999",
      "한글티켓",
      "테스트",
    ].sort(),
  );

  assert.strictEqual(by("aaaa1111").state, "open");
  assert.strictEqual(by("dddd4444").state, "wip");
  assert.strictEqual(by("eeee5555").state, "done");
  assert.strictEqual(by("aaaa1111").persona, "developer");
  assert.strictEqual(by("aaaa1111").title, "정상 티켓");
  assert.strictEqual(by("aaaa1111").body, "\n## Goal\n본문이다\n");

  // 한글 해시는 NFC로 정규화된다(파일명이 NFD여도)
  assert.ok(tickets.some((t) => t.hash === "테스트".normalize("NFC")));
  assert.strictEqual(by("테스트".normalize("NFC")).hash.normalize("NFD").length, 6);

  // deps 두 문법
  assert.deepStrictEqual(by("ffff6666").deps, ["aaaa1111", "eeee5555"]);
  assert.deepStrictEqual(by("ffff6666").unmet, ["aaaa1111"]);
  assert.deepStrictEqual(by("gggg7777").deps, ["dddd4444", "eeee5555"]);
  assert.deepStrictEqual(by("gggg7777").unmet, ["dddd4444"]);
  assert.deepStrictEqual(by("hhhh8888").unmet, ["zzzz9999"]);

  assert.strictEqual(by("iiii9999").assigned, true);
  assert.strictEqual(by("aaaa1111").assigned, false);
});

// ── 픽스처 2: 한글 접미사 테넌트 ─────────────────────────────────────────────

test("패리티 — 한글 접미사(-진행중/-완료) 테넌트", async () => {
  const root = newRoot();
  const sfx: Suffixes = { inProgress: "-진행중", done: "-완료" };
  await write(root, "kkkk1111.md", fm({ ticket: "kkkk1111", title: "열림", kind: "work" }));
  await write(
    root,
    "llll2222-진행중.md",
    fm({ ticket: "llll2222", title: "진행중", session_id: "sess-llll" }),
  );
  await write(root, "mmmm3333-완료.md", fm({ ticket: "mmmm3333", title: "완료" }));
  await write(
    root,
    "nnnn4444.md",
    fm({ ticket: "nnnn4444", title: "deps", kind: "work", deps: "[mmmm3333, llll2222]" }),
  );

  const tickets = await listTickets(root, sfx);
  assert.strictEqual(
    tsList(tickets),
    pyList(root, { TICKET_INPROGRESS: "-진행중", TICKET_DONE: "-완료" }),
  );
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("llll2222").state, "wip");
  assert.strictEqual(by("mmmm3333").state, "done");
  assert.deepStrictEqual(by("nnnn4444").unmet, ["llll2222"]); // 완료만 충족
});

test("패리티 — 빈 큐", async () => {
  const root = newRoot();
  assert.strictEqual(tsList(await listTickets(root, DEFAULT)), pyList(root));
});

// ── 관계 (티켓 상세) ────────────────────────────────────────────────────────

test("관계 — stemOf · resolveDep(`re-` 폴백) · 역참조", async () => {
  const root = newRoot();
  const sfx: Suffixes = { inProgress: "-진행중", done: "-완료" };
  // 한글 접미사 테넌트로 돌린다: stem 판정이 접미사를 하드코딩하면 여기서 깨진다.
  await write(root, "aaaa1111-완료.md", fm({ ticket: "aaaa1111", title: "선행" }));
  await write(root, "re-bbbb2222.md", fm({ ticket: "re-bbbb2222", title: "피드백 티켓" }));
  await write(root, "cccc3333.md", fm({ ticket: "cccc3333", title: "본체", deps: "[aaaa1111]" }));
  await write(
    root,
    "dddd4444.md",
    // bbbb2222은 큐에 없다 — find_any가 `re-bbbb2222`로 폴백한다
    fm({ ticket: "dddd4444", title: "둘 다 의존", deps: "[bbbb2222, cccc3333]" }),
  );
  await write(root, "eeee5555.md", fm({ ticket: "eeee5555", title: "오타", deps: "[zzzz9999]" }));

  const tickets = await listTickets(root, sfx);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;

  assert.strictEqual(stemOf(by("aaaa1111").path, sfx), "aaaa1111"); // 접미사를 뗀다
  assert.strictEqual(stemOf(by("cccc3333").path, sfx), "cccc3333");

  assert.strictEqual(resolveDep(tickets, "aaaa1111", sfx), by("aaaa1111"));
  assert.strictEqual(resolveDep(tickets, "bbbb2222", sfx), by("re-bbbb2222")); // `re-` 폴백
  assert.strictEqual(resolveDep(tickets, "zzzz9999", sfx), null); // 큐에 없는 해시

  // 역참조: cccc3333을 deps에 가진 건 dddd4444뿐이다
  assert.deepStrictEqual(
    referrers(tickets, by("cccc3333"), sfx).map((t) => t.hash),
    ["dddd4444"],
  );
  assert.deepStrictEqual(
    referrers(tickets, by("re-bbbb2222"), sfx).map((t) => t.hash),
    ["dddd4444"],
  );
  assert.deepStrictEqual(referrers(tickets, by("dddd4444"), sfx), []); // 아무도 안 막는다
  // deps가 오타면 아무 티켓도 가리키지 않는다(그래서 영구 대기다)
  assert.deepStrictEqual(by("eeee5555").unmet, ["zzzz9999"]);
});

// ── 식별자 (DESIGN.md §식별자) ───────────────────────────────────────────────

test("식별자 — stem 파생 · 경고 조건은 엔진 find와 판정이 같다", async () => {
  const root = newRoot();
  // 한글 접미사 테넌트로 돌린다: stem이 접미사를 하드코딩하면 여기서 깨진다.
  const sfx: Suffixes = { inProgress: "-진행중", done: "-완료" };
  // ① `ticket:`이 파일명과 어긋났다 — 표시값으로는 엔진이 못 찾는다(경고 대상)
  await write(root, "abc12345.md", fm({ ticket: "zzz99999", title: "어긋난 표시값" }));
  // ② 접미사 있는 정상 티켓 — stem은 접미사를 뗀 것
  await write(root, "def67890-완료.md", fm({ ticket: "def67890", title: "정상 완료" }));
  // ③ `ticket:` 없는 진행중 — 표시값이 `<이름>-진행중`이지만 엔진은 정상적으로 찾는다
  await write(root, "ghi13579-진행중.md", fm({ title: "표시값에 접미사가 붙는다" }));
  // ④ `re-<해시>` 폴백 — jkl24680이 큐에 없으니 find_any가 re-jkl24680으로 떨어진다
  await write(root, "re-jkl24680.md", fm({ ticket: "jkl24680", title: "피드백 티켓" }));
  // ⑤ ①을 표시값으로 지목한 후행 — 선행이 `.done`이 돼도 안 풀린다(스펙의 영구 대기)
  await write(root, "dep00001.md", fm({ ticket: "dep00001", title: "후행", deps: "[zzz99999]" }));

  const tickets = await listTickets(root, sfx);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;

  // stem은 파일명에서 나온다 — `ticket:`을 보지 않고, 접미사를 뗀다
  assert.strictEqual(by("zzz99999").stem, "abc12345");
  assert.strictEqual(by("def67890").stem, "def67890");
  assert.strictEqual(by("ghi13579-진행중").stem, "ghi13579");
  assert.strictEqual(by("jkl24680").stem, "re-jkl24680");

  // 경고는 ①에만 뜬다. 문자열 비교면 ③(hash≠stem)·④(hash≠stem)에도 떴을 것이다
  assert.strictEqual(by("zzz99999").hashResolves, false);
  assert.strictEqual(by("def67890").hashResolves, true);
  assert.strictEqual(by("ghi13579-진행중").hashResolves, true);
  assert.strictEqual(by("jkl24680").hashResolves, true);

  // 표시값을 deps에 적으면 선행을 못 찾으므로 영구 대기다 — 경고가 필요한 이유
  assert.deepStrictEqual(by("dep00001").unmet, ["zzz99999"]);

  // 판정을 눈으로 맞추지 않는다: 엔진 `find`가 같은 파일을 주는지 티켓마다 확인한다.
  for (const t of tickets) {
    let hit = "";
    try {
      hit = execFileSync("python3", [PY, "find", root, t.hash], {
        encoding: "utf8",
        env: { ...process.env, TICKET_INPROGRESS: sfx.inProgress, TICKET_DONE: sfx.done },
      }).trim();
    } catch {
      hit = ""; // rc=1 `티켓을 못 찾음`
    }
    assert.strictEqual(
      t.hashResolves,
      hit.normalize("NFC") === t.path.normalize("NFC"),
      `${t.hash}: 엔진 find=${hit || "(못 찾음)"} / hashResolves=${t.hashResolves}`,
    );
  }
});

// ── 쓰기 ────────────────────────────────────────────────────────────────────

test("writeTicket — 남의 frontmatter 키는 그대로, 파싱은 엔진과 계속 같다", async () => {
  const root = newRoot();
  await write(
    root,
    "ffff6666.md",
    "---\nticket: ffff6666\ntitle: 원래 제목\nkind: work\nsession_id: sess-x\nowner: developer / w1\nattempts: 2\n---\n\n## Goal\n원래 본문\n",
  );

  const before = (await listTickets(root, DEFAULT))[0];
  await writeTicket(before.path, { title: "고친 제목", kind: "feedback", persona: "qa" }, "새 본문\n");

  const raw = readFileSync(before.path, "utf8");
  // 없던 키는 닫는 `---` 직전에 들어간다(tickets.py set_fm_keys와 같은 자리)
  assert.strictEqual(
    raw,
    "---\nticket: ffff6666\ntitle: 고친 제목\nkind: feedback\nsession_id: sess-x\nowner: developer / w1\nattempts: 2\npersona: qa\n---\n새 본문\n",
  );

  const after = (await listTickets(root, DEFAULT))[0];
  assert.strictEqual(after.title, "고친 제목");
  assert.strictEqual(after.kind, "feedback");
  assert.strictEqual(after.persona, "qa");
  assert.strictEqual(after.body, "새 본문\n");
  assert.strictEqual(after.fm.session_id, "sess-x"); // 엔진이 쓰는 값은 건드리지 않는다
  assert.strictEqual(after.fm.attempts, "2");
  // 쓴 뒤에도 엔진이 같은 판정을 하는가 — 이게 깨지면 GUI 저장이 티켓을 큐에서 지운다
  assert.strictEqual(tsList([after]), pyList(root));
});

// ── 보드 필터·검색·정렬 ──────────────────────────────────────────────────────

test("보드 — 5상태 판정 · 필터 AND/OR · 검색 대상 · 정렬", async () => {
  const root = await buildDefaultFixture();
  const tickets = await listTickets(root, DEFAULT);
  const hashes = (ts: Ticket[]) => ts.map((t) => t.hash);
  const none = { kind: [], persona: [], status: [], q: "" };

  // 5상태 — 우선순위가 tickets.py list와 같다(할당됨이 deps 대기보다 먼저)
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(statusOf(by("aaaa1111")), "open");
  assert.strictEqual(statusOf(by("ffff6666")), "blocked"); // unmet: aaaa1111
  assert.strictEqual(statusOf(by("iiii9999")), "assigned");
  assert.strictEqual(statusOf(by("dddd4444")), "wip");
  assert.strictEqual(statusOf(by("eeee5555")), "done");

  // 필터 없음 = 큐 그대로(순서까지)
  assert.deepStrictEqual(hashes(filterTickets(tickets, none)), hashes(tickets));

  // 다중 선택은 OR
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, status: ["blocked"] })), [
    "ffff6666",
    "gggg7777",
    "hhhh8888",
  ]);
  assert.deepStrictEqual(
    hashes(filterTickets(tickets, { ...none, kind: ["request", "feedback"] })),
    ["한글티켓".normalize("NFC"), "테스트".normalize("NFC")],
  );

  // 필터끼리는 AND — kind=work인 열린 미할당·deps충족 티켓은 aaaa1111뿐이다
  assert.deepStrictEqual(
    hashes(filterTickets(tickets, { ...none, kind: ["work"], status: ["open"] })),
    ["aaaa1111"],
  );

  // 검색 대상은 title + 본문 + frontmatter 값 전체, 대소문자 무시
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, q: "정상" })), ["aaaa1111"]);
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, q: "본문이다" })), ["aaaa1111"]);
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, q: "SESS-IIII" })), ["iiii9999"]);
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, q: "없는말" })), []);
  // 한글은 NFC로 맞춰 비교한다 — 파일명이 NFD인 티켓(해시가 파일명에서 나온다)을
  // NFD 검색어로 찾아도 걸려야 한다. 안 맞추면 "검색해도 안 나오는 티켓"이 생긴다.
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, q: "테스트".normalize("NFD") })), [
    "테스트".normalize("NFC"),
  ]);

  // 정렬 안 하면 큐 순서를 손대지 않는다(= CLI list와 같은 순서)
  assert.strictEqual(sortTickets(tickets, null, false), tickets);
  assert.deepStrictEqual(hashes(sortTickets(tickets, "created", true)), hashes(tickets).reverse());
  // 해시 오름차순 (한글 해시의 자리는 로케일이 정한다 — 영문 해시들의 순서로 본다)
  assert.deepStrictEqual(
    hashes(sortTickets(tickets, "hash", false)).filter((h) => /^[a-z]/.test(h)),
    ["aaaa1111", "dddd4444", "eeee5555", "ffff6666", "gggg7777", "hhhh8888", "iiii9999"],
  );
  // deps 개수 내림차순 — 2개짜리 둘이 먼저, 동률은 큐 순서 유지(안정 정렬)
  assert.deepStrictEqual(hashes(sortTickets(tickets, "deps", true)).slice(0, 2), [
    "ffff6666",
    "gggg7777",
  ]);
  // 상태 정렬은 큐를 흐르는 순서다(대기 → deps 대기 → 할당됨 → 진행중 → 완료)
  assert.deepStrictEqual(
    sortTickets(tickets, "status", false).map((t) => statusOf(t)),
    ["open", "open", "open", "blocked", "blocked", "blocked", "assigned", "wip", "done"],
  );
});
