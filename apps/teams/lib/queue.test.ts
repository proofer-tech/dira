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
  HIDE_DONE_STATUSES,
  awaitingOf,
  awaitingUnlocked,
  derivedFrom,
  filterTickets,
  findPath,
  inDefaultList,
  isAwaiting,
  listTickets,
  bodyWithoutQuestions,
  questionsOf,
  depBadges,
  referrers,
  relationEdges,
  reqOf,
  reqTitle,
  resolveDep,
  sortTableRows,
  sortTickets,
  statusOf,
  stemOf,
  threadOf,
  writeTicket,
  type Suffixes,
  type Ticket,
} from "./queue.ts";

const PY = fileURLToPath(new URL("../../../tickets.py", import.meta.url));
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

// ── 픽스처 2: 한글 접미사 프로젝트 ─────────────────────────────────────────────

test("패리티 — 한글 접미사(-진행중/-완료) 프로젝트", async () => {
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
  // 한글 접미사 프로젝트로 돌린다: stem 판정이 접미사를 하드코딩하면 여기서 깨진다.
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

// `resolveDep`이 stem 맵을 memo하고 나서(f62d3236) 깨질 수 있는 두 자리다: 같은 배열을 다른
// 접미사로 풀 때 앞의 맵이 재사용되면 안 되고, 중복 stem은 종전 `tickets.find`와 같이
// **배열에서 먼저 나온 것**이 이겨야 한다.
test("관계 — resolveDep 맵이 접미사별로 갈리고 중복 stem은 먼저 나온 것이 이긴다", async () => {
  const root = newRoot();
  const ko: Suffixes = { inProgress: "-진행중", done: "-완료" };
  const en: Suffixes = { inProgress: ".wip", done: ".done" };
  await write(root, "xxxx1111-완료.md", fm({ ticket: "xxxx1111", title: "한글 접미사" }));
  await write(root, "dup2222.md", fm({ ticket: "dup2222", title: "열림" }));
  await write(root, "dup2222-완료.md", fm({ ticket: "dup2222", title: "같은 stem" }));

  const tickets = await listTickets(root, ko);
  // 같은 배열 · 다른 접미사 — en에서는 `-완료`가 안 떨어지므로 stem이 `xxxx1111-완료`다
  assert.strictEqual(resolveDep(tickets, "xxxx1111", ko)?.hash, "xxxx1111");
  assert.strictEqual(resolveDep(tickets, "xxxx1111", en), null);
  assert.strictEqual(resolveDep(tickets, "xxxx1111-완료", en)?.hash, "xxxx1111");

  // 중복 stem: 판정이 `find`와 같아야 한다(엔진 `_find_stem`도 먼저 나온 파일이 이긴다)
  assert.strictEqual(
    resolveDep(tickets, "dup2222", ko),
    tickets.find((t) => stemOf(t.path, ko) === "dup2222"),
  );
});

test("관계 — depBadges 네 종류 판정 + 조치 필요한 것이 왼쪽 (§비주얼 §2)", async () => {
  const root = newRoot();
  const sfx: Suffixes = { inProgress: "-진행중", done: "-완료" };
  await write(root, "a1111111-완료.md", fm({ ticket: "a1111111", title: "답변", kind: "answer" }));
  await write(root, "b2222222-완료.md", fm({ ticket: "b2222222", title: "선행 완료" }));
  await write(root, "c3333333.md", fm({ ticket: "c3333333", title: "선행 미완" }));
  // 답변 파일이 `.done`이 아닌 이상 케이스 — 실제로 후행을 굶기므로 `answer`가 아니라 `unmet`이다
  await write(root, "d4444444.md", fm({ ticket: "d4444444", title: "열린 답변", kind: "answer" }));
  await write(
    root,
    "r0000001.md",
    // deps 적힌 순서: 답변 · 충족 · 미충족 · 오타 · 열린 답변
    fm({
      ticket: "r0000001",
      title: "요구사항",
      kind: "request",
      deps: "[a1111111, b2222222, c3333333, zzzz9999, d4444444]",
    }),
  );

  const tickets = await listTickets(root, sfx);
  const req = tickets.find((t) => t.hash === "r0000001")!;
  // 미충족·큐에 없음이 먼저, 그 안에서는 `deps`에 적힌 순서가 유지된다(정렬이 안정적이다)
  assert.deepStrictEqual(
    depBadges(tickets, req, sfx).map((d) => [d.hash, d.kind, !!d.hit]),
    [
      ["c3333333", "unmet", true],
      ["zzzz9999", "missing", false],
      ["d4444444", "unmet", true],
      ["a1111111", "answer", true],
      ["b2222222", "met", true],
    ],
  );
});

// ── 식별자 (DESIGN.md §식별자) ───────────────────────────────────────────────

test("식별자 — stem 파생 · 경고 조건은 엔진 find와 판정이 같다", async () => {
  const root = newRoot();
  // 한글 접미사 프로젝트로 돌린다: stem이 접미사를 하드코딩하면 여기서 깨진다.
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
  // `findPath`도 같이 본다 — 상세·액션이 python 스폰 대신 부르는 미러가 이것이다(38b11db5).
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
    assert.strictEqual(
      (await findPath(root, t.hash, sfx))?.normalize("NFC") ?? "",
      hit.normalize("NFC"),
      `${t.hash}: findPath가 엔진 find와 다른 파일을 준다`,
    );
  }
});

/** 같은 stem이 두 상태로 동시에 있는 큐 — `_find_stem`은 바깥이 **파일** · 안쪽이 접미사라
 *  이기는 것은 접미사 순서가 아니라 **파일 목록 순서**다. stem 인덱스(`923f5f34`)가 후보 3개 중
 *  목록에서 가장 앞선 파일을 고르는지 못박는다: 접미사 순서(`""` → wip → done)로 골랐다면
 *  dup00002가 `.md`로 떨어져 여기서 깨진다.
 *
 *  **여기서만 엔진과 대조하지 않는다.** `tickets_in`은 `glob.glob`(디렉터리 원본 순서)이고
 *  `ticketFiles`는 `readdir`(libuv가 strcmp로 정렬해서 준다)이라 후보가 둘 이상일 때 둘이 고르는
 *  파일이 갈린다 — 이 refactor 이전부터 그랬고, 원본 순서는 node가 볼 수 없어 맞출 방법이 없다.
 *  한 stem이 두 상태로 동시에 있는 건 엔진이 만들지 않는 큐다(상태 전이가 rename이라 파일이
 *  하나다). 사람이 손으로 복사해 만든 경우에만 생기고, 그때 화면과 CLI가 다른 파일을 가리킨다. */
test("find_any — 같은 stem이 두 상태로 있으면 파일 순서가 이긴다(접미사 순서가 아니다)", async () => {
  const root = newRoot();
  // `ticket:`을 stem으로 박는다 — 둘 다 같은 해시를 묻게 해서 findAny가 **누구를 고르는지** 본다
  for (const n of ["dup00001.md", "dup00001.wip.md", "dup00002.done.md", "dup00002.md"]) {
    await write(root, n, fm({ ticket: n.split(".")[0], title: "중복 stem" }));
  }
  const tickets = await listTickets(root, DEFAULT);
  // hashResolves가 true인 티켓 = findAny가 자기 파일을 준 티켓. stem당 정확히 하나여야 한다
  const won = (want: string) =>
    tickets.filter((t) => t.stem === want && t.hashResolves).map((t) => path.basename(t.path));
  assert.deepStrictEqual(won("dup00001"), ["dup00001.md"]); // 정렬 순서로 `.md` < `.wip.md`
  assert.deepStrictEqual(won("dup00002"), ["dup00002.done.md"]); // `.done.md` < `.md` — 접미사 순서면 `.md`
});

/** 파싱 캐시(`923f5f34`)의 무효화 — **크기가 같은 제자리 수정**이 최악의 경우다.
 *  mtime만으로 못 잡으면 GUI가 옛 본문을 계속 보여준다(파일이 곧 상태인 제품에서 치명적). */
test("캐시 무효화 — 같은 크기로 제자리 수정해도 새 내용이 보인다", async () => {
  const root = newRoot();
  const p = path.join(root, "tickets", "cach0001.md");
  writeFileSync(p, fm({ ticket: "cach0001", title: "AAA" }) + "본문 AAA\n");
  assert.strictEqual((await listTickets(root, DEFAULT))[0].title, "AAA"); // 캐시를 채운다

  const before = readFileSync(p, "utf8");
  writeFileSync(p, before.replaceAll("AAA", "BBB")); // 한 글자도 안 늘어난다
  assert.strictEqual(readFileSync(p, "utf8").length, before.length);

  const after = (await listTickets(root, DEFAULT))[0];
  assert.strictEqual(after.title, "BBB");
  assert.strictEqual(after.body, "본문 BBB\n");
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

  // N6 `일이 남았으면 안 잔다`가 세는 것 — `대기`·`진행중` 둘뿐이다(§데스크톱 앱 N6).
  // `/api/work`가 이 식 하나다. 넓히면(= 나머지 셋이 섞이면) 저 셋만 남은 큐에서도 맥이 안 잔다.
  const busy = (ts: Ticket[]) => ts.some((t) => statusOf(t) === "open" || statusOf(t) === "wip");
  assert.ok(busy(tickets));
  assert.ok(!busy(tickets.filter((t) => statusOf(t) === "blocked"))); // 답변 대기도 여기 든다
  assert.ok(!busy(tickets.filter((t) => ["assigned", "done"].includes(statusOf(t)))));
  assert.ok(busy([by("aaaa1111")]) && busy([by("dddd4444")])); // 하나만 있어도 잡는다

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

  // `완료 숨기기` 프리셋(§1 보드) — 완료만 빠진다. 5개 중 하나가 빠지면 그 상태 티켓이
  // 테이블에서 조용히 사라지므로, "완료 아닌 전부"와 글자 단위로 같은지 본다.
  const hideDone = filterTickets(tickets, { ...none, status: HIDE_DONE_STATUSES });
  assert.deepStrictEqual(
    hashes(hideDone),
    hashes(tickets.filter((t) => statusOf(t) !== "done")),
  );
  assert.ok(hashes(hideDone).includes("iiii9999")); // 디스패치되지 않는 티켓은 남는다(§0-2)
  assert.ok(!hashes(hideDone).includes("eeee5555")); // 완료는 빠진다

  // 완료는 기본으로 **보인다**(§1 보드 · 사람 요청 `38108932`) — `status`가 URL에 하나도 없으면
  // page.tsx가 상태 6값을 넣고, `완료 숨기기` 프리셋이 `HIDE_DONE_STATUSES`를 넣는다.
  // "없을 때 무엇을 넣느냐"는 그쪽 유도라 여기서는 **넣는 두 값이 각각 무엇을 내는지**를 못박는다.
  // (분량은 상태 축이 아니라 칸반 `완료` 레인의 최근 20건 자르기가 받는다 — 필터 판정 밖이다.)
  assert.ok(!HIDE_DONE_STATUSES.includes("done")); // 섞이면 프리셋이 자기 이름과 다른 일을 한다
  const allStatuses = [...HIDE_DONE_STATUSES, "done"]; // = 상태 필터 선택지 6개 = 기본값
  assert.deepStrictEqual(
    hashes(filterTickets(tickets, { ...none, status: allStatuses })), // 6값 = 상태로 안 거른 것
    hashes(filterTickets(tickets, none)),
  );
  // 기본 화면이 완료를 담는다는 것 — 위 등식만으로는 "6값이 전부"만 말하고 완료가 그 안에 있는지는
  // 말하지 않는다. 이 한 줄이 `bad035ec`의 회귀(방금 끝난 티켓이 보드에서 사라진다)를 잡는다.
  assert.ok(hashes(filterTickets(tickets, { ...none, status: allStatuses })).includes("eeee5555"));
  // 하나라도 실리면 실린 값이 전부다 — `?status=done` 단독에 기본값이 섞이면 완료만 보기가 깨진다.
  // 이 집합의 크기가 건수 옆 `완료 N건 숨김`의 N이기도 하다(page.tsx가 같은 식을 쓴다).
  assert.deepStrictEqual(
    hashes(filterTickets(tickets, { ...none, status: ["done"] })),
    hashes(tickets.filter((t) => statusOf(t) === "done")),
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

  // 테이블만 기본이 다르다 — 생성일 내림차순(§1 보드 §테이블 기본 순서. 요구 `1208e64a`).
  // 파라미터 없는 화면의 첫 행이 `birth`가 가장 큰 티켓이라는 것.
  const queueOrder = hashes(tickets);
  assert.deepStrictEqual(hashes(sortTableRows(tickets, null, false)), [...queueOrder].reverse());
  assert.strictEqual(
    sortTableRows(tickets, null, false)[0],
    [...tickets].sort((a, b) => b.birth - a.birth)[0],
  );
  // 입력을 제자리에서 뒤집지 않는다 — 같은 목록을 칸반·건수·관계선이 큐 순서로 계속 쓴다
  assert.deepStrictEqual(hashes(tickets), queueOrder);
  assert.deepStrictEqual(hashes(sortTickets(tickets, null, false)), queueOrder);
  // 파라미터가 실리면 기본이 끼어들지 않는다 — 헤더 클릭 3단계가 종전 규칙 그대로다
  for (const [key, desc] of [
    ["created", false],
    ["title", true],
  ] as const)
    assert.deepStrictEqual(
      hashes(sortTableRows(tickets, key, desc)),
      hashes(sortTickets(tickets, key, desc)),
    );
});

// ── 요구사항 왕복 (DESIGN.md §요구사항 레이어) ───────────────────────────────

function pySelect(root: string, env: Record<string, string> = {}): string {
  return execFileSync("python3", [PY, "select", root], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...env },
  });
}

