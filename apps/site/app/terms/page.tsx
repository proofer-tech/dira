import { readFileSync } from "node:fs";
import { join } from "node:path";
import Doc from "../doc";

// 크롬 판정은 `app/privacy/page.tsx`와 같다 — 두 장이 같은 성질의 산문이다.
export default function Page() {
  return <Doc source={readFileSync(join(process.cwd(), "terms.md"), "utf8")} />;
}
