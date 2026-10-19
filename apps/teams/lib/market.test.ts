import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { t } from "./i18n.ts";
import { deployNoteHintKey, shouldResetDeployForm } from "./deploy-form.ts";

// 진짜 마켓(~/.config/dira/market/)을 밟지 않는다. import 전에 건다(projects.test.ts 선례).
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-market-local-"));
process.env.TICKET_LOCAL = LOCAL;

const {
  appendInstall,
  deployPersona,
  deploySquad,
  firstLine,
  getMarketItem,
  importPersona,
  importSquad,
  listInstalls,
  listMarketItems,
  marketDir,
  marketInstallsPath,
  marketItemId,
  marketRecord,
  matchesMarketSearch,
  missingMarketMembers,
  missingSquadMembers,
  needsUpdate,
  bumpVersion,
  compareSemver,
  importToTeam,
  lineDiff,
  parseSemver,
  previewTeamUpdate,
  teamImports,
  parseMarketItemId,
  projectsThatImported,
  readFavorites,
  squadMemberNames,
  toggleFavorite,
} = await import("./market.ts");

function seedPersona(owner: string, name: string, latest: number, tags: string[] = []) {
  const dir = path.join(marketDir(), "personas", owner, name);
  mkdirSync(path.join(dir, `v${latest}`), { recursive: true });
  writeFileSync(path.join(dir, `v${latest}`, "PROFILE.md"), `# ${name}\n`, "utf8");
  writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      kind: "persona",
      owner,
      ownerName: owner,
      name,
      tags,
      latest,
      versions: Array.from({ length: latest }, (_, i) => ({
        v: i + 1,
        at: "2026-09-19T18:00:00+09:00",
        note: `v${i + 1}`,
      })),
    }),
    "utf8",
  );
  return dir;
}

function seedSquad(owner: string, name: string, membersText: string, latest = 1) {
  const dir = path.join(marketDir(), "squads", owner, name);
  mkdirSync(path.join(dir, `v${latest}`), { recursive: true });
  writeFileSync(path.join(dir, `v${latest}`, "members"), membersText, "utf8");
  writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      kind: "squad",
      owner,
      ownerName: owner,
      name,
      tags: [],
      latest,
      versions: [{ v: latest, at: "2026-09-19T18:00:00+09:00", note: "seed" }],
    }),
    "utf8",
  );
  return dir;
}

test("needsUpdate — 설치 버전이 latest보다 낮을 때만 참", () => {
  assert.equal(needsUpdate(1, 2), true);
  assert.equal(needsUpdate(2, 2), false);
  assert.equal(needsUpdate(3, 2), false);
});

test("marketItemId · parseMarketItemId — 조립과 되돌리기가 왕복한다", () => {
  const id = marketItemId("persona", "dira", "writer");
  assert.equal(id, "persona:dira/writer");
  assert.deepEqual(parseMarketItemId(id), { kind: "persona", owner: "dira", name: "writer" });
});

test("parseMarketItemId — 모양이 아니면 null", () => {
  assert.equal(parseMarketItemId("dira/writer"), null);
  assert.equal(parseMarketItemId("plugin:dira/writer"), null);
});

