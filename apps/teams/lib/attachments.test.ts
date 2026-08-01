import { test } from "node:test";
import assert from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_BYTES,
  safeName,
  saveAttachment,
  verifyAttachments,
  withAttachments,
} from "./attachments.ts";

/** 픽스처 큐는 임시 디렉터리다 — **진짜 `.dira`를 건드리지 않는다.**
 *  realpath를 거치는 이유: macOS의 `/tmp`가 `/private/tmp` 심링크라 `resolveWithin`이 돌려주는
 *  경로와 문자열이 갈린다(방어가 심링크를 푸는 것이 맞다 — 픽스처를 맞춘다). */
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "fst-attach-")));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "dira");
mkdirSync(root, { recursive: true });
const project = { root };
const attachDir = path.join(root, "attachments");

const upload = (name: string, body = "hello") => new File([body], name);

test("`../` 이름이 attachments/ 밖으로 못 나간다", async () => {
  const r = await saveAttachment(project, upload("../../evil.txt", "pwned"));
  assert.ok(r.ok, r.ok ? "" : r.error);
  // 최종 경로는 attachments/ 바로 아래다 — 상위로 한 칸도 못 올라간다.
  assert.strictEqual(path.dirname(r.path), attachDir);
  assert.ok(!path.basename(r.path).includes("/"));
  // 탈출했다면 여기(큐 루트 · 그 위)에 파일이 생겼을 것이다.
  assert.deepStrictEqual(readdirSync(root), ["attachments"]);
  assert.deepStrictEqual(readdirSync(tmp), ["dira"]);
  assert.strictEqual(readFileSync(r.path, "utf8"), "pwned");
});

test("같은 이름 두 번이 서로 안 덮는다", async () => {
  const a = await saveAttachment(project, upload("shot.png", "첫째"));
  const b = await saveAttachment(project, upload("shot.png", "둘째"));
  assert.ok(a.ok && b.ok);
  assert.notStrictEqual(a.path, b.path);
  assert.strictEqual(readFileSync(a.path, "utf8"), "첫째");
  assert.strictEqual(readFileSync(b.path, "utf8"), "둘째");
  assert.ok(path.basename(a.path).endsWith("-shot.png"));
});

test("20MB 초과가 거절된다 — 다른 셋과 다른 문장이다", async () => {
  // 21MB를 실제로 할당하지 않는다: 크기 판정이 `arrayBuffer()` **앞**이라 읽히지 않는다
  // (그게 이 테스트가 못박는 것이기도 하다 — 읽은 뒤 거절하면 거절이 비싸다).
  const huge = {
    name: "dump.bin",
    size: MAX_BYTES + 1,
    arrayBuffer: () => assert.fail("상한을 넘겼는데 바이트를 읽었다"),
  } as unknown as File;
  const before = readdirSync(attachDir).length;
  const r = await saveAttachment(project, huge);
  assert.ok(!r.ok);
  assert.match(r.error, /20MB/);
  assert.strictEqual(readdirSync(attachDir).length, before, "거절했는데 파일이 생겼다");

  const noName = await saveAttachment(project, upload("...", "x"));
  assert.ok(!noName.ok);
  assert.match(noName.error, /이름/);
  assert.notStrictEqual(noName.error, r.error);
});

test("이름 정규화 — 치환 · 80자 · 앞뒤 점", () => {
  assert.strictEqual(safeName("a b/c\n한글.png"), "a_b_c_한글.png");
  assert.strictEqual(safeName("..hidden.txt."), "hidden.txt");
  assert.strictEqual(safeName("x".repeat(200) + ".png"), "x".repeat(80));
  assert.strictEqual(safeName("한글.png".normalize("NFD")), "한글.png"); // macOS가 주는 NFD
  assert.strictEqual(safeName("../../etc/passwd"), "_.._etc_passwd");
});

test("verifyAttachments — attachments/ 밖 경로는 본문에 못 실린다", async () => {
  // 폼이 돌려보내는 경로는 브라우저를 거친다 — hidden input은 값이 아니라 표기다.
  const outside = path.join(root, "tickets", "5bbed7c9.wip.md");
  mkdirSync(path.dirname(outside), { recursive: true });
  writeFileSync(outside, "비밀");
  await assert.rejects(() => verifyAttachments(project, [outside]), /attachments\/ 밖/);
  // `..`로 기어 올라가는 것도 같은 판정이다(문자열이 `attachments/`로 시작해도 소용없다).
  await assert.rejects(
    () => verifyAttachments(project, [path.join(attachDir, "..", "tickets", "5bbed7c9.wip.md")]),
    /attachments\/ 밖/,
  );
  // 심링크로 나가는 것도 막는다 — 문자열 비교로는 못 막는 자리다.
  const link = path.join(attachDir, "escape.md");
  symlinkSync(outside, link);
  await assert.rejects(() => verifyAttachments(project, [link]), /attachments\/ 밖/);

  // 진짜로 올린 것은 그대로 통과한다.
  const ok = await saveAttachment(project, upload("note.txt", "본문"));
  assert.ok(ok.ok);
  assert.deepStrictEqual(await verifyAttachments(project, [ok.path]), [ok.path]);
  // 빈 목록은 fs를 안 만진다 — `attachments/`가 아직 없는 프로젝트에서도 던지지 않는다.
  assert.deepStrictEqual(await verifyAttachments({ root: path.join(tmp, "없는큐") }, []), []);
});

test("withAttachments — 빈 목록은 원문 그대로", () => {
  const t = "본문입니다\n\n마지막 줄\n";
  assert.strictEqual(withAttachments(t, []), t);
  assert.strictEqual(withAttachments("", []), "");
});

test("withAttachments — 빈 줄 하나 + 안내 한 줄 + 경로 n줄", () => {
  const out = withAttachments("본문\n", ["/q/attachments/ab12cd34-a.png", "/q/attachments/7f0e91c2-b.txt"]);
  assert.strictEqual(
    out,
    [
      "본문",
      "",
      "첨부 파일 — 아래 경로를 Read로 읽어라:",
      "/q/attachments/ab12cd34-a.png",
      "/q/attachments/7f0e91c2-b.txt",
    ].join("\n"),
  );
  // 본문이 비어도 안내가 맨 앞이다(빈 줄로 시작하지 않는다).
  assert.ok(withAttachments("", ["/q/attachments/ab12cd34-a.png"]).startsWith("첨부 파일"));
});
