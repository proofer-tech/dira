import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `self-heal.tsx`는 "use client" + next/CSS를 끌고 오는 컴포넌트라 import를 못 댄다
// (선례 `workers-ui.test.ts`) — 그래서 소스 글자를 댄다.
// 티켓 948145ab(§0-25 결정 7-8): 왕복이 둘로 갈린다 — 실패 사유를 먼저 쥐어 카드를 띄우고,
// 그 카드 위에서 `runSelfHeal`이 돌고, `ticketed`가 아닐 때만 원래 조작을 한 번 더 부른다.
// 여기서 고정하는 것은 그 순서 자체다 — 눈으로 보이지 않는 회귀라 소스 검사로 고정한다.
const s = readFileSync("components/self-heal.tsx", "utf8");
const runStart = s.indexOf("async function run<T>(");
const runBody = s.slice(runStart, s.indexOf("\n  return { error, fixing, setError, run };"));

test("useSelfHealRetry — 실패 사유를 먼저 쥔 뒤에야 runSelfHeal을 부른다(카드가 A/S보다 먼저 뜬다)", () => {
  const setErrorIdx = runBody.indexOf("setError(firstError)");
  const runSelfHealIdx = runBody.indexOf("runSelfHeal(");
  assert.ok(setErrorIdx > 0, "setError(firstError) 호출을 못 찾았다");
  assert.ok(runSelfHealIdx > setErrorIdx, "runSelfHeal이 setError(firstError)보다 먼저다");
});

test("useSelfHealRetry — 성공하면 카드를 지운다(setError(null))", () => {
  assert.match(runBody, /if \(!firstError\) \{\s*setError\(null\);\s*return first;/);
});

test("useSelfHealRetry — ticketed면 원래 조작을 다시 안 부른다", () => {
  const ticketedIdx = runBody.indexOf('outcome === "ticketed"');
  assert.ok(ticketedIdx > 0, 'outcome === "ticketed" 분기를 못 찾았다');
  const afterTicketed = runBody.slice(ticketedIdx, ticketedIdx + 40);
  assert.match(afterTicketed, /return first;/, "ticketed 분기가 first를 그대로 안 돌려준다");
  const secondAttemptIdx = runBody.indexOf("const second = await attempt();");
  assert.ok(secondAttemptIdx > ticketedIdx, "재시도 호출이 ticketed 분기보다 앞에 있다");
});

test("useSelfHealRetry — ticketed가 아니면 원래 조작을 정확히 한 번 더 부른다", () => {
  const attemptCalls = runBody.match(/attempt\(\)/g) ?? [];
  assert.equal(attemptCalls.length, 2, "attempt() 호출이 2번(첫 시도 + 재시도)이 아니다");
});

test("SelfHealAlert — 표식 문구가 fixing이 참일 때만 뜨고, 오류 문구는 늘 남는다", () => {
  const alertStart = s.indexOf("export function SelfHealAlert(");
  const alertBody = s.slice(alertStart, s.indexOf("export function useSelfHealRetry"));
  assert.match(alertBody, /\{error\}/, "오류 문구가 조건 없이 안 뜬다");
  assert.match(alertBody, /\{fixing && <span[^>]*>\{fixingText\}<\/span>\}/, "fixing 표식이 조건부로 안 뜬다");
});
