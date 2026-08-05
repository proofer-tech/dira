import { test } from "node:test";
import assert from "node:assert";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findGrokTranscript,
  findStream,
  findTranscript,
  grokCwd,
  lastActivity,
  recordToEvents,
  sessionIdOf,
  tailEvents,
} from "./transcript.ts";
import { expandable } from "./urls.ts";

/** 픽스처는 전부 임시 디렉터리다 — **`~/.claude/projects`를 건드리지 않는다**(§수용조건).
 *  `findTranscript`의 `root` 인자가 그것 하나를 위해 있다. */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-transcript-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const projects = path.join(tmp, "projects");
const UUID = "645a7c59-5d99-4c48-8fbb-2486bb297203";
const UUID2 = "aaaabbbb-cccc-dddd-eeee-ffff00001111";
mkdirSync(path.join(projects, "-Users-hsol-a"), { recursive: true });
mkdirSync(path.join(projects, "-Users-hsol-b"), { recursive: true });
writeFileSync(path.join(projects, "-Users-hsol-a", `${UUID}.jsonl`), "");
writeFileSync(path.join(projects, "-Users-hsol-a", `${UUID2}.jsonl`), "");
writeFileSync(path.join(projects, "-Users-hsol-b", `${UUID2}.jsonl`), ""); // 중복 = 빈 상태

const rec = (o: object) => JSON.stringify(o) + "\n";
/** 레포 루트. **절대경로여야 한다** — `toolSummary`가 `path.isAbsolute(file_path)`일 때만
 *  cwd 기준으로 접으므로, 상대 문자열을 넣으면 227행 `Read` 요약 테스트가 무의미해진다. */
const CWD = path.resolve(import.meta.dirname, "../../..");
/** 이 앱의 레포 기준 상대경로와 그 절대경로. 앱이 옮겨가면 코드에서 고칠 곳은 여기 하나다. */
const APP_DIR = "apps/teams";
const APP_CWD = `${CWD}/${APP_DIR}`;
const assistant = (blocks: unknown[], extra: object = {}) =>
  rec({
    type: "assistant",
    uuid: "u-a",
    timestamp: "2026-07-30T13:55:10.000Z",
    cwd: CWD,
    isSidechain: false,
    message: { role: "assistant", content: blocks },
    ...extra,
  });

// ---------- findTranscript ----------

test("findTranscript — 매치 1개면 경로, 0개·2개 이상이면 null", async () => {
  assert.equal(await findTranscript(UUID, projects), path.join(projects, "-Users-hsol-a", `${UUID}.jsonl`));
  assert.equal(await findTranscript(UUID2, projects), null); // 2개
  assert.equal(await findTranscript("00000000-0000-0000-0000-000000000000", projects), null); // 0개
  assert.equal(await findTranscript(UUID, path.join(tmp, "없는디렉터리")), null);
});

test("findTranscript — UUID 정규식을 통과 못 하면 글롭하기 전에 null (§경로 방어)", async () => {
  for (const bad of [
    "",
    "*",
    "../../../etc/passwd",
    `../-Users-hsol-a/${UUID}`,
    `${UUID}.jsonl`,
    UUID.toUpperCase(),
    `${UUID} `,
    "645a7c59-5d99-4c48-8fbb-2486bb29720", // 한 글자 짧다
  ]) {
    assert.equal(await findTranscript(bad, projects), null, bad);
  }
});

test("sessionIdOf — 따옴표를 벗기고 UUID만 통과시킨다 (§9 빈 상태 갈림길)", () => {
  assert.equal(sessionIdOf({ session_id: UUID }), UUID);
  assert.equal(sessionIdOf({ session_id: `"${UUID}"` }), UUID); // tickets.py의 strip("\"'")과 같다
  assert.equal(sessionIdOf({ session_id: `  '${UUID}'  ` }), UUID);
  assert.equal(sessionIdOf({}), null); // 키 없음 = 세션이 붙은 적 없다 → 절 자체를 감춘다
  for (const bad of ["", "  ", "없음", UUID.toUpperCase(), `../${UUID}`, `${UUID}.jsonl`]) {
    assert.equal(sessionIdOf({ session_id: bad }), null, bad);
  }
});

// ---------- 오프셋 테일 ----------

test("tailEvents — 불완전한 마지막 줄을 버리고 offset을 마지막 개행까지 되돌린다", async () => {
  const f = path.join(tmp, "partial.jsonl");
  const whole = assistant([{ type: "text", text: "두 번째 줄" }]);
  writeFileSync(f, assistant([{ type: "text", text: "첫 줄" }]) + whole.slice(0, 40)); // 중간에서 끊긴다

  const a = await tailEvents(f, 0);
  assert.deepEqual(a.events.map((e) => e.body), ["첫 줄"]); // 잘린 줄은 없다
  assert.equal(a.offset, Buffer.byteLength(assistant([{ type: "text", text: "첫 줄" }])));

  appendFileSync(f, whole.slice(40)); // 나머지가 append된다
  const b = await tailEvents(f, a.offset);
  assert.deepEqual(b.events.map((e) => e.body), ["두 번째 줄"]); // 온전히 한 번 나온다
  assert.equal(b.offset, Buffer.byteLength(assistant([{ type: "text", text: "첫 줄" }]) + whole));

  const c = await tailEvents(f, b.offset);
  assert.deepEqual(c.events, []); // 다시 읽어도 중복되지 않는다
});

