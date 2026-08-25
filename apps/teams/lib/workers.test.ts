import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { listTickets } from "./queue.ts";
import { tokensPath } from "./auth.ts";

// 진짜 락 디렉터리(~/.config/dira/run)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  alertsPath,
  markAlertsRead,
  applyCommonSource,
  applyDispatchGate,
  applyExecBit,
  applySelfHeal,
  commonSourceLine,
  copyContext,
  createWorker,
  cronLine,
  cronRegister,
  cronRegisterCmd,
  cronUnregister,
  cronUnregisterCmd,
  cronWriteError,
  deleteWorker,
  execBitCmd,
  DISPATCH_GATE_FILE,
  dispatchGateSh,
  dispatchGateSourceLine,
  dispatchGateState,
  SELF_HEAL_FILE,
  SELF_HEAL_SH,
  selfHealSourceLine,
  engineArgv,
  engineCell,
  exampleWorkers,
  ENGINES,
  NO_MODEL,
  parseEngineValue,
  personaEngineHint,
  renderEngineBlock,
  registerCron,
  engineName,
  holderEngine,
  lastLogByWorker,
  limitWaitUntil,
  lockPath,
  listWorkers,
  nextWorkerName,
  parseContextBlock,
  readCommonContext,
  reassignCount,
  renderContextBlock,
  startWorker,
  stopWorker,
  prepareWorktree,
  rewriteOntology,
  workerGroups,
  workerOf,
  worktreeCmds,
  writeCommonContext,
  writeContext,
  writeOntology,
  readAlerts,
  unarchivedFailures,
  unarchivedResumes,
  archivedRows,
} = await import("./workers.ts");

const SFX = { inProgress: ".wip", done: ".done" };

const tmps: string[] = [LOCAL];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** 락은 디렉터리 + 안의 pid 파일. tick.sh와 같은 모양으로 만든다. */
function putLock(workersDir: string, name: string, pid: number | null) {
  const dir = lockPath(workersDir, name);
  mkdirSync(dir, { recursive: true });
  if (pid !== null) writeFileSync(path.join(dir, "pid"), String(pid));
}

test("lockPath — tick.sh의 파이썬 sha1과 한 글자도 다르지 않다", () => {
  const workers = "/Users/x/Projects/p/.dira/workers";
  // tick.sh: LOCK="$LOCAL/run/$TICKET_NAME-$(python3 -c 'sha1(argv[1])[:8]' "$WORKERS/$TICKET_NAME").lock"
  const h = execFileSync(
    "python3",
    [
      "-c",
      "import hashlib,sys;print(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:8])",
      `${workers}/w1`,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.strictEqual(lockPath(workers, "w1"), path.join(LOCAL, "run", `w1-${h}.lock`));
});

test("engineName — tick.sh:52의 basename \"${TICKET_ENGINE[0]}\"과 판정이 같다 (§0-4)", () => {
  // 인증 배너를 켜고 끄는 판정이다 — 눈으로 맞추지 않고 **셸에 같은 값을 물어서** 맞춘다.
  const cases = [
    // tick.sh 46행의 기본값(워커가 TICKET_ENGINE을 안 쓰면 이게 돈다)
    'claude -p "{prompt}" --session-id "{sid}" --dangerously-skip-permissions --output-format json',
    '/usr/local/bin/claude -p "{prompt}" --session-id "{sid}"', // 절대경로
    '"/usr/local/bin/claude" -p "{prompt}"', // 따옴표 친 절대경로
    'codex exec --dangerously-bypass-approvals-and-sandbox "{prompt}"', // 다른 엔진
    // 셋째 엔진(§4-3 §grok). basename 판정은 claude·codex와 **같은 식 하나**여야 한다
    'grok -p "{prompt}" --session-id "{sid}" --permission-mode bypassPermissions',
  ];
  for (const engine of cases) {
    const bash = execFileSync(
      "bash",
      ["-c", `TICKET_ENGINE=(${engine}); basename "\${TICKET_ENGINE[0]}"`],
      { encoding: "utf8" },
    ).trim();
    assert.strictEqual(engineName(engine), bash, engine);
  }
  assert.strictEqual(engineName(cases[3]), "codex"); // 이 워커에는 배너가 안 선다
  assert.strictEqual(engineName(cases[4]), "grok"); // 여기도 안 선다 — 같은 함수가 판정한다
  assert.strictEqual(engineName(""), ""); // 값이 깨져 못 읽었으면 claude가 아니다 = 이름도 없다
  // 엔진 수정 24번째(§제약 1 §결정 기록): 고정 경로 이름 `dira`는 claude로 정규화한다.
  // bash의 순정 basename과는 여기서 갈리므로(값이 "dira") 위 for 루프 밖에서 따로 고정한다.
  assert.strictEqual(engineName('dira -p --session-id "x"'), "claude");
  // 엔진 수정 27번째 계약 3: dira-<x> -> <x>(tick.sh:552와 같은 판정).
  assert.strictEqual(
    engineName('"/Users/x/.config/dira/bin/dira-codex" exec --json "{prompt}"'),
    "codex",
  );
});

test("engineName·parseEngineValue — 고정 경로를 쓰는 오늘의 페르소나 값이 표준으로 읽힌다 (§27)", () => {
  // .dira/personas/developer/engine이 오늘 실제로 쓰는 값 그대로다(사람 손으로 갱신되지 않는다,
  // §27 계약 5) — 카탈로그 argv[0]을 고정 경로로 안 바꾸면 이 값이 `parseEngineValue`에서
  // `null`로 읽혀 §비주얼 §23의 `커스텀` 배지가 서는 회귀(이 왕복이 시작된 증상)가 재현된다.
  const todaysPersonaValue =
    '"$HOME/.config/dira/bin/dira" -p --session-id "{sid}" --dangerously-skip-permissions ' +
    "--model sonnet --input-format stream-json --output-format stream-json --verbose";
  assert.notStrictEqual(parseEngineValue(todaysPersonaValue), null);
  assert.deepStrictEqual(parseEngineValue(todaysPersonaValue), {
    engineId: "claude",
    model: "sonnet",
  });
  assert.strictEqual(engineName(todaysPersonaValue), "claude");
});

test("listWorkers — running · stale · stopped 판정", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(root);
  const dir = path.join(root, "workers");
  mkdirSync(dir);
  for (const n of ["w1.sh", "w2.sh", "w3.sh", "runner.log"]) {
    writeFileSync(path.join(dir, n), "#!/bin/bash\n");
  }

  putLock(dir, "w1", process.pid); // 이 테스트 프로세스는 살아 있다
  putLock(dir, "w2", 0x7ffffff0); // 있을 수 없는 pid = 죽은 락

  const ws = await listWorkers(root);
  assert.deepStrictEqual(
    ws.map((w) => `${w.name}:${w.status}`),
    ["w1:running", "w2:stale", "w3:stopped"], // .sh 아닌 파일은 워커가 아니다
  );
  assert.strictEqual(ws[0].lockPid, process.pid);
  // crontab에 없는 워커는 stopped다. 이 판정이 뒤집히면 목록 행이 거짓말을 한다.
  // 묶음 순서는 §2 4상태 표 순서다 — stale이 뒤에 서는 것이 이 assert의 요점이다(심각도 순 아님).
  assert.deepStrictEqual(workerGroups(ws), [
    { status: "running", names: ["w1"] },
    { status: "stopped", names: ["w3"] },
    { status: "stale", names: ["w2"] },
  ]);
  assert.deepStrictEqual(workerGroups([]), []);
});

test("exampleWorkers — 온보딩 예시 앞의 둘 (§비주얼 §24)", () => {
  const w = (name: string, status: string) => ({ name, status }) as Parameters<typeof exampleWorkers>[0][number];

  // 워커 0개 = 그 두 버튼을 안 그린다(예시 2개). 빈 문자열 이름을 만들어 내지 않는다.
  assert.deepStrictEqual(exampleWorkers([]), []);
  // 워커 하나뿐이면 같은 이름 두 번이다 — 없는 이름 한 번보다 낫다
  assert.deepStrictEqual(exampleWorkers([w("w1", "running")]), ["w1", "w1"]);
  // running이 없으면 목록의 첫 워커로 떨어진다(`쉬는 중`도 이 화면이 약속하는 답이다)
  assert.deepStrictEqual(exampleWorkers([w("w1", "stopped"), w("w2", "idle")]), ["w1", "w2"]);
  // running이 있으면 그게 <활성>이고, <다른>은 이름이 다른 첫 워커다(목록의 첫째가 아니다)
  assert.deepStrictEqual(exampleWorkers([w("w1", "idle"), w("w2", "running")]), ["w2", "w1"]);
});

test("nextWorkerName — 생성 다이얼로그 이름 칸 기본값 (§4-13)", () => {
  // 워커 0개면 w1
  assert.strictEqual(nextWorkerName([]), "w1");
  // 연속된 번호면 다음 번호
  assert.strictEqual(nextWorkerName(["w1", "w2", "w3"]), "w4");
  // 빈 번호(w3)를 메우지 않는다 — 방금 지운 워커의 자리다
  assert.strictEqual(nextWorkerName(["w1", "w2", "w4"]), "w5");
  // w<숫자> 꼴이 아닌 이름은 세는 데서 빠진다
  assert.strictEqual(nextWorkerName(["qa", "builder"]), "w1");
});

/** `crontab -l`을 가로챈다. 진짜 crontab을 읽으면 이 머신의 등록 상태에 따라 결과가 흔들린다.
 *  `execFile("crontab")`은 PATH로 찾으므로 스텁 디렉터리를 앞에 붙이면 된다. */
function withFakeCrontab(text: string): () => void {
  const bin = mkdtempSync(path.join(tmpdir(), "fst-bin-"));
  tmps.push(bin);
  const out = path.join(bin, "out.txt");
  writeFileSync(out, text);
  writeFileSync(path.join(bin, "crontab"), `#!/bin/sh\ncat ${JSON.stringify(out)}\n`, { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return () => {
    process.env.PATH = prev;
  };
}

test("cron 판정 — crontab은 NFC, 파일시스템 경로는 NFD인 한글 큐 (QA c53c4259)", async () => {
  // 실제로 있는 큐의 모양이다: 구글 드라이브 마운트가 realpath를 NFD로 돌려주고
  // crontab -l은 사람이 넣은 NFC 줄을 그대로 준다.
  const base = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(base);
  const root = path.join(base, "스트림(Stream)".normalize("NFD"));
  const dir = path.join(root, "workers");
  mkdirSync(dir, { recursive: true });
  for (const n of ["w1.sh", "w2.sh"]) writeFileSync(path.join(dir, n), "#!/bin/bash\n");

  const nfd = path.join(dir, "w1.sh");
  // 픽스처가 진짜 NFD인지 고정한다 — 같아지면 이 테스트는 아무것도 검증하지 않는다
  assert.notStrictEqual(nfd, nfd.normalize("NFC"));

  const restore = withFakeCrontab(
    `* * * * * "${nfd.normalize("NFC")}" >> "${path.join(dir, "cron.log").normalize("NFC")}" 2>&1\n`,
  );
  try {
    const [w1, w2] = await listWorkers(root);
    // 정규화 없이 includes하면 여기가 false/stopped다 — 화면이 등록을 권하고 중복 줄이 생긴다
    assert.strictEqual(w1.cron, true);
    assert.strictEqual(w1.status, "idle");
    // 등록 안 된 워커는 그대로 false다(정규화가 전부 true로 만들지 않는다)
    assert.strictEqual(w2.cron, false);
    assert.strictEqual(w2.status, "stopped");
    // path는 정규화하지 않는다 — cron 줄에 들어가 셸이 실제로 실행할 문자열이다
    assert.strictEqual(w1.path, nfd);
    assert.strictEqual(cronRegisterCmd(w1).includes(nfd), true);
  } finally {
    restore();
  }
});

test("listWorkers — workers/ 없으면 빈 배열(등록 검증은 tickets/만 있어도 통과한다)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(root);
  assert.deepStrictEqual(await listWorkers(root), []);
});

/** 워커·티켓이 있는 큐 하나. `<root>` 반환. */
function makeRoot(workers: Record<string, string>, tickets: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "fst-root-"));
  tmps.push(root);
  mkdirSync(path.join(root, "workers"));
  mkdirSync(path.join(root, "tickets"));
  for (const [n, body] of Object.entries(workers)) {
    const file = path.join(root, "workers", n);
    writeFileSync(file, body);
    // 워커 `.sh`만 755다(§0-21) — `writeFileSync`의 기본 모드는 실행 비트가 없어서, 여기서 안
    // 올리면 이 헬퍼를 쓰는 테스트 전부가 `no-exec` 결함을 하나씩 더 얻는다.
    if (n.endsWith(".sh")) chmodSync(file, 0o755);
  }
  for (const [n, body] of Object.entries(tickets)) writeFileSync(path.join(root, "tickets", n), body);
  return root;
}

test("TICKET_NAME 재정의 — 락·로그는 파일명이 아니라 실효 이름으로 간다 (tick.sh 37·87행)", async () => {
  const root = makeRoot({
    // README §워커 레퍼런스의 실제 예시: 파일명과 TICKET_NAME이 다르다
    "a.sh": '#!/bin/bash\nTICKET_NAME="reviewer"\nTICKET_ENGINE=(codex exec --json "{prompt}")\n',
  });
  const dir = path.join(root, "workers");
  writeFileSync(path.join(dir, "runner.log"), "2026-07-30 13:19:01 [reviewer] SKIP 물고 있다\n");
  putLock(dir, "reviewer", process.pid); // 파일명 a가 아니라 reviewer로 잡힌다

  const [w] = await listWorkers(root);
  assert.strictEqual(w.name, "a"); // 액션이 가리키는 건 파일이다
  assert.strictEqual(w.status, "running"); // 파일명으로 찾았으면 stopped로 거짓말했다
  assert.strictEqual(w.engine, 'codex exec --json "{prompt}"');
  assert.match(w.recentLog[0], /\[reviewer\] SKIP/);
});

test("recentLog — 이 워커의 최근 20줄, 최신이 앞 (§4-7)", async () => {
  const root = makeRoot({
    "w1.sh": "#!/bin/bash\n",
    "w2.sh": "#!/bin/bash\n",
    "w3.sh": "#!/bin/bash\n",
  });
  const lines: string[] = [];
  // w1은 25줄(20줄 상한을 넘긴다) · w2는 1줄 · w3은 0줄(파일에 아예 없다)
  for (let i = 1; i <= 25; i++) lines.push(`2026-08-03 00:00:${String(i).padStart(2, "0")} [w1] SKIP ${i}`);
  lines.push("2026-08-03 00:01:00 [w2] DISPATCH abcd1234 kind=work sid=zzz log=x.log", "");
  writeFileSync(path.join(root, "workers", "runner.log"), lines.join("\n"));

  const ws = Object.fromEntries((await listWorkers(root)).map((w) => [w.name, w]));
  assert.strictEqual(ws.w1.recentLog.length, 20); // 상한
  assert.match(ws.w1.recentLog[0], /SKIP 25$/); // 최신이 앞 — 셀이 쓰는 값이다
  assert.match(ws.w1.recentLog[19], /SKIP 6$/); // 오래된 쪽이 뒤
  // 남의 줄이 안 섞인다 + 시각 접두어까지 줄 그대로다(가공 0)
  assert.ok(ws.w1.recentLog.every((l) => l.includes("[w1]")));
  assert.deepStrictEqual(ws.w2.recentLog, [
    "2026-08-03 00:01:00 [w2] DISPATCH abcd1234 kind=work sid=zzz log=x.log",
  ]);
  assert.deepStrictEqual(ws.w3.recentLog, []); // 줄이 0개 — 셀은 `—`에 `disabled`다
});

test("reassignCount — DISPATCH 줄 수 빼기 1, 다른 해시는 안 세고 없으면 0 (§2-14 (2))", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n" });
  const dispatch = (n: number, hash: string) =>
    `2026-08-03 00:00:${String(n).padStart(2, "0")} [w1] DISPATCH ${hash} kind=work persona=dev sid=x log=x.log`;
  writeFileSync(
    path.join(root, "workers", "runner.log"),
    [
      dispatch(1, "aaaa1111"), // aaaa1111: 1줄 — 값이 없다(첫 디스패치는 재시도가 아니다)
      dispatch(2, "bbbb2222"), // bbbb2222: 3줄 — 값이 2다
      dispatch(3, "bbbb2222"),
      dispatch(4, "bbbb2222"),
      "",
    ].join("\n"),
  );

  assert.strictEqual(await reassignCount(root, "aaaa1111"), 0); // 1개면 값이 없다(호출부가 0을 "줄 없음"으로 받는다)
  assert.strictEqual(await reassignCount(root, "bbbb2222"), 2); // 3개면 2다
  assert.strictEqual(await reassignCount(root, "cccc3333"), 0); // 줄이 아예 없는 해시 — 남의 DISPATCH를 안 센다
});

test("lastLogByWorker — 페르소나별 DISPATCH -> DONE 페어링 (§5-6 §실측)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n" });
  writeFileSync(
    path.join(root, "workers", "runner.log"),
    [
      "2026-08-01 00:00:00 [w1] DISPATCH aaaa1111 kind=work persona=dev sid=x log=x.log prio=3",
      "2026-08-01 00:10:00 [w1] DONE aaaa1111 sid=x",
      // 다른 페르소나 줄은 안 섞인다
      "2026-08-01 00:11:00 [w1] DISPATCH bbbb2222 kind=work persona=pm sid=y log=y.log prio=3",
      "2026-08-01 00:20:00 [w1] DONE bbbb2222 sid=y",
      "",
    ].join("\n"),
  );

  const { personaRuns, logStart } = await lastLogByWorker(path.join(root, "workers"));
  assert.deepStrictEqual(personaRuns.dev, [
    { hash: "aaaa1111", verb: "DONE", dispatchAt: "2026-08-01 00:00:00", endAt: "2026-08-01 00:10:00" },
  ]);
  assert.deepStrictEqual(personaRuns.pm, [
    { hash: "bbbb2222", verb: "DONE", dispatchAt: "2026-08-01 00:11:00", endAt: "2026-08-01 00:20:00" },
  ]);
  assert.strictEqual(logStart, "2026-08-01 00:00:00"); // 로그가 닿는 가장 이른 줄
});

test("lastLogByWorker — 짝이 없는 DISPATCH는 페어링을 안 만든다 (아직 도는 실행 · 종료 없이 로그가 끝남)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n" });
  writeFileSync(
    path.join(root, "workers", "runner.log"),
    [
      // aaaa1111: DISPATCH만 있고 종료가 없다 — 지금 도는 티켓
      "2026-08-01 00:00:00 [w1] DISPATCH aaaa1111 kind=work persona=dev sid=x log=x.log prio=3",
      "",
    ].join("\n"),
  );

  const { personaRuns } = await lastLogByWorker(path.join(root, "workers"));
  assert.deepStrictEqual(personaRuns.dev ?? [], []); // 짝이 없으니 실행 0건 — 지어내지 않는다
});

