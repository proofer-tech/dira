import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  deletePersonaMemory,
  extractSkillArchive,
  fetchSkillFromAddress,
  installSkill,
  listInstalledSkills,
  memoryExcerpt,
  parseSkillAddress,
  PersonaEngineCustomError,
  pickedSkills,
  readPersonaEngine,
  readPersonaLimit,
  readPersonaMemory,
  readPersonaOffSkillsFile,
  readPersonaSkills,
  readPersonaSkillsFile,
  SkillInstallError,
  writePersonaEngine,
  writePersonaLimit,
  writePersonaOffSkills,
  writePersonaSkills,
} from "./skills.ts";
import { skillUploadError } from "./skill-upload-limit.ts";
import { renderEngineBlock } from "./workers.ts";
import { MAX_BYTES } from "./attachment-limit.ts";

/** 설치된 스킬 픽스처 — **이 머신의 `~/.claude`를 읽지 않는다.** 머신마다 결과가 달라
 *  회귀 판정이 안 된다(티켓 d608feb3). `<config>`를 인자로 주입한다.
 *
 *      <tmp>/config/skills/alpha/SKILL.md              사용자 스킬
 *      <tmp>/config/skills/pack/beta/SKILL.md          한 단계 중첩
 *      <tmp>/config/skills/noname/SKILL.md             name: 없음 → 안 뜬다
 *      <tmp>/config/skills/empty/                      SKILL.md 없음 → 안 뜬다
 *      <tmp>/config/plugins/marketplaces/mkt/skills/gamma/SKILL.md   플러그인 스킬
 */
const tmp = mkdtempSync(path.join(tmpdir(), "fst-skills-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const config = path.join(tmp, "config");
const personas = path.join(tmp, "personas"); // 해석된 TICKET_PERSONAS
mkdirSync(personas, { recursive: true });

function skillFile(rel: string, text: string) {
  const full = path.join(config, rel, "SKILL.md");
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

skillFile("skills/alpha", `---\nname: alpha\ndescription: 한 줄짜리 설명이다.\n---\n\n# alpha\n`);
// YAML 접힘(`>`) — 실제 SKILL.md가 이 모양이다(ponytail·superpowers 등).
skillFile(
  "skills/pack/beta",
  `---\nname: beta\ndescription: >\n  첫 줄이고\n  둘째 줄이다.\n\n  문단이 갈려도 한 줄로 접는다.\nallowed-tools: Read\n---\n본문\n`,
);
skillFile("skills/noname", `---\ndescription: 이름이 없으면 지목할 수 없다\n---\n`);
mkdirSync(path.join(config, "skills", "empty"), { recursive: true });
skillFile(
  "plugins/marketplaces/mkt/skills/gamma",
  `---\nname: "gamma"\ndescription: '따옴표는 벗긴다'\n---\n`,
);

test("설치된 스킬 — 세 자리를 훑고, 접힌 description은 한 줄이 된다", async () => {
  const found = await listInstalledSkills(config);
  assert.deepEqual(
    found.map((s) => s.name),
    ["alpha", "beta", "gamma"], // noname·empty는 빠진다
  );
  assert.equal(
    found.find((s) => s.name === "beta")!.description,
    "첫 줄이고 둘째 줄이다. 문단이 갈려도 한 줄로 접는다.",
  );
  // 자르지 않는다(§5-1) — 원문 길이가 그대로 남는다.
  assert.equal(found.find((s) => s.name === "alpha")!.description, "한 줄짜리 설명이다.");
  assert.equal(found.find((s) => s.name === "gamma")!.description, "따옴표는 벗긴다");
});

test("installSkill — 한 장, 설치 뒤 listInstalledSkills()가 그 이름을 돌려준다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  const skill = await installSkill(
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: imported-one\ndescription: 한 장짜리.\n---\n") }],
    dir,
  );
  assert.deepEqual(skill, { name: "imported-one", description: "한 장짜리." });
  assert.equal(
    readFileSync(path.join(dir, "skills", "imported-one", "SKILL.md"), "utf8"),
    "---\nname: imported-one\ndescription: 한 장짜리.\n---\n",
  );
  assert.deepEqual(
    (await listInstalledSkills(dir)).map((s) => s.name),
    ["imported-one"],
  );
});

test("installSkill — 폴더 통째, 하위 파일까지 같은 상대경로로 깔린다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  await installSkill(
    [
      { path: "SKILL.md", bytes: Buffer.from("---\nname: with-refs\n---\n") },
      { path: "references/a.md", bytes: Buffer.from("참고 자료") },
    ],
    dir,
  );
  assert.equal(
    readFileSync(path.join(dir, "skills", "with-refs", "references", "a.md"), "utf8"),
    "참고 자료",
  );
});

test("installSkill — 거절 1: SKILL.md가 목록에 없다(§비주얼 §25 ⑤ 표 «+»)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  await assert.rejects(
    () => installSkill([{ path: "readme.md", bytes: Buffer.from("x") }], dir),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /SKILL\.md가 없습니다/.test(e.message) &&
      e.detail === "SKILL.md",
  );
  assert.equal(existsSync(path.join(dir, "skills")), false);
});

