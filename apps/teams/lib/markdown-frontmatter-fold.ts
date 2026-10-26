/** 프론트매터 행 편집기의 접힘 판정 (DESIGN.md §P531 결정 1-6). 순수 함수만 둔다 - 접힘 상태는
 *  화면 상태라 `head`와 직렬화는 건드리지 않는다. */
import type { FrontmatterRow } from "./markdown-frontmatter-rows.ts";

/** 처음 열 때 하위 행이 이 개수 이상인 행은 접힌 채로 시작한다(결정 3). */
export const FOLD_DEFAULT_THRESHOLD = 8;

export interface FoldInfo {
  /** 조상 키 + 형제 순번으로 만든 식별자 - 행 번호가 아니라 다른 행의 편집에 안 흔들린다(결정 4). */
  id: string;
  /** 바로 뒤에 이어지는 `level`이 더 큰 연속 행의 수(손자 포함). 0이면 접을 수 없다. */
  descendants: number;
  /** 바로 아래 층의 행 수 - 요약 문구의 n. */
  children: number;
  /** 바로 아래 층이 목록 항목인가(`항목 n개` / `하위 키 n개`). */
  childrenAreItems: boolean;
}

export function foldInfos(rows: FrontmatterRow[]): FoldInfo[] {
  const stack: { level: number; path: string; childCount: number }[] = [];
  let rootCount = 0;
  return rows.map((row, i) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= row.level) stack.pop();
    const parent = stack[stack.length - 1];
    const ordinal = parent ? parent.childCount++ : rootCount++;
    const path = parent ? parent.path : "";
    const id = `${path}#${ordinal}`;
    stack.push({ level: row.level, path: `${path}/${row.key ?? "-"}`, childCount: 0 });

    let descendants = 0;
    while (i + 1 + descendants < rows.length && rows[i + 1 + descendants].level > row.level) descendants++;
    let children = 0;
    if (descendants > 0) {
      const childLevel = rows[i + 1].level;
      for (let j = i + 1; j <= i + descendants; j++) if (rows[j].level === childLevel) children++;
    }
    return { id, descendants, children, childrenAreItems: descendants > 0 && rows[i + 1].shape === "list-item" };
  });
}

/** 처음 마운트할 때 접힌 채로 시작하는 행의 식별자 집합(결정 3). */
export function defaultCollapsed(rows: FrontmatterRow[]): Set<string> {
  return new Set(foldInfos(rows).filter((f) => f.descendants >= FOLD_DEFAULT_THRESHOLD).map((f) => f.id));
}
