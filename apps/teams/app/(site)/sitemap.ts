import type { MetadataRoute } from "next";
import { lastmodOf, pageUrls, sourceFilesOf, ORIGIN } from "./meta";

// 같은 URL 목록(`app/meta.ts`의 `pageUrls`)에 `lastmod`를 얹는다. P548 결정 7: 값은 원고 파일의 마지막
// git 커밋 시각이고, git이 없거나 답이 비면 빌드 시각이다(`lastmodOf`). 옛 판단("넣지 않는다")은
// 크롤러가 바뀐 문서만 다시 받게 하려는 요구가 생겨 뒤집었다.
//
// `output: "export"`는 아래 한 줄을 요구한다 — 사이트맵도 라우트라서, 빌드가 굽는다고
// 명시하지 않으면 `Failed to collect page data for /sitemap.xml`로 죽는다.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return pageUrls.map((url) => ({ url, lastModified: lastmodOf(sourceFilesOf(url.slice(ORIGIN.length))) }));
}
