import { test } from "node:test";
import assert from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 락 디렉터리(~/.config/dira/run)도 진짜 레지스트리도 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "ha-local-"));
process.env.TICKET_LOCAL = LOCAL;
// **`~`도 옮긴다** — 아래 왕복 테스트가 `findTranscript`(= `$HOME/.claude/projects/*`)를 그대로
// 타야 흐르는 답과 정본이 갈리는 자리를 진짜로 잰다. 사람의 트랜스크립트 864개를 안 밟는다.
const HOME = mkdtempSync(path.join(tmpdir(), "ha-home-"));
process.env.HOME = HOME;
const TRANSCRIPTS = path.join(HOME, ".claude", "projects", "fake-cwd");
mkdirSync(TRANSCRIPTS, { recursive: true });

const {
  renderSnapshot,
  buildPrompt,
  questionOf,
  toTurns,
  ask,
  startAsk,
  stopAsk,
  pollHome,
  isAsking,
  sessionsPath,
  readSessionId,
  readHome,
  newConversation,
  switchConversation,
  TOOL_FLAGS,
} = await import("./home-agent.ts");
type HomeChunk = Awaited<ReturnType<typeof pollHome>>;
const { tailEvents } = await import("./transcript.ts");
const { resolveConfig } = await import("./projects.ts");
const { listTickets } = await import("./queue.ts");
const { listWorkers, lockPath } = await import("./workers.ts");

const tmps: string[] = [LOCAL, HOME];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** 워커 2개 · 티켓 4건짜리 임시 큐. w1은 살아 있는 락을 쥐고 `.wip` 티켓 하나를 물고 있다. */
function fixture() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "ha-proj-")), ".dira");
  tmps.push(path.dirname(root));
  const workers = path.join(root, "workers");
  const tickets = path.join(root, "tickets");
  mkdirSync(workers, { recursive: true });
  mkdirSync(tickets, { recursive: true });

  // w1은 엔진 대입이 있고(opus), w2는 없다(= tick.sh 기본값 · `기본값 가정`)
  writeFileSync(
    path.join(workers, "w1.sh"),
    '#!/bin/bash\nTICKET_ENGINE=(claude -p --session-id "{sid}" --dangerously-skip-permissions' +
      " --model opus --input-format stream-json --output-format stream-json --verbose)\n" +
      `TICKET_CWD=${path.dirname(root)}\n. /nowhere/tick.sh\n`,
  );
  writeFileSync(path.join(workers, "w2.sh"), `#!/bin/bash\nTICKET_CWD=${path.dirname(root)}\n. /nowhere/tick.sh\n`);

  // 살아 있는 락 = running (이 테스트 프로세스의 pid)
  const lock = lockPath(workers, "w1");
  mkdirSync(lock, { recursive: true });
  writeFileSync(path.join(lock, "pid"), String(process.pid));

  const put = (name: string, fm: string, body: string) =>
    writeFileSync(path.join(tickets, name), `---\n${fm}---\n\n${body}\n`);
  put(
    "aaaa0001.wip.md",
    "ticket: aaaa0001\ntitle: 홈 에이전트 실행층\nkind: work\npersona: developer\nowner: developer / w1-deadbeef\n",
    "본문\n",
  );
  put("aaaa0002.md", "ticket: aaaa0002\ntitle: 열린 티켓\nkind: work\npersona: qa\n", "본문\n");
  put(
    "aaaa0003.md",
    "ticket: aaaa0003\ntitle: 답변 대기\nkind: request\npersona: pm\nawaiting: aaaa0009\ndeps: [aaaa0009]\n",
    "본문\n",
  );
  put("aaaa0004.done.md", "ticket: aaaa0004\ntitle: 끝난 티켓\nkind: work\npersona: developer\n", "본문\n");
  return root;
}

