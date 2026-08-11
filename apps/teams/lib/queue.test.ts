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
  DUE_DEMOTE_MS,
  DUE_ESCALATE_MS,
  HIDE_DONE_STATUSES,
  archivedBy,
  archivesOf,
  awaitingOf,
  awaitingUnlocked,
  derivedFrom,
  dueAlertOf,
  filterTickets,
  findPath,
  fixesOf,
  inDefaultList,
  isAwaiting,
  isDispatchable,
  listTickets,
  openFixTicket,
  queueOrder,
  bodyWithoutQuestions,
  composeAnswer,
  optionsOf,
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

/** tickets.py main()의 `select` 출력 형식(§1-3 §순서). `pySelect`는 §요구사항 왕복 절 근처에
 *  이미 있다(모듈 최상위 함수 선언은 끌어올려지므로 여기서 먼저 불러도 된다). */
function tsSelect(tickets: Ticket[]): string {
  const rows = queueOrder(tickets).filter(isDispatchable);
  return (
    rows
      .map((t) => `${t.path}|${t.hash}|${t.kind}|${t.persona}|${t.priority}|${t.baseline}|${t.effective}`)
      .join("\n") + (rows.length ? "\n" : "")
  );
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
  // §2 §원문의 양끝 — 구분 빈 줄(닫는 `---` 다음 한 줄)과 파일 끝 개행은 본문 글자가 아니다.
  assert.strictEqual(by("aaaa1111").body, "## Goal\n본문이다");

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

// ── 우선순위 (§1-3 §값 · §유효 우선순위 · §순서) ───────────────────────────────

test("우선순위 — 값 파싱: 없음·범위 밖·정수 아님은 3, 정상값은 그대로(§1-3 §값)", async () => {
  const root = newRoot();
  await write(root, "aaaa0001.md", fm({ ticket: "aaaa0001", title: "없음", kind: "work" }));
  await write(
    root,
    "aaaa0002.md",
    fm({ ticket: "aaaa0002", title: "범위 밖", kind: "work", priority: "9" }),
  );
  await write(
    root,
    "aaaa0003.md",
    fm({ ticket: "aaaa0003", title: "정수 아님", kind: "work", priority: "abc" }),
  );
  await write(
    root,
    "aaaa0004.md",
    fm({ ticket: "aaaa0004", title: "정상", kind: "work", priority: "5" }),
  );

  const tickets = await listTickets(root, DEFAULT);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("aaaa0001").priority, 3);
  assert.strictEqual(by("aaaa0002").priority, 3);
  assert.strictEqual(by("aaaa0003").priority, 3);
  assert.strictEqual(by("aaaa0004").priority, 5);
  assert.strictEqual(tsSelect(tickets), pySelect(root));
});

test("우선순위 — 상속: deps 역방향 · 체인 전체 · 순환은 안 멈춘다(§1-3 §유효 우선순위)", async () => {
  const root = newRoot();
  // A(5) deps [B] · B(기본 3) deps [C] · C(기본 3) — 체인을 타고 B·C가 유효 5로 뜬다
  await write(
    root,
    "bbbb0001.md",
    fm({ ticket: "bbbb0001", title: "A", kind: "work", priority: "5", deps: "[bbbb0002]" }),
  );
  await write(
    root,
    "bbbb0002.md",
    fm({ ticket: "bbbb0002", title: "B", kind: "work", deps: "[bbbb0003]" }),
  );
  await write(root, "bbbb0003.md", fm({ ticket: "bbbb0003", title: "C", kind: "work" }));
  // 순환: X deps [Y] · Y deps [X] — 둘 다 기본 3, 무한 재귀 없이 끝난다
  await write(
    root,
    "bbbb0004.md",
    fm({ ticket: "bbbb0004", title: "X", kind: "work", deps: "[bbbb0005]" }),
  );
  await write(
    root,
    "bbbb0005.md",
    fm({ ticket: "bbbb0005", title: "Y", kind: "work", deps: "[bbbb0004]" }),
  );

  // `.wip`도 물려받는다(상태를 안 가린다) — G(5) deps [H]에서 H가 `.wip`이어도 5로 뜬다
  await write(
    root,
    "bbbb0006.md",
    fm({ ticket: "bbbb0006", title: "G", kind: "work", priority: "5", deps: "[bbbb0007]" }),
  );
  await write(
    root,
    "bbbb0007.wip.md",
    fm({ ticket: "bbbb0007", title: "H(.wip)", kind: "work", session_id: "sess-h" }),
  );

  const tickets = await listTickets(root, DEFAULT);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("bbbb0001").effective, 5);
  assert.strictEqual(by("bbbb0002").effective, 5); // 체인 1단
  assert.strictEqual(by("bbbb0003").effective, 5); // 체인 2단
  assert.strictEqual(by("bbbb0004").effective, 3); // 순환, 안 멈추고 3으로 끝난다
  assert.strictEqual(by("bbbb0005").effective, 3);
  assert.strictEqual(by("bbbb0007").state, "wip");
  assert.strictEqual(by("bbbb0007").effective, 5); // .wip도 상속을 받는다
  // 파일에 안 쓴다 — B·C의 원값은 여전히 3이다
  assert.strictEqual(by("bbbb0002").priority, 3);
  assert.strictEqual(by("bbbb0003").priority, 3);
  assert.strictEqual(tsSelect(tickets), pySelect(root));
});

