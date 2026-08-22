import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeOntologyMetrics, isDiraFormat } from "./ontology.ts";
import { listTree, readTextFile } from "./protocols.ts";

// JSX가 있는 page.tsx는 node --test로 통째로 import할 수 없다 — 여기선 실제 소스에서
// loadMetrics의 스키마 셀렉터 줄만 떼어 검사한다. page.tsx가 다시 "SCHEMA.md"로 되돌아가면
// (P219-10 이전으로 회귀) 이 테스트가 문자열 불일치로 먼저 잡는다.
const ONTOLOGY_PAGE_TSX = fileURLToPath(
  new URL("../app/(app)/p/[project]/ontology/page.tsx", import.meta.url),
);

const SCHEMA = `## 객체 타입

| 이름 | 한 줄 뜻 | 정의 |
|---|---|---|
| 사람 | 사람 객체다 | [[사람]] |
| 동물 | 동물 객체다 | [[동물]] |

## 관계 타입

| 이름 | 정의역 → 치역 |
|---|---|
| 안다 | 사람 → 사람 |
`;

// 프런트매터 객체 한 장을 조립한다 — `props`는 `- 키: 값` 평평한 줄, `rels`는 `links:` 아래
// `<관계타입>: [<대상>, ...]`. 테스트마다 같은 모양을 손으로 반복하지 않으려는 헬퍼일 뿐,
// 판정 자체는 `lib/ontology.ts`의 `parseObject`가 한다.
function obj(
  type: string,
  name: string,
  prose: string,
  props: Record<string, string> = {},
  rels: Record<string, string[]> = {},
) {
  const lines = [`type: ${type}`, `name: ${name}`, ...Object.entries(props).map(([k, v]) => `${k}: ${v}`)];
  if (Object.keys(rels).length > 0) {
    lines.push("links:");
    for (const [rel, targets] of Object.entries(rels)) {
      lines.push(`  ${rel}:`);
      for (const t of targets) lines.push(`    - ${t}: "[[${t}]]"`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n\n# ${name}\n\n${prose}\n`;
}

// `_ontology/object-types/<타입>.md` §Properties 표 한 장 — `required`가 true인 행만 `필수` 열에 ✅
// (필수 속성의 정본 자리, P224). `computeOntologyMetrics`는 이 표에서만 필수 속성을 읽는다 —
// `SCHEMA.md` 객체 타입 표는 더는 안 본다.
function typeFile(type: string, props: { name: string; required: boolean }[]) {
  const rows = props.map((p) => `| \`${p.name}\` | string | ${p.required ? "✅" : ""} | - |`).join("\n");
  return {
    rel: `_ontology/object-types/${type}.md`,
    text: `# Object Type: ${type}\n\n## Properties\n\n| 이름 | 타입 | 필수 | 설명 |\n|---|---|---|---|\n${rows}\n`,
  };
}

test("숨은 간선 — 서술 링크가 관계 줄에 대응 없으면 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수는 [[영희]]를 언급한다.", { 이름: "철수", 나이: "20" }) },
      { rel: "objects/사람/영희.md", text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }) },
    ],
    actionLogs: [],
  });
  assert.equal(m.hiddenEdges.count, 1);
  assert.match(m.hiddenEdges.items[0], /\[\[영희\]\]/);
});

test("숨은 간선 — 상대가 나를 관계로 가리키면 역방향으로 빠진다(ADR 0007)", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수는 [[영희]]를 언급한다.", { 이름: "철수", 나이: "20" }) },
      {
        rel: "objects/사람/영희.md",
        text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }, { 안다: ["철수"] }),
      },
    ],
    actionLogs: [],
  });
  assert.equal(m.hiddenEdges.count, 0);
});

test("스키마 위반 — 미정의 타입 · 미정의 관계 · 댕글링 · 정의역/치역 · 필수 속성 누락을 모두 잡는다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    typeFiles: [typeFile("사람", [{ name: "이름", required: true }, { name: "나이", required: true }])],
    objects: [
      // 미정의 타입 + 미정의 관계 + 댕글링(허깨비 없음)
      { rel: "objects/미정의타입/유령.md", text: obj("미정의타입", "유령", "유령이다.", {}, { 미정의관계: ["허깨비"] }) },
      // 정의역/치역 위반: 안다는 사람→사람인데 대상이 동물
      {
        rel: "objects/사람/철수.md",
        text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }, { 안다: ["멍멍이"] }),
      },
      { rel: "objects/동물/멍멍이.md", text: obj("동물", "멍멍이", "멍멍이다.") },
      // 필수 속성 누락(이름·나이 둘 다 없음)
      { rel: "objects/사람/짱구.md", text: obj("사람", "짱구", "짱구다.") },
    ],
    actionLogs: [],
  });
  const joined = m.schemaViolations.join("\n");
  assert.match(joined, /미정의 타입.*유령/);
  assert.match(joined, /미정의 관계.*미정의관계/);
  assert.match(joined, /댕글링.*\[\[허깨비\]\]/);
  assert.match(joined, /정의역·치역 위반.*철수/);
  assert.match(joined, /필수 속성 누락.*짱구/);
});

