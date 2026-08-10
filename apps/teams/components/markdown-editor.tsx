"use client";

/** 위지윅·원문 두 면과 토글 손잡이 (DESIGN.md §비주얼 §50 · 로드맵 §P236-3). 자리 일곱에 한 벌이
 *  서야 하는 컴포넌트라(§5 커스텀 표 10번째) **손잡이의 자리 · `breaks` 분배를 호출부가 안 정한다**
 *  — 호출부는 `label`(있는 칸만) · `breaks`(그 글이 렌더되는 자리의 값) · `defaultValue`만 준다.
 *
 *  **직렬화 방식은 `98052584`의 판정 그대로다** — mdast `position`으로 최상위 블록의 원문 구간만
 *  잘라 쓴다(`lib/markdown-editor-blocks.ts`). 안 고친 블록은 슬라이스 그대로 다시 이어붙이므로
 *  항등이 유지되고(못 ①), 고친 블록만 아래 `domToMarkdown`이 편집된 DOM을 되읽어 갈아 끼운다.
 *
 *  **위지윅 면은 읽기 전용 렌더(`<Markdown>`, §10)를 블록별로 그대로 재사용한다** — 값을 두 벌로
 *  베끼지 않는다. 블록마다 감싼 `contentEditable`이 편집 표면이고, 포커스가 있는 동안 그 블록의
 *  `text`가 안 바뀌므로(오직 `blur`에서만 갱신) React가 그 DOM을 다시 안 건드려 캐럿이 안 죽는다.
 *
 *  `domToMarkdown`은 `unified`가 아니라 **직접 DOM을 걷는 손수 변환기다.** `hast-util-to-mdast`류의
 *  역방향 변환 패키지가 이 레포에 없고(정방향 `mdast-util-to-hast`만 `react-markdown`이 물고 있다),
 *  대상 태그가 `components/markdown.tsx`의 고정된 컴포넌트 열 하나뿐이라(h1~6·p·ul/ol/li·표·pre·
 *  blockquote·hr·strong/em/code/a) 새 의존성 없이 그 역방향만 손으로 짜는 쪽이 더 작다.
 *  // ponytail: 중첩 표·표 열 변경(행·열 추가)·각주는 다루지 않는다 — §50 §도구 모음이 그 편집을
 *  // 원문 면으로 넘긴 것과 같은 경계다. 필요해지면 표는 열 수를 셀 DOM에서 다시 세는 코드를 더한다. */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Code, Pilcrow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { blockBreaks, replaceBlock, splitBlocks } from "@/lib/markdown-editor-blocks";

/** 앱 하나짜리 값(못 ② — 칸마다 안 갈린다). §0-11 `dira-manual-theme`와 같은 자리의 키다. */
const MODE_KEY = "dira-markdown-editor-mode";
type Mode = "wysiwyg" | "raw";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "raw" ? "raw" : "wysiwyg";
  } catch {
    return "wysiwyg"; // 사파리 프라이빗 등 — §0-11과 같은 관용
  }
}

function writeMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* 이번 세션만 안 남을 뿐이라 삼킨다 */
  }
}

