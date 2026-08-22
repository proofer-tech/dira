/** `<Markdown>` 산문 속 티켓 해시-P번호 표식 (DESIGN.md §9, §비주얼 §31 §산문 안의 해시,
 *  요구 `cadd5e04`). 순수 함수만 여기 있다 — 클라이언트 번들에 들어가므로 `node:fs`를 절대
 *  타면 안 된다(`lib/urls.ts` 머리말과 같은 경계). 큐-에픽 README를 실제로 읽어 `RefIndex`를
 *  채우는 자리는 `lib/epics.ts`의 `resolveMarkdownRefs`다(그 파일은 이미 fs를 탄다).
 *
 *  `lib/markdown-wikilinks.ts`와 짝이지만 갈리는 자리가 셋이다 - 코드 스팬 안도 잡는다(§9),
 *  탐지 자체가 <이 8자가 큐에 있나>라는 조회가 필요해서 `known` 집합을 받는다, 값이 이름 하나가
 *  아니라 카드 슬롯 넷이라 `RefIndex`가 그 값을 들고 온다. */
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

/** 티켓 5상태 중 카드가 쓰는 값(§2 6종에서 `blocked`가 갈린다: deps 미충족은 `blocked`,
 *  답변 대기는 `awaiting`). 워커-연결 상태는 이 자리에 안 온다 — `components/status-badge.tsx`의
 *  `Status`보다 좁은 부분집합이라 구조적으로 그 타입에 대입된다(문자열 리터럴 유니온이라
 *  import 없이도 호환된다 - `lib/`가 `components/`를 참조하지 않는 경계, 위 `urls.ts`와 같다). */
export type TicketRefStatus = "open" | "blocked" | "awaiting" | "assigned" | "wip" | "done";

export type TicketRefValue = {
  stem: string;
  href: string;
  /** 표식 아이콘(3종 - 파일 상태) */
  state: "open" | "wip" | "done";
  /** 호버 카드 슬롯 1의 `<StatusBadge>` 값(6종) */
  status: TicketRefStatus;
  /** `status === "awaiting"`일 때만 있다 */
  days?: number;
  title: string;
  /** `#`으로 시작하는 줄을 건너뛴 원문 그대로. 본문이 전부 헤더뿐이면 없다 */
  bodyPreview?: string;
  assignee: { name: string; squad: boolean };
};

export type EpicRefValue = {
  epic: string;
  href: string;
  /** `README.md` 없으면 null — 카드가 `제목 없음`으로 대신한다 */
  title: string | null;
  /** 제목 줄 뒤 본문. 없으면 null */
  body: string | null;
  counts: { open: number; wip: number; done: number };
};

export type RefIndex = { tickets: Record<string, TicketRefValue>; epics: Record<string, EpicRefValue> };

export type RefSegment =
  | { type: "text"; value: string }
  | { type: "ticket"; stem: string }
  | { type: "epic"; epic: string };

export type KnownRefs = { tickets: ReadonlySet<string>; epics: ReadonlySet<string> };

/** 경계는 한 벌 - 앞뒤가 `[0-9A-Za-z_-]`가 아니거나 글의 끝(§9 §무엇을 잡나). 룩어라운드
 *  하나로 `w4-1d21592f` · `re-abc12345` · `P303-1` 셋 다를 지운다 - 하이픈이 그 경계 문자
 *  집합 안이라서 세 예시 모두 앞뒤 어느 한쪽이 그 집합에 걸린다. */
const REF_RE = /(?<![0-9A-Za-z_-])(?:([0-9a-f]{8})|P([0-9]+))(?![0-9A-Za-z_-])/g;

/** 글자를 조각으로 가르는 순수 함수(§9 Done when ①) - `known`에 있는 stem·P번호만 조각이
 *  되고, 나머지는 앞뒤 텍스트 조각에 그대로 남는다(분리하지 않는다 - 값이 안 바뀐다). */
