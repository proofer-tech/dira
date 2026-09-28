import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `market-ui.tsx`도 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts`, `settings-dialog.test.ts`) — 소스 글자를 댄다.
// 티켓 ec861197: `reload`가 무조건 `setData("loading")`부터 하면 `MarketPane`이 통째로
// 언마운트되고, 그 안에 떠 있던 `ItemDialog`의 결과 화면(`mode === "result"`)도 같이 사라진다.
// `onImported`(가져오기 성공 뒤 부르는 자리)는 `silent`를 켜서 그 언마운트를 피해야 한다.
const s = readFileSync("components/market-ui.tsx", "utf8");

const reloadStart = s.indexOf("const reload = useCallback(");
assert.ok(reloadStart >= 0, "reload를 못 찾았다");
const reloadEnd = s.indexOf("}, [locale]);", reloadStart);
assert.ok(reloadEnd > reloadStart, "reload 닫는 자리를 못 찾았다");
const reloadBody = s.slice(reloadStart, reloadEnd);

test("reload가 opts.silent일 때 setData(\"loading\")을 건너뛴다", () => {
  assert.match(reloadBody, /if \(!opts\?\.silent\) setData\("loading"\);/);
});

test("MarketPane의 onImported가 reload를 silent로 부른다", () => {
  const paneStart = s.indexOf("<MarketPane\n");
  assert.ok(paneStart >= 0, "MarketDialog 안 MarketPane을 못 찾았다");
  const paneEnd = s.indexOf("/>", paneStart);
  const paneProps = s.slice(paneStart, paneEnd);
  assert.match(paneProps, /onImported=\{\(\) => reload\(\{ silent: true \}\)\}/);
});
