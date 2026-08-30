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
  // `s.indexOf("<Popover")`는 안 쓴다 — 이 화면에 다른 `<Popover>`(예: `워커` 패널의 필터
  // 축)가 늘면 그쪽을 먼저 짚어 이 구간이 엉뚱하게 넓어진다. `open={addOpen}`으로 이 팝오버만
  // 짚는다.
  const popoverStart = s.indexOf("open={addOpen}");
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

// §4-16 결정 5 — 설정 트리 열째 노드 `워커`. 화면을 못 띄우니(next/CSS) 소스 글자로 잰다
// (위 블록과 같은 전제).

test("검색 인덱스에 워커 항목 넷(노드 자신 · 공통 워커 풀 · 전체 워커 · 필터)이 있다", () => {
  for (const anchor of ["workers", "workers.pool", "workers.all", "workers.filter"]) {
    assert.ok(
      s.includes(`anchor: "${anchor}"`),
      `검색 인덱스에 anchor: "${anchor}" 항목이 없다`,
    );
  }
});

test("트리 노드가 SettingsNode 유니온에 있고 `설정 분류` 그룹의 마지막(웹훅 다음)이다", () => {
  assert.match(s, /type SettingsNode =[\s\S]*?\| "workers"/, "SettingsNode에 \"workers\"가 없다");
  // `설정 분류` 그룹 안에서 `webhook` 항목이 `workers` 항목보다 먼저 나오고, 그 뒤로
  // `SidebarGroup`이 닫힐 때까지 다른 노드 버튼이 없다 — `workers`가 그 그룹의 마지막이다.
  const webhookItem = s.indexOf('isActive={activeNode === "webhook"}');
  const workersItem = s.indexOf('isActive={activeNode === "workers"}');
  assert.ok(webhookItem > 0 && workersItem > webhookItem, "workers 사이드바 항목이 webhook 다음에 없다");
  const groupEnd = s.indexOf("</SidebarGroup>", workersItem);
  const nextItem = s.indexOf("isActive={activeNode ===", workersItem + 1);
  assert.ok(groupEnd > 0 && (nextItem < 0 || nextItem > groupEnd), "workers 뒤에 같은 그룹 항목이 더 있다");
});

test("WorkersSection이 패널에 마운트된다", () => {
  assert.ok(s.includes("function WorkersSection("), "WorkersSection 정의를 못 찾았다");
  assert.ok(
    s.includes('<WorkersSection\n              className={cn(activeNode !== "workers" && "md:hidden")}'),
    "WorkersSection이 패널에 마운트되지 않는다",
  );
});

// §설정이 프로젝트와 공통으로 갈린다(티켓 2f6139db) — 옛 `ProjectSettingsDialog`(projects-ui.tsx)가
// 트리 첫 그룹의 패널 `ProjectSection`으로 옮겨 왔다. 버그 5e7d0faf가 잡은 함정(`open` prop이
// 외부에서 바로 바뀌면 Dialog의 `onOpenChange`가 안 불린다)은 이 컴포넌트에도 그대로 걸린다 —
// `trigger="none"` 인스턴스는 톱니 클릭이 `open` prop을 밖에서 바로 바꾼다(옛 테스트
// `projects-ui.test.ts`를 이 파일로 옮긴다).
function projectSectionBody(): string {
  const start = s.indexOf("function ProjectSection({");
  assert.ok(start > 0, "ProjectSection을 못 찾았다");
  const end = s.indexOf("\n  return (", start);
  assert.ok(end > start, "ProjectSection 뒤 return (을 못 찾았다");
  return s.slice(start, end);
}

test("ProjectSection이 열림 자체(useEffect)로 읽는다 — Dialog의 onOpenChange에만 안 얹는다", () => {
  const body = projectSectionBody();
  assert.match(
    body,
    /useEffect\(\(\) => \{\s*if \(open\) load\(\);\s*\}, \[open, load\]\);/,
    "open을 직접 보는 useEffect가 없다 — 톱니 클릭(외부 setOpen)에서 load()가 안 불린다",
  );
});

test("ProjectSection의 load()는 그 useEffect 하나만 부른다 — 열림 감지가 두 군데로 안 갈린다", () => {
  const body = projectSectionBody();
  const calls = body.match(/\bload\(\)/g) ?? [];
  assert.equal(calls.length, 1, `load() 호출이 useEffect 하나여야 하는데 ${calls.length}곳이다`);
});