export function splitRefs(text: string, known: KnownRefs): RefSegment[] {
  const segments: RefSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(REF_RE)) {
    const stem = m[1];
    const epic = m[2] !== undefined ? `P${m[2]}` : undefined;
    const isKnown = stem ? known.tickets.has(stem) : epic ? known.epics.has(epic) : false;
    if (!isKnown) continue;
    if (m.index > last) segments.push({ type: "text", value: text.slice(last, m.index) });
    segments.push(stem ? { type: "ticket", stem } : { type: "epic", epic: epic! });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

/** `known` 없이 8자 hex나 `P숫자` 꼴이 한 조각이라도 보이는가 - 값싼 사전 검사다. 세션
 *  스트림-홈 폴링(§9 §클라이언트가 폴링하는 자리)이 새로 온 글만 이 검사를 거쳐, 걸리는
 *  회차에만 `listTickets`-`resolveMarkdownRefs`의 진짜 비용을 문다. 대부분의 폴링 회차는
 *  새 글에 그 모양이 없어 여기서 끝난다(큐 재스캔 0).
 *
 *  **공유 `REF_RE`를 직접 `.test()`하지 않는다** — 전역(`g`) 플래그 정규식은 `.test()`마다
 *  `lastIndex`를 옮기고, `splitRefs`의 `matchAll`은 그 값을 시작점으로 그대로 물려받는다
 *  (`RegExp.prototype[Symbol.matchAll]`이 원본의 `lastIndex`를 복제본에 넘기는 스펙 동작 —
 *  실측: 이 함수가 `REF_RE.test`를 직접 쓰자 바로 다음 `splitRefs` 호출이 문자열 앞부분을
 *  건너뛰었다). 매번 새 인스턴스라 상태를 안 남긴다. */
export function mayHaveRefs(text: string): boolean {
  return new RegExp(REF_RE.source).test(text);
}

/** 한 텍스트에 실제로 나온 stem·P번호만 모은다(§9 §화면이 해석해서 내려준다) - 렌더 전에
 *  `RefIndex`를 채울 값의 범위를 정하는 자리. `splitRefs`를 그대로 재사용해 판정을 한 벌로 둔다. */
export function collectRefs(text: string, known: KnownRefs): { tickets: Set<string>; epics: Set<string> } {
  const tickets = new Set<string>();
  const epics = new Set<string>();
  for (const seg of splitRefs(text, known)) {
    if (seg.type === "ticket") tickets.add(seg.stem);
    if (seg.type === "epic") epics.add(seg.epic);
  }
  return { tickets, epics };
}

/** 카드 슬롯 3(§9 §누르면 - 호버하면) - `#`으로 시작하는 줄과 빈 줄을 앞에서만 건너뛰고 첫
 *  산문 줄부터 원문 그대로 돌려준다. 본문이 헤더-빈 줄뿐이면 undefined(슬롯이 통째로 빠진다). */
export function bodyPreview(body: string): string | undefined {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trim().startsWith("#"))) i++;
  const rest = lines.slice(i).join("\n").trim();
  return rest || undefined;
}

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };

/** 코드 스팬(`inlineCode`) 전체가 정확히 하나의 known 참조일 때만 그 세그먼트를 돌려준다 -
 *  부분 일치는 안 건드린다(이 큐의 백틱 해시는 항상 스팬 전체가 8자다, §9 §무엇을 잡나). */
function wholeRef(value: string, known: KnownRefs): RefSegment | null {
  const segs = splitRefs(value, known);
  return segs.length === 1 && segs[0].type !== "text" ? segs[0] : null;
}

/** remark 플러그인 - `index`가 비어 있으면(호출부가 `refs`를 안 주거나 이 글에 참조가
 *  없으면) 트리를 안 건드린다(`lib/markdown-wikilinks.ts`의 `vault` 없음 분기와 같은 계약).
 *  텍스트 노드와 코드 스팬 노드만 훑고, 이미 링크인 자리(`link` mdast 노드 - 위키링크가 만든
 *  `wikilink` 노드는 `children`이 없어 아래 가드에 이미 걸린다)와 펜스(`code` 노드도
 *  `children`이 없다)는 안 들어간다 - `lib/markdown-wikilinks.ts transform`과 같은 경계. */
export function refMarkers(index: RefIndex, locale: Locale = DEFAULT_LOCALE) {
  const known: KnownRefs = { tickets: new Set(Object.keys(index.tickets)), epics: new Set(Object.keys(index.epics)) };

  // `hName`은 진짜 HTML 태그(`a`)다 — `react-markdown`의 `Components` 타입이
  // `JSX.IntrinsicElements`로 닫혀 있어 새 태그 이름을 못 받는다(위키링크가 `a`·`span`만 쓰는
  // 이유와 같다). `components/markdown.tsx`의 `a` 핸들러가 `queueref` 프로퍼티 유무로 갈라
  // `<QueueRef>`로 넘긴다 — 실제 DOM에는 이 프로퍼티가 안 나간다(컴포넌트가 가로챈다).
  function markerNode(seg: RefSegment, coded: boolean): Node {
    const value = seg.type === "ticket" ? index.tickets[seg.stem] : index.epics[(seg as { epic: string }).epic];
    return {
      type: "queueref",
      data: {
        hName: "a",
        hProperties: { queueref: { kind: seg.type, value, coded, locale } },
        hChildren: [],
      },
    };
  }

  function walk(node: Node): void {
    if (node.type === "link" || !node.children) return;
    node.children = node.children.flatMap((c) => {
      if (c.type === "inlineCode" && typeof c.value === "string") {
        const ref = wholeRef(c.value, known);
        return ref ? [markerNode(ref, true)] : [c];
      }
      if (c.type !== "text" || !c.value) {
        walk(c);
        return [c];
      }
      const segs = splitRefs(c.value, known);
      if (segs.length === 1 && segs[0].type === "text") return [c];
      return segs.map((s): Node => (s.type === "text" ? { type: "text", value: s.value } : markerNode(s, false)));
    });
  }

  return () => (tree: unknown) => {
    if (!known.tickets.size && !known.epics.size) return;
    walk(tree as Node);
  };
}

/** 표식 안 `sr-only` 문구(§비주얼 §31 §상태 표식 3종) - 6종 라벨(`status.label.*`)과 같은
 *  i18n 키를 재사용한다(파일 상태 3종의 말이 그 키들과 그대로 같다). */
export const stateLabel = (state: "open" | "wip" | "done", locale: Locale) =>
  t(locale, `status.label.${state}` as const);
