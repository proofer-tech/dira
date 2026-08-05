import { defineConfig } from "vitepress";
import { diraVersion } from "../version.ts";

// vitepress 기본 slugify는 `str.normalize("NFKD")`로 시작한다. NFKD가 한글 음절을 자모로 쪼개고
// 뒤따르는 결합문자 제거(U+0300~U+036F)는 자모를 안 건드려서, 산출 `id`가 NFD로 남는다.
// 소스에 NFC로 적은 `#한글-앵커`는 눈으로 똑같아 보이는데 절대 안 맞고 링크가 안 뛴다.
// 기본 구현 그대로에 `.normalize("NFC")` 하나만 더해 모든 `id`를 NFC로 고정한다.
// ponytail: @mdit-vue/shared가 직접 의존이 아니라 6줄짜리 정규식 체인을 인라인했다.
//           vitepress가 이 체인을 바꾸면 여기도 따라 바꾼다.
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;
const slugify = (str: string) =>
  str
    .normalize("NFKD")
    .replace(rCombining, "")
    .replace(rControl, "")
    .replace(rSpecial, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase()
    .normalize("NFC");

export default defineConfig({
  lang: "ko-KR",
  title: "dira",
  description:
    "티켓을 큐에 넣으면 cron에 물린 워커가 claude 세션에 넘깁니다. 파일시스템이 곧 큐인 티켓 디스패처.",
  cleanUrls: true,
  // 죽은 내부 링크는 빌드를 깨뜨린다. 매뉴얼 19장이 다 들어왔으므로 유예 없이 전수 검사한다.
  ignoreDeadLinks: false,
  head: [["link", { rel: "icon", href: "/icon.svg", type: "image/svg+xml" }]],
  markdown: { anchor: { slugify } },
  // 랜딩에서만 Inter 프리로드를 빼던 `transformHtml` 훅이 여기 있었다. **문제째 없어졌다** —
  // 그 태그를 굽던 것이 기본 테마이고 Next 산출에는 Inter를 부르는 자리가 0이다
  // (§사이트 기반 §갈아 끼우는 것 — 그 자리의 `ponytail:` 주석이 이 판정을 미리 적어 뒀다).
  // 번들된 sitemap 생성기. `lastmod`는 안 넣는다 — `lastUpdated: true`가 필요하고 그 한 줄이
  // 화면 24장에 `Last updated` 줄을 세운다. `lastmod` 없는 사이트맵도 유효하다.
  sitemap: { hostname: "https://dira.proofer.tech" },
  // 페이지마다 canonical·og·twitter 열한 줄. `404.html`은 마크다운 페이지가 아니라 이 훅을
  // 안 지나므로 태그가 0이고 그게 맞다(색인 대상이 아니다).
  // 이 훅과 위 `sitemap` 한 줄은 `app/meta.ts`·`app/sitemap.ts`로 갔다. 여기 남아 있는 것은
  // **앞 화면**이다 — §검증이 *"앞 화면은 ⑧ 전까지 `npx vitepress build .`로 언제든 굽는다"*고
  // 적어 뒀고 이 절의 판정이 앞뒤 대조다. 이 파일은 전환 티켓(§순서 ⑧)이 통째로 지운다.
  transformPageData(pageData, { siteConfig }) {
    const origin = "https://dira.proofer.tech";
    // `cleanUrls: true`라 `.html`을 붙이지 않는다. `index.md`는 조각째 지운다.
    const url = `${origin}/${pageData.relativePath.replace(/index\.md$/, "").replace(/\.md$/, "")}`;
    // `||`다 — `pageData.description`은 빈 문자열이라 `??`가 안 걸리고 빈 태그가 나간다.
    const title = pageData.title || siteConfig.site.title;
    const description = pageData.description || siteConfig.site.description;
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:site_name", content: "dira" }],
      ["meta", { property: "og:locale", content: "ko_KR" }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      // 절대 URL이어야 한다 — 상대 경로는 플랫폼이 못 읽는다.
      ["meta", { property: "og:image", content: `${origin}/og.png` }],
      ["meta", { property: "og:image:width", content: "1200" }],
      ["meta", { property: "og:image:height", content: "630" }],
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
    );
  },
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