test("tailEvents — 온전한 줄이 하나도 없으면 offset이 그대로다", async () => {
  const f = path.join(tmp, "no-newline.jsonl");
  writeFileSync(f, '{"type":"assist');
  assert.deepEqual(await tailEvents(f, 0), { events: [], offset: 0 });
});

test("tailEvents — offset이 파일 크기보다 크면 0부터 다시 읽는다", async () => {
  const f = path.join(tmp, "shrunk.jsonl");
  const line = assistant([{ type: "text", text: "처음부터" }]);
  writeFileSync(f, line);
  const r = await tailEvents(f, 999999);
  assert.deepEqual(r.events.map((e) => e.body), ["처음부터"]);
  assert.equal(r.offset, Buffer.byteLength(line));
});

test("tailEvents — 흘릴 수 없는 레코드를 조용히 건너뛴다. 던지지 않는다", async () => {
  const f = path.join(tmp, "junk.jsonl");
  writeFileSync(
    f,
    // 이 `enqueue`는 **첫 줄이라서** 안 나온다(§2-1 · 아래 참견 절). 종류가 안 흘려서가 아니다
    rec({ type: "queue-operation", operation: "enqueue", timestamp: "2026-07-30T13:00:00Z", content: "x" }) +
      rec({ type: "attachment", timestamp: "2026-07-30T13:00:01Z", attachment: { type: "hook_success" } }) +
      rec({ type: "last-prompt", timestamp: "2026-07-30T13:00:02Z" }) +
      rec({ type: "assistant", uuid: "no-ts", message: { role: "assistant", content: [{ type: "text", text: "타임스탬프 없음" }] } }) +
      "{ 파싱 불가능한 줄\n" +
      "\n" +
      rec({ type: "unknown-future-type", timestamp: "2026-07-30T13:00:03Z" }) +
      assistant([{ type: "text", text: "살아남는다" }]),
  );
  const r = await tailEvents(f, 0);
  assert.deepEqual(r.events.map((e) => e.body), ["살아남는다"]);
});

// ---------- 방금 한 일 (§1-1 · lastActivity) ----------

test("lastActivity — 마지막이 tool_result·thinking이어도 그 앞의 tool_use를 준다", async () => {
  const f = path.join(tmp, "last-tool-use.jsonl");
  writeFileSync(
    f,
    assistant([{ type: "text", text: "먼저 읽어 본다" }]) +
      assistant([{ type: "tool_use", name: "Read", input: { file_path: `${APP_CWD}/lib/queue.ts` } }]) +
      rec({
        type: "user",
        uuid: "u-r",
        timestamp: "2026-07-30T13:55:11.000Z",
        message: { role: "user", content: [{ type: "tool_result", content: "300줄" }] },
      }) +
      assistant([{ type: "thinking", thinking: "생각 중" }]),
  );
  const e = await lastActivity(f);
  assert.equal(e?.kind, "tool_use");
  assert.equal(e?.label, "Read");
  assert.equal(e?.summary, `${APP_DIR}/lib/queue.ts`); // §9 서체 판정도 그대로 실려 온다
  assert.equal(e?.summaryMono, true);
});

test("lastActivity — 같은 레코드 안에서는 뒤 블록이 이긴다. 사용자 프롬프트는 히트가 아니다", async () => {
  const f = path.join(tmp, "last-in-record.jsonl");
  writeFileSync(
    f,
    assistant([
      { type: "thinking", thinking: "먼저 생각" },
      { type: "text", text: "이제 고친다" },
      { type: "tool_use", name: "Bash", input: { description: "테스트를 돌린다" } },
    ]) + rec({ type: "user", uuid: "u-p", timestamp: "2026-07-30T13:56:00.000Z", message: { role: "user", content: "사람이 말했다" } }),
  );
  const e = await lastActivity(f);
  assert.equal(e?.kind, "tool_use");
  assert.equal(e?.label, "Bash");
  assert.equal(e?.summary, "테스트를 돌린다");
  assert.equal(e?.summaryMono, false); // `description`은 읽는 문장이라 sans
});

test("lastActivity — 히트 0이면 null (읽을 파일이 없어도 null)", async () => {
  const only = path.join(tmp, "no-hit.jsonl");
  // 거르는 넷만 있는 파일: thinking · tool_result · 참견 · 사용자 프롬프트
  writeFileSync(
    only,
    assistant([{ type: "thinking", thinking: "생각만 했다" }]) +
      rec({
        type: "user",
        uuid: "u-r2",
        timestamp: "2026-07-30T13:57:00.000Z",
        message: { role: "user", content: [{ type: "tool_result", content: "결과만 있다" }] },
      }) +
      ENQ,
  );
  assert.equal(await lastActivity(only), null);
  assert.equal(await lastActivity(path.join(tmp, "없는파일.jsonl")), null); // 읽기 실패도 빈 상태다
  writeFileSync(path.join(tmp, "empty.jsonl"), "");
  assert.equal(await lastActivity(path.join(tmp, "empty.jsonl")), null);
});

