/** 위지윅 편집기의 블록 분할 (DESIGN.md §비주얼 §50 · 로드맵 §P236-3). `lib/markdown-roundtrip.ts`
 *  ⓐ 후보와 같은 커서 방식 — 최상위 mdast 블록마다 원문 슬라이스를 자른다. 그 파일은 전체
 *  문자열 하나만 돌려주므로(측정용) 블록 배열이 필요한 편집기는 여기서 따로 자른다.
 *
 *  안 고친 블록은 이 슬라이스 그대로 다시 이어붙이면 항등이 유지된다(못 ① — 근거는
 *  `markdown-roundtrip.ts`의 항등 성질과 같다: `position.end.offset`이 단조증가하는 한
 *  커서 슬라이스 합은 정의상 원문과 같다). */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

export interface SplitResult {
  /** 프론트매터(`tail`의 짝) — 첫 줄이 `---`(trim)이고 뒤에 닫는 `---`(trim) 줄이 있으면 그 줄의
   *  개행까지. 하나라도 어긋나면 빈 문자열이다(DESIGN.md §비주얼 §50 §프론트매터는 블록이 아니다).
   *  블록 분할·`firstHeadingIndex`는 이 뒤 문자열만 본다 — YAML 파서 0, 정규식뿐이다. */
  head: string;
  blocks: string[];
  /** 마지막 블록 뒤 나머지(대개 파일 끝 개행 하나) — 편집 대상이 아니라 그대로 보존한다 */
  tail: string;
  /** `lib/markdown-breaks.ts softBreaks("untilHeading")`와 같은 경계 — 첫 heading 블록의
   *  인덱스. 그 플러그인은 트리 전체를 보고 첫 heading 앞에서 멈추는데, 편집기는 블록을
   *  독립된 조각으로 렌더하므로 이 경계를 따로 들고 있다가 블록마다 breaks를 나눠 준다.
   *  heading이 없으면 null(전부 heading 앞이다). */
  firstHeadingIndex: number | null;
}

/** 첫 줄이 `---`(trim)이고 뒤에 닫는 `---`(trim) 줄이 있으면 그 줄의 개행까지를 돌려준다.
 *  엔진(`tickets.py` `read_fm`)과 같은 경계 — 정규식이고 YAML 파서를 안 쓴다. */
function extractHead(source: string): string {
  const lines = source.split(/(?<=\n)/);
  if (lines.length === 0 || lines[0].trim() !== "---") return "";
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return lines.slice(0, i + 1).join("");
  }
  return "";
}

export function splitBlocks(source: string): SplitResult {
  const head = extractHead(source);
  const rest = source.slice(head.length);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(rest) as Root;
  const blocks: string[] = [];
  let cursor = 0;
  let firstHeadingIndex: number | null = null;
  for (const child of tree.children) {
    const end = child.position?.end.offset;
    if (end == null || end < cursor) continue;
    if (firstHeadingIndex === null && child.type === "heading") firstHeadingIndex = blocks.length;
    blocks.push(rest.slice(cursor, end));
    cursor = end;
  }
  return { head, blocks, tail: rest.slice(cursor), firstHeadingIndex };
}

/** 프론트매터 + 블록 배열 + 꼬리를 원문으로 되돌린다. */
export function joinBlocks({ head, blocks, tail }: Pick<SplitResult, "head" | "blocks" | "tail">): string {
  return head + blocks.join("") + tail;
}

/** 인덱스 하나만 갈아 끼운 전체 문자열. 나머지 블록은 손 안 댄 슬라이스라 그 밖 바이트가 안 갈린다
 *  (못 ① 둘째 반쪽 — "고친 자리 밖에서 바이트가 안 갈린다"). */
export function replaceBlock(split: SplitResult, index: number, newBlockText: string): string {
  const blocks = split.blocks.slice();
  blocks[index] = newBlockText;
  return joinBlocks({ head: split.head, blocks, tail: split.tail });
}

/** 편집기 블록 `i`에 실을 `breaks` 값. `all`/`undefined`는 전 블록에 그대로 걸리고,
 *  `untilHeading`만 `firstHeadingIndex` 앞뒤로 갈린다(위 인터페이스 문서 참고). */
export function blockBreaks(
  i: number,
  breaks: "all" | "untilHeading" | undefined,
  firstHeadingIndex: number | null,
): "all" | undefined {
  if (breaks === "all") return "all";
  if (breaks === "untilHeading") {
    return firstHeadingIndex === null || i < firstHeadingIndex ? "all" : undefined;
  }
  return undefined;
}