test("우선순위 — 정렬: (-effective, birth, path) 교차 + 같은 값 안 FIFO(§1-3 §순서)", async () => {
  const root = newRoot();
  // birth 순서: 3,3,3(FIFO 확인) · 1 · 5(가장 늦게 태어남) — 그래도 5가 맨 위에 선다
  await write(root, "cccc0001.md", fm({ ticket: "cccc0001", title: "3-첫", kind: "work" }));
  await write(root, "cccc0002.md", fm({ ticket: "cccc0002", title: "3-둘", kind: "work" }));
  await write(root, "cccc0003.md", fm({ ticket: "cccc0003", title: "3-셋", kind: "work" }));
  await write(
    root,
    "cccc0004.md",
    fm({ ticket: "cccc0004", title: "1", kind: "work", priority: "1" }),
  );
  await write(
    root,
    "cccc0005.md",
    fm({ ticket: "cccc0005", title: "5", kind: "work", priority: "5" }),
  );

  const tickets = await listTickets(root, DEFAULT);
  assert.deepStrictEqual(
    queueOrder(tickets).map((t) => t.hash),
    ["cccc0005", "cccc0001", "cccc0002", "cccc0003", "cccc0004"],
  );
  assert.strictEqual(tsSelect(tickets), pySelect(root));
});

// ── 마감 (§1-4 §값 · §파생 · §전이 · §계산 시점) ────────────────────────────────

// 고정 시각 — 경계(5시간·7일)를 실시계 흔들림 없이 잰다. CLI `select`/`list`는 실시계만 쓰므로
// (tickets.py main()이 `now`를 안 받는다) 이 절의 검증은 pyScanAt로 tickets.py의 `scan()`을
// 같은 now로 직접 불러 대조한다 — 눈으로 안 맞춘다.
const DUE_NOW = new Date(2026, 7, 7, 12, 0, 0); // 로컬, 월은 0-index(8월)
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
const due = (deltaMs: number) => isoLocal(new Date(DUE_NOW.getTime() + deltaMs));

