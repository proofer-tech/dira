import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Shell } from "../doc";
import { pageMetadata, titleOf } from "../meta";

// 셸·크롬 판정과 메타데이터 자리는 `app/privacy/page.tsx`와 같다 — 두 장이 같은 성질의 산문이고
// 둘 다 `themeConfig.sidebar` 배열 밖이다(§사이트 기반 §루트 산문 2장의 셸).
const source = readFileSync(join(process.cwd(), "terms.md"), "utf8");

export const metadata = pageMetadata("/terms", titleOf(source));

export default function Page() {
  return <Shell source={source} path="/terms" editPath="terms.md" />;
}
