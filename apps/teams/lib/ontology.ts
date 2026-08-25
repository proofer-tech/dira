/** 온톨로지 검사·지표 — 순수 함수 (DESIGN.md §5-3 §온톨로지 빌더 §지표).
 *
 *  판정은 `ontology-builder/kit/lint/ont-check.py`(dira 형식 검사기)를 그대로 옮긴 것이다.
 *  새로 만들면 숨은 간선·규범 문장 같은 수치가 그 스크립트와 갈린다 — 특히 «값이 통째로
 *  wikilink 하나인 줄»만 관계 줄로 인정하는 판정(`parseObject`)이 재측정 수치의 전제다.
 *
 *  fs 모듈을 import하지 않는다 — 읽기는 호출자가 `lib/protocols.ts`로 하고, 여기는 이미 읽은
 *  텍스트만 받는다. 그래야 `node --test`로 이 판정 하나만 떼어 검증할 수 있다. */

/** dira 형식 판정(§5-3 §온톨로지 자리를 워커가 재정의한다 §결정 3) — `_ontology/SCHEMA.md`와
 *  `objects/` 둘 다 없으면 형식이 아니다. 하나라도 있으면 선 것이고, 그 뒤는 종전 지표-검사
 *  그대로다(반쪽인 것은 `schemaViolations`가 이미 알려 준다). 호출자(`page.tsx`)는 이 값이
 *  거짓이면 `computeOntologyMetrics`를 아예 안 부른다 — 위반 수백 줄이 <폴더가 망가졌다>로
 *  안 읽히게. */
export function isDiraFormat(tree: { rel: string; isDir: boolean }[]): boolean {
  const hasSchema = tree.some((e) => !e.isDir && e.rel === "_ontology/SCHEMA.md");
  const hasObjects = tree.some((e) => e.rel === "objects" || e.rel.startsWith("objects/"));
  return hasSchema || hasObjects;
}

const NORMATIVE = /(해야 한다|하는 게 낫다|하지 않는다|하지 말|권장한다|바람직하다|해야만|짚고 넘어가)/;

/** 문장 경계를 `.!?` 뒤 공백·문자열 끝으로 어림한다 — 규범 문장 검출과 같은 정밀도(§5-3 §형식
 *  §④). 파일 경로·버전 번호 안의 마침표(`tick.sh`·`4.3.0`)는 뒤에 공백이 안 붙어 안 걸린다. */
const SENTENCE_END = /[.!?](?=\s|$)/g;

function sentenceCount(prose: string[]): number {
  const text = prose.join(" ").trim();
  return text ? (text.match(SENTENCE_END) ?? []).length : 0;
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + sep.length)];
}

/** 다중값 셀의 구분자는 `·`와 `,` 둘 다다 — 실 SCHEMA.md 관계 표가 `에이전트, 엔진 → 엔진`
 *  처럼 쉼표로 적는다. `·`만 갈랐을 때는 정의역이 `"에이전트, 엔진"` 한 덩어리가 돼 멤버십
 *  검사가 전건 실패했다(`cc5bb157` — 원소 하나만 쓴 링크가 전부 위반으로 나왔다). */