// ── 편집된 DOM → 마크다운 (고친 블록만 탄다) ──────────────────────────────────
// `components/markdown-editor.tsx`에서 옮겨왔다(요구 `33b7cb27`) — `blur` 없이 제출되는 경로
// (`⌘↵`)도 이 되읽기를 불러야 해서 컴포넌트 밖 순수 함수라야 두 자리(blur·제출 가로채기)가
// 하나를 같이 부른다. "use client" 파일은 node --test가 못 import한다(`sidebar.test.ts`와 같은
// 사유 — next/CSS를 끈다)는 이 레포의 규약을 따라 여기 둔다.

/** `data-wikilink` 표식을 `[[이름]]`/`[[이름|별칭]]`으로 되돌린다(DESIGN.md §비주얼 §50 §되읽기,
 *  요구 `9f2f41ed`). `name`은 `lib/markdown-wikilinks.ts`가 새긴 값(별칭 앞쪽, 끝 `.md` 뗀 것)이고
 *  `display`는 화면 글자(별칭 있으면 별칭, 없으면 raw 그대로 — `.md`가 실려 있을 수 있다). 별칭이
 *  없던 경우만 `display === name`이거나 `display === name + ".md"`다 — 그 둘만 원문 그대로 돌려주고
 *  그 밖은 별칭이 있었던 것으로 본다. */
function wikilinkMarkdown(name: string, display: string): string {
  if (display === name || display === `${name}.md`) return `[[${display}]]`;
  return `[[${name}|${display}]]`;
}

/** `components/markdown.tsx`의 인라인 요소만 안다 — strong·em·code·a·br. 그 밖은 지나서 안을 편다
 *  (체크박스의 숨은 `<input>`·아이콘 `<svg>`는 상위인 `listItemToMarkdown`이 처리하므로 여기선
 *  버린다). */
function inline(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? "";
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as Element;
    switch (el.tagName) {
      case "STRONG":
      case "B":
        out += `**${inline(el)}**`;
        break;
      case "EM":
      case "I":
        out += `*${inline(el)}*`;
        break;
      case "CODE":
        out += `\`${el.textContent ?? ""}\``;
        break;
      case "A": {
        const wikiName = el.getAttribute("data-wikilink");
        out +=
          wikiName !== null
            ? wikilinkMarkdown(wikiName, inline(el))
            : `[${inline(el)}](${el.getAttribute("href") ?? ""})`;
        break;
      }
      case "SPAN": {
        // 댕글링 위키링크(§10 §위키링크)만 여기 걸린다 — 그 밖의 span은 종전대로 default가
        // 벗겨서 안을 편다.
        const wikiName = el.getAttribute("data-wikilink");
        out += wikiName !== null ? wikilinkMarkdown(wikiName, inline(el)) : inline(el);
        break;
      }
      case "BR":
        out += "\n";
        break;
      case "UL":
      case "OL":
      case "INPUT":
      case "SVG":
        break; // 목록·체크박스는 블록 레벨(listToMarkdown)이 처리한다
      default:
        out += inline(el);
    }
  });
  return out;
}

function listToMarkdown(el: Element, depth: number): string {
  const ordered = el.tagName === "OL";
  const indent = "  ".repeat(depth);
  let n = 1;
  const items: string[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName !== "LI") continue;
    const checkbox = li.querySelector(":scope > input[type=checkbox]") as HTMLInputElement | null;
    let prefix = ordered ? `${n++}. ` : "- ";
    if (checkbox) prefix += checkbox.checked ? "[x] " : "[ ] ";
    items.push(`${indent}${prefix}${inline(li).trim()}`);
    for (const nested of Array.from(li.children)) {
      if (nested.tagName === "UL" || nested.tagName === "OL") items.push(listToMarkdown(nested, depth + 1));
    }
  }
  return items.join("\n");
}

/** 표 셀만 다시 찍는다 — 정렬 구분행(`|---|:---:|`)은 원문 그대로 둔다(둘째 줄). 열 수를 바꾸는
 *  편집은 이 절이 지원하지 않는다(`components/markdown-editor.tsx` 맨 위 ponytail 노트 ·
 *  §50 §도구 모음 "행·열은 원문 면"). */
function tableToMarkdown(table: Element, originalLines: string[]): string {
  const rowMarkdown = (tr: Element) => `| ${Array.from(tr.children).map((c) => inline(c).trim()).join(" | ")} |`;
  const headerRow = table.querySelector(":scope > thead > tr");
  const bodyRows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
  const separator = originalLines[1] ?? "|---|";
  const lines = [headerRow ? rowMarkdown(headerRow) : originalLines[0], separator, ...bodyRows.map(rowMarkdown)];
  return lines.join("\n");
}

