import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockBreaks,
  commitEditable,
  domToMarkdown,
  editSurfaceId,
  EMPTY_SPLIT,
  joinBlocks,
  replaceBlock,
  resolveSplit,
  splitBlocks,
} from "./markdown-editor-blocks.ts";

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
  readonly textContent: string;
  constructor(textContent: string) {
    this.textContent = textContent;
  }
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

test("안 고치면 바이트가 그대로다 (규칙 ①)", () => {
  const source = "# 제목\n\n본문 한 줄.\n\n- [ ] 하나\n- [x] 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  assert.equal(joinBlocks(splitBlocks(source)), source);
});

test("빈 문자열도 항등이다", () => {
  assert.equal(joinBlocks(splitBlocks("")), "");
  assert.equal(joinBlocks(splitBlocks("\n")), "\n");
});

test("블록 하나만 갈아 끼우면 그 밖은 안 갈린다 (규칙 ① 둘째 반쪽)", () => {
  const source = "첫 블록.\n\n둘째 블록.\n\n셋째 블록.\n";
  const split = splitBlocks(source);
  assert.equal(split.blocks.length, 3);
  const leading = split.blocks[1].match(/^\n*/)?.[0] ?? "";
  const out = replaceBlock(split, 1, `${leading}둘째 블록 고침.`);
  assert.equal(out, "첫 블록.\n\n둘째 블록 고침.\n\n셋째 블록.\n");
});

// `head` — DESIGN.md §비주얼 §50 §프론트매터는 블록이 아니다. 픽스처는 `objects/워커/w8.md`
// 모양(중첩 YAML — `links:` 아래 두 층)이다.
const FM_FIXTURE = `---
type: 워커
name: w8
aliases: []
tags: []
description: cron이 분마다 띄우는 실행 단위
links:
  돌린다:
    - 디스패치 루프: "[[디스패치 루프]]"
---

# w8

본문 한 줄.
`;

test("head 분리 — 중첩 fm 픽스처에서 head가 닫는 --- + 개행까지, blocks[0]이 그 뒤", () => {
  const split = splitBlocks(FM_FIXTURE);
  assert.equal(split.head, FM_FIXTURE.slice(0, FM_FIXTURE.indexOf("\n\n# w8") + 1));
  assert.ok(split.head.startsWith("---\n"));
  assert.ok(split.head.trimEnd().endsWith("---"));
  assert.ok(!split.blocks[0].includes("type:"));
});

test("항등 — head + blocks.join('') + tail === 원문 (fm 있는 픽스처 · 없는 픽스처)", () => {
  assert.equal(joinBlocks(splitBlocks(FM_FIXTURE)), FM_FIXTURE);
  assert.equal(joinBlocks(splitBlocks("# 제목\n\n본문.\n")), "# 제목\n\n본문.\n");
});

test("firstHeadingIndex가 head를 안 센다 — fm 뒤 첫 heading의 인덱스", () => {
  const split = splitBlocks(FM_FIXTURE);
  assert.equal(split.firstHeadingIndex, 0);
});

// DESIGN.md §편집 칸의 입력 지연 §수용조건 2 — 원문 면에서 키 하나가 splitBlocks를 0회 부른다.
// `resolveSplit("raw", ...)`이 EMPTY_SPLIT과 참조가 같다는 것이 그 증거다: splitBlocks를 실제로
// 불렀다면 새로 파싱한 객체가 나와 이 `===`가 깨진다.
test("resolveSplit — raw 모드는 splitBlocks를 안 불러 EMPTY_SPLIT을 그대로 돌려준다 (후보 A)", () => {
  assert.strictEqual(resolveSplit("raw", FM_FIXTURE), EMPTY_SPLIT);
  assert.strictEqual(resolveSplit("raw", "# 제목\n\n본문.\n"), EMPTY_SPLIT);
});

test("resolveSplit — wysiwyg 모드는 splitBlocks와 같은 값이다", () => {
  assert.deepEqual(resolveSplit("wysiwyg", FM_FIXTURE), splitBlocks(FM_FIXTURE));
});

