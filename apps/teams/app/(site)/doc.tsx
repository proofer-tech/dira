import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createHighlighter } from "shiki";

import "./fonts.css";
import "./manual.css";
import { Behaviors, DarkToggle, MenuToggle, NavToggle, NO_FLASH } from "./shell";

// 마크다운 한 장을 셸에 담아 굽는다. 소비자는 셋이고(매뉴얼 22장 `app/docs/[[...slug]]` ·
// 루트 산문 2장 `privacy`·`terms`) **한 벌**을 쓴다 — 렌더가 같아야 앵커 `id`·코드 토큰·표가
// 안 갈리고, 셸이 같아야 크롬 여덟이 두 장에서 사라지지 않는다(§사이트 기반 §루트 산문 2장의
// 셸 — 자리로 가르면 여덟이 같이 면제되고 그것이 지적 `f74ad5a7`을 낳은 자리다).
// 파일이 하나인 것은 `Shell`이 `Doc`을 담는 그릇이라서다. 라우트 세그먼트 밖에 산다.

// vitepress `config.ts:10-23`의 여섯 줄 그대로다. NFKD가 한글 음절을 자모로 쪼개고 결합문자
// 제거가 자모를 안 건드려서 산출 `id`가 NFD로 남는 것을 끝의 `.normalize("NFC")`가 고정한다.
// ponytail: 두 벌이 산다. 전환 티켓(§순서 ⑧)이 `.vitepress/`를 지울 때 이쪽만 남는다.
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;
export const slugify = (str: string) =>
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

/** 캡처 아홉의 `width`/`height`. 파일 헤더가 출처라 값이 그림과 어긋날 수가 없다 —
 *  PNG는 `IHDR`(빅엔디언 32비트 ×2 @16), GIF는 논리 화면(리틀엔디언 16비트 ×2 @6).
 *  `height` 없는 이미지가 로드되며 페이지를 밀어내는 것은 `3fc53b23`이 이미 닫은 결함이다. */
const SHOTS = join(process.cwd(), "public", "shots");
const shots: Record<string, { width: number; height: number }> = Object.fromEntries(
  readdirSync(SHOTS).map((f) => {
    const b = readFileSync(join(SHOTS, f));
    return [
      `/shots/${f}`,
      b.toString("latin1", 1, 4) === "PNG"
        ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
        : { width: b.readUInt16LE(6), height: b.readUInt16LE(8) },
    ];
  }),
);

/** 파서가 주는 hast `node`를 props에서 뺀다 — 그대로 펴면 React가 DOM 속성으로 흘린다. */
function drop<T extends { node?: unknown }>(p: T) {
  const q = { ...p };
  delete q.node;
  return q;
}

/** 헤딩의 글자만 모은다. markdown-it-anchor가 `text`·`code_inline` 토큰의 `content`를 잇는 것과
 *  같은 값이라(백틱·굵게 표시는 양쪽 다 빠진다) 산출 `id`가 지금과 같다. */
type Node = { value?: string; children?: Node[] };
const textOf = (n: Node): string => n.value ?? (n.children ?? []).map(textOf).join("");

// `defaultColor: false`라 `color:` 없이 `--shiki-light`/`--shiki-dark` 두 변수만 나가고,
// 어느 모드를 칠할지는 CSS가 정한다(클라이언트 0바이트).
// 쌍은 `-default`다(§매뉴얼 셸 시각 사양 ⑤ §대비) — 22장 코드펜스 25개(2,587자)를 실제로
// 칠해 보면 종전 쌍은 라이트 2종 1.55% · 다크 1종 7.31%가 AA 미달이고, `-default` 쌍은
// 라이트 주석 한 색(4.36)만 짧다. 그 한 색을 `--faint`로 치환하면 미달 0 · 새 색 0이다.
const THEMES = { light: "github-light-default", dark: "github-dark-default" } as const;
const COLOR_REPLACEMENTS = { "#6e7781": "#71717A" };
const highlighting = createHighlighter({
  themes: [THEMES.light, THEMES.dark],
  langs: ["bash", "markdown"],
});

/** `id`·`className`은 부르는 쪽이 준다 — 이 `<main>`이 스킵링크의 목적지이자 산문 타이포의
 *  그릇이다. 부르는 곳은 아래 `Shell` 하나다. */