test("주석 처리된 할당문은 설정이 아니다 (worker.sh.example이 통째로 주석이다)", async () => {
  const root = makeRoot({
    "w1.sh": '#!/bin/bash\n# TICKET_NAME="w9"\n# TICKET_ENGINE=(codex exec)\n. "$HOME/x/tick.sh"\n',
  });
  const [w] = await listWorkers(root);
  assert.strictEqual(w.name, "w1");
  assert.strictEqual(w.engine, null); // 대입이 아예 없다 = tick.sh 기본값으로 돈다
  // 주석의 TICKET_NAME=w9를 먹었다면 락을 엉뚱한 이름으로 찾는다
  putLock(path.join(root, "workers"), "w1", process.pid);
  assert.strictEqual((await listWorkers(root))[0].status, "running");
});

test("작업 디렉터리 결함 — 3종을 판정하고 정상 워커에는 아무것도 붙이지 않는다 (§4)", async () => {
  // 실제 배치를 그대로 만든다: 큐가 `<base>/.dira`, 워크트리가 `<큐>/worktrees/<이름>`.
  // mkdtemp가 주는 /var/… 는 /private/var/… 의 심링크라서 realpath 없이 비교하면 전부 결함이 된다.
  const base = mkdtempSync(path.join(tmpdir(), "fst-base-"));
  tmps.push(base);
  const root = path.join(base, ".dira");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  const tree = (n: string) => path.join(root, "worktrees", n);
  /** 엔진 레포는 프로젝트(`dirname(root)`)와 **다른 자리**다 — dira가 자기를 도그푸딩해서 둘이
   *  같았던 게 `git -C`에 엔진 레포를 넣는 버그를 가렸다(§4 생성 4항의 3번). */
  const engine = path.join(base, "engine-repo");
  const wk = (cwd: string) => `#!/bin/bash\nTICKET_CWD="${cwd}"\nTICKET_CONTEXT=()\n. "${engine}/tick.sh"\n`;
  // 755다 — 이 테스트는 디렉터리 결함 3종만 본다. 실행 비트가 없으면 전원이 `no-exec`를 하나씩
  // 더 얻어 아래 deepStrictEqual이 깨진다(그 판정은 별도 테스트가 덮는다, §0-21).
  const put = (name: string, cwd: string) => {
    const file = path.join(root, "workers", `${name}.sh`);
    writeFileSync(file, wk(cwd));
    chmodSync(file, 0o755);
  };
  /** 사람이 손으로 만드는 상태: 트리 + `.dira -> ../..` */
  const prepare = (n: string) => {
    mkdirSync(tree(n), { recursive: true });
    symlinkSync("../..", path.join(tree(n), ".dira"));
  };

  put("ok", tree("ok"));
  prepare("ok");
  put("gone", tree("gone")); // 트리를 안 만든다
  put("nolink", tree("nolink"));
  mkdirSync(tree("nolink"), { recursive: true }); // 트리는 있고 심링크가 없다
  put("bait", tree("bait")); // `ln -s` 함정: .dira 안쪽에 링크가 생긴 상태
  mkdirSync(path.join(tree("bait"), ".dira"), { recursive: true });
  symlinkSync("../../..", path.join(tree("bait"), ".dira", ".dira"));
  put("s1", tree("shared")); // 두 워커가 한 트리를 가리킨다
  put("s2", tree("shared"));
  prepare("shared");

  const ws = await listWorkers(root);
  assert.deepStrictEqual(
    ws.map((w) => [w.name, w.defects.map((d) => d.kind)]),
    [
      ["bait", ["missing-link"]], // 존재 확인만 했으면 통과했다 — realpath가 판정이다
      ["gone", ["missing-cwd"]], // 트리가 없으면 심링크를 따로 말하지 않는다(원인은 하나)
      ["nolink", ["missing-link"]],
      ["ok", []], // 정상 워커에는 결함도 준비 명령도 붙지 않는다
      ["s1", ["shared-cwd"]],
      ["s2", ["shared-cwd"]],
    ],
  );
  const by = (n: string) => ws.find((w) => w.name === n)!;
  assert.strictEqual(by("ok").worktree, undefined);
  assert.strictEqual(by("ok").cwd, tree("ok"));
  assert.match(by("bait").defects[0].detail, /큐 루트가 아니라/);
  assert.deepStrictEqual(by("s1").defects[0].detail, `s2와 같은 경로입니다: ${tree("shared")}`);
  // 준비 명령은 §4 생성의 3줄과 **같은 함수**에서 나온다. 화면 두 곳이 다른 문자열을 보여주면 안 된다.
  assert.deepStrictEqual(by("gone").worktree, worktreeCmds(root, "gone"));
  // `git -C`는 프로젝트(`dirname(root)`)다. 워커가 source하는 엔진 레포가 아니다.
  assert.deepStrictEqual(by("gone").worktree, [
    `git -C '${base}' worktree add '${tree("gone")}' -b wt/gone`,
    `ln -s ../.. '${path.join(tree("gone"), ".dira")}'`,
    `ls -ld '${path.join(tree("gone"), ".dira")}'    # \`l\`로 시작해야 한다`,
  ]);
});

test("작업 디렉터리 결함 — TICKET_CWD 줄이 없으면 엔진 기본값(루트의 부모)으로 판정한다", async () => {
  // tick.sh 39행. 이 기본값은 큐가 있는 디렉터리라 `<부모>/.dira`가 곧 큐 루트다 = 정상.
  const base = mkdtempSync(path.join(tmpdir(), "fst-base-"));
  tmps.push(base);
  const root = path.join(base, ".dira");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  const file = path.join(root, "workers", "w1.sh");
  writeFileSync(file, "#!/bin/bash\nTICKET_CONTEXT=()\n");
  chmodSync(file, 0o755); // 이 테스트는 cwd 판정만 본다 — no-exec는 별도 테스트가 덮는다
  const [w] = await listWorkers(root);
  assert.strictEqual(w.cwd, null);
  assert.deepStrictEqual(w.defects, []);
});

test("실행 비트 없음 — 판정·CopyCommand, status는 그대로다 (§0-21 결정 2 — 복구 버튼은 P290-4)", async () => {
  // 디렉터리 결함 3종과 섞이지 않게 "정상 배치"를 그대로 만든다(위 §4 테스트와 같은 자리) —
  // makeRoot의 기본 cwd(부모 디렉터리)는 tmp 루트를 공유해서 shared-cwd를 덧묻힌다.
  const base = mkdtempSync(path.join(tmpdir(), "fst-base-"));
  tmps.push(base);
  const root = path.join(base, ".dira");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  const tree = (n: string) => path.join(root, "worktrees", n);
  const engine = path.join(base, "engine-repo");
  const put = (name: string) => {
    const file = path.join(root, "workers", `${name}.sh`);
    writeFileSync(file, `#!/bin/bash\nTICKET_CWD="${tree(name)}"\nTICKET_CONTEXT=()\n. "${engine}/tick.sh"\n`);
    chmodSync(file, 0o755);
    mkdirSync(tree(name), { recursive: true });
    symlinkSync("../..", path.join(tree(name), ".dira"));
    return file;
  };
  const file1 = put("w1");
  const file2 = put("w2");
  const c = withLiveCrontab(`${cronLine({ path: file1 })}\n${cronLine({ path: file2 })}\n`);
  try {
    chmodSync(file2, 0o644); // 실행 비트를 뺀다 — cron이 Permission denied로 못 띄우는 그 상태

    const ws = await listWorkers(root);
    const by = (n: string) => ws.find((w) => w.name === n)!;

    // w1은 정상 — 경고도 준비 명령도 안 붙는다
    assert.deepStrictEqual(by("w1").defects, []);
    assert.strictEqual(by("w1").execFix, undefined);
    assert.strictEqual(by("w1").status, "idle");

    // w2에만 경고가 뜬다. status 배지는 종전 idle 그대로다(§0-21 결정 2 — 5번째 값을 안 만든다)
    assert.deepStrictEqual(by("w2").defects, [
      { kind: "no-exec", detail: `${file2} 에 실행 비트가 없습니다.` },
    ]);
    assert.strictEqual(by("w2").status, "idle");
    assert.strictEqual(by("w2").worktree, undefined); // 워크트리 준비 명령과는 무관하다(§0-21 결정 2·3)
    assert.strictEqual(by("w2").execFix, execBitCmd(file2));
    assert.strictEqual(by("w2").execFix, `chmod +x '${file2}'`);

    // 판정만 이 티켓의 몫이다 — chmod로 직접 고쳐도 다음 판정에서 사라진다(복구 버튼은 P290-4).
    chmodSync(file2, 0o755);
    assert.deepStrictEqual((await listWorkers(root)).find((w) => w.name === "w2")!.defects, []);
  } finally {
    c.restore();
  }
});

test("applyExecBit — 그 워커 .sh 하나만 755로 켜고 다른 워커 파일은 안 건드린다 (§0-21 결정 3, P290-4)", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "fst-base-"));
  tmps.push(base);
  const root = path.join(base, ".dira");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  const tree = (n: string) => path.join(root, "worktrees", n);
  const engine = path.join(base, "engine-repo");
  const put = (name: string) => {
    const file = path.join(root, "workers", `${name}.sh`);
    writeFileSync(file, `#!/bin/bash\nTICKET_CWD="${tree(name)}"\nTICKET_CONTEXT=()\n. "${engine}/tick.sh"\n`);
    chmodSync(file, 0o755);
    mkdirSync(tree(name), { recursive: true });
    symlinkSync("../..", path.join(tree(name), ".dira"));
    return file;
  };
  const file1 = put("w1");
  const file2 = put("w2");
  chmodSync(file2, 0o644); // 실행 비트를 뺀다 — 버튼이 눌리기 전 상태

  await applyExecBit(root, "w2");

  assert.strictEqual(statSync(file2).mode & 0o777, 0o755); // 그 워커는 켜졌다
  assert.strictEqual(statSync(file1).mode & 0o777, 0o755); // 다른 워커는 모드가 안 갈렸다
  assert.deepStrictEqual((await listWorkers(root)).find((w) => w.name === "w2")!.defects, []); // 재판정하면 결함이 없다
});

test("holding — .wip 티켓의 owner에서 워커를 되짚는다 (tick.sh 207행 표기)", async () => {
  const root = makeRoot(
    { "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" },
    {
      "aaa1.wip.md": "---\nticket: aaa1\nowner: developer / w1-064007b2\n---\n본문\n",
      // 완료된 티켓의 owner는 기록이지 현재가 아니다 — 여기 걸리면 안 된다
      "bbb2.done.md": "---\nticket: bbb2\nowner: qa / w2-deadbeef\n---\n본문\n",
    },
  );
  const tickets = await listTickets(root, SFX);
  const ws = await listWorkers(root, tickets);
  assert.deepStrictEqual(
    ws.map((w) => [w.name, w.holding]),
    [
      ["w1", "aaa1"],
      ["w2", null],
    ],
  );
  // 티켓을 안 넘기면 항상 null이다(프로젝트 목록 요약이 그렇게 부른다)
  assert.strictEqual((await listWorkers(root))[0].holding, null);
});

/** codex 워커에서 §2-1 스트림·§2-2 참견이 왜 없는지 화면이 말하는 근거(§4-3 · §비주얼 §23 ⑤).
 *  **판정은 이것 하나다** — 화면 두 자리(티켓 상세 · 워커 행)가 다른 식을 쓰면 한쪽이 조용히
 *  claude 전제 위에 남는다. 이게 뒤집히면 codex 워커에서 빈 스트림이 돌거나(사람은 고장으로
 *  읽는다) claude 워커에서 멀쩡한 참견 폼이 사유와 함께 잠긴다. */
test("holderEngine — 티켓을 물고 있는 워커의 엔진 하나. 모델은 안 본다 (§4-3)", async () => {
  const root = makeRoot(
    {
      // 대입이 없는 워커 = tick.sh 기본값(claude)으로 돈다 — 지금 이 큐의 워커 6개가 전부 여기다
      "w1.sh": "#!/bin/bash\n",
      // 모델을 골라도 판정은 안 갈린다: 죽는 이유가 CLI의 입출력 규약이지 모델이 아니다
      "w2.sh": '#!/bin/bash\nTICKET_ENGINE=(codex exec --json -m gpt-5.1-codex-max "{prompt}")\n',
      "w3.sh": '#!/bin/bash\nTICKET_ENGINE=("/usr/local/bin/claude" -p --model opus)\n',
    },
    {
      "aaa1.wip.md": "---\nticket: aaa1\nowner: developer / w1-064007b2\n---\n본문\n",
      "bbb2.wip.md": "---\nticket: bbb2\nowner: developer / w2-1a2b3c4d\n---\n본문\n",
      "ccc3.wip.md": "---\nticket: ccc3\nowner: developer / w3-5e6f7a8b\n---\n본문\n",
      // 완료 티켓은 아무도 안 물고 있다 — 되짚을 워커가 없다(빈 상태가 종전 그대로여야 한다)
      "ddd4.done.md": "---\nticket: ddd4\nowner: developer / w2-1a2b3c4d\n---\n본문\n",
    },
  );
  const tickets = await listTickets(root, SFX);
  const ws = await listWorkers(root, tickets);

  assert.strictEqual(holderEngine(ws, "aaa1"), "claude"); // 기본값도 실제로 도는 것은 claude다
  assert.strictEqual(holderEngine(ws, "bbb2"), "codex"); // 여기서만 스트림·참견이 사라진다
  assert.strictEqual(holderEngine(ws, "ccc3"), "claude"); // 절대경로 + 모델 지정 — 무회귀
  assert.strictEqual(holderEngine(ws, "ddd4"), null); // 완료 티켓 리플레이 = 모른다
  assert.strictEqual(holderEngine(ws, "없는티켓"), null);
  // 티켓을 안 넘긴 목록은 holding이 전부 null이라 아무것도 못 되짚는다(호출부가 넘겨야 한다)
  assert.strictEqual(holderEngine(await listWorkers(root), "bbb2"), null);
});

/** 칸반 카드의 워커 이름이 쓰는 **같은 규칙**(§1 보드 · §비주얼 §18). 형식이 아니면 `null`이고
 *  화면은 아무것도 안 그린다 — `?`도 안 그린다. */
test("workerOf — owner 표기에서 워커 이름 하나, 형식이 아니면 null", () => {
  assert.strictEqual(workerOf("developer / w6-83533def"), "w6"); // 정상
  assert.strictEqual(workerOf(""), null); // owner 없음
  assert.strictEqual(workerOf("w6-83533def"), null); // `/` 없음
  assert.strictEqual(workerOf("developer / w6-8353"), null); // 접미사 길이 불일치
  // 이름에 `-`가 있어도 sid 8자라는 길이로 갈린다(정규식을 안 짓는 이유)
  assert.strictEqual(workerOf("pm / build-2-83533def"), "build-2");
});

/** 워커 마크 ② 전문 자리 (§비주얼 §19). 테이블 `owner` 셀은 전문을 **값 무수정으로** 두고 그
 *  안의 워커 이름 구간만 칩으로 세운다 — 자르는 자리를 `components/worker-mark.tsx`가
 *  `owner.length - name.length - 9`로 계산한다(`workerOf`의 계약: 이름 뒤는 `-` + sid 8자).
 *  둘이 갈리면 셀에 엉뚱한 구간이 칩이 되거나 전문이 조용히 바뀐다. */
test("워커 마크 ② 전문 자리 — 자르고 붙이면 owner 원문 그대로다", () => {
  for (const owner of ["developer / w6-83533def", "pm / build-2-83533def", "x / a-12345678"]) {
    const name = workerOf(owner);
    assert.ok(name, owner);
    const at = owner.length - name.length - 9;
    assert.strictEqual(owner.slice(at, at + name.length), name); // 칩이 서는 구간이 이름이다
    assert.strictEqual(owner.slice(0, at) + name + owner.slice(at + name.length), owner); // 원문 무수정
  }
});

/** runner.log의 시각 표기(`tick.sh:35`의 `date '+%F %T'`, 로컬). **지금 기준 오프셋**으로
 *  만든다 — 고정 문자열이면 신선도 창(10분)이 도는지 확인할 수 없다. */