function toSet(cell: string): Set<string> {
  return new Set(
    cell
      .split(/[·,]/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

type Signature = { from: Set<string>; to: Set<string> };

/** `'A · B → C'` 또는 `'A → B · C → D'`를 페어 목록으로. 화살표 개수로 두 표기를 가른다
 *  (ont-check.py `parse_signature`와 동일 — 단, 셀 끝의 ` — <설명>`(또는 ` - <설명>`) 꼬리는
 *  여기서 먼저 뗀다. ont-check.py는 이 꼬리를 안 떼 정의역·치역 판정이 전건 오탐이었다,
 *  `4657d628`. 하이픈 표기는 `b8e04f56` — 특수문자 표기 통일 후 실 문서가 이 모양을 쓴다). */
const SIGNATURE_TAIL = / — | - /;
function parseSignature(cellInput: string): Signature[] {
  const cell = cellInput.split(SIGNATURE_TAIL)[0].replaceAll("->", "→");
  const arrowCount = (cell.match(/→/g) ?? []).length;
  const chunks = arrowCount > 1 ? cell.split("·").filter((c) => c.includes("→")) : [cell];
  if (chunks.length > 1) {
    return chunks.map((c) => {
      const [l, r] = splitOnce(c, "→");
      return { from: toSet(l), to: toSet(r) };
    });
  }
  const [l, r] = splitOnce(cell, "→");
  return [{ from: toSet(l), to: toSet(r) }];
}

type Schema = {
  types: Set<string>;
  relTypes: Map<string, Signature[]>;
};

const TABLE_RULE = /^[-:]+$/;

/** `SCHEMA.md` 파싱. 파일이 비었거나 없으면(호출자가 빈 문자열을 준다) 둘 다 빈 채로 반환한다
 *  — ont-check.py는 이 경우 FATAL로 종료하지만, 뷰어는 계속 그려야 하므로 이후 판정에서
 *  `types.size > 0` 게이트로 "스키마 미확보"와 "실제 위반"을 가른다. */
function parseSchema(text: string): Schema {
  const types = new Set<string>();
  const relTypes = new Map<string, Signature[]>();
  let section: string | null = null;

  for (const raw of text.split("\n")) {
    const s = raw.trim();
    if (s.startsWith("## ")) {
      section = s.slice(3).trim();
      continue;
    }
    const cells = s.startsWith("|") ? s.split("|").slice(1, -1).map((c) => c.trim()) : [];
    if (cells.length === 0) continue;
    const name = cells[0];
    if (name === "이름" || name === "---" || (name.length > 0 && TABLE_RULE.test(name))) continue;

    if (section?.startsWith("객체 타입")) {
      types.add(name);
    } else if (section?.startsWith("관계 타입")) {
      const sig = cells.slice(1).find((c) => c.includes("→") || c.includes("->")) ?? "";
      relTypes.set(name, sig ? parseSignature(sig) : []);
    }
  }
  return { types, relTypes };
}

/** `_ontology/object-types/<타입>.md`의 §Properties 표(`필수` 열 ✅ 행의 `이름`)에서 타입별
 *  필수 속성을 읽는다(P224 — 지도 `SCHEMA.md`가 아니라 타입 파일이 정본. §속성은 값을 든다와
 *  같은 근거로 지도엔 이 열을 안 되살린다). 타입 파일이 없거나 §Properties 절이 없으면 그
 *  타입은 목록에 없다 — 호출자가 `required.get(type) ?? []`로 무판정을 받는다. */
function parseRequiredProps(typeFiles: ObjectInput[]): Map<string, string[]> {
  const required = new Map<string, string[]>();
  for (const file of typeFiles) {
    const type = file.rel.split("/").pop()?.replace(/\.md$/, "") ?? "";
    if (!type) continue;
    const names: string[] = [];
    let inProperties = false;
    for (const raw of file.text.split("\n")) {
      const s = raw.trim();
      if (s.startsWith("## ")) {
        inProperties = s.slice(3).trim() === "Properties";
        continue;
      }
      if (!inProperties) continue;
      const cells = s.startsWith("|") ? s.split("|").slice(1, -1).map((c) => c.trim()) : [];
      if (cells.length < 3) continue;
      const name = cells[0];
      if (name === "이름" || TABLE_RULE.test(name)) continue;
      if (cells[2] === "✅") names.push(name.replace(/^`+|`+$/g, ""));
    }
    required.set(type, names);
  }
  return required;
}

type ParsedObject = { prose: string[]; rels: [string, string][]; props: string[]; hasSection: boolean };

const ATTR_LINE = /^-\s*([^:]+):\s*(.*)$/;
const WIKILINK_ONLY = /^\[\[([^\]]+)\]\]$/;
const WIKILINK_ANY = /\[\[([^\]|]+)/;

/** frontmatter가 모든 타입에 공통으로 두는 다섯 키(`protocols/ontology.md` §4) — 형식
 *  보일러플레이트라 속성 카운트(껍데기·필수 속성 판정)에서 뺀다. 안 빼면 모든 객체가 항상
 *  ≥5속성이라 «속성 2개 미만 = 껍데기» 판정이 죽는다. */
const COMMON_FM_KEYS = new Set(["type", "name", "aliases", "tags", "description"]);

/** frontmatter YAML 블록(속성 평평하게 · `links:` 아래 `<관계타입>: - <라벨>: "[[대상]]"`)만 읽는
 *  좁은 파서다 — 일반 YAML이 아니라 `protocols/ontology.md` §4 템플릿 한 모양만 안다(YAML 라이브러리
 *  금지, `apps/teams/AGENTS.md` §의존성 근거 — `tickets.py`가 정규식이라 파서를 쓰면 판정이 갈린다).
 *  들여쓰기 2칸 = `links:` 아래 관계타입 키, 4칸 = 그 관계의 대상 목록 줄. */
function parseFrontmatter(fmLines: string[], props: string[], rels: [string, string][]): void {
  let topIsLinks = false;
  let relType: string | null = null;
  let relIndent = Infinity;

  for (const raw of fmLines) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (indent === 0) {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      topIsLinks = key === "links";
      relType = null;
      relIndent = Infinity;
      if (!topIsLinks && !COMMON_FM_KEYS.has(key)) props.push(key);
      continue;
    }

    if (!topIsLinks) continue; // 링크가 아닌 키의 목록 연속 줄 — 이미 위에서 속성 하나로 셌다

    if (!line.startsWith("-")) {
      // 목록 항목보다 깊게 들어간 키는 관계 이름이 아니라 그 항목의 «링크 속성»이다
      // (`경유`·`무엇`·`방향` — SCHEMA.md 관계 표의 세 번째 열). 이걸 관계 이름으로 잡으면
      // 항목이 둘 이상인 관계에서 둘째 항목부터 «미정의 관계»가 났다(`cc5bb157`).
      if (indent > relIndent) continue;
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        relType = m[1].trim();
        relIndent = indent;
      }
      continue;
    }
    if (relType) {
      const link = line.match(WIKILINK_ANY);
      if (link) rels.push([relType, link[1].trim()]);
    }
  }
}

/** 객체 파일 한 장 → (서술줄들, 관계 줄, 속성 줄, `##` 절 존재). frontmatter가 있으면(첫 줄이
 *  `---`) 속성·관계는 거기서 읽는다(P219-6 이행 후 형식 — `parseFrontmatter`). 나머지 본문은
 *  종전대로 훑는다 — 값이 통째로 `[[wikilink]]` 하나인 `- 키: 값` 줄만 관계, 나머지는 속성이다
 *  (구 3층 형식 잔존 대비, ont-check.py `parse_object`와 같은 판정). */
function parseObject(text: string): ParsedObject {
  const prose: string[] = [];
  const rels: [string, string][] = [];
  const props: string[] = [];
  let hasSection = false;

  const lines = text.split("\n");
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end !== -1) {
      parseFrontmatter(lines.slice(1, end), props, rels);
      bodyStart = end + 1;
    }
  }

  for (const raw of lines.slice(bodyStart)) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith("## ")) {
      hasSection = true;
      continue;
    }
    const m = s.match(ATTR_LINE);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      const link = val.match(WIKILINK_ONLY);
      if (link) {
        rels.push([key, link[1].split("|")[0].trim()]);
      } else {
        props.push(key);
      }
    } else {
      prose.push(s);
    }
  }
  return { prose, rels, props, hasSection };
}

