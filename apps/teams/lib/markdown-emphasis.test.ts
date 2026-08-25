/** `closeEmphasis`를 진짜 `react-markdown` 파이프라인에 걸어 HTML까지 낸다(`markdown-breaks.test.ts`와
 *  같은 방식). §10 §수용조건 다섯 줄을 판정한다. 실패했던 줄 둘(AC1·AC2)은 지어낸 문장이 아니라
 *  이 큐의 실제 `.done` 티켓에서 그대로 뽑았다 - `.dira/tickets/a1927a60.done.md:36`(원인이 된
 *  버그 리포트 원문)과 `.dira/tickets/000e3666.done.md:89`·`0146fd70.done.md:26`(같은 결함이
 *  실제로 걸린 산문). */
import { test } from "node:test";
import assert from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { closeEmphasis } from "./markdown-emphasis.ts";
import { softBreaks } from "./markdown-breaks.ts";
import { wikilinks } from "./markdown-wikilinks.ts";
import { refMarkers, type RefIndex } from "./markdown-refs.ts";

function html(text: string, plugins: unknown[] = [closeEmphasis]) {
  return renderToStaticMarkup(createElement(Markdown, { remarkPlugins: plugins }, text));
}

// 변경 전 값 — DESIGN.md §10 §실측 표의 원인 그대로(플러그인 없이 그대로 두면 `**`가 안 닫힌다).
test("플러그인 없으면 종전대로 `**`가 글자로 남는다 — §10 본칙(변경 전)", () => {
  assert.equal(
    html("**릴리스된 최신 버전은 `v1.0.29`**입니다.", []),
    "<p>**릴리스된 최신 버전은 <code>v1.0.29</code>**입니다.</p>",
  );
});

// §10 §수용조건 1 — `.dira/tickets/a1927a60.done.md:36`의 버그 리포트 원문.
test("수용조건 1 — 코드 스팬을 낀 `**`가 strong 하나로 뜬다(`**`가 안 남는다)", () => {
  assert.equal(
    html("**릴리스된 최신 버전은 `v1.0.29`**입니다."),
    "<p><strong>릴리스된 최신 버전은 <code>v1.0.29</code></strong>입니다.</p>",
  );
});

// 같은 결함의 실측 사례 — `.dira/tickets/000e3666.done.md:89`.
test("수용조건 1 — 코드 스팬 뒤에 조사가 바로 붙어도 닫힌다(실측)", () => {
  assert.equal(html("**`미할당`**이라 부르고"), "<p><strong><code>미할당</code></strong>이라 부르고</p>");
});

// §10 §수용조건 2 — `.dira/tickets/0146fd70.done.md:26`의 실측 산문.
test("수용조건 2 — 인용을 낀 홑 `*`가 em으로 뜨고 `*`가 안 남는다", () => {
  assert.equal(
    html('*"사람의 편집이 원인인 사례는 문서화된 것이 없다"*고 쓸 뻔했다'),
    "<p><em>&quot;사람의 편집이 원인인 사례는 문서화된 것이 없다&quot;</em>고 쓸 뻔했다</p>",
  );
});

// §10 §수용조건 3 — 티켓 `## Done when`이 든 그대로(`2 * 3`·홀로 선 `**`).
test("수용조건 3 — 짝이 없는 구분자는 글자로 남는다", () => {
  assert.equal(html("2 * 3"), "<p>2 * 3</p>");
  assert.equal(html("문단에 홀로 선 ** 구분자"), "<p>문단에 홀로 선 ** 구분자</p>");
});

// §10 §수용조건 4.
test("수용조건 4 — 코드 스팬 안의 `**`는 한 자도 안 갈린다", () => {
  assert.equal(html("`**굵게 안 보임**`"), "<p><code>**굵게 안 보임**</code></p>");
});

test("수용조건 4 — 펜스 안의 `**`는 한 자도 안 갈린다", () => {
  const fence = "```\n**굵게 안 보임**\n```";
  assert.equal(html(fence), html(fence, []));
});

test("`remarkGfm` 다음 · `softBreaks`·`wikilinks` 앞에 끼워도 뒤 플러그인이 종전대로 돈다", () => {
  const out = html("**대상은 [[철수]]**\n둘째 줄", [
    remarkGfm,
    closeEmphasis,
    softBreaks("all"),
    wikilinks({ 철수: "/p/1/ontology?file=objects/person/철수.md" }),
  ]);
  assert.equal(
    out,
    '<p><strong>대상은 <a href="/p/1/ontology?file=objects/person/철수.md" data-wikilink="철수">철수</a></strong><br/>\n둘째 줄</p>',
  );
});

const refIndex: RefIndex = {
  tickets: {
    "54ed135a": {
      stem: "54ed135a",
      href: "/p/1/tickets/54ed135a",
      state: "done",
      status: "done",
      title: "제목",
      assignee: { name: "designer", squad: false },
    },
  },
  epics: {},
};

test("`refMarkers`도 이 변환 다음 자리에서 종전대로 돈다(코드 스팬 참조가 표식으로 뜬다)", () => {
  const out = html("**해시는 `54ed135a`**입니다", [remarkGfm, closeEmphasis, refMarkers(refIndex)]);
  assert.match(out, /^<p><strong>해시는 <a[^>]*queueref[^>]*>[\s\S]*<\/a><\/strong>입니다<\/p>$/);
});