/** tickets.py의 `scan(root, now=...)`을 직접 불러 (hash, priority, baseline, effective)를 받는다. */
function pyScanAt(root: string, now: Date): [string, number, number, number][] {
  const script =
    "import sys, json\n" +
    `sys.path.insert(0, ${JSON.stringify(path.dirname(PY))})\n` +
    "import tickets as T\n" +
    "from datetime import datetime\n" +
    "rows = T.scan(sys.argv[1], now=datetime.fromisoformat(sys.argv[2]))\n" +
    'print(json.dumps([[r["hash"], r["priority"], r["baseline"], r["effective"]] for r in rows]))\n';
  const out = execFileSync("python3", ["-c", script, root, isoLocal(now)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

/** listTickets와 pyScanAt의 baseline·effective가 해시별로 같은지. */
function assertDueParity(tickets: Ticket[], root: string, now: Date, hashes: string[]) {
  const py = new Map(pyScanAt(root, now).map(([h, , baseline, effective]) => [h, { baseline, effective }]));
  for (const h of hashes) {
    const t = tickets.find((x) => x.hash === h)!;
    assert.deepStrictEqual({ baseline: t.baseline, effective: t.effective }, py.get(h), h);
  }
}

test("마감 — 파생 5: ≤5시간(경계 포함)·지난 마감도 5, priority를 덮는다(§1-4 §파생·§값)", async () => {
  const root = newRoot();
  await write(root, "due00001.md", fm({ ticket: "due00001", title: "3", kind: "work", priority: "3" }));
  await write(
    root,
    "due00002.md",
    fm({ ticket: "due00002", title: "1인데 4시간", kind: "work", priority: "1", duedate: due(4 * HOUR) }),
  );
  await write(
    root,
    "due00003.md",
    fm({ ticket: "due00003", title: "경계 정확히 5시간", kind: "work", priority: "2", duedate: due(DUE_ESCALATE_MS) }),
  );
  await write(
    root,
    "due00004.md",
    fm({ ticket: "due00004", title: "지난 마감", kind: "work", priority: "2", duedate: due(-HOUR) }),
  );

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("due00001").effective, 3);
  assert.strictEqual(by("due00002").baseline, 5);
  assert.strictEqual(by("due00002").effective, 5); // 파생 5가 명시값 1을 덮는다
  assert.strictEqual(by("due00003").effective, 5); // 경계(정확히 5시간)도 포함
  assert.strictEqual(by("due00004").effective, 5); // 지난 마감도 5
  assertDueParity(tickets, root, DUE_NOW, ["due00001", "due00002", "due00003", "due00004"]);
});

test("마감 — 파생 1: ≥7일(경계 포함, 자기 duedate 있을 때만)이 priority를 덮고, 가운데는 안 갈린다(§1-4 §파생)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00005.md",
    fm({ ticket: "due00005", title: "5인데 8일", kind: "work", priority: "5", duedate: due(8 * DAY) }),
  );
  await write(
    root,
    "due00006.md",
    fm({ ticket: "due00006", title: "경계 정확히 7일", kind: "work", priority: "4", duedate: due(DUE_DEMOTE_MS) }),
  );
  await write(
    root,
    "due00007.md",
    fm({ ticket: "due00007", title: "가운데(2일)", kind: "work", priority: "3", duedate: due(2 * DAY) }),
  );
  await write(root, "due00008.md", fm({ ticket: "due00008", title: "마감 없음", kind: "work", priority: "3" }));

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("due00005").baseline, 1);
  assert.strictEqual(by("due00005").effective, 1); // 파생 1이 명시값 5를 덮는다
  assert.strictEqual(by("due00006").effective, 1); // 경계(정확히 7일)도 포함
  assert.strictEqual(by("due00007").baseline, 3); // 5시간 초과~7일 미만은 파생 없음 — 명시값 그대로
  assert.strictEqual(by("due00007").effective, 3);
  assert.strictEqual(by("due00008").effective, 3); // 마감 없는 자리와 안 갈린다
  assertDueParity(tickets, root, DUE_NOW, ["due00005", "due00006", "due00007", "due00008"]);
});

test("마감 — 못 읽는 값(자연어·빈 값)은 마감 없음(§1-4 §값)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00009.md",
    fm({ ticket: "due00009", title: "자연어", kind: "work", priority: "3", duedate: "내일" }),
  );
  await write(
    root,
    "due00010.md",
    fm({ ticket: "due00010", title: "빈 값", kind: "work", priority: "3", duedate: "" }),
  );

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("due00009").effective, 3);
  assert.strictEqual(by("due00010").effective, 3);
  assertDueParity(tickets, root, DUE_NOW, ["due00009", "due00010"]);
});

test("마감 — 전이는 급한 쪽(5)으로만 deps 역방향을 탄다 · 체인 3단(§1-4 §전이)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00011.md",
    fm({ ticket: "due00011", title: "A", kind: "work", duedate: due(3 * HOUR), deps: "[due00012]" }),
  );
  await write(root, "due00012.md", fm({ ticket: "due00012", title: "B", kind: "work", deps: "[due00013]" }));
  await write(root, "due00013.md", fm({ ticket: "due00013", title: "C", kind: "work", deps: "[due00014]" }));
  await write(root, "due00014.md", fm({ ticket: "due00014", title: "D", kind: "work" }));

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  for (const h of ["due00011", "due00012", "due00013", "due00014"]) assert.strictEqual(by(h).effective, 5, h);
  assertDueParity(tickets, root, DUE_NOW, ["due00011", "due00012", "due00013", "due00014"]);
});

