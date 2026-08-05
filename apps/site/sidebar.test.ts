import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// 사이드바가 두 벌 산다 — vitepress `themeConfig.sidebar`와 Next 셸의 `SIDEBAR`. 전환
// 티켓(§순서 ⑧)이 `.vitepress/`를 지울 때까지는 두 빌드가 같은 목차를 그려야 하고, 눈으로
// 맞추면 라벨 한 자가 조용히 갈린다. 값을 소스에서 그대로 뽑아 순서째 댄다.
// 두 파일 다 못 import한다(config.ts는 vitepress를, page.tsx는 next/CSS를 끌고 온다).
// 그래서 대는 것은 **소스 글자**다 — `text:`/`link:` 토큰의 순서 있는 나열이 곧 목차다.
const pairs = (file: string, from: string, to: string) => {
  const s = readFileSync(file, "utf8");
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${file}: 사이드바 구간을 못 찾았다`);
  return [...s.slice(a, b).matchAll(/\b(text|link): "([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
};

test("사이드바 27항목이 vitepress config와 한 자도 안 다르다", () => {
  const vp = pairs(".vitepress/config.ts", "sidebar: {", "socialLinks:");
  const next = pairs("app/docs/[[...slug]]/page.tsx", "const SIDEBAR = [", "\nconst FLAT");
  assert.deepEqual(next, vp);
  // 그룹 6 + 링크 21 = 27. `link`가 없는 `text`가 그룹 라벨이다.
  assert.equal(vp.filter((p) => p.startsWith("link=")).length, 21);
  assert.equal(vp.filter((p) => p.startsWith("text=")).length, 27);
});
