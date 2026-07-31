/** 읽기 전용 마크다운 렌더 (DESIGN.md §비주얼 §10). 붙는 곳은 둘 — 요구사항 왕복 스레드와
 *  `.wip` 티켓 본문. **두 자리가 같은 값을 쓴다**: §10 표가 유일한 출처고 자리별 오버라이드가
 *  없다. 편집기(본문 폼 · 페르소나 · 프로토콜)는 종전대로 원문이다.
 *
 *  `rehype-raw`를 켜지 않는다 — raw HTML 무시가 `react-markdown` 기본값이고, 그게 새니타이저를
 *  안 들이는 근거다(§결정 기록). 각주·이미지는 원문 글자로 문단에 남는다. */
import { Children } from "react";
import { Square, SquareCheck } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** `h4~h6`도 `h3`과 같은 값이다 — 단계를 더 만들지 않는다(이 큐의 본문에 4단계 중첩이 없다). */
const H3 = "mt-4 mb-1 text-base font-medium";

/** 파서가 주는 hast `node`를 props에서 뺀다 — 그대로 펴면 React가 DOM 속성으로 흘린다. */
function drop<T extends { node?: unknown }>(p: T) {
  const q = { ...p };
  delete q.node;
  return q;
}

/** **`{...drop(p)}`가 `className`보다 먼저다.** `remark-gfm`이 체크리스트에 `contains-task-list`·
 *  `task-list-item` 클래스를 실어 보내는데, 나중에 편 spread가 아래 표의 값을 통째로 덮는다
 *  (실측: 체크리스트가 불릿도 들여쓰기도 flex도 잃었다). 순서를 뒤집지 않는다. */
