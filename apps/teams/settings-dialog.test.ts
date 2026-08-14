import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `settings-dialog.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts`) — 그래서 소스 글자를 댄다.
// §0-13 §`추가`를 다시 열면 지난 시도가 안 보인다 — 다이얼로그 닫힘·팝오버 열림 두 갈래가
// 층 ②-③ 상태 다섯을 비우는 손 하나를 나눠 쓰고, 그 손은 발급이 도는 중(`setup.running`)이면
// 아무것도 안 비운다. 팝오버를 여는 자리는 `stopSetupAction()`을 부르지 않는다 —
// `startSetup()` 첫 줄이 이미 `stopSetup()`을 부른다(`lib/auth.ts:531`).
const s = readFileSync("components/settings-dialog.tsx", "utf8");

const fnStart = s.indexOf("const resetAddAttempt = () => {");
assert.ok(fnStart >= 0, "resetAddAttempt를 못 찾았다");
const fnEnd = s.indexOf("\n  };", fnStart);
assert.ok(fnEnd > fnStart, "resetAddAttempt 닫는 자리를 못 찾았다");
const fnBody = s.slice(fnStart, fnEnd);

test("resetAddAttempt가 setup.running이면 아무것도 안 비운다", () => {
  assert.match(fnBody, /if \(setup\?\.running\) return;/);
});

test("resetAddAttempt가 층 ②-③ 상태 다섯을 비운다", () => {
  for (const call of [
    'setToken("")',
    'setLabel("")',
    "setResult({})",
    'setCode("")',
    "setSetup(null)",
  ]) {
    assert.ok(fnBody.includes(call), `resetAddAttempt가 ${call}을 안 부른다`);
  }
});

test("다이얼로그 닫힘 갈래와 팝오버 열림 갈래가 resetAddAttempt() 하나를 나눠 쓴다", () => {
  const calls = s.match(/resetAddAttempt\(\)/g) ?? [];
  // 정의 한 줄(`const resetAddAttempt = () => {`)은 위 매치에 안 걸린다 — 괄호 뒤가 `{`가
  // 아니라 실제 호출 두 자리(다이얼로그 닫힘 · 팝오버 열림)만 걸린다.
  assert.equal(calls.length, 2, `resetAddAttempt() 호출이 2곳이어야 하는데 ${calls.length}곳이다`);
});

test("팝오버가 열릴 때 stopSetupAction()을 안 부른다", () => {
  const popoverStart = s.indexOf("<Popover");
  const popoverOpenChangeEnd = s.indexOf("setAddOpen(o);", popoverStart);
  assert.ok(popoverOpenChangeEnd > popoverStart, "Popover onOpenChange를 못 찾았다");
  const popoverOnOpenChange = s.slice(popoverStart, popoverOpenChangeEnd);
  // 주석은 근거 설명에 `stopSetupAction()`이라는 글자를 그대로 인용한다 — 실제 호출 형태
  // (다이얼로그 닫힘 갈래의 `void stopSetupAction();`)만 없는지 본다.
  assert.ok(!popoverOnOpenChange.includes("void stopSetupAction"));
  assert.ok(popoverOnOpenChange.includes("resetAddAttempt()"));
});

test("다이얼로그가 닫힐 때는 여전히 stopSetupAction()을 부른다", () => {
  const dialogClose = s.slice(s.indexOf("} else {"), s.indexOf("}\n      }}"));
  assert.ok(dialogClose.includes("resetAddAttempt();"));
  assert.ok(dialogClose.includes("void stopSetupAction();"));
});