test("필수 속성 — 타입 파일 §Properties의 `필수` ✅ 행에서 읽는다(P224, 지도 표가 아니다)", () => {
  const typeFiles = [
    typeFile("사람", [
      { name: "이름", required: true },
      { name: "나이", required: true },
      { name: "취미", required: false },
    ]),
  ];
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    typeFiles,
    objects: [
      // 필수(이름·나이) 중 나이가 빠졌다 — 위반 1건. 필수 아닌 취미가 없어도 안 걸린다.
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수" }) },
      // 필수 둘 다 있다 — 위반 0건
      { rel: "objects/사람/영희.md", text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }) },
    ],
    actionLogs: [],
  });
  const joined = m.schemaViolations.join("\n");
  const missing = m.schemaViolations.filter((v) => v.startsWith("필수 속성 누락"));
  assert.equal(missing.length, 1);
  assert.match(joined, /필수 속성 누락: objects\/사람\/철수\.md \(사람\) -> 나이/);
  assert.doesNotMatch(joined, /영희/);
});

test("필수 속성 — 타입 파일도 §Properties도 없으면 무판정(예외 없이 통과)", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [{ rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.") }],
    actionLogs: [],
  });
  assert.doesNotMatch(m.schemaViolations.join("\n"), /필수 속성 누락/);
});

test("정의역·치역 판정 — 관계 표 셀 끝의 ' — 설명' 꼬리를 떼고 판정한다(실 SCHEMA.md 모양, 4657d628)", () => {
  const SCHEMA_TAIL = `## 객체 타입

| 이름 | 한 줄 뜻 | 정의 |
|---|---|---|
| 워커 | 워커 객체다 | [[워커]] |
| 엔진 파일 | 엔진 파일 객체다 | [[엔진 파일]] |
| GUI 모듈 | GUI 모듈 객체다 | [[GUI 모듈]] |

## 관계 타입

| 이름 | 정의역 → 치역 |
|---|---|
| 돌린다 | 워커 → 엔진 파일 — cron이 띄운 워커가 실제로 부르는 스크립트 |
| 불러온다 | GUI 모듈 · 워커 → GUI 모듈 · 엔진 파일 — import로 닿는 자리 · 위 §속성 |
`;
  const m = computeOntologyMetrics({
    schemaText: SCHEMA_TAIL,
    objects: [
      // 돌린다: 치역이 단일 항목 + 꼬리 — 꼬리를 안 떼면 "엔진 파일" != "엔진 파일 — ..."로 오탐
      { rel: "objects/워커/w1.md", text: obj("워커", "w1", "워커다.", {}, { 돌린다: ["e1"] }) },
      // 불러온다: 치역이 'A · B — 꼬리' — 안 떼면 마지막 항목 "엔진 파일"만 꼬리를 물어 오탐
      { rel: "objects/GUI 모듈/g1.md", text: obj("GUI 모듈", "g1", "GUI 모듈이다.", {}, { 불러온다: ["e2"] }) },
      { rel: "objects/엔진 파일/e1.md", text: obj("엔진 파일", "e1", "엔진 파일이다.") },
      { rel: "objects/엔진 파일/e2.md", text: obj("엔진 파일", "e2", "엔진 파일이다.") },
    ],
    actionLogs: [],
  });
  assert.doesNotMatch(m.schemaViolations.join("\n"), /정의역·치역 위반/);
});