test("renderSnapshot — 임시 큐 픽스처의 워커 이름·상태·엔진·티켓 3수가 그대로 들어간다", async () => {
  const root = fixture();
  const project = { name: "테스트큐", root };
  const config = await resolveConfig(project);
  const tickets = await listTickets(root, config);
  const workers = await listWorkers(root, tickets);

  const s = renderSnapshot({ project, config, tickets, workers });

  // ① 워커 이름 둘
  assert.match(s, /\| w1 \|/);
  assert.match(s, /\| w2 \|/);
  // ② running — 살아 있는 락을 쥔 워커. 이게 뒤집히면 "지금 무슨 일을 하나"에 못 답한다
  assert.match(s, /\| w1 \| running \|/);
  // ③ 엔진 — 대입이 있는 쪽은 값이, 없는 쪽은 실제로 도는 기본값 + `기본값 가정`이 뜬다
  assert.match(s, /\| claude · opus \|/);
  assert.match(s, /\| claude \(기본값 가정\) \|/);
  // ④ 물고 있는 티켓 — 해시와 제목 둘 다
  assert.match(s, /aaaa0001 — 홈 에이전트 실행층/);
  // ⑤ 티켓 3수 + 파생 2수
  assert.match(s, /열림 2 · 진행중 1 · 완료 1/);
  assert.match(s, /답변 대기 1건/);
  assert.match(s, /## 티켓 4건/);
  // ⑥ 어디를 보라고 짚는다 — 내용을 복사하지 않는다(§7)
  assert.match(s, /docs\/DESIGN\.md/);
  assert.ok(s.includes(path.join(root, "tickets")));

  // `idle`은 crontab 등록이 조건이라 픽스처로 못 만든다(남의 crontab을 안 건드린다).
  // 라벨 매핑 자체는 순수 함수의 일이므로 상태만 갈아 끼워 확인한다.
  const idle = renderSnapshot({
    project,
    config,
    tickets,
    workers: workers.map((w) => (w.name === "w2" ? { ...w, status: "idle" as const, cron: true } : w)),
  });
  assert.match(idle, /\| w2 \| idle \| 등록 \|/);
});

test("renderSnapshot — 워커 0개도 사실이다 (빈 표 대신 한 줄)", () => {
  const s = renderSnapshot({
    project: { name: "빈큐", root: "/tmp/x/.dira" },
    config: {
      personas: "/tmp/x/.dira/personas",
      protocols: "/tmp/x/.dira/protocols",
      inProgress: ".wip",
      done: ".done",
      cwd: "/tmp/x",
      cwdByWorker: {},
      assumed: [],
      unresolved: [],
      conflicts: [],
    },
    tickets: [],
    workers: [],
  });
  assert.match(s, /## 워커 0개/);
  assert.match(s, /워커가 없다/);
  assert.match(s, /열림 0 · 진행중 0 · 완료 0/);
});

test("buildPrompt — 스냅샷이 질문 앞에 오고 읽기 전용이라는 말이 들어간다", () => {
  const p = buildPrompt("SNAP", "w1이 지금 무슨 일을 하고 있나?");
  assert.ok(p.indexOf("SNAP") < p.indexOf("w1이 지금"));
  assert.match(p, /티켓을 만들지도\n고치지도 않는다/);
});

test("TOOL_FLAGS — 도구 표면을 정하는 세 조각이 다 있다 (89962e56)", () => {
  // `--allowed-tools`는 **도구를 빼지 않는다**(권한 자동승인 목록이다). 이 셋이 빠지면 세션에
  // `Bash`가 살아나고 화면은 자기 가드에 대해 거짓말한다 — 그게 `89962e56` 그 사건이다.
  // 실측 A/B는 `home-agent.ts` 머리 주석에 있다. 값이 아니라 **존재**를 못박는다.
  for (const flag of ["--tools", "--strict-mcp-config", "--permission-mode"]) {
    assert.ok(TOOL_FLAGS.includes(flag), `${flag}가 빠졌다 — 도구 표면이 §7 표보다 넓어진다`);
  }
  // 값은 variadic 함정 때문에 **쉼표 한 토큰**이어야 한다(공백으로 나누면 질문까지 도구로 먹는다)
  assert.strictEqual(TOOL_FLAGS[TOOL_FLAGS.indexOf("--tools") + 1], "Read,Glob,Grep");
  // `--dangerously-skip-permissions`는 §7이 명시적으로 뺀 것이다
  assert.ok(!TOOL_FLAGS.some((f) => f.includes("dangerously")));
});

test("questionOf — 스냅샷·지시문을 떼고 사람이 쓴 질문만 남는다 (§비주얼 §24 말풍선)", () => {
  const q = "w2가 지금 무슨 일을 하고 있나";
  assert.strictEqual(questionOf(buildPrompt(renderSnapshot0(), q)), q);
  // 표식이 없는 글(우리가 안 만든 턴 · 사람이 터미널에서 이어 쓴 질문)은 **전문 그대로**다.
  // 여기서 잘라내면 화면이 그 턴을 통째로 삼킨다.
  assert.strictEqual(questionOf("그냥 물어본 말"), "그냥 물어본 말");
  // 질문 안에 같은 표식이 또 있어도 **첫 번째(우리 것)**에서 갈린다 — 뒤에서 자르면 사람 글이 잘린다
  assert.strictEqual(questionOf(buildPrompt("SNAP", "## 질문\n\n중첩된 글")), "## 질문\n\n중첩된 글");
});

test("toTurns — 트랜스크립트 한 벌에서 대화 줄 두 종만 나온다 (도구·생각 줄 없음)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ha-tr-"));
  tmps.push(dir);
  const file = path.join(dir, "session.jsonl");
  const rec = (o: unknown) => JSON.stringify(o);
  writeFileSync(
    file,
    [
      // ① 첫 질문 — 프롬프트 전체(스냅샷 + 지시문 + 질문)가 한 레코드다
      rec({
        type: "user",
        uuid: "u1",
        timestamp: "2026-08-01T05:00:00.000Z",
        message: { role: "user", content: buildPrompt("SNAP\n## 티켓 4건", "w2는 뭘 하나") },
      }),
      // ② 답 — 한 레코드가 생각 · 도구 · 텍스트를 같이 담는다. 남아야 하는 것은 텍스트뿐이다
      rec({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-08-01T05:00:04.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "" },
            { type: "tool_use", name: "Read", input: { file_path: "/x/y.md" } },
            { type: "text", text: "w2는 `aaaa0001`을 물고 있습니다." },
          ],
        },
      }),
      // ③ 서브에이전트 줄은 대화가 아니라 로그다(§24)
      rec({
        type: "assistant",
        uuid: "a2",
        isSidechain: true,
        timestamp: "2026-08-01T05:00:05.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "서브가 한 말" }] },
      }),
      "",
    ].join("\n"),
  );

  const { events } = await tailEvents(file, 0);
  const turns = toTurns(events);
  assert.deepStrictEqual(
    turns.map((t) => [t.role, t.text]),
    [
      ["question", "w2는 뭘 하나"],
      ["answer", "w2는 `aaaa0001`을 물고 있습니다."],
    ],
  );
  // 키는 사건 키 그대로 — 두 줄이 같은 키를 받으면 폴링이 붙일 때 React가 한 줄을 덮는다
  assert.strictEqual(new Set(turns.map((t) => t.key)).size, 2);
});