/** 답변 파일 하나가 큐의 잠금을 푸는 것과 GUI 판정이 같은 순간에 켜지고 꺼지는지.
 *  판정만 맞추면 소용없다 — 실제로 `select`에 뜨는지를 엔진에게 물어 못박는다. */
test("답변 대기 판정 + 답변 파일 생성으로 재큐 (엔진과 대조)", async () => {
  const r = newRoot();
  await write(
    r,
    "r0000001.md",
    fm({
      ticket: "r0000001",
      title: "요구사항",
      kind: "request",
      persona: "pm",
      deps: "[a1111111]",
      awaiting: "a1111111",
    }) + "사람이 쓴 요구 전문.\n\n## 질문 1\n\n어느 화면인가?\n\n### 보기\n\n- 보드\n\n## 참고\n\n질문 아니다.\n",
  );
  // 잠금 없는 답변 대기 — `awaiting`만 있고 `deps`가 없다
  await write(
    r,
    "r0000002.md",
    fm({ ticket: "r0000002", title: "잠금 없음", kind: "request", awaiting: "b2222222" }),
  );
  // `.wip` — 답변칸이 없어야 한다(제약 5). `awaiting`이 걸려 있어도 마찬가지다
  await write(
    r,
    "r0000003.wip.md",
    fm({
      ticket: "r0000003",
      title: "물고 있는 중",
      kind: "request",
      deps: "[c3333333]",
      awaiting: "c3333333",
    }),
  );

  const before = await listTickets(r, DEFAULT);
  const at = (h: string) => before.find((t) => t.hash === h)!;
  assert.strictEqual(isAwaiting(at("r0000001")), true);
  assert.strictEqual(awaitingOf(at("r0000001")), "a1111111");
  assert.strictEqual(awaitingUnlocked(at("r0000001")), false);
  // 잠금 없음: 경고는 뜨고 답변칸은 안 뜬다(엔진이 이미 디스패치 후보로 본다)
  assert.strictEqual(awaitingUnlocked(at("r0000002")), true);
  assert.strictEqual(isAwaiting(at("r0000002")), false);
  // `.wip`은 state로 걸러진다 — 답변칸도 경고도 없다
  assert.strictEqual(isAwaiting(at("r0000003")), false);
  assert.strictEqual(awaitingUnlocked(at("r0000003")), false);

  // 본문 스레드: `## 질문 n`만 집고, h3 이하는 그 질문 안에 남는다
  assert.deepStrictEqual(questionsOf(at("r0000001").body), [
    { heading: "질문 1", text: "어느 화면인가?\n\n### 보기\n\n- 보드" },
  ]);

  // 짝 함수 — 읽기 전용 렌더가 쓰는 본문. 질문 절만 사라지고 앞뒤 절은 그대로다.
  // 지운 자리에 빈 줄이 겹쳐 남지 않는다(`\n\n` 하나다)
  assert.strictEqual(
    bodyWithoutQuestions(at("r0000001").body),
    "사람이 쓴 요구 전문.\n\n## 참고\n\n질문 아니다.",
  );
  // 절이 없는 본문은 그대로고, 질문뿐인 본문은 ""다(호출부가 `본문 없음`을 그린다)
  assert.strictEqual(bodyWithoutQuestions("## Goal\n\n하나.\n"), "## Goal\n\n하나.");
  assert.strictEqual(bodyWithoutQuestions("## 질문 1\n\n뭔가?\n"), "");

  // 엔진 대조 — 답변 전: `deps 대기`이고 select 0건이다
  assert.match(pyList(r), /r0000001 .* deps 대기 a1111111/);
  assert.strictEqual(
    pySelect(r)
      .split("\n")
      .filter((l) => l.includes("r0000001")).length,
    0,
  );

  // 답변 파일 생성 = 액션이 하는 일 그대로 (`.done`으로 태어난다)
  await write(
    r,
    "a1111111.done.md",
    fm({ ticket: "a1111111", title: "답변 — r0000001 #1", kind: "answer" }) + "\n## 답변 1\n\n보드다.\n",
  );

  const after = await listTickets(r, DEFAULT);
  const req = after.find((t) => t.hash === "r0000001")!;
  // `awaiting`은 지우지 않았는데 판정이 저절로 꺼진다(이력이 남는다 — 결정 5)
  assert.strictEqual(awaitingOf(req), "a1111111");
  assert.strictEqual(isAwaiting(req), false);
  assert.strictEqual(awaitingUnlocked(req), false);
  assert.deepStrictEqual(req.unmet, []);
  assert.strictEqual(statusOf(req), "open");

  // 스레드 — 질문 절과 답변 티켓을 번갈아. 상세(§2 답변 카드)와 보드 카드의 답변 다이얼로그(§1)가
  // 이 함수 하나를 쓴다. 답변 라벨은 답변 티켓의 title이고 해시는 **stem**(접미사를 뗀 이름)이다.
  // `birth`는 답변 파일 것 그대로다 — 진행 기록이 스트림 사건과 섞을 때 쓰는 시각이고(§2-3 ②),
  // 여기서 지어내면 옛 라운드 답변이 지금 세션 사건 사이로 끼어든다. 질문에는 없다.
  assert.deepStrictEqual(threadOf(after, req, DEFAULT), [
    { role: "question", heading: "질문 1", text: "어느 화면인가?\n\n### 보기\n\n- 보드" },
    {
      role: "answer",
      heading: "답변 — r0000001 #1",
      text: "## 답변 1\n\n보드다.",
      hash: "a1111111",
      birth: after.find((t) => t.hash === "a1111111")!.birth,
    },
  ]);

  // 엔진 대조 — 답변 후: `대기`이고 select에 뜬다. 이게 재큐의 증거다
  assert.match(pyList(r), /r0000001 .* 대기/);
  assert.match(pySelect(r), /r0000001\.md\|r0000001\|request\|pm/);
  // 답변 파일 자체는 열린 티켓이 아니라 `list`를 어지럽히지 않는다
  assert.doesNotMatch(pyList(r), /a1111111/);
});