test("installSkill — 거절 2: name이 없다 · name이 규칙 밖이다(§비주얼 §25 ⑤ 표 1·2, detail 포함)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  // 표 2 — name이 규칙 밖(콜론)
  await assert.rejects(
    () =>
      installSkill(
        [{ path: "SKILL.md", bytes: Buffer.from("---\nname: plugin:skill\n---\n") }],
        dir,
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /디렉터리 이름으로 쓸 수 없습니다/.test(e.message) &&
      e.detail === "name: plugin:skill",
  );
  // 표 1 — name이 아예 없다. detail은 고른 파일 이름(`originalName`, 없으면 `path`)이다
  await assert.rejects(
    () =>
      installSkill(
        [
          {
            path: "SKILL.md",
            bytes: Buffer.from("---\ndescription: 이름 없음\n---\n"),
            originalName: "my-skill.md",
          },
        ],
        dir,
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /frontmatter에 name이 없습니다/.test(e.message) &&
      e.detail === "my-skill.md",
  );
});

test("installSkill — 거절 3: 상대경로 성분이 `..`다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  await assert.rejects(
    () =>
      installSkill(
        [
          { path: "SKILL.md", bytes: Buffer.from("---\nname: escape\n---\n") },
          { path: "../../etc/passwd", bytes: Buffer.from("x") },
        ],
        dir,
      ),
    /올바르지 않은 경로/,
  );
  assert.equal(existsSync(path.join(dir, "skills", "escape")), false);
});

test("installSkill — 거절 4: 파일 수 · 총 바이트 상한(사유에 수가 있다)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  const many = [
    { path: "SKILL.md", bytes: Buffer.from("---\nname: too-many\n---\n") },
    ...Array.from({ length: 200 }, (_, i) => ({
      path: `f${i}.txt`,
      bytes: Buffer.from("x"),
    })),
  ];
  await assert.rejects(
    () => installSkill(many, dir),
    (e: unknown) =>
      e instanceof SkillInstallError && /상한 200개를 넘습니다/.test(e.message) && e.detail === "201개",
  );

  await assert.rejects(
    () =>
      installSkill(
        [
          { path: "SKILL.md", bytes: Buffer.from("---\nname: too-big\n---\n") },
          { path: "big.bin", bytes: Buffer.alloc(MAX_BYTES + 1) },
        ],
        dir,
      ),
    (e: unknown) =>
      e instanceof SkillInstallError && /상한 20MB를 넘습니다/.test(e.message) && e.detail === "20.0MB",
  );
  assert.equal(existsSync(path.join(dir, "skills")), false); // 둘 다 쓰기 전에 거절됐다
});

test("installSkill — 거절 5: 이미 있으면 한 바이트도 안 쓰고 거절한다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fst-install-"));
  await installSkill([{ path: "SKILL.md", bytes: Buffer.from("---\nname: dup\n---\n원본") }], dir);
  await assert.rejects(
    () => installSkill([{ path: "SKILL.md", bytes: Buffer.from("---\nname: dup\n---\n새 내용") }], dir),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /이미 있습니다/.test(e.message) &&
      e.detail === path.join(dir, "skills", "dup"),
  );
  assert.equal(
    readFileSync(path.join(dir, "skills", "dup", "SKILL.md"), "utf8"),
    "---\nname: dup\n---\n원본", // 첫 번째는 한 바이트도 안 갈렸다
  );
});

// ── .skill 한 장(zip) → SkillUpload[] (§5-1 §셋째 입구) ───────────────────────

/** 최소 zip 컨테이너를 손으로 만든다. 읽는 쪽(`extractSkillArchive`)이 안 쓰는 파서를 테스트
 *  씨앗 쪽에 쓰는 것이라 §푸는 도구의 <손으로 쓴 zip 파서 0> 밖이다. 압축은 deflate
 *  (`zlib.deflateRawSync`) — `unzip`이 읽는 것과 같은 방식이다. */
function buildZip(entries: { path: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { path: name, data } of entries) {
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name, "utf8");

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8); // method = deflate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    local.push(lh, nameBuf, compressed);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + compressed.length;
  }
  const localBuf = Buffer.concat(local);
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, end]);
}

test("extractSkillArchive — 정상 .skill: 트리 그대로, 첫 성분(폴더 하나)이 떨어진다", async () => {
  const zip = buildZip([
    { path: "im-korean/SKILL.md", data: Buffer.from("---\nname: im-korean\n---\n") },
    { path: "im-korean/references/a.md", data: Buffer.from("참고 자료") },
  ]);
  const files = await extractSkillArchive(zip);
  assert.deepEqual(
    files.map((f) => f.path).sort(),
    ["SKILL.md", "references/a.md"],
  );
  assert.equal(
    files.find((f) => f.path === "SKILL.md")!.bytes.toString("utf8"),
    "---\nname: im-korean\n---\n",
  );
  assert.equal(files.find((f) => f.path === "references/a.md")!.bytes.toString("utf8"), "참고 자료");
});

test("extractSkillArchive — 최상위에 SKILL.md가 바로 있으면 첫 성분을 안 뗀다", async () => {
  const zip = buildZip([{ path: "SKILL.md", data: Buffer.from("---\nname: direct\n---\n") }]);
  const files = await extractSkillArchive(zip);
  assert.deepEqual(files.map((f) => f.path), ["SKILL.md"]);
});

test("extractSkillArchive — 둘 다 아니면 갈래 7(SKILL.md 없음)로 직접 거절한다", async () => {
  const zip = buildZip([
    { path: "a/one.md", data: Buffer.from("x") },
    { path: "b/two.md", data: Buffer.from("y") },
  ]);
  await assert.rejects(
    () => extractSkillArchive(zip, "im-korean.skill"),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /SKILL\.md를 찾지 못했습니다/.test(e.message) &&
      e.detail === "im-korean.skill",
  );
});

test("extractSkillArchive — zip이 아닌 파일은 갈래 8(unzip 실패)로 거절한다", async () => {
  await assert.rejects(
    () => extractSkillArchive(Buffer.from("이건 zip이 아니다")),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /풀지 못했습니다/.test(e.message) &&
      /^unzip \d+:/.test(e.detail),
  );
});