test("listMarketItems — 마켓 디렉터리가 없으면 빈 목록(오류 아님)", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "fst-market-empty-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = empty;
  try {
    assert.deepEqual(await listMarketItems(), []);
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("listMarketItems · getMarketItem — 심어 둔 페르소나를 목록·상세로 읽는다", async () => {
  seedPersona("dira", "writer", 2, ["글"]);

  const items = await listMarketItems("persona");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "persona:dira/writer");
  assert.equal(items[0].latest, "2.0.0"); // 옛 v2 폴더와 정수 meta를 2.0.0으로 읽는다
  assert.equal(items[0].favorite, false);

  const detail = await getMarketItem("persona", "dira", "writer");
  assert.ok(detail);
  assert.equal(detail?.profile, "# writer\n");
  assert.equal(detail?.skills, null); // skills.md를 안 심었다 — null이지 오류가 아니다
  assert.equal(detail?.versions.length, 2);
});

test("getMarketItem — 없는 항목은 null", async () => {
  assert.equal(await getMarketItem("persona", "dira", "no-such"), null);
});

test("readFavorites · toggleFavorite — 왕복", async () => {
  const id = marketItemId("persona", "dira", "writer");
  assert.deepEqual(await readFavorites(), []);
  assert.deepEqual(await toggleFavorite(id), [id]);
  assert.deepEqual(await readFavorites(), [id]);
  assert.deepEqual(await toggleFavorite(id), []);
});

test("listInstalls — installs.jsonl이 없으면 빈 목록, 깨진 줄은 건너뛴다", async () => {
  mkdirSync(marketDir(), { recursive: true });
  const { writeFileSync: write } = await import("node:fs");
  write(
    path.join(marketDir(), "installs.jsonl"),
    [
      JSON.stringify({ at: "t1", kind: "persona", owner: "dira", name: "writer", v: 1, project: "pofol", as: "writer" }),
      "{ 깨진 줄",
      JSON.stringify({ at: "t2", kind: "persona", owner: "dira", name: "writer", v: 2, project: "pofol", as: "writer" }),
      JSON.stringify({ at: "t3", kind: "persona", owner: "dira", name: "other", v: 1, project: "pofol", as: "other" }),
    ].join("\n"),
    "utf8",
  );

  const rows = await listInstalls("persona", "dira", "writer");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.v), [1, 2]);
});

// ── 배포 ─────────────────────────────────────────────────────────────────────

test("compareSemver · parseSemver — 숫자로 견주고 옛 v3과 정수는 3.0.0이다", () => {
  assert.ok(compareSemver("1.10.0", "1.9.9") > 0); // 문자열 비교면 거꾸로다
  assert.ok(compareSemver("v3", "2.9.9") > 0);
  assert.equal(compareSemver("v3", "3.0.0"), 0);
  assert.equal(compareSemver(3, "3.0.0"), 0);
  assert.deepEqual(parseSemver("v3"), [3, 0, 0]);
  assert.equal(parseSemver("latest"), null);
});