test("commitEditable — data-head 표면을 고치면 head만 갈리고 블록 열 바이트가 안 갈린다", () => {
  const split = splitBlocks(FM_FIXTURE);
  // 위지윅 면은 `split.head`를 문자열 그대로(트레일링 개행 포함) 텍스트 노드 하나에 그린다
  // (components/markdown-editor.tsx `{split.head}`) — 픽스처도 그 렌더를 그대로 흉낸다.
  const newHead = split.head.replace("name: w8", "name: w8-바뀜");
  const changedHead = new FakeElement("div", [new FakeText(newHead)], { "data-head": "" });
  const out = commitEditable(el(changedHead), split);
  assert.equal(out, joinBlocks({ ...split, head: newHead }));
  assert.equal(out?.includes("본문 한 줄."), true); // 블록 열은 무변경
});

test("commitEditable — data-head 표면이 안 바뀌면 null", () => {
  const split = splitBlocks(FM_FIXTURE);
  const unchanged = new FakeElement("div", [new FakeText(split.head)], { "data-head": "" });
  assert.equal(commitEditable(el(unchanged), split), null);
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
  const split = splitBlocks(""); // 규칙 ⑤가 지키는 자리 — blocks.length === 0
  const liveDom = fakeLooseEditable(["첫 줄", "둘째 줄"]);
  assert.equal(commitEditable(el(liveDom), split), "첫 줄\n둘째 줄\n");
});

test("commitEditable — data-block-index가 없는 원소는 이 컴포넌트 것이 아니라 null", () => {
  const split = splitBlocks("본문.\n");
  const foreign = new FakeElement("div", [new FakeText("본문.")]); // 인덱스 속성 없음
  assert.equal(commitEditable(el(foreign), split), null);
});

// 사고 `0bd7e3b8` — 마지막 블록 끝에 `Enter`를 치면 브라우저가 그 블록의 contentEditable 안에
// React 밖 `<p>`를 만든다. 되읽은 값의 그 블록 슬라이스가 편집 전과 우연히 같으면(뒤가 새 블록으로
// 빠지고 이 블록 자신은 안 갈리면) React 키가 그대로라 재마운트가 없고, 그 고아 `<p>`가 다음
// 블러에도 그대로 남아 또 읽힌다 - 담긴 내용이 거듭 붙는다. `commitEditable` 자신은 "그 순간 DOM에
// 보이는 것"을 있는 그대로 되읽는 함수라 이 성질을 그대로 가진다 - 중복을 막는 것은 이 함수의
// 일이 아니라, 커밋마다 그 슬롯을 강제 재마운트시켜 이 고아 DOM 자체가 다시 생기지 않게 하는
// `components/markdown-editor.tsx`(`editSurfaceId` 기반 키)의 일이다.
test("commitEditable — 재마운트 안 된 고아 <p>가 남으면 다음 커밋이 내용을 거듭 담는다 (회귀 문서화)", () => {
  const split = splitBlocks("둘째 블록.\n");
  const contaminated = new FakeElement(
    "div",
    [new FakeElement("p", [new FakeText("둘째 블록.")]), new FakeElement("p", [new FakeText("마지막")])],
    { "data-block-index": "0" },
  );
  const first = commitEditable(el(contaminated), split);
  assert.equal(first, "둘째 블록.\n\n마지막\n");

  // 재마운트가 안 됐다고 가정 - 같은(고아 노드 그대로인) DOM을 새 split에 대고 다시 커밋한다.
  const resplit = splitBlocks(first);
  const second = commitEditable(el(contaminated), resplit);
  assert.equal(second, "둘째 블록.\n\n마지막\n\n마지막\n"); // "마지막"이 한 번 더 - 고아 DOM이 문제다
});

test("editSurfaceId — data-head/data-block-index/그 밖(빈 칸) 셋을 가른다", () => {
  const head = new FakeElement("div", [], { "data-head": "" });
  const block = new FakeElement("div", [], { "data-block-index": "3" });
  const empty = new FakeElement("div", []);
  assert.equal(editSurfaceId(el(head)), "head");
  assert.equal(editSurfaceId(el(block)), "block:3");
  assert.equal(editSurfaceId(el(empty)), "empty");
});

