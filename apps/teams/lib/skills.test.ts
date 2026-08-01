import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listInstalledSkills,
  pickedSkills,
  readPersonaSkills,
  readPersonaSkillsFile,
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
