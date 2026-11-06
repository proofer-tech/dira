import type { MetadataRoute } from "next";
import { ORIGIN, enPageUrls, lastmodOf, pageUrls, sourceFilesOf } from "./meta";

// 한국어 URL과 영어 URL을 모두 싣고, 각 `<url>`이 hreflang 셋(ko, en, x-default)을 `xhtml:link`로 단다
// (P548 결정 3). `lastmod`(P548 결정 7)는 원고 파일의 마지막 git 커밋 시각이고, git이 없거나 답이 비면
// 빌드 시각이다(`lastmodOf`). 영어 URL도 한국어 원고의 시각을 쓴다.
// ponytail: `en/` 원고를 따로 재지 않는다. 영어 원고만 고쳐도 lastmod가 안 오르므로, 필요해지면
// `sourceFilesOf`에 영어 경로를 더한다.
//
// `output: "export"`는 아래 한 줄을 요구한다 - 사이트맵도 라우트라서, 빌드가 굽는다고
// 명시하지 않으면 `Failed to collect page data for /sitemap.xml`로 죽는다.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const entry = (url: string, i: number) => ({
    url,
    lastModified: lastmodOf(sourceFilesOf(pageUrls[i].slice(ORIGIN.length))),
    alternates: { languages: { ko: pageUrls[i], en: enPageUrls[i], "x-default": pageUrls[i] } },
  });
  return [...pageUrls.map(entry), ...enPageUrls.map(entry)];
}
