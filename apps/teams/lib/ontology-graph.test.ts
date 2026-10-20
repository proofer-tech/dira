import { test } from "node:test";
import assert from "node:assert";
import { buildOntologyGraph, layoutGraph, stepLayout, nextAlpha, DRAG_ALPHA } from "./ontology-graph.ts";

const SCHEMA = `## 객체 타입

| 이름 | 한 줄 뜻 | 정의 |
|---|---|---|
| 사람 | 일하는 사람이다 | [[사람]] |
| 도구 | 쓰는 [[물건]]이다 | [[도구]] |
| 티켓 | 인스턴스를 \`objects/\`에 안 세운다 | [[티켓]] |

## 관계 타입

| 이름 | 정의역 → 치역 |
|---|---|
| 쓴다 | 사람 → 도구 |
`;

const fm = (type: string, name: string, links = "", body = "") =>
  `---\ntype: ${type}\nname: ${name}\ndescription: ${name} 설명\n${links ? `links:\n${links}\n` : ""}---\n${body}\n`;

const files: Record<string, string> = {
  "_ontology/SCHEMA.md": SCHEMA,
  "_ontology/link-types/쓴다.md": "---\nname: 쓴다\n---\n# 쓴다\n\n사람이 도구를 쓴다.\n두 번째 줄.\n\n다음 문단.\n",
  "objects/사람/가나.md": fm("사람", "가나다", '  쓴다:\n    - "[[망치]]"', "본문 [[망치]] [[없는이름]] [[가나]] [[개요]] [[2026-01-01]]"),
  "objects/도구/망치.md": fm("도구", "망치", "", "본문 [[가나]]"),
  "object-views/개요.md": "여러 개를 모은다 [[가나]] [[망치]]\n",
  "action-log/2026-01-01.md": "- 10:00 새객체: [[가나]]\n",
  "benchmark/메모.md": "[[망치]]\n",
};
const tree = [
  ...["_ontology", "_ontology/link-types", "objects", "objects/사람", "objects/도구", "object-views", "action-log", "benchmark"].map((rel) => ({ rel, isDir: true })),
  ...Object.keys(files).map((rel) => ({ rel, isDir: false })),
];
const input = { tree, files: Object.entries(files).map(([rel, text]) => ({ rel, text })) };

test("dira 형식: 노드 종류와 간선 종류가 결정 2 표대로다", () => {
  const g = buildOntologyGraph(input);
  assert.equal(g.flat, false);
  const byFile = Object.fromEntries(g.nodes.map((n) => [n.file, n]));
  assert.equal(byFile["objects/사람/가나.md"].kind, "object");
  assert.equal(byFile["objects/사람/가나.md"].label, "가나다");
  assert.equal(byFile["objects/사람/가나.md"].type, "사람");
  assert.equal(byFile["object-views/개요.md"].kind, "doc");
  assert.equal(byFile["benchmark/메모.md"].kind, "note");
  assert.ok(!g.nodes.some((n) => n.file.startsWith("_ontology/") || n.file.startsWith("action-log/")));
  const id = (f: string) => byFile[f].id;
  const rel = g.edges.filter((e) => e.kind === "relation");
  assert.deepEqual(rel.map((e) => [e.source, e.target, e.relation, e.directed]), [[id("objects/사람/가나.md"), id("objects/도구/망치.md"), "쓴다", true]]);
  // 가나-망치: 관계가 있어 언급은 버려진다(양방향 언급도 하나로). 해석 불가 - 자기 링크 - action-log 대상은 없다.
  const mentions = g.edges.filter((e) => e.kind === "mention");
  assert.equal(mentions.filter((e) => [e.source, e.target].every((x) => x === id("objects/사람/가나.md") || x === id("objects/도구/망치.md"))).length, 0);
  assert.equal(mentions.length, 3); // 개요-가나, 개요-망치, 메모-망치
  assert.ok(mentions.every((e) => !e.directed));
  assert.equal(byFile["objects/사람/가나.md"].degree, 2);
  assert.equal(byFile["objects/사람/가나.md"].relationCount, 1);
});

test("범례는 SCHEMA 표와 link-type 첫 문단에서 오고 예약 폴더 이름이 없다", () => {
  const g = buildOntologyGraph(input);
  assert.deepEqual(g.legend.types, [
    { name: "사람", meaning: "일하는 사람이다", count: 1, order: 0 },
    { name: "도구", meaning: "쓰는 물건이다", count: 1, order: 1 }, // 인스턴스 0인 티켓은 범례에 없다 - 뜻의 [[ ]]-백틱도 벗겨진다
  ]);
  assert.deepEqual(g.legend.relations, [{ name: "쓴다", meaning: "사람이 도구를 쓴다. 두 번째 줄." }]);
  assert.equal(g.legend.docs, 1);
  assert.equal(g.legend.notes, 1);
  const shown = JSON.stringify([g.legend, g.nodes.map((n) => [n.label, n.type, n.description])]);
  for (const word of ["objects", "object-views", "_ontology", "action-log"]) assert.ok(!shown.includes(word), word);
});