test("lastActivity — 요약이 빈 tool_use는 건너뛰고 그 앞의 히트를 준다 (§1-1 §개정)", async () => {
  const f = path.join(tmp, "last-empty-summary.jsonl");
  writeFileSync(
    f,
    assistant([{ type: "tool_use", name: "Read", input: { file_path: `${APP_CWD}/lib/queue.ts` } }]) +
      // `Bash`의 `description`은 옵션이라 자주 없고, `Grep`·`Glob`은 아예 요약을 안 받는다
      assistant([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]) +
      assistant([{ type: "tool_use", name: "Grep", input: { pattern: "x" } }]),
  );
  const e = await lastActivity(f);
  assert.equal(e?.label, "Read"); // 도구 목록이 아니라 *세울 글자가 없다*로 갈린다
  assert.equal(e?.summary, `${APP_DIR}/lib/queue.ts`);
});

test("lastActivity — 한 레코드 안에서 text가 요약 빈 tool_use를 이긴다 (§1-1 §개정)", async () => {
  const f = path.join(tmp, "last-text-wins.jsonl");
  writeFileSync(
    f,
    assistant([
      { type: "text", text: "테스트를 돌려 본다" },
      { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
    ]),
  );
  const e = await lastActivity(f);
  assert.equal(e?.kind, "text");
  assert.equal(e?.body, "테스트를 돌려 본다");
});

test("lastActivity — 깨진 줄·반쪽 줄을 만나도 멈추지 않고 계속 올라간다", async () => {
  const f = path.join(tmp, "last-broken.jsonl");
  const whole = assistant([{ type: "tool_use", name: "Write", input: { file_path: `${APP_CWD}/x.ts` } }]);
  writeFileSync(
    f,
    whole +
      "{ 파싱 불가능한 줄\n" +
      "\n" +
      rec({ type: "unknown-future-type", timestamp: "2026-07-30T13:58:00.000Z" }) +
      // append 중인 반쪽 줄. 개행이 없어서 마지막 배열 원소가 된다
      assistant([{ type: "tool_use", name: "Edit", input: { file_path: `${APP_CWD}/y.ts` } }]).slice(0, 40),
  );
  const e = await lastActivity(f);
  assert.equal(e?.label, "Write"); // 반쪽 `Edit`을 건너뛰고 온전한 그 앞 줄을 준다
  assert.equal(e?.summary, `${APP_DIR}/x.ts`);
});

// ---------- 참견 (§2-2 · §2-1 queue-operation) ----------

/** 실측된 레코드 그대로다 — 세션 `c656ddd2`(§2-2 표 2). `enqueue` = 큐에 들어갔다 /
 *  `remove` = 세션이 집어 갔다. 둘 다 `message`가 없고 `content`·`timestamp`를 자기가 든다. */
const ENQ =
  '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-07-31T14:15:12.860Z","sessionId":"c656ddd2-1e55-4c71-b0a7-7fb6519c6512","content":"참견입니다. 지금 하던 것 멈추고 INTERJECT-OK 라고만 답해."}\n';
const RM =
  '{"type":"queue-operation","operation":"remove","timestamp":"2026-07-31T14:15:17.846Z","sessionId":"c656ddd2-1e55-4c71-b0a7-7fb6519c6512","content":"참견입니다. 지금 하던 것 멈추고 INTERJECT-OK 라고만 답해."}\n';
const INTERJECT = "참견입니다. 지금 하던 것 멈추고 INTERJECT-OK 라고만 답해.";

test("참견 — 첫 enqueue는 안 나오고, 둘째 enqueue만 한 줄, remove는 안 나온다", async () => {
  const f = path.join(tmp, "interject.jsonl");
  // 실측 순서 그대로: 첫 `enqueue`(세션 프롬프트와 같은 글) → 사용자 프롬프트 → 참견 → remove
  const first = rec({
    type: "queue-operation",
    operation: "enqueue",
    timestamp: "2026-07-31T14:14:41.000Z",
    content: "Bash로 `sleep 30` 을 실행하고, 끝나면 SLEPT 라고만 말해.",
  });
  writeFileSync(
    f,
    first +
      rec({
        type: "user",
        uuid: "p1",
        timestamp: "2026-07-31T14:14:41.100Z",
        message: { role: "user", content: "Bash로 `sleep 30` 을 실행하고, 끝나면 SLEPT 라고만 말해." },
      }) +
      ENQ +
      RM +
      assistant([{ type: "text", text: "INTERJECT-OK" }]),
  );

  const r = await tailEvents(f, 0);
  assert.deepEqual(
    r.events.map((e) => [e.kind, e.body]),
    [
      ["prompt", "Bash로 `sleep 30` 을 실행하고, 끝나면 SLEPT 라고만 말해."], // 접힌 세션 프롬프트
      ["interject", INTERJECT], // 둘째 enqueue 하나뿐 — remove는 같은 문장이 두 번 뜬다
      ["text", "INTERJECT-OK"],
    ],
  );
  // 전문 줄이다(§2-1 표: 펼치면 —). label이 비어 있어야 `<FullText>`로 간다
  const [, ij] = r.events;
  assert.deepEqual([ij.label, ij.summary, ij.sidechain], ["", "", false]);
});

test("참견 — 모르는 operation과 content 없는 queue-operation은 조용히 건너뛴다", () => {
  const q = (o: object) => recordToEvents(JSON.parse(rec({ type: "queue-operation", timestamp: "2026-07-31T14:15:12.860Z", ...o }).trim()));
  assert.deepEqual(q({ operation: "dequeue" }), []); // 실측 2443건 — content가 없다
  assert.deepEqual(q({ operation: "enqueue" }), []); // content 없는 enqueue도 실측 있다
  assert.deepEqual(q({ operation: "enqueue", content: "" }), []);
  assert.deepEqual(q({ operation: "enqueue", content: " \n\t" }), []); // 공백뿐인 것도 본문 없는 참견 줄이다
  assert.deepEqual(q({ operation: "enqueue", content: 42 }), []);
  assert.deepEqual(q({ operation: "미래에 생길 값", content: "x" }), []);
  assert.deepEqual(q({ content: "x" }), []); // operation 자체가 없다
  assert.deepEqual(recordToEvents(JSON.parse(ENQ.trim())).length, 1); // 레코드 단위로는 흘린다
});

test("참견 — content 없는 첫 enqueue가 뒤의 진짜 참견을 대신 삼키지 않는다", async () => {
  const f = path.join(tmp, "interject-empty-first.jsonl");
  writeFileSync(
    f,
    rec({ type: "queue-operation", operation: "enqueue", timestamp: "2026-07-31T14:14:41.000Z" }) + ENQ,
  );
  const r = await tailEvents(f, 0);
  assert.deepEqual(r.events.map((e) => e.body), [INTERJECT]);
});

test("참견 — 하니스가 스스로 밀어 넣은 봉투는 참견이 아니다", () => {
  const enq = (content: string) =>
    recordToEvents(
      JSON.parse(rec({ type: "queue-operation", operation: "enqueue", timestamp: "2026-07-31T14:15:12.860Z", content }).trim()),
    );
  // 실측: 이 레포의 워커 세션 `e0d418fd`에 4건(백그라운드 Bash 완료). 사람은 아무 말도 안 했다
  assert.deepEqual(enq("<task-notification>\n<task-id>b1nf18pf5</task-id>\n</task-notification>"), []);
  assert.deepEqual(enq("<observed_from_primary_session>\n  <what_happened>Bash</what_happened>\n"), []);
  // 사람 글은 그대로 흐른다 — 꺾쇠로 시작해도 첫 줄이 여는 태그 하나가 아니면 참견이다
  assert.equal(enq("<div>이 태그 왜 이래요?")[0]?.body, "<div>이 태그 왜 이래요?");
  assert.equal(enq(INTERJECT)[0]?.kind, "interject");
});

test("참견 — 이어 읽기(offset>0)에서는 첫 enqueue 규칙이 다시 걸리지 않는다", async () => {
  const f = path.join(tmp, "interject-tail.jsonl");
  const head = assistant([{ type: "text", text: "먼저" }]);
  writeFileSync(f, head + ENQ);
  const r = await tailEvents(f, Buffer.byteLength(head)); // 머리는 이미 지나갔다
  assert.deepEqual(r.events.map((e) => [e.kind, e.body]), [["interject", INTERJECT]]);
});

test("tailEvents — 트랜스크립트가 없으면 빈 상태다", async () => {
  assert.deepEqual(await tailEvents(path.join(tmp, "없는파일.jsonl"), 12), { events: [], offset: 12 });
});

// ---------- 사건 매핑 (§2-1 표) ----------

test("사건 매핑 — Bash는 description, 파일 도구는 상대경로, 모르는 도구는 도구명만", () => {
  const [bash, read, glob] = recordToEvents(
    JSON.parse(
      assistant([
        { type: "tool_use", name: "Bash", input: { command: "ls -l", description: "티켓 파일 찾기" } },
        { type: "tool_use", name: "Read", input: { file_path: `${APP_CWD}/lib/queue.ts` } },
        { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
      ]).trim(),
    ),
  );
  assert.deepEqual([bash.label, bash.summary], ["Bash", "티켓 파일 찾기"]);
  assert.equal(bash.body, '{\n  "command": "ls -l",\n  "description": "티켓 파일 찾기"\n}');
  assert.deepEqual([read.label, read.summary], ["Read", `${APP_DIR}/lib/queue.ts`]);
  assert.deepEqual([glob.label, glob.summary], ["Glob", ""]); // 인자를 추측해 넣지 않는다
  // §9 서체: 경로는 리터럴(mono), `description`은 읽는 문장(sans)
  assert.deepEqual([bash.summaryMono, read.summaryMono, glob.summaryMono], [false, true, false]);
});

test("사건 매핑 — cwd 밖 파일은 전체 경로가 남는다", () => {
  const [e] = recordToEvents(
    JSON.parse(assistant([{ type: "tool_use", name: "Edit", input: { file_path: "/etc/hosts" } }]).trim()),
  );
  assert.equal(e.summary, "/etc/hosts");
});

test("사건 매핑 — thinking·tool_result는 크기가 있고 원문이 함께 온다", () => {
  const [think] = recordToEvents(
    JSON.parse(assistant([{ type: "thinking", thinking: "가나다라마", signature: "x" }]).trim()),
  );
  assert.deepEqual([think.kind, think.label, think.summary, think.body], [
    "thinking",
    "생각",
    "5자",
    "가나다라마",
  ]);

  // 본문이 암호화된 thinking(실측 91개 중 86개)도 줄은 흘린다 — 크기만 감춘다
  const [blank] = recordToEvents(
    JSON.parse(assistant([{ type: "thinking", thinking: "", signature: "CAIS…" }]).trim()),
  );
  assert.deepEqual([blank.kind, blank.label, blank.summary, blank.body], ["thinking", "생각", "", ""]);

  const [result] = recordToEvents(
    JSON.parse(
      rec({
        type: "user",
        uuid: "u-r",
        timestamp: "2026-07-30T13:55:11.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "a\nb\nc\n" }],
        },
      }).trim(),
    ),
  );
  assert.deepEqual([result.kind, result.label, result.summary, result.body], [
    "tool_result",
    "결과",
    "3줄",
    "a\nb\nc\n",
  ]);
});

test("어포던스 — 빈 본문 줄은 펼칠 수 없고, 있는 쪽은 그대로다", () => {
  const think = (t: string) =>
    recordToEvents(JSON.parse(assistant([{ type: "thinking", thinking: t, signature: "x" }]).trim()))[0];

  // 있는 본문: §2-1 표 그대로 `생각 n자` + 펼치면 원문
  const full = think("가나다라마");
  assert.deepEqual([full.label, full.summary, full.body], ["생각", "5자", "가나다라마"]);
  assert.equal(expandable(full), true);

  // 빈 본문(암호화된 thinking — 실측 75/75): 줄은 흐르되 셰브런·<details>가 없다.
  // 이게 참으로 뒤집히면 화면에 **열리는 빈 상자**가 돌아온다(20f3d308).
  const blank = think("");
  assert.equal(blank.label, "생각"); // 줄 자체는 계속 흐른다
  assert.equal(expandable(blank), false);
});

test("사건 매핑 — tool_result의 블록 배열도 접힌다 (실측: text·image·tool_reference)", () => {
  const [e] = recordToEvents(
    JSON.parse(
      rec({
        type: "user",
        uuid: "u-b",
        timestamp: "2026-07-30T13:55:12.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              content: [
                { type: "text", text: "본문" },
                { type: "image", source: { type: "base64", data: "iVBOR" } },
                { type: "tool_reference", tool_name: "mcp__x__y" },
              ],
            },
          ],
        },
      }).trim(),
    ),
  );
  assert.equal(e.body, "본문\n[image]\n[mcp__x__y]"); // base64를 스트림에 붓지 않는다
  assert.equal(e.summary, "3줄");
});

