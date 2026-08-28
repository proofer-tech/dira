import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type FrontmatterCandidates,
  insertRow,
  isBracketList,
  joinListValue,
  keyCandidates,
  parseFrontmatterHead,
  removeRow,
  splitListValue,
  stringifyFrontmatterHead,
  updateRow,
  valueCandidates,
} from "./markdown-frontmatter-rows.ts";

// 온톨로지 실트리(179장)를 본뜬 픽스처 넷 — 평평한 fm, 두 층 중첩(`links:`), 여러 줄 값,
// 대괄호 목록. 실제 모양은 `objects/워커/w8.md`류(중첩)·`objects/기능/엔진 번들링.md`류
// (여러 줄 값·대괄호 목록)를 그대로 본떴다.

const FLAT_HEAD = `---
type: 워커
name: w8
aliases: []
tags: []
---
`;

const NESTED_HEAD = `---
type: 워커
name: w8
links:
  돌린다:
    - 디스패치 루프: "[[디스패치 루프]]"
  고친다:
    - 큐: "[[큐]]"
---
`;

const MULTILINE_VALUE_HEAD = `---
type: 기능
name: 엔진 번들링
값: '첫 줄
  둘째 줄까지 이어진다
  셋째 줄도'
근거:
  - dfda6f57
---
`;

const BRACKET_LIST_HEAD = `---
type: 기능
aliases: [프로젝트 홈, 프로젝트 전환]
description: cron이 분마다 띄우는 실행 단위 - 스크립트 w1.sh, 워크트리 w1
---
`;

const FIXTURES = [
  ["평평한 fm", FLAT_HEAD],
  ["두 층 중첩(links:)", NESTED_HEAD],
  ["여러 줄 값", MULTILINE_VALUE_HEAD],
  ["대괄호 목록", BRACKET_LIST_HEAD],
] as const;

for (const [label, head] of FIXTURES) {
  test(`항등 - ${label}은 한 행도 안 고치면 되쓴 결과가 원문과 바이트가 같다`, () => {
    const doc = parseFrontmatterHead(head);
    assert.equal(stringifyFrontmatterHead(doc), head);
  });
}

test("빈 head는 빈 문서를 낸다", () => {
  const doc = parseFrontmatterHead("");
  assert.deepEqual(doc, { open: "", rows: [], close: "" });
  assert.equal(stringifyFrontmatterHead(doc), "");
});

test("층 - 부모 아래 목록 항목은 부모보다 한 층 깊다", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD);
  const byKey = (k: string) => doc.rows.find((r) => r.key === k);
  assert.equal(byKey("type")?.level, 0);
  assert.equal(byKey("links")?.level, 0);
  assert.equal(byKey("links")?.shape, "parent");
  assert.equal(byKey("돌린다")?.level, 1);
  assert.equal(byKey("돌린다")?.shape, "parent");
  const item = doc.rows.find((r) => r.key === "디스패치 루프");
  assert.equal(item?.level, 2);
  assert.equal(item?.shape, "list-item");
  assert.equal(item?.value, '"[[디스패치 루프]]"');
});

test("여러 줄 값 - 이음 줄까지 한 행의 슬라이스다", () => {
  const doc = parseFrontmatterHead(MULTILINE_VALUE_HEAD);
  const valueRow = doc.rows.find((r) => r.key === "값");
  assert.ok(valueRow);
  assert.equal(valueRow?.raw, "값: '첫 줄\n  둘째 줄까지 이어진다\n  셋째 줄도'\n");
  // 그 다음 행(근거:)은 안 밀린다
  const nextRow = doc.rows.find((r) => r.key === "근거");
  assert.equal(nextRow?.raw, "근거:\n");
});

test("한 행만 고치면 그 행의 줄 구간 밖 바이트가 한 글자도 안 갈린다", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "name");
  const rows = updateRow(doc.rows, index, { key: "name", value: "w9" });
  const rewritten = stringifyFrontmatterHead({ ...doc, rows });
  assert.equal(rewritten, NESTED_HEAD.replace("name: w8", "name: w9"));
  // 고친 행 밖의 다른 행은 원문 슬라이스 그대로다
  rows.forEach((r, i) => {
    if (i === index) return;
    assert.equal(r.raw, doc.rows[i].raw);
  });
});

test("행 더하기 - 더한 행은 바로 위 행의 층을 물려받는다", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "디스패치 루프") + 1;
  const rows = insertRow(doc.rows, index, { key: "새 대상", value: '"[[새 대상]]"', shape: "list-item" });
  assert.equal(rows[index].level, doc.rows[index - 1].level);
  assert.equal(rows[index].raw, '    - 새 대상: "[[새 대상]]"\n');
});

