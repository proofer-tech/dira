import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `session-stream.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `workers-ui.test.ts`) — 그래서 소스 글자를 댄다.
// 티켓 359192ce (§비주얼 §59 §겹침 개정, 요구 `2a5276ed`): 계획 제목 줄의 꼬리 `기록 n건`이
// 그 안 §9 묶음 줄과 같은 수를 두 번 세던 자리를 닫는다. 여기서 못박는 것은 그 꼬리가 다시
// 서지 않는다는 것과, 겹치지 않는 안쪽 묶음 줄(§9)은 한 글자도 안 갈린다는 것 — 눈으로 보면
// 지나치기 쉬운 회귀라 소스 검사로 고정한다.
const s = readFileSync("components/session-stream.tsx", "utf8");

test("계획 꼬리 문구가 없다 — `기록 n건`을 두 번 세는 줄이 화면에 없다(§59 ③-1)", () => {
  assert.equal(
    s.match(/기록 \{count\}건/g),
    null,
    "계획 꼬리 `기록 {count}건`이 되살아났다",
  );
  assert.equal(
    (s.match(/ml-auto shrink-0 text-xs text-muted-foreground tabular-nums/g) ?? []).length,
    0,
    "꼬리 span의 클래스 문자열이 남아 있다",
  );
  assert.equal(
    (s.match(/count=\{block\.events\.length\}/g) ?? []).length,
    0,
    "PlanBlock이 여전히 count 프롭을 받는다",
  );
});

test("계획 손잡이가 `ml-auto`를 받는다 — 꼬리가 죽으며 옮겨 앉은 그 자리(§59 ③-1)", () => {
  assert.equal(
    (s.match(/ml-auto size-4 shrink-0 text-muted-foreground/g) ?? []).length,
    1,
    "ChevronRight 손잡이가 ml-auto를 안 든다",
  );
});

test("안쪽 §9 묶음 줄은 한 글자도 안 갈린다 — 겹치지 않는 갈래(§59 ③-1 §갈리지 않는 것)", () => {
  assert.match(
    s,
    /<MarkerContent className="tabular-nums">기록 \{events\.length\}건<\/MarkerContent>/,
    "§9 묶음 줄의 `기록 n건`이 갈렸다",
  );
});
