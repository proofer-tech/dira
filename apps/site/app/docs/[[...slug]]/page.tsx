import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import Doc from "../../doc";
import { docNames, docPath, pageMetadata, titleOf } from "../../meta";

// 매뉴얼 본문 22장(`docs/*.md`)을 굽는다. 셸(사이드바·아웃라인·이전/다음)은 별개 티켓이다.
// 라우트가 하나인 것은 `docs/index.md`가 나머지 21장과 같은 마크다운이라서다 — optional
// catch-all이 `/docs/`와 `/docs/<이름>`을 같은 파일로 받는다.
// 마크다운 렌더는 `app/doc.tsx` 한 벌이고 루트 산문 2장(`privacy`·`terms`)이 같은 것을 쓴다.
// 굽는 이름 목록은 `app/meta.ts`가 진다 — `app/sitemap.ts`가 **같은 목록**을 보므로
// 사이트맵과 실제 라우트가 어긋날 자리가 없다.
const DOCS = join(process.cwd(), "docs");
const source = (name: string) => readFileSync(join(DOCS, `${name}.md`), "utf8");

export function generateStaticParams() {
  return docNames.map((n) => ({ slug: n === "index" ? [] : [n] }));
}

/** `slug`는 URL에서 온다. 목록에 없는 이름으로 파일을 읽지 않는다 — 정적 산출에는 안 서는
 *  경로지만 `dev`에서는 임의 세그먼트가 그대로 들어온다. */
const nameOf = (slug?: string[]) => {
  const name = slug?.length ? slug.join("/") : "index";
  if (!docNames.includes(name)) notFound();
  return name;
};

type Params = { params: Promise<{ slug?: string[] }> };

// 종전 `transformPageData`가 얹던 canonical·og·twitter 열한 줄이 여기로 온다(§SEO ② 태그).
// 제목은 그 훅이 읽던 `pageData.title`과 같은 값이다 — 첫 `# ` 헤딩의 글자다.
export async function generateMetadata({ params }: Params) {
  const name = nameOf((await params).slug);
  return pageMetadata(docPath(name), titleOf(source(name)));
}

export default async function Page({ params }: Params) {
  return <Doc source={source(nameOf((await params).slug))} />;
}
