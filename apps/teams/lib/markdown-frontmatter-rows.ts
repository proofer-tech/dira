/** 프론트매터 행 편집기의 슬라이스 행 모델(DESIGN.md §프론트매터 행 편집기 결정 1·2·3·5).
 *  `lib/markdown-editor-blocks.ts`의 `splitBlocks`가 내는 `head` 문자열(여닫는 `---` 두 줄
 *  포함)을 행 배열로 읽고 다시 문자열로 되쓴다 — 파싱해서 자료 구조로 옮겼다가 직렬화하는
 *  것이 아니라, 안 고친 행은 원문 슬라이스 그대로 다시 이어 붙는다(항등, 결정 2). YAML
 *  파서는 안 쓴다(결정 3, `AGENTS.md` §의존성) — 읽는 줄 모양은 셋(쌍·부모·목록 항목)뿐이고
 *  셋 중 어느 것도 아닌 줄은 바로 위 행의 값에 이어 붙는다. */

export type RowShape = "pair" | "parent" | "list-item";

export interface FrontmatterRow {
  /** 들여쓴 깊이 — 형제(같은 부모 아래) 행끼리 같은 정수를 든다. 상한을 상수로 정하지 않는다
   *  (실측 3층·4층 파일이 그대로 뜬다). */
  level: number;
  key: string | null;
  value: string | null;
  shape: RowShape;
  /** 원문 슬라이스 — 이 행의 시작 줄부터 다음 행 시작 전까지(이음 줄 포함) 그대로다. */
  raw: string;
}

export interface FrontmatterDoc {
  /** 여는 `---` 줄(개행 포함). 행이 아니다(결정 3). */
  open: string;
  rows: FrontmatterRow[];
  /** 닫는 `---` 줄(개행 포함). 행이 아니다. */
  close: string;
}

const EMPTY_DOC: FrontmatterDoc = { open: "", rows: [], close: "" };

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/(?<=\n)/);
}

/** `key: value` 모양이면 첫 `": "`에서 가른다 - 값 안의 콜론은 안 건드린다(결정 3, 문법 검증 없음). */
function splitKeyValue(text: string): { key: string | null; value: string } {
  const i = text.indexOf(": ");
  if (i === -1) return { key: null, value: text };
  return { key: text.slice(0, i), value: text.slice(i + 2) };
}

interface RowStart {
  indent: number;
  shape: RowShape;
  key: string | null;
  value: string | null;
}

/** 줄 하나가 결정 3의 세 모양(쌍·부모·목록 항목) 중 무엇인지 가른다. 셋 중 무엇도 아니면
 *  `null` - 그 줄은 바로 위 행의 이음 줄이다(빈 줄도 포함, 실측 4의 여러 줄 값이 이 갈래). */
function classifyLine(line: string): RowStart | null {
  const body = line.endsWith("\n") ? line.slice(0, -1) : line;
  const trimmed = body.trimStart();
  const indent = body.length - trimmed.length;
  if (trimmed.length === 0) return null;
  if (trimmed === "-" || trimmed.startsWith("- ")) {
    const itemBody = trimmed === "-" ? "" : trimmed.slice(2);
    const { key, value } = splitKeyValue(itemBody);
    return { indent, shape: "list-item", key, value: key === null ? itemBody : value };
  }
  const pair = splitKeyValue(trimmed);
  if (pair.key !== null) return { indent, shape: "pair", key: pair.key, value: pair.value };
  if (trimmed.endsWith(":")) {
    const key = trimmed.slice(0, -1);
    if (key.length > 0) return { indent, shape: "parent", key, value: null };
  }
  return null;
}

/** `head` 문자열을 프론트매터 문서(여는 줄 + 행 배열 + 닫는 줄)로 읽는다. 층은 들여쓰기가
 *  깊어질 때마다 그 앞 형제/부모를 스택으로 쫓아 매기므로(정규화된 깊이), 이 큐의 2칸 관례가
 *  깨져도(예: 4칸) 층수는 그대로 0·1·2…로 매겨진다. */
