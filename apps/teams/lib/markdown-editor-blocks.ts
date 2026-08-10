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
  blocks: string[];
  /** 마지막 블록 뒤 나머지(대개 파일 끝 개행 하나) — 편집 대상이 아니라 그대로 보존한다 */
  tail: string;
  /** `lib/markdown-breaks.ts softBreaks("untilHeading")`와 같은 경계 — 첫 heading 블록의
   *  인덱스. 그 플러그인은 트리 전체를 보고 첫 heading 앞에서 멈추는데, 편집기는 블록을
   *  독립된 조각으로 렌더하므로 이 경계를 따로 들고 있다가 블록마다 breaks를 나눠 준다.
   *  heading이 없으면 null(전부 heading 앞이다). */
  firstHeadingIndex: number | null;
}

export function splitBlocks(source: string): SplitResult {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  const blocks: string[] = [];
  let cursor = 0;
  let firstHeadingIndex: number | null = null;
  for (const child of tree.children) {
    const end = child.position?.end.offset;
    if (end == null || end < cursor) continue;
    if (firstHeadingIndex === null && child.type === "heading") firstHeadingIndex = blocks.length;
    blocks.push(source.slice(cursor, end));
    cursor = end;
  }
  return { blocks, tail: source.slice(cursor), firstHeadingIndex };
}

/** 블록 배열 + 꼬리를 원문으로 되돌린다. */
export function joinBlocks({ blocks, tail }: Pick<SplitResult, "blocks" | "tail">): string {
  return blocks.join("") + tail;
}

/** 인덱스 하나만 갈아 끼운 전체 문자열. 나머지 블록은 손 안 댄 슬라이스라 그 밖 바이트가 안 갈린다
 *  (못 ① 둘째 반쪽 — "고친 자리 밖에서 바이트가 안 갈린다"). */
export function replaceBlock(split: SplitResult, index: number, newBlockText: string): string {
  const blocks = split.blocks.slice();
  blocks[index] = newBlockText;
  return joinBlocks({ blocks, tail: split.tail });
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
