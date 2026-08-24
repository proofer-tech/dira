// 판정 둘 다 순수 함수라 electron도 자식 프로세스도 없이 분기 전부를 밟는다.
// $ cd apps/desktop && pnpm test
import assert from "node:assert/strict";
import test from "node:test";
import { decideRevive, isExternalDeath } from "./revive.ts";

test("decideRevive — 아무것도 안 죽었으면 그냥 보여준다", () => {
  assert.equal(decideRevive({ winDestroyed: false, contentDead: false, serverAlive: true }), "show");
});

test("decideRevive — 창/콘텐츠가 죽었고 서버는 살아있으면 창만 다시 읽는다", () => {
  assert.equal(decideRevive({ winDestroyed: true, contentDead: false, serverAlive: true }), "reload-window");
  assert.equal(decideRevive({ winDestroyed: false, contentDead: true, serverAlive: true }), "reload-window");
});

test("decideRevive — 서버까지 죽었으면 자식부터 다시 띄운다", () => {
  assert.equal(decideRevive({ winDestroyed: true, contentDead: false, serverAlive: false }), "restart-server");
  assert.equal(decideRevive({ winDestroyed: false, contentDead: true, serverAlive: false }), "restart-server");
  assert.equal(decideRevive({ winDestroyed: true, contentDead: true, serverAlive: false }), "restart-server");
});

test("decideRevive — 창·콘텐츠는 멀쩡해도 서버만 죽었으면 자식부터 다시 띄운다", () => {
  // 판정 시나리오 그 자체다 — 창을 숨겼을 뿐 파괴되지 않았고 렌더러도 안 죽었는데
  // 자식 서버만 `kill -9`로 죽는 경우
  assert.equal(decideRevive({ winDestroyed: false, contentDead: false, serverAlive: false }), "restart-server");
});

test("isExternalDeath — killServer가 먼저 지운 자식이면 밖에서 죽은 것이 아니다", () => {
  const proc = {};
  assert.equal(isExternalDeath(proc, proc), false);
});

test("isExternalDeath — 아무도 안 지웠는데 죽었으면 밖에서 죽은 것이다", () => {
  const proc = {};
  assert.equal(isExternalDeath(proc, null), true);
  assert.equal(isExternalDeath(proc, {}), true); // 다른 자식이 지워진 상태로 남아 있었다
});