export function parseFrontmatterHead(head: string): FrontmatterDoc {
  if (head === "") return EMPTY_DOC;
  const lines = splitLines(head);
  if (lines[0]?.trim() !== "---") return { open: "", rows: [], close: head };
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) return { open: "", rows: [], close: head };

  const open = lines[0];
  const close = lines[closeIndex];
  const bodyLines = lines.slice(1, closeIndex);

  const rows: FrontmatterRow[] = [];
  const stack: { indent: number; level: number }[] = [];
  for (const line of bodyLines) {
    const start = classifyLine(line);
    if (start === null) {
      if (rows.length > 0) {
        rows[rows.length - 1].raw += line;
      } else {
        // 첫 줄부터 셋 중 어느 모양도 아니다(계약 밖 입력) - 항등을 지키려고 원문 그대로 담는다
        rows.push({ level: 0, key: null, value: null, shape: "pair", raw: line });
      }
      continue;
    }
    while (stack.length > 0 && stack[stack.length - 1].indent >= start.indent) stack.pop();
    const level = stack.length === 0 ? 0 : stack[stack.length - 1].level + 1;
    stack.push({ indent: start.indent, level });
    rows.push({ level, key: start.key, value: start.value, shape: start.shape, raw: line });
  }
  return { open, rows, close };
}

/** 프론트매터 문서를 원문으로 되쓴다. 한 행도 안 고쳤으면 `raw`가 원문 슬라이스 그대로라
 *  `parseFrontmatterHead(head)`를 되쓴 결과가 `head`와 바이트가 같다(항등, 결정 2). */
export function stringifyFrontmatterHead(doc: FrontmatterDoc): string {
  return doc.open + doc.rows.map((r) => r.raw).join("") + doc.close;
}

/** 이 큐 프론트매터의 들여쓰기 관례(결정 3의 표 예시 전부 2칸). 새로 짓거나 고친 행에만
 *  쓴다 - 안 고친 행은 원문 슬라이스라 이 함수를 안 탄다. */
function levelIndent(level: number): string {
  return "  ".repeat(level);
}

function formatRow(row: Pick<FrontmatterRow, "level" | "key" | "value" | "shape">): string {
  const indent = levelIndent(row.level);
  if (row.shape === "parent") return `${indent}${row.key}:\n`;
  if (row.shape === "list-item") {
    const body = row.key !== null ? `${row.key}: ${row.value ?? ""}` : (row.value ?? "");
    return `${indent}- ${body}\n`;
  }
  return `${indent}${row.key}: ${row.value ?? ""}\n`;
}

/** 행 하나를 더한다 - 더한 행은 `rows[index - 1]`의 층을 물려받는다(결정 1). `raw`는 원문
 *  슬라이스가 없으니 `level`·`key`·`value`·`shape`에서 새로 짠다. */
export function insertRow(
  rows: FrontmatterRow[],
  index: number,
  fields: { key: string | null; value: string | null; shape: RowShape },
): FrontmatterRow[] {
  const level = index > 0 ? rows[index - 1].level : 0;
  const row: FrontmatterRow = { level, key: fields.key, value: fields.value, shape: fields.shape, raw: "" };
  row.raw = formatRow(row);
  const next = rows.slice();
  next.splice(index, 0, row);
  return next;
}

/** 행 하나를 지운다. */
export function removeRow(rows: FrontmatterRow[], index: number): FrontmatterRow[] {
  const next = rows.slice();
  next.splice(index, 1);
  return next;
}

/** 행 하나의 키·값을 고친다. 그 행의 `raw`만 새로 짜여 갈리고, 나머지 행은 손 안 댄 슬라이스라
 *  그 밖 바이트가 한 글자도 안 갈린다(결정 2 둘째 반쪽). */
export function updateRow(
  rows: FrontmatterRow[],
  index: number,
  fields: { key: string | null; value: string | null },
): FrontmatterRow[] {
  const next = rows.slice();
  const prev = next[index];
  const row: FrontmatterRow = { ...prev, key: fields.key, value: fields.value };
  row.raw = formatRow(row);
  next[index] = row;
  return next;
}

/** 값이 대괄호로 연 목록인가(`aliases: [a, b]`) - 결정 5. */
export function isBracketList(value: string): boolean {
  const t = value.trim();
  return t.startsWith("[") && t.endsWith("]");
}

/** 대괄호 목록 값을 항목 배열로 가른다. 대괄호 밖 값의 콤마는 이 함수를 안 타니 안 갈린다 -
 *  호출 전에 `isBracketList`로 가른다. */
export function splitListValue(value: string): string[] {
  const inner = value.trim().slice(1, -1).trim();
  return inner === "" ? [] : inner.split(",").map((s) => s.trim());
}

