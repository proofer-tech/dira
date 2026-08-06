import { test } from "node:test";
import assert from "node:assert";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "./projects.ts";
import {
  CORE_INLINED,
  createFile,
  deleteFile,
  isCoreLayerName,
  listTree,
  mirrorCore,
  readCore,
  readTextFile,
  renameFile,
  saveFile,
} from "./protocols.ts";

/** 재정의 큐 픽스처 — `TICKET_PROTOCOLS`가 **루트 밖**을 가리킨다.
 *
 *  이 레포의 큐는 관례대로 `<루트>/protocols`를 쓰므로 재정의 경로를 우연히 검증해주지 않는다
 *  (DESIGN.md §설정 해석). 기준을 프로젝트 root로 잘못 잡은 코드는 여기서만 걸린다.
 *
 *      <tmp>/proj/.dira/   ← 프로젝트 root
 *      <tmp>/shared-protocols/   ← TICKET_PROTOCOLS (루트 밖. 여러 큐가 공유하는 그 경우)
 *      <tmp>/secrets/            ← 아무 화면도 못 읽어야 하는 곳
 */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-proto-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "proj", ".dira");
const shared = path.join(tmp, "shared-protocols");
const secrets = path.join(tmp, "secrets");
mkdirSync(path.join(root, "tickets"), { recursive: true });
mkdirSync(path.join(root, "workers"), { recursive: true });
mkdirSync(path.join(root, "protocols"), { recursive: true }); // 관례 경로 — 재정의가 이걸 이겨야 한다
mkdirSync(path.join(shared, "부록"), { recursive: true });
mkdirSync(secrets, { recursive: true });

writeFileSync(
  path.join(root, "workers", "w1.sh"),
  `#!/bin/bash\nexport TICKET_PROTOCOLS="${shared}"\n. tick.sh\n`,
);
writeFileSync(path.join(shared, "AGENTS.md"), "협업 프로토콜\n"); // 8자 + 개행 = 9
writeFileSync(path.join(shared, "tickets.md"), "티켓 문법\n");
writeFileSync(path.join(shared, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]));
writeFileSync(path.join(shared, "부록", "용어.md"), "용어집\n");
writeFileSync(path.join(root, "protocols", "AGENTS.md"), "이건 재정의에 가려진다\n");
writeFileSync(path.join(secrets, "id_rsa"), "비밀");
symlinkSync(secrets, path.join(shared, "escape")); // 기준 안에서 밖을 가리키는 심링크

// ── 해석된 디렉터리 ─────────────────────────────────────────────────────────

test("기준은 해석된 TICKET_PROTOCOLS다 — 루트 밖이고 assumed가 아니다", async () => {
  const c = await resolveConfig({ root });
  assert.strictEqual(c.protocols, shared);
  assert.ok(!c.assumed.includes("protocols"));
  assert.ok(!c.protocols.startsWith(root), "재정의 경로가 루트 밖이라는 게 이 픽스처의 전제다");
});

// ── 트리 ────────────────────────────────────────────────────────────────────

test("중첩 트리 — 부모 바로 뒤에 자식, .md 아닌 파일도 보인다", async () => {
  const tree = await listTree(shared);
  assert.deepStrictEqual(
    tree.map((e) => [e.rel, e.depth, e.isDir]),
    [
      ["AGENTS.md", 0, false],
      ["escape", 0, false], // 심링크는 디렉터리로 치지 않는다 — 따라 들어가지 않는다
      ["logo.png", 0, false], // .md가 아니어도 트리에 있다
      ["tickets.md", 0, false],
      ["부록", 0, true],
      ["부록/용어.md", 1, false],
    ],
  );
  // 심링크 안(secrets/id_rsa)은 목록에 없다
  assert.ok(!tree.some((e) => e.rel.includes("id_rsa")));
});

test("최상위 AGENTS.md만 인라인 문자 수를 단다", async () => {
  const tree = await listTree(shared);
  assert.strictEqual(tree.find((e) => e.rel === "AGENTS.md")!.inlineChars, "협업 프로토콜\n".length);
  assert.strictEqual(tree.find((e) => e.rel === "부록/용어.md")!.inlineChars, undefined);
});

test("디렉터리가 없으면 빈 트리 — 에러가 아니다", async () => {
  assert.deepStrictEqual(await listTree(path.join(tmp, "없는디렉터리")), []);
});