function blockElementToMarkdown(el: Element, originalLines: string[]): string {
  switch (el.tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return `${"#".repeat(Number(el.tagName[1]))} ${inline(el)}`;
    case "P":
      return inline(el);
    case "HR":
      return "---";
    case "PRE": {
      const code = el.querySelector("code");
      const lang = code?.className.match(/language-(\S+)/)?.[1] ?? "";
      return `\`\`\`${lang}\n${code?.textContent ?? ""}\n\`\`\``;
    }
    case "UL":
    case "OL":
      return listToMarkdown(el, 0);
    case "BLOCKQUOTE": {
      const inner = Array.from(el.children)
        .map((c) => blockElementToMarkdown(c, originalLines))
        .filter(Boolean)
        .join("\n\n");
      return inner
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    }
    case "TABLE":
      return tableToMarkdown(el, originalLines);
    case "DIV": {
      // `<Markdown>` 자신의 래퍼 div, 그리고 `table` 커스텀 컴포넌트의 스크롤 래퍼 div — 값을
      // 두 벌로 베끼지 않는 이유가 여기서 그대로 걷힌다: 태그를 안 늘려도 여기가 편다.
      const table = el.querySelector(":scope > table");
      if (table) return tableToMarkdown(table, originalLines);
      return Array.from(el.children)
        .map((c) => blockElementToMarkdown(c, originalLines))
        .filter(Boolean)
        .join("\n\n");
    }
    default:
      return inline(el);
  }
}

/** 블록 하나(=contentEditable 하나)의 편집된 DOM을 마크다운으로 되읽는다. `originalBlockText`는
 *  표의 정렬 구분행을 그대로 두려고만 쓴다(위 `tableToMarkdown`). */
export function domToMarkdown(root: Element, originalBlockText: string): string {
  const originalLines = originalBlockText.replace(/^\n+/, "").split("\n");
  return Array.from(root.children)
    .map((c) => blockElementToMarkdown(c, originalLines))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** 블록이 아직 하나도 없는 빈 칸(③④가 시작하는 자리 — `split.blocks.length === 0`)에서 처음
 *  치는 글을 되읽는다. 위 변환기들은 `<Markdown>`이 그린 알려진 태그 열(h1~6·p·ul…)만 다루면
 *  되지만, 여긴 그 렌더가 아직 없다 — 브라우저가 `Enter`마다 만드는 `<div>`(빈 줄이면 안의
 *  `<br>`)를 줄바꿈 하나로 되읽어야 한다(못 ⑤. 안 그러면 `Array.from(root.children)`이 첫
 *  줄의 맨 텍스트 노드를 세지 않아 그 줄이 통째로 사라진다). */
export function looseTextOf(root: Element): string {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    lines.push(current);
    current = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      flush();
      return;
    }
    if (el.tagName === "DIV" || el.tagName === "P") {
      flush();
      el.childNodes.forEach(walk);
      return;
    }
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  flush();
  return lines.join("\n");
}

/** 포커스가 있던(=아직 `blur` 커밋을 안 지난) 편집 표면 하나를 지금 이 순간 되읽어 전체 텍스트에
 *  반영한다. `blur`가 하던 일과 완전히 같은 되읽기지만, `blur`가 안 지나는 제출 경로(`⌘↵` ·
 *  `requestSubmit()`)가 제출 직전에 같이 불러야 해서 부르는 자리를 안 가리는 순수 함수로 뗐다
 *  (요구 `33b7cb27` — 위지윅 면이 마지막 글자를 버리던 사고. `components/markdown-editor.tsx`
 *  §컴포넌트 §제출 가로채기가 이 함수를 두 자리에서 부른다).
 *
 *  블록 칸(`data-block-index`가 있는 원소) - 프론트매터 칸(`data-head`) - 첫 편집 전 빈 칸
 *  (`split.blocks.length === 0`) 셋 다 받는다 — `active`가 이 컴포넌트의 편집 표면이 아니면
 *  (자리를 못 찾거나 안 바뀌었으면) `null`이라 호출부가 `setText`를 건너뛴다(안 바뀐 값으로
 *  리렌더를 안 만든다). */
export function commitEditable(active: Element, split: SplitResult): string | null {
  if (active.getAttribute("data-head") !== null) {
    // `head`는 (빈 칸과 달리) 개행까지 포함해 그대로 렌더된 문자열이라 되읽은 값에 "\n"을
    // 따로 안 붙인다 — 붙이면 안 고쳐도 매번 dirty가 된다.
    const newHead = looseTextOf(active);
    if (newHead === split.head) return null;
    return joinBlocks({ head: newHead, blocks: split.blocks, tail: split.tail });
  }
  if (split.blocks.length === 0) {
    const newText = looseTextOf(active);
    const body = newText ? `${newText}\n${split.tail}` : split.tail;
    return split.head + body;
  }
  const indexAttr = active.getAttribute("data-block-index");
  if (indexAttr === null) return null;
  const i = Number(indexAttr);
  const original = split.blocks[i];
  if (original === undefined) return null;
  const leading = original.match(/^\n*/)?.[0] ?? "";
  const newBlockText = leading + domToMarkdown(active, original);
  if (newBlockText === original) return null;
  return replaceBlock(split, i, newBlockText);
}