/** 항목 배열을 대괄호 목록 값으로 잇는다. 항목 0개는 `[]`다 - 키 줄 자체는 이 함수가 안
 *  건드린다(호출부가 `removeRow`를 따로 안 부르면 남는다, 결정 5). */
export function joinListValue(items: string[]): string {
  return `[${items.join(", ")}]`;
}

/** 키 추천 - 값 검색 콤보박스의 후보 원천 여섯(결정 8). 새 캐시 파일이나 색인이 아니라 호출부
 *  (서버 컴포넌트)가 이미 읽은 값을 그대로 묶어 넘긴다 - `objectNames`는 `buildVault`가 내는
 *  이름 -> href 벌의 키, `personas`-`squads`-`ticketHashes`는 큐의 `personas/`-`squads/`-
 *  `tickets/`를 이미 읽는 목록 함수들의 결과다. */
export interface FrontmatterCandidates {
  objectTypes: string[];
  linkTypes: string[];
  objectNames: string[];
  personas: string[];
  squads: string[];
  ticketHashes: string[];
  /** 타입 이름 -> 그 타입 `_ontology/object-types/<타입>.md` §Properties 표의 속성 이름 전부
   *  (필수 불문, `lib/ontology.ts`의 `parseTypeProperties`가 만든다) */
  typeProps: Map<string, string[]>;
}

/** frontmatter의 다섯 공통 키(결정 6 §2) - `type`은 이미 top-level에 있을 값이라 이 목록에도
 *  넣는다(그 파일에 `type:`이 아직 없으면 추천에 뜬다). */
const COMMON_KEYS = ["type", "name", "aliases", "tags", "description", "links"];

/** 행 `index`의 부모 행 - 그 행보다 층이 얕은 가장 가까운 앞쪽 행(결정 1 스택과 같은 모양).
 *  최상위 행(level 0)은 부모가 없다. */
function parentRow(rows: FrontmatterRow[], index: number): FrontmatterRow | null {
  const level = rows[index].level;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].level < level) return rows[i];
  }
  return null;
}

/** 행 `index`의 키 칸 추천(결정 6). 최상위 키(level 0)는 그 파일 `type:`이 가리키는 §Properties
 *  전부 + 공통 키에서 그 파일에 이미 있는 최상위 키를 뺀 목록이다. `links:` 아래 관계타입 층
 *  (level 1, 부모가 `links`)은 `_ontology/link-types/`의 이름 다섯에서 그 층에 이미 쓴 것만
 *  뺀다. 그 밖(목록 항목의 라벨 키 등)은 추천이 없다 - 호출부가 빈 배열을 받아 평범한 입력
 *  칸으로 그린다. */
export function keyCandidates(
  rows: FrontmatterRow[],
  index: number,
  candidates: FrontmatterCandidates,
): string[] {
  const row = rows[index];
  if (row.level === 0) {
    const used = new Set(rows.filter((r) => r.level === 0 && r.key !== null).map((r) => r.key));
    const type = rows.find((r) => r.level === 0 && r.key === "type")?.value?.trim();
    const typeProps = type ? (candidates.typeProps.get(type) ?? []) : [];
    return [...typeProps, ...COMMON_KEYS].filter((k) => !used.has(k));
  }
  const parent = parentRow(rows, index);
  if (row.level === 1 && parent?.key === "links") {
    const used = new Set(
      rows.filter((r, i) => r.level === 1 && parentRow(rows, i) === parent).map((r) => r.key),
    );
    return candidates.linkTypes.filter((k) => !used.has(k));
  }
  return [];
}

/** 행 `index`의 값 칸 검색 후보(결정 7) - `type:`(최상위, level 0)은 객체 타입, `links:` 아래
 *  대상 줄(목록 항목이고 조부모가 `links`)은 객체 이름. 그 밖은 검색이 안 열린다 - `null`을
 *  받으면 호출부가 평범한 입력 칸으로 그린다(`description:` 같은 자유 문장 칸이 이 갈래다). */
export function valueCandidates(
  rows: FrontmatterRow[],
  index: number,
  candidates: FrontmatterCandidates,
): string[] | null {
  const row = rows[index];
  if (row.level === 0 && row.key === "type") return candidates.objectTypes;
  if (row.shape === "list-item") {
    const parent = parentRow(rows, index);
    const parentIndex = parent ? rows.indexOf(parent) : -1;
    const grandparent = parentIndex >= 0 ? parentRow(rows, parentIndex) : null;
    if (grandparent?.key === "links") return candidates.objectNames;
  }
  return null;
}