// ── 경로 방어 (신뢰 경계) ───────────────────────────────────────────────────

test("탈출 거부 — ../ · 절대경로 · 심링크. 읽기·쓰기·생성·삭제·이름변경 전부", async () => {
  const escapes = ["../secrets/id_rsa", "부록/../../secrets/id_rsa", path.join(secrets, "id_rsa"), "escape/id_rsa"];
  for (const bad of escapes) {
    await assert.rejects(() => readTextFile(shared, bad), /기준 디렉터리 밖/, `read ${bad}`);
    await assert.rejects(() => saveFile(shared, bad, "덮어쓰기"), /기준 디렉터리 밖/, `save ${bad}`);
    await assert.rejects(() => createFile(shared, bad), /기준 디렉터리 밖/, `create ${bad}`);
    await assert.rejects(() => deleteFile(shared, bad), /기준 디렉터리 밖/, `delete ${bad}`);
    await assert.rejects(() => renameFile(shared, "tickets.md", bad), /기준 디렉터리 밖/, `rename→ ${bad}`);
    await assert.rejects(() => renameFile(shared, bad, "훔친것.md"), /기준 디렉터리 밖/, `rename← ${bad}`);
  }
  // 거부는 말뿐이 아니다 — 파일이 실제로 그대로다
  assert.strictEqual(readFileSync(path.join(secrets, "id_rsa"), "utf8"), "비밀");
  assert.strictEqual(readFileSync(path.join(shared, "tickets.md"), "utf8"), "티켓 문법\n");

  // 프로젝트 root 안이라도 기준(해석된 protocols) 밖이면 거부다 — root는 기준이 아니다
  await assert.rejects(() => readTextFile(shared, path.join(root, "protocols", "AGENTS.md")), /기준 디렉터리 밖/);
});

// ── 읽기 ────────────────────────────────────────────────────────────────────

test("텍스트만 열린다 — 바이너리는 사유를 준다", async () => {
  assert.strictEqual((await readTextFile(shared, "AGENTS.md")).text, "협업 프로토콜\n");
  const png = await readTextFile(shared, "logo.png");
  assert.strictEqual(png.text, null);
  assert.match(png.reason!, /NUL/);
  assert.strictEqual((await readTextFile(shared, "부록")).text, null);
});

// ── 쓰기 ────────────────────────────────────────────────────────────────────

test("저장 · 생성(O_EXCL) · 이름변경(덮어쓰지 않는다) · 삭제", async () => {
  await saveFile(shared, "tickets.md", "티켓 문법 v2\n");
  assert.strictEqual(readFileSync(path.join(shared, "tickets.md"), "utf8"), "티켓 문법 v2\n");

  assert.strictEqual(await createFile(shared, "부록/새문서.md"), path.join("부록", "새문서.md"));
  await assert.rejects(() => createFile(shared, "부록/새문서.md"), /EEXIST/); // O_EXCL
  await assert.rejects(() => createFile(shared, "   "), /파일 이름/);

  // 이름변경이 기존 파일을 조용히 먹지 않는다(rename이었으면 tickets.md가 사라진다)
  await assert.rejects(() => renameFile(shared, "부록/새문서.md", "tickets.md"), /EEXIST/);
  assert.strictEqual(readFileSync(path.join(shared, "tickets.md"), "utf8"), "티켓 문법 v2\n");

  assert.strictEqual(await renameFile(shared, "부록/새문서.md", "옮긴것.md"), "옮긴것.md");
  assert.strictEqual(readFileSync(path.join(shared, "옮긴것.md"), "utf8"), "");

  await deleteFile(shared, "옮긴것.md");
  await assert.rejects(() => deleteFile(shared, "부록"), /디렉터리는/); // 디렉터리는 안 지운다
  await assert.rejects(() => saveFile(shared, "옮긴것.md", "x"), /파일이 없습니다/);
});

// ── 코어 — 큐 밖 · 읽기만 ───────────────────────────────────────────────────

