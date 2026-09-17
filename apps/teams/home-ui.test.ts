import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `home-ui.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `workers-ui.test.ts`) — 그래서 소스 글자를 댄다.
const s = readFileSync("components/home-ui.tsx", "utf8");

// §11-10 결정 2: 활성 탭이 창의 값이 되고 `home-sessions.json`에서 빠졌다 — 표식을 옮기는
// 왕복(`focusTabAction`)이 통째로 걷혔다. `selectTab`은 이제 로컬 `setActiveTab` 하나로
// 표식을 옮긴다(서버 왕복 없이).
const selA = s.indexOf("const selectTab = async (tab: Tab) => {");
const selB = s.indexOf("\n  };", selA);
assert.ok(selA >= 0 && selB > selA, "home-ui.tsx: selectTab 구간을 못 찾았다");
const selBody = s.slice(selA, selB);

test("selectTab — focusTabAction 없이 setActiveTab(tab.id)로 표식을 옮긴다", () => {
  assert.ok(!s.includes("focusTabAction"), "focusTabAction이 걷혔어야 한다(§11-10 결정 2 — 서버 왕복 0회)");
  assert.ok(selBody.startsWith("const selectTab = async (tab: Tab) => {\n    setActiveTab(tab.id);"), "selectTab 진입 즉시 로컬로 표식부터 옮겨야 한다");
});

test("selectTab — chat 탭이 이미 home.current이면 스레드 왕복(switchHome) 없이 return한다", () => {
  const alreadyCurrent = selBody.slice(selBody.indexOf("tab.id === home.current"));
  const nextReturn = alreadyCurrent.indexOf("return;");
  const switchCall = alreadyCurrent.indexOf("switchHome");
  assert.ok(nextReturn >= 0 && (switchCall === -1 || switchCall > nextReturn), "이미 로드된 대화 탭을 다시 눌러도 switchHome 없이 return해야 한다 — 표식은 위에서 이미 옮겼다");
});

// §11-10 결정 3: 탭을 닫은 뒤의 이월도 창이 계산한다 — closeTab 자신은 표식·표면을 더 안
// 만지고, `home.tabs`가 바뀔 때마다 도는 탭 이월 이펙트 하나가 이 창이 닫았든 다른 창이
// 닫았든 같은 통로로 mostRecentTab + surfaceForTab을 적용한다.
const closeA = s.indexOf("const closeTab = async (tab: Tab) => {");
const closeB = s.indexOf("\n  };", closeA);
assert.ok(closeA >= 0 && closeB > closeA, "home-ui.tsx: closeTab 구간을 못 찾았다");
const closeBody = s.slice(closeA, closeB);

test("closeTab — activeTab·surface를 직접 안 건드린다(이월은 이펙트가 맡는다)", () => {
  assert.ok(!closeBody.includes("setActiveTab") && !closeBody.includes("setSurface"), "closeTab이 표식·표면을 직접 옮기면 다른 창이 닫은 탭과 다른 통로가 생긴다");
});

const carryA = s.indexOf("useEffect(() => {\n    const firstRun = !landedOnceRef.current;");
assert.ok(carryA >= 0, "home-ui.tsx: 탭 이월 이펙트를 못 찾았다");
const carryB = s.indexOf("}, [home.tabs]);", carryA);
const carryBody = s.slice(carryA, carryB);

test("탭 이월 이펙트 — 활성 탭이 목록에 남아 있으면(안 닫혔다) 그대로 둔다", () => {
  assert.ok(carryBody.includes("home.tabs.some((t) => t.id === activeTab)) return;"), "활성 탭이 살아 있는데도 매번 이월하면 배경 탭 변화에 표식이 흔들린다");
});

test("탭 이월 이펙트 — mostRecentTab + surfaceForTab으로 옮기고, landed가 chat이면 switchHome도 잇는다", () => {
  assert.ok(carryBody.includes("mostRecentTab(home.tabs)"), "남은 탭 중 가장 최근 본 것으로 이월해야 한다(§11-8 결정 1)");
  assert.ok(carryBody.includes("setSurface(surfaceForTab(landed))"), "표면도 이월한 탭 종류로 맞춰야 한다");
  assert.ok(carryBody.includes('landed?.kind === "chat"') && carryBody.includes("switchHome(project, landed.id)"), "이월한 탭이 chat이면 몸통도 그 대화로 이어야 한다(§11-9 계약)");
});

// 티켓 9b9fe760(요구 cdb7ebfd, P422-1): 탭이 하나라도 있으면서 활성 탭이 `null`인 판은 둘로
// 갈린다 — 창을 방금 열어 저장된 활성 탭이 없는 판(이월해야 한다)과, 사람이 `changeSurface`로
// 빈 표면을 골라 스스로 `null`로 내린 판(이월하면 안 된다). `landedOnceRef`가 그 둘을 가른다.

test("탭 이월 이펙트 — 사람이 고른 빈 표면(activeTab === null, 두 번째 판 이후)은 안 덮는다", () => {
  assert.ok(carryBody.includes("if (activeTab === null && !firstRun) return;"), "landedOnceRef가 이미 섰는데도 activeTab === null을 이월하면 사람이 고른 빈 표면이 다음 폴링에 튕겨 나간다");
  const guardIdx = carryBody.indexOf("if (activeTab === null && !firstRun) return;");
  const landedIdx = carryBody.indexOf("mostRecentTab(home.tabs)");
  assert.ok(guardIdx >= 0 && landedIdx > guardIdx, "이 가드가 mostRecentTab 계산보다 먼저 와야 이월을 막는다");
});

test("탭 이월 이펙트 — 창을 방금 열어 표식이 빈 판(첫 실행)은 종전대로 이월한다", () => {
  assert.ok(carryBody.includes("const firstRun = !landedOnceRef.current;"), "첫 실행 여부를 landedOnceRef로 기록해야 두 판을 가를 수 있다");
  assert.ok(carryBody.includes("landedOnceRef.current = true;"), "이펙트가 한 번이라도 돌면 그 뒤 판은 전부 '사람이 골랐다'로 봐야 한다");
  assert.ok(!carryBody.includes("if (activeTab === null && !firstRun) return;\n    if (activeTab === null && home.tabs.length === 0)"), "0개 가드보다 firstRun 가드가 먼저면 첫 실행에 탭이 없던 판까지 막혀 버린다");
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

// 티켓 89edaf95(요구 `9566dcda`, DESIGN.md 로드맵 P214 §어긋난 세 자리 — 스펙이 이긴다):
// `991bf4fe`가 홈 참견을 세우며 화면 문구 세 자리가 스펙과 어긋난 채로 닫혔다 — placeholder·
// `aria-label`이 `running`으로 안 갈리고, 기다리는 줄이 없고, 제출 버튼 낱말이 도는 동안
// `참견`으로 바뀌었다. 아래 넷이 그 자리를 스펙으로 되돌린 것을 고정한다.

test("placeholder·aria-label이 이 대화의 running(interjecting)으로 갈린다 — anyRunning이 아니다", () => {
  assert.ok(s.includes("const interjecting = running && !readOnly;"), "네 번째 모드의 출처가 running && !readOnly가 아니다");
  assert.ok(s.includes('aria-label={t(interjecting ? "home.interject" : "home.questionLabel")}'), "aria-label이 두 모드로 안 갈린다");
  assert.ok(s.includes('placeholder={t(interjecting ? "home.interjectPlaceholder" : "home.askPlaceholder")}'), "placeholder가 두 모드로 안 갈린다");
});

test("제출 버튼 낱말이 도는 동안에도 `보내기`다 — `starting`일 때만 `보내는 중`이 뜬다", () => {
  assert.ok(s.includes('{starting ? t("home.sending") : t("home.send")}'), "버튼 낱말이 busy(도는 동안)가 아니라 starting(자기 요청 in-flight)으로 갈려야 한다");
  assert.ok(!/\{busy \? t\("home\.interject"\)/.test(s), "버튼 낱말이 여전히 busy일 때 home.interject로 바뀐다 — §24가 무수정으로 정한 낱말이 아니다");
  assert.ok(s.includes("aria-disabled={empty || readOnly || pendingSchedule !== null || starting}"), "aria-disabled 셋째 문이 starting(자기 요청 in-flight)이 아니다");
});

test("기다리는 줄 — echoIsInterject && running일 때만 뜨고, 답 항목이 붙거나 중지되면(running이 거짓) 걷힌다", () => {
  assert.ok(s.includes("setEchoIsInterject(true);"), "interject()가 echoIsInterject를 안 세운다");
  assert.ok(s.includes("setEchoIsInterject(false);"), "run()이 echoIsInterject를 안 내린다 — 첫 질문의 echo가 참견으로 오인된다");
  assert.ok(
    s.includes('{echoIsInterject && running && <MessageFooter>{t("home.waitingTurn")}</MessageFooter>}'),
    "기다리는 줄 조건이 echoIsInterject && running 하나가 아니다",
  );
});

test("run()이 echoIsInterject를 false로 세우는 자리가 anyRunning만 참인 경우와 안 갈린다", () => {
  const runA = s.indexOf("const run = async (question: string, paths: string[] = []) => {");
  const runB = s.indexOf("\n  };", runA);
  const runBody = s.slice(runA, runB);
  assert.ok(runBody.includes("setEcho(question);\n    setEchoIsInterject(false);"), "run()의 echo 다음 줄이 setEchoIsInterject(false)가 아니다 — anyRunning만 참이고 이 대화가 놀 때(run 경로) 기다리는 줄이 켜진다");
});