/** 위 테스트가 실제 스냅샷 모양으로 돌게 하는 최소 픽스처(내용은 상관없다 — 떼어내는 대상이다) */
function renderSnapshot0(): string {
  return renderSnapshot({
    project: { name: "큐", root: "/tmp/x/.dira" },
    config: {
      personas: "/tmp/x/.dira/personas",
      protocols: "/tmp/x/.dira/protocols",
      inProgress: ".wip",
      done: ".done",
      cwd: "/tmp/x",
      cwdByWorker: {},
      assumed: [],
      unresolved: [],
      conflicts: [],
    },
    tickets: [],
    workers: [],
  });
}

const uuid = (n: number) => `021f80d9-294c-4bea-948b-3b6f0c4501${String(n).padStart(2, "0")}`;

test("대화 목록 — 새 대화 · 전환 · 경로 관문. UUID가 아닌 줄은 없는 것과 같다", async () => {
  assert.strictEqual(sessionsPath(), path.join(LOCAL, "home-sessions.json"));
  assert.deepStrictEqual(await readHome("p1"), { conversations: [], current: null }); // 파일이 없다
  assert.strictEqual(await readSessionId("p1"), null);

  // 이미 대화가 하나 있는 프로젝트(= 첫 질문이 끝난 상태)
  const a = uuid(1);
  writeFileSync(
    sessionsPath(),
    JSON.stringify({ p1: { conversations: [{ id: a, title: "옛 대화", created: "2026-07-31T00:00:00.000Z" }], current: a } }),
  );

  // `새 대화`는 **여는 것**이다 — 옛 대화가 목록에 남고 `current`는 새 줄이다(§7)
  const b = await newConversation("p1");
  await newConversation("p2"); // 파일 하나에 프로젝트 전부가 산다
  const home = await readHome("p1");
  assert.deepStrictEqual(
    home.conversations.map((c) => c.id),
    [a, b],
  );
  assert.strictEqual(home.current, b);
  assert.strictEqual(await readSessionId("p1"), b);
  // 아직 세션이 안 떴다 = 첫 질문이 `--resume`이 아니라 `--session-id`로 연다
  assert.strictEqual(home.conversations[1]?.fresh, true);
  // 제목이 아직 없는 대화도 목록에 뜬다(첫 질문이 제목을 채운다)
  assert.strictEqual(home.conversations[1]?.title, "");
  // 아무것도 안 물은 대화를 또 열지 않는다 — 두 번 누르면 빈 줄이 둘이고 상한 20이 그걸로 찬다
  assert.strictEqual(await newConversation("p1"), b);
  assert.strictEqual((await readHome("p1")).conversations.length, 2);

  // 전환 = `current` 교체뿐. 목록에 없는 값은 안 받는다 — 이 값은 경로가 된다
  assert.strictEqual(await switchConversation("p1", a), true);
  assert.strictEqual(await readSessionId("p1"), a);
  assert.strictEqual(await switchConversation("p1", uuid(99)), false); // 남의 대화·없는 대화
  assert.strictEqual(await switchConversation("p1", "../../etc/passwd"), false);
  assert.strictEqual(await readSessionId("p1"), a);
  assert.strictEqual((await readHome("p2")).conversations.length, 1); // 다른 프로젝트는 그대로

  // 사람이 손으로 고친 값. 이게 통과하면 `--resume`과 트랜스크립트 글롭에 그대로 흘러간다
  writeFileSync(
    sessionsPath(),
    JSON.stringify({
      p3: { conversations: [{ id: "../../etc/passwd" }, { id: 7 }, { id: uuid(3) }], current: "../../etc/passwd" },
    }),
  );
  assert.deepStrictEqual((await readHome("p3")).conversations, [{ id: uuid(3), title: "", created: "" }]);
  assert.strictEqual(await readSessionId("p3"), null); // 목록에 없는 `current`는 없는 것이다

  // 깨진 JSON은 빈 맵이다 — 홈 화면이 500이 되는 것보다 대화 하나를 새로 시작하는 게 낫다
  writeFileSync(sessionsPath(), "{ not json");
  assert.deepStrictEqual(await readHome("p1"), { conversations: [], current: null });
});

