import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/language.json`을 밟지 않는다. import 전에 건다 — `keymap.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-i18n-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { t, ko, en, wrap } = await import("./i18n.ts");
// 파일 읽기/쓰기는 `registryPath()` 옆에 산다 — `i18n.ts`가 클라이언트 번들로 가기 때문이다
// (그 파일 머리 주석, `keymap.test.ts`와 같은 이유로 같이 검증한다).
const { languagePath, readLanguage, setLanguage } = await import("./projects.ts");

test("없는 키는 ko로 떨어진다 — 빈 문자열도 키 이름 노출도 아니다", () => {
  assert.strictEqual(t("ko", "settings.language.label"), "언어");
  // 621c7a97이 설정 다이얼로그의 en을 채운 뒤로, 실제로 폴백에 걸리는 키는 **다음 묶음이
  // ko부터 넣는 동안**에만 생긴다. 그 상태를 여기서 만들어 못박는다 — 이 폴백이 109파일을
  // 묶음으로 쪼갤 수 있게 하는 못이다(§0-16 §장치 "없는 키").
  ko["test.koOnly"] = "아직 영어가 없다";
  try {
    assert.strictEqual(t("en", "test.koOnly"), "아직 영어가 없다");
  } finally {
    delete ko["test.koOnly"];
  }
});

test("ko에도 없는 키는 개발 실수로 던진다", () => {
  assert.throws(() => t("ko", "이런_키는_없다"));
});

// 30a8f5c3 첫 묶음 — `settings-dialog.tsx`가 변수와 조합해 그리는 문구는 원문과 한 글자도
// 안 갈려야 한다(§0-16 Done when). 단일 키 치환은 자명해 검증하지 않고, 조합만 못박는다.
test("settings-dialog.tsx의 조합 문구 — 원문 그대로 재조립된다", () => {
  assert.strictEqual(
    `${t("ko", "settings.keymap.resetTooltipPrefix")} ⌘K${t("ko", "settings.keymap.resetTooltipSuffix")}`,
    "기본값 ⌘K(으)로 되돌립니다",
  );
  assert.strictEqual(`"foo"${t("ko", "settings.search.emptySuffix")}`, `"foo"와 일치하는 설정 0건`);
  assert.strictEqual(`2026-01-01 ${t("ko", "settings.tokens.addedSuffix")}`, "2026-01-01 추가");
  assert.strictEqual(
    `${t("ko", "settings.tree.authGroup")} › ${t("ko", "settings.tree.claude")}`,
    "인증 › Claude 계정",
  );
});

// 621c7a97 — 같은 자리들이 영어로도 읽히는 문장이 되어야 한다(한국어 어순이 남으면 여기서 걸린다).
test("settings-dialog.tsx의 조합 문구 — 영어도 문장이 된다", () => {
  assert.strictEqual(
    `${t("en", "settings.keymap.resetTooltipPrefix")} ⌘K${t("en", "settings.keymap.resetTooltipSuffix")}`,
    "Reset to the default ⌘K",
  );
  assert.strictEqual(`"foo"${t("en", "settings.search.emptySuffix")}`, `"foo": no matching settings`);
  assert.strictEqual(`2026-01-01 ${t("en", "settings.tokens.addedSuffix")}`, "2026-01-01 added");
  assert.strictEqual(
    `${t("en", "settings.keymap.captureHint")} Esc ${t("en", "settings.keymap.captureCancelSuffix")}`,
    "Whatever you press is assigned as-is · other shortcuts stop listening while this is open · Esc to cancel",
  );
  assert.strictEqual(
    `${t("en", "settings.tree.authGroup")} › ${t("en", "settings.tree.claude")}`,
    "Authentication › Claude account",
  );
});

// 932ae344 — 사전 밖에 있던 서버 문자열(키맵 액션 이름 · 거절 사유 · aria-label 조합 · 토큰
// 표시명 접두)을 ko 키로 뽑았다. 조합 결과가 원문과 한 글자도 안 갈리는지 여기서 못박는다.
test("932ae344 — 새로 뽑은 조합 문구들이 원문 그대로 재조립된다", () => {
  assert.strictEqual(
    `${t("ko", "settings.keymap.action.project.search")} ${t("ko", "settings.keymap.resetActionSuffix")}`,
    "프로젝트 검색 기본값으로 되돌리기",
  );
  assert.strictEqual(`A계정 ${t("ko", "settings.tokens.editLabelSuffix")}`, "A계정 라벨 편집");
  assert.strictEqual(`A계정 ${t("ko", "settings.tokens.deleteSuffix")}`, "A계정 삭제");
  assert.strictEqual(`${t("ko", "settings.tokens.accountFallbackPrefix")} 1`, "계정 1");
  assert.strictEqual(
    `${t("ko", "settings.keymap.reject.unknownAction")} nope.gone`,
    "모르는 액션입니다: nope.gone",
  );
});

// 6914f1d1 — 설정 다이얼로그 묶음은 여기서 끝난다. 폴백은 **다음 묶음이 ko를 먼저 넣는 동안**을
// 위한 장치지, 지금 든 묶음이 영어로 덜 서도 된다는 뜻이 아니다(§0-16 §발행).
//
// 이 판정은 **이미 다 찬 묶음**으로 좁힌다 — 다음 묶음이 ko를 먼저 넣는 동안에는 그 접두가
// 아직 이 목록에 없다(§0-16 §발행 "다음 티켓들이 여기 키를 늘린다"). 묶음의 en을 채우는
// 티켓이 자기 접두를 여기 더한다: `settings.`·`common.`(6914f1d1) · `ticket.priority.`(62e0b85e).
//
// **접두는 묶음 단위로 좁게 적는다.** `ticket.`으로 넓히면 아직 ko만 있는 다음 화면
// (`ticket.duedate.*`, §1-4)까지 걸려 그 묶음의 첫 티켓이 이 테스트를 깬다 — 폴백이 있는
// 이유가 그 상태를 허용하는 것이다.
const FILLED = ["settings.", "common.", "ticket.priority."];

