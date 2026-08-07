import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Shell } from "../doc";
import { pageMetadata, titleOf } from "../meta";

// 셸도 마크다운 렌더도 매뉴얼과 한 벌이다(`app/doc.tsx`). 이 장이 안 받는 것은 사이드바와
// 이전/다음 둘뿐이고 — 그 둘만 `themeConfig.sidebar` 배열에서 나온다 — `sidebar`를 안 주는
// 것이 곧 그 판정이다(§사이트 기반 §루트 산문 2장의 셸). 종전 이 자리에 있던 *루트 산문 2장은
// 매뉴얼 셸의 크롬을 안 받는다*는 지적 `f74ad5a7`이 걷은 낱말이다 — 열 덩이 중 여덟이 걸렸고,
// 그 여덟은 사이트 전역이거나 이 장 본문에서 나온다.
const source = readFileSync(join(process.cwd(), "privacy.md"), "utf8");

// 열한 줄은 매뉴얼 22장과 같은 자리에서 온다(§SEO ② 태그 · `app/meta.ts`).
export const metadata = pageMetadata("/privacy", titleOf(source));

export default function Page() {
  return <Shell source={source} path="/privacy" editPath="privacy.md" />;
}