test("정의역·치역 판정 — 꼬리 구분자가 하이픈(' - ')이어도 뗀다(b8e04f56, 특수문자 표기 통일 후 모양)", () => {
  const SCHEMA_TAIL = `## 객체 타입

| 이름 | 한 줄 뜻 | 정의 |
|---|---|---|
| 워커 | 워커 객체다 | [[워커]] |
| 엔진 파일 | 엔진 파일 객체다 | [[엔진 파일]] |
| GUI 모듈 | GUI 모듈 객체다 | [[GUI 모듈]] |

## 관계 타입

| 이름 | 정의역 → 치역 |
|---|---|
| 돌린다 | 워커 → 엔진 파일 - cron이 띄운 워커가 실제로 부르는 스크립트 |
| 불러온다 | GUI 모듈 · 워커 → GUI 모듈 · 엔진 파일 - import로 닿는 자리 · 위 §속성 |
`;
  const m = computeOntologyMetrics({
    schemaText: SCHEMA_TAIL,
    objects: [
      // 돌린다: 치역이 단일 항목 + 꼬리 — 꼬리를 안 떼면 "엔진 파일" != "엔진 파일 - ..."로 오탐
      { rel: "objects/워커/w1.md", text: obj("워커", "w1", "워커다.", {}, { 돌린다: ["e1"] }) },
      // 불러온다: 치역이 'A · B - 꼬리' — 안 떼면 마지막 항목 "엔진 파일"만 꼬리를 물어 오탐
      { rel: "objects/GUI 모듈/g1.md", text: obj("GUI 모듈", "g1", "GUI 모듈이다.", {}, { 불러온다: ["e2"] }) },
      { rel: "objects/엔진 파일/e1.md", text: obj("엔진 파일", "e1", "엔진 파일이다.") },
      { rel: "objects/엔진 파일/e2.md", text: obj("엔진 파일", "e2", "엔진 파일이다.") },
    ],
    actionLogs: [],
  });
  assert.doesNotMatch(m.schemaViolations.join("\n"), /정의역·치역 위반/);
});

// 실 vault(stocky) 모양 그대로 — 관계 표는 다중값을 쉼표로 적고, 링크 항목은 `대상` 아래
// 링크 속성(`경유`)을 한 단 더 들여쓴다. cc5bb157이 신고한 두 오탐의 재현 케이스다.
const SCHEMA_MULTI = `## 객체 타입

| 이름 | 한 줄 뜻 | 정의 |
|---|---|---|
| 에이전트 | 에이전트다 | [[에이전트]] |
| 엔진 | 엔진이다 | [[엔진]] |

## 관계 타입

| 관계 | 정의역 → 치역 | 링크 속성 |
|---|---|---|
| 호출한다 | 에이전트, 엔진 → 엔진 | \`경유\` |
`;

test("정의역·치역 판정 — 다중값 셀은 집합이라 원소 하나만 써도 통과한다(쉼표 구분, cc5bb157)", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA_MULTI,
    objects: [
      // 정의역이 [에이전트, 엔진] 중 '엔진' 하나 — 집합이 아니라 문자열로 비교하면 오탐
      { rel: "objects/엔진/e1.md", text: obj("엔진", "e1", "엔진이다.", {}, { 호출한다: ["e2"] }) },
      { rel: "objects/엔진/e2.md", text: obj("엔진", "e2", "엔진이다.") },
    ],
    actionLogs: [],
  });
  assert.doesNotMatch(m.schemaViolations.join("\n"), /정의역·치역 위반/);
});

test("링크 속성 — 항목이 둘 이상이어도 속성 키를 관계 이름으로 읽지 않는다(cc5bb157)", () => {
  const withAttrs = `---
type: 엔진
name: e1
links:
  호출한다:
    - 대상: "[[e2]]"
      경유: 첫 항목
    - 대상: "[[e3]]"
      경유: 둘째 항목
    - 대상: "[[e4]]"
      경유: 셋째 항목
---

# e1

엔진이다.
`;
  const m = computeOntologyMetrics({
    schemaText: SCHEMA_MULTI,
    objects: [
      { rel: "objects/엔진/e1.md", text: withAttrs },
      { rel: "objects/엔진/e2.md", text: obj("엔진", "e2", "엔진이다.") },
      { rel: "objects/엔진/e3.md", text: obj("엔진", "e3", "엔진이다.") },
      { rel: "objects/엔진/e4.md", text: obj("엔진", "e4", "엔진이다.") },
    ],
    actionLogs: [],
  });
  assert.deepStrictEqual(m.schemaViolations, []);
  assert.strictEqual(m.relationCount, 3); // 항목 셋 전부 '호출한다' 하나로 읽힌다
});

test("껍데기 · 고립", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      // 속성 1개 = 껍데기, 관계 0 + 들어오는 관계 0 = 고립
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수" }) },
      {
        rel: "objects/사람/영희.md",
        text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }, { 안다: ["철수"] }),
      },
    ],
    actionLogs: [],
  });
  assert.equal(m.shells.count, 1);
  assert.equal(m.isolated.count, 0); // 철수는 영희의 '안다' 관계로 들어오는 간선이 있어 고립이 아니다
});

