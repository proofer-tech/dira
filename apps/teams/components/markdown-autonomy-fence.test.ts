import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `markdown.tsx`는 "use client" 성질의 hooks(useState)와 JSX를 끌고 오는 컴포넌트라
// import를 못 댄다(선례 `components/self-heal.test.ts`) — 소스 글자를 댄다.
// P444-2: `pre` 분기가 `language-autonomy`일 때만 캡션 경로(복사 버튼 없음)를 타고,
// 그 외 언어는 여전히 `overflow-x-auto` + `CodeBlockCopyButton` 경로를 타는지 고정한다.
const s = readFileSync("components/markdown.tsx", "utf8");
const preStart = s.indexOf("pre: (p) => {");
const preBody = s.slice(preStart, s.indexOf("\n  // 래퍼는"));

test("pre — language-autonomy면 whitespace-pre-wrap 캡션이고 복사 버튼이 없다", () => {
  const ifIdx = preBody.indexOf('lang.includes("language-autonomy")');
  assert.ok(ifIdx > 0, "language-autonomy 분기를 못 찾았다");
  assert.match(preBody.slice(ifIdx, ifIdx + 400), /whitespace-pre-wrap/, "캡션 경로에 whitespace-pre-wrap이 없다");
  assert.match(preBody.slice(ifIdx, ifIdx + 400), /text-xs/, "캡션 경로에 text-xs가 없다");
  assert.doesNotMatch(
    preBody.slice(ifIdx, ifIdx + 400),
    /CodeBlockCopyButton/,
    "캡션 경로에 복사 버튼이 붙어 있다",
  );
});

test("pre — 다른 언어는 여전히 overflow-x-auto + CodeBlockCopyButton이다", () => {
  const fallbackIdx = preBody.lastIndexOf("overflow-x-auto");
  assert.ok(fallbackIdx > preBody.indexOf("language-autonomy"), "기본 경로가 분기보다 앞에 있다");
  assert.match(preBody.slice(fallbackIdx), /CodeBlockCopyButton/, "기본 경로에 복사 버튼이 없다");
});
