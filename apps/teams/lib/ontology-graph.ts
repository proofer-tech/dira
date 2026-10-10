/** 온톨로지 지식 지도 — 그래프 조립과 힘 배치, 둘 다 순수 함수 (DESIGN.md P473 결정 2·4).
 *
 *  fs를 import하지 않는다. 호출자(서버 페이지)가 트리와 `.md` 본문을 읽어 넘기고, 여기는
 *  노드·간선·범례 문자열만 만든다. 관계 줄 판정은 `parseObject`, 이름 해석은 `buildVault`를
 *  그대로 쓴다 — 두 번째 파서·해석기는 없다. */
import { isDiraFormat, parseObject } from "./ontology.ts";
import { buildVault } from "./markdown-wikilinks.ts";

export type GraphNodeKind = "object" | "doc" | "note" | "plain";
export type GraphNode = {
  id: number;
  /** 트리 상대경로 - 노드를 눌렀을 때 `?file=`에 실리는 값이다. 화면 글자가 아니다 */
  file: string;
  label: string;
  kind: GraphNodeKind;
  /** kind가 object일 때 타입 이름 */
  type?: string;
  description?: string;
  /** 들고나는 간선 수 - 노드 크기 */
  degree: number;
  /** 관계 간선 수(들고나는 것 합) - 카드의 관계 수 */
  relationCount: number;
};
export type GraphEdge = {
  source: number;
  target: number;
  kind: "relation" | "mention";
  /** 관계 타입 이름(relation일 때) */
  relation?: string;
  directed: boolean;
};
export type OntologyGraph = {
  flat: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  legend: {
    types: { name: string; meaning: string; count: number }[];
    relations: { name: string; meaning: string }[];
    /** `문서` 노드 수 - 한 줄 뜻은 화면의 i18n이 쓴다 */
    docs: number;
    /** 숨김이 기본인 `그 밖의 노트` 수 */
    notes: number;
    mentions: number;
  };
};
export type GraphFile = { rel: string; text: string };

/** 첫 번째 `---` 블록의 평평한 `키: 값` 하나. 따옴표는 벗긴다. */
function fmScalar(text: string, key: string): string | undefined {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return undefined;
    const m = lines[i].match(/^([^\s:][^:]*):\s*(.*)$/);
    if (m && m[1].trim() === key) {
      const v = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      return v || undefined;
    }
  }
  return undefined;
}

function stripFm(text: string): string[] {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return lines;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end === -1 ? lines : lines.slice(end + 1);
}

/** 본문 첫 문단 - 제목 줄은 건너뛰고 빈 줄이 오기 전까지를 공백으로 잇는다. */
function firstParagraph(text: string): string {
  const out: string[] = [];
  for (const raw of stripFm(text)) {
    const s = raw.trim();
    if (!s || s.startsWith("#")) {
      if (out.length) break;
      continue;
    }
    out.push(s);
  }
  return out.join(" ");
}

/** `SCHEMA.md` §객체 타입 표 -> (이름, `한 줄 뜻` 열). 열 위치는 머리 줄에서 찾는다. */
function schemaTypes(text: string): { name: string; meaning: string }[] {
  const rows: { name: string; meaning: string }[] = [];
  let inSection = false;
  let col = -1;
  for (const raw of text.split("\n")) {
    const s = raw.trim();
    if (s.startsWith("## ")) {
      inSection = s.slice(3).trim().startsWith("객체 타입");
      col = -1;
      continue;
    }
    if (!inSection || !s.startsWith("|")) continue;
    const cells = s.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "이름") {
      col = cells.indexOf("한 줄 뜻");
      continue;
    }
    if (!cells[0] || /^[-:]+$/.test(cells[0])) continue;
    rows.push({ name: cells[0], meaning: col >= 0 ? (cells[col] ?? "") : "" });
  }
  return rows;
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;

function linkTargets(text: string): string[] {
  return [...text.matchAll(WIKILINK)].map((m) => m[1].split("|")[0].trim().replace(/\.md$/, ""));
}