test("역링크(backlinks)", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }) },
      {
        rel: "objects/사람/영희.md",
        text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }, { 안다: ["철수"] }),
      },
    ],
    actionLogs: [],
  });
  assert.deepEqual(m.backlinks["철수"], ["영희"]);
  assert.deepEqual(m.backlinks["영희"], []);
});

test("서술 한 문장 비율 — 문장 하나뿐인 객체를 표본 검토 대상으로 좁힌다(§5-3 §형식 §④)", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }) },
      {
        rel: "objects/사람/영희.md",
        text: obj("사람", "영희", "영희는 철수와 안다. 최근에 같이 일했다.", { 이름: "영희", 나이: "22" }),
      },
    ],
    actionLogs: [],
  });
  assert.equal(m.singleSentenceProse.count, 1);
  assert.match(m.singleSentenceProse.items[0], /철수/);
});

test("action-log — 빈손 비율 · 새객체/스키마개정 추이 · 마지막 반영 시각", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [],
    actionLogs: [
      { date: "2026-08-07", text: "- 09:00 새객체: A - 설명 (aaaa1111)\n- 10:00 빈손: 줄 게 없음 (bbbb2222)\n" },
      {
        date: "2026-08-08",
        text: "- 13:30 빈손: ... (666d3601)\n- 14:00 스키마개정: 타입 신설 - 왜 - 버린대안 (cccc3333)\n",
      },
    ],
  });
  assert.equal(m.emptyHanded.count, 2);
  assert.equal(m.emptyHanded.total, 4);
  assert.equal(m.emptyHanded.ratio, 0.5);
  assert.deepEqual(m.objectTrend, [{ date: "2026-08-07", count: 1 }]);
  assert.deepEqual(m.schemaStability, [{ date: "2026-08-08", count: 1 }]);
  assert.equal(m.lastUpdated, "2026-08-08 14:00");
});

test("객체 뷰 — [[링크]]가 객체·다른 뷰로 닿으면 통과, 안 닿으면 댕글링(기존 표시 재사용)하고 `##` 절은 안 걸린다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [{ rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }) }],
    views: [
      // 철수(객체)·짝 뷰(다른 뷰) 둘 다 닿아야 하고, 허깨비는 댕글링, `##` 절이 있어도 위반 없음
      {
        rel: "object-views/모음.md",
        text: "## 절\n[[철수]]와 [[짝 뷰]]를 묶는 기록. [[허깨비]]는 없다.\n",
      },
      { rel: "object-views/짝 뷰.md", text: "모음과 짝인 뷰.\n" },
    ],
    actionLogs: [],
  });
  const joined = m.schemaViolations.join("\n");
  assert.match(joined, /댕글링: object-views\/모음\.md -> \[\[허깨비\]\]/);
  assert.doesNotMatch(joined, /철수/);
  assert.doesNotMatch(joined, /짝 뷰/);
  assert.doesNotMatch(joined, /## 절 사용.*모음/);
});

test("계층 순환(OOPS!) — 관계 줄이 만드는 방향 그래프에 사이클이 있으면 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }, { 안다: ["영희"] }) },
      { rel: "objects/사람/영희.md", text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }, { 안다: ["철수"] }) },
    ],
    actionLogs: [],
  });
  assert.equal(m.hierarchyCycles.count, 1);
  assert.match(m.hierarchyCycles.items[0], /철수/);
  assert.match(m.hierarchyCycles.items[0], /영희/);
});

test("계층 순환(OOPS!) — 사이클 없는 일직선 그래프는 안 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }, { 안다: ["영희"] }) },
      { rel: "objects/사람/영희.md", text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }) },
    ],
    actionLogs: [],
  });
  assert.equal(m.hierarchyCycles.count, 0);
});

test("다의적 요소(OOPS!) — 같은 식별자가 속성과 관계 두 역할로 쪼개 쓰이면 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      // '대상'을 속성(값)으로 쓴 자리
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20", 대상: "공지" }) },
      // '대상'을 관계(링크)로 쓴 자리 — 같은 이름이 값과 링크 두 개념을 가리킨다
      { rel: "objects/사람/영희.md", text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }, { 대상: ["철수"] }) },
    ],
    actionLogs: [],
  });
  assert.equal(m.polysemousElements.count, 1);
  assert.match(m.polysemousElements.items[0], /'대상'/);
});

