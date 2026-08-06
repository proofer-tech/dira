import { test } from "node:test";
import assert from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
  pollDone,
  isAsking,
  sessionsPath,
  readSessionId,
  readHome,
  newConversation,
  switchConversation,
  workerSessions,
  toolFlags,
  personaBlock,
} = await import("./home-agent.ts");
type HomeChunk = Awaited<ReturnType<typeof pollHome>>;
const { tailEvents } = await import("./transcript.ts");
const { registryPath, resolveConfig } = await import("./projects.ts");
const { listTickets } = await import("./queue.ts");
const { listWorkers, lockPath } = await import("./workers.ts");

const p2 = (n: number) => String(n).padStart(2, "0");

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

test("workerSessions — `.wip` 전부가 먼저, `.done`은 최근 10개. session id 없는·깨진 줄은 없는 것과 같다", async () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "ha-ws-")), ".dira");
  tmps.push(path.dirname(root));
  const tickets = path.join(root, "tickets");
  mkdirSync(tickets, { recursive: true });
  // mtime을 손으로 박는다 — 같은 초에 쓰이면 정렬을 판정할 수 없다
  const put = (name: string, fm: string, min: number) => {
    const p = path.join(tickets, name);
    writeFileSync(p, `---\n${fm}---\n\n본문\n`);
    const t = new Date(2026, 7, 1, 12, min);
    utimesSync(p, t, t);
  };
  const sid = (n: number) => `0000000${n.toString(16)}-1111-2222-3333-444444444444`;

  // 도는 것 둘 — 하나는 `session_id`가 없다(디스패치 직전에 사람이 손으로 만든 `.wip`)
  put("wip00001.wip.md", `ticket: wip00001\ntitle: 도는 티켓\nsession_id: ${sid(1)}\nowner: developer / w1-deadbeef\n`, 30);
  put("wip00002.wip.md", "ticket: wip00002\ntitle: 세션 없는 wip\nowner: developer / w2-deadbeef\n", 40);
  // 끝난 것 12 + 깨진 값 하나. 12개는 분 단위로 갈라 최신 10개가 무엇인지 계산할 수 있게 한다
  for (let i = 0; i < 12; i++) {
    put(`done00${p2(i)}.done.md`, `ticket: done00${p2(i)}\ntitle: 끝난 ${i}\nsession_id: ${sid(i)}\nowner: pm / w3-deadbeef\n`, i);
  }
  put("done00zz.done.md", "ticket: done00zz\ntitle: 손으로 쓴 값\nsession_id: 방금 그 세션\nowner: pm / w3-deadbeef\n", 99);

  const rows = workerSessions(await listTickets(root, await resolveConfig({ root })));

  // ① 상한 10은 `.done`에만 걸린다 — 도는 것은 안 자른다
  assert.strictEqual(rows.length, 11);
  // ② 도는 것이 먼저. `session_id` 없는 `.wip`은 없는 줄이다(도는데도 목록에 못 선다)
  assert.deepStrictEqual(
    rows.map((r) => r.running),
    [true, ...Array(10).fill(false)],
  );
  assert.deepStrictEqual(rows[0], {
    id: sid(1),
    worker: "w1",
    title: "도는 티켓",
    stem: "wip00001",
    hash: "wip00001", // 링크는 `stem` · 화면 글자는 `hash`다(§식별자). 이 픽스처에서는 같다
    running: true,
  });
  // ③ `.done`은 mtime 내림차순이고 잘리는 것은 **오래된 쪽**이다 (11 … 2 · 0·1이 빠진다)
  assert.deepStrictEqual(
    rows.slice(1).map((r) => r.stem),
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => `done00${p2(i)}`),
  );
  // ④ 손으로 쓴 `session_id`는 mtime이 제일 새것이어도 안 든다 — 관문이 `sessionIdOf` 하나다
  assert.ok(!rows.some((r) => r.stem === "done00zz"));
  // ⑤ 워커 이름은 `owner:`에서 온다(`workerOf`) — 형식이 아니면 빈 문자열이고 여긴 다 형식이다
  assert.deepStrictEqual([...new Set(rows.map((r) => r.worker))], ["w1", "w3"]);
});

test("buildPrompt — 스냅샷이 질문 앞에 오고 경계가 글로 들어간다", () => {
  const p = buildPrompt("SNAP", "w1이 지금 무슨 일을 하고 있나?");
  assert.ok(p.indexOf("SNAP") < p.indexOf("w1이 지금"));
  // 종전 `(쓰기 도구는 애초에 막혀 있다)`가 거짓이 된 자리 — 새 경계가 다섯 다 글로 서고
  // 막힌 쪽도 이름으로 선다(막힌 것을 두드리다 끝나는 턴이 사람에게는 고장으로 보인다)
  for (const s of ["personas/**", "protocols/**", "workers/*.sh", "AGENTS.md", "ontology/**", "worktrees/**", "tickets/**"]) {
    assert.ok(p.includes(s), `프롬프트에 ${s}가 없다 — §7 §쓰기가 닿는 곳이 다섯이 된다`);
  }
  assert.ok(!p.includes("쓰기 도구는 애초에 막혀"));
  // **고정 지시문이 죽었다**(§7 §페르소나가 실린다) — PROFILE이 누구인지를 말하고, *티켓을
  // 고치지 않는다*는 이 페르소나가 하는 일(본문에 링크를 단다)과 정면으로 부딪쳤다.
  assert.ok(!p.includes("질의응답 에이전트"));
  assert.ok(!p.includes("고치지도 않는다"));
  // 살린 것 둘: 티켓을 **만드는** 경로가 없다는 것과, 거부를 그대로 말하라는 줄
  assert.match(p, /새 티켓을 만들지 않는다/);
  assert.match(p, /거부되면 우회하지 말고 무엇이 왜 막혔는지 그대로 말한다/);
  // 페르소나를 안 주면 **한 글자도 안 붙는다** — 스캐폴딩 전 큐에서 홈이 그대로 돈다
  assert.ok(p.startsWith("SNAP"));
});

