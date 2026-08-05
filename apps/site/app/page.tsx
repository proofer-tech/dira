import { diraVersion } from "../version";
import Landing from "./landing";
import { pageMetadata } from "./meta";

// `index.md`(`layout: page`) + `Landing.vue`가 여기로 왔다(§사이트 기반 §갈아 끼우는 것).
// 두 파일로 갈린 자리는 하나다 — `version.ts`가 `node:fs`로 `apps/desktop/package.json`을
// 읽으므로 그 줄은 서버에 남아야 한다. 종전 `themeConfig.diraVersion` → `useData()` 왕복과
// 같은 값이 같은 시점(빌드)에 온다.

// `index.md`가 `titleTemplate: false`였던 유일한 장이라 `<title>`에 사이트 이름이 안 붙는다.
export const metadata = pageMetadata("/", "dira - 로컬 멀티 에이전트 매니지먼트 시스템", {
  suffix: false,
});

export default function Page() {
  return <Landing version={diraVersion} />;
}
