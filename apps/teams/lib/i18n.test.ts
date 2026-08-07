import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/language.json`을 밟지 않는다. import 전에 건다 — `keymap.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-i18n-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { t } = await import("./i18n.ts");
// 파일 읽기/쓰기는 `registryPath()` 옆에 산다 — `i18n.ts`가 클라이언트 번들로 가기 때문이다
// (그 파일 머리 주석, `keymap.test.ts`와 같은 이유로 같이 검증한다).
const { languagePath, readLanguage, setLanguage } = await import("./projects.ts");

test("없는 키는 ko로 떨어진다 — 빈 문자열도 키 이름 노출도 아니다", () => {
  assert.strictEqual(t("ko", "settings.language.label"), "언어");
  // en 사전엔 아직 아무 것도 안 옮겼다 — ko 값이 그대로 나와야 한다
  assert.strictEqual(t("en", "settings.language.label"), "언어");
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
  assert.strictEqual(`2026-01-01 ${t("ko", "common.add")}`, "2026-01-01 추가");
  assert.strictEqual(
    `${t("ko", "settings.tree.authGroup")} › ${t("ko", "settings.tree.claude")}`,
    "인증 › Claude 계정",
  );
});

test("readLanguage — 파일 없으면 기본값 ko, set 뒤에는 그 값을 읽는다", async () => {
  rmSync(languagePath(), { force: true });
  assert.strictEqual(await readLanguage(), "ko");

  await setLanguage("en");
  assert.strictEqual(await readLanguage(), "en");
});
