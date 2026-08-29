import type { Locale } from "@/lib/i18n";
import { pickManuscript } from "@/lib/site-locale";
import { Shell } from "../doc";
import { pageMetadata, titleOf } from "../meta";
import { siteLocale } from "../request-locale";

// 셸도 마크다운 렌더도 매뉴얼과 한 벌이다(`app/doc.tsx`). 이 장이 안 받는 것은 사이드바와
// 이전/다음 둘뿐이고 — 그 둘만 `themeConfig.sidebar` 배열에서 나온다 — `sidebar`를 안 주는
// 것이 곧 그 판정이다(§사이트 기반 §루트 산문 2장의 셸). 종전 이 자리에 있던 *루트 산문 2장은
// 매뉴얼 셸의 크롬을 안 받는다*는 지적 `f74ad5a7`이 걷은 낱말이다 — 열 덩이 중 여덟이 걸렸고,
// 그 여덟은 사이트 전역이거나 이 장 본문에서 나온다.
// §0-24 §원고를 두는 자리 — `en/privacy.md`가 있으면 그것, 없으면 한국어 원본이다. 법적 정본은
// 그래도 한국어본이다(P340-13이 `en/privacy.md` 머리에 그 한 줄을 단다).
const source = (locale: Locale) => pickManuscript(locale, "privacy.md");

// 열한 줄은 매뉴얼 22장과 같은 자리에서 온다(§SEO ② 태그 · `app/meta.ts`). 원고가 요청마다
// 갈리므로 정적 `export const metadata`를 못 쓴다.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await siteLocale();
  return pageMetadata("/privacy", titleOf(source(locale)), { locale });
}

export default async function Page() {
  const locale = await siteLocale();
  return <Shell source={source(locale)} path="/privacy" editPath="privacy.md" />;
}
