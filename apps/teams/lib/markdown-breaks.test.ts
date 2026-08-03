/** `softBreaks`를 **진짜 파이프라인에서** 판정한다 — 손으로 지은 트리가 아니라 `react-markdown`이
 *  실제로 만드는 mdast에 걸어 HTML까지 낸다. 손트리로 재면 "mdast가 정말 이 모양인가"가 안 잡힌다.
 *  `react-markdown`·`react-dom`은 직접 의존이고 JSX가 없어 `node --test`가 그대로 읽는다. */
import { test } from "node:test";
import assert from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { softBreaks } from "./markdown-breaks.ts";

function html(text: string, mode?: "all" | "untilHeading") {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: mode ? [softBreaks(mode)] : [] }, text)
  );
}

test("기본값(플러그인 없음)은 소프트 줄바꿈을 합친다 — §10 본칙", () => {
  assert.equal(html("가\n나\n다"), "<p>가\n나\n다</p>");
});

// `<br/>` 뒤의 `\n`은 `mdast-util-to-hast`가 넣는 것이다(HTML에서 안 보인다). 값을 그대로 적는다.
test("`all`은 사람이 친 세 줄을 세 줄로 그린다", () => {
  assert.equal(html("가\n나\n다", "all"), "<p>가<br/>\n나<br/>\n다</p>");
});

test("`untilHeading`은 첫 `##` 앞에서 멈춘다 — 뒤 문단은 합쳐진 채다", () => {
  const out = html("가\n나\n\n## 질문 1\n\n손으로\n감은 문단", "untilHeading");
  assert.equal(out, "<p>가<br/>\n나</p>\n<h2>질문 1</h2>\n<p>손으로\n감은 문단</p>");
});

test("코드 펜스는 `all`에서도 안 바뀐다 — 안쪽은 문법이 아니라 내용이다", () => {
  const fence = "```\n가\n나\n```";
  assert.equal(html(fence, "all"), html(fence));
});

test("목록·인용 안쪽까지 들어간다(`all`)", () => {
  assert.match(html("- 가\n  나", "all"), /가<br\/>\n나/);
  assert.match(html("> 가\n> 나", "all"), /가<br\/>\n나/);
});