export function buildOntologyGraph(input: { tree: { rel: string; isDir: boolean }[]; files: GraphFile[] }): OntologyGraph {
  const dira = isDiraFormat(input.tree);
  const textOf = new Map(input.files.map((f) => [f.rel, f.text]));
  const vault = buildVault(input.tree, (rel) => rel);
  const nodes: GraphNode[] = [];
  const idOf = new Map<string, number>();

  const mdFiles = input.tree.filter((e) => !e.isDir && e.rel.endsWith(".md")).map((e) => e.rel).sort();
  for (const rel of mdFiles) {
    const text = textOf.get(rel) ?? "";
    const base = rel.split("/").pop()!.replace(/\.md$/, "");
    let kind: GraphNodeKind = "plain";
    let type: string | undefined;
    if (dira) {
      const seg = rel.split("/");
      if (rel.startsWith("_ontology/") || rel.startsWith("action-log/")) continue;
      if (seg[0] === "objects" && seg.length >= 3) {
        kind = "object";
        type = seg[1];
      } else if (seg[0] === "object-views") kind = "doc";
      else kind = "note";
    }
    idOf.set(rel, nodes.length);
    nodes.push({
      id: nodes.length,
      file: rel,
      label: (kind === "object" && fmScalar(text, "name")) || base,
      kind,
      type,
      description: kind === "plain" ? undefined : fmScalar(text, "description"),
      degree: 0,
      relationCount: 0,
    });
  }

  // 이름 -> 노드. 풀리지 않거나 노드가 없는 파일(_ontology, action-log)을 가리키면 undefined.
  const resolve = (name: string): number | undefined => {
    const href = vault[name];
    return href === undefined ? undefined : idOf.get(href);
  };

  const relations = new Map<string, GraphEdge>();
  const relPairs = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "object") continue;
    for (const [rname, target] of parseObject(textOf.get(node.file) ?? "").rels) {
      const to = resolve(target.replace(/\.md$/, ""));
      if (to === undefined || to === node.id) continue;
      const key = `${node.id}>${to}>${rname}`;
      if (relations.has(key)) continue;
      relations.set(key, { source: node.id, target: to, kind: "relation", relation: rname, directed: true });
      relPairs.add(`${Math.min(node.id, to)}-${Math.max(node.id, to)}`);
    }
  }

  const mentions = new Map<string, GraphEdge>();
  for (const node of nodes) {
    for (const name of linkTargets(textOf.get(node.file) ?? "")) {
      const to = resolve(name);
      if (to === undefined || to === node.id) continue;
      const pair = `${Math.min(node.id, to)}-${Math.max(node.id, to)}`;
      if (relPairs.has(pair) || mentions.has(pair)) continue;
      mentions.set(pair, { source: node.id, target: to, kind: "mention", directed: false });
    }
  }

  const edges = [...relations.values(), ...mentions.values()];
  for (const e of edges) {
    nodes[e.source].degree++;
    nodes[e.target].degree++;
    if (e.kind === "relation") {
      nodes[e.source].relationCount++;
      nodes[e.target].relationCount++;
    }
  }

  if (!dira) {
    return { flat: true, nodes, edges, legend: { types: [], relations: [], docs: 0, notes: 0, mentions: 0 } };
  }

  const typeCount = new Map<string, number>();
  for (const n of nodes) if (n.type) typeCount.set(n.type, (typeCount.get(n.type) ?? 0) + 1);
  const types = schemaTypes(textOf.get("_ontology/SCHEMA.md") ?? "").map((t) => ({ ...t, count: typeCount.get(t.name) ?? 0 }));
  const known = new Set(types.map((t) => t.name));
  for (const [name, count] of typeCount) if (!known.has(name)) types.push({ name, meaning: "", count });

  const relNames = [...new Set(edges.flatMap((e) => (e.relation ? [e.relation] : [])))].sort();
  return {
    flat: false,
    nodes,
    edges,
    legend: {
      types,
      relations: relNames.map((name) => ({ name, meaning: firstParagraph(textOf.get(`_ontology/link-types/${name}.md`) ?? "") })),
      docs: nodes.filter((n) => n.kind === "doc").length,
      notes: nodes.filter((n) => n.kind === "note").length,
      mentions: edges.filter((e) => e.kind === "mention").length,
    },
  };
}

/** 시드 고정 난수(mulberry32) - 같은 시드면 같은 수열이다. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Point = { x: number; y: number };

/** 초기 좌표 - 반지름 100 안의 시드 난수 점. */
export function initialLayout(n: number, seed = 1): Point[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 100;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d };
  });
}

/** 힘 한 걸음: 반발(전 쌍) + 간선 스프링 + 중심 당김. `alpha`는 식는 정도(1 -> 0)이고 `pinned`
 *  노드는 안 움직인다(끌기). ponytail: 반발이 O(n^2)다 - 300 노드는 실측 통과, 수천이면 격자 근사. */
export function stepLayout(pos: Point[], edges: [number, number][], alpha: number, pinned?: Set<number>): void {
  const n = pos.length;
  const K = 60; // 이상 간선 길이
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let ex = pos[i].x - pos[j].x;
      let ey = pos[i].y - pos[j].y;
      let d2 = ex * ex + ey * ey;
      if (d2 < 0.01) {
        ex = (i - j) * 0.1;
        ey = 0.1;
        d2 = ex * ex + ey * ey;
      }
      const f = (K * K) / d2; // 반발 = K^2 / d, 단위벡터 곱하면 / d^2
      dx[i] += ex * f;
      dy[i] += ey * f;
      dx[j] -= ex * f;
      dy[j] -= ey * f;
    }
  }
  for (const [a, b] of edges) {
    const ex = pos[a].x - pos[b].x;
    const ey = pos[a].y - pos[b].y;
    const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
    const f = d / K; // 스프링 = d^2 / K, 단위벡터 곱하면 d / K
    dx[a] -= ex * f;
    dy[a] -= ey * f;
    dx[b] += ex * f;
    dy[b] += ey * f;
  }
  const maxMove = 30 * alpha + 0.5;
  for (let i = 0; i < n; i++) {
    if (pinned?.has(i)) continue;
    dx[i] -= pos[i].x * 0.05; // 중심 당김
    dy[i] -= pos[i].y * 0.05;
    const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
    const m = Math.min(len, maxMove) / len;
    pos[i].x += dx[i] * m;
    pos[i].y += dy[i] * m;
  }
}

/** 수렴한 좌표. 같은 입력 + 같은 시드면 같은 좌표다. */
export function layoutGraph(
  n: number,
  edges: [number, number][],
  opts: { seed?: number; iterations?: number } = {},
): Point[] {
  const iterations = opts.iterations ?? 300;
  const pos = initialLayout(n, opts.seed ?? 1);
  for (let it = 0; it < iterations; it++) stepLayout(pos, edges, 1 - it / iterations);
  return pos;
}
