import { test } from "node:test";
import assert from "node:assert";
import { createPendingSet } from "./route-pending-set.ts";

// `route-pending.ts`(React · next/navigation을 문 파일)는 여기서 직접 import 못 한다 —
// `project-switcher.test.ts` 머리 주석과 같은 사유(node 네이티브 TS 로더의 모듈 해석 실측).
// 값 하나(`ROUTE_PENDING_DELAY_MS = 300`)는 소스 문자열로 못박는다.
import { readFileSync } from "node:fs";
const routePendingSrc = readFileSync("lib/route-pending.ts", "utf8");

// §0-22 결정 2 — `<Link>`(useLinkStatus) · `router.push`/`replace`(useTransition) 두 갈래가
// 소스별 토큰으로 이 집계기 하나에 모인다. 여기서 못박는 건 눈으로 보기 쉬운 값(300)이 아니라
// 조용히 깨지는 자리 — dedup과 다중 소스 겹침이다.

test("ROUTE_PENDING_DELAY_MS는 300이다 — §비주얼 §65 ③ 상수 하나", () => {
  assert.match(routePendingSrc, /export const ROUTE_PENDING_DELAY_MS = 300;/);
});

test("토큰 하나가 pending true → snapshot true, false → snapshot false", () => {
  const s = createPendingSet();
  const a = {};
  assert.strictEqual(s.getSnapshot(), false);
  s.setPending(a, true);
  assert.strictEqual(s.getSnapshot(), true);
  s.setPending(a, false);
  assert.strictEqual(s.getSnapshot(), false);
});

test("소스 둘이 겹치면 하나만 꺼져도 계속 켜진 채다 — §0-22 결정 2 두 갈래 공유", () => {
  const s = createPendingSet();
  const link = {};
  const push = {};
  s.setPending(link, true);
  s.setPending(push, true);
  s.setPending(link, false);
  assert.strictEqual(s.getSnapshot(), true, "push 쪽이 아직 켜져 있는데 꺼졌다");
  s.setPending(push, false);
  assert.strictEqual(s.getSnapshot(), false);
});

test("같은 값 재설정은 구독자를 안 깨운다 — router.refresh 폴링류의 재진입에서 헛알림 0", () => {
  const s = createPendingSet();
  const token = {};
  let calls = 0;
  s.subscribe(() => calls++);
  s.setPending(token, true);
  assert.strictEqual(calls, 1);
  s.setPending(token, true); // 이미 true — 같은 값
  assert.strictEqual(calls, 1, "같은 값 재설정인데 리스너가 또 불렸다");
  s.setPending(token, false);
  assert.strictEqual(calls, 2);
});

test("구독 해제 뒤에는 알림이 안 온다", () => {
  const s = createPendingSet();
  const token = {};
  let calls = 0;
  const unsubscribe = s.subscribe(() => calls++);
  unsubscribe();
  s.setPending(token, true);
  assert.strictEqual(calls, 0);
});