test("extractSkillArchive — 상한은 <푼 뒤>를 잰다: 압축률 큰 zip은 실제로 안 풀고 거절한다", async () => {
  const zip = buildZip([
    { path: "big/SKILL.md", data: Buffer.from("---\nname: big\n---\n") },
    { path: "big/huge.bin", data: Buffer.alloc(MAX_BYTES + 1024) }, // 전부 0 — deflate가 거의 다 접는다
  ]);
  assert.ok(zip.length < 1024 * 1024); // 압축된 zip 자체는 작다 — 그런데도 <푼 뒤> 기준으로 거절된다
  await assert.rejects(
    () => extractSkillArchive(zip),
    (e: unknown) => e instanceof SkillInstallError && /상한 20MB를 넘습니다/.test(e.message),
  );
});

test("extractSkillArchive — subtree: 레포 하위 경로만 남기고, 상한도 그 하위 트리만 잰다", async () => {
  const zip = buildZip([
    { path: "myrepo-main/skills/foo/SKILL.md", data: Buffer.from("---\nname: foo\n---\n") },
    { path: "myrepo-main/skills/foo/references/a.md", data: Buffer.from("참고") },
    // subtree 밖의 파일이 상한을 넘겨도(§5-1 §상한 — 남긴 하위 트리만 잰다) 걸리지 않는다.
    { path: "myrepo-main/other/huge.bin", data: Buffer.alloc(MAX_BYTES + 1024) },
  ]);
  const files = await extractSkillArchive(zip, "archive.skill", "skills/foo");
  assert.deepEqual(
    files.map((f) => f.path).sort(),
    ["SKILL.md", "references/a.md"],
  );
  assert.equal(files.find((f) => f.path === "SKILL.md")!.bytes.toString("utf8"), "---\nname: foo\n---\n");
});

test("extractSkillArchive — subtree가 아카이브에 없으면 갈래 13(§비주얼 §25 ⑦)으로 거절한다", async () => {
  const zip = buildZip([{ path: "myrepo-main/skills/foo/SKILL.md", data: Buffer.from("x") }]);
  await assert.rejects(
    () => extractSkillArchive(zip, "archive.skill", "skills/없는경로"),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /그 레포에 없습니다/.test(e.message) &&
      e.detail === "skills/없는경로",
  );
});

// ── 주소 한 줄(URL) → SkillUpload[] (§5-1 §넷째 입구 · §비주얼 §25 ⑦) ─────────

test("parseSkillAddress — 주소 갈래 표 다섯(§5-1). 네트워크를 안 탄다", () => {
  assert.deepEqual(parseSkillAddress("https://github.com/o/r"), {
    fetchUrl: "https://codeload.github.com/o/r/zip/HEAD",
  });
  assert.deepEqual(parseSkillAddress("https://github.com/o/r/tree/main"), {
    fetchUrl: "https://codeload.github.com/o/r/zip/main",
  });
  assert.deepEqual(parseSkillAddress("https://github.com/o/r/tree/main/skills/foo"), {
    fetchUrl: "https://codeload.github.com/o/r/zip/main",
    subtree: "skills/foo",
  });
  assert.deepEqual(parseSkillAddress("https://github.com/o/r/blob/main/skills/foo/SKILL.md"), {
    fetchUrl: "https://codeload.github.com/o/r/zip/main",
    subtree: "skills/foo",
  });
  assert.deepEqual(
    parseSkillAddress("https://raw.githubusercontent.com/o/r/main/skills/foo/SKILL.md"),
    { fetchUrl: "https://codeload.github.com/o/r/zip/main", subtree: "skills/foo" },
  );
});

test("parseSkillAddress — 호스트 목록 밖 · 모양이 표에 없다 → 갈래 10, 요청을 안 낸다", () => {
  const rejects = (address: string) =>
    assert.throws(
      () => parseSkillAddress(address),
      (e: unknown) =>
        e instanceof SkillInstallError && /받을 수 없습니다/.test(e.message) && e.detail === address,
    );
  rejects("http://github.com/o/r"); // https가 아니다
  rejects("https://example.com/x.skill"); // 호스트가 셋 밖이다
  rejects("file:///etc/passwd");
  rejects("이건 주소가 아니다");
  rejects("https://github.com/o"); // 레포까지 안 온다
  rejects("https://github.com/o/r/issues/5"); // tree·blob이 아니다
  rejects("https://github.com/o/r/blob/main/SKILL.md"); // 파일이 레포 바로 아래다 — <path>가 없다
  rejects("https://skills.sh/s/x.skill"); // skills.sh는 호스트 목록 밖이다
});

/** `globalThis.fetch`를 잠깐 바꿔 낀다 — 진짜 네트워크를 안 탄다. */
async function withMockFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

function mockResponse(body: BodyInit | null, init: ResponseInit & { url?: string } = {}): Response {
  const res = new Response(body, init);
  Object.defineProperty(res, "url", { value: init.url ?? "https://codeload.github.com/o/r/zip/HEAD" });
  return res;
}

test("fetchSkillFromAddress — 정상 경로: 받은 zip이 extractSkillArchive를 그대로 거친다", async () => {
  const zip = buildZip([{ path: "SKILL.md", data: Buffer.from("---\nname: from-url\n---\n") }]);
  const files = await withMockFetch(
    async () => mockResponse(Uint8Array.from(zip), { status: 200 }),
    () => fetchSkillFromAddress("https://github.com/o/r"),
  );
  assert.deepEqual(files, [{ path: "SKILL.md", bytes: files[0].bytes }]);
  assert.equal(files[0].bytes.toString("utf8"), "---\nname: from-url\n---\n");
});

