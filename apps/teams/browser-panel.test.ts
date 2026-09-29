import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `browser-panel.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `home-ui.test.ts`) — 그래서 소스 글자를 댄다.
const s = readFileSync("components/browser-panel.tsx", "utf8");

const openLinkA = s.indexOf("export async function openLink(");
const openLinkB = s.indexOf("\n}", openLinkA);
assert.ok(openLinkA >= 0 && openLinkB > openLinkA, "browser-panel.tsx: openLink 구간을 못 찾았다");
const openLinkBody = s.slice(openLinkA, openLinkB);

test("openLink — 막혔거나 셸이 실패하면(!result.ok) 토스트만 뜨고 아래로 안 내려간다", () => {
  const guardIdx = openLinkBody.indexOf("if (!result.ok) {");
  const returnIdx = openLinkBody.indexOf("return;", guardIdx);
  const tabActionIdx = openLinkBody.indexOf("openBrowserTabAction");
  assert.ok(guardIdx >= 0 && returnIdx > guardIdx, "!result.ok 가드에 return이 없다");
  assert.ok(tabActionIdx > returnIdx, "openBrowserTabAction이 !result.ok 가드보다 먼저 온다 — 막혔는데도 탭을 등록해 버린다(§P449 결정 1 §상한이 찼거나 셸이 실패하면 화면이 안 움직인다)");
});

test("openLink — 탭을 먼저 등록하고(openBrowserTabAction), 그 다음 저장(writeStoredActiveTab), 알림(dispatchEvent), 이동(navigate) 순이다", () => {
  const tabActionIdx = openLinkBody.indexOf("openBrowserTabAction(projectId, LINK_SLOT_HASH)");
  const storeIdx = openLinkBody.indexOf("writeStoredActiveTab(projectId, LINK_SLOT_HASH)");
  const dispatchIdx = openLinkBody.indexOf("window.dispatchEvent(");
  const navigateIdx = openLinkBody.indexOf("navigate(`/p/${projectId}`)");
  assert.ok(tabActionIdx >= 0, "openBrowserTabAction(projectId, LINK_SLOT_HASH) 호출이 없다 — §P449 결정 1이 TicketBrowserSection의 openInHomeTab과 같은 순서를 요구한다");
  assert.ok(tabActionIdx < storeIdx && storeIdx < dispatchIdx && dispatchIdx < navigateIdx, "등록 - 저장 - 알림 - 이동 순서가 아니다");
});

test("openLink — 창 알림이 LINK_TAB_EVENT 이름으로 projectId·chunk를 싣는다", () => {
  const dispatchIdx = openLinkBody.indexOf("window.dispatchEvent(");
  const dispatchLine = openLinkBody.slice(dispatchIdx, openLinkBody.indexOf(";", dispatchIdx));
  assert.ok(dispatchLine.includes("LINK_TAB_EVENT"), "알림 이름이 LINK_TAB_EVENT가 아니다 — HomeUI가 그 이름으로 듣는다");
  assert.ok(dispatchLine.includes("projectId") && dispatchLine.includes("chunk"), "알림 detail에 projectId·chunk가 안 실린다 — HomeUI가 자기 프로젝트인지 가리지도 못하고 탭 목록도 못 받는다");
});