/** `objects/<타입>/<이름>.md` 상대경로(listTree 기준)에서 타입·이름을 뽑는다. */
function typeAndName(rel: string): { type: string; name: string } {
  const parts = rel.split("/");
  const name = parts[parts.length - 1]?.replace(/\.md$/, "") ?? "";
  const type = parts[parts.length - 2] ?? "";
  return { type, name };
}

export type ObjectInput = { rel: string; text: string };
export type ActionLogInput = { date: string; text: string };
export type OntologyInput = {
  schemaText: string;
  objects: ObjectInput[];
  actionLogs: ActionLogInput[];
  /** `object-views/<이름>.md` — 값을 안 드는 뷰라 parseObject 판정(타입·속성·`##` 절)은 안 걸고
   *  링크 해석만 한다(§메타모델). 없는 호출자는 생략해도 된다 */
  views?: ObjectInput[];
  /** `_ontology/object-types/<타입>.md` — 필수 속성의 정본(§Properties `필수` 열). 없는
   *  호출자는 생략해도 된다(모든 타입이 무판정) */
  typeFiles?: ObjectInput[];
};

export type Counted = { count: number; ratio: number; items: string[] };

export type OntologyMetrics = {
  objectCount: number;
  relationCount: number;
  proseLinkCount: number;
  /** 서술 안 `[[링크]]` 중 관계 줄에 대응이 없는 것 — 건강 0% */
  hiddenEdges: Counted;
  /** 서술의 판단·교훈 어미 검출 — 건강 0건 */
  normativeSentences: Pick<Counted, "count" | "items">;
  /** 서술이 한 문장뿐인 객체 — 판정이 아니라 표본 검토 대상을 좁히는 용도(§5-3 §형식 §④,
   *  규범 문장 검출과 같은 성격). 문장 경계는 `.!?` 뒤 공백·끝을 어림한다 — 정밀하지 않다 */
  singleSentenceProse: Counted;
  /** 속성 2개 미만 객체 — 낮을수록 건강 */
  shells: Counted;
  /** 관계 0개(들고나는 것 다 포함) 객체 — 낮을수록 건강 */
  isolated: Counted;
  /** `SCHEMA.md` 표 ↔ `objects/<타입>/` 대조 위반. 미정의 타입·관계·댕글링·`##`절·정의역치역·필수속성 */
  schemaViolations: string[];
  /** OOPS! 이식 — 관계 줄이 만드는 방향 그래프의 사이클. 건강 0건 */
  hierarchyCycles: Pick<Counted, "count" | "items">;
  /** OOPS! 이식 — 한 식별자가 속성과 관계 두 역할로 쪼개 쓰인 자리. 건강 0건 */
  polysemousElements: Pick<Counted, "count" | "items">;
  /** OOPS! 이식 — 인스턴스 0개인 스키마 타입. 건강 0건 */
  redundantClasses: Pick<Counted, "count" | "items">;
  /** 이름 → 나를 가리키는 이름들(역링크) */
  backlinks: Record<string, string[]>;
  /** `action-log`의 `빈손` 줄 비율 — 건강 30~70%, 10% 미만이면 경보 */
  emptyHanded: { count: number; total: number; ratio: number };
  /** `action-log`의 `새객체` 줄을 날짜별로 */
  objectTrend: { date: string; count: number }[];
  /** `action-log`의 `스키마개정` 줄을 날짜별로 — 안 꺾이면 사람이 들어오는 트리거 */
  schemaStability: { date: string; count: number }[];
  /** action-log 전체에서 가장 최근 줄의 `YYYY-MM-DD HH:MM` */
  lastUpdated: string | null;
};

