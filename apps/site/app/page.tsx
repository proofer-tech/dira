import { diraVersion } from "../version";
import Landing from "./landing";

// `index.md`(`layout: page`) + `Landing.vue`가 여기로 왔다(§사이트 기반 §갈아 끼우는 것).
// 두 파일로 갈린 자리는 하나다 — `version.ts`가 `node:fs`로 `apps/desktop/package.json`을
// 읽으므로 그 줄은 서버에 남아야 한다. 종전 `themeConfig.diraVersion` → `useData()` 왕복과
// 같은 값이 같은 시점(빌드)에 온다. 메타데이터·`<title>`은 §순서 ⑦이 세운다.
export default function Page() {
  return <Landing version={diraVersion} />;
}
