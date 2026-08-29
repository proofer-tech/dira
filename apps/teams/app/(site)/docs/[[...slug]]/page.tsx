import { notFound } from "next/navigation";
import { Shell } from "../../doc";
import { docNames, docPath, pageMetadata, titleOf } from "../../meta";
import { siteLocale } from "../../request-locale";
import { pickManuscript } from "@/lib/site-locale";
import { t, type Locale } from "@/lib/i18n";

// 매뉴얼 27장. 셸과 마크다운 렌더는 `app/doc.tsx` 한 벌이고 루트 산문 2장(`privacy`·`terms`)이
// 같은 것을 쓴다 — 이 파일에 남는 것은 **`themeConfig.sidebar` 배열에서 나오는 것**뿐이다
// (사이드바 32항목과 그 순서가 내는 이전/다음. §루트 산문 2장의 셸이 가른 그 성질이다).
// 라우트가 하나인 것은 `docs/index.md`가 나머지 26장과 같은 마크다운이라서다 — optional
// catch-all이 `/docs/`와 `/docs/<이름>`을 같은 파일로 받는다.
// 굽는 이름 목록은 `app/meta.ts`가 진다.
// §0-24 §원고를 두는 자리 — `en/docs/<name>.md`가 있으면 그것, 없으면 한국어 원본이다.
const source = (name: string, locale: Locale) => pickManuscript(locale, `docs/${name}.md`);

// `.vitepress/config.ts:81-135`의 6묶음 28항목(그룹 6 + 링크 22)을 데이터로 옮긴 것이다.
// 그 뒤 `epics.md`·`squads.md`·`webhook.md`·`schedules.md`가 한 장씩 들어와 지금은
// 6묶음 32항목(그룹 6 + 링크 26)이다.
// 라벨은 `lib/i18n.ts`의 `manualSidebar.*` 키다(§0-24, 티켓 76b659fd) — 순서·링크는 한 자도
// 안 다르다. 판정은 `sidebar.test.ts`가 그 파일에서 다시 읽어 전수로 댄다(`text:` 리터럴이
// `textKey:`로 갈려서 그 테스트의 정규식도 같이 갈았다). 이전/다음도 이 평면 순서가 낸다
// (`index.md`는 목록에 없어서 짝이 0이고, 그것이 기본 테마의 판정과 같다).
const SIDEBAR: { textKey: string; items: { textKey: string; link: string }[] }[] = [
  {
    textKey: "manualSidebar.group.gettingStarted",
    items: [
      { textKey: "manualSidebar.item.whatIsDira", link: "/docs/what-is-dira" },
      { textKey: "manualSidebar.item.install", link: "/docs/install" },
      { textKey: "manualSidebar.item.firstTicket", link: "/docs/first-ticket" },
      { textKey: "manualSidebar.item.requirements", link: "/docs/requirements" },
    ],
  },
  {
    textKey: "manualSidebar.group.watching",
    items: [
      { textKey: "manualSidebar.item.screens", link: "/docs/screens" },
      { textKey: "manualSidebar.item.bargeIn", link: "/docs/barge-in" },
    ],
  },
  {
    textKey: "manualSidebar.group.writing",
    items: [
      { textKey: "manualSidebar.item.ticketWriting", link: "/docs/ticket-writing" },
      { textKey: "manualSidebar.item.states", link: "/docs/states" },
    ],
  },
  {
    textKey: "manualSidebar.group.extending",
    items: [
      { textKey: "manualSidebar.item.worker", link: "/docs/worker" },
      { textKey: "manualSidebar.item.concurrency", link: "/docs/concurrency" },
      { textKey: "manualSidebar.item.personas", link: "/docs/personas" },
      { textKey: "manualSidebar.item.squads", link: "/docs/squads" },
      { textKey: "manualSidebar.item.protocols", link: "/docs/protocols" },
      { textKey: "manualSidebar.item.ontology", link: "/docs/ontology" },
      { textKey: "manualSidebar.item.epics", link: "/docs/epics" },
      { textKey: "manualSidebar.item.auth", link: "/docs/auth" },
    ],
  },
  {
    textKey: "manualSidebar.group.operating",
    items: [
      { textKey: "manualSidebar.item.troubleshooting", link: "/docs/troubleshooting" },
      { textKey: "manualSidebar.item.logs", link: "/docs/logs" },
      { textKey: "manualSidebar.item.analytics", link: "/docs/analytics" },
      { textKey: "manualSidebar.item.schedules", link: "/docs/schedules" },
      { textKey: "manualSidebar.item.webhook", link: "/docs/webhook" },
    ],
  },
  {
    textKey: "manualSidebar.group.appendix",
    items: [
      { textKey: "manualSidebar.item.closing", link: "/docs/closing" },
      { textKey: "manualSidebar.item.cron", link: "/docs/cron" },
      { textKey: "manualSidebar.item.refEnv", link: "/docs/ref-env" },
      { textKey: "manualSidebar.item.refCli", link: "/docs/ref-cli" },
      { textKey: "manualSidebar.item.refFrontmatter", link: "/docs/ref-frontmatter" },
    ],
  },
];
const FLAT = SIDEBAR.flatMap((g) => g.items);
const localizedSidebar = (locale: Locale) =>
  SIDEBAR.map((g) => ({
    text: t(locale, g.textKey),
    items: g.items.map((i) => ({ text: t(locale, i.textKey), link: i.link })),
  }));
const localizedItem = (locale: Locale, i: (typeof FLAT)[number]) => ({
  text: t(locale, i.textKey),
  link: i.link,
});

// `Shell`이 요청마다 `isLandingOnly()`를 다시 봐야 한다(§상호 링크) — 정적 굽기(SSG)는 그 값을
// 빌드 시점에 굳혀서, 빌드 뒤 플래그만 바꿔 띄우는 두 서버(§검증) 중 하나가 거짓말을 하게 된다.
// `generateStaticParams`는 그래서 걷는다: 27장 정적 HTML보다 이 한 자리의 정확성이 우선이다.
export const dynamic = "force-dynamic";

/** `slug`는 URL에서 온다. 목록에 없는 이름으로 파일을 읽지 않는다 — 정적 산출에는 안 뜨는
 *  경로지만 `dev`에서는 임의 세그먼트가 그대로 들어온다. */
const nameOf = (slug?: string[]) => {
  const name = slug?.length ? slug.join("/") : "index";
  if (!docNames.includes(name)) notFound();
  return name;
};

type Params = { params: Promise<{ slug?: string[] }> };

// 종전 `transformPageData`가 얹던 canonical·og·twitter 열한 줄이 여기로 온다(§SEO ② 태그).
// 제목은 그 훅이 읽던 `pageData.title`과 같은 값이다 — 첫 `# ` 헤딩의 글자다.
export async function generateMetadata({ params }: Params) {
  const name = nameOf((await params).slug);
  const locale = await siteLocale();
  return pageMetadata(docPath(name), titleOf(source(name, locale)), { locale });
}

export default async function Page({ params }: Params) {
  const name = nameOf((await params).slug);
  const locale = await siteLocale();
  const here = docPath(name);
  const at = FLAT.findIndex((i) => i.link === here);

  return (
    <Shell
      source={source(name, locale)}
      path={here}
      editPath={`docs/${name}.md`}
      locale={locale}
      sidebar={localizedSidebar(locale)}
      prev={at > 0 ? localizedItem(locale, FLAT[at - 1]) : undefined}
      next={at >= 0 && FLAT[at + 1] ? localizedItem(locale, FLAT[at + 1]) : undefined}
    />
  );
}
