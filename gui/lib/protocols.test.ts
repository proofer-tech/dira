import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "./tenants.ts";
import {
  createFile,
  deleteFile,
  listTree,
  readTextFile,
  renameFile,
  saveFile,
} from "./protocols.ts";

/** 재정의 큐 픽스처 — `TICKET_PROTOCOLS`가 **루트 밖**을 가리킨다.
 *
 *  이 레포의 큐는 관례대로 `<루트>/protocols`를 쓰므로 재정의 경로를 우연히 검증해주지 않는다
 *  (DESIGN.md §설정 해석). 기준을 테넌트 root로 잘못 잡은 코드는 여기서만 걸린다.
 *
 *      <tmp>/proj/.fs-tickets/   ← 테넌트 root
 *      <tmp>/shared-protocols/   ← TICKET_PROTOCOLS (루트 밖. 여러 큐가 공유하는 그 경우)
 *      <tmp>/secrets/            ← 아무 화면도 못 읽어야 하는 곳
 */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-proto-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "proj", ".fs-tickets");
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

  // 테넌트 root 안이라도 기준(해석된 protocols) 밖이면 거부다 — root는 기준이 아니다
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
