import { test } from "node:test";
import assert from "node:assert";
import { closeTab, evictionCandidate, mostRecentTab, openTab, TAB_LIMIT, type Tab } from "./tabs.ts";

function tab(id: string, lastViewed: string, unsaved?: true): Tab {
  return unsaved ? { id, kind: "chat", lastViewed, unsaved } : { id, kind: "chat", lastViewed };
}

test("openTab appends a new tab and sets it active", () => {
  const tabs = openTab([], "a", "chat", "2026-01-01T00:00:00Z");
  assert.deepEqual(tabs, [{ id: "a", kind: "chat", lastViewed: "2026-01-01T00:00:00Z" }]);
});

test("openTab on an already-open tab moves lastViewed, doesn't duplicate", () => {
  const opened = [tab("a", "t0"), tab("b", "t1")];
  const next = openTab(opened, "a", "chat", "t2");
  assert.equal(next.length, 2);
  assert.equal(next.find((t) => t.id === "a")?.lastViewed, "t2");
});

test("evictionCandidate is null under the cap", () => {
  const tabs = Array.from({ length: TAB_LIMIT }, (_, i) => tab(`t${i}`, String(i)));
  assert.equal(evictionCandidate(tabs), null);
});

test("openTab evicts the least-recently-viewed tab past the cap", () => {
  const tabs = Array.from({ length: TAB_LIMIT }, (_, i) => tab(`t${i}`, String(i).padStart(3, "0")));
  const next = openTab(tabs, "new", "chat", "999");
  assert.equal(next.length, TAB_LIMIT);
  assert.ok(!next.some((t) => t.id === "t0")); // 가장 오래 안 본 탭(000)이 빠진다
  assert.ok(next.some((t) => t.id === "new"));
});

test("unsaved tabs are excluded from eviction and don't get auto-closed", () => {
  // 열두 탭이 전부 저장 안 한 상태 - 후보가 없으므로 상한을 넘겨도 그대로 낸다
  const tabs = Array.from({ length: TAB_LIMIT }, (_, i) => tab(`t${i}`, String(i).padStart(3, "0"), true));
  assert.equal(evictionCandidate(tabs), null);
  const next = openTab(tabs, "new", "chat", "999");
  assert.equal(next.length, TAB_LIMIT + 1); // 아무도 안 닫혔다 - 사람에게 물어보는 자리는 화면이다
});

test("evictionCandidate skips unsaved tabs even when they're the oldest", () => {
  const tabs = [tab("old-unsaved", "000", true), tab("mid", "001"), tab("new", "002")];
  const victim = evictionCandidate([...tabs, tab("filler", "003")]);
  // 상한(12) 미만이라 여기서는 null이 맞다 - 상한을 넘긴 픽스처로 다시 잰다
  assert.equal(victim, null);
  const many = [
    tab("old-unsaved", "000", true),
    ...Array.from({ length: TAB_LIMIT }, (_, i) => tab(`t${i}`, String(i + 1).padStart(3, "0"))),
  ];
  assert.equal(evictionCandidate(many)?.id, "t0"); // unsaved가 아니라 그다음으로 오래된 탭이 후보다
});

test("closeTab removes only the given tab", () => {
  const tabs = [tab("a", "0"), tab("b", "1")];
  assert.deepEqual(closeTab(tabs, "a"), [tab("b", "1")]);
});

test("mostRecentTab picks the highest lastViewed, null when empty", () => {
  assert.equal(mostRecentTab([]), null);
  assert.equal(mostRecentTab([tab("a", "005"), tab("b", "009"), tab("c", "001")]), "b");
});