const LINK = /\[\[([^\]]+)\]\]/g;

/** 뷰 본문의 `[[이름]]`이 실재하는 객체·뷰를 가리키는지 확인한다. 대상이 없으면 기존 객체
 *  댕글링과 같은 형식(`댕글링: <파일> -> [[대상]]`)으로 `schemaViolations`에 실어 표시를 재사용한다. */
type Parsed = { rel: string; type: string; name: string; props: string[]; rels: [string, string][] };

/** 계층 순환(OOPS!) — 관계 줄(관계 이름을 안 가리고 전부) 이 만드는 방향 그래프에 사이클이
 *  있는지를 DFS로 본다. 우리 스키마엔 «하위/상위» 전용 관계가 따로 없다 — 그래서 어느 관계든
 *  A → B 를 세우면 그 자체가 "상하위"고, 사이클은 어느 쪽이 위인지 정의되지 않는다는 뜻이다
 *  (§5-3 §지표). 사이클 하나를 여러 시작점에서 다시 찾는 중복은 노드 집합으로 정규화해 뺀다. */
function findHierarchyCycles(parsed: Pick<Parsed, "name" | "rels">[]): string[] {
  const adj = new Map<string, string[]>();
  for (const p of parsed) {
    for (const [, target] of p.rels) {
      if (!adj.has(p.name)) adj.set(p.name, []);
      adj.get(p.name)!.push(target);
    }
  }

  const color = new Map<string, 0 | 1 | 2>(); // 0 white · 1 gray(스택 위) · 2 black(끝)
  const stack: string[] = [];
  const seenCycles = new Set<string>();
  const cycles: string[] = [];

  function dfs(node: string) {
    color.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 0) {
        dfs(next);
      } else if (c === 1) {
        const idx = stack.indexOf(next);
        const path = [...stack.slice(idx), next];
        const key = [...new Set(path)].sort().join(">");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(`계층 순환: ${path.join(" → ")}`);
        }
      }
    }
    stack.pop();
    color.set(node, 2);
  }

  for (const name of adj.keys()) {
    if ((color.get(name) ?? 0) === 0) dfs(name);
  }
  return cycles;
}

