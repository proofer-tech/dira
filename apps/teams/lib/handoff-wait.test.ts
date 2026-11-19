import { test } from "node:test";
import assert from "node:assert";
import { handoffWaitText } from "./handoff-wait.ts";
import { t } from "./i18n.ts";

const NOW = 1_800_000_000;
const base = { state: "pending", by: "agent", reason: "", url: "", since: NOW - 60, ttl: 7200 } as const;
for (const loc of ["ko", "en"] as const) {
  test(`handoffWaitText ${loc} - 대기 중 / 대기 종료 / 줄 없음`, () => {
    const tt = (k: string) => t(loc, k);
    const a = handoffWaitText({ ...base, waitingUntil: NOW + 290 }, NOW, tt);
    const b = handoffWaitText({ ...base, waitingUntil: NOW - 5 }, NOW, tt);
    const c = handoffWaitText({ ...base, waitingUntil: null }, NOW, tt);
    assert.strictEqual(b, c);
    assert.ok(!a.includes("{") && !b.includes("{"));
    if (loc === "ko") {
      assert.ok(a.includes("에이전트가 기다리고 있습니다 (5분 남음)"), a);
      assert.ok(b.includes("1시간 59분 뒤에 정리됩니다."), b);
    } else {
      assert.ok(a.includes("The agent is waiting (5 min left)"), a);
      assert.ok(b.includes("no longer waiting") && b.includes("1h 59m"), b);
    }
    // 1시간 미만이면 분만
    const d = handoffWaitText({ ...base, since: NOW - 7200 + 600, waitingUntil: null }, NOW, tt);
    assert.ok(loc === "ko" ? d.includes("10분 뒤에 정리됩니다.") && !d.includes("시간") : d.includes("10 min"), d);
  });
}