// ── 편집된 DOM → 마크다운 (고친 블록만 탄다) ──────────────────────────────────

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
      case "A":
        out += `[${inline(el)}](${el.getAttribute("href") ?? ""})`;
        break;
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
 *  편집은 이 절이 지원하지 않는다(위 ponytail 노트 · §50 §도구 모음 "행·열은 원문 면"). */
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
function domToMarkdown(root: Element, originalBlockText: string): string {
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
function looseTextOf(root: Element): string {
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

// ── 컴포넌트 ──────────────────────────────────────────────────────────────

export function MarkdownEditor({
  name,
  defaultValue,
  value: controlledValue,
  onValueChange,
  label,
  placeholder,
  breaks,
  rows = 12,
  className,
  onChange,
  required,
  ariaLabel,
  onPaste,
  onKeyDown,
}: {
  name: string;
  /** 비제어 초기값 — 부모가 dirty 판정·리셋을 안 하는 자리(①)만 쓴다 */
  defaultValue?: string;
  /** 제어값 — 부모가 값을 들고 있어야 하는 자리(②③④, 닫기 확인·`⌘↵` 제출이 현재 글을 봐야 한다)가
   *  쓴다. 주면 `onValueChange` 없이는 못 고친다 */
  value?: string;
  onValueChange?: (text: string) => void;
  /** 칸 위 라벨 — 있으면 손잡이와 같은 줄에 나란히 선다(§50 §자리, ①②). 없으면 손잡이만
   *  그 줄 오른쪽 끝에 선다(③④⑤⑥⑦) */
  label?: ReactNode;
  placeholder?: string;
  /** 그 글이 렌더되는 자리의 값(§10 표) — 이 컴포넌트가 스스로 정하지 않는다(못 ⑤) */
  breaks?: "all" | "untilHeading";
  rows?: number;
  className?: string;
  /** 폼 제출(hidden input)이 아니라 부모가 글자 수·되돌리기·저장 버튼을 직접 드는 자리(⑤⑥⑦)를
   *  위한 거울 콜백이다 — `value`를 안 주면 이 컴포넌트가 여전히 자기 `text`를 스스로 들고
   *  (uncontrolled), 매 갱신을 부모에도 알린다. 되돌리기는 부모가 `key`를 바꿔 이 컴포넌트를
   *  다시 마운트하는 방식으로 앞선다. */
  onChange?: (text: string) => void;
  /** 원문 면(`Textarea`)에는 네이티브 `required`로 걸린다. 위지윅 면은 제출값이 hidden input이라
   *  브라우저 제약 검증에서 제외되므로(barred) 실제 차단은 호출부가 제어값을 보고 제출을 막는다 —
   *  여기서는 편집 표면에 `aria-required` 힌트만 얹는다. */
  required?: boolean;
  ariaLabel?: string;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const [mode, setMode] = useState<Mode>("wysiwyg"); // 서버·첫 페인트는 항상 위지윅(기본값, 못 ②)
  const [innerText, setInnerText] = useState(defaultValue ?? "");
  const text = controlledValue ?? innerText;
  // 제어(`value` 있음)면 부모(`onValueChange`)가 유일한 값의 주인이다. 아니면 이 컴포넌트가
  // `text`를 스스로 들고, 갱신마다 `onChange` 거울만 부모에 알린다(⑤⑥⑦ — 글자 수·되돌리기용).
  function setText(next: string | ((prev: string) => string)) {
    const resolved = typeof next === "function" ? (next as (prev: string) => string)(text) : next;
    if (controlledValue !== undefined) onValueChange?.(resolved);
    else {
      setInnerText(resolved);
      onChange?.(resolved);
    }
  }

  // 첫 페인트 뒤에만 이 컴퓨터의 값을 읽는다(hydration 불일치를 피한다 — §0-11과 달리 깜빡임
  // 방지 스크립트를 새로 안 둔다. 손잡이 하나 다시 그리는 값이라 §0-11만큼 비싸지 않다).
  useEffect(() => setMode(readMode()), []);

  const split = useMemo(() => splitBlocks(text), [text]);

  function switchMode(next: Mode) {
    setMode(next);
    writeMode(next);
  }

  function commitBlock(i: number, el: HTMLElement) {
    const original = split.blocks[i];
    const leading = original.match(/^\n*/)?.[0] ?? "";
    const newBlockText = leading + domToMarkdown(el, original);
    if (newBlockText === original) return;
    setText(replaceBlock(split, i, newBlockText));
  }

  const toggle = (
    <Button type="button" variant="ghost" size="sm" onClick={() => switchMode(mode === "wysiwyg" ? "raw" : "wysiwyg")}>
      {mode === "wysiwyg" ? (
        <>
          <Code aria-hidden /> 원문으로
        </>
      ) : (
        <>
          <Pilcrow aria-hidden /> 위지윅으로
        </>
      )}
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className={label ? "flex items-center justify-between gap-2" : "flex justify-end"}>
        {label}
        {toggle}
      </div>
      {mode === "raw" ? (
        <Textarea
          name={name}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          className={className}
          required={required}
          aria-label={ariaLabel}
        />
      ) : (
        <div className="rounded-lg border border-input bg-transparent px-2.5 py-2 dark:bg-input/30">
          {split.blocks.length === 0 ? (
            <div
              contentEditable
              suppressContentEditableWarning
              data-placeholder={placeholder ?? ""}
              aria-label={ariaLabel}
              aria-required={required || undefined}
              className="min-h-7 text-base leading-7 outline-none empty:before:whitespace-pre-line empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
              onBlur={(e) => {
                const newText = looseTextOf(e.currentTarget);
                setText(newText ? `${newText}\n${split.tail}` : split.tail);
              }}
              onPaste={onPaste}
              onKeyDown={onKeyDown}
            />
          ) : (
            split.blocks.map((block, i) => (
              <div
                // 인덱스 키 — 블록 배열은 `text`가 바뀔 때만 다시 잘리고, 그때 전 블록이 새
                // `<Markdown>` 콘텐츠로 다시 그려지는 게 맞다(고친 블록만 재파싱된 결과를 본다).
                key={i}
                contentEditable
                suppressContentEditableWarning
                aria-label={ariaLabel}
                aria-required={required || undefined}
                className="outline-none [&_p:empty]:min-h-7"
                onBlur={(e) => commitBlock(i, e.currentTarget)}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
              >
                <Markdown text={block} breaks={blockBreaks(i, breaks, split.firstHeadingIndex)} />
              </div>
            ))
          )}
          <input type="hidden" name={name} value={text} />
        </div>
      )}
    </div>
  );
}
