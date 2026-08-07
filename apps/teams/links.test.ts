/** vitepress가 프레임워크로 지고 있던 계약 둘을 옮겨 받는다(§사이트 기반 §걷히는 계약 ①②).
 *  ① 죽은 내부 링크 — `ignoreDeadLinks: false`가 빌드를 깨뜨리던 자리. Next는 안 본다.
 *  ② 없는 캡처 — vite/rollup이 정적 import로 풀다 죽던 자리. Next `public/`은 안 본다.
 *  둘 다 걷혀도 빌드가 통과하고 화면도 안 갈려서, 이 파일이 떨어지지 않으면 아무도 못 잡는다.
 *
 *  판정은 vitepress가 재던 것과 같게 맞춘다(`chunk-D3CUZ4fa.js:36691` 인근):
 *  외부 URL·순수 `#앵커`는 안 본다(vitepress도 `!url.startsWith("#")`로 건너뛴다),
 *  `?`·`#` 뒤는 자르고, `.md`/`.html`은 벗기고, `/`로 끝나면 `index`를 붙인다.
 *  넓어지는 것이 하나 있다 — 캡처는 마크다운 `![]()`와 원시 `<img src>` **양쪽**을 명시로 본다. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

const SITE = import.meta.dirname;
const mdIn = (dir: string) =>
  readdirSync(join(SITE, dir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => posix.join(dir, f));

/** 굽는 마크다운 전부. 라우트 목록의 원본이 이것이다 — `app/docs/[[...slug]]/page.tsx`의
 *  `generateStaticParams`도 같은 디렉터리를 읽는다. */
const files = [...mdIn("."), ...mdIn("docs")].map((f) => f.replace(/^\.\//, ""));
/** 페이지 id — `index` · `privacy` · `docs/install`. 링크를 이 모양으로 풀어서 대조한다. */
const pages = new Set(files.map((f) => f.slice(0, -3)));

/** 캡처를 거는 자리는 마크다운만이 아니다 — 랜딩은 `app/landing.tsx`에서 원시 `<img src>`로 건다.
 *  마크다운의 원시 `<img>`는 오늘 0곳이라, tsx를 안 보면 §걷히는 계약 ②가 실제로는 아무것도
 *  안 잰다(마크다운 `![]()` 아홉 장만 재고 랜딩 넉 장은 새어 나간다). */
const tsxFiles = readdirSync(join(SITE, "app"), { recursive: true })
  .filter((f): f is string => typeof f === "string" && f.endsWith(".tsx"))
  .map((f) => posix.join("app", f));

const EXTERNAL = /^(?:[a-z]+:|\/\/)/i;
/** 마크다운 링크·이미지와 원시 `<img src>`. `!`가 붙으면 이미지다.
 *  ponytail: 코드펜스 안을 안 가른다. 지금 펜스 48개에 링크 0건이고, 생기면 이 검사가
 *  거짓으로 떨어져서 조용히 새지 않는다 — 그때 펜스를 벗긴다. */
const LINK = /(!?)\[[^\]]*\]\(([^)]+)\)|<img[^>]*\ssrc="([^"]+)"/g;

type Ref = { file: string; url: string; image: boolean };
const scan = (file: string): Ref[] =>
  [...readFileSync(join(SITE, file), "utf8").matchAll(LINK)]
    .map((m) => ({ file, url: m[2] ?? m[3], image: m[1] === "!" || m[3] !== undefined }))
    .filter((r) => !EXTERNAL.test(r.url) && !r.url.startsWith("#"));

/** tsx에서는 `<img src>`만 가져간다 — `[...](...)`는 tsx에서 링크가 아니고(산문 대괄호가 걸린다),
 *  라우트 링크는 `<Link href>`라 이 검사의 범위 밖이다(§걷히는 계약 ①은 마크다운이 지던 것이다). */
const refs: Ref[] = [
  ...files.flatMap(scan),
  ...tsxFiles.flatMap((f) => scan(f).filter((r) => r.image)),
];

/** 확장자가 있으면 자산, `.md`/`.html`은 페이지다. */
const isAsset = (url: string) => /\.[a-z0-9]+$/i.test(url) && !/\.(md|html)$/i.test(url);

test("내부 링크가 전부 라우트로 풀린다", () => {
  const links = refs.filter((r) => !r.image && !isAsset(r.url));
  assert.ok(links.length > 100, `내부 링크를 ${links.length}개밖에 못 찾았다 — 파서가 죽었다`);

  const dead = links.filter(({ file, url }) => {
    let u = url.replace(/[?#].*$/, "").replace(/\.(html|md)$/, "");
    if (u.endsWith("/")) u += "index";
    const id = decodeURIComponent(
      u.startsWith("/") ? u.slice(1) : posix.join(posix.dirname(file), u),
    );
    return !pages.has(id);
  });
  assert.deepEqual(
    dead.map((d) => `${d.file}: ${d.url}`),
    [],
    "죽은 내부 링크다 — 가리키는 마크다운이 없다",
  );
});

test("거는 그림이 전부 public/에 있다", () => {
  const images = refs.filter((r) => r.image || isAsset(r.url));
  // 마크다운 `![]()` 9 + 마크다운에서 자산으로 거는 링크 1 + 랜딩 tsx의 원시 `<img src>` 4.
  assert.ok(images.length >= 13, `그림 참조가 ${images.length}개다 — 열세 장보다 적다`);

  const missing = images.filter(
    ({ url }) => !existsSync(join(SITE, "public", url.replace(/[?#].*$/, ""))),
  );
  assert.deepEqual(
    missing.map((m) => `${m.file}: ${m.url}`),
    [],
    "public/에 없는 그림을 걸었다 — 캡처는 그 캡처를 거는 문장의 선행이다",
  );
});
