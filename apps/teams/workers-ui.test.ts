import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `workers-ui.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `settings-dialog.test.ts` · `project-switcher.test.ts`) —
// 그래서 소스 글자를 댄다.
// 티켓 830b8f22 (§비주얼 §58): 복구 버튼 넷이 성공하면 그 순간 초점을 든 버튼일 때만
// `이름` 셀로 초점을 옮기고 sr-only 문장 하나를 낭독한다. 여기서 고정하는 것은 넷이 같은
// 관용구로 갈렸다는 것(§처방)과, 그 조건("옮기는 조건")이 실제로 `document.activeElement`를
// 확인한 뒤에만 발동한다는 것 — 눈으로 보이지 않는 회귀라 소스 검사로 고정한다.
const s = readFileSync("components/workers-ui.tsx", "utf8");

// 610dc0c0(§0-16 §발행 §묶음 표 행 5)이 이 넷의 화면 문자열을 `lib/i18n.ts` ko 키로 옮겼다 —
// 앵커도 리터럴이 아니라 `t("<키>")` 호출로 찾는다(값 자체는 `i18n.test.ts`가 고정한다).
const BUTTONS = [
  {
    label: "workers.contextRow.applyCommonButton",
    pendingVar: "pending",
    ref: "applyBtnRef",
    sentence: "workers.contextRow.commonAppliedSentence",
  },
  {
    label: "workers.contextRow.applySelfHealButton",
    pendingVar: "healing",
    ref: "healBtnRef",
    sentence: "workers.contextRow.selfHealAppliedSentence",
  },
  {
    label: "workers.contextRow.applyGateButton",
    pendingVar: "gating",
    ref: "gateBtnRef",
    sentence: "workers.contextRow.gateAppliedSentence",
  },
  {
    label: "workers.execFix.button",
    pendingVar: "pending",
    ref: "btnRef",
    sentence: "workers.execFix.successSentence",
  },
];

for (const { label, pendingVar, ref, sentence } of BUTTONS) {
  test(`${label} — disabled가 아니라 aria-disabled + 진행 중 재진입 가드`, () => {
    const labelIdx = s.indexOf(`t("${label}")`);
    assert.ok(labelIdx > 0, `t("${label}") 호출을 못 찾았다`);
    const btnStart = s.lastIndexOf("<Button", labelIdx);
    const btnBody = s.slice(btnStart, labelIdx);
    assert.match(
      btnBody,
      new RegExp(`aria-disabled=\\{${pendingVar}\\}`),
      `${label}: aria-disabled={${pendingVar}}가 없다`,
    );
    assert.ok(
      !new RegExp(`[^-]disabled=\\{${pendingVar}\\}`).test(btnBody),
      `${label}: 옛 disabled가 남아 있다`,
    );
    assert.match(btnBody, /className="aria-disabled:opacity-50"/, `${label}: 흐림 클래스가 없다`);
    assert.match(btnBody, new RegExp(`ref=\\{${ref}\\}`), `${label}: 버튼 ref가 없다`);
    assert.match(
      btnBody,
      new RegExp(`if \\(${pendingVar}\\) return;`),
      `${label}: 핸들러 첫 줄 재진입 가드가 없다`,
    );
  });

  test(`${label} — 성공은 그 순간 초점을 든 버튼일 때만 낭독한다`, () => {
    const sentIdx = s.indexOf(`t("${sentence}")`);
    assert.ok(sentIdx > 0, `t("${sentence}") 호출을 못 찾았다`);
    const guardStart = s.lastIndexOf("if (r.ok", sentIdx);
    assert.ok(guardStart > 0 && sentIdx - guardStart < 200, `${label}: r.ok 가드를 못 찾았다`);
    const guard = s.slice(guardStart, sentIdx);
    assert.match(
      guard,
      new RegExp(`document\\.activeElement === ${ref}\\.current`),
      `${label}: 초점 확인 없이 낭독한다`,
    );
    assert.match(guard, /announceSuccess\(/, `${label}: announceSuccess를 안 부른다`);
  });
}

test("실패 경로는 초점을 옮기지 않는다 — announceSuccess가 r.ok 분기 밖에 없다", () => {
  // 실패 시 setError/setApplyError 등은 그대로고, 그 옆에 announceSuccess 호출이 없어야 한다.
  const failureLines = s
    .split("\n")
    .filter((l) => l.includes("? null : (r.message ??"));
  assert.ok(failureLines.length >= 4, "실패 메시지 대입 줄 넷을 못 찾았다");
  for (const line of failureLines) {
    assert.ok(!line.includes("announceSuccess"), `실패 대입 줄에 announceSuccess가 섞였다: ${line}`);
  }
});

test("WorkerNameCell — tabIndex=-1 + focus-visible 링 + blur에 문장을 지운다", () => {
  const start = s.indexOf("export function WorkerNameCell");
  assert.ok(start > 0, "WorkerNameCell을 못 찾았다");
  const end = s.indexOf("\n}", start);
  const body = s.slice(start, end);
  assert.match(body, /tabIndex=\{-1\}/, "tabIndex={-1}가 없다");
  assert.match(
    body,
    /focus-visible:inset-ring-3 focus-visible:inset-ring-ring\/50/,
    "focus-visible 링 클래스가 없다",
  );
  assert.match(body, /onBlur=\{\(\) => clearSuccess\(row\.name\)\}/, "blur에 clearSuccess를 안 부른다");
  assert.match(body, /className="sr-only"/, "sr-only 문장이 없다");
  assert.ok(!body.includes("role="), "새 라이브 리전(role)을 달았다");
});

test("ExpandCtx는 새 provider 0 — ExpandScope 하나가 success 상태까지 나눠 준다", () => {
  const providerCount = (s.match(/<ExpandCtx\.Provider/g) ?? []).length;
  assert.equal(providerCount, 1, "ExpandCtx.Provider가 하나가 아니다(새 provider가 생겼다)");
});

test("page.tsx가 이름 셀에 WorkerNameCell을 쓴다", () => {
  const page = readFileSync("app/(app)/p/[project]/workers/page.tsx", "utf8");
  assert.match(page, /<WorkerNameCell row=\{w\} \/>/, "page.tsx가 WorkerNameCell을 안 쓴다");
  assert.ok(!page.includes('title={w.path}>\n                  {w.name}'), "옛 이름 셀 마크업이 남아 있다");
});

// 티켓 a72ff221: `ContextRejection`이 `reason`을 한국어 리터럴과 비교해 "블록 없음"을 판정하면
// `en`에서는 `reason`이 영어라 두 문자열이 안 맞아 안내가 통째로 사라진다(사전 `4c195255`가
// `en`을 채운 뒤 드러남). 서버가 이미 내는 `missing` 플래그로 판정해야 로케일과 무관하다.
test("ContextRejection이 reason을 한국어 리터럴과 비교하지 않는다 — missing 플래그로 판정한다", () => {
  assert.ok(!s.includes("블록이 없습니다"), "한국어 리터럴이 소스에 남아 있다");
  const start = s.indexOf("function ContextRejection(");
  assert.ok(start > 0, "ContextRejection을 못 찾았다");
  const end = s.indexOf("\n}\n", start);
  const body = s.slice(start, end);
  assert.match(body, /missing\?: true/, "missing 프롭이 없다");
  assert.ok(!/reason ===/.test(body), "reason을 다시 문자열 비교하고 있다");
});

test("ContextRejection 호출 두 곳 모두 missing을 넘긴다", () => {
  const calls = [...s.matchAll(/<ContextRejection\b[\s\S]*?\/>/g)];
  assert.equal(calls.length, 2, "ContextRejection 호출을 두 곳 못 찾았다");
  for (const [call] of calls) {
    assert.match(call, /missing=\{[^}]+\.missing\}/, `missing을 안 넘기는 호출: ${call}`);
  }
});