function stamp(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const LIMIT = "You've hit your session limit · resets 7:40pm (Asia/Seoul)";

test("lastFailure — 외부 요인으로 죽은 세션만, 신선할 때만 잡는다 (§0-5)", async () => {
  const names = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10"];
  const root = makeRoot(Object.fromEntries(names.map((n) => [`${n}.sh`, "#!/bin/bash\n"])));
  const dir = path.join(root, "workers");
  mkdirSync(path.join(dir, "logs"));

  /** `tick.sh:222`가 세션 stderr를 쌓고 마지막에 엔진 JSON 한 줄이 붙는다. */
  const putLog = (name: string, rec: object, noise = "세션 stderr\n") =>
    writeFileSync(path.join(dir, "logs", name), noise + JSON.stringify(rec) + "\n");

  const err = { is_error: true, terminal_reason: "api_error", result: LIMIT };
  for (const n of names) putLog(`fail-${n}.log`, err);
  // 실측 6건: `result: null`이라 사유가 `terminal_reason`뿐이다
  putLog("fail-w6.log", { is_error: true, terminal_reason: "aborted_streaming", result: null });
  // 정상 종료한 세션의 마지막 줄. 사유가 아니다
  putLog("fail-w7.log", { is_error: false, terminal_reason: null, result: "다 했습니다" });
  writeFileSync(path.join(dir, "logs", "fail-w8.log"), "JSON이 아니다\n");
  // 꼬리 64KB만 읽는지 — 100KB 앞에 두고도 마지막 줄을 집어야 한다(`readFile` 전체 읽기가 아니다)
  putLog("fail-w9.log", err, "x".repeat(100_000) + "\n");

  // 시각은 **한 번만** 만든다 — 픽스처와 단언에서 따로 부르면 초가 넘어갈 때 어긋난다.
  const [t20, t5, t4, t3, t2, t1] = [20, 5, 4, 3, 2, 1].map(stamp);
  const fail = (h: string, n: string) =>
    `FAIL ${h} rc=1 -> 할당 회수 + 백로그 복귀. 로그 fail-${n}.log`;
  writeFileSync(
    path.join(dir, "runner.log"),
    [
      // 1) FAIL + is_error → 실패
      `${t5} [w1] DISPATCH a1111111 kind=work persona=dev sid=xxx log=fail-w1.log`,
      `${t5} [w1] ${fail("a1111111", "w1")}`,
      // 2) FAIL 뒤에 DONE → null (다음 성공 tick에 저절로 꺼진다)
      `${t4} [w2] ${fail("b2222222", "w2")}`,
      `${t3} [w2] DONE b2222222 sid=yyy`,
      // 3) TIMEOUT → null (90분 상한에 걸린 매달린 세션이고 환경 탓이 아니다)
      `${t2} [w3] TIMEOUT c3333333 5400s 초과 강제종료 -> 할당 회수 + 백로그 복귀. 로그 fail-w3.log`,
      // 4) 마지막 줄이 DISPATCH여도 그 앞의 FAIL이 잡힌다 = 배너가 안 깜빡인다
      `${t2} [w4] ${fail("d4444444", "w4")}`,
      `${t1} [w4] DISPATCH d4444444 kind=work persona=dev sid=zzz log=x.log`,
      // 5) FAIL 뒤에 SKIP만 있고 10분 초과 → null (사흘 전 FAIL이 영원히 걸리지 않는다)
      `${t20} [w5] ${fail("e5555555", "w5")}`,
      `${t1} [w5] SKIP 물 티켓이 없다`,
      // 6) result: null → terminal_reason이 사유다
      `${t1} [w6] ${fail("f6666666", "w6")}`,
      // 7·8) is_error 아님 · JSON 아님 → null (사유를 지어내지 않는다)
      `${t1} [w7] ${fail("77777777", "w7")}`,
      `${t1} [w8] ${fail("88888888", "w8")}`,
      // 9) 로그가 100KB여도 꼬리에서 마지막 줄을 집는다
      `${t1} [w9] ${fail("99999999", "w9")}`,
      // 10) FAIL 뒤에 KILLED → null (§2-5 · §0-5 판정 1). **`KILLED`를 결과 낱말로 안 세면
      //     이 워커의 배너가 그 앞의 오래된 FAIL을 읽는다** — 강제 중단은 사람이 끊은 것이고
      //     환경 탓이 아니라 `TIMEOUT`과 같은 칸이다
      `${t3} [w10] ${fail("aaaaaaaa", "w10")}`,
      `${t1} [w10] KILLED aaaaaaaa 21s 만에 밖에서 종료(rc=143) -> 할당 회수 + 백로그 복귀. 로그 fail-w10.log`,
      "",
    ].join("\n"),
  );

  const ws = Object.fromEntries((await listWorkers(root)).map((w) => [w.name, w]));
  assert.deepStrictEqual(ws.w1.lastFailure, {
    at: t5,
    hash: "a1111111",
    reason: LIMIT, // 엔진 문자열 그대로 — 복구 시각이 이 문장 안에 있다
    log: "fail-w1.log",
  });
  assert.strictEqual(ws.w2.lastFailure, null);
  assert.strictEqual(ws.w3.lastFailure, null);
  assert.strictEqual(ws.w4.lastFailure?.hash, "d4444444");
  assert.strictEqual(ws.w5.lastFailure, null);
  assert.strictEqual(ws.w6.lastFailure?.reason, "aborted_streaming");
  assert.strictEqual(ws.w7.lastFailure, null);
  assert.strictEqual(ws.w8.lastFailure, null);
  assert.strictEqual(ws.w9.lastFailure?.reason, LIMIT);
  assert.strictEqual(ws.w10.lastFailure, null); // KILLED가 결과 줄이다 — 앞의 FAIL을 안 읽는다
  // 결과 줄을 새로 뽑아도 `recentLog[0]`은 여전히 **마지막 줄**이다(셀이 지금 쓰는 값이다)
  assert.match(ws.w4.recentLog[0], /DISPATCH d4444444/);
  assert.match(ws.w5.recentLog[0], /SKIP/);
});

test("lastFailure — 살아 있는 엔진 쿨다운이 신선도 창을 대신한다 (§4-9 §배너가 꺼지는 구멍)", async () => {
  // 쿨다운이 걸린 동안에는 새 `FAIL`이 구조적으로 안 생겨서(게이트가 `exit 0`) 10분 창만 보면
  // 큐가 멈춘 채로 배너가 꺼진다. 실측 10.30시간 중 9.05시간(88%)이 그 상태였다.
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n" });
  const dir = path.join(root, "workers");
  mkdirSync(path.join(dir, "logs"));
  writeFileSync(
    path.join(dir, "logs", "fail-w1.log"),
    JSON.stringify({ is_error: true, terminal_reason: "api_error", result: LIMIT }) + "\n",
  );
  const at = stamp(15); // 창(10분) 밖이다 — 쿨다운이 없으면 종전대로 `null`이다
  writeFileSync(
    path.join(dir, "runner.log"),
    `${at} [w1] FAIL a1111111 rc=1 -> 할당 회수 + 백로그 복귀. 로그 fail-w1.log\n`,
  );

  // 자리는 `tick.sh:62`. 워커에 `TICKET_ENGINE`이 없으니 엔진 이름은 기본값 `claude`다.
  const cd = path.join(LOCAL, "run", "cooldown-claude");
  mkdirSync(path.dirname(cd), { recursive: true });
  const put = (line1: string) => writeFileSync(cd, `${line1}\n지문\n`);
  const secs = (n: number) => String(Math.floor(Date.now() / 1000) + n);

  // ⓐ 15분 전 FAIL + 살아 있는 쿨다운 → 남는다. 그 파일이 *지금 불능이고 언제까지다*를 말한다
  put(secs(3600));
  assert.strictEqual((await listWorkers(root))[0].lastFailure?.hash, "a1111111");

  // ⓑ 만료된 쿨다운 / 1줄째가 숫자가 아님 / 파일 없음 → 종전 10분 그대로 `null`
  put(secs(-1));
  assert.strictEqual((await listWorkers(root))[0].lastFailure, null);
  put("epoch가 아니다");
  assert.strictEqual((await listWorkers(root))[0].lastFailure, null);
  rmSync(cd);
  assert.strictEqual((await listWorkers(root))[0].lastFailure, null);
});

// ── 받은 편지함 (§0-10 §받은 편지함) ─────────────────────────────────────────

/** 워커마다 `FAIL` 한 줄 + 그 로그 파일 하나. 로그 파일명이 읽음의 **키**라 인자로 받는다. */
function failRoot(specs: { name: string; log: string; minutesAgo?: number }[]): string {
  const root = makeRoot(Object.fromEntries(specs.map((s) => [`${s.name}.sh`, "#!/bin/bash\n"])));
  const dir = path.join(root, "workers");
  mkdirSync(path.join(dir, "logs"));
  const lines: string[] = [];
  for (const s of specs) {
    writeFileSync(
      path.join(dir, "logs", s.log),
      JSON.stringify({ is_error: true, terminal_reason: "api_error", result: LIMIT }) + "\n",
    );
    lines.push(
      `${stamp(s.minutesAgo ?? 1)} [${s.name}] FAIL a1111111 rc=1 -> 할당 회수 + 백로그 복귀. 로그 ${s.log}`,
    );
  }
  writeFileSync(path.join(dir, "runner.log"), lines.join("\n") + "\n");
  return root;
}

const putAlerts = (obj: unknown) =>
  writeFileSync(alertsPath(), typeof obj === "string" ? obj : JSON.stringify(obj));

/** §0-10 §저장의 ② 사건 값 — `failRoot`가 만든 실패의 hash·reason과 맞춘다. */
const mailboxFailure = (at: string, archived: string | null = null) => ({
  at,
  hash: "a1111111",
  reason: LIMIT,
  archived,
});

test("읽음 처리 ① 보관된 실패는 `null`이다 — 다른 루트의 같은 파일명은 안 묻는다 (§0-10)", async () => {
  const root = failRoot([{ name: "w1", log: "fail-w1.log" }]);
  const other = failRoot([{ name: "w1", log: "fail-w1.log" }]);

  // 마크가 없으면 종전 판정 그대로다(대조군 — 아래 `null`이 픽스처 탓이 아니라는 근거).
  rmSync(alertsPath(), { force: true });
  assert.strictEqual((await listWorkers(root))[0].lastFailure?.log, "fail-w1.log");

  putAlerts({ queues: { [root]: { "fail-w1.log": mailboxFailure(stamp(1), stamp(0)) } } });
  assert.strictEqual((await listWorkers(root))[0].lastFailure, null);
  // 루트로 한 겹 나누는 이유: 워커 이름도 로그 파일명 모양도 프로젝트끼리 겹친다.
  assert.strictEqual((await listWorkers(other))[0].lastFailure?.log, "fail-w1.log");
});

test("읽음 처리 ② 같은 워커라도 로그 파일명이 다른 실패는 안 묻힌다 (다음 사고가 다시 켜진다)", async () => {
  const root = failRoot([{ name: "w1", log: "fail-w1-new.log" }]);
  // 앞 사고는 보관된 상태
  putAlerts({ queues: { [root]: { "fail-w1-old.log": mailboxFailure(stamp(10), stamp(1)) } } });
  const w = (await listWorkers(root))[0];
  assert.strictEqual(w.lastFailure?.log, "fail-w1-new.log");
});

test("읽음 처리 ③ 옛 모양(최상위가 절대경로 맵) 파일은 안 읽는다 — 마이그레이션 0줄 (§0-10 §저장)", async () => {
  const root = failRoot([{ name: "w1", log: "fail-w1.log" }]);
  // 완전히 유효한 옛 값(시각 문자열)이어도 최상위에 `queues`가 없으면 빈 편지함으로 시작한다.
  putAlerts({ [root]: { "fail-w1.log": stamp(1) } });
  assert.strictEqual((await listWorkers(root))[0].lastFailure?.log, "fail-w1.log");

  // 다음 쓰기에서 파일이 새 모양(`queues`·`machine` 두 칸)이 된다.
  await markAlertsRead(root, []);
  assert.deepStrictEqual(
    Object.keys(JSON.parse(readFileSync(alertsPath(), "utf8"))).sort(),
    ["machine", "queues"],
  );
});

test("읽음 처리 ④ 파일이 없거나 JSON이 아니면 읽음 0개다 (실패를 지어내지도 숨기지도 않는다)", async () => {
  const root = failRoot([{ name: "w1", log: "fail-w1.log" }]);
  for (const put of [
    () => rmSync(alertsPath(), { force: true }),
    () => putAlerts("{ 이건 JSON이 아니다"),
    () => putAlerts([root]), // 배열 — 모양이 다르다
    () => putAlerts({ [root]: "fail-w1.log" }), // 루트 값이 객체가 아니다
    () => putAlerts({ [root]: { "fail-w1.log": 1 } }), // 시각이 문자열이 아니다
  ]) {
    put();
    assert.strictEqual((await listWorkers(root))[0].lastFailure?.log, "fail-w1.log");
  }
});

test("읽음 처리 ⑤ 상한 — 큐 루트당 200건, 넘치면 `at`이 이른 것부터 버린다 (§0-10 §무한히 쌓이는 것)", async () => {
  const root = failRoot([{ name: "w1", log: "fail-w1.log" }]);
  const events: Record<string, ReturnType<typeof mailboxFailure>> = {};
  // i가 클수록 `stamp(1000 - i)`가 더 최근이다 — old-0이 가장 오래됐다.
  for (let i = 0; i < 250; i++) events[`old-${i}.log`] = mailboxFailure(stamp(1000 - i));
  putAlerts({ queues: { [root]: events } });

  await markAlertsRead(root, []); // 아무것도 안 바뀌어도 쓰기는 상한을 적용한다
  const kept = Object.keys(JSON.parse(readFileSync(alertsPath(), "utf8")).queues[root]);
  assert.strictEqual(kept.length, 200);
  // 버려진 50개는 가장 오래된 것들(old-0..old-49)이다 — 보관 여부를 안 본다.
  assert.deepStrictEqual(
    kept.sort(),
    Array.from({ length: 200 }, (_, i) => `old-${i + 50}.log`).sort(),
  );
});

test("unarchivedFailures — 신선도 창을 안 본다. 보관 안 된 것만, 루트가 갈리면 안 섞인다 (§0-10 §항목의 켜짐 조건이 갈린다)", async () => {
  const root = "/q/a";
  const other = "/q/b";
  putAlerts({
    queues: {
      [root]: {
        // 20분 전 — 신선도 창(10분) 밖이어도 안 걸린다.
        "fail-old.log": mailboxFailure(stamp(20)),
        "fail-archived.log": mailboxFailure(stamp(1), stamp(0)),
      },
      [other]: { "fail-other.log": mailboxFailure(stamp(1)) },
    },
  });
  const alerts = await readAlerts();
  const rows = unarchivedFailures(alerts, root);
  assert.deepStrictEqual(
    rows.map((r) => r.log).sort(),
    ["fail-old.log"],
  );
  assert.strictEqual(rows[0].reason, LIMIT);
});

test("unarchivedResumes — 보관 안 된 머신 사건만, `to`가 숫자로 돌아온다", async () => {
  putAlerts({
    queues: {},
    machine: {
      "1000": { from: 500, kind: "slept", archived: null },
      "2000": { from: 1500, kind: "poweredOff", archived: "2026-08-01T00:00:00.000Z" },
    },
  });
  const alerts = await readAlerts();
  const rows = unarchivedResumes(alerts);
  assert.deepStrictEqual(rows, [{ to: 1000, from: 500, kind: "slept" }]);
});

test("unarchivedResumes — 안 보관한 사건 전부를 `to` 내림차순으로 낸다(상위 N건으로 안 자른다, §0-10 개정 `4ea7e8d9`)", async () => {
  putAlerts({
    queues: {},
    machine: {
      "1000": { from: 500, kind: "slept", archived: null },
      "3000": { from: 2500, kind: "poweredOff", archived: null },
      "2000": { from: 1500, kind: "slept", archived: null },
      "9000": { from: 8500, kind: "slept", archived: "2026-08-01T00:00:00.000Z" }, // 보관됨 — 안 섞인다
    },
  });
  const alerts = await readAlerts();
  const rows = unarchivedResumes(alerts);
  assert.deepStrictEqual(
    rows.map((r) => r.to),
    [3000, 2000, 1000], // 전부 셋 - 내림차순
  );
});

test("archivedRows — ②⑥의 보관된 사건만 시각 내림차순 한 벌로 섞는다. 판정을 다시 안 돌린다", async () => {
  const root = "/q/a";
  const to = Date.now();
  putAlerts({
    queues: {
      [root]: {
        "fail-mid.log": { at: stamp(60), hash: "aaa", reason: "mid", archived: stamp(0) },
        "fail-unarchived.log": mailboxFailure(stamp(1)), // 안 보관 — 안 섞인다
      },
    },
    machine: {
      [String(to)]: { from: to - 300_000, kind: "slept", archived: stamp(0) },
    },
  });
  const alerts = await readAlerts();
  const rows = archivedRows(alerts, root);
  assert.deepStrictEqual(
    rows.map((r) => r.type),
    ["resume", "failure"], // 머신 사건(방금)이 실패(1시간 전)보다 최근이라 앞에 온다
  );
  assert.strictEqual((rows[1] as { reason: string }).reason, "mid");
});

/** 주어진 경로를 **실제로 여는 횟수**를 센다. "정상 상태의 새 I/O가 0"은 눈으로 못 맞춘다.
 *  `syncBuiltinESMExports()`가 `workers.ts`가 이미 import한 바인딩까지 갱신한다(node:module).
 *  `alerts.json`·`tokens.json` 둘 다 같은 셈이라 경로만 인자로 받는다(§0-5 §비용 · §0-13). */
function countFileOpens<T>(file: string, body: () => Promise<T>): Promise<[T, number]> {
  const fsp = createRequire(import.meta.url)("node:fs/promises");
  const real = fsp.readFile;
  let n = 0;
  fsp.readFile = (p: unknown, ...rest: unknown[]) => {
    if (String(p) === file) n++;
    return real(p, ...rest);
  };
  syncBuiltinESMExports();
  return body().then(
    (v): [T, number] => {
      fsp.readFile = real;
      syncBuiltinESMExports();
      return [v, n];
    },
    (e) => {
      fsp.readFile = real;
      syncBuiltinESMExports();
      throw e;
    },
  );
}

test("읽음 처리 — 살아 있는 실패가 0개면 `alerts.json`을 열지 않는다 (§0-5 §비용)", async () => {
  putAlerts({});
  // 20분 전 FAIL = 신선도 창 밖 = 살아 있는 실패 0개. 워커도 로그도 그대로 있다.
  const quiet = failRoot([{ name: "w1", log: "fail-w1.log", minutesAgo: 20 }]);
  const [ws, n] = await countFileOpens(alertsPath(), () => listWorkers(quiet));
  assert.strictEqual(ws[0].lastFailure, null);
  assert.strictEqual(n, 0);

  // 대조군: 실패가 하나라도 살아 있으면 연다(위 0이 가로채기 실패로 나온 0이 아니라는 근거).
  const loud = failRoot([{ name: "w1", log: "fail-w1.log" }]);
  const [, m] = await countFileOpens(alertsPath(), () => listWorkers(loud));
  assert.strictEqual(m, 1);
});

// ── §0-13 §`모두 소진`은 새 알림이 아니다 — §0-5 판정에 조건 하나 ──────────────

/** §0-13 §자리의 JSON 항목. 이 파일이 신경 쓰는 것은 `enabled`·`exhaustedUntil`뿐이다. */
const tokenEntry = (id: string, over: { enabled?: boolean; exhaustedUntil?: number | null } = {}) => ({
  id,
  token: `sk-ant-oat01-${id}`,
  addedAt: new Date().toISOString(),
  enabled: true,
  exhaustedUntil: null,
  ...over,
});
const exhausted = Math.floor(Date.now() / 1000) + 3600; // 아직 안 풀린 소진 시각

test("lastFailure — eligible 토큰이 남아 있으면 §0-10 ② 항목을 안 세운다 (§0-13)", async () => {
  const root = failRoot([{ name: "w1", log: "fail-w1.log" }]); // 1분 전 = 신선도 창 안
  rmSync(alertsPath(), { force: true });

  // ⓐ tokens.json이 없다 — 목록을 안 쓰는 판(오늘 전부). 종전 판정 그대로 선다.
  rmSync(tokensPath(), { force: true });
  assert.strictEqual((await listWorkers(root))[0].lastFailure?.log, "fail-w1.log");

  // ⓑ 활성 토큰은 소진됐지만 다른 토큰이 eligible이다 — 회전이 아직 안 끝난 60초, 항목을 안 세운다.
  writeFileSync(
    tokensPath(),
    JSON.stringify({
      claude: { active: "a", tokens: [tokenEntry("a", { exhaustedUntil: exhausted }), tokenEntry("b")] },
    }),
  );
  assert.strictEqual((await listWorkers(root))[0].lastFailure, null);

  // ⓒ 전부 소진(비활성 포함) — eligible이 0이다. 요구의 *모두*가 여기라 항목이 선다.
  writeFileSync(
    tokensPath(),
    JSON.stringify({
      claude: {
        active: "a",
        tokens: [
          tokenEntry("a", { exhaustedUntil: exhausted }),
          tokenEntry("b", { enabled: false }),
        ],
      },
    }),
  );
  assert.strictEqual((await listWorkers(root))[0].lastFailure?.log, "fail-w1.log");

  // ⓓ tokens.json이 깨졌다(JSON 아님) — 없음과 같은 칸, 종전 판정 그대로.
  writeFileSync(tokensPath(), "{ 이건 JSON이 아니다");
  assert.strictEqual((await listWorkers(root))[0].lastFailure?.log, "fail-w1.log");

  rmSync(tokensPath(), { force: true });
});

test("lastFailure — 정상 상태(살아 있는 실패 0개)에서 `tokens.json`을 열지 않는다 (§0-13)", async () => {
  writeFileSync(tokensPath(), JSON.stringify({ claude: { active: "a", tokens: [tokenEntry("a")] } }));
  // 20분 전 FAIL = 신선도 창 밖, 쿨다운도 없다 = 살아 있는 실패 0개.
  const quiet = failRoot([{ name: "w1", log: "fail-w1.log", minutesAgo: 20 }]);
  const [ws, n] = await countFileOpens(tokensPath(), () => listWorkers(quiet));
  assert.strictEqual(ws[0].lastFailure, null);
  assert.strictEqual(n, 0);

  // 대조군: 실패가 살아 있으면 그때는 연다.
  const loud = failRoot([{ name: "w1", log: "fail-w1.log" }]);
  const [, m] = await countFileOpens(tokensPath(), () => listWorkers(loud));
  assert.strictEqual(m, 1);

  rmSync(tokensPath(), { force: true });
});

// ── §0-21 결정 4 — `limitWaitUntil` (로드맵 P290-5) ──────────────────────────

test("limitWaitUntil — eligible이 0장이면 가장 이른 exhaustedUntil, 1장이라도 있으면 null", async () => {
  // ⓐ 전부 소진 — 가장 이른 값을 고른다(뒤 항목이 더 이르다).
  writeFileSync(
    tokensPath(),
    JSON.stringify({
      claude: {
        active: "a",
        tokens: [tokenEntry("a", { exhaustedUntil: exhausted + 100 }), tokenEntry("b", { exhaustedUntil: exhausted })],
      },
    }),
  );
  assert.strictEqual(await limitWaitUntil(), exhausted);

  // ⓑ 하나가 eligible로 돌아오면 null(§57 §빈 상태).
  writeFileSync(
    tokensPath(),
    JSON.stringify({
      claude: { active: "a", tokens: [tokenEntry("a", { exhaustedUntil: exhausted }), tokenEntry("b")] },
    }),
  );
  assert.strictEqual(await limitWaitUntil(), null);

  // ⓒ eligible 0인데 그릴 시각도 없다(비활성뿐) — §0-21 §다섯 상태의 에러 갈래, null이다.
  writeFileSync(
    tokensPath(),
    JSON.stringify({ claude: { active: "a", tokens: [tokenEntry("a", { enabled: false })] } }),
  );
  assert.strictEqual(await limitWaitUntil(), null);

  // ⓓ 없음·깨짐 — 종전 판정 그대로(null), tokens.json을 새로 쓰지 않는다.
  rmSync(tokensPath(), { force: true });
  assert.strictEqual(await limitWaitUntil(), null);
  assert.strictEqual(existsSync(tokensPath()), false);

  writeFileSync(tokensPath(), "{ 이건 JSON이 아니다");
  assert.strictEqual(await limitWaitUntil(), null);

  rmSync(tokensPath(), { force: true });
});

/** `-l`은 `tab`을 읽고, `crontab -`은 `out`에 쓴다. 만들어진 명령을 **진짜 셸에** 먹여
 *  결과 crontab을 본다. 읽는 파일과 쓰는 파일을 나눈 건 `crontab -l | … | crontab -`이
 *  한 파이프라인이라 같은 파일이면 읽기 도중 truncate되는 경주가 나서다.
 *  (이 머신의 진짜 crontab은 PATH 스텁 덕에 절대 안 건드린다.) */
function withWritableCrontab(text: string) {
  const bin = mkdtempSync(path.join(tmpdir(), "fst-bin-"));
  tmps.push(bin);
  const tab = path.join(bin, "tab.txt");
  const out = path.join(bin, "out.txt");
  writeFileSync(tab, text);
  writeFileSync(
    path.join(bin, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat ${JSON.stringify(tab)}; else cat > ${JSON.stringify(out)}; fi\n`,
    { mode: 0o755 },
  );
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return {
    run: (cmd: string) => execFileSync("sh", ["-c", cmd], { encoding: "utf8" }),
    out: () => readFileSync(out, "utf8"),
    /** 방금 쓴 결과를 다음 명령의 입력으로 돌린다(두 번 실행 검증) */
    feedBack: () => writeFileSync(tab, readFileSync(out, "utf8")),
    restore: () => {
      process.env.PATH = prev;
    },
  };
}

test("cron 명령어 — NFC crontab 줄 · NFD 경로에서 해제가 진짜로 지운다 (38eec0d4)", () => {
  // 실제로 있는 큐다: 구글 공유 드라이브 경로에 공백·작은따옴표·한글이 들어간다.
  // readdir/realpath는 이걸 NFD로 준다.
  const p = "/Users/x/공유 드라이브/it's/workers/w1.sh".normalize("NFD");
  const log = "/Users/x/공유 드라이브/it's/workers/cron.log".normalize("NFD");
  // 픽스처가 진짜 NFD인지 고정한다 — 같아지면 이 테스트는 아무것도 검증하지 않는다
  assert.notStrictEqual(p, p.normalize("NFC"));

  const other = "* * * * * /usr/local/bin/other.sh";
  const nfcLine = `* * * * * "${p.normalize("NFC")}" >> "${log.normalize("NFC")}" 2>&1`;
  // 등록 단위는 2줄이다(제약 4) — `printf`가 두 줄을 다 넣어야 30초 폴링이 된다
  const nfdRun = `"${p}" >> "${log}" 2>&1`;
  const nfdLines = `* * * * * ${nfdRun}\n* * * * * sleep 30; ${nfdRun}`;

  const c = withWritableCrontab(`${other}\n${nfcLine}\n`);
  try {
    // 해제: 경로 한 형태만 grep 패턴으로 주면 여기가 두 줄 그대로다 = 조용한 실패
    c.run(cronUnregisterCmd({ path: p }));
    assert.strictEqual(c.out(), `${other}\n`);

    // 등록: 인용이 살아 있어야 셸이 한 인자로 받는다(공백·작은따옴표·`$`)
    c.feedBack();
    c.run(cronRegisterCmd({ path: p }));
    assert.strictEqual(c.out(), `${other}\n${nfdLines}\n`);

    // 사람이 같은 명령을 두 번 복사해 실행해도 중복 줄이 안 생긴다 (NFD 줄도 걸러진다)
    c.feedBack();
    c.run(cronRegisterCmd({ path: p }));
    assert.strictEqual(c.out(), `${other}\n${nfdLines}\n`);
  } finally {
    c.restore();
  }
});

/** 이 머신의 진짜 crontab을 닮은 픽스처: 남의 프로젝트 큐 · 주석 · 환경변수 · 인용된 줄.
 *  **한 줄이라도 잃으면 이 변경은 사고다**(제약 4) — 그래서 보존을 바이트로 고정한다.
 *  순수 함수만 부르므로 `crontab` 명령을 아예 실행하지 않는다. */
const FIXTURE = [
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "# 백업 — 손대지 말 것",
  "0 3 * * * /Users/x/bin/backup.sh >> /tmp/backup.log 2>&1",
  "",
  '* * * * * "/Users/x/Projects/stream/.dira/workers/w1.sh" >> "/Users/x/Projects/stream/.dira/workers/cron.log" 2>&1',
  "@reboot /Users/x/bin/other.sh",
  "",
].join("\n");

test("cronRegister/cronUnregister — 대상 줄만 바뀌고 나머지는 바이트 그대로 (제약 4)", () => {
  const p = "/Users/x/Projects/p/.dira/workers/w9.sh";
  const run = `"${p}" >> "/Users/x/Projects/p/.dira/workers/cron.log" 2>&1`;
  const lines = `* * * * * ${run}\n* * * * * sleep 30; ${run}`;

  // 등록: 딱 2줄이 늘고(등록 단위, 제약 4) 나머지 텍스트가 완전히 동일하다
  const added = cronRegister(FIXTURE, p);
  assert.strictEqual(added, `${FIXTURE}${lines}\n`); // FIXTURE가 개행으로 끝난다
  assert.strictEqual(added.split("\n").length - FIXTURE.split("\n").length, 2);
  // 남의 프로젝트 줄·주석·환경변수·빈 줄이 그대로다
  assert.strictEqual(added.split("\n").filter((l) => l.includes("stream")).length, 1);

  // 두 번 등록해도 줄이 안 는다 (먼저 지우고 넣는다)
  assert.strictEqual(cronRegister(added, p), added);

  // 해제: 대상 줄만 사라지고 원본으로 정확히 돌아온다
  assert.strictEqual(cronUnregister(added, p), FIXTURE);
  // 미등록 경로 해제는 no-op
  assert.strictEqual(cronUnregister(FIXTURE, p), FIXTURE);

  // 남의 프로젝트 워커를 지우라고 하면 그 줄만 지운다(경로가 다르면 안 건드린다는 대칭 확인)
  const stream = "/Users/x/Projects/stream/.dira/workers/w1.sh";
  assert.strictEqual(cronUnregister(FIXTURE, stream).includes("stream"), false);
  assert.strictEqual(cronUnregister(FIXTURE, stream).split("\n").length, FIXTURE.split("\n").length - 1);
});

test("cronRegister — NFD 경로가 NFC로 적힌 줄과 매칭된다 (a622f9e4·38eec0d4)", () => {
  const nfd = "/Users/x/공유 드라이브/it's/workers/w1.sh".normalize("NFD");
  assert.notStrictEqual(nfd, nfd.normalize("NFC")); // 픽스처가 진짜 NFD인지 고정한다
  const nfcLine = `* * * * * "${nfd.normalize("NFC")}" >> "${"/Users/x/공유 드라이브/it's/workers/cron.log".normalize("NFC")}" 2>&1`;
  const tab = `# 주석\n${nfcLine}\n@reboot /Users/x/bin/other.sh\n`;

  // 이미 등록된 줄이 NFC라도 중복이 생기지 않는다(등록 단위 2줄이 정확히 한 벌)
  const re = cronRegister(tab, nfd);
  assert.strictEqual(re.split("\n").filter((l) => l.includes("workers/w1.sh".normalize("NFD"))).length, 2);
  assert.strictEqual(re.includes(nfcLine), false); // NFC 줄이 지워지고
  assert.strictEqual(re.includes(nfd), true); //      정규화 안 한 경로가 들어갔다
  // 해제도 NFC 줄을 진짜로 지운다(한 형태만 보면 조용한 실패다)
  assert.strictEqual(cronUnregister(tab, nfd), "# 주석\n@reboot /Users/x/bin/other.sh\n");
});

test("cronRegister — 후행 개행이 없는 crontab에서도 줄이 이어 붙지 않는다", () => {
  const out = cronRegister("@reboot /Users/x/bin/other.sh", "/tmp/w1.sh");
  assert.strictEqual(out, `@reboot /Users/x/bin/other.sh\n${cronLine({ path: "/tmp/w1.sh" })}\n`);
  // 빈 crontab(= 등록된 워커 없음)
  assert.strictEqual(cronRegister("", "/tmp/w1.sh"), `${cronLine({ path: "/tmp/w1.sh" })}\n`);
  // 그 `cronLine`이 진짜 2줄이다 — 아니면 위 두 단언은 1줄짜리를 그대로 통과시킨다
  assert.deepStrictEqual(cronLine({ path: "/tmp/w1.sh" }).split("\n"), [
    `* * * * * "/tmp/w1.sh" >> "/tmp/cron.log" 2>&1`,
    `* * * * * sleep 30; "/tmp/w1.sh" >> "/tmp/cron.log" 2>&1`,
  ]);
});

test("화면이 말하는 폴링 간격 = `cronLine`이 진짜 넣는 간격 (눈으로 안 맞춘다)", () => {
  // 손으로 적은 사본은 갈린다 — 화면 넷이 `1분 뒤부터`라고 말하는 동안 등록은 30초였다(2f34f31b).
  // `cronLine`의 `sleep N` 줄에서 초를 **유도해** 사용자에게 보이는 문자열 전부와 대조한다.
  const sleep = cronLine({ path: "/tmp/w1.sh" }).match(/\bsleep (\d+);/);
  assert.ok(sleep, "cronLine에 `sleep N` 줄이 없다 — 등록 단위가 2줄이 아니다");
  const src = ["components/projects-ui.tsx", "components/workers-ui.tsx", "app/actions.ts"]
    .concat("app/(app)/p/[project]/workers/actions.ts", "app/(site)/landing.tsx")
    .map((f) => readFileSync(path.join(import.meta.dirname, "..", f), "utf8"))
    .join("\n");
  const said = [...src.matchAll(/(\S+)\s*뒤부터 티켓을 물어갑니다/g)].map((m) => m[1]);
  assert.ok(said.length >= 4, `문구를 못 찾았다(${said.length}건) — 정규식이 화면과 갈렸다`);
  assert.deepStrictEqual([...new Set(said)], [`${sleep[1]}초`]);
});

// ── 자가 정리 §4-4 ──────────────────────────────────────────────────────────

/** §4-4 표 3줄을 **진짜 bash로** 판정한다. 워커 파일을 실제로 만들어 `bash <워커>`로 돌리므로
 *  `$0`이 cron이 주는 것과 같은 문자열이다(계약이 그 위에 서 있다).
 *
 *  진짜 crontab도 진짜 dira 큐도 안 건드린다(선례 §로드맵 P53): `crontab`은 PATH 앞 스텁이
 *  가로채고(`-l`은 `tab.txt`, `crontab -`은 `out.txt`에 쓴다), 큐·엔진 레포·`TICKET_LOCAL`은
 *  전부 `mkdtemp` 디렉터리다. */
function selfHealBed(names: string[], engine: boolean) {
  const mk = (tag: string) => {
    const d = mkdtempSync(path.join(tmpdir(), `fst-${tag}-`));
    tmps.push(d);
    return d;
  };
  const root = mk("root");
  const repo = mk("repo");
  const local = mk("keymap");
  const bin = mk("bin");
  mkdirSync(path.join(root, "workers"));
  if (engine) writeFileSync(path.join(repo, "tick.sh"), "#!/bin/bash\necho TICK\n");
  writeFileSync(path.join(root, SELF_HEAL_FILE), SELF_HEAL_SH);

  const wpath = (n: string) => path.join(root, "workers", `${n}.sh`);
  for (const n of names) {
    // 진짜 워커와 같은 배치: 자가 정리는 `. tick.sh` **바로 위**다.
    const body = `#!/bin/bash\n${selfHealSourceLine(root, repo)}\necho ALIVE\n`;
    writeFileSync(wpath(n), body, { mode: 0o755 });
  }

  const keymap = path.join(local, "keymap.json");
  // **기본값이 아닌 조합**이어야 한다 — 이 파일은 `바꾼 것만` 담는다(§0-6). `Mod+f`가 기본이
  // 된 뒤로 그 값을 쓰면 "사람이 바꾼 값이 지워지지 않는다"를 보는 검사가 사라진다.
  writeFileSync(keymap, `{"board.search":"Mod+j"}`);
  const tab = path.join(bin, "tab.txt");
  const out = path.join(bin, "out.txt");
  const J = JSON.stringify;
  writeFileSync(
    path.join(bin, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then [ -f ${J(tab)} ] || exit 1; cat ${J(tab)}; else cat > ${J(out)}; fi\n`,
    { mode: 0o755 },
  );

  return {
    wpath,
    lines: (n: string) => cronLine({ path: wpath(n) }),
    setTab: (text: string) => writeFileSync(tab, text),
    /** `crontab -l`이 실패하는 상태(= 이 사용자에게 crontab이 없다) */
    noTab: () => rmSync(tab, { force: true }),
    run: (n: string) =>
      execFileSync("bash", [wpath(n)], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TICKET_LOCAL: local },
      }),
    wrote: () => existsSync(out),
    out: () => readFileSync(out, "utf8"),
    keymapLeft: () => existsSync(keymap),
  };
}

const OTHERS = [
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "# 백업 — 손대지 말 것",
  "0 3 * * * /Users/x/bin/backup.sh >> /tmp/backup.log 2>&1",
  "",
  "@reboot /Users/x/bin/other.sh",
];

test("§4-4 ① 엔진이 없으면 자기 줄 2줄이 빠지고 tick.sh로 안 넘어간다", () => {
  const bed = selfHealBed(["w1", "w2"], false);
  const tab = [...OTHERS, bed.lines("w1"), bed.lines("w2"), ""].join("\n");
  bed.setTab(tab);

  // rc=0이 아니면 execFileSync가 던진다. `ALIVE`가 없다 = `. tick.sh` 자리에 안 닿았다(exit 0).
  assert.strictEqual(bed.run("w1"), "");
  // 자기 줄만 2줄 빠지고 남의 잡·주석·빈 줄·다른 워커 줄은 바이트 그대로다
  assert.strictEqual(bed.out(), [...OTHERS, bed.lines("w2"), ""].join("\n"));
  // w2의 dira 줄이 남았으므로 키맵은 안 지운다
  assert.strictEqual(bed.keymapLeft(), true);
});

test("§4-4 ② 엔진이 있으면 `.sh`가 없는 dira 줄만 빠진다 (남의 줄이어도, 남의 잡은 안 본다)", () => {
  const bed = selfHealBed(["w1"], true);
  const dead = cronLine({ path: "/Users/x/Projects/gone/.dira/workers/w7.sh" });
  // `workers/*.sh`를 부르지 않는 남의 잡 + 주석 처리된 dira 줄은 판정 대상이 아니다
  const commented = `# ${cronLine({ path: "/Users/x/Projects/gone/.dira/workers/w8.sh" }).split("\n")[0]}`;
  const keep = [...OTHERS, commented, bed.lines("w1")];
  bed.setTab([...keep, dead, ""].join("\n"));

  assert.strictEqual(bed.run("w1"), "ALIVE\n"); // 워커는 계속 돈다(tick.sh로 넘어간다)
  assert.strictEqual(bed.out(), [...keep, ""].join("\n"));
  assert.strictEqual(bed.keymapLeft(), true); // 살아 있는 dira 줄이 남았다

  // 뺄 줄이 없으면 crontab을 아예 쓰지 않는다 — 위 결과를 다시 먹여도 no-op이다
  const bed2 = selfHealBed(["w1"], true);
  bed2.setTab([...OTHERS, bed2.lines("w1"), ""].join("\n"));
  assert.strictEqual(bed2.run("w1"), "ALIVE\n");
  assert.strictEqual(bed2.wrote(), false);
  assert.strictEqual(bed2.keymapLeft(), true);
});

test("§4-4 ③ 마지막 dira 줄이 빠지면 키맵만 지운다", () => {
  const bed = selfHealBed(["w1"], false); // 앱을 지웠다 = 이 머신의 마지막 dira
  bed.setTab([...OTHERS, bed.lines("w1"), ""].join("\n"));

  assert.strictEqual(bed.run("w1"), "");
  assert.strictEqual(bed.out(), [...OTHERS, ""].join("\n")); // 남의 잡은 그대로
  assert.strictEqual(bed.keymapLeft(), false);
});

test("§4-4 crontab을 못 읽거나 비었으면 아무것도 안 쓴다 (rc=0)", () => {
  const bed = selfHealBed(["w1"], true);
  bed.noTab(); // `crontab -l`이 rc=1 (이 사용자에게 crontab이 없다)
  assert.strictEqual(bed.run("w1"), "ALIVE\n");
  assert.strictEqual(bed.wrote(), false);

  bed.setTab(""); // 빈 crontab
  assert.strictEqual(bed.run("w1"), "ALIVE\n");
  assert.strictEqual(bed.wrote(), false);

  // 엔진이 없어도 마찬가지다 — 쓰지 않고, 키맵도 안 지우고, exit 0으로 끝난다
  const gone = selfHealBed(["w1"], false);
  gone.noTab();
  assert.strictEqual(gone.run("w1"), "");
  assert.strictEqual(gone.wrote(), false);
  assert.strictEqual(gone.keymapLeft(), true);
});

test("createWorker — 기존 워커를 템플릿으로 755 생성, 덮어쓰기·워커 0개는 거부", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\nTICKET_CWD=/tmp\n. tick.sh\n" });
  const { path: file, template } = await createWorker(root, "w2");
  assert.strictEqual(template, "w1.sh");
  assert.strictEqual(statSync(file).mode & 0o777, 0o755);
  // 안 고른 사람의 기본값도 **블록으로 적힌다** — `tick.sh`가 잡는 그 값이라 워커는 같다(§4-3)
  assert.strictEqual(
    execFileSync("cat", [file], { encoding: "utf8" }),
    `#!/bin/bash\nTICKET_CWD="${root}/worktrees/w2"\n${renderEngineBlock("claude")}\n. tick.sh\n`,
  );
  // O_EXCL: 돌고 있는 워커를 덮어쓰지 않는다
  await assert.rejects(createWorker(root, "w2"), /EEXIST/);
  await assert.rejects(createWorker(root, "../evil"), /영문·숫자/);
  // 워커 0개면 템플릿이 없다 — 엔진 코드 위치를 GUI가 모른다
  await assert.rejects(createWorker(makeRoot({}), "w1"), /템플릿으로 쓸 워커가 없습니다/);
});

// ── TICKET_CWD 유도 (§4-2) ──────────────────────────────────────────────────

/** 이 레포의 w5.sh와 같은 모양: `export`도 아니고 게이트·컨텍스트·엔진 줄이 다 들어 있다 */
const WT_SH = `#!/bin/bash
# 주석
TICKET_CWD="$HOME/Projects/dira-wt/w1"

TICKET_CONTEXT=(
  "$TICKET_CWD/docs/DESIGN.md|스펙"
)

. "$HOME/Projects/dira/.dira/dispatch-gate.sh"

. "$HOME/Projects/dira/tick.sh"
`;

test("createWorker — TICKET_CWD를 템플릿에서 물려받지 않는다 (w4·w5가 w1 트리를 쓴 사고)", async () => {
  const root = makeRoot({ "w1.sh": WT_SH });
  const { path: file } = await createWorker(root, "w4");
  const text = readFileSync(file, "utf8");
  assert.match(text, new RegExp(`^TICKET_CWD="${root}/worktrees/w4"$`, "m"));
  assert.strictEqual(text.includes("dira-wt/w1"), false); // 템플릿 값이 남아 있지 않다
  // 워크트리 준비 명령: `git -C`는 프로젝트다. 템플릿이 source하는 엔진 레포(`~/Projects/dira`)가
  // 아니다 — 그걸 넣으면 이 큐에 dira를 체크아웃한다(§4 생성 4항의 3번).
  const worktree = worktreeCmds(root, "w4");
  assert.deepStrictEqual(worktree, [
    `git -C '${path.dirname(root)}' worktree add '${root}/worktrees/w4' -b wt/w4`,
    `ln -s ../.. '${root}/worktrees/w4/.dira'`,
    // 검증 줄 — `ln -s` 함정(bf4d8878)을 사람이 밟았는지 여기서만 보인다
    "ls -ld '" + root + "/worktrees/w4/.dira'    # `l`로 시작해야 한다",
  ]);
  assert.strictEqual(worktree[0].includes("Projects/dira'"), false);

  // 줄이 없는 템플릿(엔진 기본값을 쓰던 워커)이면 `#!` 다음 줄에 넣는다
  const bare = makeRoot({ "w1.sh": "#!/bin/bash\n. tick.sh\n" });
  const made = await createWorker(bare, "w2");
  assert.strictEqual(
    readFileSync(made.path, "utf8"),
    `#!/bin/bash\nTICKET_CWD="${bare}/worktrees/w2"\n${renderEngineBlock("claude")}\n. tick.sh\n`,
  );
  // `. tick.sh` 줄을 못 읽어도 자리표시자가 없다 — 이제 경로가 root에서 나온다
  assert.strictEqual(
    worktreeCmds(bare, "w2")[0],
    `git -C '${path.dirname(bare)}' worktree add '${bare}/worktrees/w2' -b wt/w2`,
  );

  // `export TICKET_CWD=`도 같은 줄이다 — 접두는 남기고 값만 바꾼다
  const exp = makeRoot({ "w1.sh": "#!/bin/bash\nexport TICKET_CWD='/tmp/x'\n. tick.sh\n" });
  const e2 = await createWorker(exp, "w2");
  assert.strictEqual(
    readFileSync(e2.path, "utf8"),
    `#!/bin/bash\nexport TICKET_CWD="${exp}/worktrees/w2"\n${renderEngineBlock("claude")}\n. tick.sh\n`,
  );
});

test("createWorker — TICKET_CWD·TICKET_ENGINE 말고는 한 줄도 안 바뀐다 (게이트·source·컨텍스트가 그대로다)", async () => {
  const root = makeRoot({ "w1.sh": WT_SH });
  const { path: file } = await createWorker(root, "w4");
  const before = WT_SH.split("\n");
  const after = readFileSync(file, "utf8").split("\n");
  // 는 줄은 엔진 블록 하나뿐이고, 자리는 `source` 줄 바로 위다
  assert.strictEqual(after.length, before.length + 1);
  const at = after.findIndex((l) => l.startsWith("TICKET_ENGINE=("));
  assert.strictEqual(after[at + 1], '. "$HOME/Projects/dira/tick.sh"');
  const rest = after.filter((_, i) => i !== at);
  const diff = before.map((l, i) => [i, l, rest[i]] as const).filter(([, l, r]) => l !== r);
  assert.strictEqual(diff.length, 1, `바뀐 줄: ${JSON.stringify(diff)}`);
  assert.strictEqual(diff[0][1].startsWith("TICKET_CWD="), true);
});

test("createWorker — 엔진은 고른 값이다. 템플릿에서 딸려 오지 않는다 (§4-3 생성 폼)", async () => {
  // 템플릿은 codex로 도는 워커다 — 여기서 물려받으면 고른 값이 조용히 무시된다
  const tmpl = `#!/bin/bash\nTICKET_CWD="/tmp/x"\n${renderEngineBlock("codex", "gpt-5.5")}\n. tick.sh\n`;
  const root = makeRoot({ "w1.sh": tmpl });

  const a = await createWorker(root, "w2", "claude", "opus");
  // 블록은 여전히 하나다(치환이지 삽입이 아니다 — 2개면 그 워커를 다시는 못 고친다)
  assert.strictEqual(readFileSync(a.path, "utf8").split("TICKET_ENGINE=(").length - 1, 1);
  // 안 고른 사람 = 기본값 `claude` + `모델 지정 안 함`. codex 템플릿에서도 그렇다(§4-3)
  await createWorker(root, "w3");

  // 판정은 **화면이 읽는 그 길**로 한다 — listWorkers가 읽은 값의 역파싱이다
  const got = Object.fromEntries(
    (await listWorkers(root, [])).map((w) => [w.name, engineCell(w.engine).value]),
  );
  assert.deepStrictEqual(got.w2, { engineId: "claude", model: "opus" });
  assert.deepStrictEqual(got.w3, { engineId: "claude", model: NO_MODEL });
  assert.deepStrictEqual(got.w1, { engineId: "codex", model: "gpt-5.5" }); // 템플릿은 그대로다

  // 신뢰 경계: 값 검증은 파일을 만들기 **전에** 던진다 — 반쯤 만들어진 워커가 남지 않는다
  await assert.rejects(createWorker(root, "w4", "claude", "a b; rm -rf /"), /쓸 수 없는 문자/);
  await assert.rejects(createWorker(root, "w4", "gemini" as "claude"), /모르는 엔진/);
  assert.strictEqual((await listWorkers(root, [])).some((w) => w.name === "w4"), false);
});

// ── prepareWorktree (§4 생성 4항) ───────────────────────────────────────────
//
// **진짜 git으로 돌린다.** 이 함수의 값어치가 진짜 git이라 모킹하면 검증할 게 남지 않는다
// (브랜치 선존재·체크아웃이 만든 `.dira`·realpath 판정은 전부 파일시스템 사실이다).

/** `<base>`가 git 레포, 큐가 `<base>/.dira`. `seed`는 **커밋되는** 파일이라 워크트리
 *  체크아웃이 그 경로를 만든다(`.dira` 선존재 테스트가 이걸 쓴다). */
function makeRepo(seed: Record<string, string> = {}): { base: string; root: string } {
  const base = mkdtempSync(path.join(tmpdir(), "fst-repo-"));
  tmps.push(base);
  const git = (...args: string[]) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(path.join(base, "README.md"), "# t\n");
  for (const [rel, body] of Object.entries(seed)) {
    mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    writeFileSync(path.join(base, rel), body);
  }
  git("add", "-A");
  git("commit", "-qm", "init"); // 커밋이 없으면 `worktree add`가 HEAD를 못 읽는다
  const root = path.join(base, ".dira");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  return { base, root };
}

const headOf = (tree: string) =>
  execFileSync("git", ["-C", tree, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

test("prepareWorktree — 트리·심링크·검증 3단계를 서버가 실행한다 (§4 생성 4항)", async () => {
  const { root } = makeRepo();
  const tree = path.join(root, "worktrees", "w2");
  assert.deepStrictEqual(await prepareWorktree(root, "w2"), { dir: tree, done: 3, rest: [] });
  assert.strictEqual(statSync(tree).isDirectory(), true);
  assert.strictEqual(readFileSync(path.join(tree, "README.md"), "utf8"), "# t\n"); // 진짜 체크아웃
  assert.strictEqual(readlinkSync(path.join(tree, ".dira")), "../.."); // 상대경로다(§4-2)
  assert.strictEqual(realpathSync(path.join(tree, ".dira")), realpathSync(root));
  // 브랜치가 워커마다 갈려야 한다 — 세 세션이 `wt/w1`에 커밋한 사고가 이 배치의 근거다(§4-2)
  assert.strictEqual(headOf(tree), "wt/w2");
});

test("prepareWorktree — 브랜치 wt/<이름>이 이미 있으면 -b 없이 그 브랜치로 붙인다", async () => {
  const { base, root } = makeRepo();
  execFileSync("git", ["-C", base, "branch", "wt/w2"]); // 워커를 지웠다 다시 만드는 경로
  assert.deepStrictEqual(await prepareWorktree(root, "w2"), {
    dir: path.join(root, "worktrees", "w2"),
    done: 3,
    rest: [],
  });
  // `-b`를 그대로 냈으면 여기 오기 전에 실패했다. 디렉터리 이름으로 dwim했으면 `w2`가 잡힌다
  assert.strictEqual(headOf(path.join(root, "worktrees", "w2")), "wt/w2");
});

test("prepareWorktree — 트리·등록이 남은 채 다시 만들면 add를 건너뛰고 통과한다 (재생성, 요구 221ce38a)", async () => {
  const { root } = makeRepo();
  const tree = path.join(root, "worktrees", "w2");
  assert.deepStrictEqual(await prepareWorktree(root, "w2"), { dir: tree, done: 3, rest: [] });
  // `삭제`는 파일·crontab만 지우고 트리는 남긴다(§4 삭제) — 같은 이름을 다시 만드는 것이
  // 이 요구의 유일한 발생 경로다. `add -f` 없이 통과해야 한다.
  assert.deepStrictEqual(await prepareWorktree(root, "w2"), { dir: tree, done: 3, rest: [] });
  assert.strictEqual(realpathSync(path.join(tree, ".dira")), realpathSync(root));
});

test("prepareWorktree — 디렉터리만 지운 뒤 다시 만들어도 통과한다 (prunable → prune → add, 요구 221ce38a)", async () => {
  const { root } = makeRepo();
  const tree = path.join(root, "worktrees", "w2");
  await prepareWorktree(root, "w2");
  rmSync(tree, { recursive: true, force: true }); // 등록은 남고 디렉터리만 사라진다 → prunable
  assert.deepStrictEqual(await prepareWorktree(root, "w2"), { dir: tree, done: 3, rest: [] });
  assert.strictEqual(realpathSync(path.join(tree, ".dira")), realpathSync(root));
});

test("prepareWorktree — 등록 없는 남의 디렉터리가 그 자리에 있으면 여전히 done: 0으로 실패한다", async () => {
  const { root } = makeRepo();
  const tree = path.join(root, "worktrees", "w2");
  mkdirSync(tree, { recursive: true });
  writeFileSync(path.join(tree, "stray.txt"), "남의 파일\n"); // git worktree 등록이 없다
  const r = await prepareWorktree(root, "w2");
  assert.strictEqual(r.done, 0);
  assert.deepStrictEqual(r.rest, worktreeCmds(root, "w2")); // 남은 명령 = 3줄 전부
  assert.strictEqual(readFileSync(path.join(tree, "stray.txt"), "utf8"), "남의 파일\n"); // 안 건드렸다
});

test("prepareWorktree — .dira가 이미 있으면 EEXIST로 멈추고 되돌리지 않는다 (ln -s 함정 bf4d8878)", async () => {
  // 체크아웃이 `.dira`를 만드는 배치. `ln -s`였다면 여기서 `.dira/.dira`가 생겨 세션이
  // 미끼 큐를 보고 자기 티켓을 못 찾았다 — `fs.symlink`는 대신 EEXIST로 멈춘다.
  const { root } = makeRepo({ ".dira/keep": "tracked\n" });
  const r = await prepareWorktree(root, "w2");
  assert.strictEqual(r.done, 1);
  assert.match(r.reason ?? "", /이미 있습니다/);
  assert.deepStrictEqual(r.rest, worktreeCmds(root, "w2").slice(1)); // 남은 명령 = 꼬리 2줄
  const tree = path.join(root, "worktrees", "w2");
  assert.strictEqual(readFileSync(path.join(tree, ".dira", "keep"), "utf8"), "tracked\n"); // 안 지웠다
  assert.throws(() => statSync(path.join(tree, ".dira", ".dira"))); // 미끼 큐를 안 만들었다
});

test("prepareWorktree — dirname(root)가 git 레포가 아니면 실패가 아니라 정상 종료다", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "fst-norepo-"));
  tmps.push(base);
  const root = path.join(base, ".dira");
  mkdirSync(path.join(root, "workers"), { recursive: true });
  const r = await prepareWorktree(root, "w2");
  assert.strictEqual(r.skipped, true); // 화면이 에러가 아니라 사실로 말한다 (§4 생성 4항)
  assert.strictEqual(r.done, 0);
  assert.match(r.reason ?? "", /git 레포가 아닙니다/);
  assert.deepStrictEqual(r.rest, []); // 안 해도 되는 일에 명령을 주지 않는다
  assert.throws(() => statSync(path.join(root, "worktrees"))); // 디렉터리 하나도 안 만들었다
});

// ── TICKET_CONTEXT 블록 ─────────────────────────────────────────────────────

/** 이 레포의 w1.sh와 같은 모양 */
const CTX_SH = `#!/bin/bash
TICKET_CWD="$HOME/wt/w1"

# --- 참조 컨텍스트 ---
TICKET_CONTEXT=(
  "$TICKET_CWD/docs/DESIGN.md|GUI 제품 스펙"
  "$TICKET_CWD/dira/AGENTS.md|코드 규약"
)

. "$HOME/Projects/dira/tick.sh"
`;

test("parseContextBlock — 정상 블록: 항목·치환 구간을 정확히 짚는다", () => {
  const b = parseContextBlock(CTX_SH);
  assert.ok(b.ok);
  assert.deepStrictEqual(b.items, [
    { path: "$TICKET_CWD/docs/DESIGN.md", desc: "GUI 제품 스펙" },
    { path: "$TICKET_CWD/dira/AGENTS.md", desc: "코드 규약" },
  ]);
  // start~end가 블록 그 자체여야 한다 — 한 글자 밀리면 남의 라인을 밟는다
  assert.strictEqual(CTX_SH.slice(b.start, b.end).startsWith("TICKET_CONTEXT=("), true);
  assert.strictEqual(CTX_SH.slice(b.start, b.end).endsWith(")"), true);
  assert.strictEqual(CTX_SH.slice(b.end).trimStart().startsWith(". \"$HOME"), true);
});

test("parseContextBlock — 블록 없음 · 주석 처리된 블록 · 이중 할당은 거부", () => {
  for (const [text, re] of [
    ["#!/bin/bash\n. tick.sh\n", /블록이 없습니다/],
    // 주석 안의 예시 블록을 먹으면 GUI가 예시를 실제 설정이라고 우긴다
    ['#!/bin/bash\n# TICKET_CONTEXT=(\n#   "$HOME/a.md|설명"\n# )\n', /블록이 없습니다/],
    ["TICKET_CONTEXT=(\n  \"/a\"\n)\nTICKET_CONTEXT=(\n  \"/b\"\n)\n", /2개입니다/],
    ["TICKET_CONTEXT+=(\n  \"/a\"\n)\n", /추가 할당/],
    ['TICKET_CONTEXT=(\n  "/a"\n', /닫는 `\)`가 없습니다/],
    // 블록 안 주석은 통째 치환에서 사라진다 — 지우지 않고 거부한다
    ['TICKET_CONTEXT=(\n  # 아래는 임시\n  "/a"\n)\n', /주석이 있습니다/],
    // 셸이 실행하는 것을 GUI가 다시 쓰지 않는다
    ['TICKET_CONTEXT=(\n  "$(cat list)"\n)\n', /명령 치환/],
    ["TICKET_CONTEXT=(\n  \"`cat list`\"\n)\n", /읽을 수 없는 부분/],
    ["TICKET_CONTEXT=(\n  '$TICKET_CWD/a.md'\n)\n", /작은따옴표 안에 \$/],
    ['TICKET_CONTEXT=(\n  "$A"/b\n)\n', /읽을 수 없는 부분/],
  ] as const) {
    const b = parseContextBlock(text);
    assert.strictEqual(b.ok, false, `거부해야 한다: ${text}`);
    assert.match((b as { reason: string }).reason, re);
  }
  // `블록이 없습니다` 사유에서**만** 화면이 `<arr>=()` 스니펫을 내민다(§4). 그 분기는
  // 이 문자열과 글자로 대조한다(workers-ui.tsx `missing`) — 문구를 고치면 여기서 걸린다.
  for (const arr of ["TICKET_CONTEXT", "TICKET_CONTEXT_COMMON"]) {
    const b = parseContextBlock("#!/bin/bash\n. tick.sh\n", arr);
    assert.strictEqual((b as { reason: string }).reason, `${arr}=( … ) 블록이 없습니다`);
  }
});

test("parseContextBlock — `|` 없는 항목 · 경로에 공백 · 맨 낱말", () => {
  const b = parseContextBlock(
    'TICKET_CONTEXT=(\n  "/공유 드라이브/스펙 v2.md"\n  "$HOME/a.md"\n  /etc/hosts\n)\n',
  );
  assert.ok(b.ok);
  assert.deepStrictEqual(b.items, [
    { path: "/공유 드라이브/스펙 v2.md", desc: "" }, // 설명 없음 = 엔진도 설명 없이 붙인다
    { path: "$HOME/a.md", desc: "" },
    { path: "/etc/hosts", desc: "" },
  ]);
  // 설명에 `|`가 더 있어도 첫 `|`로만 가른다(tick.sh와 같다)
  const c = parseContextBlock('TICKET_CONTEXT=(\n  "/a.md|설명|더"\n)\n');
  assert.ok(c.ok);
  assert.deepStrictEqual(c.items, [{ path: "/a.md", desc: "설명|더" }]);
});

test("renderContextBlock — 쓴 것을 다시 읽으면 같다(공백 경로·빈 배열 포함)", () => {
  const items = [
    { path: "/공유 드라이브/스펙 v2.md", desc: "공백 있는 경로" },
    { path: "$TICKET_CWD/README.md", desc: "" },
  ];
  const back = parseContextBlock(renderContextBlock(items));
  assert.ok(back.ok);
  assert.deepStrictEqual(back.items, items);
  const empty = parseContextBlock(renderContextBlock([]));
  assert.ok(empty.ok);
  assert.deepStrictEqual(empty.items, []);
});

test("writeContext — 블록만 갈리고 나머지 줄은 한 글자도 안 바뀐다 + 존재 여부 판정", async () => {
  const root = makeRoot({ "w1.sh": CTX_SH });
  const real = path.join(root, "workers", "w1.sh"); // 실제로 있는 파일 = exists true
  const ctx = await writeContext(root, "w1", [
    { path: real, desc: "이 파일" },
    { path: "/없는/경로.md", desc: "없어도 에러가 아니다 — 엔진이 WARN만 남긴다" },
    { path: "$UNKNOWN/x.md", desc: "" }, // 못 편 변수 = 확인 불가
  ]);
  assert.ok(ctx.ok);
  assert.deepStrictEqual(
    ctx.items.map((i) => i.exists),
    [true, false, null],
  );

  const text = execFileSync("cat", [real], { encoding: "utf8" });
  assert.strictEqual(text.startsWith('#!/bin/bash\nTICKET_CWD="$HOME/wt/w1"\n'), true);
  assert.strictEqual(text.endsWith('. "$HOME/Projects/dira/tick.sh"\n'), true);
  assert.match(text, /# --- 참조 컨텍스트 ---/); // 주변 주석이 살아 있다
  // **bash가 정말 그렇게 읽는가.** 눈으로 맞추지 않는다 — 블록만 떼어 진짜 셸에 먹인다
  // (파일째 source하면 마지막 줄이 tick.sh를 실행한다).
  const block = execFileSync("sed", ["-n", "/^TICKET_CONTEXT=(/,/^)/p", real], { encoding: "utf8" });
  const out = execFileSync(
    "bash",
    ["-c", `TICKET_CWD=/x\n${block}\nprintf '%s\\n' "\${#TICKET_CONTEXT[@]}" "\${TICKET_CONTEXT[1]}"`],
    { encoding: "utf8" },
  );
  assert.deepStrictEqual(out.trimEnd().split("\n"), [
    "3", // 공백 든 경로가 두 항목으로 쪼개지면 여기가 4가 된다
    "/없는/경로.md|없어도 에러가 아니다 — 엔진이 WARN만 남긴다",
  ]);
});

test("writeContext — 셸에 위험한 입력과 모양이 다른 블록은 거부한다", async () => {
  const root = makeRoot({ "w1.sh": CTX_SH, "bad.sh": "#!/bin/bash\n. tick.sh\n" });
  const ok = [{ path: "/a.md", desc: "설명" }];
  for (const [items, re] of [
    [[{ path: '/a"; rm -rf ~; #', desc: "" }], /쓸 수 없습니다/],
    [[{ path: "/a$(id).md", desc: "" }], /명령 치환/],
    [[{ path: "/a.md", desc: "설명 `id`" }], /쓸 수 없습니다/],
    [[{ path: "/a.md|b", desc: "" }], /경로에 \| 는/],
    [[{ path: "   ", desc: "설명만" }], /경로가 비어 있는/],
  ] as [{ path: string; desc: string }[], RegExp][]) {
    await assert.rejects(writeContext(root, "w1", items), re);
  }
  // 블록이 없는 워커는 고치지 않는다 — 어디에 넣을지 GUI가 추측하지 않는다
  await assert.rejects(writeContext(root, "bad", ok), /손으로 편집하세요/);
  await assert.rejects(writeContext(root, "../evil", ok), /영문·숫자/);
  // 거부됐으니 파일은 원본 그대로다
  assert.strictEqual(
    execFileSync("cat", [path.join(root, "workers", "w1.sh")], { encoding: "utf8" }),
    CTX_SH,
  );
});

// ── TICKET_ONTOLOGY 쓰기 (§5-3 §온톨로지 자리를 워커가 재정의한다 §결정 1 (b), 티켓 cd662a73) ──

test("rewriteOntology — 줄이 없으면 넣고, 있으면 값만 갈고, null이면 지운다", () => {
  const noShebang = 'TICKET_CWD="$HOME/wt/w1"\n. tick.sh\n';
  assert.strictEqual(
    rewriteOntology(noShebang, "/vault/ontology"),
    'TICKET_ONTOLOGY="/vault/ontology"\nTICKET_CWD="$HOME/wt/w1"\n. tick.sh\n',
  );
  const withShebang = '#!/bin/bash\nTICKET_CWD="$HOME/wt/w1"\n. tick.sh\n';
  assert.strictEqual(
    rewriteOntology(withShebang, "/vault/ontology"),
    '#!/bin/bash\nTICKET_ONTOLOGY="/vault/ontology"\nTICKET_CWD="$HOME/wt/w1"\n. tick.sh\n',
  );
  // 값만 간다 — 들여쓰기·export 접두·나머지 줄은 한 글자도 안 바뀐다
  const existing = '#!/bin/bash\nexport TICKET_ONTOLOGY="/old"\nTICKET_CWD="$HOME/wt/w1"\n. tick.sh\n';
  assert.strictEqual(
    rewriteOntology(existing, "/new/place"),
    '#!/bin/bash\nexport TICKET_ONTOLOGY="/new/place"\nTICKET_CWD="$HOME/wt/w1"\n. tick.sh\n',
  );
  // null = 지운다(기본값 가정으로 되돌리는 길)
  assert.strictEqual(rewriteOntology(existing, null), '#!/bin/bash\nTICKET_CWD="$HOME/wt/w1"\n. tick.sh\n');
  // 없는데 지우면 no-op
  assert.strictEqual(rewriteOntology(noShebang, null), noShebang);
});

test("writeOntology — 워커 전부에 같은 값을 쓰고, 갈렸던 값도 통일된다", async () => {
  const root = makeRoot({
    "w1.sh": "#!/bin/bash\n. tick.sh\n",
    "w2.sh": '#!/bin/bash\nTICKET_ONTOLOGY="$HOME/vault-a"\n. tick.sh\n',
  });
  await writeOntology(root, "/vault/shared");
  for (const n of ["w1.sh", "w2.sh"]) {
    const text = execFileSync("cat", [path.join(root, "workers", n)], { encoding: "utf8" });
    assert.match(text, /TICKET_ONTOLOGY="\/vault\/shared"/);
  }
  // 755가 안 깨진다(워커 파일 모드를 잃지 않는다)
  assert.strictEqual(statSync(path.join(root, "workers", "w1.sh")).mode & 0o777, 0o755);

  // null = 기본값 가정으로 되돌린다 — 줄이 워커 파일에서 지워진다
  await writeOntology(root, null);
  for (const n of ["w1.sh", "w2.sh"]) {
    const text = execFileSync("cat", [path.join(root, "workers", n)], { encoding: "utf8" });
    assert.doesNotMatch(text, /TICKET_ONTOLOGY/);
  }
});

test("copyContext — $TICKET_CWD가 살아 옮겨간다(받는 워커는 자기 워크트리를 가리킨다)", async () => {
  const root = makeRoot({
    "w1.sh": CTX_SH,
    "w2.sh": '#!/bin/bash\nTICKET_CWD="$HOME/wt/w2"\nTICKET_CONTEXT=(\n  "/old.md|옛것"\n)\n',
  });
  const ctx = await copyContext(root, "w1", "w2");
  assert.ok(ctx.ok);
  assert.deepStrictEqual(
    ctx.items.map((i) => i.path),
    ["$TICKET_CWD/docs/DESIGN.md", "$TICKET_CWD/dira/AGENTS.md"],
  );
  // 펴진 경로는 w2의 TICKET_CWD를 쓴다 — 여기서 w1이 나오면 복사가 설정을 갈라놓는다
  assert.match(ctx.items[0].resolved, /\/wt\/w2\/docs\/DESIGN\.md$/);
  await assert.rejects(copyContext(root, "w1", "w1"), /같은 워커/);
});

test("listWorkers — context가 같이 실린다(못 읽는 워커는 사유가 실린다)", async () => {
  const root = makeRoot({ "w1.sh": CTX_SH, "w2.sh": "#!/bin/bash\n. tick.sh\n" });
  const [w1, w2] = await listWorkers(root);
  assert.strictEqual(w1.context.ok, true);
  assert.strictEqual(w1.context.ok && w1.context.items.length, 2);
  assert.strictEqual(w2.context.ok, false);
});

// ── 공통 컨텍스트 context.sh (§4-1) ────────────────────────────────────────

test("parseContextBlock — 배열 이름을 나누면 공통 파일이 자기 자신을 거부하지 않는다", async () => {
  const root = makeRoot({});
  await writeCommonContext(root, [{ path: "$TICKET_CWD/docs/DESIGN.md", desc: "스펙" }]);
  const text = readFileSync(path.join(root, "context.sh"), "utf8");
  // 이 파일에는 `TICKET_CONTEXT` 대입이 하나 더 있다(병합 2줄) — 이름을 안 나누면 "2개입니다"다
  const common = parseContextBlock(text, "TICKET_CONTEXT_COMMON");
  assert.ok(common.ok);
  assert.deepStrictEqual(common.items, [{ path: "$TICKET_CWD/docs/DESIGN.md", desc: "스펙" }]);
  // 기본값은 그대로 TICKET_CONTEXT다 — 병합 블록을 짚으므로 항목으로는 못 읽는다
  assert.strictEqual(parseContextBlock(text).ok, false);
  assert.strictEqual(renderContextBlock([], "TICKET_CONTEXT_COMMON"), "TICKET_CONTEXT_COMMON=()");
});

test("readCommonContext — 파일이 없으면 0개다(오류가 아니다) · 모양이 다르면 사유", async () => {
  const root = makeRoot({});
  assert.deepStrictEqual(await readCommonContext(root), { ok: true, items: [] });

  const file = path.join(root, "context.sh");
  await writeCommonContext(root, [
    { path: path.join(root, "workers"), desc: "있는 경로" },
    { path: "/없는/경로.md", desc: "" },
  ]);
  const ctx = await readCommonContext(root);
  assert.ok(ctx.ok);
  assert.deepStrictEqual(
    ctx.items.map((i) => [i.desc, i.exists]),
    [["있는 경로", true], ["", false]],
  );

  // 사람이 손으로 깨 놓은 파일은 0개라고 우기지 않는다 — 사유를 넘긴다(편집 UI가 안 열린다)
  writeFileSync(file, "TICKET_CONTEXT_COMMON=(\n  # 임시\n)\n");
  const bad = await readCommonContext(root);
  assert.strictEqual(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /주석이 있습니다/);
  await assert.rejects(writeCommonContext(root, []), /손으로 편집하세요/);
});

test("writeCommonContext — 처음엔 고정 문구까지 만들고, 그 뒤엔 블록만 갈린다", async () => {
  const root = makeRoot({});
  await writeCommonContext(root, [{ path: "/a.md", desc: "첫 항목" }]);
  const file = path.join(root, "context.sh");
  const first = readFileSync(file, "utf8");
  assert.match(first, /^# 공통 참조 컨텍스트 — 워커 전원이 source한다/);
  assert.match(first, /\$\{TICKET_CONTEXT_COMMON\[@\]\+"\$\{TICKET_CONTEXT_COMMON\[@\]\}"\}/);
  assert.strictEqual(statSync(file).mode & 0o777, 0o644); // 실행 파일이 아니다 — 워커가 `.` 한다

  await writeCommonContext(root, [{ path: "/b.md", desc: "둘째" }]);
  const second = readFileSync(file, "utf8");
  // 갈린 것은 블록 한 곳뿐이다 — 병합 2줄·주석은 한 글자도 안 바뀐다
  assert.strictEqual(second, first.replace('"/a.md|첫 항목"', '"/b.md|둘째"'));
  // 신뢰 경계는 그대로다(§4와 같은 cleanItem)
  await assert.rejects(writeCommonContext(root, [{ path: "/a$(id)", desc: "" }]), /명령 치환/);
  assert.strictEqual(readFileSync(file, "utf8"), second); // 거부됐으니 파일은 그대로
});

test("공통이 워커 항목 **앞에** 붙는가 — 진짜 bash 3.2(set -u)로 돌려 본다", async () => {
  const root = makeRoot({
    "w1.sh": '#!/bin/bash\nTICKET_CWD="/x"\nTICKET_CONTEXT=(\n  "own|x"\n)\n\n. "$HOME/tick.sh"\n',
  });
  await writeCommonContext(root, [{ path: "$TICKET_CWD/docs/DESIGN.md", desc: "스펙" }]);
  assert.strictEqual(await applyCommonSource(root, "w1"), true);

  // 워커 파일을 (엔진 호출 줄만 빼고) 그대로 먹인다 — source 줄 위치까지 같이 검증된다
  const text = readFileSync(path.join(root, "workers", "w1.sh"), "utf8");
  const body = text
    .split("\n")
    .filter((l) => !l.includes("tick.sh"))
    .join("\n");
  const out = execFileSync(
    "/bin/bash",
    ["-c", `set -u\n${body}\nprintf '%s\\n' "\${#TICKET_CONTEXT[@]}" "\${TICKET_CONTEXT[@]}"`],
    { encoding: "utf8" },
  );
  assert.deepStrictEqual(out.trimEnd().split("\n"), ["2", "/x/docs/DESIGN.md|스펙", "own|x"]);

  // 공통 0개여도 set -u에서 터지지 않는다(빈 배열 전개 = tick.sh 44행 관용구)
  await writeCommonContext(root, []);
  const empty = execFileSync(
    "/bin/bash",
    ["-c", `set -u\n${body}\nprintf 'count=%s\\n' "\${#TICKET_CONTEXT[@]}"`],
    { encoding: "utf8" },
  );
  assert.strictEqual(empty.trimEnd(), "count=1");
});

test("공통 카드의 exists는 엔진 판정과 어긋나지 않는다 — 워커가 TICKET_CWD를 덮어쓴 큐 (6e3dcd79)", async () => {
  // 워커 둘이 각자 워크트리를 갖는다(§4-2). 공통 항목의 `$TICKET_CWD`는 워커마다 다른 곳을 편다.
  const cwd1 = mkdtempSync(path.join(tmpdir(), "fst-cwd1-"));
  const cwd2 = mkdtempSync(path.join(tmpdir(), "fst-cwd2-"));
  tmps.push(cwd1, cwd2);
  writeFileSync(path.join(cwd1, "BOTH.md"), "x");
  writeFileSync(path.join(cwd2, "BOTH.md"), "x");
  writeFileSync(path.join(cwd1, "ONLY1.md"), "x"); // cwd2에는 없다
  const w = (cwd: string) => `#!/bin/bash\nTICKET_CWD="${cwd}"\nTICKET_CONTEXT=(\n)\n`;
  const root = makeRoot({ "w1.sh": w(cwd1), "w2.sh": w(cwd2) });

  const items = ["BOTH.md", "ONLY1.md", "NONE.md"].map((n) => ({
    path: `$TICKET_CWD/${n}`,
    desc: n,
  }));
  await writeCommonContext(root, items);
  for (const n of ["w1", "w2"]) assert.strictEqual(await applyCommonSource(root, n), true);

  const ctx = await readCommonContext(root);
  assert.ok(ctx.ok);
  // 전원에게 있으면 `있음`, 전원에게 없으면 `없음`, 갈리면 단정하지 않는다(null).
  // 여기서 BOTH가 false로 돌아오면 그게 이 티켓의 버그다 — 있는 파일을 `없음`으로 그린다.
  assert.deepStrictEqual(
    ctx.items.map((i) => [i.desc, i.exists]),
    [
      ["BOTH.md", true],
      ["ONLY1.md", null],
      ["NONE.md", false],
    ],
  );
  // 갈릴 때는 편 척도 하지 않는다 — 툴팁에 한 워커의 경로가 사실처럼 박히면 같은 거짓말이다
  assert.strictEqual(ctx.items[1].resolved, "$TICKET_CWD/ONLY1.md");

  // 패리티: 진짜 bash로 워커 파일을 돌려 엔진의 `[ -e ]`(tick.sh 148행)와 대조한다.
  const engine = ["w1", "w2"].map((n) => {
    const body = readFileSync(path.join(root, "workers", `${n}.sh`), "utf8");
    const out = execFileSync(
      "/bin/bash",
      [
        "-c",
        `set -u\n${body}\nfor e in \${TICKET_CONTEXT[@]+"\${TICKET_CONTEXT[@]}"}; do [ -e "\${e%%|*}" ] && echo 1 || echo 0; done`,
      ],
      { encoding: "utf8" },
    );
    return out.trimEnd().split("\n");
  });
  assert.deepStrictEqual(engine, [
    ["1", "1", "0"], // w1: BOTH · ONLY1 있음, NONE 없음
    ["1", "0", "0"], // w2: BOTH만 있음
  ]);
  ctx.items.forEach((it, i) => {
    const both = engine.map((e) => e[i] === "1");
    // 카드가 단정한 값은 워커 전원의 판정과 같아야 하고, 갈릴 때만 null이다
    assert.strictEqual(it.exists, both.every(Boolean) ? true : both.some(Boolean) ? null : false);
  });
});

test("applyCommonSource — 삽입 위치는 닫는 `)` 다음 줄, 두 번째는 no-op", async () => {
  const root = makeRoot({ "w1.sh": CTX_SH, "bad.sh": "#!/bin/bash\n. tick.sh\n" });
  const file = path.join(root, "workers", "w1.sh");
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.commonSource, false);

  assert.strictEqual(await applyCommonSource(root, "w1"), true);
  const text = readFileSync(file, "utf8");
  // `)` 바로 다음 줄이다 — 위에 들어가면 워커의 `TICKET_CONTEXT=(`가 공통을 덮어쓴다
  assert.match(text, /\)\n\. .+\/context\.sh"   # 공통 컨텍스트를 최상단에 끼운다\n\n\. "\$HOME/);
  assert.strictEqual(text.includes(commonSourceLine(root)), true);
  // 블록과 나머지 줄은 그대로다
  assert.strictEqual(text.replace(commonSourceLine(root) + "\n", ""), CTX_SH);
  assert.strictEqual(statSync(file).mode & 0o777, statSync(path.join(root, "workers", "bad.sh")).mode & 0o777);

  assert.strictEqual(await applyCommonSource(root, "w1"), false); // 이미 있다 = no-op
  assert.strictEqual(readFileSync(file, "utf8"), text);
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.commonSource, true);

  // 블록이 없으면 어디에 넣을지 추측하지 않는다
  await assert.rejects(applyCommonSource(root, "bad"), /손으로 편집하세요/);
  await assert.rejects(applyCommonSource(root, "../evil"), /영문·숫자/);
});

test("applySelfHeal — 픽스처 큐 왕복 1회: 경고 뜸 → 적용 → 경고 사라짐 → bash -n (§4-4 §소급)", async () => {
  const root = makeRoot({
    "w1.sh": CTX_SH,
    "rel.sh": "#!/bin/bash\n. tick.sh\n", // 상대경로 = 셸 없이 못 편다
    "none.sh": "#!/bin/bash\necho x\n", // `. tick.sh` 줄이 없다 = 워커가 아니다
  });
  const file = path.join(root, "workers", "w1.sh");
  chmodSync(file, 0o755);
  const heal = path.join(root, SELF_HEAL_FILE);

  // ① 경고가 뜬다 = 줄이 없다. 파일도 아직 없다
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.selfHealSource, false);
  assert.strictEqual(existsSync(heal), false);

  // ② 적용
  assert.strictEqual(await applySelfHeal(root, "w1"), true);
  // 파일은 GUI가 관리하는 그 문자열 그대로 + 644(실행 파일이 아니다 — 워커가 `.` 한다)
  assert.strictEqual(readFileSync(heal, "utf8"), SELF_HEAL_SH);
  assert.strictEqual(statSync(heal).mode & 0o777, 0o644);
  // 엔진 경로는 워커 자신의 `. tick.sh` 줄에서 읽는다 — `$HOME`이 펴진 값이다
  const line = selfHealSourceLine(root, path.join(homedir(), "Projects", "dira"));
  const text = readFileSync(file, "utf8");
  // **바로 위**다. 아래면 엔진이 없을 때 이 줄에 닿기 전에 워커가 죽는다
  assert.strictEqual(
    text,
    CTX_SH.replace('. "$HOME/Projects/dira/tick.sh"', `${line}\n. "$HOME/Projects/dira/tick.sh"`),
  );
  assert.strictEqual(statSync(file).mode & 0o777, 0o755); // 755를 잃지 않는다

  // ③ 두 파일 다 진짜 bash가 읽는다
  execFileSync("bash", ["-n", file]);
  execFileSync("bash", ["-n", heal]);

  // ④ 경고가 사라진다
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.selfHealSource, true);

  // ⑤ 두 번째는 no-op — 줄도 파일도 두 벌이 안 된다
  assert.strictEqual(await applySelfHeal(root, "w1"), false);
  assert.strictEqual(readFileSync(file, "utf8"), text);
  assert.strictEqual(text.split("self-heal.sh").length - 1, 1);
  writeFileSync(heal, "손으로 고친 자국\n"); // 있는 파일은 안 덮는다
  assert.strictEqual(await applySelfHeal(root, "w1"), false);
  assert.strictEqual(readFileSync(heal, "utf8"), "손으로 고친 자국\n");

  // ⑥ 못 펴는 엔진 경로·앵커 없음·이름 규칙은 **쓰지 않고** 사유를 준다
  await assert.rejects(applySelfHeal(root, "rel"), /셸 없이 펼 수 없습니다/);
  await assert.rejects(applySelfHeal(root, "none"), /이 줄이 없습니다|줄이 없습니다/);
  await assert.rejects(applySelfHeal(root, "../evil"), /영문·숫자/);
  assert.strictEqual(readFileSync(path.join(root, "workers", "rel.sh"), "utf8"), "#!/bin/bash\n. tick.sh\n");
});

test("applyDispatchGate — 픽스처 큐 왕복 1회: 브랜치는 AGENTS.md에서 읽는다 (§4-14 §소급)", async () => {
  const root = makeRoot({
    "w1.sh": CTX_SH,
    "none.sh": "#!/bin/bash\necho x\n", // `. tick.sh` 줄이 없다 = 워커가 아니다
  });
  const file = path.join(root, "workers", "w1.sh");
  chmodSync(file, 0o755);
  const gate = path.join(root, DISPATCH_GATE_FILE);

  // 브랜치를 못 읽으면(스캐폴딩 이전 큐 등) 새 입력을 요구하지 않고 사유를 준다
  await assert.rejects(applyDispatchGate(root, "w1"), /통합 브랜치를.*읽을 수 없습니다/);

  // §4-14 — 값은 이미 손에 있다: scaffold가 이미 치환해 둔 AGENTS.md의 그 줄에서 읽는다
  mkdirSync(path.join(root, "protocols"), { recursive: true });
  writeFileSync(path.join(root, "protocols", "AGENTS.md"), "본문...\n**끝나면**: `git push . HEAD:main`\n");

  // ① 경고가 뜬다 = 줄이 없다. 파일도 아직 없다
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.dispatchGateSource, false);
  assert.strictEqual(existsSync(gate), false);

  // ② 적용 — 브랜치가 main으로 치환된 그 문자열 그대로 + 644
  assert.strictEqual(await applyDispatchGate(root, "w1"), true);
  assert.strictEqual(readFileSync(gate, "utf8"), dispatchGateSh("main"));
  assert.strictEqual(statSync(gate).mode & 0o777, 0o644);
  const line = dispatchGateSourceLine(root);
  const text = readFileSync(file, "utf8");
  assert.strictEqual(
    text,
    CTX_SH.replace('. "$HOME/Projects/dira/tick.sh"', `${line}\n. "$HOME/Projects/dira/tick.sh"`),
  );
  assert.strictEqual(statSync(file).mode & 0o777, 0o755); // 755를 잃지 않는다

  // ③ 두 파일 다 진짜 bash가 읽는다
  execFileSync("bash", ["-n", file]);
  execFileSync("bash", ["-n", gate]);

  // ④ 경고가 사라진다
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.dispatchGateSource, true);

  // ⑤ 두 번째는 no-op — 줄도 파일도 두 벌이 안 된다. 있는 파일은 안 덮는다
  assert.strictEqual(await applyDispatchGate(root, "w1"), false);
  assert.strictEqual(readFileSync(file, "utf8"), text);
  assert.strictEqual(text.split("dispatch-gate.sh").length - 1, 1);
  writeFileSync(gate, "손으로 고친 자국\n");
  assert.strictEqual(await applyDispatchGate(root, "w1"), false);
  assert.strictEqual(readFileSync(gate, "utf8"), "손으로 고친 자국\n");

  // ⑥ 앵커 없음·이름 규칙은 쓰지 않고 사유를 준다
  await assert.rejects(applyDispatchGate(root, "none"), /줄이 없습니다/);
  await assert.rejects(applyDispatchGate(root, "../evil"), /영문·숫자/);
});