test("코어는 엔진 레포에서 읽고, 못 읽으면 사유다. 쓰는 경로는 없다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  const engine = path.join(tmp, "engine");
  const coreDir = path.join(engine, "protocols");
  mkdirSync(engine, { recursive: true });
  process.env.DIRA_ENGINE = engine;
  const full = path.join(coreDir, "CORE.md");

  // `shared`는 이 파일의 기본 재정의 큐 픽스처다 — `CORE.md`가 없으니 vendored가 아니고,
  // 아래 전부 엔진 폴백(결정 8-b)을 거친다.
  // ① 엔진 레포를 못 찾으면(tick.sh 없음) 던지지 않는다 — 화면은 항목만 빼고 종전대로 돈다
  const noRepo = await readCore(shared);
  assert.ok("error" in noRepo && noRepo.error.includes(engine), `사유에 경로가 없다: ${JSON.stringify(noRepo)}`);

  // ② 레포는 찾았는데 코어 디렉터리가 없다 → 사유에 **본 경로**가 그대로 담긴다(삼키지 않는다)
  writeFileSync(path.join(engine, "tick.sh"), "");
  const noDir = await readCore(shared);
  assert.ok("error" in noDir && noDir.error.includes(coreDir), `사유에 경로가 없다: ${JSON.stringify(noDir)}`);
  assert.ok("error" in noDir && noDir.error.includes("ENOENT"), "무엇이 왜 안 됐는지 남아야 한다");

  // ②' 디렉터리는 있는데 `.md`가 하나도 없다 → 이것도 사유다(빈 트리로 조용히 넘기지 않는다)
  mkdirSync(coreDir);
  writeFileSync(path.join(coreDir, "메모.txt"), "코어가 아니다\n");
  const noMd = await readCore(shared);
  assert.ok("error" in noMd && noMd.error.includes(coreDir), `사유에 경로가 없다: ${JSON.stringify(noMd)}`);

  // ③ 있으면 경로 + 전문. 이 둘이 화면의 출처 표시와 인라인 문자 수다. `vendored: false`가
  // 화면의 CoreView가 "엔진 레포에 있습니다" 산문을 고를 근거다(§프롬프트 층 결정 8-d)
  writeFileSync(full, "코어 규약\n");
  assert.deepStrictEqual(await readCore(shared), {
    files: [{ name: "CORE.md", path: full, text: "코어 규약\n" }],
    vendored: false,
  });

  // ④ **서버에 코어를 쓰는 경로가 없다.** 편집 함수는 전부 기준 디렉터리(= 큐 안)만 받는다 —
  //    화면만 잠근 게 아니라는 증거다. 사유뿐 아니라 파일이 실제로 그대로인 것까지 본다.
  await assert.rejects(() => saveFile(shared, full, "덮어쓰기"), /기준 디렉터리 밖/);
  await assert.rejects(() => deleteFile(shared, full), /기준 디렉터리 밖/);
  await assert.rejects(() => renameFile(shared, "tickets.md", full), /기준 디렉터리 밖/);
  await assert.rejects(() => createFile(shared, full), /기준 디렉터리 밖/);
  assert.strictEqual(readFileSync(full, "utf8"), "코어 규약\n");
});

test("코어는 한 장이 아니다 — 디렉터리의 *.md 전부 · CORE.md가 먼저 · 재귀 없음", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  const engine = path.join(tmp, "engine-multi");
  const coreDir = path.join(engine, "protocols");
  mkdirSync(path.join(coreDir, "부속"), { recursive: true });
  writeFileSync(path.join(engine, "tick.sh"), "");
  process.env.DIRA_ENGINE = engine;

  writeFileSync(path.join(coreDir, "CORE-TICKETS.md"), "티켓 문법\n");
  writeFileSync(path.join(coreDir, "CORE.md"), "코어 규약\n"); // 사전순으로는 뒤다 — 그래도 먼저다
  writeFileSync(path.join(coreDir, "CORE-ZZZ.md"), "나중\n");
  writeFileSync(path.join(coreDir, "메모.txt"), "md가 아니다\n");
  writeFileSync(path.join(coreDir, "부속", "깊은것.md"), "한 단계만 읽는다\n");
  mkdirSync(path.join(coreDir, "함정.md")); // 이름만 .md인 디렉터리 — readFile이 EISDIR로 터진다

  const core = await readCore(shared); // vendored 아님 — `shared`에는 CORE.md가 없다
  assert.ok("files" in core, `사유가 왔다: ${JSON.stringify(core)}`);
  assert.deepStrictEqual(
    core.files.map((f) => [f.name, f.text]),
    [
      ["CORE.md", "코어 규약\n"], // 인라인되는 것이 맨 위
      ["CORE-TICKETS.md", "티켓 문법\n"],
      ["CORE-ZZZ.md", "나중\n"],
    ],
  );
  assert.deepStrictEqual(
    core.files.map((f) => f.path),
    core.files.map((f) => path.join(coreDir, f.name)),
  );
  assert.strictEqual(CORE_INLINED, "CORE.md"); // 배지가 붙는 유일한 이름
});

