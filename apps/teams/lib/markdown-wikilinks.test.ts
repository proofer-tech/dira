/** `wikilinks`를 진짜 `react-markdown` 파이프라인에 걸어 HTML까지 낸다(`markdown-breaks.test.ts`와
 *  같은 방식) — 손트리가 아니라 실제 mdast가 이 모양인지를 잰다. */
import { test } from "node:test";
import assert from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { buildVault, wikilinks, type Vault } from "./markdown-wikilinks.ts";

function html(text: string, vault?: Vault) {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: vault ? [wikilinks(vault)] : [] }, text)
  );
}

test("vault를 안 주면 `[[이름]]`이 글자 그대로다", () => {
  assert.equal(html("[[철수]]"), "<p>[[철수]]</p>");
});

test("대상이 있으면 `a` - href·data-wikilink", () => {
  assert.equal(
    html("[[철수]]", { 철수: "/p/1/ontology?file=objects/person/철수.md" }),
    '<p><a href="/p/1/ontology?file=objects/person/철수.md" data-wikilink="철수">철수</a></p>'
  );
});

test("대상이 없으면(댕글링) `span` - href 없이 title", () => {
  assert.equal(
    html("[[없음]]", {}),
    '<p><span data-wikilink="없음" title="대상 없음">없음</span></p>'
  );
});

test("`[[이름|별칭]]` - 보이는 글자는 별칭, 찾는 값은 앞쪽", () => {
  assert.equal(
    html("[[철수|그 사람]]", { 철수: "/p/1/ontology?file=objects/person/철수.md" }),
    '<p><a href="/p/1/ontology?file=objects/person/철수.md" data-wikilink="철수">그 사람</a></p>'
  );
});

test("끝의 `.md`는 떼고 찾는다", () => {
  assert.equal(
    html("[[철수.md]]", { 철수: "/p/1/ontology?file=objects/person/철수.md" }),
    '<p><a href="/p/1/ontology?file=objects/person/철수.md" data-wikilink="철수">철수.md</a></p>'
  );
});

test("코드 스팬·펜스 안은 안 건드린다", () => {
  const vault: Vault = { 철수: "/x" };
  assert.match(html("`[[철수]]`", vault), /<code>\[\[철수\]\]<\/code>/);
  assert.match(html("```\n[[철수]]\n```", vault), /<pre><code>\[\[철수\]\]\n<\/code><\/pre>/);
});

const toHref = (rel: string) => `/p/1/ontology?file=${rel}`;

test("buildVault - 전체 상대경로와 마지막 세그먼트 둘 다로 찾는다", () => {
  const vault = buildVault([{ rel: "objects/화면/보드.md", isDir: false }], toHref);
  assert.deepEqual(vault, {
    보드: "/p/1/ontology?file=objects/화면/보드.md",
    "화면/보드": "/p/1/ontology?file=objects/화면/보드.md",
    "objects/화면/보드": "/p/1/ontology?file=objects/화면/보드.md",
  });
});

test("buildVault - 후보가 둘이면 상대경로 사전순 첫째", () => {
  const vault = buildVault(
    [
      { rel: "objects/화면/보드.md", isDir: false },
      { rel: "objects/에픽/보드.md", isDir: false },
    ],
    toHref,
  );
  assert.equal(vault["보드"], "/p/1/ontology?file=objects/에픽/보드.md");
});

test("buildVault - 디렉터리와 .md 아닌 파일은 뺀다", () => {
  const vault = buildVault(
    [
      { rel: "objects/화면", isDir: true },
      { rel: "objects/화면/보드.png", isDir: false },
    ],
    toHref,
  );
  assert.deepEqual(vault, {});
});