test("옛 형식(문자열 한 줄)은 대화 한 개짜리 목록으로 읽힌다 — 사람 머신에 이미 있는 파일이다", async () => {
  const sid = "11111111-2222-3333-4444-555555555555";
  writeFileSync(sessionsPath(), JSON.stringify({ old: sid, broken: "not-a-uuid" }));

  assert.deepStrictEqual(await readHome("old"), {
    conversations: [{ id: sid, title: "", created: "" }], // 첫 질문도 만든 시각도 그 형식에 없다
    current: sid, // 돌던 대화가 그대로 열린다 — 못 읽으면 그 사람은 그걸 잃는다
  });
  assert.strictEqual(await readSessionId("old"), sid);
  assert.deepStrictEqual(await readHome("broken"), { conversations: [], current: null });

  // 그 위에 `새 대화`를 열면 옛 대화가 목록에 남는다(종전은 지우는 것이었다)
  const next = await newConversation("old");
  assert.deepStrictEqual((await readHome("old")).conversations.map((c) => c.id), [sid, next]);
});

test("상한 20 — 21번째 대화를 열면 가장 오래된 줄이 파일에서 빠진다", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: uuid(i), title: `대화 ${i}`, created: "" }));
  writeFileSync(sessionsPath(), JSON.stringify({ cap: { conversations: rows, current: uuid(19) } }));
  const full = await readHome("cap");
  assert.strictEqual(full.conversations.length, 20);
  const oldest = full.conversations[0]!.id;

  const fresh = await newConversation("cap");
  const after = await readHome("cap");
  assert.strictEqual(after.conversations.length, 20);
  assert.ok(!after.conversations.some((c) => c.id === oldest), "가장 오래된 줄이 빠져야 한다");
  assert.strictEqual(after.conversations.at(-1)?.id, fresh); // 방금 연 대화는 잘리지 않는다
  assert.strictEqual(after.current, fresh);
});

/** PATH에 놓는 가짜 `claude`. 진짜 세션을 띄우지 않고도 **파일에 남는 것**과 **넘어간 플래그**가
 *  걸린다 — `--session-id`(연다)와 `--resume`(잇는다)이 갈리는 자리가 이 티켓의 핵심이다. */
function fakeClaude(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ha-bin-"));
  mkdirSync(path.join(LOCAL, "ask"), { recursive: true }); // 자식의 cwd(큐의 부모)는 실재해야 한다
  tmps.push(dir);
  writeFileSync(path.join(dir, "claude"), `#!/bin/sh\nprintf '%s %s\\n' "$1" "$2" >> "$FAKE_LOG"\n${body}\n`, {
    mode: 0o755,
  });
  return dir;
}