test("사건 매핑 — assistant text는 접히지 않는다(label이 비어 있다)", () => {
  const [e] = recordToEvents(JSON.parse(assistant([{ type: "text", text: "I'll start." }]).trim()));
  assert.deepEqual([e.kind, e.label, e.summary, e.body], ["text", "", "", "I'll start."]);
});

test("사건 매핑 — 첫 사용자 프롬프트만 접힌다", async () => {
  const f = path.join(tmp, "prompt.jsonl");
  const prompt = (uuid: string, text: string) =>
    rec({ type: "user", uuid, timestamp: "2026-07-30T13:55:00.000Z", message: { role: "user", content: text } });
  writeFileSync(f, prompt("p1", "가나다") + assistant([{ type: "text", text: "네" }]) + prompt("p2", "그 다음"));

  const r = await tailEvents(f, 0);
  const [first, , second] = r.events;
  assert.deepEqual([first.kind, first.label, first.summary, first.body], [
    "prompt",
    "세션 프롬프트",
    "3자",
    "가나다",
  ]);
  assert.deepEqual([second.kind, second.label, second.body], ["prompt", "", "그 다음"]);

  // offset > 0으로 이어 읽으면 세션 프롬프트는 이미 지나갔으므로 접지 않는다
  const mid = Buffer.byteLength(prompt("p1", "가나다") + assistant([{ type: "text", text: "네" }]));
  const cont = await tailEvents(f, mid);
  assert.deepEqual([cont.events[0].label, cont.events[0].body], ["", "그 다음"]);
});

