import { readFileSync } from "node:fs";
import { join } from "node:path";
import Doc from "../doc";
import { pageMetadata, titleOf } from "../meta";

// 크롬 판정과 메타데이터 자리는 `app/privacy/page.tsx`와 같다 — 두 장이 같은 성질의 산문이다.
const source = readFileSync(join(process.cwd(), "terms.md"), "utf8");

export const metadata = pageMetadata("/terms", titleOf(source));

export default function Page() {
  return <Doc source={source} />;
}