test("제목 · 세션을 여는 질문과 잇는 질문 — 첫 줄을 80자에서 자르고, 둘째 질문은 `--resume`이다", async () => {
  const project = { id: "title-test", name: "큐", root: path.join(LOCAL, "ask/.dira") };
  const log = path.join(LOCAL, "fake.log");
  const path0 = process.env.PATH;
  // stream-json은 결과가 마지막 줄이 아니라 `type`으로 갈린다(§7 §답은 흐른다 — 실측)
  process.env.PATH = fakeClaude(`echo '{"type":"result","is_error":false,"result":"답"}'`);
  process.env.FAKE_LOG = log;
  try {
    // 첫 질문은 `새 대화` 없이도 줄을 연다
    const first = await ask(project, "  워커 w2는 지금 뭘 하나\n둘째 줄은 제목이 아니다  ");
    assert.strictEqual(first.ok, true, first.output);
    assert.strictEqual(first.resumed, false);
    const one = await readHome(project.id);
    assert.strictEqual(one.conversations.length, 1);
    assert.strictEqual(one.conversations[0]?.title, "워커 w2는 지금 뭘 하나");
    assert.strictEqual(one.conversations[0]?.fresh, undefined); // 세션이 떴다
    assert.strictEqual(one.current, first.sessionId);

    // 둘째 질문은 같은 대화다 — 제목은 **첫** 질문이지 마지막 질문이 아니다
    const second = await ask(project, "그럼 w1은?");
    assert.strictEqual(second.resumed, true);
    assert.strictEqual(second.sessionId, first.sessionId);
    const two = await readHome(project.id);
    assert.strictEqual(two.conversations.length, 1);
    assert.strictEqual(two.conversations[0]?.title, "워커 w2는 지금 뭘 하나");

    // 80자에서 자른다(`reqTitle` — 요구 접수 모드와 같은 자)
    await newConversation(project.id);
    await ask(project, "가".repeat(200));
    const three = await readHome(project.id);
    assert.strictEqual(three.conversations.length, 2); // `새 대화`가 연 줄이 남아 있다
    assert.strictEqual(three.conversations.at(-1)?.title, "가".repeat(80) + "…");

    // 세션을 여는 질문만 `--session-id`고 나머지는 `--resume`이다
    assert.deepStrictEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "-p --session-id",
      "-p --resume",
      "-p --session-id",
    ]);
  } finally {
    process.env.PATH = path0;
    delete process.env.FAKE_LOG;
  }
});

test("첫 질문이 실패한 대화 — 줄과 제목은 남고 session id만 새것으로 갈린다", async () => {
  const project = { id: "fail-test", name: "큐", root: path.join(LOCAL, "ask/.dira") };
  const path0 = process.env.PATH;
  process.env.PATH = fakeClaude("exit 1"); // 아무것도 출력하지 않고 죽는다(§24 실패 ①)
  process.env.FAKE_LOG = path.join(LOCAL, "fail.log");
  try {
    const opened = await newConversation(project.id);
    const r = await ask(project, "안 열릴 질문");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.sessionId, opened);

    const home = await readHome(project.id);
    assert.strictEqual(home.conversations.length, 1); // 사람이 연 줄은 안 지운다
    assert.strictEqual(home.conversations[0]?.title, "안 열릴 질문");
    // 안 열린 세션에 `--resume`을 걸면 다음 질문도 실패한다 — 그래서 `fresh`가 남고 id가 갈린다
    assert.strictEqual(home.conversations[0]?.fresh, true);
    assert.notStrictEqual(home.conversations[0]?.id, opened);
    assert.strictEqual(home.current, home.conversations[0]?.id);
  } finally {
    process.env.PATH = path0;
    delete process.env.FAKE_LOG;
  }
});

