// P548 결정 6 - 구조화 데이터. 순수 함수라 `jsonld.test.ts`가 그대로 잰다.
import { ORIGIN, docPath } from "./meta.ts";

/** 랜딩의 다운로드 링크가 가리키는 주소(`landing.tsx`의 `dmg` 기본값)와 같다. */
export const RELEASES_URL = "https://github.com/proofer-tech/dira/releases/latest";

/** 홈의 SoftwareApplication과 Organization. 랜딩이 "로컬 엔진과 앱은 영원히 무료"라고 하므로 가격은 0이다. */
export function homeJsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "dira",
      alternateName: "디라",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS",
      url: `${ORIGIN}/`,
      downloadUrl: RELEASES_URL,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "프루퍼 주식회사",
      url: "https://proofer.tech",
    },
  ];
}

/** 홈 -> 매뉴얼 목차 -> 그 장. 목차 자신(`index`)은 둘이다. URL은 절대 주소다. */
export function breadcrumbJsonLd(
  name: string,
  labels: { home: string; manual: string; page: string },
): object {
  const items = [
    { name: labels.home, url: `${ORIGIN}/` },
    { name: labels.manual, url: `${ORIGIN}${docPath("index")}` },
    ...(name === "index" ? [] : [{ name: labels.page, url: `${ORIGIN}${docPath(name)}` }]),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

/** `<script>` 안에 넣을 문자열. `<`를 이스케이프해 `</script>`로 탈출하지 못하게 한다. */
export const jsonLdString = (data: object) => JSON.stringify(data).replace(/</g, "\\u003c");
