import type { Locale } from "@/lib/i18n";
import { pickManuscript } from "@/lib/site-locale";
import { Shell } from "../doc";
import { pageMetadata, titleOf } from "../meta";
import { siteLocale } from "../request-locale";

// 셸·크롬 판정과 메타데이터 자리는 `app/privacy/page.tsx`와 같다 — 두 장이 같은 성질의 산문이고
// 둘 다 `themeConfig.sidebar` 배열 밖이다(§사이트 기반 §루트 산문 2장의 셸).
// §0-24 §원고를 두는 자리 — `en/terms.md`가 있으면 그것, 없으면 한국어 원본이다. 법적 정본은
// 그래도 한국어본이다(P340-13이 `en/terms.md` 머리에 그 한 줄을 단다).
const source = (locale: Locale) => pickManuscript(locale, "terms.md");

// `Shell`의 `isLandingOnly()`가 요청마다 다시 봐야 한다(§상호 링크 — 자세한 이유는
// `docs/[[...slug]]/page.tsx`의 같은 줄). 원고도 그 요청이 그린 언어를 따라야 해서 정적
// `export const metadata`를 못 쓴다.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await siteLocale();
  return pageMetadata("/terms", titleOf(source(locale)), { locale });
}

export default async function Page() {
  const locale = await siteLocale();
  return <Shell source={source(locale)} path="/terms" editPath="terms.md" />;
}
