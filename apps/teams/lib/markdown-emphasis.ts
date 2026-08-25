/** 짝을 못 찾아 글자로 남은 `**`·`*`를 닫는 remark 플러그인 (DESIGN.md §비주얼 §10
 *  §한글에 붙은 강조 구분자가 닫힌다, 요구 `a1927a60`). CommonMark의 flanking 규칙은 -
 *  앞이 문장부호고 뒤가 글자면 닫는 구분자가 되지 못한다 - 한국어 조사가 코드 스팬-괄호-
 *  마침표 바로 뒤에 붙는 자리마다 걸린다. micromark가 이미 이렇게 실패해 놓은 뒤라, 여기서
 *  다시 flanking을 따지지 않고 **같은 길이끼리 나오는 순서대로 짝짓는다**(첫 번째가 열고
 *  두 번째가 닫고, 세 번째가 다시 연다).
 *
 *  `lib/markdown-breaks.ts`와 같은 부류다 - 문자열을 미리 손보지 않고 mdast의 `text` 노드만
 *  본다. 코드 스팬-펜스는 `inlineCode`-`code`가 `text` 타입이 아니라서 이 walker가 그대로
 *  지나간다(값을 안 읽는다). `text`가 아닌 형제(코드 스팬-위키링크-표식)는 열고 닫는 구분자
 *  사이에 그대로 끼어들 수 있다 - `**릴리스된 최신 버전은 \`v1.0.29\`**입니다`처럼 짝이
 *  `text`-`inlineCode`-`text` 셋에 흩어져 있어도 잡힌다.
 *
 *  ponytail: 길이가 다른 구분자끼리(`**` 하나와 `*` 하나) 자리가 겹치면 먼저 여는 쪽만
 *  살리고 나머지는 글자로 남긴다. 진짜 중첩(`**굵고 *기울인* 글자**`)은 이 플러그인이 보기
 *  전에 micromark가 이미 옳게 파싱해 놓으므로 여기 남는 것은 깨진 자리뿐이다 - 겹침 판정을
 *  더 정교하게 만들 이유가 없다. */

type Node = { type: string; value?: string; children?: Node[] };

type Atom = { kind: "text"; value: string } | { kind: "delim"; length: 1 | 2 } | { kind: "node"; node: Node };

const DELIM = /\*{1,2}/g;

function toAtoms(children: Node[]): Atom[] {
  const atoms: Atom[] = [];
  for (const c of children) {
    if (c.type !== "text" || !c.value?.includes("*")) {
      atoms.push({ kind: "node", node: c });
      continue;
    }
    let last = 0;
    for (const m of c.value.matchAll(DELIM)) {
      if (m.index! > last) atoms.push({ kind: "text", value: c.value.slice(last, m.index) });
      atoms.push({ kind: "delim", length: m[0].length as 1 | 2 });
      last = m.index! + m[0].length;
    }
    if (last < c.value.length) atoms.push({ kind: "text", value: c.value.slice(last) });
  }
  return atoms;
}

/** 같은 길이끼리 등장 순서대로 짝짓는다(토글). 겹치는 짝은 먼저 여는 쪽만 인정한다. */
function findPairs(atoms: Atom[]): Map<number, number> {
  const open: Record<1 | 2, number | null> = { 1: null, 2: null };
  const found: [number, number][] = [];
  atoms.forEach((a, i) => {
    if (a.kind !== "delim") return;
    const o = open[a.length];
    if (o !== null) {
      found.push([o, i]);
      open[a.length] = null;
    } else {
      open[a.length] = i;
    }
  });
  found.sort((a, b) => a[0] - b[0]);
  const accepted = new Map<number, number>();
  let usedUntil = -1;
  for (const [o, c] of found) {
    if (o <= usedUntil) continue;
    accepted.set(o, c);
    usedUntil = c;
  }
  return accepted;
}

function build(atoms: Atom[], start: number, end: number, pairs: Map<number, number>): Node[] {
  const out: Node[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", value: buf });
    buf = "";
  };
  let i = start;
  while (i < end) {
    const close = pairs.get(i);
    if (close !== undefined) {
      flush();
      const length = (atoms[i] as { length: 1 | 2 }).length;
      out.push({ type: length === 2 ? "strong" : "emphasis", children: build(atoms, i + 1, close, pairs) });
      i = close + 1;
      continue;
    }
    const a = atoms[i];
    if (a.kind === "text") buf += a.value;
    else if (a.kind === "delim") buf += "*".repeat(a.length);
    else {
      flush();
      out.push(a.node);
    }
    i++;
  }
  flush();
  return out;
}

function transform(node: Node): void {
  if (!node.children) return;
  if (node.children.some((c) => c.type === "text" && c.value?.includes("*"))) {
    const atoms = toAtoms(node.children);
    const pairs = findPairs(atoms);
    if (pairs.size) node.children = build(atoms, 0, atoms.length, pairs);
  }
  for (const c of node.children) transform(c);
}

export function closeEmphasis() {
  return (tree: unknown) => {
    for (const child of (tree as Node).children ?? []) transform(child);
  };
}