/** `req:` 왕복 — 작업 티켓 → 출처 요구사항, 요구사항 → 나온 티켓. 한글 접미사 프로젝트로 돌린다:
 *  stem 판정이 접미사를 하드코딩하면 `req: r0000001`이 `r0000001-완료.md`를 못 찾는다. */
test("req 왕복 — 출처·파생 양방향, deps와 섞이지 않고 큐를 직렬화하지 않는다", async () => {
  const r = newRoot();
  const sfx: Suffixes = { inProgress: "-진행중", done: "-완료" };
  // 출처 요구사항. `.done`(접미사 붙은 파일)이지만 `req:`가 가리키는 것은 stem이다
  await write(r, "r0000001-완료.md", fm({ ticket: "r0000001", title: "요구사항", kind: "request" }));
  // 아직 안 쪼갠 요구사항 — 나온 티켓 0건
  await write(r, "r0000002.md", fm({ ticket: "r0000002", title: "안 쪼갬", kind: "request" }));
  // 한글 stem 요구사항을 NFD로 저장한다(macOS 큐가 이렇다). NFC로 적은 `req:`가 걸려야 한다
  await write(r, "요구사항.md".normalize("NFD"), fm({ title: "한글 요구", kind: "request" }));
  // 쪼갠 작업 티켓 둘. `deps`는 없다 — 출처는 선후가 아니다(결정 5)
  await write(r, "w0000001.md", fm({ ticket: "w0000001", title: "쪼갠 1", req: "r0000001" }));
  await write(
    r,
    "w0000002.md",
    // deps는 따로 걸려 있다: 관계 절에서 `req`와 섞이면 안 되는 게 이 티켓이다
    fm({ ticket: "w0000002", title: "쪼갠 2", req: "r0000001", deps: "[r0000002]" }),
  );
  await write(r, "w0000003.md", fm({ ticket: "w0000003", title: "한글 출처", req: "요구사항" }));
  // 오타 req — 큐에 없는 stem이면 링크 대신 사유를 띄운다
  await write(r, "w0000004.md", fm({ ticket: "w0000004", title: "오타 req", req: "zzzz9999" }));
  // req 없는 평범한 티켓 — 아무 줄도 안 붙는다
  await write(r, "w0000005.md", fm({ ticket: "w0000005", title: "무관" }));

  const tickets = await listTickets(r, sfx);
  const at = (h: string) => tickets.find((t) => t.hash === h.normalize("NFC"))!;
  const KO = "요구사항".normalize("NFC"); // `ticket:`이 없어 해시가 파일명에서 나온다(NFC)
  const ENV = { TICKET_INPROGRESS: "-진행중", TICKET_DONE: "-완료" };

  // ① 작업 티켓 → 출처 (접미사를 뗀 stem으로 찾는다)
  assert.strictEqual(reqOf(at("w0000001")), "r0000001");
  assert.strictEqual(resolveDep(tickets, reqOf(at("w0000001")), sfx), at("r0000001"));
  // NFD로 저장된 한글 요구사항도 NFC `req:`로 걸린다
  assert.strictEqual(resolveDep(tickets, reqOf(at("w0000003")), sfx), at(KO));
  // 오타 stem은 못 찾는다 → 화면은 링크 대신 사유 배지다
  assert.strictEqual(resolveDep(tickets, reqOf(at("w0000004")), sfx), null);
  assert.strictEqual(reqOf(at("w0000005")), "");

  // ② 요구사항 → 나온 티켓 (큐 순서 그대로)
  assert.deepStrictEqual(
    derivedFrom(tickets, at("r0000001"), sfx).map((t) => t.hash),
    ["w0000001", "w0000002"],
  );
  assert.deepStrictEqual(derivedFrom(tickets, at("r0000002"), sfx), []); // 아직 안 쪼갬
  assert.deepStrictEqual(
    derivedFrom(tickets, at(KO), sfx).map((t) => t.hash),
    ["w0000003"],
  );

  // ③ deps 관계와 섞이지 않는다 — `req`는 역참조에 안 나오고 `deps`는 파생에 안 나온다
  assert.deepStrictEqual(referrers(tickets, at("r0000001"), sfx), []); // req는 deps가 아니다
  assert.deepStrictEqual(
    referrers(tickets, at("r0000002"), sfx).map((t) => t.hash),
    ["w0000002"], // deps로 엮인 것만
  );
  assert.deepStrictEqual(derivedFrom(tickets, at("w0000002"), sfx), []);

  // ④ 엔진은 `req:`를 모른다 — 출처가 있어도 잠기지 않는다(엮으면 큐가 직렬화된다)
  assert.deepStrictEqual(at("w0000001").unmet, []);
  assert.strictEqual(statusOf(at("w0000001")), "open");
  assert.match(pyList(r, ENV), /w0000001 .* 대기/);
  assert.match(pySelect(r, ENV), /w0000001\.md\|w0000001/);
  // deps가 걸린 쪽만 잠긴다 — r0000002가 열려 있으므로
  assert.deepStrictEqual(at("w0000002").unmet, ["r0000002"]);
  assert.doesNotMatch(pySelect(r, ENV), /w0000002/);
});