test("buildPrompt — 페르소나 블록이 스냅샷 앞에 선다 (§7 §페르소나가 실린다)", () => {
  const p = buildPrompt("SNAP", "질문", "PERSONA");
  assert.ok(p.startsWith("PERSONA\n\n"));
  assert.ok(p.indexOf("PERSONA") < p.indexOf("SNAP"));
  // 순수 함수의 계약: 인자로 받은 것만 붙인다(fs를 안 탄다 — 읽기는 `personaBlock`이 한다)
  assert.strictEqual(questionOf(p), "질문");
});

test("personaBlock — 세 조각이 tick.sh:265와 같은 순서로 · 없으면 빈 문자열", async () => {
  const personas = mkdtempSync(path.join(tmpdir(), "ha-personas-"));
  tmps.push(personas);

  // ① 디렉터리가 통째로 없다 — 빈 문자열이고 WARN도 없다(§7: 이 티켓이 `39ee5ae0` 없이 먼저 든다)
  assert.strictEqual(await personaBlock(personas), "");

  // ② PROFILE만 있다 — 사이드카 블록이 아예 안 선다
  const dir = path.join(personas, "archive-manager");
  mkdirSync(path.join(dir, "memory"), { recursive: true });
  writeFileSync(path.join(dir, "PROFILE.md"), "나는 아카이브 담당이다.\n");
  const only = await personaBlock(personas);
  assert.match(only, /===== archive-manager PROFILE \(.*PROFILE\.md\) =====\n나는 아카이브 담당이다\.\n\n===== PROFILE 끝 =====/);
  assert.ok(!only.includes("스킬 끝") && !only.includes("메모리 끝"));

  // ③ 셋 다 — 순서가 PROFILE → skills → memory이고 memory는 **이름 오름차순**이다
  writeFileSync(path.join(dir, "skills.md"), "## 스킬\n- ontology\n");
  writeFileSync(path.join(dir, "memory", "b-두번째.md"), "둘째 개념\n");
  writeFileSync(path.join(dir, "memory", "a-첫째.md"), "첫째 개념\n");
  writeFileSync(path.join(dir, "memory", "안읽는다.txt"), "md가 아니다\n");
  // 글롭은 **한 단계**다 — 하위 디렉터리는 안 읽는다(tick.sh와 같은 선)
  mkdirSync(path.join(dir, "memory", "sub"), { recursive: true });
  writeFileSync(path.join(dir, "memory", "sub", "깊다.md"), "안 실린다\n");
  const full = await personaBlock(personas);
  assert.deepStrictEqual(
    ["PROFILE 끝", "스킬 끝", "메모리 끝", "--- a-첫째.md", "--- b-두번째.md"].map((s) => full.indexOf(s) >= 0),
    [true, true, true, true, true],
  );
  assert.ok(full.indexOf("PROFILE 끝") < full.indexOf("스킬 끝"));
  assert.ok(full.indexOf("스킬 끝") < full.indexOf("메모리 끝"));
  assert.ok(full.indexOf("--- a-첫째.md") < full.indexOf("--- b-두번째.md"));
  assert.ok(!full.includes("md가 아니다"));
  assert.ok(!full.includes("안 실린다"));
  // 이름은 프로필 머리 문장에도 선다(워커 쪽 문장과 같은 자리 — 누구로 도는지가 첫 줄이다)
  assert.match(full, /^당신은 이 프로젝트의 'archive-manager'입니다\./);

  // ④ 이름이 다르면 아무것도 없다 — 고정 페르소나 하나만 읽는다
  assert.strictEqual(await personaBlock(personas, "pm"), "");
});

