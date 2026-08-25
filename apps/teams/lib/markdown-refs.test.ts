/** `splitRefs`(§9 Done when ①)의 경계 실측 + `refMarkers`를 진짜 `react-markdown` 파이프라인에
 *  걸어 HTML까지 낸다(`markdown-wikilinks.test.ts`와 같은 방식). */
import { test } from "node:test";
import assert from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  bodyPreview,
  collectRefs,
  mayHaveRefs,
  refMarkers,
  splitRefs,
  type KnownRefs,
  type RefIndex,
} from "./markdown-refs.ts";

const known: KnownRefs = { tickets: new Set(["54ed135a", "0e95a853"]), epics: new Set(["P313"]) };

test("known stem은 조각이 된다", () => {
  assert.deepEqual(splitRefs("보다 54ed135a 앞선다", known), [
    { type: "text", value: "보다 " },
    { type: "ticket", stem: "54ed135a" },
    { type: "text", value: " 앞선다" },
  ]);
});

test("known P번호는 조각이 된다", () => {
  assert.deepEqual(splitRefs("P313을 열었다", known), [
    { type: "epic", epic: "P313" },
    { type: "text", value: "을 열었다" },
  ]);
});

test("큐에 없는 8자 hex는 조각이 안 된다(커밋 해시 등)", () => {
  assert.deepEqual(splitRefs("커밋 deadbeef 하나", known), [{ type: "text", value: "커밋 deadbeef 하나" }]);
});

test("없는 P번호(P999)는 조각이 안 된다", () => {
  assert.deepEqual(splitRefs("P999는 없다", known), [{ type: "text", value: "P999는 없다" }]);
});

test("세션 id `w4-1d21592f`는 안 잡는다 — 앞의 `-`가 경계 문자다", () => {
  const k: KnownRefs = { tickets: new Set(["1d21592f"]), epics: new Set() };
  assert.deepEqual(splitRefs("w4-1d21592f", k), [{ type: "text", value: "w4-1d21592f" }]);
});

test("폴백 표기 `re-abc12345`는 안 잡는다", () => {
  const k: KnownRefs = { tickets: new Set(["abc12345"]), epics: new Set() };
  assert.deepEqual(splitRefs("re-abc12345", k), [{ type: "text", value: "re-abc12345" }]);
});

test("로드맵 행 `P303-1`은 안 잡는다 — 뒤의 `-`가 경계 문자다", () => {
  const k: KnownRefs = { tickets: new Set(), epics: new Set(["P303"]) };
  assert.deepEqual(splitRefs("P303-1", k), [{ type: "text", value: "P303-1" }]);
});

test("mayHaveRefs — known 없이도 8자 hex·P번호 모양이면 참", () => {
  assert.equal(mayHaveRefs("아무 말도 없다"), false);
  assert.equal(mayHaveRefs("54ed135a를 봤다"), true);
  assert.equal(mayHaveRefs("P313을 봤다"), true);
  assert.equal(mayHaveRefs("w4-1d21592f"), false); // 경계 문자에 걸려 애초에 조각이 안 된다
});

test("mayHaveRefs — 두 번 불러도 매번 같은 값이다(전역 정규식 lastIndex 부작용 없음)", () => {
  const text = "54ed135a";
  assert.equal(mayHaveRefs(text), true);
  assert.equal(mayHaveRefs(text), true);
});

test("collectRefs — known만 모은다, 중복은 한 번", () => {
  const hit = collectRefs("54ed135a와 54ed135a, P313, P999", known);
  assert.deepEqual([...hit.tickets], ["54ed135a"]);
  assert.deepEqual([...hit.epics], ["P313"]);
});

test("bodyPreview — `#` 줄과 빈 줄을 앞에서만 건너뛴다", () => {
  assert.equal(bodyPreview("\n## Goal\n\n첫 산문 줄이다.\n둘째 줄."), "첫 산문 줄이다.\n둘째 줄.");
});

test("bodyPreview — 헤더뿐이면 undefined", () => {
  assert.equal(bodyPreview("## Goal\n\n### 소절\n"), undefined);
});

const stem = "54ed135a";
const index: RefIndex = {
  tickets: {
    [stem]: {
      stem,
      href: "/p/1/tickets/54ed135a",
      state: "done",
      status: "done",
      title: "제목",
      assignee: { name: "designer", squad: false },
    },
  },
  epics: {
    P313: { epic: "P313", href: "/p/1/epics/P313", title: "제목", body: null, counts: { open: 0, wip: 0, done: 1 } },
  },
};

// 실제 렌더 컴포넌트 대신 판정에 필요한 속성만 노출하는 스텁 — `TicketRef`/`EpicRef`는
// `"use client"`라 `renderToStaticMarkup`에서 그대로 못 돌린다(hover-card가 상태를 쓴다).
// `refMarkers`는 `hName: "a"` + `queueref` 프로퍼티로 표식을 보낸다(`components/markdown.tsx`의
// `a` 핸들러와 같은 계약) — 진짜 링크는 그 프로퍼티가 없어 아래 폴백으로 떨어진다.
function html(text: string, idx: RefIndex = index) {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm, refMarkers(idx)],
        components: {
          a: (p: {
            href?: string;
            children?: unknown;
            queueref?: { kind: string; coded: boolean; value: { stem?: string; epic?: string } };
          }) =>
            p.queueref
              ? createElement(
                  "mark",
                  { "data-kind": p.queueref.kind, "data-coded": String(p.queueref.coded) },
                  p.queueref.kind === "ticket" ? p.queueref.value.stem : p.queueref.value.epic,
                )
              : createElement("a", { href: p.href }, p.children as never),
        },
      },
      text,
    ),
  );
}

test("맨 글자 위 - 표식이 뜬다", () => {
  assert.equal(
    html(`${stem} 확인`),
    '<p><mark data-kind="ticket" data-coded="false">54ed135a</mark> 확인</p>',
  );
});

test("코드 스팬 안 - 같은 표식, coded=true", () => {
  assert.equal(
    html(`\`${stem}\` 확인`),
    '<p><mark data-kind="ticket" data-coded="true">54ed135a</mark> 확인</p>',
  );
});

test("펜스 안은 안 건드린다", () => {
  assert.match(html(`\`\`\`\n${stem}\n\`\`\``), new RegExp(`<pre><code>${stem}\\n</code></pre>`));
});

test("이미 링크인 글자 안은 안 건드린다", () => {
  assert.equal(html(`[${stem}](https://x)`), `<p><a href="https://x">${stem}</a></p>`);
});

test("큐에 없는 해시는 한 픽셀도 안 바뀐다", () => {
  assert.equal(html("deadbeef 그대로"), "<p>deadbeef 그대로</p>");
});

test("에픽 P번호도 표식이 된다", () => {
  assert.equal(html("P313 진행"), '<p><mark data-kind="epic" data-coded="false">P313</mark> 진행</p>');
});

test("refs가 빈 인덱스면 트리를 안 건드린다", () => {
  assert.equal(html(stem, { tickets: {}, epics: {} }), `<p>${stem}</p>`);
});
