import { defineConfig } from "vitepress";
import { diraVersion } from "../version.ts";

export default defineConfig({
  lang: "ko-KR",
  title: "dira",
  description:
    "티켓을 큐에 넣으면 cron에 물린 워커가 claude 세션에 넘긴다. 파일시스템이 곧 큐인 티켓 디스패처.",
  cleanUrls: true,
  // 죽은 내부 링크는 빌드를 깨뜨린다. 매뉴얼 19장이 다 들어왔으므로 유예 없이 전수 검사한다.
  ignoreDeadLinks: false,
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
            { text: "dira에 대하여", link: "/docs/what-is-dira" },
            { text: "설치", link: "/docs/install" },
            { text: "첫 프로젝트 만들기", link: "/docs/first-ticket" },
            { text: "요구사항 접수하기", link: "/docs/requirements" },
          ],
        },
        {
          text: "지켜보기",
          items: [
            { text: "화면 소개", link: "/docs/screens" },
            { text: "도는 세션에 말 걸기", link: "/docs/barge-in" },
          ],
        },
        {
          text: "직접 쓰기",
          items: [
            { text: "티켓 직접 발행하기", link: "/docs/ticket-writing" },
            { text: "티켓이 지나는 상태", link: "/docs/states" },
          ],
        },
        {
          text: "늘리기",
          items: [
            { text: "워커", link: "/docs/worker" },
            { text: "동시에 몇 개 돌릴까", link: "/docs/concurrency" },
            { text: "페르소나", link: "/docs/personas" },
            { text: "프로토콜", link: "/docs/protocols" },
            { text: "인증", link: "/docs/auth" },
          ],
        },
        {
          text: "운영",
          items: [
            { text: "트러블슈팅", link: "/docs/troubleshooting" },
            { text: "로그 읽는 법", link: "/docs/logs" },
            { text: "사용 통계와 끄는 법", link: "/docs/analytics" },
          ],
        },
        {
          text: "부록",
          items: [
            { text: "마치면서", link: "/docs/closing" },
            { text: "엔진만으로 돌리기", link: "/docs/cron" },
            { text: "워커 환경변수", link: "/docs/ref-env" },
            { text: "CLI", link: "/docs/ref-cli" },
            { text: "frontmatter 필드", link: "/docs/ref-frontmatter" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/proofer-tech/dira" }],
    editLink: {
      pattern: "https://github.com/proofer-tech/dira/edit/master/apps/site/:path",
      text: "이 페이지 고치기",
    },
  },
});
