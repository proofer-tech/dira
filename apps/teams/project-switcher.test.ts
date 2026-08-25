import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `project-switcher.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `settings-dialog.test.ts`) — 그래서 소스 글자를 댄다.
// 티켓 a722fe44: 전환기 항목에 `/`의 행 액션 셋을 배선한다. 여기서 고정하는 것은 손으로 보기
// 쉬운 자리(모양·색)가 아니라 회귀가 조용한 자리(팔레트-다이얼로그 순서·키 삼킴·검색 중 비활성·
// 등록 해제 뒤 이동)다.
const s = readFileSync("components/project-switcher.tsx", "utf8");

test("설정 다이얼로그를 Popover 밖에서 연다 — 닫히는 팔레트가 다이얼로그를 같이 안 걷어간다", () => {
  const popoverEnd = s.indexOf("</Popover>");
  const dialogStart = s.indexOf("<ProjectSettingsDialog");
  assert.ok(popoverEnd > 0, "</Popover>를 못 찾았다");
  assert.ok(dialogStart > popoverEnd, "ProjectSettingsDialog가 Popover 안에 있다");
});

test("설정 다이얼로그 마크업을 다시 안 만든다 — projects-ui.tsx의 한 벌을 그대로 쓴다", () => {
  assert.ok(
    s.includes('import { ProjectSettingsDialog } from "@/components/projects-ui";'),
    "공유 다이얼로그를 안 불러온다",
  );
  assert.ok(!s.includes("프로젝트 등록 해제"), "등록 해제 확인 문구가 이 파일에 또 있다");
  assert.ok(!s.includes("<DialogContent"), "다이얼로그 내용 마크업을 이 파일이 또 그린다");
});

test("설정 손잡이는 DialogTrigger가 아니다 — 팔레트를 먼저 닫고 상태로 연다", () => {
  assert.ok(!s.includes("DialogTrigger"), "DialogTrigger를 쓰면 팔레트 안에 다이얼로그가 겹친다");
  const start = s.indexOf("const openSettings = (p: SwitcherProject) => {");
  const end = s.indexOf("};", start);
  const body = s.slice(start, end);
  assert.match(body, /close\(\);/, "openSettings가 close()를 먼저 안 부른다");
  assert.ok(body.indexOf("close();") < body.indexOf("setSettingsOpen(true);"));
});

test("등록 해제가 지금 보던 프로젝트였을 때만 `/`로 보낸다", () => {
  const start = s.indexOf("onUnregistered={() => {");
  const end = s.indexOf("}}", start);
  const body = s.slice(start, end);
  assert.match(body, /if \(settingsProject\.id === currentId\) router\.push\("\/"\);/);
});

test("레일이 클릭 · ↑ · ↓ · Enter 키다운을 항목(CommandItem)으로 안 올린다", () => {
  const start = s.indexOf("function SwitcherActionRail");
  const end = s.indexOf("export function ProjectSwitcher", start);
  const body = s.slice(start, end);
  assert.match(body, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "클릭을 안 막는다");
  assert.match(
    body,
    /e\.key === "ArrowUp" \|\| e\.key === "ArrowDown" \|\| e\.key === "Enter"\) e\.stopPropagation\(\);/,
    "화살표·Enter 키다운을 안 막는다 — cmdk 루트가 그대로 전환·이동을 받는다",
  );
  // Esc·Tab은 이 표에 없다 — 막지 않고 그대로 통과시켜야 한다
  assert.ok(!body.includes('"Escape"'), "Esc까지 막으면 팔레트가 안 닫힌다");
  assert.ok(!body.includes('"Tab"'), "Tab까지 막으면 레일 밖으로 못 나간다");
});

test("검색 중에는 위로 · 아래로만 비활성 — 설정은 그대로 손잡이가 있다", () => {
  const start = s.indexOf("function SwitcherActionRail");
  const end = s.indexOf("export function ProjectSwitcher", start);
  const body = s.slice(start, end);
  assert.match(body, /disabled=\{first \|\| pending \|\| searching\}/);
  assert.match(body, /disabled=\{last \|\| pending \|\| searching\}/);
  const settingsButtonStart = body.lastIndexOf("<Button");
  const settingsButtonEnd = body.indexOf("</Button>", settingsButtonStart);
  const settingsButton = body.slice(settingsButtonStart, settingsButtonEnd);
  assert.ok(settingsButton.includes("onOpenSettings(project)"), "설정 버튼을 못 찾았다");
  assert.ok(!settingsButton.includes("searching"), "설정 버튼이 검색 중에 비활성화되면 안 된다");
});

test("탭 순서 — 선택 줄만 tabIndex=0, 나머지는 -1", () => {
  const start = s.indexOf("function SwitcherActionRail");
  const end = s.indexOf("export function ProjectSwitcher", start);
  const body = s.slice(start, end);
  assert.match(body, /const selectedValue = useCommandState\(\(s\) => s\.value\);/);
  assert.match(body, /const tabIndex = selectedValue === value \? 0 : -1;/);
});
