import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createHighlighter } from "shiki";

// 마크다운 한 장을 굽는다. 소비자는 매뉴얼 22장(`app/docs/[[...slug]]`)과 루트 산문 2장
// (`privacy`·`terms`)이고, 셋 다 같은 렌더를 써야 앵커 `id`·코드 토큰·표가 안 갈린다
// (§사이트 기반 §갈아 끼우는 것의 `privacy`·`terms` 행 — *마크다운 렌더는 매뉴얼과 같은 것*).

// vitepress `config.ts:10-23`의 여섯 줄 그대로다. NFKD가 한글 음절을 자모로 쪼개고 결합문자
// 제거가 자모를 안 건드려서 산출 `id`가 NFD로 남는 것을 끝의 `.normalize("NFC")`가 고정한다.
// ponytail: 두 벌이 산다. 전환 티켓(§순서 ⑧)이 `.vitepress/`를 지울 때 이쪽만 남는다.
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

// vitepress가 지금 굽는 것과 같은 이중 테마. `defaultColor: false`라 `color:` 없이
// `--shiki-light`/`--shiki-dark` 두 변수만 나가고, 어느 모드를 칠할지는 CSS가 정한다.
const THEMES = { light: "github-light", dark: "github-dark" } as const;
const highlighting = createHighlighter({
  themes: [THEMES.light, THEMES.dark],
  langs: ["bash", "markdown"],
});

export default async function Doc({ source }: { source: string }) {
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
        <div
          dangerouslySetInnerHTML={{
            __html: hl.codeToHtml(src.replace(/\n$/, ""), {
              lang: hl.getLoadedLanguages().includes(lang) ? lang : "text",
              themes: THEMES,
              defaultColor: false,
            }),
          }}
        />
      );
    },
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
    <main>
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
