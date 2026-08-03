import { test } from "node:test";
import assert from "node:assert";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findTranscript, lastActivity, recordToEvents, sessionIdOf, tailEvents } from "./transcript.ts";
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