test("다의적 요소(OOPS!) — 이름이 속성으로만(또는 관계로만) 쓰이면 안 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }, { 안다: ["영희"] }) },
      { rel: "objects/사람/영희.md", text: obj("사람", "영희", "영희다.", { 이름: "영희", 나이: "22" }) },
    ],
    actionLogs: [],
  });
  assert.equal(m.polysemousElements.count, 0);
});

test("잉여 클래스(OOPS!) — 스키마에 있는 타입인데 인스턴스가 0개면 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA, // 객체 타입: 사람 · 동물
    objects: [{ rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }) }],
    actionLogs: [],
  });
  assert.equal(m.redundantClasses.count, 1);
  assert.match(m.redundantClasses.items[0], /'동물'/);
});

test("잉여 클래스(OOPS!) — 스키마의 모든 타입에 인스턴스가 있으면 안 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: obj("사람", "철수", "철수다.", { 이름: "철수", 나이: "20" }) },
      { rel: "objects/동물/멍멍이.md", text: obj("동물", "멍멍이", "멍멍이다.") },
    ],
    actionLogs: [],
  });
  assert.equal(m.redundantClasses.count, 0);
});

test("스키마 파일 경로 — page.tsx의 loadMetrics가 찾는 rel은 _ontology/SCHEMA.md다(P219-10 이후)", async () => {
  const pageSource = await readFile(ONTOLOGY_PAGE_TSX, "utf8");
  const m = pageSource.match(/schemaEntry = tree\.find\(\(e\) => !e\.isDir && e\.rel === "([^"]+)"\)/);
  assert.ok(m, "loadMetrics의 schemaEntry 셀렉터 줄을 못 찾았다 — page.tsx가 바뀌었나?");
  assert.equal(m[1], "_ontology/SCHEMA.md");

  const base = await mkdtemp(path.join(tmpdir(), "ontology-schema-path-"));
  try {
    await mkdir(path.join(base, "_ontology"), { recursive: true });
    await writeFile(path.join(base, "_ontology", "SCHEMA.md"), SCHEMA, "utf8");
    await mkdir(path.join(base, "objects", "미정의타입"), { recursive: true });
    await writeFile(path.join(base, "objects", "미정의타입", "유령.md"), "유령이다.\n", "utf8");

    const tree = await listTree(base);

    // 옛 경로("SCHEMA.md")로는 못 찾는다 — 고치기 전 증상 재현.
    assert.equal(tree.find((e) => !e.isDir && e.rel === "SCHEMA.md"), undefined);

    // 지금 page.tsx의 loadMetrics가 쓰는 경로.
    const schemaEntry = tree.find((e) => !e.isDir && e.rel === "_ontology/SCHEMA.md");
    assert.ok(schemaEntry, "_ontology/SCHEMA.md를 트리에서 찾아야 한다");
    const schemaText = (await readTextFile(base, schemaEntry.rel)).text ?? "";
    assert.notEqual(schemaText, "");

    const objectEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("objects/"));
    const objects = await Promise.all(
      objectEntries.map(async (e) => ({ rel: e.rel, text: (await readTextFile(base, e.rel)).text ?? "" })),
    );
    const m = computeOntologyMetrics({ schemaText, objects, actionLogs: [] });
    assert.match(m.schemaViolations.join("\n"), /미정의 타입.*유령/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("isDiraFormat — 둘 다 없으면 형식이 아니다", () => {
  assert.equal(
    isDiraFormat([
      { rel: "README.md", isDir: false },
      { rel: "notes", isDir: true },
      { rel: "notes/오늘.md", isDir: false },
    ]),
    false,
  );
});

test("isDiraFormat — SCHEMA.md만 있어도 선다", () => {
  assert.equal(
    isDiraFormat([
      { rel: "_ontology", isDir: true },
      { rel: "_ontology/SCHEMA.md", isDir: false },
    ]),
    true,
  );
});

test("isDiraFormat — objects/만 있어도 선다(빈 디렉터리도 포함)", () => {
  assert.equal(isDiraFormat([{ rel: "objects", isDir: true }]), true);
  assert.equal(
    isDiraFormat([
      { rel: "objects", isDir: true },
      { rel: "objects/사람", isDir: true },
      { rel: "objects/사람/철수.md", isDir: false },
    ]),
    true,
  );
});

test("isDiraFormat — 둘 다 있으면 선다", () => {
  assert.equal(
    isDiraFormat([
      { rel: "_ontology/SCHEMA.md", isDir: false },
      { rel: "objects/사람/철수.md", isDir: false },
    ]),
    true,
  );
});
