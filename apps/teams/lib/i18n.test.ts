import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/language.json`을 밟지 않는다. import 전에 건다 — `keymap.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-i18n-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { t, ko } = await import("./i18n.ts");
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

test("readLanguage — 파일 없으면 기본값 ko, set 뒤에는 그 값을 읽는다", async () => {
  rmSync(languagePath(), { force: true });
  assert.strictEqual(await readLanguage(), "ko");

  await setLanguage("en");
  assert.strictEqual(await readLanguage(), "en");
});
