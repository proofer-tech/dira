import type { MetadataRoute } from "next";
import { pageUrls } from "./meta";

// 종전 `config.ts`의 `sitemap: { hostname }` 한 줄이 굽던 것과 같은 25 URL이다(`app/meta.ts`의
// `pageUrls` — 잰 것은 `meta.test.ts`에 있다). `lastmod`는 넣지 않는다: vitepress도 안 넣었고
// (`lastUpdated: true`가 필요하고 그 한 줄이 화면 24장에 `Last updated`를 세운다) `lastmod`
// 없는 사이트맵도 유효하다(§SEO ①).
//
// `output: "export"`는 아래 한 줄을 요구한다 — 사이트맵도 라우트라서, 빌드가 굽는다고
// 명시하지 않으면 `Failed to collect page data for /sitemap.xml`로 죽는다.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return pageUrls.map((url) => ({ url }));
}