test("행 지우기 - 지운 행 밖은 안 갈린다", () => {
  const doc = parseFrontmatterHead(FLAT_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "aliases");
  const rows = removeRow(doc.rows, index);
  assert.equal(rows.length, doc.rows.length - 1);
  const rewritten = stringifyFrontmatterHead({ ...doc, rows });
  assert.equal(rewritten, FLAT_HEAD.replace("aliases: []\n", ""));
});

test("대괄호 목록 - 항목으로 가르고 다시 잇는다", () => {
  const doc = parseFrontmatterHead(BRACKET_LIST_HEAD);
  const row = doc.rows.find((r) => r.key === "aliases");
  assert.ok(row?.value && isBracketList(row.value));
  const items = splitListValue(row!.value!);
  assert.deepEqual(items, ["프로젝트 홈", "프로젝트 전환"]);
  assert.equal(joinListValue(items), "[프로젝트 홈, 프로젝트 전환]");
});

test("대괄호 목록 - 항목 0개는 []이고 키 줄은 남는다", () => {
  assert.equal(joinListValue([]), "[]");
  const doc = parseFrontmatterHead(FLAT_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "aliases");
  const rows = updateRow(doc.rows, index, { key: "aliases", value: joinListValue([]) });
  assert.equal(rows[index].raw, "aliases: []\n");
  assert.equal(rows.length, doc.rows.length); // 키 줄 자체는 지워지지 않는다
});

test("대괄호 밖 값의 콤마는 안 갈린다(결정 5)", () => {
  const doc = parseFrontmatterHead(BRACKET_LIST_HEAD);
  const row = doc.rows.find((r) => r.key === "description");
  assert.equal(row?.value, "cron이 분마다 띄우는 실행 단위 - 스크립트 w1.sh, 워크트리 w1");
  assert.equal(row?.value ? isBracketList(row.value) : true, false);
});

// 키 추천 · 값 검색 후보(결정 6·7) — 후보 원천 여섯(결정 8)을 한 벌로 묶은 픽스처.
// `objectTypes`·`linkTypes`·`typeProps`는 NESTED_HEAD/FLAT_HEAD(`type: 워커`)와 맞춘다.
function candidates(overrides: Partial<FrontmatterCandidates> = {}): FrontmatterCandidates {
  return {
    objectTypes: ["워커", "기능"],
    linkTypes: ["돌린다", "고친다", "검증한다", "우회한다", "불러온다"],
    objectNames: ["디스패치 루프", "큐"],
    personas: ["developer"],
    squads: ["default"],
    ticketHashes: ["abc12345"],
    typeProps: new Map([["워커", ["이름", "스크립트 경로", "워크트리 경로", "브랜치", ".dira 심링크 목표"]]]),
    ...overrides,
  };
}

test("키 추천 - 최상위 키는 그 파일 type: 이 가리키는 §Properties + 공통 키에서 이미 쓴 키를 뺀다(결정 6)", () => {
  const doc = parseFrontmatterHead(FLAT_HEAD); // type: 워커, name·aliases·tags 이미 있음
  const index = doc.rows.findIndex((r) => r.key === "aliases");
  const options = keyCandidates(doc.rows, index, candidates());
  assert.deepEqual(options, [
    "이름",
    "스크립트 경로",
    "워크트리 경로",
    "브랜치",
    ".dira 심링크 목표",
    "description",
    "links",
  ]);
});

test("키 추천 - links: 아래 관계타입 층은 링크 타입 5에서 그 층에 이미 쓴 것만 뺀다(결정 6)", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD); // links: 아래 돌린다·고친다 이미 있음
  const index = doc.rows.findIndex((r) => r.key === "돌린다");
  const options = keyCandidates(doc.rows, index, candidates());
  assert.deepEqual(options, ["검증한다", "우회한다", "불러온다"]);
});

test("키 추천 - 목록 항목의 라벨 키에는 추천이 없다", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "디스패치 루프");
  assert.deepEqual(keyCandidates(doc.rows, index, candidates()), []);
});

test("값 검색 - type: 은 객체 타입이 후보다(결정 7)", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "type");
  assert.deepEqual(valueCandidates(doc.rows, index, candidates()), ["워커", "기능"]);
});

test("값 검색 - links: 아래 대상 줄은 객체 이름이 후보다(결정 7)", () => {
  const doc = parseFrontmatterHead(NESTED_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "디스패치 루프");
  assert.deepEqual(valueCandidates(doc.rows, index, candidates()), ["디스패치 루프", "큐"]);
});

test("값 검색 - description: 같은 자유 문장 칸은 검색이 안 열린다(결정 7)", () => {
  const doc = parseFrontmatterHead(BRACKET_LIST_HEAD);
  const index = doc.rows.findIndex((r) => r.key === "description");
  assert.equal(valueCandidates(doc.rows, index, candidates()), null);
});
