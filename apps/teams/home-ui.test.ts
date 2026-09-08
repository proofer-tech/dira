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

// 티켓 8e9a8736(요구 `52062bc6`): closeTab이 setSurface를 안 불러서, 탭은 닫혀도
// 몸통(surface)이 옛 자리에 남던 문제 — closeTab이 **닫은 탭이 활성 탭이었을 때만**
// 서버 응답의 activeTab을 selectTab과 같은 표(chat -> session, terminal -> terminal,
// file -> explorer)로 맞추는지 소스로 고정한다. 배경 탭을 닫을 때는 안 건드린다
// (§11-7 결정 4 — scm·schedules처럼 탭이 없는 표면을 보던 중 배경 탭을 닫아도 안 밀린다).
const closeA = s.indexOf("const closeTab = async (tab: Tab) => {");
const closeB = s.indexOf("\n  };", closeA);
assert.ok(closeA >= 0 && closeB > closeA, "home-ui.tsx: closeTab 구간을 못 찾았다");
const closeBody = s.slice(closeA, closeB);

test("closeTab — wasActive(닫은 탭이 활성 탭)를 닫기 응답 받기 전에 잰다", () => {
  const wasActiveIdx = closeBody.indexOf("const wasActive = tab.id === home.activeTab;");
  const applyIdx = closeBody.indexOf("apply(c)");
  assert.ok(wasActiveIdx >= 0 && wasActiveIdx < applyIdx, "wasActive를 apply(닫기 반영) 전에 안 재면 activeTab이 이미 옮겨간 뒤라 항상 거짓이 된다");
});

test("closeTab — wasActive일 때만 남은 탭 종류로 setSurface를 selectTab과 같은 표로 맞춘다", () => {
  const guardIdx = closeBody.indexOf("if (wasActive) {");
  assert.ok(guardIdx >= 0, "wasActive 가드 없이 매번 표면을 옮기면 배경 탭을 닫아도 지금 보던 표면이 밀린다");
  const guarded = closeBody.slice(guardIdx);
  assert.ok(guarded.includes('c.tabs.find((tb) => tb.id === c.activeTab)'), "남은 탭 중 activeTab을 찾는 조회가 없다");
  assert.ok(/if\s*\(landed\)\s*setSurface\(landed\.kind === "terminal" \? "terminal" : landed\.kind === "file" \? "explorer" : "session"\)/.test(guarded), "landed 종류 -> surface 매핑이 selectTab과 같은 표가 아니다");
});

test("closeTab — 남은 탭이 0개(activeTab이 없어 landed가 undefined)면 setSurface를 안 부른다", () => {
  const landedGuard = closeBody.slice(closeBody.indexOf("const landed ="));
  const ifIdx = landedGuard.indexOf("if (landed)");
  assert.ok(ifIdx >= 0, "landed 가드 없이 setSurface를 바로 부르면 탭이 0개일 때도 표면을 옮긴다");
});

// 티켓 b9c31c83(요구 `aa7e914a`, DESIGN.md §11-1 §개정): 살아 있는 pty는 `끊김`이 아니다.
// 표면을 떠났다 돌아오거나 라우트를 이탈/복귀하거나 새로고침해도, 죽었다고 확인 안 된 탭은
// 곧장 이어 붙어야 한다 — 종전에는 `surface !== "terminal"` effect가 `terminalConnected`를
// 매번 비워 "마운트 직후는 전부 끊김"으로 가정했다. 그 effect가 없다는 것과, 렌더 조건이
// "연결된 것만 이어 붙인다"에서 "죽은 것만 안내 화면"으로 뒤집힌 것을 소스로 고정한다.

test("표면을 나가도 터미널 연결 상태를 비우는 effect가 없다", () => {
  assert.ok(!s.includes('if (surface !== "terminal")'), '"살아 있는 pty는 끊김이 아니다"가 지기 전 effect가 다시 들어왔다 — 표면 이탈마다 전부 끊김으로 리셋한다');
});

const terminalSurfaceA = s.indexOf("function TerminalSurface(");
const terminalSurfaceB = s.indexOf("\n}\n", terminalSurfaceA);
assert.ok(terminalSurfaceA >= 0 && terminalSurfaceB > terminalSurfaceA, "home-ui.tsx: TerminalSurface 구간을 못 찾았다");
const terminalSurfaceBody = s.slice(terminalSurfaceA, terminalSurfaceB);

test("TerminalSurface — 렌더 조건이 죽은 집합에 없으면(기본 마운트) 이어 붙인다", () => {
  assert.ok(terminalSurfaceBody.includes("!disconnected.has(tab.id) ?"), "connected.has로 되돌아가면 마운트 직후(빈 집합)에 모든 탭이 끊김으로 뜬다 — §11-1 §개정이 뒤집은 렌더 조건이 아니다");
});

const terminalLeftPanelA = s.indexOf("function TerminalLeftPanel(");
const terminalLeftPanelB = s.indexOf("\n}\n", terminalLeftPanelA);
assert.ok(terminalLeftPanelA >= 0 && terminalLeftPanelB > terminalLeftPanelA, "home-ui.tsx: TerminalLeftPanel 구간을 못 찾았다");
const terminalLeftPanelBody = s.slice(terminalLeftPanelA, terminalLeftPanelB);

test("TerminalLeftPanel — 배지 판정이 죽은 집합(disconnected)과 서버 alive를 같이 본다", () => {
  assert.ok(/const isDisconnected = disconnected\.has\(tab\.id\) \|\| row\?\.\alive === false;/.test(terminalLeftPanelBody), "배지 판정이 우측 칸(TerminalSurface)과 같은 disconnected 집합을 안 쓰면 배지와 칸이 어긋난다");
});