const components: Components = {
  h1: (p) => <h1 {...drop(p)} className="mt-6 mb-2 text-lg font-semibold" />,
  // 이 큐에서 제일 흔한 요소다(`## Goal`·`## Done when`·`## 결과`). 절 경계는 밑줄 한 줄이
  // 만든다 — 색이 아니라 선이다(§0: 색은 예외 표시).
  h2: (p) => (
    <h2 {...drop(p)} className="mt-6 mb-2 border-b border-border pb-1 text-base font-semibold" />
  ),
  h3: (p) => <h3 {...drop(p)} className={H3} />,
  h4: (p) => <h4 {...drop(p)} className={H3} />,
  h5: (p) => <h5 {...drop(p)} className={H3} />,
  h6: (p) => <h6 {...drop(p)} className={H3} />,
  p: (p) => <p {...drop(p)} className="my-3" />,
  ul: (p) => (
    <ul {...drop(p)} className="my-3 list-disc space-y-1 pl-6 marker:text-muted-foreground" />
  ),
  ol: (p) => (
    <ol {...drop(p)} className="my-3 list-decimal space-y-1 pl-6 marker:text-muted-foreground" />
  ),
  // 체크리스트 항목만 가로로 눕는다. 선택자가 걸리는 `input`은 아래에서 지우지 않고 감춘 것이다.
  //
  // **본문을 `div` 하나로 감싼다.** flex 컨테이너는 요소 자식을 **하나씩** 아이템으로 만든다 —
  // 감싸지 않으면 `- [ ] \`pnpm build\` 통과 + …`의 코드 스팬·굵게가 각각 별도 아이템이 돼
  // 8px(`gap-2`)씩 벌어지고 제각기 줄바꿈한다(실측: `Done when` 절이 세로 기둥 6개로 쪼개졌다).
  // §10 표의 값은 그대로고 구조만 한 겹이다 — 표 래퍼 `div`와 같은 이유의 래퍼다.
  li: ({ children, ...p }) => {
    const first = p.node?.children[0];
    const checklist = !!first && "tagName" in first && first.tagName === "input";
    const kids = Children.toArray(children);
    return (
      <li {...drop(p)} className="[&:has(>input)]:flex [&:has(>input)]:list-none [&:has(>input)]:gap-2">
        {checklist ? (
          <>
            {kids[0]}
            <div className="min-w-0">{kids.slice(1)}</div>
          </>
        ) : (
          children
        )}
      </li>
    );
  },
  // `remark-gfm`이 낳는 `<input type="checkbox" disabled>`. **지우지 않고 감춘다** — 체크 상태와
  // 비활성이 스크린리더에 네이티브로 그대로 가고, `:has(>input)`도 이 입력에 걸린다. 그리지 않는
  // 이유는 `color-scheme` 미선언인 이 앱에서 다크에 흰 상자가 뜨고 disabled 색이 토큰 밖이라서다.
  // 두 아이콘은 **모양이 다르다** — 색으로만 말하지 않는다(§0).
  input: (p) => (
    <>
      <input {...drop(p)} readOnly className="sr-only" />
      {p.checked ? (
        <SquareCheck aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Square aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  ),
  strong: (p) => <strong {...drop(p)} className="font-semibold" />,
  em: (p) => <em {...drop(p)} className="italic" />,
  // 세로 패딩 없음 — 주면 문단 줄 높이가 줄마다 튄다. `text-foreground`는 못박는다
  // (`--muted-foreground`/`--muted`는 라이트에서 4.34다 — §10 대비표의 유일한 함정).
  code: (p) => (
    <code {...drop(p)} className="rounded-sm bg-muted px-1 font-mono text-sm text-foreground" />
  ),
  // `pre > code`의 배경·패딩만 여기서 끈다. react-markdown 10은 `inline` prop을 안 주므로
  // 코드 스팬과 펜스를 컴포넌트에서 가를 수 없다 — 값은 §10 표 그대로고 거는 자리만 부모다.
  // 높이 상한을 두지 않는다(§9의 `max-h-96`은 512px 컨테이너 안이라 필요했다. 본문은 페이지가 스크롤한다).
  pre: (p) => (
    <pre
      {...drop(p)}
      className="my-3 overflow-x-auto rounded-md bg-muted p-3 [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0"
    />
  ),
  // 래퍼는 **필수다.** `Card`가 `overflow-hidden`이라 래퍼 없는 넓은 표는 스크롤이 아니라 잘려 사라진다.
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table {...drop(p)} className="w-full text-sm" />
    </div>
  ),
  th: (p) => (
    <th
      {...drop(p)}
      className="border-b border-border px-3 py-2 text-left align-top text-xs font-medium text-muted-foreground"
    />
  ),
  // §3의 `h-9` 밀도 오버라이드를 쓰지 않는다 — 본문의 표는 셀이 여러 줄로 감긴다.
  td: (p) => <td {...drop(p)} className="border-b border-border px-3 py-2 align-top" />,
  // **색을 주지 않는다.** 밑줄이 이미 링크를 말하고, `--primary`를 쓰면 §0이 깨진다.
  a: (p) => (
    <a
      {...drop(p)}
      className="underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
    />
  ),
  blockquote: (p) => (
    <blockquote {...drop(p)} className="my-3 border-l-2 border-border pl-3 text-muted-foreground" />
  ),
  hr: (p) => <hr {...drop(p)} className="my-6 border-border" />,
  // 이미지는 그리지 않는다 — 로컬 큐의 본문에 이미지가 없고, 원격 URL을 로컬 도구가 요청하게
  // 만들 값이 없다. 원문 글자로 문단에 남는다.
  img: () => null,
};

/** 소프트 줄바꿈은 공백으로 합친다(마크다운 표준 — `remark-breaks`를 켜지 않는다). 이 큐의 본문은
 *  100자 근처에서 손으로 감겨 있어서, 그 줄바꿈을 그리면 렌더 폭과 원문 폭이 다른 만큼 문단이
 *  톱니가 된다. 원문의 줄 그대로가 필요한 자리는 펜스다.
 *
 *  로딩·에러 상태는 없다 — 서버가 이미 읽은 문자열을 동기로 그린다. 본문은 자르지 않는다. */
export function Markdown({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-sm text-muted-foreground">(내용 없음)</p>;
  return (
    // `min-w-0`이 없으면 다이얼로그(grid)에서 아래 표·펜스의 `overflow-x-auto`가 무력화된다.
    // 리듬은 요소가 각자 들고 있다 — `space-y-*`를 걸지 않는다(제목 위 여백 > 문단 사이 간격).
    <div className="min-w-0 text-base leading-7 break-words [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_li>ol]:my-1 [&_li>ul]:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
