/** 무손실 왕복 하네스 (DESIGN.md 로드맵 §P236-1). 마크다운 원문을 «원문 → 편집기 모델 → 원문»으로
 *  돌려 바이트가 갈리는 자리를 센다 — 못 ①(원문이 정본이다)의 판정 도구다.
 *
 *  **새 의존성 0.** `unified`·`remark-parse`·`remark-stringify`·`@types/mdast`는 이미
 *  `react-markdown`·`remark-gfm`이 물고 오는 패키지라 `package.json`에 안 적는다 — 이 머신의 pnpm이
 *  `node-linker=hoisted`라(`pnpm config get node-linker`) node_modules에 실제 디렉터리로 있고,
 *  `pnpm test`가 그대로 돈다. */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

/** 후보 ⓐ — «지금 서 있는 것으로 되는 안». mdast `position`으로 최상위 블록의 원문 구간만
 *  이어붙인다. 자른 조각을 원문 순서 그대로 다시 붙이는 것뿐이라(수정 없이) **항등이 항상
 *  성립한다** — frontmatter를 remark가 오해석해도(플러그인 없이 setext heading으로 읽는
 *  경우가 있다) `position.end.offset`이 단조증가하는 한 `source.slice`가 원문을 빠짐없이
 *  덮는다. 이 항등성 자체가 못 ①의 "안 고치면 안 갈린다"를 만족한다. */
export function splicedRoundTrip(source: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  let out = "";
  let cursor = 0;
  for (const child of tree.children) {
    const end = child.position?.end.offset;
    if (end == null || end < cursor) continue;
    out += source.slice(cursor, end);
    cursor = end;
  }
  return out + source.slice(cursor);
}

/** 후보 ⓑ — «문서 전체를 mdast로 다시 직렬화». §사실 절이 이미 버린 안이지만, 표에 대조군으로
 *  남기려고 여기서도 잰다. */
export function fullSerializeRoundTrip(source: string): string {
  const file = unified().use(remarkParse).use(remarkGfm).use(remarkStringify).processSync(source);
  return String(file);
}

/** 두 문자열이 utf-8 바이트 단위로 갈리는 자리 수. 길이가 다르면 그 뒤 전부를 갈린 자리로 센다. */
export function byteDiffCount(a: string, b: string): number {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  const len = Math.max(A.length, B.length);
  let n = 0;
  for (let i = 0; i < len; i++) if (A[i] !== B[i]) n++;
  return n;
}

/** §사실 표(로드맵 §P236)의 다섯 갈래. 코드스팬은 빼고 잰다 — DESIGN.md 검증 스크립트와 같은 정규식. */
export const CATEGORIES: Record<string, (text: string) => boolean> = {
  표: (t) => /^\s*\|.*\|\s*$/m.test(t),
  체크박스: (t) => /^\s*- \[[ x]\]/m.test(t),
  코드펜스: (t) => /```/.test(t),
  "맨 <…>": (t) => /<[^<>\s]+>/.test(t.replace(/`[^`\n]*`/g, "")),
  "낱말 안 밑줄": (t) => /[A-Za-z0-9]_[A-Za-z0-9]/.test(t.replace(/`[^`\n]*`/g, "")),
};

export interface RoundTripReport {
  files: number;
  filesDiffered: number;
  bytesDiffered: number; // 갈린 파일들의 byteDiffCount 합 — "갈린 자리" 수
  byCategory: Record<string, { files: number; differed: number }>;
}

/** 후보 하나를 파일 집합에 걸어 채점한다. `sources`는 `[경로, 원문]` 쌍이다 — 경로는 보고용이고
 *  판정에는 안 쓰인다. */
export function measure(
  candidate: (source: string) => string,
  sources: Iterable<readonly [string, string]>,
): RoundTripReport {
  const byCategory: RoundTripReport["byCategory"] = {};
  for (const key of Object.keys(CATEGORIES)) byCategory[key] = { files: 0, differed: 0 };
  let files = 0;
  let filesDiffered = 0;
  let bytesDiffered = 0;
  for (const [, text] of sources) {
    files++;
    let out: string;
    try {
      out = candidate(text);
    } catch {
      out = ""; // 파서가 못 여는 파일도 "갈렸다"로 센다
    }
    const differs = out !== text;
    if (differs) {
      filesDiffered++;
      bytesDiffered += byteDiffCount(out, text);
    }
    for (const [key, test] of Object.entries(CATEGORIES)) {
      if (!test(text)) continue;
      byCategory[key].files++;
      if (differs) byCategory[key].differed++;
    }
  }
  return { files, filesDiffered, bytesDiffered, byCategory };
}

// ---- 큐 전수 실측 (CLI 모드) ----------------------------------------------
// `node --experimental-strip-types lib/markdown-roundtrip.ts <큐 루트>` 형태로 손으로 돌린다.
// 경로는 인자 아니면 MARKDOWN_ROUNDTRIP_ROOT 환경변수로 받고, 둘 다 없으면 픽스처 셋으로 돈다
// (제약 1 — 이 파일을 `pnpm test`가 임포트해도 도그푸딩 큐를 절대 만지지 않는다).
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");

  const root = process.argv[2] || process.env.MARKDOWN_ROUNDTRIP_ROOT;
  const FIXTURE: Array<[string, string]> = [
    ["fixture/table.md", "| a | b |\n|---|---|\n| 1 | 2 |\n"],
    ["fixture/checkbox.md", "## Done when\n\n- [ ] one\n- [x] two\n"],
    ["fixture/hash.md", "옆 티켓 `<hash>`와 session_id를 본다.\n"],
  ];

  function collectQueue(q: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const readMd = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".md")) out.push([path.join(dir, name), readFileSync(path.join(dir, name), "utf8")]);
      }
    };
    const walkMd = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, name.name);
        if (name.isDirectory()) walkMd(p);
        else if (name.name.endsWith(".md")) out.push([p, readFileSync(p, "utf8")]);
      }
    };
    readMd(path.join(q, "tickets"));
    readMd(path.join(q, "protocols"));
    walkMd(path.join(q, "ontology"));
    for (const persona of readdirSync(path.join(q, "personas"))) {
      const p = path.join(q, "personas", persona, "PROFILE.md");
      try {
        out.push([p, readFileSync(p, "utf8")]);
      } catch {
        /* PROFILE.md 없는 페르소나 디렉터리 */
      }
    }
    return out;
  }

  const sources = root ? collectQueue(root) : FIXTURE;
  for (const [label, candidate] of [
    ["ⓐ mdast position splice", splicedRoundTrip],
    ["ⓑ full mdast serialize", fullSerializeRoundTrip],
  ] as const) {
    const r = measure(candidate, sources);
    console.log(`\n== ${label} (${root ? root : "픽스처"}) ==`);
    console.log(`파일 ${r.files} · 바이트 갈린 파일 ${r.filesDiffered} · 갈린 자리 합 ${r.bytesDiffered}`);
    for (const [cat, v] of Object.entries(r.byCategory)) {
      console.log(`  ${cat}: 대상 ${v.files} · 갈림 ${v.differed}`);
    }
  }
}