test("dispatchGateState — 네 갈래: 없음·최신·낡음·손으로 깐 판 (§4-14 §소급, 티켓 c9c94c20)", async () => {
  const root = makeRoot({ "w1.sh": CTX_SH });
  const gate = path.join(root, DISPATCH_GATE_FILE);

  assert.strictEqual(await dispatchGateState(root, "main"), "none");

  writeFileSync(gate, dispatchGateSh("main"));
  assert.strictEqual(await dispatchGateState(root, "main"), "latest");

  // 관리 표식(템플릿 셋째 줄 "GUI가 만들고 관리한다")은 그대로 살아 있고 나머지 바이트만 다르다
  writeFileSync(gate, dispatchGateSh("main") + "\n# hand edit\n");
  assert.strictEqual(await dispatchGateState(root, "main"), "stale");

  // 관리 표식이 아예 없다 — 사람이 처음부터 손으로 깐 판
  writeFileSync(gate, "손으로 처음부터 깐 판\n");
  assert.strictEqual(await dispatchGateState(root, "main"), "handEdited");

  // 브랜치가 다르면 "최신"도 그 브랜치 기준으로 다시 갈린다 — 값 하나가 아니라 비교식이다
  writeFileSync(gate, dispatchGateSh("main"));
  assert.strictEqual(await dispatchGateState(root, "dev"), "stale");
});

