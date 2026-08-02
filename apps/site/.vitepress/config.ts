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
    nav: [
      { text: "매뉴얼", link: "/docs/" },
      { text: "다운로드", link: "https://github.com/proofer-tech/dira/releases/latest" },
    ],
    sidebar: {
      "/docs/": [
        {
          text: "시작하기",
          items: [
            { text: "dira가 뭔가", link: "/docs/what-is-dira" },
            { text: "설치", link: "/docs/install" },
            { text: "첫 티켓 굴리기", link: "/docs/first-ticket" },
          ],
        },
        {
          text: "설정",
          items: [
            { text: "워커 만들기", link: "/docs/worker" },
            { text: "cron 등록", link: "/docs/cron" },
            { text: "헤드리스 인증", link: "/docs/auth" },
            { text: "동시성", link: "/docs/concurrency" },
          ],
        },
        {
          text: "쓰기",
          items: [
            { text: "티켓 쓰는 법", link: "/docs/ticket-writing" },
            { text: "상태는 파일명", link: "/docs/states" },
            { text: "화면에서 하는 일", link: "/docs/screens" },
            { text: "도는 세션에 말 걸기", link: "/docs/barge-in" },
            { text: "페르소나와 프로토콜", link: "/docs/personas" },
          ],
        },
        // 운영 + 레퍼런스 — Task 8
        // {
        //   text: "운영",
        //   items: [
        //     { text: "트러블슈팅", link: "/docs/troubleshooting" },
        //     { text: "로그 읽는 법", link: "/docs/logs" },
        //     { text: "사용 통계와 끄는 법", link: "/docs/analytics" },
        //   ],
        // },
        // {
        //   text: "레퍼런스",
        //   items: [
        //     { text: "워커 환경변수", link: "/docs/ref-env" },
        //     { text: "CLI", link: "/docs/ref-cli" },
        //     { text: "frontmatter 필드", link: "/docs/ref-frontmatter" },
        //   ],
        // },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/proofer-tech/dira" }],
    editLink: {
      pattern: "https://github.com/proofer-tech/dira/edit/master/apps/site/:path",
      text: "이 페이지 고치기",
    },
  },
});