test("마감 — 강등(1)은 전이하지 않는다(§1-4 §전이)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00015.md",
    fm({ ticket: "due00015", title: "A(느긋)", kind: "work", duedate: due(10 * DAY), deps: "[due00016]" }),
  );
  await write(root, "due00016.md", fm({ ticket: "due00016", title: "B(급함)", kind: "work", priority: "5" }));

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("due00015").effective, 1); // 자기 자신은 강등된다
  assert.strictEqual(by("due00016").effective, 5); // 강등이 전이됐으면 5 밑으로 떨어졌을 값
  assertDueParity(tickets, root, DUE_NOW, ["due00015", "due00016"]);
});

test("마감 — now가 인자다: 같은 큐에 다른 now 둘을 주면 값이 갈린다(§1-4 §계산 시점)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00017.md",
    fm({ ticket: "due00017", title: "근접이면 5, 멀면 3", kind: "work", priority: "3", duedate: due(4 * HOUR) }),
  );

  const near = await listTickets(root, DEFAULT, DUE_NOW);
  const far = await listTickets(root, DEFAULT, new Date(DUE_NOW.getTime() - 2 * DAY));
  assert.strictEqual(near.find((t) => t.hash === "due00017")!.effective, 5);
  assert.strictEqual(far.find((t) => t.hash === "due00017")!.effective, 3);
});

test("마감 — effectiveDue는 노출된 값이고, 전이 체인에서도 자기 duedate와 같다(§1-4 §읽기 미러)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00018.md",
    fm({ ticket: "due00018", title: "A", kind: "work", duedate: due(3 * HOUR), deps: "[due00019]" }),
  );
  await write(root, "due00019.md", fm({ ticket: "due00019", title: "B(전이만 있다)", kind: "work" }));
  await write(root, "due00020.md", fm({ ticket: "due00020", title: "마감 없음", kind: "work" }));

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  const ownDue = new Date(DUE_NOW.getTime() + 3 * HOUR).getTime();
  assert.strictEqual(by("due00018").effectiveDue?.getTime(), ownDue);
  assert.strictEqual(by("due00019").effectiveDue?.getTime(), ownDue); // 유효 우선순위와 같은 전이
  assert.strictEqual(by("due00020").effectiveDue, null);
});

test("마감 — 종 항목 ⑦ 판정 둘: 지난 마감 · 5시간 안 dep 막힘, 그 밖은 null(§1-4 §종 항목 ⑦)", async () => {
  const root = newRoot();
  await write(root, "due00021.md", fm({ ticket: "due00021", title: "지남", kind: "work", duedate: due(-HOUR) }));
  await write(
    root,
    "due00022.md",
    fm({ ticket: "due00022", title: "막힘", kind: "work", duedate: due(2 * HOUR), deps: "[due00099]" }),
  );
  await write(root, "due00023.md", fm({ ticket: "due00023", title: "안 막힘", kind: "work", duedate: due(2 * HOUR) }));
  await write(
    root,
    "due00024.md",
    fm({ ticket: "due00024", title: "멀고 막힘", kind: "work", duedate: due(2 * DAY), deps: "[due00099]" }),
  );
  // `.done`은 판정 대상이 아니다 — 지난 마감이어도 null(§0-10 "`.done`은 안 뜬다").
  await write(root, "due00025.done.md", fm({ ticket: "due00025", title: "완료", kind: "work", duedate: due(-HOUR) }));

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;

  const overdue = dueAlertOf(by("due00021"), DUE_NOW);
  assert.strictEqual(overdue?.overdue, true);

  const blocked = dueAlertOf(by("due00022"), DUE_NOW);
  assert.deepStrictEqual(blocked, { overdue: false, remainingMs: 2 * HOUR, unmetCount: 1 });

  assert.strictEqual(dueAlertOf(by("due00023"), DUE_NOW), null); // 5시간 안이지만 unmet 0
  assert.strictEqual(dueAlertOf(by("due00024"), DUE_NOW), null); // unmet은 있지만 5시간 밖
  assert.strictEqual(dueAlertOf(by("due00025"), DUE_NOW), null); // `.done`
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
  assert.strictEqual(after.body, "본문 BBB");
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
  // §2 §원문의 양끝 — `body`는 구분 빈 줄·끝 개행이 없는 모양으로 준다. `writeTicket`이 되씌운다.
  await writeTicket(before.path, { title: "고친 제목", kind: "feedback", persona: "qa" }, "새 본문");

  const raw = readFileSync(before.path, "utf8");
  // 없던 키는 닫는 `---` 직전에 들어간다(tickets.py set_fm_keys와 같은 자리)
  assert.strictEqual(
    raw,
    "---\nticket: ffff6666\ntitle: 고친 제목\nkind: feedback\nsession_id: sess-x\nowner: developer / w1\nattempts: 2\npersona: qa\n---\n\n새 본문\n",
  );

  const after = (await listTickets(root, DEFAULT))[0];
  assert.strictEqual(after.title, "고친 제목");
  assert.strictEqual(after.kind, "feedback");
  assert.strictEqual(after.persona, "qa");
  assert.strictEqual(after.body, "새 본문");
  assert.strictEqual(after.fm.session_id, "sess-x"); // 엔진이 쓰는 값은 건드리지 않는다
  assert.strictEqual(after.fm.attempts, "2");
  // 쓴 뒤에도 엔진이 같은 판정을 하는가 — 이게 깨지면 GUI 저장이 티켓을 큐에서 지운다
  assert.strictEqual(tsList([after]), pyList(root));
});

