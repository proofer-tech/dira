import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `ticket-ui.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `workers-ui.test.ts`) — 그래서 소스에서 함수 본문을 그대로
// 뽑아 시그니처의 타입 표기만 지우고 실행한다(§비주얼 §61 (10) 항목 1).
const s = readFileSync("components/ticket-ui.tsx", "utf8");
const start = s.indexOf("function assignmentLabel");
const end = s.indexOf("\n}", start) + 2;
assert.ok(start > 0 && end > start, "assignmentLabel 함수를 못 찾았다");
const src = s
  .slice(start, end)
  .replace("(value: string | null): string {", "(value) {");
const assignmentLabel = new Function(`${src}\nreturn assignmentLabel;`)();

test("assignmentLabel — squad는 `스쿼드 <이름>`, persona는 이름만, 없으면 `없음`", () => {
  assert.equal(assignmentLabel("squad:frontend"), "스쿼드 frontend");
  assert.equal(assignmentLabel("persona:developer"), "developer");
  assert.equal(assignmentLabel(null), "없음");
});
