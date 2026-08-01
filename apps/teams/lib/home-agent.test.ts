import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 락 디렉터리(~/.config/dira/run)도 진짜 레지스트리도 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "ha-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { renderSnapshot, buildPrompt, sessionsPath, readSessionId, writeSessionId, clearSessionId } =
  await import("./home-agent.ts");
const { resolveConfig } = await import("./projects.ts");
const { listTickets } = await import("./queue.ts");
const { listWorkers, lockPath } = await import("./workers.ts");

const tmps: string[] = [LOCAL];
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

test("session id 한 줄 — 쓰고 · 읽고 · 지운다. UUID가 아니면 없는 것과 같다", async () => {
  assert.strictEqual(sessionsPath(), path.join(LOCAL, "home-sessions.json"));
  assert.strictEqual(await readSessionId("p1"), null); // 파일이 없다

  const sid = "021f80d9-294c-4bea-948b-3b6f0c45016b";
  await writeSessionId("p1", sid);
  await writeSessionId("p2", "11111111-2222-3333-4444-555555555555");
  assert.strictEqual(await readSessionId("p1"), sid);

  // 한 프로젝트를 지워도 나머지는 남는다 — 파일 하나에 프로젝트 전부가 산다
  await clearSessionId("p1");
  assert.strictEqual(await readSessionId("p1"), null);
  assert.strictEqual(await readSessionId("p2"), "11111111-2222-3333-4444-555555555555");

  // 사람이 손으로 고친 값. 이게 통과하면 `--resume`과 트랜스크립트 글롭에 그대로 흘러간다
  writeFileSync(sessionsPath(), JSON.stringify({ p3: "../../etc/passwd", p4: 7 }));
  assert.strictEqual(await readSessionId("p3"), null);
  assert.strictEqual(await readSessionId("p4"), null);

  // 깨진 JSON은 빈 맵이다 — 홈 화면이 500이 되는 것보다 대화 하나를 새로 시작하는 게 낫다
  writeFileSync(sessionsPath(), "{ not json");
  assert.strictEqual(await readSessionId("p2"), null);
});