test("toTurns — 중지가 남기는 가짜 줄 셋은 대화가 아니다 (§7 §도는 답을 멈춘다 실측 ⑷)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ha-ghost-"));
  tmps.push(dir);
  const file = path.join(dir, "s.jsonl");
  const user = (uuid: string, text: string) =>
    JSON.stringify({
      type: "user",
      uuid,
      timestamp: "2026-08-01T05:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text }] },
    });
  const asst = (uuid: string, text: string) =>
    JSON.stringify({
      type: "assistant",
      uuid,
      timestamp: "2026-08-01T05:00:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
  writeFileSync(
    file,
    [
      user("u1", buildPrompt("SNAP", "40문장 써라")),
      asst("a1", "1. 1은 곱셈의 항등원이라"),
      user("u2", "[Request interrupted by user]"), // 중지가 남긴 것
      user("u3", "Continue from where you left off."), // `--resume`이 넣은 것
      asst("a2", "No response requested."), // 그 답
      user("u4", buildPrompt("SNAP", "어디까지 썼나")),
      "",
    ].join("\n"),
  );
  const { events } = await tailEvents(file, 0);
  assert.deepStrictEqual(
    toTurns(events).map((t) => t.text),
    ["40문장 써라", "1. 1은 곱셈의 항등원이라", "어디까지 썼나"],
  );
  // **버리기만 하면 사실을 잃는 줄이 하나 있다**(§비주얼 §24 — 새로고침해도 `중지됨`이 남는다).
  // `[Request interrupted by user]`의 존재가 곧 *앞 답이 중지됐다*이고, GUI는 그 사실을
  // 아무 데도 저장하지 않는다. 말풍선으로는 안 그리되 앞 답의 칸에 옮겨 적는다.
  assert.deepStrictEqual(
    toTurns(events).map((t) => t.stopped),
    [undefined, true, undefined],
  );
  // 글자가 한 자도 안 온 채로 멈췄다 — 옮겨 적을 답이 없다. 앞의 질문에 붙이지 않는다
  // (§비주얼 §24는 띠를 답의 산문 블록에 붙이고, 여기는 그 블록 자체가 없다)
  writeFileSync(
    file,
    [user("u6", buildPrompt("SNAP", "묻자마자 멈춤")), user("u7", "[Request interrupted by user]"), ""].join("\n"),
  );
  assert.deepStrictEqual(
    toTurns((await tailEvents(file, 0)).events).map((t) => [t.text, t.stopped]),
    [["묻자마자 멈춤", undefined]],
  );

  // 전문 일치라 **사람이 인용한 같은 문장은 안 삼킨다** — 이 셋에는 사람 글과 구분되는 플래그가 없다
  writeFileSync(file, user("u5", "왜 `[Request interrupted by user]`가 뜨나") + "\n");
  assert.strictEqual((await tailEvents(file, 0)).events.length, 1);
  assert.strictEqual(toTurns((await tailEvents(file, 0)).events).length, 1);
});

// ── 왕복 (§7 §답은 흐른다 · §도는 답을 멈춘다) ────────────────────────────────
//
// **진짜 `claude` 대신 우리가 쓴 `claude`를 PATH 앞에 세운다.** 실행층이 지키는 것은 자식이
// 무엇을 하느냐가 아니라 **그 stdout에서 무엇을 읽고 누가 핸들을 들고 있느냐**라, 그 계약을
// 그대로 흉내내는 30줄짜리 sh가 5분짜리 진짜 세션보다 정확한 픽스처다(실제 왕복은 티켓 `## 결과`).
// 스트리밍 이벤트 · 결과 객체 · 트랜스크립트 · `SIGTERM` 뒤 rc 143이 전부 실측 원문 모양이다.
const FAKE = mkdtempSync(path.join(tmpdir(), "ha-bin-"));
tmps.push(FAKE);
const ARGV = path.join(FAKE, "argv.log");
writeFileSync(
  path.join(FAKE, "claude"),
  `#!/bin/sh
# 가짜 claude. argv는 \`-p (--session-id|--resume) <uuid> …\`라 sid가 늘 $3이다.
sid="$3"
echo "$@" | head -1 >> "${ARGV}"   # 마지막 인자(프롬프트)가 여러 줄이라 첫 줄만 = 호출 한 번
tr="${TRANSCRIPTS}/$sid.jsonl"
say() { printf '%s\\n' "$1"; }
keep() {  # 중지·성공 양쪽에서 트랜스크립트가 정본이 된다(실측 ⑵)
  printf '{"type":"user","uuid":"u%s","timestamp":"2026-08-01T05:00:00.000Z","message":{"role":"user","content":"물음"}}\\n' "$$" >> "$tr"
  printf '{"type":"assistant","uuid":"a%s","timestamp":"2026-08-01T05:00:09.000Z","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}\\n' "$$" "$1" >> "$tr"
}
delta() { say '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"'"$1"'"}},"parent_tool_use_id":null}'; }
case "$FAKE_MODE" in
  auth)   # 실패 ② — stream_event 0건이라 누적분이 비어 있다
    say '{"type":"result","is_error":true,"subtype":"success","api_error_status":401,"result":"Failed to authenticate. API Error: 401 OAuth access token is invalid."}'
    exit 1 ;;
  hang)   # 중지 대상. SIGTERM을 받아 **스스로** 143으로 나가면서 받은 데까지를 남긴다
    trap 'keep "받은 데까지"; exit 143' TERM
    say '{"type":"stream_event","event":{"type":"message_start"},"parent_tool_use_id":null}'
    delta "받은 데까지"
    # 포그라운드 sleep이면 trap이 그게 끝난 뒤에 돈다. stdout을 떼는 것도 필수 —
    # 안 떼면 죽은 뒤에도 손자가 파이프를 물고 있어 부모의 \`close\`가 안 온다
    sleep 60 >/dev/null 2>&1 & wait ;;
  *)
    say '{"type":"system","subtype":"init"}'   # --verbose가 섞는 줄. 결과가 아니다
    say '{"type":"stream_event","event":{"type":"message_start"},"parent_tool_use_id":null}'
    say '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}},"parent_tool_use_id":null}'
    delta "앞부분"
    [ "$FAKE_MODE" = "stream" ] && sleep 2   # 델타 사이의 480ms(실측) 자리 — 도는 중을 재는 창
    delta " 뒷부분"
    keep "앞부분 뒷부분"
    say '{"type":"rate_limit_event"}'        # 결과를 "마지막 줄"로 집으면 여기서 틀린다
    say '{"type":"result","is_error":false,"subtype":"success","api_error_status":null,"result":"앞부분 뒷부분"}' ;;
esac
`,
  { mode: 0o755 },
);
chmodSync(path.join(FAKE, "claude"), 0o755);
const withFake = <T>(mode: string, fn: () => Promise<T>): Promise<T> => {
  const path0 = process.env.PATH;
  process.env.PATH = `${FAKE}:${path0 ?? ""}`; // 앞에 선다. `sleep`을 쓰므로 원래 PATH도 남긴다
  process.env.FAKE_MODE = mode;
  return fn().finally(() => {
    process.env.PATH = path0;
  });
};

