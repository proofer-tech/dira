import { test } from "node:test";
import assert from "node:assert";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findTranscript, recordToEvents, tailEvents } from "./transcript.ts";

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
const CWD = "/Users/hsol/Projects/fs-tickets/.fs-tickets/worktrees/w5";
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

test("tailEvents — 트랜스크립트가 없으면 빈 상태다", async () => {
  assert.deepEqual(await tailEvents(path.join(tmp, "없는파일.jsonl"), 12), { events: [], offset: 12 });
});

// ---------- 사건 매핑 (§2-1 표) ----------

test("사건 매핑 — Bash는 description, 파일 도구는 상대경로, 모르는 도구는 도구명만", () => {
  const [bash, read, glob] = recordToEvents(
    JSON.parse(
      assistant([
        { type: "tool_use", name: "Bash", input: { command: "ls -l", description: "티켓 파일 찾기" } },
        { type: "tool_use", name: "Read", input: { file_path: `${CWD}/gui/lib/queue.ts` } },
        { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
      ]).trim(),
    ),
  );
  assert.deepEqual([bash.label, bash.summary], ["Bash", "티켓 파일 찾기"]);
  assert.equal(bash.body, '{\n  "command": "ls -l",\n  "description": "티켓 파일 찾기"\n}');
  assert.deepEqual([read.label, read.summary], ["Read", "gui/lib/queue.ts"]);
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
