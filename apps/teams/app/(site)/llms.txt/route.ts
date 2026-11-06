import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../../../lib/i18n.ts";
import { descriptionOf, docNames, docPath, ORIGIN, titleOf } from "../meta";

// P548 결정 8 - llmstxt.org 형식. 한국어판 기준이고 영어판은 목차 주소 한 줄이다.
// 제목과 description은 `<head>`가 쓰는 그 함수(`titleOf`, `descriptionOf`)라 어긋나지 않는다.
export const dynamic = "force-static";

export function GET() {
  const docs = docNames.map((n) => {
    const src = readFileSync(join(process.cwd(), "docs", `${n}.md`), "utf8");
    const desc = descriptionOf(src);
    return `- [${titleOf(src)}](${ORIGIN}${docPath(n)})${desc ? `: ${desc}` : ""}`;
  });
  const body = ["# dira", "", `> ${t("ko", "siteMeta.description")}`, "", "## Docs", "", ...docs, "", "## English", "", `${ORIGIN}/en/docs/`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