test("toolFlags — 네 조각과 경로 스코프 다섯 + `Edit`만 (89962e56 · 7e35d300 · bd3cd201)", () => {
  const flags = toolFlags("/Users/x/proj/.dira");

  // ① 네 조각이 다 있다. `--allowed-tools`는 **도구를 빼지 않고**(권한 목록이다) 나머지 셋 중
  // 하나라도 빠지면 세션에 `Bash`가 살아난다 — 그게 `89962e56` 그 사건이다. 지금은 넷째가
  // 경로 스코프까지 지므로 그것도 **존재**로 못박는다. 실측은 `home-agent.ts` 머리 주석에 있다.
  for (const flag of ["--tools", "--strict-mcp-config", "--permission-mode", "--allowed-tools"]) {
    assert.ok(flags.includes(flag), `${flag}가 빠졌다 — 도구 표면이 §7 표보다 넓어진다`);
  }
  // ② `--tools` 값은 variadic 함정 때문에 **쉼표 한 토큰**이다(공백으로 나누면 질문까지 도구로 먹는다)
  assert.strictEqual(flags[flags.indexOf("--tools") + 1], "Read,Glob,Grep,Write,Edit");

  const scope = flags.slice(flags.indexOf("--allowed-tools") + 1);
  // ③ 쓰기가 닿는 곳 **다섯**이 다 있다. `Write`·`Edit` 양쪽에 붙어야 한다 — 한쪽만 스코프면
  // 다른 쪽이 큐 전체를 연다(절대경로는 `//` 접두다 — 실측 문법). **다섯이 다 큐 루트 아래다**
  // — 종전 뒤 둘이 repo(`dirname(root)`) 기준이던 것이 개정 `22a803de`로 큐 안으로 왔다
  for (const p of [
    "/Users/x/proj/.dira/personas/**",
    "/Users/x/proj/.dira/protocols/**",
    "/Users/x/proj/.dira/workers/*.sh",
    "/Users/x/proj/.dira/ontology/**",
    "/Users/x/proj/.dira/AGENTS.md",
  ]) {
    for (const tool of ["Write", "Edit"]) {
      assert.ok(scope.includes(`${tool}(//${p})`), `${tool}(//${p})가 없다 — §7 §쓰기가 닿는 곳이 다섯이 된다`);
    }
  }
  // ④ **`tickets/**`는 `Edit`만이다.** 시킨 것은 본문에 링크를 추가지 티켓 발행이 아니라
  // (§5-3 산출물 ③) `Write`를 안 준다 — 이게 §7 §안 만드는 것의 `에이전트가 티켓을 만드는
  // 경로`가 안 뒤집힌 자리다. **`Write(…/tickets/**)`가 붙는 날이 그 줄이 뒤집히는 날이다.**
  assert.ok(scope.includes("Edit(///Users/x/proj/.dira/tickets/**)"));
  assert.strictEqual(
    scope.filter((s) => s.startsWith("Write(") && s.includes("tickets")).length,
    0,
    "Write(…/tickets/**)가 붙었다 — 티켓 발행 경로가 열린다(§7 §안 만드는 것)",
  );
  // ⑤ 밖이어야 하는 것들이 **어느 스코프에도 안 나온다**. `worktrees/` 아래는 실제 프로젝트
  // 코드고, repo 쪽 예외가 **0**이라 소스·`docs/`·엔진은 그대로 막혀 있다
  for (const out of ["worktrees", "docs", "apps", "tick.sh"]) {
    assert.ok(!scope.some((s) => s.includes(out)), `${out}가 스코프에 들었다 — 요구가 막으라고 한 것이다`);
  }
  // repo(`dirname(root)`) 기준 항이 **0**이다 — 경로 스코프 전부가 큐 루트 아래로 시작한다
  // (개정 `22a803de`. 이 한 줄이 요구 `20e4a6f4`를 예외 없이 세우는 자리다)
  for (const s of scope.filter((s) => s.includes("("))) {
    assert.match(s, /^(Write|Edit)\(\/\/\/Users\/x\/proj\/\.dira\//, `${s}가 큐 루트 밖이다`);
  }
  // ⑥ 스코프 없는 맨 `Write`·`Edit`는 큐 전체를 연다 — 그것도 없어야 한다
  assert.ok(!scope.includes("Write") && !scope.includes("Edit"));
  // ⑦ `--dangerously-skip-permissions`(스코프를 통째로 끈다) · `Bash`(셸은 경로로 못 막는다)는 §7이 뺀 것이다
  assert.ok(!flags.some((f) => f.includes("dangerously")));
  assert.ok(!flags.some((f) => f.includes("Bash")));
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

/** 화면이 대화 목록을 **폴링 응답 하나**에서 받는다(§비주얼 §24 — 트리거도 스레드도 그 한 벌이다).
 *  두 가지를 같이 못박는다: 목록이 그 응답에 들어 있다는 것과, **전환한 대화의 트랜스크립트가
 *  그려진다**는 것. 뒤엣것이 `switchConversation` 단독 검증과 갈리는 자리다 — 저건 파일에 무엇을
 *  쓰느냐이고 여기는 **그래서 화면에 무엇이 그려지느냐**다. */
test("폴링이 대화 목록을 데려온다 — 전환하면 그 대화의 트랜스크립트가 그려지고, 21개째여도 20줄이다", async () => {
  const a = uuid(41);
  const b = uuid(42);
  const record = (u: string, role: string, content: string) =>
    JSON.stringify({
      type: role === "user" ? "user" : "assistant",
      uuid: u,
      timestamp: "2026-08-01T05:00:00.000Z",
      message: role === "user" ? { role, content } : { role, content: [{ type: "text", text: content }] },
    }) + "\n";
  writeFileSync(path.join(TRANSCRIPTS, `${a}.jsonl`), record("qa", "user", "옛 질문") + record("aa", "assistant", "옛 답"));
  writeFileSync(path.join(TRANSCRIPTS, `${b}.jsonl`), record("qb", "user", "새 질문") + record("ab", "assistant", "새 답"));
  writeFileSync(
    sessionsPath(),
    JSON.stringify({
      list: {
        conversations: [
          { id: a, title: "옛 대화", created: "2026-07-31T00:00:00.000Z" },
          { id: b, title: "새 대화의 첫 질문", created: "2026-08-01T00:00:00.000Z" },
        ],
        current: b,
      },
    }),
  );

  // 화면의 첫 렌더(= `page.tsx`)가 부르는 그 호출. 목록 · `current` · 스레드가 한 응답이다
  const first = await pollHome("list", null, 0);
  assert.deepStrictEqual(first.conversations.map((c) => c.title), ["옛 대화", "새 대화의 첫 질문"]);
  assert.strictEqual(first.sessionId, b); // `current`가 곧 `sessionId`다 — 화면의 체크가 이 값이다
  assert.deepStrictEqual(first.turns.map((t) => t.text), ["새 질문", "새 답"]);

  // 전환 = 서버 액션이 하는 일 두 줄(`switchConversation` → 처음부터 다시 폴링)
  assert.strictEqual(await switchConversation("list", a), true);
  const after = await pollHome("list", null, 0);
  assert.strictEqual(after.sessionId, a);
  assert.deepStrictEqual(after.turns.map((t) => t.text), ["옛 질문", "옛 답"]); // 그 대화가 그려진다
  assert.strictEqual(after.conversations.length, 2); // 목록은 그대로 — 전환은 `current` 교체뿐이다

  // **상한 20은 실행층이 자르고 화면은 받은 줄을 그대로 그린다**(§7). 20줄이 찬 상태에서
  // `새 대화`를 누르면 21번째가 아니라 **여전히 20줄**이고 가장 오래된 줄이 빠진 것이다.
  const full = Array.from({ length: 20 }, (_, i) => ({ id: uuid(i), title: `대화 ${i}`, created: "" }));
  writeFileSync(sessionsPath(), JSON.stringify({ list: { conversations: full, current: uuid(19) } }));
  const opened = await newConversation("list"); // 21개째
  const capped = await pollHome("list", null, 0);
  assert.strictEqual(capped.conversations.length, 20);
  assert.strictEqual(capped.sessionId, opened);
  assert.ok(!capped.conversations.some((c) => c.id === uuid(0)), "가장 오래된 줄이 빠져야 한다");
  assert.strictEqual(capped.turns.length, 0); // 방금 연 대화 — 트랜스크립트가 아직 없다
  assert.strictEqual(capped.failed, null); // 그건 실패 ⑤가 아니다(물은 적이 없다)
  // 제목이 아직 없는 대화도 목록에 뜬다 — 화면이 그 줄을 `새 대화`라고 적는다(`chatRows`)
  assert.strictEqual(capped.conversations.at(-1)?.title, "")
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
  ratelimit)  # 티켓 87a80b94 실측 — 레이트리밋도 API 에러라 subtype이 success로 온다(401/403은 아니다)
    say '{"type":"result","is_error":true,"subtype":"success","api_error_status":null,"result":"weekly limit hit, resets later"}'
    exit 1 ;;
  hang)   # 중지 대상. SIGTERM을 받아 **스스로** 143으로 나가면서 받은 데까지를 남긴다
    trap 'keep "받은 데까지"; exit 143' TERM
    say '{"type":"stream_event","event":{"type":"message_start"},"parent_tool_use_id":null}'
    delta "받은 데까지"
    # 포그라운드 sleep이면 trap이 그게 끝난 뒤에 돈다. stdout을 떼는 것도 필수 —
    # 안 떼면 죽은 뒤에도 손자가 파이프를 물고 있어 부모의 \`close\`가 안 온다
    sleep 60 >/dev/null 2>&1 & wait ;;
  late)   # QA \`0a284011\` 실측 — **답 줄이 먼저 서고 프로세스는 한참 뒤에 죽는다**(5~40초 vs 14초).
          # 도는 중의 폴링이 그 줄을 집어 가므로 마지막 응답의 \`turns\`가 빈다
    say '{"type":"stream_event","event":{"type":"message_start"},"parent_tool_use_id":null}'
    delta "답"
    keep "답"
    sleep 1
    say '{"type":"result","is_error":false,"subtype":"success","api_error_status":null,"result":"답"}' ;;
  crash)  # 실패 ③ 재정의 실측(§7 §천장이 없다) — 결과 객체 없이 죽는다. 이 pid에 밖에서 보내는
          # SIGKILL을 재현한다(중지의 SIGTERM이 아니다 — 그건 못 잡는 신호라 트랩도 없다).
    echo "$$" > "$CRASH_PID"
    say '{"type":"stream_event","event":{"type":"message_start"},"parent_tool_use_id":null}'
    delta "쓰다 만 답"
    echo "boom: something broke" >&2
    sleep 60 >/dev/null 2>&1 & wait ;;
  activity)  # §7 §안심 장치 실측 — 생각 · 도구 · 글자 사이에 잠을 둬 폴링이 셋을 따로 잡을 창을 연다
    say '{"type":"system","subtype":"init","model":"claude-test-model"}'
    say '{"type":"stream_event","event":{"type":"message_start"},"parent_tool_use_id":null}'
    say '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}},"parent_tool_use_id":null}'
    sleep 1
    say '{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}},"parent_tool_use_id":null}'
    sleep 1
    delta "답"
    sleep 1
    keep "답"
    say '{"type":"result","is_error":false,"subtype":"success","api_error_status":null,"result":"답"}' ;;
  *)
    say '{"type":"system","subtype":"init","model":"claude-test-model"}'   # --verbose가 섞는 줄. 결과가 아니다
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

    // **`중지`는 그 대화의 자식 하나다** — 인자가 project id가 아니라 session id다(§7)
    const live = await readSessionId(project.id);
    assert.ok(live);
    assert.strictEqual(stopAsk(live), true);
    assert.strictEqual(stopAsk(live), false); // 두 번 눌러도 신호는 하나다

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
  assert.match(
    argv.at(-1) ?? "",
    /--tools Read,Glob,Grep,Write,Edit .*--output-format stream-json --include-partial-messages --verbose/,
  );
});

