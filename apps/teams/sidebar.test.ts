import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// 사이드바가 두 벌 살던 동안(vitepress `themeConfig.sidebar` ↔ Next 셸의 `SIDEBAR`) 이 파일은
// 두 소스의 `text:`/`link:` 토큰을 순서째 댔다. 전환 티켓(§순서 ⑧)이 `.vitepress/config.ts`를
// 지우면서 **대던 쪽이 없어졌다** — 그래서 판정을 죽이지 않고 자를 갈았다: 이제 대는 것은
// `docs/*.md` 25장이다(24장 + 목차 `index.md`). 사이드바가 유일한 전역 이동 수단이라
// 링크 집합이 문서 집합과 어긋나면 어느 장은 영영 못 닿거나 404가 된다.
// 소스를 못 import한다(`page.tsx`가 next/CSS를 끌고 온다). 그래서 대는 것은 **소스 글자**다.
// `text: "<literal>"`이 `textKey: "<i18n 키>"`로 갈렸다(§0-24, 티켓 76b659fd — 라벨이
// `lib/i18n.ts`의 `ko` 사전으로 옮겨 갔다) — 이 정규식도 같이 갈았다. 세는 성질(링크 26 ·
// 그룹+링크 32)은 한 자도 안 바뀐다.
const s = readFileSync("app/(site)/docs/[[...slug]]/page.tsx", "utf8");
const a = s.indexOf("const SIDEBAR: ");
const b = s.indexOf("\nconst FLAT", a);
assert.ok(a >= 0 && b > a, "page.tsx: 사이드바 구간을 못 찾았다");
const tokens = [...s.slice(a, b).matchAll(/\b(textKey|link): "([^"]*)"/g)].map((m) => [m[1], m[2]]);

test("사이드바 링크 26개가 `docs/*.md`와 한 장도 안 어긋난다", () => {
  const linked = tokens.filter(([k]) => k === "link").map(([, v]) => v);
  const files = readdirSync("docs")
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => `/docs/${f.slice(0, -3)}`);
  assert.deepEqual([...linked].sort(), files.sort());
});

test("그룹 6 + 링크 26 = 32항목", () => {
  // `link`가 없는 `textKey`가 그룹 라벨이다 — 6묶음이 §갈아 끼우는 것의 계약이다.
  assert.equal(tokens.filter(([k]) => k === "link").length, 26);
  assert.equal(tokens.filter(([k]) => k === "textKey").length, 32);
});

test("사이드바 textKey 32개가 전부 `lib/i18n.ts`의 `ko` 사전에 있다", async () => {
  const { ko } = await import("./lib/i18n.ts");
  const keys = tokens.filter(([k]) => k === "textKey").map(([, v]) => v);
  const missing = keys.filter((k) => !(k in ko));
  assert.deepEqual(missing, []);
});
