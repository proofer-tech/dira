import { test } from "node:test";
import assert from "node:assert";
import { ko } from "./i18n.ts";
import {
  buildOntologySeedFiles,
  buildSeed,
  Q1_OPTIONS,
  Q2_CHIPS,
  Q3_OPTIONS,
  Q4_OPTIONS,
  QUESTIONS,
  REQUIRED_PROPS,
} from "./ontology-seed.ts";

const FULL = {
  q1: Q1_OPTIONS[0].value,
  q2: ["고객사", "계약서", "프로젝트"],
  q3: [Q3_OPTIONS[0].relation, Q3_OPTIONS[1].relation],
  q4: [Q4_OPTIONS[0].value],
};

test("buildSeed — 객체 타입 3~5 · 관계 타입 2~4, 직접 입력 그대로 채택", () => {
  const seed = buildSeed(FULL);
  assert.deepEqual(seed.objectTypes, ["고객사", "계약서", "프로젝트"]);
  assert.ok(seed.objectTypes.length >= 3 && seed.objectTypes.length <= 5);
  assert.ok(seed.relationTypes.length >= 2 && seed.relationTypes.length <= 4);
  assert.deepEqual(
    seed.relationTypes.map((r) => r.name),
    [Q3_OPTIONS[0].relation, Q3_OPTIONS[1].relation],
  );
  // 정의역/치역은 고른 객체 타입에서 나온다 — 지어낸 이름이 없다
  for (const r of seed.relationTypes) {
    assert.ok(seed.objectTypes.includes(r.domain));
    assert.ok(seed.objectTypes.includes(r.range));
  }
});

test("buildSeed — 아무것도 안 골라도 최소 3/2를 채운다(빈손이 아니라 예의 시드)", () => {
  const seed = buildSeed({ q1: "", q2: [], q3: [], q4: [] });
  assert.equal(seed.objectTypes.length, 3);
  assert.equal(seed.relationTypes.length, 2);
});

test("buildSeed — 5개 넘게 고르면 앞에서부터(우선순위) 5개로 자른다", () => {
  const seed = buildSeed({ ...FULL, q2: ["a", "b", "c", "d", "e", "f"] });
  assert.deepEqual(seed.objectTypes, ["a", "b", "c", "d", "e"]);
});

test("buildSeed — 중복 응답은 한 번만 센다", () => {
  const seed = buildSeed({ ...FULL, q2: ["고객", "고객", "문서"] });
  assert.deepEqual(seed.objectTypes, ["고객", "문서", "자료"]); // 부족분은 폴백으로 3개를 채운다
});

test("buildOntologySeedFiles — 지도 + 타입마다 정의·템플릿, 관계마다 정의 파일이 난다", () => {
  const files = buildOntologySeedFiles(FULL);
  const byRel = new Map(files.map((f) => [f.rel, f.text]));

  const schema = byRel.get("_ontology/SCHEMA.md");
  assert.ok(schema, "_ontology/SCHEMA.md가 없다");
  assert.match(schema!, /## 객체 타입/);
  assert.match(schema!, /## 관계 타입/);
  assert.match(schema!, /관점: 제품이나 코드를 만듭니다/);
  assert.match(schema!, /<!-- 설문 응답 원문/);
  assert.match(schema!, /Q2\. 자주 이름을 부르게 될 것: 고객사, 계약서, 프로젝트/);
  for (const t of ["고객사", "계약서", "프로젝트"]) assert.match(schema!, new RegExp(`\\| ${t} \\|`));

  for (const t of ["고객사", "계약서", "프로젝트"]) {
    const typeDoc = byRel.get(`_ontology/object-types/${t}.md`);
    assert.ok(typeDoc, `_ontology/object-types/${t}.md가 없다`);
    assert.match(typeDoc!, /type: ObjectType/);
    for (const p of REQUIRED_PROPS) assert.match(typeDoc!, new RegExp(`\`${p}\``));

    const template = byRel.get(`templates/${t}.md`);
    assert.ok(template, `templates/${t}.md가 없다`);
    assert.match(template!, new RegExp(`^type: ${t}$`, "m"));
    for (const p of REQUIRED_PROPS) assert.match(template!, new RegExp(`^${p}: $`, "m"));
  }

  for (const r of [Q3_OPTIONS[0].relation, Q3_OPTIONS[1].relation]) {
    const linkDoc = byRel.get(`_ontology/link-types/${r}.md`);
    assert.ok(linkDoc, `_ontology/link-types/${r}.md가 없다`);
    assert.match(linkDoc!, /type: LinkType/);
  }

  // 파일 수 — 타입마다 정의+템플릿 둘, 관계마다 정의 하나, 지도 하나
  assert.equal(files.length, 1 + 3 * 2 + 2);
});

test("문항 4개(질문 문구 + 선택지)에는 금지어가 없다 — 산출물(SCHEMA.md 용어)에는 걸지 않는다", () => {
  const bannedInQuestions = ["객체", "타입", "관계", "온톨로지"];
  const allQuestionText = [
    ...Object.values(QUESTIONS).map((k) => ko[k]),
    ...Q1_OPTIONS.map((o) => ko[o.labelKey]),
    ...Q2_CHIPS.map((o) => ko[o.labelKey]),
    ...Q3_OPTIONS.map((o) => ko[o.labelKey]),
    ...Q4_OPTIONS.map((o) => ko[o.labelKey]),
  ];
  for (const label of allQuestionText) {
    for (const w of bannedInQuestions) assert.ok(!label.includes(w), `${label} 안에 "${w}"`);
  }
});
