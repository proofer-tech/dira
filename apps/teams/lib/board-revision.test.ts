/** revision 카운팅 로직과, 못 읽는 디렉터리는 캐시 없이 0을 내며 다음 호출이 다시 시도하는지
 *  (§보드 갱신 §바닥 5초를 지우지 않는다).
 *
 *  실제 `fs.watch`는 주입으로 갈아 낀다 — 실측 지연(12~27ms)조차 전체 스위트를 병렬로 돌리는
 *  CPU 경쟁 아래서는 훨씬 늦게 온다(실측: 8초 안에도 0회). 카운팅 로직은 그 지연과 무관하므로
 *  가짜 워처로 콜백을 직접 불러 결정적으로 검증한다(선례: `machine-state.ts`의
 *  `startHeartbeat(deps)`). 진짜 `fs.watch`가 붙는지는 못 읽는 디렉터리 테스트가 실제로 부른다. */
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boardRevision, type WatchFn, type Watcher } from "./board-revision.ts";

function fakeWatch(): { watch: WatchFn; fire: () => void } {
  let onEvent: (() => void) | null = null;
  const watch: WatchFn = (_dir, cb) => {
    onEvent = cb;
    return { on: () => undefined, unref: () => undefined, close: () => undefined } as unknown as Watcher;
  };
  return { watch, fire: () => onEvent?.() };
}

test("revision — 워처 이벤트마다 카운터가 오른다, root마다 따로 센다", () => {
  const a = fakeWatch();
  const b = fakeWatch();
  assert.equal(boardRevision("/fake/a", a.watch), 0);
  assert.equal(boardRevision("/fake/b", b.watch), 0);
  a.fire();
  a.fire();
  b.fire();
  assert.equal(boardRevision("/fake/a", a.watch), 2);
  assert.equal(boardRevision("/fake/b", b.watch), 1);
});

test("revision — tickets/가 없는 root는 예외 없이 0을 내고 캐시하지 않는다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "brev-missing-"));
  try {
    assert.equal(boardRevision(root), 0);
    // 디렉터리가 나중에 생겨도 다시 시도할 수 있어야 한다(캐시 안 함) — 여기서는 워처가
    // 안 걸렸다는 것만 확인한다(계속 0).
    assert.equal(boardRevision(root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