test("§2 §원문의 양끝 — body 왕복 무손실: 읽은 값을 그대로 되써도 파일 바이트가 같다", async () => {
  const root = newRoot();
  // 정상 모양 — 닫는 `---` 다음 구분 빈 줄 한 줄 + 본문 + 끝 개행 하나
  const original =
    "---\nticket: rtrp0001\ntitle: 왕복\nkind: work\n---\n\n## Goal\n본문 첫 줄\n본문 둘째 줄\n";
  await write(root, "rtrp0001.md", original);

  const before = (await listTickets(root, DEFAULT))[0];
  // 구분 빈 줄 없이 나온다 — 앞뒤에 `\n`이 안 남는다
  assert.strictEqual(before.body, "## Goal\n본문 첫 줄\n본문 둘째 줄");

  await writeTicket(before.path, { title: before.title }, before.body);
  assert.strictEqual(readFileSync(before.path, "utf8"), original);

  // 본문 첫 줄이 빈 줄인 티켓 — 구분 빈 줄(뗀다) 뒤에 오는 본문 자체의 빈 줄(남는다)
  const withBlankFirstLine =
    "---\nticket: rtrp0002\ntitle: 첫 줄 공백\nkind: work\n---\n\n\n## Goal\n본문이다\n";
  await write(root, "rtrp0002.md", withBlankFirstLine);

  const before2 = (await listTickets(root, DEFAULT)).find((t) => t.hash === "rtrp0002")!;
  assert.strictEqual(before2.body, "\n## Goal\n본문이다"); // 본문 자체의 빈 줄은 살아 있다

  await writeTicket(before2.path, { title: before2.title }, before2.body);
  assert.strictEqual(readFileSync(before2.path, "utf8"), withBlankFirstLine);
});

test("writeTicket — undefined는 그 키의 줄을 통째로 지운다(§1-4 §화면 지우기)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00011.md",
    fm({ ticket: "due00011", title: "마감 있음", kind: "work", duedate: due(8 * DAY) }),
  );
  const before = (await listTickets(root, DEFAULT))[0];
  assert.strictEqual(before.fm.duedate, due(8 * DAY));

  // 빈 값(`duedate:`만 남기기)이 아니라 **줄 자체가 없어야** duedateOf가 무경고로 "마감 없음"을
  // 읽는다 — 빈 값으로 두면 WARN을 낸다(§1-4 §값).
  await writeTicket(before.path, { title: before.title, duedate: undefined }, before.body);
  const raw = readFileSync(before.path, "utf8");
  assert.ok(!raw.includes("duedate"), `duedate 줄이 남아 있다: ${raw}`);

  const after = (await listTickets(root, DEFAULT))[0];
  assert.strictEqual(after.fm.duedate, undefined);
  assert.strictEqual(after.baseline, after.priority); // 파생이 없다 = 마감 없음
});

