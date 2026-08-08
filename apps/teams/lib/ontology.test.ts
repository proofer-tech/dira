import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { computeOntologyMetrics } from "./ontology.ts";

const SCHEMA = `## 객체 타입

| 이름 | 필수 속성 | 뜻 |
|---|---|---|
| 사람 | 이름 · 나이 | 사람 객체 |
| 동물 | - | 동물 객체 |

## 관계 타입

| 이름 | 정의역 → 치역 |
|---|---|
| 안다 | 사람 → 사람 |
`;

test("숨은 간선 — 서술 링크가 관계 줄에 대응 없으면 잡힌다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: "철수는 [[영희]]를 언급한다.\n- 이름: 철수\n- 나이: 20\n" },
      { rel: "objects/사람/영희.md", text: "영희다.\n- 이름: 영희\n- 나이: 22\n" },
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
      { rel: "objects/사람/철수.md", text: "철수는 [[영희]]를 언급한다.\n- 이름: 철수\n- 나이: 20\n" },
      { rel: "objects/사람/영희.md", text: "영희다.\n- 이름: 영희\n- 나이: 22\n- 안다: [[철수]]\n" },
    ],
    actionLogs: [],
  });
  assert.equal(m.hiddenEdges.count, 0);
});

test("스키마 위반 — 미정의 타입 · 미정의 관계 · 댕글링 · 정의역/치역 · 필수 속성 누락을 모두 잡는다", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      // 미정의 타입 + 미정의 관계 + 댕글링(허깨비 없음)
      { rel: "objects/미정의타입/유령.md", text: "유령이다.\n- 미정의관계: [[허깨비]]\n" },
      // 정의역/치역 위반: 안다는 사람→사람인데 대상이 동물
      { rel: "objects/사람/철수.md", text: "철수다.\n- 이름: 철수\n- 나이: 20\n- 안다: [[멍멍이]]\n" },
      { rel: "objects/동물/멍멍이.md", text: "멍멍이다.\n" },
      // 필수 속성 누락(이름·나이 둘 다 없음)
      { rel: "objects/사람/짱구.md", text: "짱구다.\n" },
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

test("껍데기 · 고립", () => {
  const m = computeOntologyMetrics({
    schemaText: SCHEMA,
    objects: [
      { rel: "objects/사람/철수.md", text: "철수다.\n- 이름: 철수\n" }, // 속성 1개 = 껍데기, 관계 0 + 들어오는 관계 0 = 고립
      { rel: "objects/사람/영희.md", text: "영희다.\n- 이름: 영희\n- 나이: 22\n- 안다: [[철수]]\n" },
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
      { rel: "objects/사람/철수.md", text: "철수다.\n- 이름: 철수\n- 나이: 20\n" },
      { rel: "objects/사람/영희.md", text: "영희다.\n- 이름: 영희\n- 나이: 22\n- 안다: [[철수]]\n" },
    ],
    actionLogs: [],
  });
  assert.deepEqual(m.backlinks["철수"], ["영희"]);
  assert.deepEqual(m.backlinks["영희"], []);
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
    objects: [{ rel: "objects/사람/철수.md", text: "철수다.\n- 이름: 철수\n- 나이: 20\n" }],
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

// 패리티 — dira 큐 자신의 온톨로지를 두 검사기(이 파일이 옮겨온 것과 원본 ont-check.py)에
// 같이 돌려 숫자가 갈리지 않는지 못박는다(§Goal "새로 만들면 숫자가 갈린다"). 원본은 이 레포
// 밖(hsol.info 블롭)에 있어 다른 환경엔 없을 수 있다 — 없으면 건너뛴다.
test("패리티 — ont-check.py와 dira 큐에서 같은 숫자가 나온다", (t) => {
  const ONT_CHECK = "/Users/hsol/Projects/hsol.info/hsol-info-blob/ontology-builder/kit/lint/ont-check.py";
  const QUEUE_ONTOLOGY = path.join(import.meta.dirname, "../../../.dira/ontology");
  if (!existsSync(ONT_CHECK) || !existsSync(QUEUE_ONTOLOGY)) {
    t.skip("원본 ont-check.py 또는 dira 큐 온톨로지가 이 환경엔 없다");
    return;
  }

  const schemaText = readFileSync(path.join(QUEUE_ONTOLOGY, "SCHEMA.md"), "utf8");
  const objectsDir = path.join(QUEUE_ONTOLOGY, "objects");
  const objects = readdirSync(objectsDir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => {
      const full = path.join(d.parentPath, d.name);
      return { rel: path.relative(QUEUE_ONTOLOGY, full), text: readFileSync(full, "utf8") };
    });

  const mine = computeOntologyMetrics({ schemaText, objects, actionLogs: [] });

  let stdout: string;
  try {
    stdout = execFileSync("python3", [ONT_CHECK, QUEUE_ONTOLOGY], { encoding: "utf8" });
  } catch (e) {
    stdout = (e as { stdout: string }).stdout; // 검사기는 오류가 있으면 exit 1 — 그래도 stdout에 요약이 있다
  }

  const summary = stdout.match(/객체 (\d+) \/ 관계 (\d+) \/ 서술링크 (\d+)/);
  const rates = stdout.match(/숨은 간선 (\d+)건.*규범 문장 (\d+)건.*껍데기 (\d+)건.*고립 (\d+)건/);
  assert.ok(summary && rates, `ont-check.py 출력 형식이 바뀌었다:\n${stdout}`);

  assert.equal(mine.objectCount, Number(summary[1]));
  assert.equal(mine.relationCount, Number(summary[2]));
  assert.equal(mine.proseLinkCount, Number(summary[3]));
  assert.equal(mine.hiddenEdges.count, Number(rates[1]));
  assert.equal(mine.normativeSentences.count, Number(rates[2]));
  assert.equal(mine.shells.count, Number(rates[3]));
  assert.equal(mine.isolated.count, Number(rates[4]));
});
