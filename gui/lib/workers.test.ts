import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listTickets } from "./queue.ts";

// 진짜 락 디렉터리(~/.config/fs-tickets/run)를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  copyContext,
  createWorker,
  cronRegisterCmd,
  cronUnregisterCmd,
  deleteWorker,
  lockPath,
  listWorkers,
  parseContextBlock,
  renderContextBlock,
  workerSummary,
  writeContext,
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
  const workers = "/Users/x/Projects/p/.fs-tickets/workers";
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
  // crontab에 없는 워커는 stopped다. 이 판정이 뒤집히면 요약이 거짓말을 한다.
  assert.strictEqual(workerSummary(ws), "running 1 / stale 1 / stopped 1");
  assert.strictEqual(workerSummary([]), "—");
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
  // 픽스처가 진짜 NFD인지 못박는다 — 같아지면 이 테스트는 아무것도 검증하지 않는다
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
  for (const [n, body] of Object.entries(workers)) writeFileSync(path.join(root, "workers", n), body);
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
  assert.match(w.lastLog!, /\[reviewer\] SKIP/);
});

test("주석 처리된 할당문은 설정이 아니다 (worker.sh.example이 통째로 주석이다)", async () => {
  const root = makeRoot({
    "w1.sh": '#!/bin/bash\n# TICKET_NAME="w9"\n# TICKET_ENGINE=(codex exec)\n. "$HOME/x/tick.sh"\n',
  });
  const [w] = await listWorkers(root);
  assert.strictEqual(w.name, "w1");
  assert.match(w.engine, /^claude -p /); // tick.sh 기본값
  // 주석의 TICKET_NAME=w9를 먹었다면 락을 엉뚱한 이름으로 찾는다
  putLock(path.join(root, "workers"), "w1", process.pid);
  assert.strictEqual((await listWorkers(root))[0].status, "running");
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
  // 티켓을 안 넘기면 항상 null이다(테넌트 목록 요약이 그렇게 부른다)
  assert.strictEqual((await listWorkers(root))[0].holding, null);
});

test("cron 명령어 — 공백·작은따옴표가 든 경로를 셸이 한 인자로 받는다", () => {
  // 실제로 있는 큐다: 구글 공유 드라이브 경로에 공백과 한글이 들어간다
  const p = "/Users/x/공유 드라이브/it's/workers/w1.sh";
  const expected = `* * * * * "${p}" >> "/Users/x/공유 드라이브/it's/workers/cron.log" 2>&1`;
  // 등록 명령의 echo 부분만 떼어 진짜 셸에 먹인다 — crontab을 건드리지 않고 인용만 검증한다
  const cmd = cronRegisterCmd({ path: p })
    .replace("(crontab -l 2>/dev/null; ", "(")
    .replace(") | crontab -", ")");
  assert.strictEqual(execFileSync("sh", ["-c", cmd], { encoding: "utf8" }).trimEnd(), expected);
  assert.ok(cronUnregisterCmd({ path: p }).includes("grep -Fv"));
});

test("createWorker — 기존 워커를 템플릿으로 755 생성, 덮어쓰기·워커 0개는 거부", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\nTICKET_CWD=/tmp\n. tick.sh\n" });
  const { path: file, template } = await createWorker(root, "w2");
  assert.strictEqual(template, "w1.sh");
  assert.strictEqual(statSync(file).mode & 0o777, 0o755);
  assert.strictEqual(execFileSync("cat", [file], { encoding: "utf8" }), "#!/bin/bash\nTICKET_CWD=/tmp\n. tick.sh\n");
  // O_EXCL: 돌고 있는 워커를 덮어쓰지 않는다
  await assert.rejects(createWorker(root, "w2"), /EEXIST/);
  await assert.rejects(createWorker(root, "../evil"), /영문·숫자/);
  // 워커 0개면 템플릿이 없다 — 엔진 코드 위치를 GUI가 모른다
  await assert.rejects(createWorker(makeRoot({}), "w1"), /템플릿으로 쓸 워커가 없습니다/);
});

// ── TICKET_CONTEXT 블록 ─────────────────────────────────────────────────────

/** 이 레포의 w1.sh와 같은 모양 */
const CTX_SH = `#!/bin/bash
TICKET_CWD="$HOME/wt/w1"

# --- 참조 컨텍스트 ---
TICKET_CONTEXT=(
  "$TICKET_CWD/docs/DESIGN.md|GUI 제품 스펙"
  "$TICKET_CWD/gui/AGENTS.md|코드 규약"
)

. "$HOME/Projects/fs-tickets/tick.sh"
`;

test("parseContextBlock — 정상 블록: 항목·치환 구간을 정확히 짚는다", () => {
  const b = parseContextBlock(CTX_SH);
  assert.ok(b.ok);
  assert.deepStrictEqual(b.items, [
    { path: "$TICKET_CWD/docs/DESIGN.md", desc: "GUI 제품 스펙" },
    { path: "$TICKET_CWD/gui/AGENTS.md", desc: "코드 규약" },
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
  assert.strictEqual(text.endsWith('. "$HOME/Projects/fs-tickets/tick.sh"\n'), true);
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
  ] as const) {
    await assert.rejects(writeContext(root, "w1", items as { path: string; desc: string }[]), re);
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

test("copyContext — $TICKET_CWD가 살아 옮겨간다(받는 워커는 자기 워크트리를 가리킨다)", async () => {
  const root = makeRoot({
    "w1.sh": CTX_SH,
    "w2.sh": '#!/bin/bash\nTICKET_CWD="$HOME/wt/w2"\nTICKET_CONTEXT=(\n  "/old.md|옛것"\n)\n',
  });
  const ctx = await copyContext(root, "w1", "w2");
  assert.ok(ctx.ok);
  assert.deepStrictEqual(
    ctx.items.map((i) => i.path),
    ["$TICKET_CWD/docs/DESIGN.md", "$TICKET_CWD/gui/AGENTS.md"],
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

test("deleteWorker — running은 막는다(락과 세션이 붕 뜬다)", async () => {
  const root = makeRoot({ "w1.sh": "#!/bin/bash\n", "w2.sh": "#!/bin/bash\n" });
  putLock(path.join(root, "workers"), "w1", process.pid);
  await assert.rejects(deleteWorker(root, "w1"), /티켓을 물고 있습니다/);
  await deleteWorker(root, "w2");
  assert.deepStrictEqual((await listWorkers(root)).map((w) => w.name), ["w1"]);
});
