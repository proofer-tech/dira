/** 패리티 테스트 — listTickets()의 판정이 `tickets.py`와 같은지.
 *
 *  같은 픽스처 큐에 대해 `python3 tickets.py list <픽스처>`의 출력과, listTickets() 결과를
 *  같은 형식으로 찍은 문자열을 **글자 단위로** 비교한다. 눈으로 맞추지 않는다. */
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTickets, type Suffixes, type Ticket } from "./queue.ts";

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