test("dira 형식이 아니면 평평한 그래프다", () => {
  const g = buildOntologyGraph({
    tree: [{ rel: "a.md", isDir: false }, { rel: "d", isDir: true }, { rel: "d/b.md", isDir: false }],
    files: [{ rel: "a.md", text: "[[b]] [[a]]" }, { rel: "d/b.md", text: "[[a]]" }],
  });
  assert.equal(g.flat, true);
  assert.deepEqual(g.nodes.map((n) => n.kind), ["plain", "plain"]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].directed, false);
  assert.deepEqual(g.legend.types, []);
});

test("배치는 같은 시드면 같은 좌표이고 시드가 다르면 다르다", () => {
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
  const a = layoutGraph(3, edges, { seed: 7 });
  assert.deepEqual(a, layoutGraph(3, edges, { seed: 7 }));
  assert.notDeepEqual(a, layoutGraph(3, edges, { seed: 8 }));
  assert.ok(a.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("300 노드 - 1000 간선 배치가 3초 안에 끝난다", () => {
  const edges: [number, number][] = [];
  let s = 1;
  while (edges.length < 1000) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const a = s % 300;
    s = (s * 1103515245 + 12345) % 2147483648;
    const b = s % 300;
    if (a !== b) edges.push([a, b]);
  }
  // 병렬로 도는 다른 테스트에 시계가 늘어나지 않게 CPU 시간으로 잰다.
  const c0 = process.cpuUsage();
  const pos = layoutGraph(300, edges);
  const c = process.cpuUsage(c0);
  const ms = (c.user + c.system) / 1000;
  console.log(`layout 300x1000: ${ms.toFixed(0)}ms cpu`);
  assert.ok(ms < 3000);
  assert.ok(pos.every((p) => Number.isFinite(p.x)));
});

// 지식 지도 끌기 - 화면(ontology-map.tsx)과 같은 인자: 끌기 중 alpha는 DRAG_ALPHA를 향해 오르고, 놓으면 0을 향해 식는다.
test("끌기 중 지도가 떨리지 않고 놓은 뒤 3초 안에 멈춘다", () => {
  const edges: [number, number][] = [];
  let s = 1;
  while (edges.length < 1000) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const a = s % 300;
    s = (s * 1103515245 + 12345) % 2147483648;
    const b = s % 300;
    if (a !== b) edges.push([a, b]);
  }
  const pos = layoutGraph(300, edges);
  const vel = pos.map(() => ({ x: 0, y: 0 }));
  // 노드 0에서 간선 두 단계 안
  const near = new Set([0]);
  for (let k = 0; k < 2; k++) for (const [a, b] of edges) {
    if (near.has(a)) near.add(b);
    if (near.has(b)) near.add(a);
  }
  const pinned = new Set([0]);
  pos[0] = { x: pos[0].x + 50, y: pos[0].y };
  let alpha = 0;
  let prev = pos.map((p) => ({ ...p }));
  const prevMove = pos.map(() => ({ x: 0, y: 0 }));
  let moved = 0, reversed = 0, farMax = 0;
  for (let step = 0; step < 60; step++) {
    alpha = nextAlpha(alpha, DRAG_ALPHA);
    stepLayout(pos, edges, alpha, pinned, vel);
    for (let i = 1; i < 300; i++) {
      const mx = pos[i].x - prev[i].x, my = pos[i].y - prev[i].y;
      const len = Math.hypot(mx, my);
      if (!near.has(i)) farMax = Math.max(farMax, len);
      if (step > 0 && len > 0.5) {
        moved++;
        if (mx * prevMove[i].x + my * prevMove[i].y < 0) reversed++;
      }
      prevMove[i] = { x: mx, y: my };
    }
    prev = pos.map((p) => ({ ...p }));
  }
  console.log(`drag: moved>0.5=${moved} reversed=${reversed} farMax=${farMax.toFixed(2)}`);
  assert.ok(reversed <= moved * 0.05, `방향 반전 ${reversed}/${moved}`);
  assert.ok(farMax <= 1, `먼 노드 최대 이동 ${farMax}`);
  pinned.clear();
  let last = Infinity;
  for (let step = 0; step < 180; step++) {
    alpha = nextAlpha(alpha, 0);
    const before = pos.map((p) => ({ ...p }));
    stepLayout(pos, edges, alpha, pinned, vel);
    last = Math.max(...pos.map((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y)));
  }
  console.log(`release: 180걸음째 최대 이동 ${last.toFixed(4)}px`);
  assert.ok(last < 0.1);
});
