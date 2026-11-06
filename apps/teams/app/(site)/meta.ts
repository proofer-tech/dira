import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
// `@/lib/i18n` 별칭이 아니라 상대경로 `.ts`다 — `meta.test.ts`가 `node --test`로 이 파일을
// 직접 부르는데, 네이티브 TS 로더가 tsconfig `paths` 별칭을 못 읽는다(`lib/projects.ts`가
// `./i18n.ts`를 쓰는 그 판정과 같다).
import { DEFAULT_LOCALE, localePath, t, type Locale } from "../../lib/i18n.ts";

/** 굽는 라우트 목록과 그 라우트의 메타데이터가 한 자리에 있다 — 사이트맵·canonical·
 *  `generateStaticParams`가 **같은 목록**을 봐야 어긋날 자리가 통째로 없어진다.
 *  종전 정본은 `config.ts`의 `transformPageData`(canonical·og·twitter 11줄)와
 *  `sitemap: { hostname }` 한 줄이고, 값은 한 개도 안 갈렸다(§SEO ② 태그 · §사이트 기반). */
export const ORIGIN = "https://dira.proofer.tech";
const SITE_TITLE = "dira";

/** 매뉴얼 28장(`docs/*.md` — 27장 + 목차). `docs/[[...slug]]`가 이 목록으로 굽는다. */
export const docNames = readdirSync(join(process.cwd(), "docs"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.slice(0, -3));

/** 루트 마크다운 둘. 매뉴얼과 같은 글인데 URL이 루트라(`/privacy`) `docs/` 라우트가 못 받고
 *  `app/privacy/`·`app/terms/` 두 라우트가 굽는다(`b30956f9` · §순서 ⑥-2). 사이트맵이 그
 *  두 줄을 싣는 자리가 여기다 — 라우트가 목록을 읽지 않으므로 이 배열이 유일한 사본이다. */
export const rootNames = ["privacy", "terms"];

/** `cleanUrls: true`가 내던 그 경로다 — `.html`을 안 붙이고 `index` 조각은 지운다. */
export const docPath = (name: string) => (name === "index" ? "/docs/" : `/docs/${name}`);

/** 굽는 27장의 절대 URL. `app/sitemap.ts`가 이것을 그대로 싣는다 — `404`는 안 든다
 *  (마크다운 페이지가 아니고 색인 대상도 아니다). */
export const pageUrls = ["/", ...rootNames.map((n) => `/${n}`), ...docNames.map(docPath)].map(
  (path) => `${ORIGIN}${path}`,
);

/** 영어판 절대 URL(P548 결정 1) - `pageUrls`와 같은 순서다. */
export const enPageUrls = ["/", ...rootNames.map((n) => `/${n}`), ...docNames.map(docPath)].map(
  (path) => `${ORIGIN}${localePath("en", path)}`,
);

/** 종전 vitepress `pageData.title` — 첫 `# ` 헤딩의 글자다. 24장 전부 평문이라 걷을 마크다운이
 *  없다(실측: 앞 산출물의 `<title>` 24개와 한 자도 안 갈린다). */
export const titleOf = (source: string) =>
  /^# +(.+)$/m.exec(source)?.[1].trim() ?? SITE_TITLE;

const DESC_MAX = 160;

/** 마크다운 한 문단을 평문 한 줄로 만든다: 링크는 글자만, 강조-코드 기호와 줄머리 기호는 걷는다. */
const plain = (md: string) =>
  md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*]/g, "")
    .replace(/(^|\s)_+|_+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** P548 결정 4 — 문서의 description. frontmatter `description:`이 있으면 그것, 없으면 첫 `# ` 제목 뒤 첫 평문 문단을
 *  160자(말줄임 포함)로 자른다. 뽑을 것이 없으면 빈 문자열이라 `pageMetadata`가 `siteMeta.description`으로 떨어뜨린다.
 *  P548-5의 llms.txt도 이 함수를 쓴다. */
export function descriptionOf(source: string): string {
  let body = source;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (fm) {
    body = source.slice(fm[0].length);
    const d = /^description:\s*(.+)$/m.exec(fm[1])?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (d) return clip(plain(d));
  }
  const afterTitle = body.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "").replace(/^[\s\S]*?^# +.+$/m, "");
  for (const block of afterTitle.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || /^(#|\||:::|<|>|[-*+] |\d+\. |---)/.test(t)) continue;
    const text = plain(t);
    if (text) return clip(text);
  }
  return "";
}

const clip = (s: string) => (s.length <= DESC_MAX ? s : `${s.slice(0, DESC_MAX - 1).trimEnd()}…`);

/** §0-24 §SEO — `og:locale`이 상수에서 함수가 된 자리. `<html lang>`과 같은 값을 받는다
 *  (`app/(site)/request-locale.ts`의 `siteLocale()`). `canonical`·`sitemap.xml`·`robots.txt`는
 *  주소가 안 갈리므로 이 표 밖이다. */
const OG_LOCALE: Record<Locale, "ko_KR" | "en_US"> = { ko: "ko_KR", en: "en_US" };

/** `path`는 위 `docPath`가 내는 그 경로(`/` · `/docs/` · `/docs/install` · `/privacy`).
 *  `title`은 og:title로 그대로 나가고 `<title>`에는 사이트 이름을 뒤에 붙인다 — 종전
 *  `titleTemplate` 기본값이다. 랜딩만 `index.md`가 `titleTemplate: false`였으므로
 *  `suffix: false`로 부른다.
 *
 *  `description`은 **`||`다.** 종전 주석(`config.ts:56`)이 적어 둔 그대로 — 페이지가 자기
 *  description을 빈 문자열로 주면 `??`는 안 걸리고 빈 태그가 나간다. 실측으로 25장 전부
 *  자기 description이 0자라(frontmatter를 쓰는 문서가 랜딩의 `title`뿐이다) 이 `||`의
 *  오른쪽이 25장의 실효값이다. */
export function pageMetadata(
  path: string,
  title: string,
  { suffix = true, description = "", locale = DEFAULT_LOCALE }: {
    suffix?: boolean;
    description?: string;
    locale?: Locale;
  } = {},
): Metadata {
  // P548 결정 3 - canonical은 그 페이지 자기 언어의 주소, hreflang 셋은 모든 페이지가 단다.
  const ko = `${ORIGIN}${path}`;
  const url = `${ORIGIN}${localePath(locale, path)}`;
  const desc = description || t(locale, "siteMeta.description");
  return {
    title: suffix ? `${title} | ${SITE_TITLE}` : title,
    description: desc,
    alternates: {
      canonical: url,
      languages: { ko, en: `${ORIGIN}${localePath("en", path)}`, "x-default": ko },
    },
    openGraph: {
      type: "website",
      siteName: SITE_TITLE,
      locale: OG_LOCALE[locale],
      url,
      title,
      description: desc,
      // 절대 URL이어야 한다 — 상대 경로는 플랫폼이 못 읽는다.
      images: [{ url: `${ORIGIN}/og.png`, width: 1200, height: 630 }],
    },
    // §SEO §안 하는 것이 `twitter:title`·`:description`·`:image`를 안 넣는다고 적었는데
    // **Next가 그것을 우리 손에서 안 놓는다** — `openGraph`가 있으면 그 셋을 twitter로
    // 자동 복제한다. 실측(2026-08-05): 이 한 줄을 `other: { "twitter:card": … }`로 바꿔
    // 구우니 `twitter:card`가 두 벌이 되고 나머지 셋은 그대로 나갔다. 값이 `og:*`와 같아서
    // 카드는 안 갈리고 페이지마다 태그 5개가 늘어난다. 지적은 `053779df`로 올렸다.
    twitter: { card: "summary_large_image" },
  };
}

/** P548 결정 7 - sitemap `lastmod`. 파일 mtime은 Vercel 체크아웃 시각이라 전부 같아지므로 git이 원천이다.
 *  파일 여럿이면 가장 늦은 커밋 시각이다. git이 없거나 답이 비면(얕은 클론, 미추적 파일) 빌드 시각이다.
 *  `%cI`는 W3C 날짜시간(`2026-11-06T14:17:57+09:00`)이라 그대로 `<lastmod>`에 들어간다. */
export type GitLog = (file: string) => string;
const gitLog: GitLog = (file) =>
  execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

export function lastmodOf(files: string[], run: GitLog = gitLog, now: Date = new Date()): string {
  let best: { raw: string; ms: number } | undefined;
  for (const f of files) {
    try {
      const raw = run(f).trim();
      const ms = new Date(raw).getTime();
      if (raw && !Number.isNaN(ms) && (!best || ms > best.ms)) best = { raw, ms };
    } catch {
      // git 실행 실패 - 이 파일은 시각을 모른다
    }
  }
  return best?.raw ?? now.toISOString();
}

/** `pageUrls`의 각 URL이 읽는 원고 파일. 홈은 `landing.tsx`와 `lib/i18n.ts` 중 늦은 쪽이다. */
export function sourceFilesOf(path: string): string[] {
  if (path === "/") return ["app/(site)/landing.tsx", "lib/i18n.ts"];
  if (rootNames.some((n) => path === `/${n}`)) return [`${path.slice(1)}.md`];
  return [`docs/${path === "/docs/" ? "index" : path.slice("/docs/".length)}.md`];
}