test("applyDispatchGate — 낡음은 갈아 끼우고 손으로 깐 판은 안 건드린다 (§4-14 §소급, 티켓 c9c94c20)", async () => {
  const root = makeRoot({ "w1.sh": CTX_SH });
  chmodSync(path.join(root, "workers", "w1.sh"), 0o755);
  mkdirSync(path.join(root, "protocols"), { recursive: true });
  writeFileSync(path.join(root, "protocols", "AGENTS.md"), "본문...\n**끝나면**: `git push . HEAD:main`\n");
  const gate = path.join(root, DISPATCH_GATE_FILE);

  // 낡음 — §4-14 §검증 6의 그 실측 그대로(`printf '\n# hand edit\n' >>`) 만든 상태
  writeFileSync(gate, dispatchGateSh("main") + "\n# hand edit\n");
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.dispatchGateStale, true);
  assert.strictEqual(await applyDispatchGate(root, "w1"), true); // source 줄도 같이 들어간다
  assert.strictEqual(readFileSync(gate, "utf8"), dispatchGateSh("main")); // 지금 판으로 갈아 끼웠다
  assert.strictEqual(statSync(gate).mode & 0o777, 0o644);
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.dispatchGateStale, false);

  // 손으로 깐 판 — 관리 표식이 없다. 액션이 불려도(source 줄은 이미 있어 no-op) 파일은 안 갈린다
  writeFileSync(gate, "손으로 처음부터 깐 판\n");
  const before = readFileSync(gate, "utf8");
  assert.strictEqual(await applyDispatchGate(root, "w1"), false);
  assert.strictEqual(readFileSync(gate, "utf8"), before);
  // 손으로 깐 판은 "낡음"이 아니다 — 화면 경고 축이 다르다(§4-14 §소급, 이 티켓의 범위 밖)
  assert.strictEqual((await listWorkers(root)).find((w) => w.name === "w1")!.dispatchGateStale, false);
});