test("fetchSkillFromAddress — 갈래 10: 표에 없는 모양은 fetch를 아예 안 부른다", async () => {
  let called = false;
  await assert.rejects(
    () =>
      withMockFetch(async () => {
        called = true;
        throw new Error("호출되면 안 된다");
      }, () => fetchSkillFromAddress("https://example.com/x")),
    (e: unknown) => e instanceof SkillInstallError && /받을 수 없습니다/.test(e.message),
  );
  assert.equal(called, false);
});

test("fetchSkillFromAddress — 갈래 11: HTTP 상태와 네트워크 끊김을 가르지 않는다", async () => {
  await assert.rejects(
    () =>
      withMockFetch(
        async () => mockResponse(null, { status: 404 }),
        () => fetchSkillFromAddress("https://github.com/o/r"),
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받지 못했습니다/.test(e.message) &&
      e.detail === "GET https://codeload.github.com/o/r/zip/HEAD: HTTP 404",
  );

  await assert.rejects(
    () =>
      withMockFetch(
        async () => {
          throw new DOMException("The operation was aborted", "AbortError");
        },
        () => fetchSkillFromAddress("https://github.com/o/r"),
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받지 못했습니다/.test(e.message) &&
      /^GET https:\/\/codeload\.github\.com\/o\/r\/zip\/HEAD: /.test(e.detail),
  );
});

test("fetchSkillFromAddress — 갈래 10: 리디렉션 뒤 최종 호스트가 셋 밖이면 거절한다", async () => {
  await assert.rejects(
    () =>
      withMockFetch(
        async () => mockResponse(Buffer.from("x"), { status: 200, url: "https://evil.example/payload" }),
        () => fetchSkillFromAddress("https://github.com/o/r"),
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받을 수 없습니다/.test(e.message) &&
      e.detail === "https://evil.example/payload",
  );
});

test("fetchSkillFromAddress — 갈래 10: skills.sh 주소는 fetch를 아예 안 부르고 거절한다", async () => {
  let called = false;
  await assert.rejects(
    () =>
      withMockFetch(async () => {
        called = true;
        throw new Error("호출되면 안 된다");
      }, () => fetchSkillFromAddress("https://skills.sh/s/x.skill")),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받을 수 없습니다/.test(e.message) &&
      e.detail === "https://skills.sh/s/x.skill",
  );
  assert.equal(called, false);
});

test("fetchSkillFromAddress — 갈래 10: www.skills.sh 주소도 같은 이유로 거절한다", async () => {
  let called = false;
  await assert.rejects(
    () =>
      withMockFetch(async () => {
        called = true;
        throw new Error("호출되면 안 된다");
      }, () => fetchSkillFromAddress("https://www.skills.sh/s/x.skill")),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받을 수 없습니다/.test(e.message) &&
      e.detail === "https://www.skills.sh/s/x.skill",
  );
  assert.equal(called, false);
});

test("fetchSkillFromAddress — github.com을 흉내낸 다른 호스트로 리디렉션되면 거절한다", async () => {
  await assert.rejects(
    () =>
      withMockFetch(
        async () =>
          mockResponse(Buffer.from("x"), { status: 200, url: "https://github.com.evil.example/x" }),
        () => fetchSkillFromAddress("https://github.com/o/r"),
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받을 수 없습니다/.test(e.message) &&
      e.detail === "https://github.com.evil.example/x",
  );
});

test("fetchSkillFromAddress — 갈래 12: 받는 도중 §8 MAX_BYTES를 넘으면 끊는다", async () => {
  await assert.rejects(
    () =>
      withMockFetch(
        async () => mockResponse(Buffer.alloc(MAX_BYTES + 1024), { status: 200 }),
        () => fetchSkillFromAddress("https://github.com/o/r"),
      ),
    (e: unknown) =>
      e instanceof SkillInstallError &&
      /받는 크기가 상한을 넘어 끊었습니다/.test(e.message) &&
      e.detail === "20MB",
  );
});

test("skillUploadError — installSkill과 화면이 같은 문구를 쓴다(§비주얼 §25 ⑤)", () => {
  assert.equal(skillUploadError(200, 1024), null); // 상한 자체는 통과
  assert.deepEqual(skillUploadError(201, 1024), {
    title: "설치할 파일이 상한 200개를 넘습니다",
    message: "201개",
  });
  assert.deepEqual(skillUploadError(1, MAX_BYTES + 1), {
    title: "설치할 파일의 합계가 상한 20MB를 넘습니다",
    message: "20.0MB",
  });
});

test("없는 디렉터리 — 빈 배열이 정상이다(throw 아님)", async () => {
  assert.deepEqual(await listInstalledSkills(path.join(tmp, "없는config")), []);
  assert.deepEqual(await readPersonaSkills(path.join(tmp, "없는personas"), "dev"), []);
  assert.deepEqual(await readPersonaSkills(personas, "no-such-persona"), []); // 디렉터리가 없다
});

test("왕복 — 쓰고 읽으면 같다", async () => {
  const skills = [
    { name: "ponytail", description: "Forces the laziest solution that actually works." },
    { name: "frontend-design", description: "Guidance for distinctive, intentional visual design." },
  ];
  await writePersonaSkills(personas, "developer", skills);
  assert.deepEqual(await readPersonaSkills(personas, "developer"), skills);

  const text = readFileSync(path.join(personas, "developer", "skills.md"), "utf8");
  assert.match(text, /^## 스킬\n/);
  assert.match(text, /^- `ponytail` — Forces the laziest solution that actually works\.$/m);
});

test("사람이 덧붙인 산문 — 목록에서 빠지되 파일에서 지워지지 않는다", async () => {
  const file = path.join(personas, "developer", "skills.md");
  writeFileSync(file, readFileSync(file, "utf8") + "\n손으로 적는다: ponytail을 제일 먼저 쓴다.\n");

  await writePersonaSkills(personas, "developer", [{ name: "shadcn", description: "컴포넌트" }]);

  const text = readFileSync(file, "utf8");
  assert.match(text, /손으로 적는다: ponytail을 제일 먼저 쓴다\./); // 산문은 그대로
  assert.doesNotMatch(text, /ponytail`/); // 옛 항목 줄만 갈렸다
  assert.deepEqual(await readPersonaSkills(personas, "developer"), [
    { name: "shadcn", description: "컴포넌트" }, // 산문 줄은 목록에 안 뜬다
  ]);
});

test("0개가 되면 파일이 사라진다 — 빈 파일을 남기지 않는다", async () => {
  const file = path.join(personas, "developer", "skills.md");
  assert.ok(existsSync(file));
  await writePersonaSkills(personas, "developer", []);
  assert.equal(existsSync(file), false);
  assert.deepEqual(await readPersonaSkills(personas, "developer"), []);
  await writePersonaSkills(personas, "developer", []); // 없는 파일을 또 지워도 조용하다
});

test("이름이 신뢰 경계다 — 기준 디렉터리 밖으로 나가는 이름은 거부", async () => {
  for (const bad of ["../escape", "a/b", "", "."]) {
    await assert.rejects(() => readPersonaSkills(personas, bad), /페르소나 이름은/);
    await assert.rejects(
      () => writePersonaSkills(personas, bad, [{ name: "x", description: "y" }]),
      /페르소나 이름은/,
    );
  }
  assert.equal(existsSync(path.join(tmp, "escape")), false);
});

test("백틱이 든 스킬 이름은 거부한다 — 쓴 파일을 못 읽게 된다", async () => {
  await assert.rejects(
    () => writePersonaSkills(personas, "qa", [{ name: "a`b", description: "" }]),
    /쓸 수 없는 문자/,
  );
});

test("바이트 수는 파일 전체다 — 목록에 안 뜨는 산문까지 센다", async () => {
  await writePersonaSkills(personas, "counter", [{ name: "alpha", description: "설명" }]);
  const file = path.join(personas, "counter", "skills.md");
  const before = await readPersonaSkillsFile(personas, "counter");
  assert.equal(before.chars, Buffer.byteLength(readFileSync(file, "utf8")));
  assert.equal(before.skills.length, 1);

  writeFileSync(file, readFileSync(file, "utf8") + "\n손으로 적은 줄.\n");
  const after = await readPersonaSkillsFile(personas, "counter");
  assert.deepEqual(after.skills, before.skills); // 목록은 그대로
  assert.equal(after.chars, before.chars + Buffer.byteLength("\n손으로 적은 줄.\n")); // 바이트 수만 는다

  assert.deepEqual(await readPersonaSkillsFile(personas, "no-such-persona"), {
    skills: [],
    chars: 0,
  });
});

test("고른 이름 → 저장할 목록 (pickedSkills)", () => {
  const current = [
    { name: "keep", description: "파일에 적힌 설명" },
    { name: "drop", description: "빠질 것" },
    { name: "orphan", description: "후보에 없다 — 다른 머신에서 골랐다" },
  ];
  const installed = [
    { name: "keep", description: "SKILL.md의 새 설명" },
    { name: "added", description: "새로 고른다" },
  ];

  // 순서: 이미 든 것이 먼저(파일 순서 그대로) · 새로 고른 것이 뒤. 설명은 설치본이 이긴다
  assert.deepEqual(pickedSkills(["added", "keep", "orphan"], current, installed), [
    { name: "keep", description: "SKILL.md의 새 설명" },
    { name: "orphan", description: "후보에 없다 — 다른 머신에서 골랐다" }, // 파일의 설명이 남는다
    { name: "added", description: "새로 고른다" },
  ]);

  // 어느 쪽에도 없는 이름은 뺀다 — 설명을 지어낼 자리가 없다
  assert.deepEqual(pickedSkills(["없는스킬"], current, installed), []);
  assert.deepEqual(pickedSkills([], current, installed), []); // 0개 = 파일이 사라진다
});

// ── 비활성 스킬 (`skills-off.md` · DESIGN.md §5-1 §n:m 배정과 비활성 · §비주얼 §25 ⑥) ────────

test("비활성 왕복 — 활성 -> 비활성 -> 활성, 설명을 잃지 않는다", async () => {
  const a = { name: "a", description: "A" };
  const b = { name: "b", description: "B" };
  await writePersonaSkills(personas, "toggler", [a, b]);
  assert.deepEqual(await readPersonaSkills(personas, "toggler"), [a, b]);
  assert.deepEqual((await readPersonaOffSkillsFile(personas, "toggler")).skills, []);

  // b를 끈다 — 활성에서 빠지고 비활성에 같은 설명으로 뜬다
  await writePersonaSkills(personas, "toggler", [a]);
  await writePersonaOffSkills(personas, "toggler", [b]);
  assert.deepEqual(await readPersonaSkills(personas, "toggler"), [a]);
  assert.deepEqual((await readPersonaOffSkillsFile(personas, "toggler")).skills, [b]);

  // b를 다시 켠다 — 비활성에서 빠지고 활성으로 돌아온다. 파일이 사라진다(0개 규약)
  await writePersonaSkills(personas, "toggler", [a, b]);
  await writePersonaOffSkills(personas, "toggler", []);
  assert.deepEqual(await readPersonaSkills(personas, "toggler"), [a, b]);
  assert.equal(existsSync(path.join(personas, "toggler", "skills-off.md")), false);
});

test("비활성 — 0개면 skills-off.md가 사라진다(§5-1 §0개 규약 — skills.md와 같다)", async () => {
  const file = path.join(personas, "offdel", "skills-off.md");
  await writePersonaOffSkills(personas, "offdel", [{ name: "x", description: "y" }]);
  assert.ok(existsSync(file));
  await writePersonaOffSkills(personas, "offdel", []);
  assert.equal(existsSync(file), false);
  assert.deepEqual((await readPersonaOffSkillsFile(personas, "offdel")).skills, []);
  await writePersonaOffSkills(personas, "offdel", []); // 없는 파일을 또 지워도 조용하다
});

test("충돌 — 같은 이름이 두 파일에 있으면 다음 저장이 비활성에서 그 이름을 지운다(§5-1 §충돌)", async () => {
  const shared = { name: "dup", description: "설명" };
  // 손으로 두 파일에 같은 이름을 넣어 둔 상태를 흉내낸다.
  await writePersonaSkills(personas, "conflict", [shared]);
  await writePersonaOffSkills(personas, "conflict", [shared]);

  const { skills: active } = await readPersonaSkillsFile(personas, "conflict");
  const { skills: off } = await readPersonaOffSkillsFile(personas, "conflict");
  assert.deepEqual(active, [shared]);
  assert.deepEqual(off, [shared]); // 저장 전 — 파일 자체는 아직 충돌 상태다

  // 다음 저장 — 활성이 이긴다. 서버 액션(savePersonaSkillsAction)이 매 저장마다 적용하는 것과
  // 같은 판정이다: 활성에 있는 이름은 비활성에서 뺀다.
  const activeNames = new Set(active.map((s) => s.name));
  await writePersonaOffSkills(personas, "conflict", off.filter((s) => !activeNames.has(s.name)));

  assert.deepEqual(await readPersonaSkills(personas, "conflict"), [shared]);
  assert.equal(existsSync(path.join(personas, "conflict", "skills-off.md")), false);
});

test("산문 보존 — 스킬이 비활성을 왕복해도 skills.md의 손글씨가 자리까지 그대로다(§5-1)", async () => {
  const file = path.join(personas, "prose", "skills.md");
  const keep = { name: "keep", description: "유지" };
  const off = { name: "toggle", description: "토글" };
  await writePersonaSkills(personas, "prose", [keep, off]);
  writeFileSync(file, readFileSync(file, "utf8") + "\n손으로 적는다: 이건 안 지운다.\n");

  // off를 끈다 — 활성엔 keep만 남고 파일은 안 지워진다(목록이 0개가 아니다)
  await writePersonaSkills(personas, "prose", [keep]);
  await writePersonaOffSkills(personas, "prose", [off]);
  assert.match(readFileSync(file, "utf8"), /손으로 적는다: 이건 안 지운다\./);

  // 다시 켠다 — 왕복 뒤에도 산문은 자리까지 그대로다
  await writePersonaSkills(personas, "prose", [keep, off]);
  await writePersonaOffSkills(personas, "prose", []);
  assert.match(readFileSync(file, "utf8"), /손으로 적는다: 이건 안 지운다\./);
  assert.equal(existsSync(path.join(personas, "prose", "skills-off.md")), false);
});

// ── 메모리 (DESIGN.md §5-2 · §비주얼 §32) ───────────────────────────────────

/** 픽스처 — 세션이 쓰는 파일이라 GUI가 형식을 강제하지 못한다. 여기 든 넷이 그 스펙트럼이다.
 *
 *      memory/워크트리 push 경합.md   `# `로 시작한다 → 기호를 뗀 첫 줄이 발췌
 *      memory/beta.md                 앞이 빈 줄이다 → 첫 **비어 있지 않은** 줄이 발췌
 *      memory/blank.md                공백뿐이다 → 발췌가 빈다(숨기지 않는다)
 *      memory/note.txt                `.md`가 아니다 → 글롭 밖
 *      memory/nested/deep.md          한 단계 아래다 → 안 읽는다(tick.sh와 같은 판정)
 */
function memoryFixture(persona: string) {
  const dir = path.join(personas, persona, "memory");
  mkdirSync(path.join(dir, "nested"), { recursive: true });
  writeFileSync(path.join(dir, "워크트리 push 경합.md"), "# 워크트리 push 경합\n\n본문이다.\n");
  writeFileSync(path.join(dir, "beta.md"), "\n\n제목 없이 시작한다\n둘째 줄\n");
  writeFileSync(path.join(dir, "blank.md"), "   \n\n");
  writeFileSync(path.join(dir, "note.txt"), "글롭 밖이다");
  writeFileSync(path.join(dir, "nested", "deep.md"), "한 단계 아래는 안 읽는다");
  return dir;
}

test("메모리 읽기 — 한 단계 글롭 · 발췌는 첫 비어 있지 않은 줄 · 이름 오름차순", async () => {
  const dir = memoryFixture("mem");
  const { memories } = await readPersonaMemory(personas, "mem");

  assert.deepEqual(
    memories.map((m) => [m.file, m.excerpt]),
    [
      ["beta.md", "제목 없이 시작한다"], // 앞의 빈 줄을 건너뛴다
      ["blank.md", ""], // 발췌가 비어도 목록에 뜬다 — 화면이 파일명을 그린다
      ["워크트리 push 경합.md", "워크트리 push 경합"], // `# `를 뗀다
    ],
  );
  // 본문은 원문 그대로다(화면이 `<Markdown>`으로 그린다)
  assert.equal(memories[2].text, readFileSync(path.join(dir, "워크트리 push 경합.md"), "utf8"));
});

test("바이트 수는 파일 전체의 합 — 접힌 줄의 바이트 수가 이걸 더한다", async () => {
  const dir = memoryFixture("chars");
  const { chars } = await readPersonaMemory(personas, "chars");
  const sum = ["beta.md", "blank.md", "워크트리 push 경합.md"]
    .map((f) => Buffer.byteLength(readFileSync(path.join(dir, f), "utf8")))
    .reduce((a, b) => a + b, 0);
  assert.equal(chars, sum);
  assert.ok(chars > 0);

  // `memory/`가 없는 페르소나 · 없는 이름 — 정상이다(WARN도 예외도 없다)
  assert.deepEqual(await readPersonaMemory(personas, "developer"), { memories: [], chars: 0 });
  assert.deepEqual(await readPersonaMemory(personas, "no-such-persona"), { memories: [], chars: 0 });
});

test("발췌 규칙 두 줄 (memoryExcerpt)", () => {
  assert.equal(memoryExcerpt("# 제목\n본문"), "제목");
  assert.equal(memoryExcerpt("\n\n  들여쓴 첫 줄  \n"), "들여쓴 첫 줄");
  assert.equal(memoryExcerpt("## 두 단계는 안 뗀다"), "## 두 단계는 안 뗀다"); // 계약은 `# `다
  assert.equal(memoryExcerpt("#제목아님"), "#제목아님"); // 공백이 없으면 마크다운 제목이 아니다
  assert.equal(memoryExcerpt(""), "");
  assert.equal(memoryExcerpt("  \n\t\n"), "");
});

test("삭제 — 나열해 나온 목록 안에 있을 때만 지운다(§경로 방어)", async () => {
  const dir = memoryFixture("del");
  const outside = path.join(personas, "del", "PROFILE.md");
  writeFileSync(outside, "지워지면 안 된다");

  // 목록 밖 이름은 전부 거부다 — 경로 조립도 탈출도 그 앞에서 끝난다
  for (const bad of [
    "../PROFILE.md",
    "../../del/PROFILE.md",
    "note.txt", // 글롭 밖이라 목록에 없다
    "nested", // 디렉터리는 목록에 없다
    "없는파일.md",
    "",
  ]) {
    await assert.rejects(() => deletePersonaMemory(personas, "del", bad), /목록에 없습니다/);
  }
  assert.equal(existsSync(outside), true);
  assert.equal(existsSync(path.join(dir, "note.txt")), true);

  // 페르소나 이름도 신뢰 경계다(스킬과 같은 문지기)
  await assert.rejects(() => deletePersonaMemory(personas, "../escape", "beta.md"), /페르소나 이름은/);

  // 목록 안이면 그 파일만 사라진다
  await deletePersonaMemory(personas, "del", "beta.md");
  assert.equal(existsSync(path.join(dir, "beta.md")), false);
  assert.deepEqual((await readPersonaMemory(personas, "del")).memories.map((m) => m.file), [
    "blank.md",
    "워크트리 push 경합.md",
  ]);
});

test("한글 파일명은 NFC로 대조한다 — 화면이 그린 이름과 fs의 이름이 다를 수 있다", async () => {
  const dir = path.join(personas, "nfc", "memory");
  mkdirSync(dir, { recursive: true });
  const name = "한글메모.md";
  writeFileSync(path.join(dir, name), "# 한글메모\n");

  // 화면이 되돌려주는 값이 정규화 형태만 다른 경우(macOS의 NFD ↔ NFC)
  const other = name.normalize(name.normalize("NFC") === name ? "NFD" : "NFC");
  assert.notEqual(other, name); // 글자는 같고 코드포인트가 다르다
  await deletePersonaMemory(personas, "nfc", other);
  assert.deepEqual((await readPersonaMemory(personas, "nfc")).memories, []);
});

// ── 동시 워커 상한 (`limit` · §5-4) ─────────────────────────────────────────

test("상한 — 쓰는 바이트가 `n\\n` 하나다(엔진과의 이음매)", async () => {
  const file = path.join(personas, "lim", "limit");
  await writePersonaLimit(personas, "lim", 2);
  assert.equal(readFileSync(file, "utf8"), "2\n"); // §5-4 §양끝 공백 — 선례와 같은 바이트
  assert.equal(await readPersonaLimit(personas, "lim"), 2);

  // 0은 유효한 값이다(그 페르소나 일시 정지 — §5-4 표). 빈 값과 갈린다
  await writePersonaLimit(personas, "lim", 0);
  assert.equal(readFileSync(file, "utf8"), "0\n");
  assert.equal(await readPersonaLimit(personas, "lim"), 0);
});

test("상한 — null이면 파일을 지운다(= 상한 없음)", async () => {
  const file = path.join(personas, "lim", "limit");
  assert.ok(existsSync(file));
  await writePersonaLimit(personas, "lim", null);
  assert.equal(existsSync(file), false);
  assert.equal(await readPersonaLimit(personas, "lim"), null);
  await writePersonaLimit(personas, "lim", null); // 없는 파일을 또 지워도 조용하다
});

test("상한 — 양끝 공백은 값이 아니고, 정수가 아니면 상한 없음이다", async () => {
  const dir = path.join(personas, "loose");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "limit");
  // 사람이 에디터로 쓴 모양들. 엔진과 판정이 같아야 한다(§5-4 §양끝 공백)
  for (const [text, want] of [
    ["2\n", 2],
    [" 2 ", 2],
    ["2\n\n", 2],
    ["", null],
    ["   \n", null],
    ["abc", null], // 0으로 읽지 않는다 — 오타가 페르소나를 굶기면 안 된다
    ["2.5", null],
    ["-1", null],
  ] as const) {
    writeFileSync(file, text);
    assert.equal(await readPersonaLimit(personas, "loose"), want, JSON.stringify(text));
  }
  // 파일도 디렉터리도 없는 페르소나는 조용히 null이다(파일 없음 = 기본값)
  assert.equal(await readPersonaLimit(personas, "no-such-persona"), null);
});

test("상한 — 이름이 신뢰 경계고, 정수가 아닌 값은 쓰지 않는다", async () => {
  for (const bad of ["../escape", "a/b", "", "."]) {
    await assert.rejects(() => readPersonaLimit(personas, bad), /페르소나 이름은/);
    await assert.rejects(() => writePersonaLimit(personas, bad, 1), /페르소나 이름은/);
  }
  assert.equal(existsSync(path.join(tmp, "escape")), false);

  for (const bad of [1.5, -1, NaN]) {
    await assert.rejects(() => writePersonaLimit(personas, "lim", bad), /0 이상의 정수/);
  }
  assert.equal(existsSync(path.join(personas, "lim", "limit")), false);
});

// ── 페르소나별 실행 엔진 (§제약 1 §결정 기록 §열한 번째) ────────────────────

test("엔진 — 왕복. 쓰는 바이트가 워커 파일과 같은 한 줄이다", async () => {
  const file = path.join(personas, "eng", "engine");
  assert.deepEqual(await writePersonaEngine(personas, "eng", "codex", "gpt-5.5"), {
    engineId: "codex",
    model: "gpt-5.5",
  });
  assert.equal(readFileSync(file, "utf8"), `${renderEngineBlock("codex", "gpt-5.5")}\n`);
  assert.deepEqual(await readPersonaEngine(personas, "eng"), { engineId: "codex", model: "gpt-5.5" });

  // 모델 없이 — NO_MODEL이면 플래그가 통째로 사라진다(카탈로그 규약, §4-3)
  await writePersonaEngine(personas, "eng", "claude");
  assert.deepEqual(await readPersonaEngine(personas, "eng"), { engineId: "claude", model: "" });
});

test("엔진 — null이면 파일을 지운다(= 지정 없음)", async () => {
  const file = path.join(personas, "eng", "engine");
  assert.ok(existsSync(file));
  await writePersonaEngine(personas, "eng", null);
  assert.equal(existsSync(file), false);
  assert.equal(await readPersonaEngine(personas, "eng"), null);
  await writePersonaEngine(personas, "eng", null); // 없는 파일을 또 지워도 조용하다
});

test("엔진 — 파일 없음 · 모양이 다름(대입 줄 자체가 아님)은 지정 없음이다(파서를 안 만든다)", async () => {
  const dir = path.join(personas, "loose-eng");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "engine");
  for (const text of ["", "claude", "TICKET_ENGINE=(claude"]) {
    writeFileSync(file, text);
    assert.equal(await readPersonaEngine(personas, "loose-eng"), null, JSON.stringify(text));
  }
  assert.equal(await readPersonaEngine(personas, "no-such-persona"), null);
});

test("엔진 — 대입은 있는데 카탈로그와 안 맞으면 raw로 낸다(null로 뭉개지 않는다, 77ca2128)", async () => {
  const dir = path.join(personas, "custom-eng");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "engine"), "TICKET_ENGINE=(mock-engine --flag)");
  assert.deepEqual(await readPersonaEngine(personas, "custom-eng"), { raw: "mock-engine --flag" });
});

test("엔진 — 커스텀 값을 force 없이 저장하면 PersonaEngineCustomError로 멈추고 파일이 그대로다(77ca2128)", async () => {
  const dir = path.join(personas, "custom-save");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "engine");
  writeFileSync(file, "TICKET_ENGINE=(mock-engine --flag --autocompact 150000)");

  await assert.rejects(
    () => writePersonaEngine(personas, "custom-save", "claude", "opus"),
    (e: unknown) =>
      e instanceof PersonaEngineCustomError && e.raw === "mock-engine --flag --autocompact 150000",
  );
  // 커스텀 꼬리가 살아 있다 — 팝오버가 모델만 고르고 저장해도 조용히 안 지워진다.
  assert.equal(readFileSync(file, "utf8"), "TICKET_ENGINE=(mock-engine --flag --autocompact 150000)");

  // 사람이 확인하고 다시 부르면(force) 종전대로 덮어쓴다.
  assert.deepEqual(await writePersonaEngine(personas, "custom-save", "claude", "opus", true), {
    engineId: "claude",
    model: "opus",
  });
  assert.equal(readFileSync(file, "utf8"), `${renderEngineBlock("claude", "opus")}\n`);
});

test("엔진 — 모르는 엔진·위험한 모델은 거부하고 파일을 안 남긴다(신뢰 경계)", async () => {
  await assert.rejects(
    () => writePersonaEngine(personas, "bad-eng", "gemini" as "claude"),
    /모르는 엔진/,
  );
  await assert.rejects(
    () => writePersonaEngine(personas, "bad-eng", "codex", "a b; rm -rf /"),
    /쓸 수 없는 문자/,
  );
  assert.equal(existsSync(path.join(personas, "bad-eng", "engine")), false);
});

test("엔진 — 이름이 신뢰 경계다", async () => {
  for (const bad of ["../escape", "a/b", "", "."]) {
    await assert.rejects(() => readPersonaEngine(personas, bad), /페르소나 이름은/);
    await assert.rejects(() => writePersonaEngine(personas, bad, "claude"), /페르소나 이름은/);
  }
  assert.equal(existsSync(path.join(tmp, "escape")), false);
});
