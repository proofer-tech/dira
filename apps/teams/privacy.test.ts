/** 개인정보처리방침의 이벤트 표는 `apps/teams/lib/analytics.ts`의 `Events` 타입이 원본이다.
 *  이벤트를 늘리고 방침을 안 고치면 여기서 깨진다 — 그것이 이 테스트의 전부다.
 *  §0-11이 "타입이 표를 닫는다"고 한 것을 방침까지 이어 붙인다. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function eventNames(): string[] {
  const src = readFileSync(new URL("./lib/analytics.ts", import.meta.url), "utf8");
  const block = src.match(/export type Events = \{([\s\S]*?)\n\};/);
  assert.ok(block, "analytics.ts에서 `export type Events` 블록을 못 찾았다");
  return [...block[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

test("방침의 이벤트 표가 Events 타입을 다 담는다", () => {
  const events = eventNames();
  assert.equal(events.length, 8, `Events가 8개가 아니다: ${events.join(", ")}`);

  const privacy = readFileSync(new URL("./privacy.md", import.meta.url), "utf8");
  for (const name of events) {
    assert.ok(
      privacy.includes(`\`${name}\``),
      `방침에 \`${name}\` 이벤트가 빠졌다 — 표를 고쳐라`,
    );
  }
});

test("방침이 안 보내는 항목을 명시한다", () => {
  const privacy = readFileSync(new URL("./privacy.md", import.meta.url), "utf8");
  for (const forbidden of ["티켓 본문", "파일 경로", "프로젝트 이름", "페르소나"]) {
    assert.ok(privacy.includes(forbidden), `방침 §처리하지 않는 항목에 "${forbidden}"이 없다`);
  }
});