/** 자식의 cwd는 **큐의 부모**다(`ask`) — 없는 디렉터리면 `spawn`이 `ENOENT`다. 실행층이 도는
 *  조건을 픽스처가 지운 채로 재면 세 테스트가 다 실패 ①로 뭉친다. */
const CWD = path.join(mkdtempSync(path.join(tmpdir(), "ha-cwd-")), ".dira");
tmps.push(path.dirname(CWD));

/** 화면이 하는 일과 **같은 폴링**: 세션·offset을 들고 다니고 `reset`이면 갈아 끼운다. */
function poller(projectId: string) {
  let session: string | null = null;
  let offset = 0;
  const turns: string[] = [];
  const next = async (): Promise<HomeChunk> => {
    const c = await pollHome(projectId, session, offset);
    session = c.sessionId;
    offset = c.offset;
    if (c.reset) turns.length = 0;
    turns.push(...c.turns.map((t) => t.text));
    return c;
  };
  const until = async (want: (c: HomeChunk) => boolean): Promise<HomeChunk> => {
    for (let i = 0; i < 600; i++) {
      const c = await next();
      if (want(c)) return c;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`15초 안에 조건이 안 됐다 (turns=${JSON.stringify(turns)})`);
  };
  return { turns, next, until };
}

test("흐르는 답 — 도는 동안은 stdout 누적분, 끝나면 정본이 트랜스크립트로 넘어간다", async () => {
  const project = { id: "stream-test", name: "큐", root: CWD };
  await withFake("stream", async () => {
    assert.strictEqual(await startAsk(project, "질문"), null);

    // ① 도는 중에 부분 텍스트가 온다. `thinking_delta`는 안 붙는다(본문이 빈 문자열이다)
    const mid = await poller(project.id).until((c) => c.partial !== "");
    assert.strictEqual(mid.partial, "앞부분");
    assert.strictEqual(mid.running, true);
    assert.strictEqual(mid.turns.length, 0); // 트랜스크립트에는 아직 아무것도 없다

    // ② 끝나는 순간 — 누적분이 비고 같은 응답의 `turns`가 그 답을 진짜 줄로 데려온다.
    //    **한 답이 두 벌로 그려지지 않는 자리가 이 두 줄이다.**
    const p = poller(project.id);
    const end = await p.until((c) => !c.running);
    assert.strictEqual(end.partial, "");
    assert.deepStrictEqual(p.turns, ["물음", "앞부분 뒷부분"]);
    assert.strictEqual(end.failed, null);
    assert.strictEqual(end.stopped, false);
  });
});

