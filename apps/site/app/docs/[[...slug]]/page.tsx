import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import Doc from "../../doc";

// 매뉴얼 본문 22장(`docs/*.md`)을 굽는다. 셸(사이드바·아웃라인·이전/다음)은 별개 티켓이다.
// 라우트가 하나인 것은 `docs/index.md`가 나머지 21장과 같은 마크다운이라서다 — optional
// catch-all이 `/docs/`와 `/docs/<이름>`을 같은 파일로 받는다.
// 마크다운 렌더는 `app/doc.tsx` 한 벌이고 루트 산문 2장(`privacy`·`terms`)이 같은 것을 쓴다.
const DOCS = join(process.cwd(), "docs");
const names = readdirSync(DOCS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.slice(0, -3));

export function generateStaticParams() {
  return names.map((n) => ({ slug: n === "index" ? [] : [n] }));
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const name = slug?.length ? slug.join("/") : "index";
  if (!names.includes(name)) notFound();
  return <Doc source={readFileSync(join(DOCS, `${name}.md`), "utf8")} />;
}
