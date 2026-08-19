import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { Shell } from "../../doc";
import { docNames, docPath, pageMetadata, titleOf } from "../../meta";

// 매뉴얼 26장. 셸과 마크다운 렌더는 `app/doc.tsx` 한 벌이고 루트 산문 2장(`privacy`·`terms`)이
// 같은 것을 쓴다 — 이 파일에 남는 것은 **`themeConfig.sidebar` 배열에서 나오는 것**뿐이다
// (사이드바 31항목과 그 순서가 내는 이전/다음. §루트 산문 2장의 셸이 가른 그 성질이다).
// 라우트가 하나인 것은 `docs/index.md`가 나머지 25장과 같은 마크다운이라서다 — optional
// catch-all이 `/docs/`와 `/docs/<이름>`을 같은 파일로 받는다.
// 굽는 이름 목록은 `app/meta.ts`가 진다.
const DOCS = join(process.cwd(), "docs");
const source = (name: string) => readFileSync(join(DOCS, `${name}.md`), "utf8");

// `.vitepress/config.ts:81-135`의 6묶음 28항목(그룹 6 + 링크 22)을 데이터로 옮긴 것이다.
// 그 뒤 `epics.md`·`squads.md`·`webhook.md`가 한 장씩 들어와 지금은 6묶음 31항목
// (그룹 6 + 링크 25)이다.
// 라벨·순서·링크가 한 자도 안 다르다 — 판정은 `sidebar.test.ts`가 그 파일에서 다시 읽어
// 전수로 댄다. 이전/다음도 이 평면 순서가 낸다(`index.md`는 목록에 없어서 짝이 0이고,
// 그것이 기본 테마의 판정과 같다).
const SIDEBAR = [
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
      { text: "스쿼드", link: "/docs/squads" },
      { text: "프로토콜", link: "/docs/protocols" },
      { text: "아카이빙과 온톨로지", link: "/docs/ontology" },
      { text: "에픽", link: "/docs/epics" },
      { text: "인증", link: "/docs/auth" },
    ],
  },
  {
    text: "운영",
    items: [
      { text: "트러블슈팅", link: "/docs/troubleshooting" },
      { text: "로그 읽는 법", link: "/docs/logs" },
      { text: "사용 통계와 끄는 법", link: "/docs/analytics" },
      { text: "답변 대기를 밖으로 보내기", link: "/docs/webhook" },
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
];
const FLAT = SIDEBAR.flatMap((g) => g.items);

// `Shell`이 요청마다 `isLandingOnly()`를 다시 봐야 한다(§상호 링크) — 정적 굽기(SSG)는 그 값을
// 빌드 시점에 굳혀서, 빌드 뒤 플래그만 바꿔 띄우는 두 서버(§검증) 중 하나가 거짓말을 하게 된다.
// `generateStaticParams`는 그래서 걷는다: 26장 정적 HTML보다 이 한 자리의 정확성이 우선이다.
export const dynamic = "force-dynamic";

/** `slug`는 URL에서 온다. 목록에 없는 이름으로 파일을 읽지 않는다 — 정적 산출에는 안 서는
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
  return pageMetadata(docPath(name), titleOf(source(name)));
}

export default async function Page({ params }: Params) {
  const name = nameOf((await params).slug);
  const here = docPath(name);
  const at = FLAT.findIndex((i) => i.link === here);

  return (
    <Shell
      source={source(name)}
      path={here}
      editPath={`docs/${name}.md`}
      sidebar={SIDEBAR}
      prev={at > 0 ? FLAT[at - 1] : undefined}
      next={at >= 0 ? FLAT[at + 1] : undefined}
    />
  );
}