// 위키링크 되읽기 — DESIGN.md §비주얼 §50 §되읽기, 요구 `9f2f41ed`(티켓 `40eef885`). `lib/markdown-wikilinks.ts`의
// `wikilinks()`가 새기는 표식(산 링크는 `a`+`data-wikilink`, 댕글링은 `span`+`data-wikilink`+`title`)을
// 손으로 흉낸다 — 그 플러그인 자체의 변환은 `markdown-wikilinks.test.ts`가 잰다. 여기서 재는 것은
// `domToMarkdown`이 그 표식을 원문으로 되돌리는 새 갈래 하나다.
function fakeWikilinkAnchor(raw: string, href: string | undefined): FakeElement {
  const bar = raw.indexOf("|");
  const namePart = (bar === -1 ? raw : raw.slice(0, bar)).trim();
  const display = (bar === -1 ? raw : raw.slice(bar + 1)).trim();
  const name = namePart.replace(/\.md$/, "");
  return href
    ? new FakeElement("a", [new FakeText(display)], { href, "data-wikilink": name })
    : new FakeElement("span", [new FakeText(display)], { "data-wikilink": name, title: "대상 없음" });
}

for (const [label, raw, href] of [
  ["단일 이름", "보드", "/p/dira/ontology?file=objects/화면/보드.md"],
  ["상대경로", "화면/보드", "/p/dira/ontology?file=objects/화면/보드.md"],
  ["끝 .md", "티켓 상태 전이.md", "/p/dira/ontology?file=objects/티켓 상태 전이.md"],
  ["별칭", "대상|별칭", "/p/dira/ontology?file=objects/대상.md"],
  ["댕글링", "없는 이름", undefined],
] as const) {
  test(`domToMarkdown — [[${raw}]] 왕복 항등 (${label})`, () => {
    const source = `[[${raw}]]\n`;
    const split = splitBlocks(source);
    const original = split.blocks[0];
    const root = new FakeElement("div", [new FakeElement("p", [fakeWikilinkAnchor(raw, href)])], {
      "data-block-index": "0",
    });
    assert.equal(domToMarkdown(el(root), original), original);
  });
}

test("domToMarkdown — 코드 스팬 [[...epic]]은 위키링크 변환 밖이라 한 픽셀도 안 바뀐다", () => {
  const source = "`[[...epic]]`\n";
  const split = splitBlocks(source);
  const root = new FakeElement(
    "div",
    [new FakeElement("p", [new FakeElement("code", [new FakeText("[[...epic]]")])])],
    { "data-block-index": "0" },
  );
  assert.equal(domToMarkdown(el(root), split.blocks[0]), split.blocks[0]);
});

// 산문 속 해시-P번호 표식(§9 축 1-1) — `<MarkdownEditor>`는 `<Markdown>`에 `refs`를 안 넘기므로
// `lib/markdown-refs.ts refMarkers` 자체가 안 걸린다. 그래서 위지윅 DOM에는 표식 전용 요소가
// 아예 없고(평범한 텍스트 노드뿐), `domToMarkdown`이 되읽어도 원문이 한 바이트도 안 갈린다.
test("domToMarkdown — 표식 후보(8자 hex)도 편집기 DOM엔 특수 요소가 없어 그대로 왕복한다", () => {
  const source = "54ed135a 확인\n";
  const split = splitBlocks(source);
  const root = new FakeElement("div", [new FakeElement("p", [new FakeText("54ed135a 확인")])], {
    "data-block-index": "0",
  });
  assert.equal(domToMarkdown(el(root), split.blocks[0]), split.blocks[0]);
});

test("domToMarkdown — data-wikilink 없는 보통 링크는 종전대로 [텍스트](href)다 (회귀 0)", () => {
  const source = "[텍스트](https://example.com)\n";
  const split = splitBlocks(source);
  const root = new FakeElement(
    "div",
    [new FakeElement("p", [new FakeElement("a", [new FakeText("텍스트")], { href: "https://example.com" })])],
    { "data-block-index": "0" },
  );
  assert.equal(domToMarkdown(el(root), split.blocks[0]), split.blocks[0]);
});