test("이미 찬 묶음(settings·common·ticket.priority)의 ko 키는 en에 하나도 안 빠졌다", () => {
  assert.deepStrictEqual(
    Object.keys(ko).filter((k) => FILLED.some((p) => k.startsWith(p)) && !(k in en)),
    [],
  );
});

// 62e0b85e — 우선순위 묶음. 상속 한 줄은 해시·유효값 두 변수 사이에 사전 조각이 끼는 자리라
// 조립 결과를 두 언어 다 못박는다(`ticket-ui.tsx`의 JSX는 줄바꿈 공백을 지우므로, 조각과
// 해시 사이에 공백이 없고 조각과 유효값 사이에만 공백 하나가 있다).
test("우선순위 상속 한 줄 — 두 언어에서 다 문장이 된다", () => {
  const line = (l: "ko" | "en", hash: string, effective: number) =>
    `${hash}${t(l, "ticket.priority.inheritedMiddle")} ${effective}${t(l, "ticket.priority.inheritedAfter")}`;
  assert.strictEqual(line("ko", "high0002", 5), "high0002가 기다려 5로 뜹니다");
  assert.strictEqual(line("en", "high0002", 5), "high0002 is waiting on this, so it comes up as 5");
});

// select 다섯 항목은 숫자만 있으면 뜻이 없다 — 다섯 값 전부에 꼬리 문구가 있고, 영어에서
// 폴백(한국어)으로 안 떨어지는지 본다. 한글 판정은 아래 `en 사전에 한글이 없다`가 같이 잡는다.
test("우선순위 다섯 단계에 꼬리 문구가 전부 있다", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const key = `ticket.priority.level.${n}`;
    assert.ok(t("ko", key).length > 0, `ko ${key}`);
    assert.ok(t("en", key).length > 0, `en ${key}`);
    assert.notStrictEqual(t("en", key), t("ko", key));
  }
});

// 화면에 남은 한국어를 여기서 잡는다 — 사전 값 자체에 한글이 섞이면 폴백이 아니라 오타다.
// 언어 이름 둘만 예외다(영어 화면에서도 `한국어`는 `한국어`로 적는다).
test("en 사전에 한글이 없다 — 언어 이름 둘만 예외다", () => {
  const hangul = Object.entries(en)
    .filter(([k, v]) => /[가-힣]/.test(v) && !k.startsWith("settings.language."))
    .map(([k]) => k);
  assert.deepStrictEqual(hangul, []);
});

// 932ae344가 뽑은 자리들이 영어에서도 문장이 되는가. 한국어는 이름 뒤에 다 붙지만 영어는
// 동사가 앞에 서므로, 접두·접미 두 조각을 `wrap`이 붙이고 빈 쪽을 지운다.
test("6914f1d1 — 어순이 뒤집히는 조합 문구가 두 언어에서 다 선다", () => {
  const reset = (l: "ko" | "en", n: string) =>
    wrap(t(l, "settings.keymap.resetActionPrefix"), n, t(l, "settings.keymap.resetActionSuffix"));
  assert.strictEqual(reset("ko", "프로젝트 검색"), "프로젝트 검색 기본값으로 되돌리기");
  assert.strictEqual(reset("en", "Search projects"), "Reset Search projects to default");

  const edit = (l: "ko" | "en", n: string) =>
    wrap(t(l, "settings.tokens.editLabelPrefix"), n, t(l, "settings.tokens.editLabelSuffix"));
  assert.strictEqual(edit("ko", "A계정"), "A계정 라벨 편집");
  assert.strictEqual(edit("en", "Account 1"), "Edit label for Account 1");

  const del = (l: "ko" | "en", n: string) =>
    wrap(t(l, "settings.tokens.deletePrefix"), n, t(l, "settings.tokens.deleteSuffix"));
  assert.strictEqual(del("ko", "A계정"), "A계정 삭제");
  assert.strictEqual(del("en", "Account 1"), "Delete Account 1");

  // 라벨 없는 토큰의 표시 이름 · 모르는 액션 — 어순이 같아 접두 하나로 끝난다
  assert.strictEqual(`${t("en", "settings.tokens.accountFallbackPrefix")} 1`, "Account 1");
  assert.strictEqual(
    `${t("en", "settings.keymap.reject.unknownAction")} nope.gone`,
    "Unknown action: nope.gone",
  );
  // 캡처 거절 줄 전체(사유 + 안내 + Esc) — 사유가 마침표로 끝나야 두 조각이 안 붙는다
  assert.strictEqual(
    `${t("en", "settings.keymap.reject.tab")} ${t("en", "settings.keymap.captureRejectedSuffix")} Esc ${t("en", "settings.keymap.captureCancelSuffix")}`,
    "`Tab` moves focus. Press another key · Esc to cancel",
  );
});

test("wrap — 빈 조각은 빠지고 공백이 겹치지 않는다", () => {
  assert.strictEqual(wrap("", "가운데", "뒤"), "가운데 뒤");
  assert.strictEqual(wrap("앞", "가운데", ""), "앞 가운데");
  assert.strictEqual(wrap("", "혼자", ""), "혼자");
});

test("readLanguage — 파일 없으면 기본값 ko, set 뒤에는 그 값을 읽는다", async () => {
  rmSync(languagePath(), { force: true });
  assert.strictEqual(await readLanguage(), "ko");

  await setLanguage("en");
  assert.strictEqual(await readLanguage(), "en");
});
