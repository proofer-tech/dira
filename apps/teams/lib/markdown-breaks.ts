/** 소프트 줄바꿈(`\n`)을 `break`로 바꾸는 remark 플러그인 (DESIGN.md §비주얼 §10의 **면제** 항).
 *  §10 본칙은 소프트 줄바꿈을 공백으로 합치는 것이고, 그 근거는 "이 큐의 본문은 100자 근처에서
 *  손으로 감겨 있다" = **파일에 글을 쓰는 에이전트**의 성질이다. 사람이 입력칸에 친 세 줄은
 *  감긴 한 문단이 아니라 지은 세 줄이라 그 자리에서만 이 플러그인을 켠다.
 *
 *  **`remark-breaks`를 안 들인 이유는 `untilHeading`이다.** 그 패키지는 트리 전체에 걸리는데
 *  요구(`kind: request`) 티켓 본문은 첫 `##` **앞까지만** 켜야 한다 — 뒤에 붙는 `## 질문 n`·
 *  `## 결과`는 에이전트가 손으로 감은 글이라 같은 본문 안에서 갈린다. 켜고 끌 곳이 갈리는데
 *  의존성이 하나 더 늘 이유가 없다(하는 일은 아래 20줄이다).
 *
 *  **본문을 `<Markdown>` 둘로 쪼개서 풀지 않는다**(§10): 쪼개면 본문의 소유자가 하나가 아니게
 *  되어 §10 루트의 `[&>:first-child]:mt-0`이 뒤쪽 블록에도 걸리고 `## 질문 1` 위의 `mt-6`이
 *  죽는다. 첫 `heading`에서 멈추는 변환이면 블록이 하나로 남는다.
 *
 *  **문자열을 미리 손보지 않는 이유**: 줄 끝에 공백 두 칸을 붙이는 수법은 **코드 펜스 안**까지
 *  고친다(거기서 두 칸은 문법이 아니라 내용이다). AST의 `text` 노드만 만지면 안 걸린다 —
 *  펜스는 `code`(자식 없는 `value`)라 이 walker가 지나간다. */

/** mdast의 부분집합. `unist` 타입을 안 가져오는 이유는 하나 — 여기서 보는 것이 이 셋뿐이다. */
type Node = { type: string; value?: string; children?: Node[] };

/** 줄 끝·다음 줄 앞의 공백은 버린다(`remark-breaks`와 같은 판정). 남기면 `<br>` 옆에 빈칸이 뜬다. */
const NL = /[\t ]*\r?\n[\t ]*/;

function harden(node: Node): void {
  if (!node.children) return;
  node.children = node.children.flatMap((c) => {
    if (c.type !== "text" || !c.value?.includes("\n")) {
      harden(c);
      return [c];
    }
    // 빈 조각은 안 넣는다 — `"\n나"`는 `break` + `나`지 빈 `text`가 앞서지 않는다.
    return c.value.split(NL).flatMap<Node>((v, i) => [
      ...(i ? [{ type: "break" }] : []),
      ...(v ? [{ type: "text", value: v }] : []),
    ]);
  });
}

/** `all`은 트리 전부, `untilHeading`은 루트의 첫 `heading` 직전까지. */
export function softBreaks(mode: "all" | "untilHeading") {
  return () => (tree: unknown) => {
    for (const child of (tree as Node).children ?? []) {
      if (mode === "untilHeading" && child.type === "heading") return;
      harden(child);
    }
  };
}
