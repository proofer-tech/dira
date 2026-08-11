import { test } from "node:test";
import assert from "node:assert/strict";
import { blockBreaks, commitEditable, joinBlocks, replaceBlock, splitBlocks } from "./markdown-editor-blocks.ts";

// `commitEditable`은 `Node.TEXT_NODE`/`Node.ELEMENT_NODE`(브라우저 전역)를 참조한다. node --test에는
// `Node`가 없으니 최소 상수만 채운다 — jsdom을 끌어오지 않는다(새 의존성, `commitEditable`이 쓰는
// 건 이 상수 둘과 `childNodes`·`children`·`tagName`·`textContent`·`getAttribute`뿐이라 손으로
// 짠 가짜 DOM 노드 두 클래스로 충분하다).
(globalThis as unknown as { Node: { TEXT_NODE: number; ELEMENT_NODE: number } }).Node = {
  TEXT_NODE: 3,
  ELEMENT_NODE: 1,
};

class FakeText {
  readonly nodeType = 3;
  constructor(public textContent: string) {}
}

class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly childNodes: (FakeText | FakeElement)[];
  private readonly attrs: Record<string, string>;
  constructor(tag: string, childNodes: (FakeText | FakeElement)[] = [], attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    this.childNodes = childNodes;
    this.attrs = attrs;
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c.nodeType === 1);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  querySelector(): null {
    return null; // 이 테스트가 짚는 시나리오는 표를 안 쓴다
  }
  querySelectorAll(): [] {
    return [];
  }
}

/** 블록 하나(=contentEditable 그 자체) — 안에 `<Markdown text="..." />`가 그린 `<p>` 하나를
 *  흉낸다(§50이 h1~6·p·ul… 중 이 시나리오에 쓰는 태그만). `data-block-index`는 컴포넌트가
 *  contentEditable 위에 다는 자리다(`components/markdown-editor.tsx`). */
function fakeBlockEditable(text: string, blockIndex: number): FakeElement {
  return new FakeElement("div", [new FakeElement("p", [new FakeText(text)])], {
    "data-block-index": String(blockIndex),
  });
}

/** 블록이 아직 없는 빈 칸의 편집 표면 — `lines`가 `Enter`로 갈린 줄이다. 브라우저는 **첫 줄만
 *  맨 텍스트 노드**로 두고 그 뒤로 `Enter`를 칠 때마다 `<div>`로 감싼다(`looseTextOf` 주석 —
 *  안 맞추면 `Array.from(root.children)`이 첫 줄을 세지 않아 사라진다는 그 함정을 테스트가
 *  거꾸로 밟는다). */
function fakeLooseEditable(lines: string[]): FakeElement {
  const childNodes: (FakeText | FakeElement)[] = lines.map((line, i) =>
    i === 0 ? new FakeText(line) : new FakeElement("div", [new FakeText(line)]),
  );
  return new FakeElement("div", childNodes);
}
const el = (x: FakeElement) => x as unknown as Element;

test("안 고치면 바이트가 그대로다 (못 ①)", () => {
  const source = "# 제목\n\n본문 한 줄.\n\n- [ ] 하나\n- [x] 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  assert.equal(joinBlocks(splitBlocks(source)), source);
});

test("빈 문자열도 항등이다", () => {
  assert.equal(joinBlocks(splitBlocks("")), "");
  assert.equal(joinBlocks(splitBlocks("\n")), "\n");
});

test("블록 하나만 갈아 끼우면 그 밖은 안 갈린다 (못 ① 둘째 반쪽)", () => {
  const source = "첫 블록.\n\n둘째 블록.\n\n셋째 블록.\n";
  const split = splitBlocks(source);
  assert.equal(split.blocks.length, 3);
  const leading = split.blocks[1].match(/^\n*/)?.[0] ?? "";
  const out = replaceBlock(split, 1, `${leading}둘째 블록 고침.`);
  assert.equal(out, "첫 블록.\n\n둘째 블록 고침.\n\n셋째 블록.\n");
});

test("firstHeadingIndex — untilHeading 경계(lib/markdown-breaks.ts와 같은 판정)", () => {
  const withHeading = splitBlocks("첫 줄.\n둘째 줄.\n\n## 결과\n\n뒤 문단.\n");
  assert.equal(withHeading.firstHeadingIndex, 1);
  const noHeading = splitBlocks("첫 줄.\n둘째 줄.\n");
  assert.equal(noHeading.firstHeadingIndex, null);
});

test("blockBreaks — untilHeading은 첫 heading 앞만 all, 나머지는 undefined", () => {
  const { firstHeadingIndex } = splitBlocks("첫 문단.\n\n## 결과\n\n뒤 문단.\n");
  assert.equal(blockBreaks(0, "untilHeading", firstHeadingIndex), "all");
  assert.equal(blockBreaks(1, "untilHeading", firstHeadingIndex), undefined); // heading 자신
  assert.equal(blockBreaks(2, "untilHeading", firstHeadingIndex), undefined); // heading 뒤
  assert.equal(blockBreaks(0, "untilHeading", null), "all"); // heading이 아예 없으면 전부 앞
});

test("blockBreaks — all·undefined는 블록과 무관하게 그대로 걸린다", () => {
  assert.equal(blockBreaks(3, "all", 0), "all");
  assert.equal(blockBreaks(3, undefined, 0), undefined);
});

// `commitEditable` — 요구 `33b7cb27`: `blur`를 안 지나는 제출(`⌘↵`의 `requestSubmit()`)이 이 함수를
// 대신 불러 마지막 편집을 되읽는다. `split`은 여기서 **일부러 stale하게** 둔다 — `blur`가 안 지났을
// 때 진짜로 벌어지는 상태(state는 옛 값, DOM만 최신)를 그대로 흉낸다.

test("commitEditable — blur 없이 제출돼도 지금 DOM의 마지막 글자를 담는다 (사고 재현: 위지→전문)", () => {
  const stale = splitBlocks("위지\n"); // 사고 당시 접수된 값 그대로 — 두 글자만 커밋됐다
  const typed = "위지윅으로, 원문으로 버튼을 textarea 우측 상단으로 옮겨주세요";
  const liveDom = fakeBlockEditable(typed, 0); // blur는 안 지났지만 화면·DOM은 이미 전문이다
  const next = commitEditable(el(liveDom), stale);
  assert.equal(next, `${typed}\n`);
});

test("commitEditable — DOM이 커밋값과 같으면 null(안 바뀐 값으로 리렌더를 안 만든다)", () => {
  const split = splitBlocks("그대로.\n");
  const unchanged = fakeBlockEditable("그대로.", 0);
  assert.equal(commitEditable(el(unchanged), split), null);
});

test("commitEditable — 블록이 아직 없는 빈 칸(③④ 시작 자리)에서 처음 친 글도 담는다", () => {
  const split = splitBlocks(""); // 못 ⑤가 지키는 자리 — blocks.length === 0
  const liveDom = fakeLooseEditable(["첫 줄", "둘째 줄"]);
  assert.equal(commitEditable(el(liveDom), split), "첫 줄\n둘째 줄\n");
});

test("commitEditable — data-block-index가 없는 원소는 이 컴포넌트 것이 아니라 null", () => {
  const split = splitBlocks("본문.\n");
  const foreign = new FakeElement("div", [new FakeText("본문.")]); // 인덱스 속성 없음
  assert.equal(commitEditable(el(foreign), split), null);
});
