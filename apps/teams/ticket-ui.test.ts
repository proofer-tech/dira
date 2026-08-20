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

// `newTicketAssignmentDefault`는 내부에서 `assignmentValue`를 부르므로 둘 다 뽑아서 같이 이발한다.
const avStart = s.indexOf("function assignmentValue");
const avEnd = s.indexOf("\n}", avStart) + 2;
const assignmentValueSrc = s
  .slice(avStart, avEnd)
  .replace(/function assignmentValue\([\s\S]*?\{/, "function assignmentValue(persona, squad) {");

const ntadStart = s.indexOf("function newTicketAssignmentDefault");
const ntadEnd = s.indexOf("\n}", ntadStart) + 2;
assert.ok(ntadStart > 0 && ntadEnd > ntadStart, "newTicketAssignmentDefault 함수를 못 찾았다");
const newTicketAssignmentDefaultSrc = s
  .slice(ntadStart, ntadEnd)
  .replace(/function newTicketAssignmentDefault\([\s\S]*\{/, "function newTicketAssignmentDefault(copy, squads) {");

const newTicketAssignmentDefault = new Function(
  `${assignmentValueSrc}\n${newTicketAssignmentDefaultSrc}\nreturn newTicketAssignmentDefault;`,
)();

test("newTicketAssignmentDefault — (D3) default 스쿼드가 있으면 그것, 없으면 없음", () => {
  assert.equal(newTicketAssignmentDefault(undefined, ["default", "frontend"]), "squad:default");
  assert.equal(newTicketAssignmentDefault(undefined, ["frontend"]), null);
  assert.equal(newTicketAssignmentDefault(undefined, []), null);
});

test("newTicketAssignmentDefault — 복제는 원본 값이 이긴다, 둘 다 빈 원본은 없음", () => {
  assert.equal(
    newTicketAssignmentDefault({ persona: "developer", squad: "" }, ["default"]),
    "persona:developer",
  );
  assert.equal(newTicketAssignmentDefault({ persona: "", squad: "frontend" }, ["default"]), "squad:frontend");
  assert.equal(newTicketAssignmentDefault({ persona: "", squad: "" }, ["default"]), null);
});