test("effectiveDue — §1-4 유효마감이 Ticket에 실린다(파생 한 줄의 재료)", async () => {
  const root = newRoot();
  await write(
    root,
    "due00012.md",
    fm({ ticket: "due00012", title: "8일 뒤 마감", kind: "work", duedate: due(8 * DAY) }),
  );
  await write(root, "due00013.md", fm({ ticket: "due00013", title: "마감 없음", kind: "work" }));

  const tickets = await listTickets(root, DEFAULT, DUE_NOW);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(by("due00012").effectiveDue?.getTime(), DUE_NOW.getTime() + 8 * DAY);
  assert.strictEqual(by("due00012").baseline, 1); // 8일 ≥ 7일 = 파생 1
  assert.strictEqual(by("due00013").effectiveDue, null);
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

// ── 결정 10 §요구사항 레이어 — optionsOf / composeAnswer (DESIGN.md §결정 10) ───────

/** `optionsOf` — 큐 실측 픽스처 넷(그룹 크기·제목 분포는 §결정 10 §실측 그대로,
 *  본문은 지면상 요약이다). 마지막 질문 절 텍스트 하나만 받는다 — 라운드를 고르는 건 호출부의 일. */
test("optionsOf — 큐 실측 픽스처 넷 (b6fa738b·4301cfd6·2100d54a·089035b0)", () => {
  // b6fa738b: 그룹 4개(3-3-3-2), 제목 `1.`~`4.` — 산문 줄("**내 기본값...**")과 화살표 줄("->")은
  // 목록머리가 아니라서 옵션으로 안 잡힌다(결정 10 ②)
  const b6fa738b = [
    "### 1. 엔진을 고쳐도 되나",
    "",
    "- **(a) 승인.** 순서-게이트-선점 전부 엔진에서.",
    "- **(b) 표시만.** frontmatter + 보드 dot까지.",
    "- **(c) 순서까지만.** 선점은 뺀다.",
    "",
    "**내 기본값: (a).** 이 줄은 목록이 아니다.",
    "",
    "### 2. 5가 선점할 때",
    "",
    "- **(a) 자동으로 끊는다.** 우선순위가 가장 낮은 것을 끊는다.",
    "  -> 이어지는 산문은 화살표라 안 걸린다.",
    "- **(b) 사람이 고른다.** 자동 살해는 없다.",
    "- **(c) 안 끊는다.** 다음에 비는 워커가 무조건 먼저 집는다.",
    "",
    "### 3. deps와 어떻게 상호작용하나",
    "",
    "- **(a) 물려받는다.** 미충족 dep이 기다리는 우선순위를 물려받는다.",
    "- **(b) 잠금만.** deps는 잠그기만 한다.",
    "- **(c) 구분해 보여준다.** 상속된 것을 테두리로 구분한다.",
    "",
    "### 4. 페르소나가 5를 붙일 수 있나",
    "",
    "- **(a) 페르소나는 1~4만.** 5는 사람만.",
    "- **(b) 페르소나도 5까지.** 요구를 글자대로.",
  ].join("\n");
  const groups1 = optionsOf(b6fa738b);
  assert.deepStrictEqual(
    groups1.map((g) => [g.number, g.options.length]),
    [
      ["1.", 3],
      ["2.", 3],
      ["3.", 3],
      ["4.", 2],
    ],
  );
  assert.strictEqual(groups1[0].heading, "1. 엔진을 고쳐도 되나");
  assert.deepStrictEqual(groups1[0].options[0], { letter: "a", label: "승인." });

  // 4301cfd6: 그룹 3개(3-3-2), 제목 `Q1.`~`Q3.`
  const q4301cfd6 = [
    "### Q1. 그릇과 수명",
    "",
    "- **(a) 프로젝트 셸 Alert 네 번째 변종 하나.** 판정 기준 설명.",
    "- **(b) (a) + 워커 화면 행에 실패 배지.** 표시를 더한다.",
    "- **(c) 워커 화면에만 둔다.** 배너를 안 만든다.",
    "",
    "### Q2. 대응",
    "",
    "- **(a) 사유와 복구 시각만 보여준다.** 조작 없음.",
    "- **(b) 일시중지 CTA를 더한다.** 워커 전부를 멈춘다.",
    "- **(c) 복구 시각이 지나면 자동 재개한다.** GUI가 시각을 든다.",
    "",
    "### Q3. 앱을 안 보고 있을 때도 알리나",
    "",
    "- **(a) 안 한다.** 화면 안에서만 보여준다.",
    "- **(b) 알림을 하나 더 붙인다.** 새로 생기면 한 번 알린다.",
  ].join("\n");
  const groups2 = optionsOf(q4301cfd6);
  assert.deepStrictEqual(
    groups2.map((g) => [g.number, g.options.length]),
    [
      ["Q1.", 3],
      ["Q2.", 3],
      ["Q3.", 2],
    ],
  );

  // 2100d54a: 그룹 1개(4), 제목 없음 — 직전 `###`가 없으니 `그룹 1` + 번호 `Q1`
  const q2100d54a = [
    "- **(a) 지금 도는 세션에 실시간으로 말을 건다.** 엔진 수정이 필요하다.",
    "- **(b) 세션은 그대로 두고 티켓에 메모를 붙인다.** 엔진 무수정이다.",
    "- **(c) 세션을 멈추고 메모를 붙여 백로그로 되돌린다.** 즉시 되는 유일한 안이다.",
    "- **(d) 조합.** 예: (c)만 만들고 (b)는 안 만든다.",
  ].join("\n");
  const groups3 = optionsOf(q2100d54a);
  assert.strictEqual(groups3.length, 1);
  assert.strictEqual(groups3[0].heading, "그룹 1");
  assert.strictEqual(groups3[0].number, "Q1");
  assert.strictEqual(groups3[0].options.length, 4);

  // 089035b0: `## 질문` 절 자체가 없는 티켓(`kind: work`) — questionsOf가 빈 배열을 주므로
  // 마지막 라운드 텍스트도 없다. 그 갈래에서 optionsOf는 그룹 0개다(결정 10 ⑨)
  assert.deepStrictEqual(questionsOf("## Goal\n\n하나.\n"), []);
  assert.deepStrictEqual(optionsOf(""), []);

  // 산문 중간의 `(b)`는 목록머리가 아니라서 안 잡힌다(결정 10 ②, `083e3c1c` 실측)
  assert.deepStrictEqual(
    optionsOf("다른 요구의 답을 인용하며 (b) 표시 전용을 문장 안에 쓴다.\n"),
    [],
  );

  // 라벨 60자 자르기(결정 10 ④)
  const long = optionsOf(
    "- **(a) 매우 긴 라벨을 가진 선택지로 육십자보다 더 길게 자르기 동작을 확인하기 위해 일부러 아주 길게 늘려 쓴 문장입니다.** 뒤 설명.",
  );
  assert.strictEqual(long[0].options[0].label.length, 63); // 60자 + "..."
  assert.ok(long[0].options[0].label.endsWith("..."));
});

/** `composeAnswer` — 조립 결과 모양은 §결정 10에 실린 실측 형식과 같다:
 *  `1.(a)` / `2.(a)(b) 덧붙임` / `3. 덧붙임만`. */
test("composeAnswer — 줄머리 번호 + 다중 선택 + 덧붙임 조립 (결정 10 ⑦⑧)", () => {
  assert.strictEqual(
    composeAnswer([
      { number: "1.", letters: ["a"], note: "" },
      { number: "2.", letters: ["a", "b"], note: "알아서 있으면 좋을 곳들에 잘 배정해달라" },
      { number: "3.", letters: [], note: "이건 엔진마다 다를 것 같은데" },
    ]),
    "1.(a)\n2.(a)(b) 알아서 있으면 좋을 곳들에 잘 배정해달라\n3. 이건 엔진마다 다를 것 같은데",
  );
  // 번호가 없는 그룹은 `Q<n>` — optionsOf가 낸 번호를 그대로 받는다
  assert.strictEqual(composeAnswer([{ number: "Q1", letters: ["b"], note: "" }]), "Q1(b)");
  // 다중 선택은 고른 순서와 무관하게 `(a)(b)`로 정렬해 조립한다
  assert.strictEqual(composeAnswer([{ number: "1.", letters: ["b", "a"], note: "" }]), "1.(a)(b)");
  // 고른 것 0 + 덧붙임 0인 그룹은 줄이 안 선다
  assert.strictEqual(
    composeAnswer([
      { number: "1.", letters: [], note: "" },
      { number: "2.", letters: ["a"], note: "" },
    ]),
    "2.(a)",
  );
  // 전부 비면 빈 문자열(호출부가 `답변 달기` 비활성을 판정한다)
  assert.strictEqual(composeAnswer([{ number: "1.", letters: [], note: "  " }]), "");
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
  assert.strictEqual(inDefaultList(by("a2222222"), [], []), false);
  assert.strictEqual(inDefaultList(by("a2222222"), ["answer"], []), true);
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

test("아카이브 티켓은 기본 목록에서 빠지고 persona 필터가 꺼낸다 (§5-3 §표시 규약 ②)", async () => {
  const root = newRoot();
  await write(root, "aaaa1111.done.md", fm({ ticket: "aaaa1111", title: "끝난 일", kind: "work", persona: "developer" }));
  await write(root, "arch0001.md", fm({ ticket: "arch0001", title: "아카이브 — aaaa1111", kind: "work",
    persona: "archive-manager", archives: "aaaa1111" }));

  const tickets = await listTickets(root, DEFAULT);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  const hashes = (ts: Ticket[]) => ts.map((t) => t.hash);
  const none = { kind: [], persona: [], status: [], q: "" };

  // ① 기본 제외 — 카드도 행도 건수도 없다(대상 카드 하단 한 줄로만 선다)
  assert.strictEqual(inDefaultList(by("arch0001"), [], []), false);
  assert.deepStrictEqual(hashes(filterTickets(tickets, none)), ["aaaa1111"]);
  // ② persona 탈출구 — 그 티켓의 persona를 명시하면 뜬다(숨기는 게 아니다)
  assert.strictEqual(inDefaultList(by("arch0001"), [], ["archive-manager"]), true);
  assert.deepStrictEqual(hashes(filterTickets(tickets, { ...none, persona: ["archive-manager"] })), ["arch0001"]);
  // 양방향 해석은 `resolveDep` 그대로다 — `.done` 접미사가 붙은 대상도 stem으로 찾는다
  assert.strictEqual(resolveDep(tickets, archivesOf(by("arch0001")), DEFAULT), by("aaaa1111"));
  assert.deepStrictEqual(hashes(archivedBy(tickets, by("aaaa1111"), DEFAULT)), ["arch0001"]);
});

test("openFixTicket — 0장 · 열림/진행중 1장 · 완료만 세 경우 (§P230 두 번 눌러도 한 장)", async () => {
  const root = newRoot();
  await write(root, "aaaa1111.md", fm({ ticket: "aaaa1111", title: "정리 1", kind: "work",
    persona: "archive-manager", fixes: "ontology-schema" }));
  await write(root, "bbbb2222.done.md", fm({ ticket: "bbbb2222", title: "정리 2(완료)", kind: "work",
    persona: "archive-manager", fixes: "ontology-schema" }));
  await write(root, "cccc3333.md", fm({ ticket: "cccc3333", title: "다른 마커", kind: "work",
    persona: "archive-manager", fixes: "other-marker" }));

  const tickets = await listTickets(root, DEFAULT);
  const by = (h: string) => tickets.find((t) => t.hash === h)!;
  assert.strictEqual(fixesOf(by("aaaa1111")), "ontology-schema");
  assert.strictEqual(fixesOf(by("cccc3333")), "other-marker");

  // ① 열림/진행중 1장 있으면 그것 — 다른 마커는 안 걸린다
  assert.strictEqual(openFixTicket(tickets, "ontology-schema")?.hash, "aaaa1111");

  // ② `.done`만 있으면 null — 버튼이 다시 선다
  const doneOnly = tickets.filter((t) => t.hash !== "aaaa1111");
  assert.strictEqual(openFixTicket(doneOnly, "ontology-schema"), null);

  // ③ 마커 티켓이 0장이면 null
  assert.strictEqual(openFixTicket([], "ontology-schema"), null);
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
