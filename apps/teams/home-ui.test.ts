import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `home-ui.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `workers-ui.test.ts`) — 그래서 소스 글자를 댄다.
//
// 티켓 ba589e61(요구 `9cbb775d`): 우측 탭 줄에서 탭을 눌러도 활성 표식이 안 옮겨 가던
// 원인은 `selectTab`의 `chat` 분기다 — `current`(로드된 대화)와 `activeTab`(탭 줄 표식)이
// 다른 값인데, 파일·터미널 탭으로 옮겨간 뒤 **이미 로드돼 있던 그 대화 탭**을 다시 누르면
// `tab.id === home.current`가 참이라 그냥 `return`했고, `activeTab`을 옮기는 왕복
// (`focusTabAction`)을 아예 안 타서 표식이 옛 탭에 그대로 남았다. 여기서 고정하는 것은
// 그 갈래가 `return`하기 전에 `focusTabAction`을 반드시 거친다는 것 하나다.
const s = readFileSync("components/home-ui.tsx", "utf8");
const a = s.indexOf("const selectTab = async (tab: Tab) => {");
const b = s.indexOf("\n  };", a);
assert.ok(a >= 0 && b > a, "home-ui.tsx: selectTab 구간을 못 찾았다");
const body = s.slice(a, b);

test("selectTab — chat 탭이 이미 home.current여도 activeTab을 옮기는 focusTabAction을 거친다", () => {
  const alreadyCurrent = body.slice(body.indexOf("tab.id === home.current"));
  const nextReturn = alreadyCurrent.indexOf("return;");
  const focusCall = alreadyCurrent.indexOf("focusTabAction");
  assert.ok(focusCall >= 0 && focusCall < nextReturn, "이미 로드된 대화 탭을 다시 눌러도 focusTabAction 없이 return한다");
});
