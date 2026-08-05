import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deletePersonaMemory,
  listInstalledSkills,
  memoryExcerpt,
  pickedSkills,
  readPersonaLimit,
  readPersonaMemory,
  readPersonaSkills,
  readPersonaSkillsFile,
  writePersonaLimit,
  writePersonaSkills,
} from "./skills.ts";

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

test("자수는 파일 전체다 — 목록에 안 뜨는 산문까지 센다", async () => {
  await writePersonaSkills(personas, "counter", [{ name: "alpha", description: "설명" }]);
  const file = path.join(personas, "counter", "skills.md");
  const before = await readPersonaSkillsFile(personas, "counter");
  assert.equal(before.chars, readFileSync(file, "utf8").length);
  assert.equal(before.skills.length, 1);

  writeFileSync(file, readFileSync(file, "utf8") + "\n손으로 적은 줄.\n");
  const after = await readPersonaSkillsFile(personas, "counter");
  assert.deepEqual(after.skills, before.skills); // 목록은 그대로
  assert.equal(after.chars, before.chars + "\n손으로 적은 줄.\n".length); // 자수만 는다

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
      ["blank.md", ""], // 발췌가 비어도 목록에 선다 — 화면이 파일명을 그린다
      ["워크트리 push 경합.md", "워크트리 push 경합"], // `# `를 뗀다
    ],
  );
  // 본문은 원문 그대로다(화면이 `<Markdown>`으로 그린다)
  assert.equal(memories[2].text, readFileSync(path.join(dir, "워크트리 push 경합.md"), "utf8"));
});

test("자수는 파일 전체의 합 — 접힌 줄의 `자수`가 이걸 더한다", async () => {
  const dir = memoryFixture("chars");
  const { chars } = await readPersonaMemory(personas, "chars");
  const sum = ["beta.md", "blank.md", "워크트리 push 경합.md"]
    .map((f) => readFileSync(path.join(dir, f), "utf8").length)
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