// ── 코어 — vendored 큐 (§프롬프트 층 결정 8-d) ───────────────────────────────

test("vendored 큐 — 큐 protocols/CORE.md가 있으면 엔진 대신 큐 사본을 읽는다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  // 엔진도 같이 세운다 — vendored 우선이 "엔진이 없어서 어쩔 수 없이"가 아니라는 걸 보이려고.
  const engine = path.join(tmp, "engine-vendored");
  const engineCoreDir = path.join(engine, "protocols");
  mkdirSync(engineCoreDir, { recursive: true });
  writeFileSync(path.join(engine, "tick.sh"), "");
  writeFileSync(path.join(engineCoreDir, "CORE.md"), "엔진 원본\n");
  process.env.DIRA_ENGINE = engine;

  const vqueue = path.join(tmp, "vendored-queue", "protocols");
  mkdirSync(vqueue, { recursive: true });
  writeFileSync(path.join(vqueue, "AGENTS.md"), "프로젝트 층 — 코어가 아니다\n");
  writeFileSync(path.join(vqueue, "tickets.md"), "프로젝트 층 — 코어가 아니다\n");
  writeFileSync(path.join(vqueue, "CORE.md"), "큐 사본\n");
  writeFileSync(path.join(vqueue, "CORE-TICKETS.md"), "큐 사본 문법\n");

  const core = await readCore(vqueue);
  assert.ok("files" in core, `사유가 왔다: ${JSON.stringify(core)}`);
  assert.strictEqual(core.vendored, true);
  // 출처 경로가 큐 쪽 절대경로다 — 엔진 쪽이 아니다(§Done when 1)
  assert.deepStrictEqual(
    core.files.map((f) => [f.name, f.path, f.text]),
    [
      ["CORE.md", path.join(vqueue, "CORE.md"), "큐 사본\n"],
      ["CORE-TICKETS.md", path.join(vqueue, "CORE-TICKETS.md"), "큐 사본 문법\n"],
    ],
  );
  // 프로젝트 층 파일(AGENTS.md·tickets.md)은 코어가 아니다 — 같은 디렉터리라도 안 낀다
  assert.ok(!core.files.some((f) => f.name === "AGENTS.md" || f.name === "tickets.md"));
});

test("vendored 안 된 큐(이 큐)에서는 종전대로 엔진 경로·본문이다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  const engine = path.join(tmp, "engine-fallback");
  const coreDir = path.join(engine, "protocols");
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(path.join(engine, "tick.sh"), "");
  writeFileSync(path.join(coreDir, "CORE.md"), "엔진 원본\n");
  process.env.DIRA_ENGINE = engine;

  const core = await readCore(shared); // `shared`에 CORE.md 없음 — vendored 판정 실패
  assert.ok("files" in core, `사유가 왔다: ${JSON.stringify(core)}`);
  assert.strictEqual(core.vendored, false);
  assert.strictEqual(core.files[0].path, path.join(coreDir, "CORE.md"));
});

// ── 트리 — vendored 큐의 CORE*.md는 편집 가능 목록에 없다 (§프롬프트 층 결정 8-d) ─────

test("isCoreLayerName — CORE.md·CORE-*.md만, 그 밖은 아니다", () => {
  assert.strictEqual(isCoreLayerName("CORE.md"), true);
  assert.strictEqual(isCoreLayerName("CORE-TICKETS.md"), true);
  assert.strictEqual(isCoreLayerName("CORE-MEMORY.md"), true);
  assert.strictEqual(isCoreLayerName("AGENTS.md"), false);
  assert.strictEqual(isCoreLayerName("core.md"), false); // 대소문자 그대로 — macOS 충돌 방지(결정 6)
  assert.strictEqual(isCoreLayerName("CORE"), false); // .md 없음
  assert.strictEqual(isCoreLayerName("CORE-.md"), true); // 접두만 맞으면 된다 — 이름은 자유
});