test("사건 매핑 — isSidechain에 표시가 붙는다", () => {
  const [sub] = recordToEvents(
    JSON.parse(assistant([{ type: "text", text: "서브다" }], { isSidechain: true }).trim()),
  );
  assert.equal(sub.sidechain, true);
  const [main] = recordToEvents(JSON.parse(assistant([{ type: "text", text: "본류다" }]).trim()));
  assert.equal(main.sidechain, false);
});

test("사건 매핑 — 한 assistant 레코드의 블록들이 순서대로 사건이 된다", () => {
  const evs = recordToEvents(
    JSON.parse(
      assistant([
        { type: "thinking", thinking: "음" },
        { type: "text", text: "합니다" },
        { type: "tool_use", name: "Bash", input: { command: "ls", description: "목록" } },
      ]).trim(),
    ),
  );
  assert.deepEqual(evs.map((e) => e.kind), ["thinking", "text", "tool_use"]);
  assert.deepEqual(evs.map((e) => e.key), ["u-a:0", "u-a:1", "u-a:2"]); // 키가 겹치지 않는다
  assert.deepEqual(new Set(evs.map((e) => e.ts)), new Set(["2026-07-30T13:55:10.000Z"])); // UTC 그대로
});

test("사건 매핑 — 깨진 입력에도 던지지 않는다", () => {
  for (const bad of [null, undefined, 42, "문자열", {}, { message: null }, { timestamp: "t" }]) {
    assert.deepEqual(recordToEvents(bad), []);
  }
  assert.deepEqual(
    recordToEvents({ type: "assistant", timestamp: "t", message: { role: "assistant", content: [null, 7, {}] } }),
    [],
  );
});