// ── 보드 표현 (DESIGN.md §1 보드 요구사항·`kind: answer` 항 · 결정 4) ─────────
//
// 위 테스트가 **판정**을 못박고, 이 테스트는 그 판정이 **보드의 컬럼·필터·목록**으로 어떻게
// 번역되는지를 못박는다: 답변 대기는 `blocked`의 하위 종류이고 답변 파일은 기본 목록에 없다.

test("보드 — 답변 대기는 deps 대기의 하위 종류 · kind: answer 기본 제외", async () => {
  const root = newRoot();
  // ① PM이 되물었고 답변 파일이 아직 없다 → 답변 대기
  await write(
    root,
    "r0000001.md",
    fm({
      ticket: "r0000001",
      title: "답변 대기 요구사항",
      kind: "request",
      persona: "pm",
      deps: "[a1111111]",
      awaiting: "a1111111",
    }) + "\n## 질문 1\n무엇을 먼저?\n",
  );
  // ② 답이 달렸다 → `awaiting`을 지우지 않아도 판정이 꺼진다(이력이 남는다)
  await write(
    root,
    "r0000002.md",
    fm({ ticket: "r0000002", title: "답 받은 요구사항", kind: "request", persona: "pm",
      deps: "[a2222222]", awaiting: "a2222222" }),
  );
  await write(
    root,
    "a2222222.done.md", // 답변 파일은 처음부터 `.done`으로 태어난다
    fm({ ticket: "a2222222", title: "답변 — r0000002 #1", kind: "answer" }) + "\n첫 화면부터.\n",
  );
  // ③ 평범한 deps 대기 — 답변 대기가 아니다
  await write(root, "b0000003.md", fm({ ticket: "b0000003", title: "선행 대기", kind: "work", deps: "[zzzz9999]" }));
  // ④ `awaiting`은 있는데 `deps`를 안 걸었다 → 잠금 없음. 대기가 아니라 그냥 열림이다
  //    (상세가 경고 한 줄을 띄우는 경우다 — 결정 5)
  await write(root, "r0000004.md", fm({ ticket: "r0000004", title: "잠금 없는 요구사항", kind: "request", awaiting: "a4444444" }));
  // ⑤ PM이 물고 있는 중 → 답변칸이 구조적으로 없다(제약 5). 열림이 아니므로 답변 대기도 아니다
  await write(root, "r0000005.wip.md", fm({ ticket: "r0000005", title: "PM 착수", kind: "request", awaiting: "a5555555", session_id: "sess-r5" }));

  const tickets = await listTickets(root, DEFAULT);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  const hashes = (ts: Ticket[]) => ts.map((t) => t.hash);
  const none = { kind: [], persona: [], status: [], q: "" };

  // 엔진과 판정이 같은가 — awaiting은 엔진이 읽는 문법이고 무시하는 키다
  assert.strictEqual(tsList(tickets), pyList(root));

  assert.strictEqual(isAwaiting(by("r0000001")), true);
  assert.strictEqual(isAwaiting(by("r0000002")), false); // 답이 달려 unmet에서 빠졌다
  assert.strictEqual(isAwaiting(by("b0000003")), false); // awaiting 없음
  assert.strictEqual(isAwaiting(by("r0000004")), false); // 잠금 없음
  assert.strictEqual(isAwaiting(by("r0000005")), false); // .wip

  // `statusOf`는 무수정이다 — 답변 대기도 `blocked`다. 칸반은 그걸 `대기` 레인으로 접고
  // (레인 3개, `bd2062cb`) 카드가 `답변 대기` 배지로 갈린다 — 레인 배정은 표현이지 상태가 아니다
  assert.strictEqual(statusOf(by("r0000001")), "blocked");
  assert.strictEqual(statusOf(by("r0000002")), "open");
  assert.strictEqual(statusOf(by("r0000004")), "open");

  // 하위 종류: `blocked`를 고르면 둘 다, `awaiting`을 고르면 그것만
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, status: ["blocked"] })), [
    "r0000001",
    "b0000003",
  ]);
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, status: ["awaiting"] })), [
    "r0000001",
  ]);
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, status: ["awaiting", "wip"] })), [
    "r0000001",
    "r0000005",
  ]);

  // `완료 숨기기` 프리셋에는 `awaiting`이 **있다**(`4578d715`). 결과를 바꾸려고 넣은 게 아니다 —
  // `blocked`가 답변 대기를 이미 데려오므로 빼도 결과는 같다. 체크 표시가 진술이라서 넣는다.
  assert.ok(HIDE_DONE_STATUSES.includes("awaiting"));
  const preset = hashes(filterTickets(tickets, { ...none, status: HIDE_DONE_STATUSES }));
  assert.deepStrictEqual(
    preset, // `awaiting`을 뺀 옛 프리셋과 글자 단위로 같다 = 결과 집합 불변
    hashes(filterTickets(tickets, { ...none, status: HIDE_DONE_STATUSES.filter((s) => s !== "awaiting") })),
  );
  assert.ok(preset.includes("r0000001")); // 답변 대기는 남고
  assert.ok(!preset.some((h) => statusOf(by(h)) === "done")); // 완료는 없다

  // `kind: answer`는 기본 목록에 없다 — 필터에서 고르면 보인다(숨기는 게 아니다)
  assert.strictEqual(inDefaultList(by("a2222222"), []), false);
  assert.strictEqual(inDefaultList(by("a2222222"), ["answer"]), true);
  assert.ok(!hashes(filterTickets(tickets, none)).includes("a2222222"));
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, kind: ["answer"] })), [
    "a2222222",
  ]);
  // 검색도 기본 목록을 따른다 — 답변 본문이 검색으로 새 나오면 "기본 제외"가 거짓말이 된다
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, q: "첫 화면부터" })), []);

  // 경과일 기준은 mtime이다 — 답변 대기 배지의 `· <n>일`
  assert.ok(by("r0000001").mtime > 0);
  assert.strictEqual(Math.floor((Date.now() - by("r0000001").mtime) / 86_400_000), 0);
});

