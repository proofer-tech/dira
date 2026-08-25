import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `session-stream.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `workers-ui.test.ts`) — 그래서 소스 글자를 댄다.
// 티켓 359192ce (§비주얼 §59 §겹침 개정, 요구 `2a5276ed`): 계획 제목 줄의 꼬리 `기록 n건`이
// 그 안 §9 묶음 줄과 같은 수를 두 번 세던 자리를 닫는다. 여기서 고정하는 것은 그 꼬리가 다시
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

test("계획 손잡이가 `ml-auto`를 받는다 — 꼬리가 죽으며 옮겨 놓인 그 자리(§59 ③-1)", () => {
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

// 티켓 `0da4466e`(요구 `4f761c5a` 답 `90c1d300`): 참견 칸·답변 칸이 목적지를 안 말해 사람이
// 답변 대기 카드가 사라진 자리에 참견을 쓰고 실패를 보는 문제. 판정(`interjectMode`, 셋이
// 배타)은 `lib/urls.test.ts`가 이미 고정한다 — 여기서 고정하는 것은 그 판정이 그리는 **문구**다.
test("참견 칸 placeholder가 목적지를 칸 안에서 알려 준다 — `도는 세션에 말 걸기`(§Done when 1)", () => {
  assert.match(
    s,
    /placeholder=\{followup \? "이어서 무엇을 할지 쓰기" : "도는 세션에 말 걸기"\}/,
    "참견 placeholder가 `도는 세션에 말 걸기`가 아니다 — 참견 칸이 도는 세션에 간다는 것을 안 알려 준다",
  );
});

// 티켓 707d1448(요구 ea26bd52, 답 55ff2be0, §2-15 ⑭ · §비주얼 §64): `결과` 절이 원문 `<pre>`
// 하나에서 마크다운 + 원문 두 면이 된다. 여기서 고정하는 것은 눈으로 보면 지나치기 쉬운 넷 —
// 밀도 클래스가 §64 표 그대로인지, 파싱이 폴링마다 다시 안 도는지(메모 키), 빈 짝이 마크다운
// 문구 없이 빈 상자로 남는지, 줄을 바꾸면 상태가 정말 새로 뜨는지(key).
test("`결과` 마크다운 면의 밀도 겹이 §비주얼 §64 표 그대로다", () => {
  assert.match(
    s,
    /const RESULT_MARKDOWN_CLASS =\s*\n\s*"text-sm leading-6 \[&_h1\]:text-base \[&_h2\]:text-sm \[&_h3\]:text-sm \[&_code\]:text-xs \[&_table\]:text-xs";/,
    "밀도 겹 클래스 일곱이 §64 표와 다르다",
  );
});

test("`결과` 마크다운 파싱이 폴링마다 다시 안 돈다 — 메모 키가 `copyText` 하나다", () => {
  const memoStart = s.indexOf("const markdownView = useMemo(");
  const memoEnd = s.indexOf(");", memoStart);
  const memoBody = s.slice(memoStart, memoEnd);
  assert.match(
    memoBody,
    /\[copyText\],\s*$/,
    "`markdownView`의 useMemo 의존 배열이 `[copyText]` 하나가 아니다 — `results`를 걸면 폴링마다 재파싱한다",
  );
});

test("`결과` 짝의 본문이 공백뿐이면 마크다운 면에 `markdown.empty` 문구가 안 뜬다", () => {
  assert.match(
    s,
    /r\.body\.trim\(\) \? \(\s*<Markdown text=\{r\.body\} breaks="all" className=\{RESULT_MARKDOWN_CLASS\} \/>\s*\) : \(\s*<pre className=\{PANEL_PRE\} \/>\s*\)/,
    "빈 짝이 `<Markdown>`을 그대로 타면 §10의 `markdown.empty` 문구가 뜬다 — 종전 빈 상자가 아니다",
  );
});

test("`결과` 절이 `key={event.key}`로 달려 다른 줄을 고르면 다시 마크다운이다", () => {
  assert.match(
    s,
    /<ResultSection key=\{event\.key\} results=\{results\} \/>/,
    "`ResultSection`이 줄 키로 안 갈리면 토글 상태(`markdownOn`)가 다른 줄에서도 살아남는다",
  );
});

test("답변 대기면 참견 폼이 안 뜨고 목적지 문장과 함께 답변 폼으로 통째로 갈린다(§Done when 2)", () => {
  // `mode === "answer"`가 참견 폼 조립보다 먼저 `return`해 같은 자리에 참견 입력칸이 안 뜬다 —
  // 그래서 사람이 그 칸에 답을 쓰고 보내기를 눌러 `not-wip` 실패 문구를 보는 경로 자체가 없다.
  const answerBranch = s.indexOf('if (mode === "answer")');
  const formBuilt = s.indexOf("<InputGroupTextarea");
  assert.ok(
    answerBranch >= 0 && formBuilt >= 0 && answerBranch < formBuilt,
    "답변 분기가 참견 폼보다 먼저 return하지 않는다",
  );
  assert.match(
    s,
    /답변을 달면 이 티켓이 다시 큐에 뜨고 담당 세션이 이어서 봅니다\./,
    "답변 모드가 무엇을 하는지 가리키는 문장이 없다",
  );
});