// ---------- grok — 출처 하나가 는다 (§4-3 §grok §세션 스트림 · 티켓 30ce9d73) ----------

/** `~/.grok/sessions/<pct-enc cwd>/<sid>/updates.jsonl`. 픽스처도 **같은 이름 규칙**이라
 *  `grokCwd`가 되돌리는 값이 실제 cwd가 된다(도구 요약의 상대경로가 여기서 나온다). */
const GROK_ROOT = path.join(tmp, "grok-sessions");
const GROK_CWD = "/private/tmp/grok-w";
const GROK_SID = "019fcf77-682d-7853-9fa1-21cfae87637e"; // grok이 스스로 만드는 id는 UUIDv7이다
mkdirSync(path.join(GROK_ROOT, encodeURIComponent(GROK_CWD), GROK_SID), { recursive: true });
mkdirSync(path.join(GROK_ROOT, encodeURIComponent("/private/tmp"), UUID), { recursive: true });
const GROK_FILE = path.join(GROK_ROOT, encodeURIComponent(GROK_CWD), GROK_SID, "updates.jsonl");
writeFileSync(GROK_FILE, "");
writeFileSync(path.join(GROK_ROOT, encodeURIComponent("/private/tmp"), UUID, "updates.jsonl"), "");

/** grok 업데이트 한 줄. `timestamp`는 unix **초**이고 키는 `params._meta.eventId`다 */
const gup = (sec: number, eventId: string, update: object, method = "session/update") =>
  rec({ timestamp: sec, method, params: { sessionId: GROK_SID, update, _meta: { eventId } } });

test("grokCwd — 규칙은 퍼센트 인코딩이다. claude의 `-` 규칙과 한 함수가 아니다 (§4-3 §grok)", () => {
  assert.equal(encodeURIComponent("/private/tmp/x"), "%2Fprivate%2Ftmp%2Fx"); // 티켓이 적은 그 예
  assert.equal(grokCwd("%2Fprivate%2Ftmp%2Fx"), "/private/tmp/x"); // 우리가 쓰는 방향
  // claude 규칙(`usage.ts:166` — 비영숫자 전부 `-`)은 같은 cwd에 **다른 이름**을 주고 되돌릴 수
  // 없다. 두 규칙이 한 함수가 아니라는 것이 이 한 줄이다.
  assert.equal("/private/tmp/x".replace(/[^a-zA-Z0-9]/g, "-"), "-private-tmp-x");
  assert.equal(grokCwd("%"), undefined); // 홀로 선 `%` — 던지지 않는다
});

test("findGrokTranscript — updates.jsonl 하나일 때만 경로다. UUID 방어는 claude와 같다", async () => {
  assert.equal(await findGrokTranscript(GROK_SID, GROK_ROOT), GROK_FILE);
  assert.equal(await findGrokTranscript("00000000-0000-0000-0000-000000000000", GROK_ROOT), null);
  assert.equal(await findGrokTranscript(GROK_SID, path.join(tmp, "없는디렉터리")), null);
  for (const bad of ["", "*", "../../../etc/passwd", `${GROK_SID}/..`, GROK_SID.toUpperCase()]) {
    assert.equal(await findGrokTranscript(bad, GROK_ROOT), null, bad);
  }
});

test("findStream — 파일이 어느 트리에 있나가 곧 형식이다 (엔진 이름을 안 묻는다)", async () => {
  // 실제 `~`를 보는 함수라 여기서는 **판정 규칙만** 본다: claude 쪽이 잡히면 grok을 안 열고
  // (`grok: false`), 어느 쪽도 없으면 `null`이다. 두 root를 갈아 끼우는 인자가 없는 것이 계약이다
  // (`session_id` 하나만 경로가 된다 — §경로 방어).
  assert.equal(await findStream("00000000-0000-0000-0000-000000000000"), null);
});

test("sessionIdOf — grok의 두 id가 다 통과한다. UUID_RE를 안 고쳤다 (§4-3 §grok)", () => {
  // `tick.sh`가 `uuid.uuid4()`로 만들어 `--session-id`로 주는 값과, grok이 스스로 만드는 UUIDv7.
  // **고칠 필요가 없다**는 것을 단언으로 남긴다 — 못 고치는 것이 아니다.
  assert.equal(sessionIdOf({ session_id: "9e18d96d-e8e0-414a-acf3-ffc3ec33ae8f" }), "9e18d96d-e8e0-414a-acf3-ffc3ec33ae8f");
  assert.equal(sessionIdOf({ session_id: GROK_SID }), GROK_SID); // 019f… = v7
});

