// 기동 검사와 1시간 tick이 같은 방향(플래그 없음 = 켜짐일 때만 검사)인지 main.ts 소스로 고정한다.
// ponytail: 소스 문자열 검사. main.ts가 electron을 import해서 node --test에서 못 불러온다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("자동 업데이트 검사는 플래그가 없을 때만 돈다", () => {
  const src = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const lines = src.split("\n").filter((l) => l.includes("existsSync(autoUpdateFlag())) checkForUpdate"));
  assert.equal(lines.length, 2); // 기동 + 1시간 tick
  for (const l of lines) assert.match(l.trim(), /^if \(!existsSync/);
});
