import { defineConfig } from "vitepress";
import { diraVersion } from "../version.ts";

export default defineConfig({
  lang: "ko-KR",
  title: "dira",
  description:
    "티켓을 큐에 넣으면 cron에 물린 워커가 claude 세션에 넘긴다. 파일시스템이 곧 큐인 티켓 디스패처.",
  cleanUrls: true,
  // 죽은 내부 링크는 빌드를 깨뜨린다. 매뉴얼 18장의 링크 검사를 이것으로 대신한다.
  // 유예다. 매뉴얼 18장이 다 들어오는 Task 8에서 `false`로 되돌린다.
  ignoreDeadLinks: [/^\/docs\//],
  head: [["link", { rel: "icon", href: "/icon.svg", type: "image/svg+xml" }]],
  themeConfig: {
    diraVersion,
  },
});