test("`중지` — SIGTERM 하나로 끝나고, 받은 글은 남고, 다음 질문이 `--resume`으로 이어진다", async () => {
  const project = { id: "stop-test", name: "큐", root: CWD };
  await withFake("hang", async () => {
    const p = poller(project.id);
    assert.strictEqual(await startAsk(project, "긴 질문"), null);
    await p.until((c) => c.partial !== "");

    assert.strictEqual(stopAsk(project.id), true);
    assert.strictEqual(stopAsk(project.id), false); // 두 번 눌러도 신호는 하나다

    const end = await p.until((c) => !c.running);
    // **실패가 아니다**(§7: 실패 5종에 여섯 번째를 만들지 않는다). 받은 글은 트랜스크립트에 남는다
    assert.strictEqual(end.stopped, true);
    assert.strictEqual(end.failed, null);
    assert.strictEqual(end.partial, "");
    assert.deepStrictEqual(p.turns, ["물음", "받은 데까지"]);
    // 입력칸이 곧바로 열린다 — 서버가 아는 "도는 질문"이 없다
    assert.strictEqual(isAsking(project.id), false);
  });

  // 다음 질문은 **같은 대화**다. 중지가 세션 한 줄을 지우지 않았고, argv가 `--resume`이다
  const sid = await readSessionId(project.id);
  assert.ok(sid);
  await withFake("", async () => {
    assert.strictEqual(await startAsk(project, "다음 질문"), null);
    await poller(project.id).until((c) => !c.running);
  });
  const argv = readFileSync(ARGV, "utf8").trim().split("\n");
  assert.match(argv.at(-1) ?? "", new RegExp(`^-p --resume ${sid} `));
  assert.match(argv.at(-2) ?? "", new RegExp(`^-p --session-id ${sid} `)); // 첫 질문이 연 세션
  // 새 형식이 도구 표면을 안 넓혔다 — 늘어난 것은 출력 형식 셋뿐이다
  assert.match(argv.at(-1) ?? "", /--tools Read,Glob,Grep .*--output-format stream-json --include-partial-messages --verbose/);
});

test("실패 ② 인증 — 새 형식에서도 판정은 `api_error_status` 401이다", async () => {
  const project = { id: "auth-test", name: "큐", root: CWD };
  await withFake("auth", async () => {
    assert.strictEqual(await startAsk(project, "질문"), null);
    const end = await poller(project.id).until((c) => !c.running);
    assert.strictEqual(end.failed?.reason, "auth");
    assert.match(end.failed?.output ?? "", /401 OAuth access token is invalid/);
    assert.strictEqual(end.partial, ""); // 흐르다 만 글과 안 흐른 글이 구분된다
    assert.strictEqual(end.stopped, false);
  });
  // 세션을 못 연 채로 끝났으므로 그 줄은 **여전히 `fresh`다** — 다음 질문은 `--session-id`로
  // 다시 연다(안 열린 세션에 `--resume`을 걸면 그 화면은 영영 안 산다)
  assert.strictEqual((await readHome(project.id)).conversations.at(-1)?.fresh, true);
});

test("한 프로젝트에 한 질문 — 둘째는 기다리지 않고 거절되고, 폴링 한 번이 답을 집어 간다", async () => {
  // `claude`를 못 찾게 만들어 질문 하나를 **즉시** 끝낸다(§24 실패 ① spawn). 진짜 세션을
  // 띄우지 않고도 이 파일이 지키는 것(맵의 수명 · 실패 코드 · 다시 열림)이 전부 걸린다.
  const project = { id: "busy-test", name: "큐", root: path.join(LOCAL, "nowhere/.dira") };
  const path0 = process.env.PATH;
  process.env.PATH = "";
  try {
    assert.strictEqual(await startAsk(project, "질문 하나"), null); // 시작했다
    assert.strictEqual(isAsking(project.id), true);

    // 둘째 — 큐잉이 아니라 **거절**이다(§7: 동시 실행 제한 층을 만들지 않는다)
    const second = await startAsk(project, "질문 둘");
    assert.strictEqual(second?.reason, "busy");
    assert.strictEqual(second?.ok, false);

    // 폴링이 끝난 답을 집어 가면서 지운다 — 그래야 다음 질문이 열린다
    const chunk = await pollHome(project.id, null, 0);
    assert.strictEqual(chunk.running, false);
    assert.strictEqual(chunk.failed?.reason, "spawn");
    assert.match(chunk.failed?.output ?? "", /PATH에서 claude를 찾지 못했습니다/);
    assert.strictEqual(isAsking(project.id), false);

    // 같은 실패를 두 번 그리지 않는다 — 집어 간 뒤의 폴링에는 실패가 없다
    assert.strictEqual((await pollHome(project.id, null, 0)).failed, null);
    assert.strictEqual(await startAsk(project, "질문 셋"), null); // 다시 열렸다
    await pollHome(project.id, null, 0); // 뒷정리
  } finally {
    process.env.PATH = path0;
  }
});
