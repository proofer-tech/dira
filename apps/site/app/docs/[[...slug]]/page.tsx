import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import Doc, { slugify } from "../../doc";
import { docNames, docPath, pageMetadata, titleOf } from "../../meta";

import "../../fonts.css";
import "../manual.css";
import { Behaviors, DarkToggle, MenuToggle, NavToggle, NO_FLASH } from "../shell";

// 매뉴얼 22장 + 셸. 셸은 기본 테마(vitepress)가 주던 크롬을 우리 손으로 다시 그린 것이고
// 값은 `docs/DESIGN.md` §매뉴얼 셸 시각 사양(`a1782bd7`)이 정한다. 라우트가 하나인 것은
// `docs/index.md`가 나머지 21장과 같은 마크다운이라서다 — optional catch-all이 `/docs/`와
// `/docs/<이름>`을 같은 파일로 받는다.
// 마크다운 렌더는 `app/doc.tsx` 한 벌이고 루트 산문 2장(`privacy`·`terms`)이 같은 것을 쓴다 —
// 그쪽은 세울 크롬이 0이라 이 셸을 안 받는다. 굽는 이름 목록은 `app/meta.ts`가 진다.
const DOCS = join(process.cwd(), "docs");
const source = (name: string) => readFileSync(join(DOCS, `${name}.md`), "utf8");

// `.vitepress/config.ts:81-135`의 6묶음 27항목(그룹 6 + 링크 21)을 데이터로 옮긴 것이다.
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
];
const FLAT = SIDEBAR.flatMap((g) => g.items);

const REPO = "https://github.com/proofer-tech/dira";

/** 아웃라인 — `## ` 한 단만 모은다(22장 전수에서 h3 중첩이 0건이라 2단 렌더는 대상이 없다).
 *  펜스 안의 `## `는 헤딩이 아니라 건너뛴다. 22장 헤딩에 든 인라인 표시는 백틱뿐이라 백틱만
 *  지우면 `app/doc.tsx`가 `<h2>`에 넣는 글자와 같은 값이 나오고, `id`는 그 파일의 `slugify`를
 *  그대로 불러서 앵커가 갈릴 자리가 없다. 그 전제를 아래 `throw`가 지킨다 —
 *  **백틱 밖만 본다**: `TICKET_CWD` 같은 코드 안의 `_`는 강조가 아니다. */
function outlineOf(src: string, file: string) {
  const out: { id: string; text: string }[] = [];
  let fence = false;
  for (const line of src.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && line.startsWith("## ")) {
      const raw = line.slice(3).trim();
      const outside = raw
        .split("`")
        .filter((_, i) => i % 2 === 0)
        .join("");
      if (/[*_[\]]/.test(outside))
        throw new Error(`아웃라인이 못 읽는 헤딩 표시다: ${file} — "${raw}"`);
      const text = raw.replace(/`/g, "");
      out.push({ id: slugify(text), text });
    }
  }
  return out;
}

export function generateStaticParams() {
  return docNames.map((n) => ({ slug: n === "index" ? [] : [n] }));
}

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
  const src = source(name);
  const here = docPath(name);
  const at = FLAT.findIndex((i) => i.link === here);
  const prev = at > 0 ? FLAT[at - 1] : undefined;
  const next = at >= 0 ? FLAT[at + 1] : undefined;
  const outline = outlineOf(src, `${name}.md`);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      <a className="skip" href="#main">
        본문으로 건너뛰기
      </a>

      <header className="nav">
        <a className="brand" href="/" aria-label="dira">
          <svg viewBox="0 0 32 32" fillRule="evenodd" aria-hidden="true">
            <path d="M2 0H10A2 2 0 0 1 12 2V6H30A2 2 0 0 1 32 8V30A2 2 0 0 1 30 32H2A2 2 0 0 1 0 30V2A2 2 0 0 1 2 0ZM10 10H22A2 2 0 0 1 24 12V14A4 4 0 0 0 24 22V24A2 2 0 0 1 22 26H10A2 2 0 0 1 8 24V22A4 4 0 0 0 8 14V12A2 2 0 0 1 10 10Z" />
          </svg>
          dira
        </a>
        <nav className="nav-menu">
          <a className="on" href="/docs/">
            매뉴얼
          </a>
          <a href={`${REPO}/releases/latest`}>다운로드</a>
        </nav>
        <a className="social" href={REPO} aria-label="github" target="_blank" rel="noopener">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
        <DarkToggle />
        <NavToggle />
      </header>

      <div className="localnav">
        <MenuToggle />
      </div>

      <div className="shell">
        <aside className="sidebar" aria-label="매뉴얼 목차">
          {SIDEBAR.map((g) => (
            <section key={g.text}>
              <h2>{g.text}</h2>
              {g.items.map((i) => (
                <a key={i.link} href={i.link} aria-current={i.link === here ? "page" : undefined}>
                  {i.text}
                </a>
              ))}
            </section>
          ))}
        </aside>
        <div className="backdrop" />

        <div className="content">
          <Doc source={src} id="main" className="doc" />

          <footer className="docfooter">
            <div className="edit">
              <a href={`${REPO}/edit/master/apps/site/docs/${name}.md`}>이 페이지 고치기</a>
            </div>
            {(prev || next) && (
              <nav className="prevnext" aria-label="이전 다음 문서">
                {prev && (
                  <a className="prev" href={prev.link}>
                    <span className="side">이전</span>
                    <span className="title">{prev.text}</span>
                  </a>
                )}
                {next && (
                  <a className="next" href={next.link}>
                    <span className="side">다음</span>
                    <span className="title">{next.text}</span>
                  </a>
                )}
              </nav>
            )}
          </footer>
        </div>

        <aside className="outline" aria-label="이 페이지">
          <h2>이 페이지</h2>
          {outline.map((h) => (
            <a key={h.id} href={`#${h.id}`}>
              {h.text}
            </a>
          ))}
        </aside>
      </div>

      <Behaviors />
    </>
  );
}