test("bumpVersion — 첫 배포는 1.0.0, patch - minor - major 올림", () => {
  assert.equal(bumpVersion(null, "major"), "1.0.0");
  assert.equal(bumpVersion("1.2.3"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

test("missingMarketMembers — 마켓에 없는 이름만 순서대로 뽑는다", () => {
  assert.deepEqual(missingMarketMembers(["a", "b", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(missingMarketMembers(["a", "b"], ["a", "b"]), []);
  assert.deepEqual(missingMarketMembers([], ["a"]), []);
});

test("deployNoteHintKey — 노트가 비었을 때만 안내 문구 키를 돌려준다 (티켓 22dc0696)", () => {
  assert.equal(deployNoteHintKey(""), "market.deploy.noteRequiredHint");
  assert.equal(deployNoteHintKey("   "), "market.deploy.noteRequiredHint"); // 공백만 있어도 비었다고 본다
  assert.equal(deployNoteHintKey("첫 배포"), null);
});

test("shouldResetDeployForm — 배포가 성공했을 때만 폼을 비운다 (티켓 22dc0696)", () => {
  assert.equal(shouldResetDeployForm({ ok: true }), true);
  assert.equal(shouldResetDeployForm({ ok: false }), false); // 실패 값은 그대로 남겨 고쳐 쓰게 한다
});

test("deployPersona — 빈 노트는 거절하고 마켓 디렉터리에 아무것도 안 남는다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-deploy-empty-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    await assert.rejects(
      deployPersona("dira", "dira teams", "newbie", { profile: "# newbie\n", skills: null }, "   ", []),
    );
    assert.deepEqual(await listMarketItems("persona"), []);
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("deployPersona — PROFILE.md 없이는 배포를 막는다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-deploy-noprofile-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    await assert.rejects(
      deployPersona("dira", "dira teams", "newbie", { profile: null, skills: null }, "첫 배포", []),
    );
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("deployPersona — 배포마다 버전이 늘고 옛 버전 파일은 그대로다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-deploy-persona-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    const v1 = await deployPersona(
      "dira",
      "dira teams",
      "newbie",
      { profile: "# v1\n", skills: "## 스킬\n" },
      "첫 배포",
      ["신규"],
    );
    assert.equal(v1.latest, "1.0.0");
    assert.equal(v1.versions[0].note, "첫 배포");

    // 같은 내용을 다시 배포해도 버전이 둘로 는다(동일성으로 안 합친다).
    const v2 = await deployPersona(
      "dira",
      "dira teams",
      "newbie",
      { profile: "# v1\n", skills: "## 스킬\n" },
      "두 번째",
      ["신규"],
    );
    assert.equal(v2.latest, "1.0.1");
    assert.equal(v2.versions.length, 2);

    const detail = await getMarketItem("persona", "dira", "newbie");
    assert.equal(detail?.profile, "# v1\n");
    assert.equal(detail?.skills, "## 스킬\n");

    const v1Profile = readFileSync(
      path.join(marketDir(), "personas", "dira", "newbie", "1.0.0", "PROFILE.md"),
      "utf8",
    );
    assert.equal(v1Profile, "# v1\n");
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("deployPersona — skills.md 없는 페르소나도 배포되고 PROFILE.md만 담는다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-deploy-noskills-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    await deployPersona("dira", "dira teams", "bare", { profile: "# bare\n", skills: null }, "첫 배포", []);
    const detail = await getMarketItem("persona", "dira", "bare");
    assert.equal(detail?.profile, "# bare\n");
    assert.equal(detail?.skills, null);
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("deploySquad — members 한 장을 담고 버전이 늘어난다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-deploy-squad-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    const v1 = await deploySquad("dira", "dira teams", "default", "pm\ndeveloper\n", "첫 배포", []);
    assert.equal(v1.latest, "1.0.0");
    const detail = await getMarketItem("squad", "dira", "default");
    assert.equal(detail?.members, "pm\ndeveloper\n");

    const v2 = await deploySquad("dira", "dira teams", "default", "pm\ndeveloper\n", "멤버 추가 예정", []);
    assert.equal(v2.latest, "1.0.1");
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

// ── 가져오기 ─────────────────────────────────────────────────────────────────

test("missingSquadMembers — 대상에 없는 이름만 순수 판정", () => {
  assert.deepEqual(missingSquadMembers(["a", "b", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(missingSquadMembers(["a"], ["a"]), []);
});

test("squadMemberNames — 첫 낱말만 뽑고 순서·리더(첫 줄)를 보존한다", () => {
  assert.deepEqual(squadMemberNames("pm 리더\ndeveloper\nqa 검증\n"), ["pm", "developer", "qa"]);
});

test("importPersona — 이름이 없으면 새로 쓰고, 같은 이름이 있으면 overwrite 없이는 conflict", async () => {
  seedPersona("dira", "importable", 1);
  const targetDir = mkdtempSync(path.join(tmpdir(), "fst-market-target-personas-"));

  const first = await importPersona("dira", "importable", targetDir, "importable");
  assert.deepEqual(first, { ok: true });
  assert.equal(readFileSync(path.join(targetDir, "importable", "PROFILE.md"), "utf8"), "# importable\n");

  const conflict = await importPersona("dira", "importable", targetDir, "importable");
  assert.deepEqual(conflict, { ok: false, reason: "conflict" });

  const overwritten = await importPersona("dira", "importable", targetDir, "importable", true);
  assert.deepEqual(overwritten, { ok: true });
});

test("importPersona — 마켓에 없는 항목은 notFound, 이름 규칙 밖은 invalidName", async () => {
  const targetDir = mkdtempSync(path.join(tmpdir(), "fst-market-target-personas-"));
  assert.deepEqual(await importPersona("dira", "no-such", targetDir, "x"), { ok: false, reason: "notFound" });
  assert.deepEqual(await importPersona("dira", "writer", targetDir, "../etc"), {
    ok: false,
    reason: "invalidName",
  });
});

test("importSquad — 대상에 없는 멤버를 마켓에서 같이 가져오고, 마켓에도 없는 멤버는 목록으로 남긴다", async () => {
  seedPersona("dira", "pm", 1);
  seedPersona("dira", "qa", 1);
  seedSquad("dira", "default", "pm 리더\nqa\nghost\n");

  const personasDir = mkdtempSync(path.join(tmpdir(), "fst-market-target-personas-"));
  const squadsDir = mkdtempSync(path.join(tmpdir(), "fst-market-target-squads-"));
  // qa는 대상에 이미 있다 — 안 건드린다(내용이 마켓과 다름을 표지로 삼는다).
  mkdirSync(path.join(personasDir, "qa"), { recursive: true });
  writeFileSync(path.join(personasDir, "qa", "PROFILE.md"), "# 로컬에서 고친 qa\n", "utf8");

  const r = await importSquad("dira", "default", squadsDir, personasDir, "default");
  assert.deepEqual(r, { ok: true, missingInMarket: ["ghost"], coImported: ["pm"] });
  assert.equal(readFileSync(path.join(squadsDir, "default", "members"), "utf8"), "pm 리더\nqa\nghost\n");
  assert.equal(readFileSync(path.join(personasDir, "pm", "PROFILE.md"), "utf8"), "# pm\n"); // 마켓에서 새로 옴
  assert.equal(readFileSync(path.join(personasDir, "qa", "PROFILE.md"), "utf8"), "# 로컬에서 고친 qa\n"); // 안 건드림

  const conflict = await importSquad("dira", "default", squadsDir, personasDir, "default");
  assert.deepEqual(conflict, { ok: false, reason: "conflict" });
});

test("appendInstall — installs.jsonl에 한 줄 append", async () => {
  await appendInstall({ at: "t9", kind: "persona", owner: "dira", name: "writer", v: 3, project: "pofol", as: "writer" });
  const after = readFileSync(marketInstallsPath(), "utf8");
  assert.ok(after.trim().split("\n").pop()!.includes('"v":3'));
});

// ── 원본에서 보는 기록 ─────────────────────────────────────────────────────────

test("marketRecord — 배포한 적 없으면 deploy가 null(아직 배포 안 함)", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-record-none-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    const rec = await marketRecord("persona", "dira", "newbie");
    assert.equal(rec.deploy, null);
    assert.deepEqual(rec.installs, []);
    assert.equal(rec.update, null);
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("marketRecord — 이 프로젝트가 배포한 적 있으면 그 버전 이력을 담는다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-record-own-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    seedPersona("dira", "writer", 2);
    const rec = await marketRecord("persona", "dira", "writer");
    assert.equal(rec.deploy?.latest, "2.0.0");
    assert.equal(rec.deploy?.versions.length, 2);
    assert.equal(rec.update, null); // importEntry를 안 넘겼으니 갱신 판정 자체가 없다
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("marketRecord — importEntry가 있고 원본이 더 새 버전이면 update가 찬다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-record-update-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    seedPersona("dira", "writer", 3);
    const rec = await marketRecord("persona", "pofol", "writer", { owner: "dira", name: "writer", v: 1 });
    assert.deepEqual(rec.update, { owner: "dira", name: "writer", installedVersion: "1.0.0", latestVersion: "3.0.0" });
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("marketRecord — 설치 버전이 이미 최신이면 update는 null", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-record-uptodate-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    seedPersona("dira", "writer", 2);
    const rec = await marketRecord("persona", "pofol", "writer", { owner: "dira", name: "writer", v: 2 });
    assert.equal(rec.update, null);
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("firstLine — 빈 줄을 건너뛰고 첫 내용 줄을 다듬어 돌려준다", () => {
  assert.equal(firstLine("\n\n  writer 페르소나\n둘째 줄\n"), "writer 페르소나");
  assert.equal(firstLine("\n \n"), "");
});

test("matchesMarketSearch — 이름·소유·태그·프로필 첫 줄 중 하나만 맞아도 통과한다", () => {
  const item = { name: "writer", ownerName: "dira teams", tags: ["글", "한국어"] };
  assert.equal(matchesMarketSearch(item, "글 쓰는 페르소나", ""), true); // 빈 검색어는 항상 참
  assert.equal(matchesMarketSearch(item, "글 쓰는 페르소나", "writer"), true); // 이름
  assert.equal(matchesMarketSearch(item, "글 쓰는 페르소나", "DIRA TEAMS"), true); // 소유, 대소문자 무시
  assert.equal(matchesMarketSearch(item, "글 쓰는 페르소나", "한국어"), true); // 태그
  assert.equal(matchesMarketSearch(item, "글 쓰는 페르소나", "쓰는"), true); // 프로필 첫 줄
  assert.equal(matchesMarketSearch(item, "글 쓰는 페르소나", "포폴"), false); // 어디에도 없다
});

test("projectsThatImported — owner·name이 맞는 레지스트리 칸이 있는 프로젝트 이름만 뽑는다", () => {
  const projects: { name: string; market?: { personas: Record<string, { owner: string; name: string }>; squads: Record<string, { owner: string; name: string }> } }[] = [
    { name: "pofol", market: { personas: { writer: { owner: "dira", name: "writer" } }, squads: {} } },
    { name: "acme", market: { personas: {}, squads: { default: { owner: "dira", name: "default" } } } },
    { name: "empty" },
  ];
  assert.deepEqual(projectsThatImported("persona", "dira", "writer", projects), ["pofol"]);
  assert.deepEqual(projectsThatImported("squad", "dira", "default", projects), ["acme"]);
  assert.deepEqual(projectsThatImported("persona", "dira", "reviewer", projects), []);
});

// ── team 프로젝트 가져오기 (P506-7) ─────────────────────────────────────────

const APM_YML = "name: team\nversion: 1.0.0\ndependencies:\n  apm:\n    - ./existing\n";

function teamRoot(): { queue: string; team: string } {
  const repo = mkdtempSync(path.join(tmpdir(), "fst-market-team-"));
  const team = path.join(repo, ".dira", "team");
  mkdirSync(team, { recursive: true });
  writeFileSync(path.join(team, "apm.yml"), APM_YML, "utf8");
  return { queue: path.join(repo, ".dira"), team };
}

test("importToTeam — 사본과 apm.yml 한 줄이 남고 저장소가 올라가도 사본은 그대로, 배지가 뜨고, diff가 먼저 나온다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-team-local-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    const { queue, team } = teamRoot();
    await deployPersona("pofol", "pofol", "X", { profile: "# X\n줄1\n", skills: null }, "첫", []);
    const r = await importToTeam("persona", "pofol", "X", queue, "X");
    assert.deepEqual(r, { ok: true, version: "1.0.0", coImported: [], missingInMarket: [] });
    assert.match(readFileSync(path.join(team, "apm.yml"), "utf8"), /^ {4}- \.\/market\/persona\/pofol\/X$/m);
    const copy = path.join(team, "market/persona/pofol/X");
    assert.match(readFileSync(path.join(copy, "apm.yml"), "utf8"), /^version: 1\.0\.0$/m);
    assert.equal(readFileSync(path.join(copy, "PROFILE.md"), "utf8"), "# X\n줄1\n");

    // 같은 줄을 두 번 걸지 않는다. 덮어쓰기 없이는 conflict.
    assert.deepEqual(await importToTeam("persona", "pofol", "X", queue, "X"), { ok: false, reason: "conflict" });
    assert.equal(readFileSync(path.join(team, "apm.yml"), "utf8").match(/market\/persona\/pofol\/X/g)!.length, 1);

    // 1.1.0 배포 - 사본은 1.0.0 그대로, 배지는 받은 사본 version < 저장소 최고.
    await deployPersona("pofol", "pofol", "X", { profile: "# X\n줄1\n줄2\n", skills: null }, "둘", [], "minor");
    assert.match(readFileSync(path.join(copy, "apm.yml"), "utf8"), /^version: 1\.0\.0$/m);
    const imports = await teamImports(queue);
    assert.deepEqual(imports.personas.X, { owner: "pofol", name: "X", v: "1.0.0" });
    const rec = await marketRecord("persona", "other", "X", imports.personas.X);
    assert.deepEqual(rec.update, { owner: "pofol", name: "X", installedVersion: "1.0.0", latestVersion: "1.1.0" });

    // 업데이트 전 diff: 받기 전이라 사본은 아직 그대로다.
    const pv = await previewTeamUpdate("persona", "pofol", "X", queue);
    assert.equal(pv?.version, "1.1.0");
    assert.deepEqual(pv?.files.map((f) => [f.file, f.status]), [["PROFILE.md", "changed"], ["apm.yml", "changed"]]);
    assert.deepEqual(pv?.files[0].lines.filter((l) => l.sign !== " "), [{ sign: "+", text: "줄2" }]);
    assert.equal(readFileSync(path.join(copy, "PROFILE.md"), "utf8"), "# X\n줄1\n");

    // 받기 = overwrite 가져오기. 사본이 1.1.0이 되고 배지가 꺼진다.
    assert.equal((await importToTeam("persona", "pofol", "X", queue, "X", true)).ok, true);
    assert.equal((await teamImports(queue)).personas.X.v, "1.1.0");
    assert.equal(readFileSync(path.join(copy, "PROFILE.md"), "utf8"), "# X\n줄1\n줄2\n");
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("importToTeam — owner dira는 사본 없이 packages git 의존성 한 줄이다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-team-dira-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    const { queue, team } = teamRoot();
    await deployPersona("dira", "dira", "writer", { profile: "# w\n", skills: null }, "첫", []);
    await importToTeam("persona", "dira", "writer", queue, "writer");
    assert.match(
      readFileSync(path.join(team, "apm.yml"), "utf8"),
      /^ {4}- proofer-tech\/dira\/packages\/persona-writer#persona-writer-v1\.0\.0$/m,
    );
    assert.equal((await teamImports(queue)).personas.writer.v, "1.0.0");
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("lineDiff — 바뀐 줄만 +/-로 나온다", () => {
  assert.deepEqual(lineDiff("a\nb", "a\nc").filter((l) => l.sign !== " "), [
    { sign: "-", text: "b" },
    { sign: "+", text: "c" },
  ]);
});

test("importToTeam - 버전을 고르면 그 버전이 복사되고 안 고르면 최고 버전이다", async () => {
  const local = mkdtempSync(path.join(tmpdir(), "fst-market-team-ver-"));
  const prev = process.env.TICKET_LOCAL;
  process.env.TICKET_LOCAL = local;
  try {
    const { queue, team } = teamRoot();
    await deployPersona("pofol", "pofol", "V", { profile: "# V\nold\n", skills: null }, "첫", []);
    await deployPersona("pofol", "pofol", "V", { profile: "# V\nnew\n", skills: null }, "둘", [], "minor");
    const copy = path.join(team, "market/persona/pofol/V");
    const low = await importToTeam("persona", "pofol", "V", queue, "V", false, "1.0.0");
    assert.equal(low.ok && low.version, "1.0.0");
    assert.equal(readFileSync(path.join(copy, "PROFILE.md"), "utf8"), "# V\nold\n");
    assert.match(readFileSync(path.join(copy, "apm.yml"), "utf8"), /^version: 1\.0\.0$/m);
    const top = await importToTeam("persona", "pofol", "V", queue, "V", true);
    assert.equal(top.ok && top.version, "1.1.0");
    assert.equal(readFileSync(path.join(copy, "PROFILE.md"), "utf8"), "# V\nnew\n");
  } finally {
    process.env.TICKET_LOCAL = prev;
  }
});

test("업데이트 확인 문구는 버전 뒤에 공백이 없다", () => {
  for (const [loc, want] of [["ko", "v1.1.0로 덮어씁니다."], ["en", "v1.1.0. This can't be undone."]] as const)
    assert.ok(`v1.1.0${t(loc, "market.update.confirmBodySuffix")}`.startsWith(want.slice(0, want.length)));
});