test("grok — ACP 청크 다섯이 §2-1의 kind로 접히고 나머지는 건너뛴다", async () => {
  // **실제 자리에 쓴다** — 요약의 상대경로가 디렉터리 이름을 되돌린 cwd에서 나오므로
  // 파일을 아무 데나 두면 그 한 줄이 안 걸린다(`%2Fprivate%2Ftmp%2Fgrok-w/<sid>/updates.jsonl`).
  const f = GROK_FILE;
  writeFileSync(
    f,
    // 대응물 없는 줄 셋이 먼저 온다 — 하나도 사건이 되지 않는다
    gup(1785892150, "e-1", { sessionUpdate: "hook_execution", event_name: "session_start" }, "_x.ai/session/update") +
      gup(1785892151, "e-2", { sessionUpdate: "turn_completed" }, "_x.ai/session/update") +
      gup(1785892152, "e-3", { sessionUpdate: "plan", entries: [] }) +
      gup(1785892158, "e-4", { sessionUpdate: "user_message_chunk", content: { type: "text", text: "가나다" } }) +
      gup(1785892159, "e-5", { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "생각한다" } }) +
      gup(1785892159, "e-6", {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "write",
        rawInput: { file_path: `${GROK_CWD}/target.txt`, content: "done\n" },
        _meta: { "x.ai/tool": { name: "write", label: "Write" } },
      }) +
      gup(1785892160, "e-7", {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        content: [
          { type: "content", content: { type: "text", text: "한 줄\n두 줄" } },
          { type: "diff", path: `${GROK_CWD}/target.txt`, oldText: "", newText: "done\n" },
        ],
      }) +
      gup(1785892163, "e-8", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "DONE" } }),
  );
  const { events } = await tailEvents(f, 0, true);
  assert.deepEqual(events.map((e) => e.kind), [
    "prompt",
    "thinking",
    "tool_use",
    "tool_result",
    "text",
  ]);
  // 키가 `eventId`다 — `timestamp`가 초라서 e-5·e-6이 같은 초에 있다(그것으로는 못 가른다)
  assert.deepEqual(events.map((e) => e.key), ["e-4:0", "e-5:0", "e-6:0", "e-7:0", "e-8:0"]);
  // 첫 프롬프트는 claude와 같은 규칙으로 접힌다
  assert.deepEqual([events[0].label, events[0].summary, events[0].body], ["세션 프롬프트", "3자", "가나다"]);
  assert.deepEqual([events[1].label, events[1].summary], ["생각", "4자"]);
  // 도구 이름표는 `_meta["x.ai/tool"].label`이고, 요약의 상대경로는 **디렉터리 이름을 되돌린 cwd**다
  assert.deepEqual([events[2].label, events[2].summary, events[2].summaryMono], ["Write", "target.txt", true]);
  assert.equal(events[2].body, JSON.stringify({ file_path: `${GROK_CWD}/target.txt`, content: "done\n" }, null, 2));
  assert.deepEqual([events[3].label, events[3].body], ["결과", `한 줄\n두 줄\n${GROK_CWD}/target.txt`]);
  assert.deepEqual([events[4].label, events[4].body], ["", "DONE"]);
});

test("grok — timestamp가 unix 초다. StreamEvent.ts는 종전대로 UTC ISO다", async () => {
  const f = path.join(tmp, "grok-ts.jsonl");
  writeFileSync(
    f,
    gup(1785892158, "t-1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "초" } }) +
      // 숫자가 아닌·말이 안 되는 `timestamp`는 건너뛴다(claude의 `timestamp` 없음과 같은 자리)
      gup(Number.NaN, "t-2", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "NaN" } }) +
      rec({ timestamp: "2026-08-05T01:00:00Z", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "문자열" } } } }),
  );
  const { events } = await tailEvents(f, 0, true);
  assert.deepEqual(events.map((e) => e.body), ["초"]);
  assert.equal(events[0].ts, "2026-08-05T01:09:18.000Z"); // 1785892158초의 UTC ISO
});

test("grok — 깨진 꼬리 줄을 버리고 offset을 되돌린다 (계약이 grok 경로에서도 참이다)", async () => {
  const f = path.join(tmp, "grok-partial.jsonl");
  const head = gup(1785892158, "p-1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "첫 줄" } });
  const whole = gup(1785892159, "p-2", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "두 번째 줄" } });
  writeFileSync(f, head + whole.slice(0, 60)); // 중간에서 끊긴다

  const a = await tailEvents(f, 0, true);
  assert.deepEqual(a.events.map((e) => e.body), ["첫 줄"]);
  assert.equal(a.offset, Buffer.byteLength(head)); // 잘린 줄 앞으로 되돌아왔다

  appendFileSync(f, whole.slice(60));
  const b = await tailEvents(f, a.offset, true);
  assert.deepEqual(b.events.map((e) => e.body), ["두 번째 줄"]); // 온전히 한 번 나온다
  assert.deepEqual((await tailEvents(f, b.offset, true)).events, []); // 중복되지 않는다
});

// ---------- claude 스트림 무회귀 (개정 전후로 배열이 같다) ----------

/** 개정 **전** 코드가 이 픽스처에서 낸 `tailEvents` 결과 전문이다(사건 7 · offset 1148).
 *  손으로 적은 기댓값이 아니라 **개정 직전 커밋이 실제로 낸 출력**이라, 여기 한 글자가 갈리면
 *  grok을 붙이면서 claude 줄을 밟았다는 뜻이다. cwd가 실제로 없는 절대경로인 것은 의도다 —
 *  `toolSummary`는 `path.isAbsolute`만 보고 fs를 안 만지므로 이 골든이 머신에 안 매인다. */