/** §4-14 §검증 2·3 — 받는 트리가 통합 브랜치를 체크아웃 중일 때만 잰다. **진짜 git + 진짜
 *  bash로 돌린다** — 이 파일의 값어치가 그 판정이라 모킹하면 검증할 게 남지 않는다. */
test("dispatchGateSh — 통합 브랜치 체크아웃 여부로 막고 안 막고가 갈린다 (§4-14 §검증)", () => {
  const { base } = makeRepo(); // 브랜치 main, 클린
  const gate = path.join(base, "dispatch-gate.sh");
  writeFileSync(gate, dispatchGateSh("main"));

  // 표식 자리(§4-14 §표식 파일)는 <루트>/workers/.gate-dirty — <루트>/workers/를 실제로 만들고,
  // 그 안의 워커 파일 자리를 bash -c의 arg0으로 준다($0이 곧 그 자리다. 파일 자체는 없어도 된다)
  const workersDir = path.join(base, "workers");
  mkdirSync(workersDir, { recursive: true });
  const worker = path.join(workersDir, "w1.sh");
  const flag = path.join(workersDir, ".gate-dirty");

  // env로 준다 — `.`은 특수 빌트인이라 셸 대입 접두사(`VAR=v . file`)의 스코프 규칙이 미묘하다.
  // 진짜 워커 `.sh`가 그러듯 환경변수로 물려주면 그 미묘함을 안 탄다.
  const run = () =>
    execFileSync("bash", ["-c", `. ${JSON.stringify(gate)} tick; echo 끝`, worker], {
      encoding: "utf8",
      env: { ...process.env, TICKET_CWD: base },
    });

  // README.md를 더럽힌다(추적 파일 — `-uno`가 못 보는 미추적 파일로는 안 잰다)
  writeFileSync(path.join(base, "README.md"), "더럽힌다\n");

  // 1) 통합 브랜치(main)가 아닌 브랜치가 체크아웃돼 있으면 더러워도 안 막는다
  execFileSync("git", ["-C", base, "switch", "-q", "-c", "tmp-not-integration"]);
  const notIntegration = run();
  assert.doesNotMatch(notIntegration, /GATE/);
  assert.match(notIntegration, /끝/); // exit 0으로 안 끊겼다 — 정상적으로 끝까지 돈다

  // 2) main으로 돌아오면(여전히 더럽다) 막는다
  execFileSync("git", ["-C", base, "switch", "-q", "main"]);
  const blocked = run();
  assert.match(blocked, /GATE 디스패치 보류/);
  assert.doesNotMatch(blocked, /끝/); // 스크립트가 exit 0으로 끊겨 다음 echo가 안 돈다

  // §4-14 §표식 파일 — 머리는 `<ISO 8601 + 오프셋> <받는 트리 절대경로>`, 나머지는
  // `git status --porcelain -uno`의 그 줄 그대로(상한 없음)
  assert.strictEqual(existsSync(flag), true);
  const porcelain = execFileSync("git", ["-C", base, "status", "--porcelain", "-uno"], { encoding: "utf8" })
    .replace(/\n$/, "")
    .split("\n");
  const written = readFileSync(flag, "utf8").replace(/\n$/, "").split("\n");
  assert.match(written[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} /);
  assert.strictEqual(written[0].slice(written[0].indexOf(" ") + 1), realpathSync(base));
  assert.deepStrictEqual(written.slice(1), porcelain);

  // 3) 같은 상태로 또 돌리면 막긴 막되, 상태가 안 바뀌었으니 메시지는 다시 안 찍는다(파일도 다시 안 쓴다)
  const beforeAgain = readFileSync(flag, "utf8");
  const blockedAgain = run();
  assert.doesNotMatch(blockedAgain, /GATE 디스패치 보류/);
  assert.doesNotMatch(blockedAgain, /끝/);
  assert.strictEqual(readFileSync(flag, "utf8"), beforeAgain);

  // 4) 더러움을 치우면 풀리고 해제 메시지가 뜨며 표식 파일이 사라진다
  execFileSync("git", ["-C", base, "checkout", "--", "README.md"]);
  const cleared = run();
  assert.match(cleared, /GATE 해제/);
  assert.match(cleared, /끝/);
  assert.strictEqual(existsSync(flag), false);
});