test("실패 ③ 재정의 — 자식이 결과 객체 없이 죽으면 종료 코드(신호) · stderr 꼬리가 선다 (kill -9 실측)", async () => {
  const project = { id: "crash-test", name: "큐", root: CWD };
  const pidFile = path.join(mkdtempSync(path.join(tmpdir(), "ha-pid-")), "pid");
  tmps.push(path.dirname(pidFile));
  process.env.CRASH_PID = pidFile;
  try {
    await withFake("crash", async () => {
      const p = poller(project.id);
      assert.strictEqual(await startAsk(project, "죽을 질문"), null);
      // 이 시점엔 스크립트가 이미 pid 파일을 쓰고 지났다(같은 프로세스의 순차 실행 — 델타가
      // pid 기록보다 뒤 줄이다) — 그래서 폴링으로 기다린 뒤 곧장 읽어도 된다.
      await p.until((c) => c.partial !== "");

      // **밖에서 오는 `SIGKILL`**이다 — `stopAsk`의 `SIGTERM`이 아니다. 못 잡는 신호라 트랩이 없다.
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      process.kill(pid, "SIGKILL");

      const end = await p.until((c) => !c.running);
      assert.strictEqual(end.failed?.ok, false);
      // 이름은 낡았다 — 시계가 걷힌 뒤로 이 사유는 "죽음"이다(§7 §천장이 없다, `AnswerReason` 주석)
      assert.strictEqual(end.failed?.reason, "timeout");
      assert.match(end.failed?.output ?? "", /^signal SIGKILL/);
      assert.match(end.failed?.output ?? "", /boom: something broke/);
      // 부분 텍스트는 원인 원문이 아니다(§24 표 — exit/신호 · stderr 꼬리뿐) — 새다 나온 글자는
      // `output`이 아니라 이미 `partial`로 화면에 붙어 있었다
      assert.ok(!end.failed?.output.includes("쓰다 만 답"));
    });
  } finally {
    delete process.env.CRASH_PID;
  }
});

