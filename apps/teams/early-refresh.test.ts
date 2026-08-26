import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// 클라이언트 컴포넌트라 import를 못 댄다(선례 `workers-ui.test.ts`) — 소스 글자를 댄다.
// 티켓 dfebf1e8 (DESIGN.md §이른 갱신이 붙는 화면 §개정 1-3, 요구 `de0b759d`): `BoardPolling`의
// 250ms 축을 `EarlyRefreshPolling`으로 떼어 티켓 상세 - 페르소나 - 에픽 - 워커 화면이 나눠 쓴다.
// 여기서 고정하는 것은 그 조각이 5초 바닥 없이(§개정 2) 화면 넷에 실제로 붙어 있다는 것과,
// `WipBodyPolling`이 되살아나지 않는다는 것 — 눈으로 보이지 않는 회귀라 소스 검사로 고정한다.

const earlyRefresh = readFileSync("components/early-refresh.tsx", "utf8");
const boardUi = readFileSync("components/board-ui.tsx", "utf8");
const ticketUi = readFileSync("components/ticket-ui.tsx", "utf8");
const ticketPage = readFileSync("app/(app)/p/[project]/tickets/[hash]/page.tsx", "utf8");
const personasPage = readFileSync("app/(app)/p/[project]/personas/[[...persona]]/page.tsx", "utf8");
const epicsPage = readFileSync("app/(app)/p/[project]/epics/[[...epic]]/page.tsx", "utf8");
const workersPage = readFileSync("app/(app)/p/[project]/workers/page.tsx", "utf8");

test("EarlyRefreshPolling — 250ms마다 /api/revision을 묻고 5초 바닥은 안 든다", () => {
  assert.match(earlyRefresh, /setTimeout\(poll, 250\)/, "250ms 폴이 없다");
  assert.match(earlyRefresh, /\/api\/revision\?project=/, "/api/revision 왕복이 없다");
  assert.ok(!/5000/.test(earlyRefresh), "EarlyRefreshPolling에 5초 바닥이 섞여 들어갔다");
});

test("BoardPolling — 5초 바닥을 유지한 채 EarlyRefreshPolling에 250ms 축을 위임한다", () => {
  assert.match(boardUi, /setInterval\(\(\) => \{\s*\n\s*if \(!document\.hidden\) router\.refresh\(\);\s*\n\s*\}, 5000\)/, "5초 바닥이 없다");
  assert.match(boardUi, /return <EarlyRefreshPolling project=\{project\} rev=\{rev\} \/>;/, "250ms 축을 EarlyRefreshPolling에 위임하지 않는다");
});

test("WipBodyPolling — 사라졌다, EarlyRefreshPolling이 대체한다", () => {
  assert.ok(!ticketUi.includes("WipBodyPolling"), "WipBodyPolling이 ticket-ui.tsx에 되살아났다");
  assert.ok(!ticketPage.includes("WipBodyPolling"), "티켓 상세 페이지가 여전히 WipBodyPolling을 쓴다");
});

test("티켓 상세 - 페르소나 - 에픽 - 워커 화면이 EarlyRefreshPolling을 붙인다, 5초 바닥은 안 붙인다", () => {
  for (const [name, src] of [
    ["티켓 상세", ticketPage],
    ["페르소나", personasPage],
    ["에픽", epicsPage],
    ["워커", workersPage],
  ] as const) {
    assert.match(src, /<EarlyRefreshPolling project=\{id\} rev=\{boardRevision\(project\.root\)\} \/>/, `${name} 화면에 EarlyRefreshPolling이 없다`);
    assert.ok(!/setInterval/.test(src), `${name} 화면에 5초 바닥(setInterval)이 붙었다 — §개정 2 위반`);
  }
});