/** 다의적 요소(OOPS!) — 판정이 기계로 딱 떨어지지 않아 표본 검토 대상만 좁힌다(티켓 참고).
 *  고른 휴리스틱: **같은 식별자가 한 객체에서는 속성 키로, 다른 객체에서는 관계 이름으로
 *  쓰인 자리** — 그 식별자가 "값"과 "링크"라는 서로 다른 개념을 동시에 가리키는 것이라
 *  OOPS! 원문의 "식별자 하나가 여러 개념을 가리킨다"와 가장 가깝다. 정의역·치역 위반과는
 *  다르다 — 그건 이름 하나의 대상 타입이 스키마를 벗어난 경우고, 이건 이름 자체가
 *  속성/관계 두 역할로 쪼개진 경우다. */
function findPolysemousElements(parsed: Pick<Parsed, "rel" | "props" | "rels">[]): string[] {
  const asProp = new Map<string, string[]>();
  const asRel = new Map<string, string[]>();
  for (const p of parsed) {
    for (const key of p.props) {
      if (!asProp.has(key)) asProp.set(key, []);
      asProp.get(key)!.push(p.rel);
    }
    for (const [key] of p.rels) {
      if (!asRel.has(key)) asRel.set(key, []);
      asRel.get(key)!.push(p.rel);
    }
  }

  const items: string[] = [];
  for (const [key, propLocs] of [...asProp].sort(([a], [b]) => a.localeCompare(b))) {
    const relLocs = asRel.get(key);
    if (relLocs) {
      items.push(
        `다의적 요소: '${key}' — 속성으로 쓴 곳 ${propLocs.join(", ")} / 관계로 쓴 곳 ${relLocs.join(", ")}`,
      );
    }
  }
  return items;
}

/** 잉여 클래스(OOPS!) — 인스턴스도 하위 타입도 0인 타입. 우리 스키마엔 타입 간 상하위(서브클래스)
 *  개념이 없다(§5-3 §온톨로지 프레임워크 §객체 타입) — 그래서 "하위 타입 수"는 모든 타입에서
 *  정의상 항상 0이고, 판정은 인스턴스 0개 여부로 좁혀진다. `types.size === 0`(스키마 미확보)이면
 *  판정하지 않는다 — 다른 스키마 판정과 같은 게이트(위 `parseSchema` 주석). */
function findRedundantClasses(types: Set<string>, parsed: Pick<Parsed, "type">[]): string[] {
  if (types.size === 0) return [];
  const withInstances = new Set(parsed.map((p) => p.type));
  return [...types]
    .filter((t) => !withInstances.has(t))
    .sort()
    .map((t) => `잉여 클래스: '${t}' (인스턴스 0건)`);
}