/** §4-14 §없는 워크트리를 게이트가 만든다 — GUI가 관리하는 `DISPATCH_GATE_SH` 쪽. 조건 셋(표준
 *  자리 · 없음 · git 레포)을 다 만족할 때만 만들고, 하나라도 어긋나면 종전대로 아무것도 안
 *  한다(이 게이트엔 선행조건 1이 아예 없었다 — 새 프로젝트 첫 워커의 TICKET_CWD 빈값이 그대로 남는다).
 *  **진짜 git + 진짜 bash로 돌린다** — 값어치가 그 판정이라 모킹하면 검증할 게 남지 않는다. */
test("dispatchGateSh — 없는 표준 워크트리를 게이트가 만든다 (§4-14 §없는 워크트리를 게이트가 만든다)", () => {
  const { root } = makeRepo();
  const gate = path.join(root, "dispatch-gate.sh");
  writeFileSync(gate, dispatchGateSh("main"));
  const worker = path.join(root, "workers", "w2.sh"); // $0 — 파일 자체는 없어도 된다
  const tree = path.join(root, "worktrees", "w2"); // 표준 자리

  const run = (cwd: string) =>
    execFileSync("bash", ["-c", `. ${JSON.stringify(gate)} tick; echo 끝`, worker], {
      encoding: "utf8",
      env: { ...process.env, TICKET_CWD: cwd },
    });

  // 1) 없는 표준 워크트리 — 만들고 그 자리에서 디스패치로 넘어간다(막지 않는다)
  const made = run(tree);
  assert.match(made, /끝/);
  assert.doesNotMatch(made, /GATE/);
  assert.strictEqual(statSync(tree).isDirectory(), true);
  assert.strictEqual(readlinkSync(path.join(tree, ".dira")), "../..");
  assert.strictEqual(realpathSync(path.join(tree, ".dira")), realpathSync(root));
  assert.strictEqual(
    execFileSync("git", ["-C", tree, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim(),
    "wt/w2",
  );

  // 2) 등록만 남은 자리(디렉터리만 지움) — missing but already registered로 안 죽고 다시 세운다
  rmSync(tree, { recursive: true, force: true });
  const rebuilt = run(tree);
  assert.match(rebuilt, /끝/);
  assert.doesNotMatch(rebuilt, /GATE/);
  assert.strictEqual(realpathSync(path.join(tree, ".dira")), realpathSync(root));

  // 3) 표준 자리가 아니면 안 만든다 — 게이트 동작이 종전과 같다(막지도, 만들지도 않는다)
  const elsewhere = path.join(tmpdir(), "dira-gate-elsewhere-" + process.pid);
  rmSync(elsewhere, { recursive: true, force: true });
  const notStandard = run(elsewhere);
  assert.match(notStandard, /끝/);
  assert.strictEqual(existsSync(elsewhere), false);

  // 4) TICKET_CWD가 비어 있으면 이 블록에 안 닿는다(새 프로젝트 첫 워커가 영구 정지하지 않는다)
  const empty = execFileSync("bash", ["-c", `. ${JSON.stringify(gate)} tick; echo 끝`, worker], {
    encoding: "utf8",
    env: { ...process.env, TICKET_CWD: "" },
  });
  assert.match(empty, /끝/);
});

/** `-l`과 `crontab -`이 **같은 파일**을 본다 — 쓴 뒤 다시 읽어 확인하는 `applyCrontab`의 경로다
 *  (`withWritableCrontab`은 셸 파이프라인용이라 읽기/쓰기 파일이 갈라져 있다).
 *  `failWrite`면 `crontab -`이 실패한다 — 해제 실패에 파일을 남기는지 보려고.
 *  문자열을 주면 그것이 그 실패의 stderr다(진짜 crontab의 실패 문구를 넣어 보려고). */
function withLiveCrontab(text: string, opts: { failWrite?: boolean | string } = {}) {
  const bin = mkdtempSync(path.join(tmpdir(), "fst-bin-"));
  tmps.push(bin);
  const tab = path.join(bin, "tab.txt");
  writeFileSync(tab, text);
  const stderr = typeof opts.failWrite === "string" ? opts.failWrite : "crontab: 쓸 수 없습니다";
  const write = opts.failWrite
    ? `cat >/dev/null; echo ${JSON.stringify(stderr)} >&2; exit 1`
    : `cat > ${JSON.stringify(tab + ".new")} && mv ${JSON.stringify(tab + ".new")} ${JSON.stringify(tab)}`;
  writeFileSync(
    path.join(bin, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat ${JSON.stringify(tab)}; else ${write}; fi\n`,
    { mode: 0o755 },
  );
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return {
    tab: () => readFileSync(tab, "utf8"),
    restore: () => {
      process.env.PATH = prev;
    },
  };
}

test("stopWorker — 그 줄만 빠지고 파일·락은 그대로. 두 번째는 no-op이다(에러가 아니다)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" });
  const dir = path.join(root, "workers");
  const [w1, w2] = ["w1.sh", "w2.sh"].map((n) => path.join(dir, n));
  const other = "0 3 * * * /Users/x/bin/backup.sh\n";
  // running인 워커를 중단한다 — 락도 세션도 건드리면 안 된다(끝난 뒤에 멈춘다)
  putLock(dir, "w1", process.pid);
  const c = withLiveCrontab(`${other}${cronLine({ path: w1 })}\n${cronLine({ path: w2 })}\n`);
  try {
    assert.strictEqual(await stopWorker(root, "w1"), true);
    assert.strictEqual(c.tab(), `${other}${cronLine({ path: w2 })}\n`); // 남의 줄·w2 줄 그대로
    assert.strictEqual(statSync(w1).isFile(), true); // 파일은 남는다
    assert.strictEqual(statSync(lockPath(dir, "w1")).isDirectory(), true); // 락도 그대로
    const w = (await listWorkers(root)).find((x) => x.name === "w1")!;
    assert.strictEqual(w.cron, false);
    assert.strictEqual(w.status, "running"); // 물고 있는 티켓은 끝까지 간다

    assert.strictEqual(await stopWorker(root, "w1"), false); // 이미 미등록 = no-op
    assert.strictEqual(c.tab(), `${other}${cronLine({ path: w2 })}\n`);
    await assert.rejects(stopWorker(root, "없는워커"), /없는 워커입니다/);
  } finally {
    c.restore();
  }
});

test("startWorker — 중단의 역방향. 줄이 정확히 2줄 늘고, 두 번째는 no-op이다(§4 재등록)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" });
  const dir = path.join(root, "workers");
  const [w1, w2] = ["w1.sh", "w2.sh"].map((n) => path.join(dir, n));
  const other = "0 3 * * * /Users/x/bin/backup.sh\n";
  // running인데 미등록인 워커를 되살린다 — 락도 세션도 안 건드린다(다음 분부터 다시 부를 뿐이다)
  putLock(dir, "w1", process.pid);
  const c = withLiveCrontab(`${other}${cronLine({ path: w2 })}\n`);
  const count = (p: string) => c.tab().split("\n").filter((l) => l.includes(p)).length;
  try {
    assert.strictEqual(await startWorker(root, "w1"), true);
    assert.strictEqual(c.tab(), `${other}${cronLine({ path: w2 })}\n${cronLine({ path: w1 })}\n`);
    assert.strictEqual(count(w1), 2); // 등록 단위 2줄(제약 4)이 정확히 한 벌
    assert.strictEqual(statSync(lockPath(dir, "w1")).isDirectory(), true); // 락 그대로
    const w = (await listWorkers(root)).find((x) => x.name === "w1")!;
    assert.strictEqual(w.cron, true);
    assert.strictEqual(w.status, "running"); // 물고 있는 티켓은 그대로 간다

    // 이미 등록된 상태에서 다시 눌러도 줄이 늘지 않고 **no-op이라고 말한다**. 이 자리가
    // `registerCron`의 반환값과 갈린다: 줄을 지우고 맨 뒤에 다시 넣으므로 뒤에 남의 줄이
    // 있으면 텍스트는 바뀐다(changed=true) — 그래도 "등록돼 있었다"가 사실이다.
    await registerCron(w2); // w2를 맨 뒤로 보낸다 = w1 줄이 마지막이 아닌 배치
    assert.strictEqual(await startWorker(root, "w1"), false); // 화면이 말하는 사실은 이쪽이다
    // 텍스트는 실제로 바뀌었다(w1 줄이 w2 뒤로 갔다) — 그런데도 위가 no-op이라고 말한다
    assert.strictEqual(c.tab(), `${other}${cronLine({ path: w2 })}\n${cronLine({ path: w1 })}\n`);
    assert.strictEqual(count(w1), 2);
    assert.strictEqual(count("backup.sh"), 1); // 남의 잡은 그대로

    await assert.rejects(startWorker(root, "없는워커"), /없는 워커입니다/);
  } finally {
    c.restore();
  }
});

test("deleteWorker — running은 막는다(락과 세션이 붕 뜬다) · crontab 줄도 같이 뺀다", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" });
  putLock(path.join(root, "workers"), "w1", process.pid);
  const w2 = path.join(root, "workers", "w2.sh");
  const other = "0 3 * * * /Users/x/bin/backup.sh\n";
  const c = withLiveCrontab(`${other}${cronLine({ path: w2 })}\n`);
  try {
    await assert.rejects(deleteWorker(root, "w1"), /티켓을 물고 있습니다/);
    await deleteWorker(root, "w2");
    assert.deepStrictEqual((await listWorkers(root)).map((w) => w.name), ["w1"]);
    assert.strictEqual(c.tab(), other); // 그 줄만 빠지고 남의 줄은 그대로
  } finally {
    c.restore();
  }
});

test("deleteWorker — crontab 해제가 실패하면 파일을 지우지 않는다(절반 지워진 상태를 안 만든다)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n" });
  const w1 = path.join(root, "workers", "w1.sh");
  const line = `${cronLine({ path: w1 })}\n`;
  const c = withLiveCrontab(line, { failWrite: true });
  try {
    await assert.rejects(deleteWorker(root, "w1"), (e: Error & { cronFailed?: boolean }) => {
      // 화면이 해제 명령어를 이 실패에만 보여주는 근거다
      assert.strictEqual(e.cronFailed, true);
      assert.match(e.message, /파일은 지우지 않았습니다/);
      return true;
    });
    assert.strictEqual(statSync(w1).isFile(), true); // 파일이 살아 있고
    assert.strictEqual(c.tab(), line); //                crontab 줄도 그대로다
  } finally {
    c.restore();
  }
});

/** 승인 거부는 **기다림이 아니라 사유**다 (79d9b659 · §제약 4).
 *  TCC가 `앱 관리`를 거부하면 파일 조작이 EPERM으로 떨어지고 crontab은 블록되지 않고 죽는다 —
 *  쓰기 상한(3분)은 승인 창이 떠 있는 동안만 쓰인다. 픽스처의 stderr는 `/usr/bin/crontab`이
 *  실제로 가진 실패 문구다(`strings -a /usr/bin/crontab`: `error renaming %s to %s`). */
test("crontab 쓰기 거부 — 상한을 안 기다리고 즉시 실패하고 사유가 '앱 관리'다 (79d9b659)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n" });
  const w1 = path.join(root, "workers", "w1.sh");
  const c = withLiveCrontab("0 3 * * * /Users/x/bin/backup.sh\n", {
    failWrite: "crontab: error renaming /var/at/tmp/tmp.1 to /var/at/tabs/me: Operation not permitted",
  });
  const t0 = Date.now();
  try {
    await assert.rejects(registerCron(w1), /앱 관리.*시스템 설정 > 개인정보 보호 및 보안/);
    assert.ok(Date.now() - t0 < 5_000, `거부는 상한을 기다리지 않는다 (${Date.now() - t0}ms)`);
    assert.strictEqual(c.tab(), "0 3 * * * /Users/x/bin/backup.sh\n"); // 남의 줄 그대로
  } finally {
    c.restore();
  }
});

test("cronWriteError — 권한 거부만 '앱 관리'로 번역하고 나머지 실패는 그대로 (79d9b659)", () => {
  // 셋 다 crontab 바이너리에 실제로 있는 문구다. 거부가 어느 꼴로 오든 사유를 놓치지 않는다.
  for (const s of [
    "crontab: error renaming /var/at/tmp/tmp.1 to /var/at/tabs/me: Operation not permitted",
    "crontab: /var/at/tabs/me: Permission denied",
    "crontab command not allowed",
  ])
    assert.match(cronWriteError(s), /앱 관리/);
  // 권한과 무관한 실패는 번역하지 않는다 — 엉뚱한 조치를 시키면 사람이 거기서 막힌다
  assert.strictEqual(
    cronWriteError("errors in crontab file, can't install"),
    "crontab - 실패: errors in crontab file, can't install",
  );
});

// ── 엔진 · 모델 선택 (§4-3) ─────────────────────────────────────────────────

test("엔진 템플릿 — 바꿔 쓸 수 없는 자리 일곱을 고정한다 (§4-3 표)", () => {
  const claude = engineArgv("claude");
  // ① `--input-format stream-json` 인접. tick.sh:263-270이 이 인접성 하나로 FIFO를 판다 —
  //    떨어지면 §2-2 참견이 조용히 죽는다. 판정식을 엔진과 같은 모양으로 다시 쓴다.
  let fifo = false;
  for (let i = 1; i < claude.length; i++) {
    if (claude[i - 1] === "--input-format" && claude[i] === "stream-json") fifo = true;
  }
  assert.ok(fifo, `FIFO 판정이 안 선다: ${claude.join(" ")}`);
  // ② claude에는 {prompt}가 없다 — 최초 프롬프트는 FIFO로 간다(argv에도 넣으면 두 번 들어간다)
  assert.ok(!claude.join(" ").includes("{prompt}"));
  // ④ --session-id "{sid}" — tick.sh:94 reap 생존 판정과 §2-1 스트림 파일 이름이 이 값이다
  assert.ok(claude.join(" ").includes('--session-id "{sid}"'));

  // ③ codex에는 {prompt}가 있다 — codex exec는 프롬프트를 argv/stdin에서 1회만 읽는다
  const codex = engineArgv("codex");
  assert.ok(codex.join(" ").includes('"{prompt}"'));
  assert.strictEqual(codex[codex.length - 1], '"{prompt}"'); // 위치 인자라 맨 끝이다
  // 실측으로 정한 플래그 둘(§결과) — 빠지면 codex 워커가 티켓을 아예 수행하지 못한다
  assert.ok(codex.join(" ").includes("-s danger-full-access"));
  assert.ok(codex.includes("--skip-git-repo-check"));

  // ⑤ grok 템플릿에는 `--input-format`이 **없다.** 그 플래그가 CLI에 아예 없고(실측 §4-3 §grok),
  //    없는 것이 곧 FIFO를 안 파는 근거다 — 들어가면 tick.sh:263-270이 참견 채널을 잘못 판다.
  const grok = engineArgv("grok");
  assert.ok(!grok.includes("--input-format"), grok.join(" "));
  assert.ok(!grok.includes("--sandbox")); // grok 기본 sandbox가 이미 off다(근거 없는 플래그 금지)
  // grok은 codex와 같은 비스트리밍 경로이므로 프롬프트가 argv로 간다. 다만 위치 인자가 아니라
  // `-p`의 값이라 **맨 끝이 아니다** — 그래서 이 단언은 codex의 것과 모양이 갈린다.
  assert.deepStrictEqual(grok, [
    '"$HOME/.config/dira/bin/dira-grok"',
    "-p",
    '"{prompt}"',
    "--session-id",
    '"{sid}"',
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "streaming-messages-json",
  ]);
  // 모델을 주면 `-m <모델>`이 그 자리에 끼고 나머지 토큰 순서가 안 바뀐다
  assert.deepStrictEqual(engineArgv("grok", "grok-4.5"), [
    ...grok.slice(0, 7),
    "-m",
    "grok-4.5",
    ...grok.slice(7),
  ]);
  // ④의 나머지 절반 — grok에도 `--session-id "{sid}"`가 있다(tick.sh:94 reap · §2-1 스트림)
  assert.ok(grok.join(" ").includes('--session-id "{sid}"'));

  // ⑥ agy에도 {prompt}가 있고 **맨 끝이 `-p "{prompt}"`다** — 앞으로 옮기면 `-p`가 다음
  //    토큰을 프롬프트로 먹는다(§4-3 §agy). ⑦ `--print-timeout`은 `<T>`가 아니라 고정값
  //    `5400s`다 — 기본 5분이면 긴 티켓이 통째로 잘린다.
  const agy = engineArgv("agy");
  assert.deepStrictEqual(agy.slice(-2), ["-p", '"{prompt}"']);
  assert.ok(agy.join(" ").includes("--print-timeout 5400s"), agy.join(" "));
  assert.ok(!agy.includes("--input-format"));

  // 모델 목록 맨 앞은 `모델 지정 안 함` = 플래그를 안 붙인다
  for (const e of ENGINES) {
    assert.strictEqual(e.models[0], NO_MODEL);
    assert.ok(!engineArgv(e.id, NO_MODEL).includes(e.flag), `${e.id}: 플래그가 붙었다`);
    assert.deepStrictEqual(engineArgv(e.id, NO_MODEL), engineArgv(e.id));
  }
  assert.deepStrictEqual([...ENGINES.find((e) => e.id === "claude")!.models], [
    NO_MODEL,
    "opus",
    "sonnet",
    "fable",
    "haiku",
  ]);
  // grok은 `grok models`가 오늘 내는 이름 하나뿐이다 — 확인 못 한 이름을 올리지 않는다(§4-3)
  const g = ENGINES.find((e) => e.id === "grok")!;
  assert.strictEqual(g.flag, "-m");
  assert.deepStrictEqual([...g.models], [NO_MODEL, "grok-4.5"]);
});

test("엔진 카탈로그의 claude = tick.sh의 실제 기본값이다 (눈으로 안 맞춘다)", () => {
  // 손으로 적은 사본은 반드시 갈린다 — `DEFAULT_ENGINE`이 이미 한 번 갈려 있었다(§결과).
  // §27 계약 5: 카탈로그 argv[0]은 tick.sh의 `$FIXED_ENGINE`과 같은 리터럴이다 — 엔진 파일에서
  // 그 대입만 떼어 **진짜 bash로 펴서** 토큰을 대조한다(눈으로 안 맞춘다).
  const tick = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "tick.sh"), "utf8");
  const binDir = tick.match(/^BIN_DIR=.*$/m);
  assert.ok(binDir, "tick.sh에서 BIN_DIR 대입을 못 찾았다");
  const fixed = tick.match(/^FIXED_ENGINE=.*$/m);
  assert.ok(fixed, "tick.sh에서 FIXED_ENGINE 대입을 못 찾았다");
  const m = tick.match(/^\[ \$\{#TICKET_ENGINE\[@\]\} -eq 0 \] && (TICKET_ENGINE=\([\s\S]*?\))$/m);
  assert.ok(m, "tick.sh에서 기본 TICKET_ENGINE 대입을 못 찾았다");
  // HOME을 고정 문자열로 몰아 카탈로그 쪽 `$HOME` 리터럴 치환과 같은 값으로 맞춘다 — 실제
  // 홈 디렉터리를 안 밟는다.
  const HOME_STUB = "/tmp/dira-parity-test-home";
  const got = execFileSync(
    "bash",
    [
      "-c",
      `HOME=${HOME_STUB}\n${binDir[0]}\n${fixed[0]}\n${m[1]}\nprintf '%s\\n' "\${TICKET_ENGINE[@]}"`,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  // 카탈로그 토큰은 **파일에 적히는 모양**이라 `"{sid}"`처럼 따옴표와 `$HOME` 리터럴이 살아
  // 있다. bash가 벗기고 편 쪽에 맞춘다.
  assert.deepStrictEqual(
    engineArgv("claude").map((t) => t.replace(/^"(.*)"$/, "$1").replace("$HOME", HOME_STUB)),
    got,
  );
});

test("renderEngineBlock ↔ parseEngineValue — 카탈로그 전 조합이 왕복한다", () => {
  for (const e of ENGINES) {
    for (const m of [...e.models, "gpt-6-future-1"]) {
      const block = renderEngineBlock(e.id, m);
      // 공유 경계 파서가 우리가 쓴 블록을 거부하지 않는다(거부하면 그 워커는 다시 못 고친다)
      assert.ok(parseContextBlock(block, "TICKET_ENGINE").ok, `${e.id}/${m}: 블록을 못 읽는다`);
      const value = engineArgv(e.id, m).join(" ");
      assert.strictEqual(block, `TICKET_ENGINE=(${value})`);
      assert.deepStrictEqual(parseEngineValue(value), { engineId: e.id, model: m });
      // 엔진 이름 판정(§0-4 인증 배너)이 그대로 선다
      assert.strictEqual(engineName(value), e.id);
    }
  }
  // 스펙이 글자로 적어 둔 grok 두 문자열을 **손으로 적어** 되읽는다 — 위 루프는 카탈로그를
  // 다시 그려 대조하므로 카탈로그가 틀리면 같이 틀린다. 여기가 스펙 대조다(§4-3 §템플릿 3벌).
  assert.deepStrictEqual(
    parseEngineValue(
      '"$HOME/.config/dira/bin/dira-grok" -p "{prompt}" --session-id "{sid}"' +
        " --permission-mode bypassPermissions --output-format streaming-messages-json",
    ),
    { engineId: "grok", model: NO_MODEL },
  );
  assert.deepStrictEqual(
    parseEngineValue(
      '"$HOME/.config/dira/bin/dira-grok" -p "{prompt}" --session-id "{sid}"' +
        " --permission-mode bypassPermissions -m grok-4.5 --output-format streaming-messages-json",
    ),
    { engineId: "grok", model: "grok-4.5" },
  );
  // 손으로 쓴 커스텀은 null이다 — 토큰 하나만 달라도 카탈로그가 아니다
  assert.strictEqual(parseEngineValue("claude -p --dangerously-skip-permissions"), null);
  assert.strictEqual(parseEngineValue("codex exec --json \"{prompt}\""), null);
  assert.strictEqual(parseEngineValue("fake-engine {prompt}"), null);
  // 모델 자리에 셸 메타문자를 넣은 손편집도 카탈로그가 아니다(= 화면이 값으로 표시하지 않는다)
  assert.strictEqual(parseEngineValue(renderEngineBlock("codex").replace("--json", "$(x)")), null);
});

test("engineCell — 엔진 열에 빈칸이 되는 경우가 없다 (§비주얼 §23 ① 표시 4종)", () => {
  // ① 모델 있음 ② 모델 없음 — 둘 다 배지가 없다(파일에 있는 값을 그대로 그린다)
  assert.deepStrictEqual(engineCell(engineArgv("claude", "opus").join(" ")), {
    label: "claude · opus",
    badge: null,
    argv: engineArgv("claude", "opus").join(" "),
    value: { engineId: "claude", model: "opus" },
  });
  assert.strictEqual(engineCell(engineArgv("codex").join(" ")).label, "codex");

  // ③ 대입 없음 — **`claude`를 그리고 배지를 붙인다.** `기본값`이라고 얼버무리지 않는다.
  //    argv는 실제로 도는 tick.sh 기본값이고, 팝오버는 그 값에서 시작한다.
  const none = engineCell(null);
  assert.deepStrictEqual(none, {
    label: "claude",
    badge: "assumed",
    argv: engineArgv("claude").join(" "),
    value: { engineId: "claude", model: NO_MODEL },
  });
  // 같은 명령이 파일에 **적혀 있으면** 배지가 없다 — 이 한 비트가 셋째와 첫째를 가른다
  assert.strictEqual(engineCell(none.argv).badge, null);

  // ④ 카탈로그 밖 = 손으로 쓴 값. 첫 토큰 basename이 값이고 원문은 argv로 남는다
  assert.deepStrictEqual(engineCell("/opt/bin/mock-engine --flag {prompt}"), {
    label: "mock-engine",
    badge: "custom",
    argv: "/opt/bin/mock-engine --flag {prompt}",
    value: null, // 팝오버가 빈 채로 열린다 — 고르지 않으면 저장이 안 눌린다
  });

  // 넷 다 label이 비지 않는다(이 절이 막는 것이 빈칸이다)
  for (const e of [null, "", "x", engineArgv("codex", "gpt-5.5").join(" ")]) {
    assert.notStrictEqual(engineCell(e).label, "", `빈칸: ${e}`);
  }
});

test("personaEngineHint — 미지정 힌트 (§비주얼 §23 §개정 · 요구 445ff9e1)", () => {
  // 워커 0개 — 돌 것이 없어 기본값도 없다
  assert.strictEqual(personaEngineHint([]), null);

  // 전부 같은 실효 엔진(대입 없음도 `claude`로 같이 셈된다 — engineCell이 기본값을 편다)
  assert.strictEqual(
    personaEngineHint([null, null, engineArgv("claude").join(" ")]),
    "미지정 — 티켓을 집는 워커의 엔진을 씁니다 (지금 전부 claude)",
  );

  // 워커별로 다름 — 수 내림차순, 구분자 ` / `. 동률(1건씩)은 처음 나온 순서를 지킨다(안정 정렬).
  assert.strictEqual(
    personaEngineHint([
      engineArgv("claude").join(" "),
      engineArgv("claude").join(" "),
      engineArgv("codex").join(" "),
      engineArgv("claude", "opus").join(" "),
    ]),
    "미지정 — 티켓을 집는 워커의 엔진을 씁니다 (지금 claude ×2 / codex ×1 / claude · opus ×1)",
  );
});