test("최상위 CORE*.md는 listTree에 안 뜬다 — 저장·삭제·이름변경 경로가 안 닿는다", async () => {
  const vqueue = path.join(tmp, "vendored-tree", "protocols");
  mkdirSync(path.join(vqueue, "부록"), { recursive: true });
  writeFileSync(path.join(vqueue, "AGENTS.md"), "프로젝트 층\n");
  writeFileSync(path.join(vqueue, "CORE.md"), "큐 사본\n");
  writeFileSync(path.join(vqueue, "CORE-TICKETS.md"), "큐 사본 문법\n");
  // 하위 디렉터리의 CORE.md는 이름 규칙(결정 6 접두)일 뿐 최상위 코어가 아니다 — 안 뺀다
  writeFileSync(path.join(vqueue, "부록", "CORE.md"), "이건 그냥 이름이 같은 프로젝트 파일\n");

  const tree = await listTree(vqueue);
  assert.deepStrictEqual(
    tree.map((e) => e.rel),
    ["AGENTS.md", "부록", "부록/CORE.md"],
  );

  // 저장·삭제·이름변경 경로 자체는 열려 있다(트리에서 뺀 것과 서버 방어를 혼동하지 않는다) —
  // 이 티켓이 막는 것은 "화면이 편집기를 보여주는 것"이고 fs 방어는 §신뢰 경계 별개다.
  // 여기서는 "안 보인다"만 못박는다.
});

// ── 미러링 (§프롬프트 층 결정 8-c) ───────────────────────────────────────────

test("CORE.md가 없는 큐(폴백)는 미러링이 아무것도 안 쓴다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  const engine = path.join(tmp, "engine-fallback");
  mkdirSync(path.join(engine, "protocols"), { recursive: true });
  writeFileSync(path.join(engine, "tick.sh"), "");
  writeFileSync(path.join(engine, "protocols", "CORE.md"), "엔진 코어\n");
  process.env.DIRA_ENGINE = engine;

  const queue = path.join(tmp, "mirror-fallback-queue", "protocols");
  mkdirSync(queue, { recursive: true });
  writeFileSync(path.join(queue, "AGENTS.md"), "프로젝트 문서\n");

  await mirrorCore(queue);
  assert.deepStrictEqual(readdirSync(queue).sort(), ["AGENTS.md"]); // CORE.md가 새로 생기지 않는다
});

test("vendored 큐(CORE.md 있음) — 덮고, 새 형제를 만들고, 없어진 CORE-*.md를 지운다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  const engine = path.join(tmp, "engine-mirror");
  const coreDir = path.join(engine, "protocols");
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(path.join(engine, "tick.sh"), "");
  writeFileSync(path.join(coreDir, "CORE.md"), "엔진 코어 v2\n");
  writeFileSync(path.join(coreDir, "CORE-NEW.md"), "새 형제\n");
  process.env.DIRA_ENGINE = engine;

  const queue = path.join(tmp, "mirror-vendored-queue", "protocols");
  mkdirSync(queue, { recursive: true });
  writeFileSync(path.join(queue, "CORE.md"), "사람이 지우려 했던 옛 코어\n"); // 사람 편집 흔적
  writeFileSync(path.join(queue, "CORE-OLD.md"), "엔진에서 없어진 형제\n"); // 지워져야 한다
  writeFileSync(path.join(queue, "AGENTS.md"), "프로젝트 문서\n"); // 편집 가능한 층 — 안 건드린다

  await mirrorCore(queue);

  assert.strictEqual(readFileSync(path.join(queue, "CORE.md"), "utf8"), "엔진 코어 v2\n");
  assert.strictEqual(readFileSync(path.join(queue, "CORE-NEW.md"), "utf8"), "새 형제\n");
  assert.strictEqual(readFileSync(path.join(queue, "AGENTS.md"), "utf8"), "프로젝트 문서\n");
  assert.deepStrictEqual(readdirSync(queue).sort(), ["AGENTS.md", "CORE-NEW.md", "CORE.md"]);
});

test("엔진을 못 찾으면 vendored 큐도 손대지 않는다", async (t) => {
  t.after(() => void delete process.env.DIRA_ENGINE);
  process.env.DIRA_ENGINE = path.join(tmp, "없는엔진");

  const queue = path.join(tmp, "mirror-orphan-queue", "protocols");
  mkdirSync(queue, { recursive: true });
  writeFileSync(path.join(queue, "CORE.md"), "그대로여야 한다\n");

  await mirrorCore(queue);
  assert.strictEqual(readFileSync(path.join(queue, "CORE.md"), "utf8"), "그대로여야 한다\n");
});
