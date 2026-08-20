/** `[[이름]]` 위키링크 remark 플러그인 (DESIGN.md §비주얼 §10 §위키링크, 요구 `9f2f41ed`).
 *  `vault`(이름 -> href)를 안 받으면 트리를 안 건드린다 — `[[이름]]`은 종전 그대로 글자다.
 *
 *  `text` 노드만 훑는다(`lib/markdown-breaks.ts softBreaks`와 같은 경계) — 코드 스팬·펜스는
 *  파서가 이미 `inlineCode`·`code` 노드로 갈라놔서 이 walker가 안 들어간다.
 *
 *  커스텀 mdast 노드 타입(`wikilink`)에 `data.hName`/`hProperties`/`hChildren`을 실어
 *  `mdast-util-to-hast`의 "unknown node" 경로로 `<a>`/`<span>`을 직접 낳는다 — 새 rehype
 *  핸들러 없이 되는 값이라 의존성이 늘지 않는다. */
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

export type Vault = Record<string, string>;

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };

const WIKILINK = /\[\[([^\]]+)\]\]/g;

function transform(node: Node, vault: Vault, locale: Locale): void {
  if (!node.children) return;
  node.children = node.children.flatMap((c) => {
    if (c.type !== "text" || !c.value?.includes("[[")) {
      transform(c, vault, locale);
      return [c];
    }
    const parts: Node[] = [];
    let last = 0;
    for (const m of c.value.matchAll(WIKILINK)) {
      if (m.index! > last) parts.push({ type: "text", value: c.value.slice(last, m.index) });
      const raw = m[1];
      // `[[이름|별칭]]` - 보이는 글자는 별칭, 찾는 값은 앞쪽(`lib/ontology.ts`의
      // `split("|")[0]`과 같은 판정). 끝의 `.md`는 찾을 때만 뗀다(§10 §위키링크).
      const bar = raw.indexOf("|");
      const namePart = (bar === -1 ? raw : raw.slice(0, bar)).trim();
      const display = (bar === -1 ? raw : raw.slice(bar + 1)).trim();
      const name = namePart.replace(/\.md$/, "");
      const href = vault[name];
      parts.push({
        type: "wikilink",
        data: {
          hName: href ? "a" : "span",
          hProperties: href
            ? { href, "data-wikilink": name }
            : { "data-wikilink": name, title: t(locale, "markdownWikilinks.noTarget") },
          hChildren: [{ type: "text", value: display }],
        },
      });
      last = m.index! + m[0].length;
    }
    if (last < c.value.length) parts.push({ type: "text", value: c.value.slice(last) });
    return parts;
  });
}

export function wikilinks(vault?: Vault, locale: Locale = DEFAULT_LOCALE) {
  return () => (tree: unknown) => {
    if (!vault) return;
    for (const child of (tree as Node).children ?? []) transform(child, vault, locale);
  };
}

/** vault 트리 → `Vault`(§10 §위키링크 §이름 -> 파일). `.md`를 뗀 상대경로가 이름과 같거나
 *  `/이름`으로 끝나는 파일이 그 이름을 가리킨다 — `보드`도 `화면/보드`도 `objects/화면/보드.md`
 *  하나를 집는다. 후보가 둘 이상이면 상대경로 사전순 첫째. 접미사마다 후보를 모았다가
 *  한 번에 정렬해 판정한다(스펙 표의 "둘 이상이면 …" 그대로). */
export function buildVault(
  files: { rel: string; isDir: boolean }[],
  toHref: (rel: string) => string,
): Vault {
  const bySuffix = new Map<string, string[]>();
  for (const f of files) {
    if (f.isDir || !f.rel.endsWith(".md")) continue;
    const rel = f.rel.slice(0, -3);
    const segments = rel.split("/");
    for (let i = 0; i < segments.length; i++) {
      const suffix = segments.slice(i).join("/");
      const list = bySuffix.get(suffix);
      if (list) list.push(rel);
      else bySuffix.set(suffix, [rel]);
    }
  }
  const vault: Vault = {};
  for (const [suffix, candidates] of bySuffix) {
    vault[suffix] = toHref(`${candidates.sort()[0]}.md`);
  }
  return vault;
}