const CLAUDE_CWD = "/Users/hsol/Projects/dira";
const CLAUDE_FIXTURE =
  rec({ type: "queue-operation", operation: "enqueue", timestamp: "2026-08-05T01:00:00.000Z", content: "세션 프롬프트다" }) +
  rec({ type: "user", uuid: "u0", timestamp: "2026-08-05T01:00:01.000Z", cwd: CLAUDE_CWD, message: { role: "user", content: "세션 프롬프트다" } }) +
  rec({ type: "assistant", uuid: "u1", timestamp: "2026-08-05T01:00:02.000Z", cwd: CLAUDE_CWD, isSidechain: true, message: { role: "assistant", content: [
    { type: "thinking", thinking: "생각한다" },
    { type: "text", text: "말한다" },
    { type: "tool_use", name: "Bash", input: { command: "ls", description: "목록을 본다" } },
    { type: "tool_use", name: "Read", input: { file_path: `${CLAUDE_CWD}/apps/teams/lib/transcript.ts` } },
  ] } }) +
  rec({ type: "user", uuid: "u2", timestamp: "2026-08-05T01:00:03.000Z", cwd: CLAUDE_CWD, message: { role: "user", content: [
    { type: "tool_result", content: [{ type: "text", text: "a\nb" }, { type: "image" }] },
  ] } }) +
  rec({ type: "queue-operation", operation: "enqueue", timestamp: "2026-08-05T01:00:04.000Z", content: "사람이 참견한다" }) +
  rec({ type: "unknown-future", timestamp: "2026-08-05T01:00:05.000Z" });

const CLAUDE_GOLDEN = [
  { key: "u0:0", ts: "2026-08-05T01:00:01.000Z", sidechain: false, kind: "prompt", label: "세션 프롬프트", summary: "8자", body: "세션 프롬프트다", summaryMono: false },
  { key: "u1:0", ts: "2026-08-05T01:00:02.000Z", sidechain: true, kind: "thinking", label: "생각", summary: "4자", body: "생각한다", summaryMono: false },
  { key: "u1:1", ts: "2026-08-05T01:00:02.000Z", sidechain: true, kind: "text", label: "", summary: "", body: "말한다", summaryMono: false },
  { key: "u1:2", ts: "2026-08-05T01:00:02.000Z", sidechain: true, kind: "tool_use", label: "Bash", summary: "목록을 본다", summaryMono: false, body: '{\n  "command": "ls",\n  "description": "목록을 본다"\n}' },
  { key: "u1:3", ts: "2026-08-05T01:00:02.000Z", sidechain: true, kind: "tool_use", label: "Read", summary: "apps/teams/lib/transcript.ts", summaryMono: true, body: `{\n  "file_path": "${CLAUDE_CWD}/apps/teams/lib/transcript.ts"\n}` },
  { key: "u2:0", ts: "2026-08-05T01:00:03.000Z", sidechain: false, kind: "tool_result", label: "결과", summary: "3줄", body: "a\nb\n[image]", summaryMono: false },
  { key: "2026-08-05T01:00:04.000Z:q", ts: "2026-08-05T01:00:04.000Z", kind: "interject", label: "", summary: "", summaryMono: false, body: "사람이 참견한다", sidechain: false },
];

test("claude 스트림 무회귀 — 개정 전 골든과 사건 배열·offset이 한 글자도 안 갈린다", async () => {
  const f = path.join(tmp, "claude-golden.jsonl");
  writeFileSync(f, CLAUDE_FIXTURE);
  const r = await tailEvents(f, 0);
  assert.deepEqual(r.events, CLAUDE_GOLDEN);
  assert.equal(r.offset, Buffer.byteLength(CLAUDE_FIXTURE));
  assert.equal(r.offset, 1148); // 개정 전 실측값
  // 세 번째 인자를 안 주면 claude다 — `grok: false`가 기본값인 것이 무회귀의 근거다
  assert.deepEqual((await tailEvents(f, 0, false)).events, CLAUDE_GOLDEN);
});

test("grok — 본문 없는 tool_call_update는 안 흘린다 (`결과 · 0줄`이 스트림을 덮는다)", async () => {
  const f = path.join(tmp, "grok-empty-update.jsonl");
  writeFileSync(
    f,
    // 실측 모양: 한 호출에 갱신이 여러 번 오고 상태만 바뀐 줄은 `content`가 없다
    gup(1785892159, "s-1", { sessionUpdate: "tool_call_update", toolCallId: "c1" }) +
      gup(1785892159, "s-2", { sessionUpdate: "tool_call_update", toolCallId: "c1", content: [] }) +
      gup(1785892160, "s-3", { sessionUpdate: "tool_call_update", toolCallId: "c1", content: [{ type: "content", content: { type: "text", text: "  " } }] }) +
      gup(1785892161, "s-4", { sessionUpdate: "tool_call_update", toolCallId: "c1", content: [{ type: "content", content: { type: "text", text: "진짜 출력" } }] }),
  );
  const { events } = await tailEvents(f, 0, true);
  assert.deepEqual(events.map((e) => [e.key, e.summary, e.body]), [["s-4:0", "1줄", "진짜 출력"]]);
});