function checkViewLinks(views: ObjectInput[], knownNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const v of views) {
    const targets = new Set([...v.text.matchAll(LINK)].map((m) => m[1].split("|")[0].trim()));
    for (const target of [...targets].sort()) {
      if (!knownNames.has(target)) violations.push(`댕글링: ${v.rel} -> [[${target}]]`);
    }
  }
  return violations;
}

export function computeOntologyMetrics(input: OntologyInput): OntologyMetrics {
  const { types, relTypes } = parseSchema(input.schemaText);
  const required = parseRequiredProps(input.typeFiles ?? []);

  const parsed = input.objects
    .map((o) => ({ rel: o.rel, ...typeAndName(o.rel), ...parseObject(o.text) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const names = new Set(parsed.map((p) => p.name));
  const typeOf = new Map(parsed.map((p) => [p.name, p.type]));
  const incoming = new Map<string, Set<string>>();
  for (const p of parsed) {
    for (const [, target] of p.rels) {
      if (!incoming.has(target)) incoming.set(target, new Set());
      incoming.get(target)!.add(p.name);
    }
  }
  const incomingOf = (name: string) => incoming.get(name) ?? new Set<string>();

  const violations: string[] = [];
  const hiddenItems: string[] = [];
  const normativeItems: string[] = [];
  const singleSentenceItems: string[] = [];
  const shellItems: string[] = [];
  const isolatedItems: string[] = [];
  let relationCount = 0;
  let proseLinkCount = 0;

  for (const p of parsed) {
    if (types.size > 0 && !types.has(p.type)) {
      violations.push(`미정의 타입: ${p.rel} (타입 '${p.type}' 이 SCHEMA.md 에 없음)`);
    }
    if (p.hasSection) violations.push(`## 절 사용: ${p.rel}`);

    const relTargets = new Set<string>();
    for (const [rname, target] of p.rels) {
      relationCount++;
      relTargets.add(target);
      const sig = relTypes.get(rname);
      if (relTypes.size > 0 && !relTypes.has(rname)) {
        violations.push(`미정의 관계: ${p.rel} 의 '${rname}' (SCHEMA.md 관계 표에 없음)`);
      } else if (sig && sig.length > 0) {
        const targetType = typeOf.get(target);
        const ok = sig.some((pair) => pair.from.has(p.type) && (targetType === undefined || pair.to.has(targetType)));
        if (!ok) {
          const sigStr = sig
            .map((pair) => `${[...pair.from].sort().join("·")} -> ${[...pair.to].sort().join("·")}`)
            .join(" / ");
          violations.push(
            `정의역·치역 위반: ${p.rel} 의 '${rname}' (${p.type} -> ${targetType ?? "?"}) 인데 스키마는 [${sigStr}]`,
          );
        }
      }
      if (!names.has(target)) violations.push(`댕글링: ${p.rel} -> [[${target}]]`);
    }

    const proseText = p.prose.join("\n");
    const proseLinks = new Set(
      [...proseText.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split("|")[0].trim()),
    );
    proseLinkCount += proseLinks.size;
    // 상대가 나를 가리키면(역방향) 그래프로는 이미 이어져 숨은 간선이 아니다(ADR 0007, W6 완화).
    const myIncoming = incomingOf(p.name);
    const hidden = [...proseLinks].filter((t) => !relTargets.has(t) && !myIncoming.has(t));
    for (const h of hidden.sort()) hiddenItems.push(`숨은 간선: ${p.rel} 서술의 [[${h}]] 가 관계 줄에 없음`);

    for (const line of p.prose) {
      if (NORMATIVE.test(line)) {
        normativeItems.push(`규범 문장: ${p.rel} "${line.slice(0, 45)}..."`);
        break;
      }
    }

    if (sentenceCount(p.prose) <= 1) singleSentenceItems.push(`한 문장: ${p.rel}`);

    const have = [...p.props, ...p.rels.map(([r]) => r)];
    const miss = (required.get(p.type) ?? []).filter((r) => !have.some((h) => h === r || h.startsWith(r)));
    if (miss.length > 0) violations.push(`필수 속성 누락: ${p.rel} (${p.type}) -> ${miss.join(", ")}`);

    if (p.props.length < 2) shellItems.push(`껍데기(속성 ${p.props.length}개): ${p.rel}`);
    if (p.rels.length === 0 && myIncoming.size === 0) isolatedItems.push(`고립(들고나는 관계 0개): ${p.rel}`);
  }

  const views = input.views ?? [];
  const viewNames = new Set(views.map((v) => typeAndName(v.rel).name));
  violations.push(...checkViewLinks(views, new Set([...names, ...viewNames])));

  const hierarchyCycleItems = findHierarchyCycles(parsed);
  const polysemousItems = findPolysemousElements(parsed);
  const redundantClassItems = findRedundantClasses(types, parsed);

  const objectCount = parsed.length;
  const n = objectCount || 1;
  const pl = proseLinkCount || 1;

  const backlinks: Record<string, string[]> = {};
  for (const name of names) backlinks[name] = [...incomingOf(name)].sort();

  return {
    objectCount,
    relationCount,
    proseLinkCount,
    hiddenEdges: { count: hiddenItems.length, ratio: hiddenItems.length / pl, items: hiddenItems },
    normativeSentences: { count: normativeItems.length, items: normativeItems },
    singleSentenceProse: { count: singleSentenceItems.length, ratio: singleSentenceItems.length / n, items: singleSentenceItems },
    shells: { count: shellItems.length, ratio: shellItems.length / n, items: shellItems },
    isolated: { count: isolatedItems.length, ratio: isolatedItems.length / n, items: isolatedItems },
    schemaViolations: violations,
    hierarchyCycles: { count: hierarchyCycleItems.length, items: hierarchyCycleItems },
    polysemousElements: { count: polysemousItems.length, items: polysemousItems },
    redundantClasses: { count: redundantClassItems.length, items: redundantClassItems },
    backlinks,
    ...parseActionLogs(input.actionLogs),
  };
}

const ACTION_LOG_LINE = /^-\s*(\d{2}:\d{2})\s+(새객체|값갱신|관계추가|관계삭제|스키마개정|빈손):/;

/** `- HH:MM <액션>: ...` 줄만 센다(03-seeding.md §5단계). `date`는 호출자가 파일명
 *  `action-log/YYYY/YYYY-MM-DD.md`에서 뽑아 준다 — 여기는 문자열 비교만 한다. */
function parseActionLogs(
  logs: ActionLogInput[],
): Pick<OntologyMetrics, "emptyHanded" | "objectTrend" | "schemaStability" | "lastUpdated"> {
  let total = 0;
  let emptyHanded = 0;
  const byDateNew = new Map<string, number>();
  const byDateSchema = new Map<string, number>();
  let last: { date: string; time: string } | null = null;

  for (const log of logs) {
    for (const raw of log.text.split("\n")) {
      const m = raw.trim().match(ACTION_LOG_LINE);
      if (!m) continue;
      total++;
      const [, time, action] = m;
      if (action === "빈손") emptyHanded++;
      if (action === "새객체") byDateNew.set(log.date, (byDateNew.get(log.date) ?? 0) + 1);
      if (action === "스키마개정") byDateSchema.set(log.date, (byDateSchema.get(log.date) ?? 0) + 1);
      if (!last || log.date > last.date || (log.date === last.date && time > last.time)) {
        last = { date: log.date, time };
      }
    }
  }

  const byDate = (m: Map<string, number>) =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

  return {
    emptyHanded: { count: emptyHanded, total, ratio: total ? emptyHanded / total : 0 },
    objectTrend: byDate(byDateNew),
    schemaStability: byDate(byDateSchema),
    lastUpdated: last ? `${last.date} ${last.time}` : null,
  };
}