async function Doc({
  source,
  id,
  className,
}: {
  source: string;
  id?: string;
  className?: string;
}) {
  const hl = await highlighting;

  const components: Components = {
    // 코드펜스. 언어가 없는 펜스는 `text`라 하이라이팅 없이 줄만 감긴다(지금 산출과 같다).
    pre({ node }) {
      const code = node?.children[0];
      const cls =
        code?.type === "element" ? String(code.properties.className ?? "") : "";
      const lang = /language-(\w+)/.exec(cls)?.[1] ?? "text";
      const src = code?.type === "element" ? textOf(code as Node) : "";
      return (
        <div className="code">
          <div
            dangerouslySetInnerHTML={{
              __html: hl.codeToHtml(src.replace(/\n$/, ""), {
                lang: hl.getLoadedLanguages().includes(lang) ? lang : "text",
                themes: THEMES,
                defaultColor: false,
                colorReplacements: COLOR_REPLACEMENTS,
              }),
            }}
          />
          <span className="lang">{lang}</span>
          {/* ⑦① 기본 테마의 이 버튼은 탭 정거장인데 포커스에서도 안 보였다. CSS가 고친다. */}
          <button type="button" className="copy" aria-label="코드 복사">
            복사
          </button>
        </div>
      );
    },
    // ⑦③ 표가 390에서 잘려서 스크롤로도 못 닿던 자리. 그릇이 가로 스크롤을 진다.
    table: (p) => (
      <div className="table-scroll">
        <table {...drop(p)} />
      </div>
    ),
    // 크기를 못 찾으면 조용히 넘기지 않고 빌드를 세운다 — `width`/`height` 없는 이미지가
    // 로드되며 페이지를 미는 것이 계약을 깨는 자리이고, 그 신호를 끄면 아무도 못 본다.
    // ponytail: 보는 곳이 `public/shots/`뿐이다. 매뉴얼이 다른 자리의 그림을 걸게 되면 넓힌다.
    img(p) {
      const size = shots[String(p.src)];
      if (!size) throw new Error(`캡처 크기를 못 읽었다: ${p.src} — public/shots/에 없다`);
      return <img {...drop(p)} {...size} />;
    },
    ...Object.fromEntries(
      ([1, 2, 3, 4, 5, 6] as const).map((n) => [
        `h${n}`,
        (p: { node?: Node }) => {
          const Tag = `h${n}` as "h1";
          return <Tag {...drop(p)} id={slugify(textOf(p.node ?? {}))} />;
        },
      ]),
    ),
  };

  return (
    <main id={id} className={className}>
      {/* `singleTilde: false`가 계약이다. GFM 기본값은 물결 하나도 취소선으로 읽어서
          `0~9와 a~f`가 `0<del>9와 a</del>f`가 된다 — markdown-it(vitepress)은 `~~` 둘만 본다.
          22장의 산문이 물결을 범위 기호로 쓰므로 여기가 갈리면 글자가 사라진다. */}
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </main>
  );
}

/** 아웃라인 — `## ` 한 단만 모은다(24장 전수에서 h3 중첩이 0건이라 2단 렌더는 대상이 없다.
 *  `/privacy`가 항목 10으로 매뉴얼 최대 9보다 많지만 §④의 *1단으로 못박는다*는 그대로 선다).
 *  펜스 안의 `## `는 헤딩이 아니라 건너뛴다. 24장 헤딩에 든 인라인 표시는 백틱뿐이라 백틱만
 *  지우면 위 `Doc`이 `<h2>`에 넣는 글자와 같은 값이 나오고, `id`는 같은 파일의 `slugify`를
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

const REPO = "https://github.com/proofer-tech/dira";

type Item = { text: string; link: string };

/** 셸. 값은 `docs/DESIGN.md` §매뉴얼 셸 시각 사양(`a1782bd7`)이 정하고, **어느 장이 무엇을
 *  받나**는 §루트 산문 2장의 셸이 정한다 — `sidebar`가 있는 라우트에만 사이드바와 이전/다음이
 *  선다. 그 둘이 `themeConfig.sidebar` 배열에서 나오는 크롬 전부이고, 나머지 여덟(네브바 ·
 *  메뉴 · 소셜 · 스킵링크 · 다크 토글 · 산문 타이포 · 편집 링크 · 아웃라인)은 사이트 전역이거나
 *  그 장 본문에서 나오므로 세 라우트가 다 받는다.
 *
 *  `editPath`는 `apps/teams/` 아래 상대경로다(이사 `6a24257d` 전에는 그 옛 site 패키지
 *  아래였다) — vitepress `editLink.pattern`의 `:path`가 그 값이었다(`config.ts:132`). */
export function Shell({
  source,
  path,
  editPath,
  sidebar,
  prev,
  next,
}: {
  source: string;
  path: string;
  editPath: string;
  sidebar?: { text: string; items: Item[] }[];
  prev?: Item;
  next?: Item;
}) {
  const outline = outlineOf(source, editPath);

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
          {/* 매뉴얼 밖(`/privacy`·`/terms`)에서는 켜지지 않는다 — 기본 테마의 `activeMatch`가
              그 링크의 경로(`/docs/`)라 두 장에서 활성 항목이 0이었다. */}
          <a className={path.startsWith("/docs") ? "on" : undefined} href="/docs/">
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

      {/* 로컬네브는 사이드바를 여는 줄이다 — 열 사이드바가 없으면 남는 것이 0이라 줄째로
          사라진다(§루트 산문 2장의 셸 §폭: 두 장은 `<960`에서도 크롬이 네브바 하나다). */}
      {sidebar && (
        <div className="localnav">
          <MenuToggle />
        </div>
      )}

      <div className={sidebar ? "shell" : "shell noside"}>
        {sidebar && (
          <>
            <aside className="sidebar" aria-label="매뉴얼 목차">
              {sidebar.map((g) => (
                <section key={g.text}>
                  <h2>{g.text}</h2>
                  {g.items.map((i) => (
                    <a key={i.link} href={i.link} aria-current={i.link === path ? "page" : undefined}>
                      {i.text}
                    </a>
                  ))}
                </section>
              ))}
            </aside>
            <div className="backdrop" />
          </>
        )}

        <div className="content">
          <Doc source={source} id="main" className="doc" />

          <footer className="docfooter">
            <div className="edit">
              <a href={`${REPO}/edit/master/apps/teams/${editPath}`}>이 페이지 고치기</a>
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