test("§7 §안심 장치 — 생각 · 도구 · 글자가 흐르는 동안 활동 값이 각각 다르게 잡힌다", async () => {
  const project = { id: "activity-test", name: "큐", root: CWD };
  await withFake("activity", async () => {
    const p = poller(project.id);
    assert.strictEqual(await startAsk(project, "질문"), null);

    const thinking = await p.until((c) => c.activity !== null);
    assert.deepStrictEqual(thinking.activity, { kind: "thinking" });

    // **후보 구현이다 — 실측 대기**(위 픽스처 주석·머리 주석 `## 블록`). 틀렸으면 이 단계가
    // 그냥 안 걸리고 다음 상태로 못 넘어가 아래 `answering` 대기가 타임아웃으로 죽는다.
    const tool = await p.until((c) => c.activity?.kind === "tool");
    assert.deepStrictEqual(tool.activity, { kind: "tool", tool: "Read" });

    const answering = await p.until((c) => c.activity?.kind === "answering");
    assert.deepStrictEqual(answering.activity, { kind: "answering" });

    const end = await p.until((c) => !c.running);
    // 끝나면 볼 활동이 없다 — `partial`과 같은 근거(§7)
    assert.strictEqual(end.activity, null);
  });
});

test("§7 §세션 정보 한 줄 — 모델은 `system`/`init` 레코드에서 와 대화 줄에 한 번 적힌다", async () => {
  const project = { id: "model-test", name: "큐", root: CWD };
  await withFake("", async () => {
    assert.strictEqual(await startAsk(project, "질문"), null);
    await poller(project.id).until((c) => !c.running);
  });
  const home = await readHome(project.id);
  assert.strictEqual(home.conversations[0]?.model, "claude-test-model");
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

test("실패 ⑤ 기타(레이트리밋 등) — subtype이 항상 success라 그 원문이 배너에 새면 안 된다(87a80b94)", async () => {
  const project = { id: "ratelimit-test", name: "큐", root: CWD };
  await withFake("ratelimit", async () => {
    assert.strictEqual(await startAsk(project, "질문"), null);
    const end = await poller(project.id).until((c) => !c.running);
    assert.strictEqual(end.failed?.reason, "other");
    assert.match(end.failed?.output ?? "", /weekly limit hit/);
    assert.doesNotMatch(end.failed?.output ?? "", /success/);
  });
});

test("한 대화에 한 질문 — 둘째는 기다리지 않고 거절되고, 폴링 한 번이 답을 집어 간다", async () => {
  // `claude`를 못 찾게 만들어 질문 하나를 **즉시** 끝낸다(§24 실패 ① spawn). 진짜 세션을
  // 띄우지 않고도 이 파일이 지키는 것(맵의 수명 · 실패 코드 · 다시 열림)이 전부 걸린다.
  const project = { id: "busy-test", name: "큐", root: path.join(LOCAL, "nowhere/.dira") };
  const path0 = process.env.PATH;
  process.env.PATH = "";
  try {
    assert.strictEqual(await startAsk(project, "질문 하나"), null); // 시작했다
    // 이 질문은 **이미 끝났다**(spawn이 즉시 실패한다) — 그래서 `도는 중`은 아니다.
    assert.strictEqual(isAsking(project.id), false);

    // 같은 대화의 둘째 — 큐잉이 아니라 **거절**이다(§7: 동시 실행 제한 층을 만들지 않는다).
    // 끝났어도 **아무도 안 집어 간 결과 객체가 그 줄에 있으면** 거절이다: 덮으면 그 실패가
    // 사람에게 한 번도 안 보인다(§7 §끝난 답을 아무도 안 집어 가는 창).
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

/** **대화마다 따로 돈다**(§7 §대화마다 따로 돈다 — 요구 `4e9e54c5`, 답 `16601d5c` = (b)).
 *
 *  다섯을 한 픽스처에 건다. 다섯이 한 테스트인 이유는 전부 **맵의 키 하나**가 프로젝트에서
 *  세션으로 갈린 결과여서다 — 따로 재면 A가 도는 동안이라는 조건을 다섯 번 다시 만들어야 한다.
 *
 *  1. A가 도는 동안 **B의 질문이 받아들여진다**(종전에는 `busy`였다).
 *  2. **같은 대화의** 둘째 질문은 종전대로 실패 ④다.
 *  3. `runningSessions`에 **둘 다** 든다. `running`은 보고 있는 대화(B)의 것이다.
 *  4. `중지`가 **그 대화의 자식만** 죽인다 — B는 그대로 돈다.
 *  5. **끝난 A의 결과 객체가 그 대화를 여는 폴링까지 남고**, `running`은 그 사이 false다. */
test("대화마다 따로 돈다 — A가 도는 중 B가 받아들여지고, 같은 대화 둘째만 `busy`다", async () => {
  const id = "concurrent";
  const project = { id, name: "큐", root: CWD };
  await withFake("hang", async () => {
    const a = await newConversation(id);
    assert.strictEqual(await startAsk(project, "A 질문"), null);
    await poller(id).until((c) => c.partial !== ""); // A가 실제로 떴다

    // ② 같은 대화의 둘째 — 문구도 코드도 무수정이다
    const again = await startAsk(project, "A 둘째");
    assert.strictEqual(again?.ok, false);
    assert.strictEqual(again?.reason, "busy");
    assert.strictEqual(again?.sessionId, a);

    // ① 다른 대화는 받는다 — 잠긴 단위가 프로젝트가 아니라 대화다
    const b = await newConversation(id);
    assert.notStrictEqual(b, a);
    assert.strictEqual(await startAsk(project, "B 질문"), null);

    // ③ 도는 목록에 둘 다 든다. `running`은 보고 있는 대화(= `current` = B)의 것이다
    const both = await poller(id).until((c) => c.runningSessions.length === 2);
    assert.deepStrictEqual([...both.runningSessions].sort(), [a, b].sort());
    assert.strictEqual(both.sessionId, b);
    assert.strictEqual(both.running, true);

    // ④ `중지`는 A의 자식 하나만 죽인다 — B를 멈추는 경로가 없다
    assert.strictEqual(stopAsk(a), true);
    const onlyB = await poller(id).until((c) => c.runningSessions.length === 1);
    assert.deepStrictEqual(onlyB.runningSessions, [b]);
    assert.strictEqual(onlyB.running, true); // 보고 있는 B는 그대로 돈다

    // ⑤ 끝난 A를 집어 갈 폴링이 여태 없었다. **그래도 결과가 남아 있다** — 안 남기면 A에서 난
    //    실패 5종이 사람에게 한 번도 안 보인다. 그리고 남아 있는 동안 A는 `도는 중`이 아니다
    assert.strictEqual(await switchConversation(id, a), true);
    const seenA = await pollHome(id, null, 0);
    assert.strictEqual(seenA.sessionId, a);
    assert.strictEqual(seenA.running, false); // 맵에 있어도 `result`가 찼으면 안 돈다
    assert.strictEqual(seenA.answered, true); // 이 폴링이 집어 갔다
    assert.strictEqual(seenA.stopped, true);
    assert.deepStrictEqual(seenA.runningSessions, [b]); // B는 여전히 돈다
    // 집어 간 뒤에는 없다 — 같은 것을 두 번 그리지 않는다(종전과 같은 선)
    assert.strictEqual((await pollHome(id, null, 0)).answered, false);

    stopAsk(b);
    await poller(id).until((c) => c.runningSessions.length === 0);
  });
});

/** 좌측 패널의 워커 세션 그룹 — **큐에서 파생되고 저장되지 않는다**(§7 좌측 패널 · `e85e8186`).
 *
 *  네 판정을 한 픽스처에 걸어 둔다. 넷이 한 테스트인 이유는 셋이 **같은 한 칸**(`current`)의
 *  갈래여서다: 무엇을 가리키느냐에 따라 화면이 대화 · 워커 세션 · 온보딩으로 갈린다.
 *
 *  1. **`current`가 큐에서 사라진 세션이면 대화 0건과 같다** — 500도 실패 ⑤도 아니다.
 *  2. **고르면 그 세션의 트랜스크립트가 그려지고 `conversations`에 줄이 안 생긴다**(답 2(c)).
 *  3. **끝난 워커 세션에 이어 묻기는 `--resume <워커 sid>` + 홈 플래그 한 벌이다**(답 1(b)).
 *  4. **도는 워커 세션에는 이어 묻지 못한다** — 화면의 잠금과 별개로 서버가 거절한다. */
test("워커 세션 — 사라진 `current`는 대화 0건과 같고, 고르면 그 트랜스크립트가 그려지고, 이어 묻기는 `--resume`이다", async () => {
  const id = "worker-sessions";
  const root = path.join(mkdtempSync(path.join(tmpdir(), "ha-ws2-")), ".dira");
  tmps.push(path.dirname(root));
  mkdirSync(path.join(root, "tickets"), { recursive: true });
  // 자식의 cwd는 큐의 부모다 — `mkdtemp`가 만든 그 디렉터리라 이미 실재한다
  writeFileSync(registryPath(), JSON.stringify({ version: 1, projects: [{ id, name: "큐", root }] }));

  const run = uuid(51); // 도는 워커 세션(`.wip`)
  const done = uuid(52); // 끝난 워커 세션(`.done`)
  const ghost = uuid(53); // 큐에 없는 세션 — 티켓이 사라진 뒤의 `current`
  const put = (name: string, fm: string) =>
    writeFileSync(path.join(root, "tickets", name), `---\n${fm}---\n\n본문\n`);
  put("aaaa1111.wip.md", `ticket: aaaa1111\ntitle: 도는 티켓\nsession_id: ${run}\nowner: developer / w1-deadbeef\n`);
  put("aaaa2222.done.md", `ticket: aaaa2222\ntitle: 끝난 티켓\nsession_id: ${done}\nowner: pm / w3-deadbeef\n`);
  // 워커 세션의 트랜스크립트는 **워크트리 cwd 슬러그** 아래 산다 — `findTranscript`가 cwd와
  // 무관하게 찾는다는 것이 이 티켓이 서는 근거다(§7 실측, `b96e7996`)
  writeFileSync(
    path.join(TRANSCRIPTS, `${done}.jsonl`),
    JSON.stringify({
      type: "user",
      uuid: "wq",
      timestamp: "2026-08-01T05:00:00.000Z",
      message: { role: "user", content: "워커가 받은 지시" },
    }) +
      "\n" +
      JSON.stringify({
        type: "assistant",
        uuid: "wa",
        timestamp: "2026-08-01T05:00:09.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "워커가 한 말" }] },
      }) +
      "\n",
  );

  // ① 사라진 세션을 가리키는 `current`. 파일에는 그 값이 그대로 있다(관문은 `sessionIdOf`뿐)
  writeFileSync(sessionsPath(), JSON.stringify({ [id]: { conversations: [], current: ghost } }));
  assert.strictEqual((await readHome(id)).current, ghost);
  const gone = await pollHome(id, null, 0);
  assert.strictEqual(gone.sessionId, null); // **대화 0건과 같다** — 체크가 갈 자리가 없다
  assert.deepStrictEqual(gone.turns, []);
  assert.strictEqual(gone.failed, null); // 실패 ⑤가 아니다(줄 자체가 없다)
  // 목록은 그대로 선다 — 도는 것이 먼저고 워커 이름·제목·해시가 큐에서 온다
  assert.deepStrictEqual(
    gone.workers.map((w) => [w.id, w.worker, w.title, w.hash, w.running]),
    [
      [run, "w1", "도는 티켓", "aaaa1111", true],
      [done, "w3", "끝난 티켓", "aaaa2222", false],
    ],
  );
  assert.strictEqual(await switchConversation(id, ghost), false); // 실재하지 않는 줄은 안 받는다

  // ② 고르면 그 세션이 홈 스레드에 열린다. **`conversations`에 줄이 안 생긴다**
  assert.strictEqual(await switchConversation(id, done), true);
  const opened = await pollHome(id, null, 0);
  assert.strictEqual(opened.sessionId, done);
  assert.deepStrictEqual(opened.turns.map((t) => t.text), ["워커가 받은 지시", "워커가 한 말"]);
  assert.deepStrictEqual(opened.conversations, []); // 바뀐 것은 `current` 한 칸이다
  assert.deepStrictEqual((await readHome(id)).conversations, []);

  // ③ 끝난 워커 세션에 이어 묻기 — 홈 플래그 한 벌 · `--resume <워커 sid>`
  const project = { id, name: "큐", root };
  await withFake("", async () => {
    assert.strictEqual(await startAsk(project, "이 세션에서 무엇을 했나"), null);
    await poller(id).until((c) => !c.running);
  });
  const argv = readFileSync(ARGV, "utf8").trim().split("\n");
  assert.match(argv.at(-1) ?? "", new RegExp(`^-p --resume ${done} `));
  assert.match(argv.at(-1) ?? "", /--tools Read,Glob,Grep,Write,Edit --strict-mcp-config --permission-mode manual/);
  // 경로 스코프가 **이 프로젝트의 큐 루트**로 서 있다(`toolFlags(root)` — 상수 배열이면 못 하는 일이다)
  assert.ok((argv.at(-1) ?? "").includes(`Edit(//${root}/personas/**)`));
  // 아카이빙 산출물 둘도 **큐 루트 아래**다 — repo 기준 항이 0이다(개정 `22a803de`)
  assert.ok((argv.at(-1) ?? "").includes(`Write(//${root}/AGENTS.md)`));
  assert.ok(!(argv.at(-1) ?? "").includes(`//${path.dirname(root)}/DIRA.md`));
  assert.ok((argv.at(-1) ?? "").includes(`Edit(//${root}/tickets/**)`));
  assert.ok(!(argv.at(-1) ?? "").includes(`Write(//${root}/tickets/**)`));
  // **이 큐엔 `personas/`가 없다** — 프롬프트 첫 줄이 스냅샷이다(argv 로그는 첫 줄만 남는다).
  // 페르소나가 없는 큐에서 홈이 그대로 도는 것이 계약이다(§7 — WARN도 없다)
  assert.match(argv.at(-1) ?? "", / --verbose # 지금 이 프로젝트의 상태$/);

  // ③-b 페르소나 파일이 생기면 **다음 질문부터** 프롬프트 맨 앞에 선다. 이 한 줄이
  //     `resolveConfig` → `personaBlock` → `buildPrompt` → spawn까지 이어졌음의 증거다.
  const profileDir = path.join(root, "personas", "archive-manager");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(path.join(profileDir, "PROFILE.md"), "나는 이 큐의 아카이브 담당이다.\n");
  await withFake("", async () => {
    assert.strictEqual(await startAsk(project, "이제 누구냐"), null);
    await poller(id).until((c) => !c.running);
  });
  assert.match(
    readFileSync(ARGV, "utf8").trim().split("\n").at(-1) ?? "",
    /--verbose 당신은 이 프로젝트의 'archive-manager'입니다\. /,
  );
  // 이어 물어도 대화 목록은 0건이다 — 사람 대화 20을 워커 세션이 밀어내지 않는다
  assert.deepStrictEqual((await readHome(id)).conversations, []);
  assert.strictEqual((await readHome(id)).current, done);

  // ④ 도는 워커 세션 — 서버가 거절한다(화면의 `보내기` 잠금은 폼 상태라 새로고침에 풀린다)
  assert.strictEqual(await switchConversation(id, run), true); // 보는 것까지는 선다
  const refused = await startAsk(project, "지금 무엇을 하고 있나");
  assert.strictEqual(refused?.ok, false);
  assert.strictEqual(refused?.reason, "other"); // 여섯 번째 실패 코드를 안 만든다
  assert.match(refused?.output ?? "", /도는 워커 세션에는 여기서 말을 걸 수 없습니다 · 참견은 aaaa1111 상세에서/);
  assert.strictEqual(isAsking(id), false); // 세션을 아예 안 띄웠다
});

test("폴링을 끊는 근거는 `running`이 아니라 **답이 왔다**다 (§7 §폴링은 서버가 잊어도 안 끊긴다)", () => {
  const answer = { key: "1", role: "answer" as const, text: "답" };
  const chunk = (c: Partial<Parameters<typeof pollDone>[0]>) =>
    pollDone({ running: false, turns: [], answered: false, ...c });

  // ① **정상 종료 — `turns`가 비어도 끝이다.** 이 한 줄이 QA `0a284011`이 잡은 자리다:
  //    답 줄은 프로세스가 죽기 한참 전에 트랜스크립트에 서고 도는 중의 폴링이 그것을 이미
  //    집어 갔다(`offset`이 밀렸다). 실행층이 결과 객체를 넘긴 것(`answered`)이 근거다.
  assert.strictEqual(chunk({ answered: true }), true);
  // ② 빈 종료 — `running: false`인데 아무 증거도 없다. `runs`가 휘발한 자리다(dev recompile).
  //    **안 끊는다** — 종전에는 여기서 끊어서 화면이 질문만 든 채 얼었다.
  assert.strictEqual(chunk({}), false);
  // ③ 도는 중 — 예나 지금이나 안 끊는다.
  assert.strictEqual(chunk({ running: true }), false);
  // ④ 휘발한 뒤의 복구 경로. 맵이 없어 `answered`는 영영 false이고, 늦게 끝낸 자식이 쓴 답
  //    줄을 집어 가는 이 폴링이 끊는 자리다.
  assert.strictEqual(chunk({ turns: [answer] }), true);
  // ⑤ 실패·`중지됨`은 따로 안 본다 — 둘 다 결과 객체가 있어야 채워지므로 ①에 이미 든다.
  //    글자 한 자 오기 전에 누른 `중지`(새 줄도 실패도 없다)가 그 경계다.
  assert.strictEqual(chunk({ answered: true, turns: [] }), true);
});

/** **답이 뜬 그 폴링에서 잠금을 푼다**(`ef6cfc76` — QA `0a284011` 실측 재현).
 *
 *  위 단위 판정을 실행층 왕복에 걸어 둔다: 눈으로는 `pollDone`의 두 항이 다 그럴듯해서
 *  (`turns`도 끝의 증거이긴 하다) **어느 응답에 무엇이 들어 있는지**를 재야 갈린다. */
test("답 줄을 도는 중에 집어 가도 프로세스가 죽는 폴링에서 끊는다 (`turns`가 빈 종료)", async () => {
  const project = { id: "late-exit", name: "큐", root: CWD };
  await withFake("late", async () => {
    assert.strictEqual(await startAsk(project, "질문"), null);
    const p = poller(project.id);

    // ① 답 줄이 **도는 중에** 온다 — 여기서 `offset`이 밀린다. 아직 끝이 아니다
    const mid = await p.until((c) => c.turns.length > 0);
    assert.strictEqual(mid.running, true);
    assert.strictEqual(mid.answered, false);
    assert.strictEqual(mid.done, false);

    // ② 프로세스가 죽는 폴링 — **`turns`는 비어 있는데 끝이다.** 종전에는 여기가 false라
    //    화면이 천장 5분까지 `보내기`·패널 줄·`새 대화`를 잠갔다(실측 295~300초)
    const end = await p.until((c) => !c.running);
    assert.deepStrictEqual(end.turns, []);
    assert.strictEqual(end.answered, true);
    assert.strictEqual(end.done, true);
    assert.deepStrictEqual(p.turns, ["물음", "답"]); // 답은 이미 화면에 있다
  });
});
