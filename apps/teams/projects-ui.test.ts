import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// `projects-ui.tsx`는 next/CSS를 끌고 오는 클라이언트 컴포넌트라 import를 못 댄다
// (선례 `project-switcher.test.ts`) — 그래서 소스 글자를 댄다.
// 티켓 5e7d0faf: `ProjectSettingsDialog`의 `open`은 부모가 쥔 controlled prop이다 — 톱니
// 클릭처럼 밖에서 `setOpen(true)`로 바로 바뀌면 base-ui `Dialog`의 `onOpenChange`는 안
// 불린다(그 콜백은 트리거 클릭·Escape·바깥 클릭 같은 내부 상호작용 전용이라 `open` prop
// 변화 자체엔 안 걸린다 — `@base-ui/react` `ReactStore.useControlledProp`은 `store.setState`만
// 하고 `onOpenChange`를 안 부른다). 그래서 `load()`가 Dialog의 `onOpenChange` 안에만 있으면
// 톱니로 열 때는 안 불려서 `읽는 중…`에 멈춘다.
const s = readFileSync("components/projects-ui.tsx", "utf8");

function sliceFn(marker: string): string {
  const start = s.indexOf(marker);
  assert.ok(start > 0, `${marker}를 못 찾았다`);
  const end = s.indexOf("\n  return (", start);
  assert.ok(end > start, `${marker} 뒤 return (을 못 찾았다`);
  return s.slice(start, end);
}

test("설정 다이얼로그가 열림 자체(useEffect)로 읽는다 — Dialog의 onOpenChange에만 안 얹는다", () => {
  const body = sliceFn("export function ProjectSettingsDialog(");
  assert.match(
    body,
    /useEffect\(\(\) => \{\s*if \(open\) load\(\);\s*\}, \[open, load\]\);/,
    "open을 직접 보는 useEffect가 없다 — 톱니 클릭(외부 setOpen)에서 load()가 안 불린다",
  );
});

test("Dialog의 onOpenChange는 더 이상 load()를 겸하지 않는다 — 열림 감지가 두 군데로 안 갈린다", () => {
  const body = sliceFn("export function ProjectSettingsDialog(");
  const dialogOpenChange = body.slice(body.indexOf("<Dialog"), body.indexOf("<DialogContent"));
  assert.ok(
    !dialogOpenChange.includes("load()"),
    "onOpenChange 안에서 load()를 또 부른다 — 두 경로가 따로 놀면 다음 회귀가 조용히 돌아온다",
  );
});
