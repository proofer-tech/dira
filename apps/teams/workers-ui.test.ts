import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `workers-ui.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `sidebar.test.ts` · `settings-dialog.test.ts` · `project-switcher.test.ts`) —
// 그래서 소스 글자를 댄다.
// 티켓 830b8f22 (§비주얼 §58): 복구 버튼 넷이 성공하면 그 순간 초점을 든 버튼일 때만
// `이름` 셀로 초점을 옮기고 sr-only 문장 하나를 낭독한다. 여기서 못박는 것은 넷이 같은
// 관용구로 갈렸다는 것(§처방)과, 그 조건("옮기는 조건")이 실제로 `document.activeElement`를
// 확인한 뒤에만 발동한다는 것 — 눈으로 보이지 않는 회귀라 소스 검사로 고정한다.
const s = readFileSync("components/workers-ui.tsx", "utf8");

const BUTTONS = [
  { label: "공통 적용", pendingVar: "pending", ref: "applyBtnRef", sentence: "공통을 적용했습니다" },
  { label: "자가 정리 적용", pendingVar: "healing", ref: "healBtnRef", sentence: "자가 정리를 적용했습니다" },
  { label: "통합 게이트 적용", pendingVar: "gating", ref: "gateBtnRef", sentence: "통합 게이트를 적용했습니다" },
  { label: "실행 비트 켜기", pendingVar: "pending", ref: "btnRef", sentence: "실행 비트를 켰습니다" },
];

for (const { label, pendingVar, ref, sentence } of BUTTONS) {
  test(`${label} — disabled가 아니라 aria-disabled + 진행 중 재진입 가드`, () => {
    const labelIdx = s.indexOf(`"${label}"`);
    assert.ok(labelIdx > 0, `"${label}" 라벨을 못 찾았다`);
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
    const sentIdx = s.indexOf(`"${sentence}"`);
    assert.ok(sentIdx > 0, `성공 문장 "${sentence}"을 못 찾았다`);
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
