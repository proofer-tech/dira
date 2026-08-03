/** `render={<X/>}`의 `data-slot` 승자를 못박는다 (티켓 `41e37153`).
 *
 *  base-ui의 트리거는 `mergeProps(트리거props, render.props)`로 **render 쪽을 이기게** 한다
 *  (`@base-ui/react/internals/useRenderElement.mjs`). 그런데 그 `render.props`는 flight 참조가
 *  이미 풀렸을 때만 보인다 — 아직 lazy면 `undefined`라 트리거 쪽이 이긴다. 그래서 넘기는 쪽이
 *  **서버에서 미리 렌더되는 공유 컴포넌트**면 그 컴포넌트 내부의 `data-slot`이 `render.props`로
 *  새고, 승자가 청크 도착 순서에 달린다 = SSR과 클라이언트가 갈린다 = hydration 불일치.
 *
 *  판정은 하나다: **감싼 트리거가 이긴다.** 지키는 방법도 하나다 — `render=`로 넘겨지는
 *  컴포넌트가 자기 `data-slot`을 주면 그 파일은 클라이언트 경계여야 한다(페이로드에 안 펼쳐진다).
 *  이건 눈으로 못 지킨다: 증상이 prod에서만, 그것도 가끔 난다. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

function tsx(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsx(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : []
  );
}

test("`render=`로 넘기는 컴포넌트가 `data-slot`을 주면 그 파일은 `\"use client\"`다", () => {
  const files = [...tsx("app"), ...tsx("components")];
  const src = new Map(files.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]));

  // ① `render={` 뒤 **첫** 태그 = 넘기는 컴포넌트. `[^<]`라 중간 태그를 건너뛰지 않는다
  //    (건너뛰게 두면 `render={<summary/>}` 아래 형제 `<MarkerIcon>`이 잡힌다). 대문자만 본다
  const passed = new Set<string>();
  for (const s of src.values())
    for (const m of s.matchAll(/render=\{[^<]{0,400}<(\w+)/g)) if (/^[A-Z]/.test(m[1])) passed.add(m[1]);
  assert.ok(passed.has("Button"), "`render={<Button/>}` 자리를 못 찾았다 — 정규식이 코드와 갈렸다");

  // ② 그 컴포넌트가 이 레포에 살고 자기 `data-slot`을 주는가
  const offenders: string[] = [];
  for (const name of passed)
    for (const [f, s] of src) {
      const at = s.search(new RegExp(`^function ${name}\\(`, "m"));
      if (at < 0) continue;
      if (!/data-slot="/.test(s.slice(at, at + 900))) continue;
      // 지시어 앞의 주석은 지시어를 무효로 하지 않는다(파일 첫 import보다 앞이면 된다)
      const directive = s.search(/^\s*("use client"|'use client')/m);
      if (directive < 0 || directive > s.search(/^import /m)) offenders.push(`${f} (<${name}/>)`);
    }

  assert.deepStrictEqual(offenders, [], `\n${offenders.join("\n")}\n위 파일은 서버에서 미리 렌더돼 자기 \`data-slot\`이 \`render.props\`로 샌다. 맨 위에 "use client"를 준다.`);
});