test("reqTitle — 첫 비어있지 않은 줄, 80자에서 자르고 …", () => {
  assert.strictEqual(reqTitle("\n\n  보드에 검색이 필요하다  \n다음 줄\n"), "보드에 검색이 필요하다");
  // 80자 경계: 80자는 그대로, 81자는 80자 + …
  assert.strictEqual(reqTitle("가".repeat(80)), "가".repeat(80));
  assert.strictEqual(reqTitle("가".repeat(81)), "가".repeat(80) + "…");
  // 빈 입력·공백만 → ""(액션이 "요구 내용을 입력하세요."로 거부한다)
  assert.strictEqual(reqTitle("   \n\t\n"), "");
});

test("관계선 간선 — deps 양방향 + req · 화면 밖은 안 싣는다 (§1 보드 · §비주얼 §17)", async () => {
  const root = newRoot();
  const sfx: Suffixes = { inProgress: "-진행중", done: "-완료" };
  await write(root, "aaaa1111-완료.md", fm({ ticket: "aaaa1111", title: "선행 겸 요구사항" }));
  await write(root, "bbbb2222.md", fm({ ticket: "bbbb2222", title: "후행", deps: "[aaaa1111]" }));
  await write(root, "cccc3333.md", fm({ ticket: "cccc3333", title: "나온 티켓", req: "aaaa1111" }));
  await write(root, "dddd4444.md", fm({ ticket: "dddd4444", title: "화면 밖", deps: "[aaaa1111]" }));
  await write(root, "eeee5555.md", fm({ ticket: "eeee5555", title: "오타", deps: "[zzzz9999]" }));

  const tickets = await listTickets(root, sfx);
  // dddd4444는 필터·검색에 걸려 카드가 없는 상황이다
  const edges = relationEdges(tickets, sfx, new Set(["aaaa1111", "bbbb2222", "cccc3333", "eeee5555"]));
  const of = (s: string) => (edges.get(s) ?? []).map((e) => `${e.kind}:${e.to}`).sort();

  // 선에는 방향이 없다 — 어느 쪽을 호버해도 상대가 나온다. `aaaa1111`은 **완료(met)인데도** 있다
  // (met/unmet으로 거르지 않는다 — 상세 관계 절과 같은 규칙)
  assert.deepStrictEqual(of("bbbb2222"), ["deps:aaaa1111"]);
  assert.deepStrictEqual(of("aaaa1111"), ["deps:bbbb2222", "req:cccc3333"]);
  assert.deepStrictEqual(of("cccc3333"), ["req:aaaa1111"]); // req는 deps와 갈린다(파선이 된다)
  // 화면 밖 카드와 큐에 없는 해시는 간선이 아니다 — 그릴 상대가 없다
  assert.strictEqual(edges.has("dddd4444"), false);
  assert.deepStrictEqual(of("aaaa1111").filter((e) => e.endsWith("dddd4444")), []);
  assert.deepStrictEqual(of("eeee5555"), []);
});
