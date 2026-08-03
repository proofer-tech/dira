"use client";

/** 찾기 바 (DESIGN.md §7 §대화 안에서 찾기 · §비주얼 §30) — `⌘F`로 열고, 지금 화면에 서 있는
 *  글에서 찾고, `Esc`로 닫는다.
 *
 *  **서버가 한 줄도 안 는다**(§7). 훑는 것이 이미 그려져 있는 DOM이라 새 API 라우트도 새 서버
 *  액션도 없고, 그래서 이 컴포넌트에 로딩도 에러 3요소도 없다(§30 ⑥).
 *
 *  **DOM을 안 고친다 — `CSS.highlights` + `::highlight()`다**(§7). 텍스트를 `<mark>`로 감싸면
 *  스트리밍 중인 스레드를 React가 다시 그릴 때마다 우리가 넣은 노드와 다툰다. 하이라이트는
 *  `Range` 목록이라 지울 것이 없고, **다시 그려질 때마다 다시 걷는 것**이 아래
 *  `MutationObserver` 하나다(그게 이 바가 답이 흐르는 동안 안 깨지는 이유다).
 *  `window.find()`도 안 쓴다 — 그쪽은 선택 영역을 옮겨 **포커스가 입력칸을 떠난다**(§7).
 *
 *  **한 벌이 두 화면에 선다**(§7 · §30) — 홈은 스레드를 훑고 §데스크톱 앱 N5는 본문을 훑는다.
 *  갈리는 값이 둘뿐이라 그 둘만 props다: **훑을 자리**(`scope`)와 **닫을 때 돌아갈 포커스**
 *  (`restore`). 그릇 · 키 · `Esc` · 건수 표기는 두 화면에서 한 수도 안 갈린다.
 *
 *  **열림 상태를 자기가 든다.** `⌘F`(§0-6 `board.search`)를 여기서 듣고, 이 컴포넌트가 홈에만
 *  있으므로 **범위가 저절로 맞는다**(보드가 `board-ui.tsx`에서 같은 자를 쓰는 그대로). */

import { useEffect, useRef, useState, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useHotkey } from "@/components/keymap-provider";
import { useIsDesktop } from "@/components/path-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { findMatches, hasFindBar } from "@/lib/urls";

/** 레지스트리 둘 — `globals.css`의 `::highlight()` 두 규칙과 **같은 이름**이다(§30 ④).
 *  갈리면 하이라이트가 조용히 색 없이 선다(등록 이름으로만 선택되는 가상 요소다). */
const FIND = "dira-find";
const CURRENT = "dira-find-current";

/** **훑지 않는 자리.** §7이 훑을 것으로 적은 것은 *말풍선과 산문* 둘인데, 스레드 DOM에는 그
 *  둘 말고 `sr-only` 라벨(`질문`·`답`)과 띠의 버튼 글자(`복사`·`다시 답하기`·`중지`)가 같이
 *  산다. 안 거르면 `답`을 찾을 때 **안 보이는 곳**이 칠해져 건수가 부풀고 순회가 화면에서
 *  아무 데도 안 간다. N5 화면에서도 같은 규칙이다(본문의 조작 버튼은 본문이 아니다). */
const SKIP = ".sr-only, button";

/** CSS Custom Highlight API가 있나. 없으면 **바가 아예 안 뜨고 `⌘F`가 `preventDefault`를 안
 *  부른다** → 브라우저 찾기 바가 그대로 뜬다(§30 ⑥ 에러 — 사람이 고칠 것이 없고 대신할 것이
 *  이미 화면에 있다). 데스크톱은 Chromium이라 해당이 없다. */
function supported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

/** 훑을 자리의 텍스트 노드를 걸어 일치한 곳의 `Range`를 모은다.
 *  ponytail: 일치는 **텍스트 노드 안**에서만 찾는다 — `**보**드`처럼 마크다운이 요소로 쪼갠
 *  글자 사이는 안 걸린다. 노드를 이어 붙인 가상 문자열을 만들면 오프셋 되돌리기가 붙는데,
 *  이 화면에서 찾는 말은 해시 · 워커 이름 · 짧은 구절이라(§30 ②) 그 값이 아직 없다. */
function collect(root: HTMLElement, query: string): Range[] {
  const out: Range[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.parentElement?.closest(SKIP)) continue;
    for (const i of findMatches(n.nodeValue ?? "", query)) {
      const r = new Range();
      r.setStart(n, i);
      r.setEnd(n, i + query.length);
      out.push(r);
    }
  }
  return out;
}

/** 일치한 곳을 **화면 한가운데로** 끌어온다(§30 ① — 그래서 지금 보고 있는 일치가 바 밑에
 *  안 숨는다). `Range`에는 `scrollIntoView`가 없으므로 스크롤하는 조상을 찾아 그 안에서
 *  센터를 맞춘다 — 홈은 스레드 뷰포트, N5 화면은 `main`이다(둘 다 `overflow-y-auto`다). */
function center(range: Range) {
  const rect = range.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  let el = range.startContainer.parentElement;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
    el = el.parentElement;
  }
  if (!el) {
    window.scrollBy({ top: mid - window.innerHeight / 2 });
    return;
  }
  const box = el.getBoundingClientRect();
  el.scrollBy({ top: mid - (box.top + box.height / 2) });
}

export function FindBar({
  scope,
  restore,
}: {
  /** 훑을 자리 하나 — 두 화면이 갈리는 값 ①(§30). `null`이면 0건이다(온보딩 화면의 `0/0`). */
  scope: RefObject<HTMLElement | null>;
  /** 닫을 때 돌아갈 포커스 — 두 화면이 갈리는 값 ②(§30 ⑤). 홈은 프롬프트 칸이다(§7). */
  restore: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Range[]>([]);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // **끌어올 것인가.** 순회·질의 변경에만 참이다 — 스트리밍이 다시 걷을 때마다 끌어오면
  // 사람이 읽던 자리에서 화면이 토큰마다 튄다. 렌더에 안 쓰므로 상태가 아니다.
  const jump = useRef(true);

  useHotkey("board.search", (e) => {
    if (!supported()) return; // 크롬 찾기 바를 안 뺏는다(§30 ⑥)
    e.preventDefault(); // 이 화면에서 `⌘F`가 하는 일은 우리 것이라고 요구가 말했다(`6218440d`)
    setOpen(true);
    // **이미 떠 있는데 또 누르면 다시 포커스 + 전체 선택이다**(§30 ⑤ — 무동작이 아니다).
    // 처음 뜨는 경우엔 아직 마운트 전이라 `null`이고, 아래 효과가 같은 일을 한다.
    input.current?.focus();
    input.current?.select();
  });

  // 데스크톱 `Edit > 찾기`가 던지는 단방향 신호 하나(§데스크톱 앱 N5) — `Help > 의견 보내기`가
  // `dira:feedback`을 던지는 관용구 그대로다. **preload에 새 API 0 · 새 IPC 채널 0.**
  // 훅이 아니라 여기서 듣는 이유는 열림 상태가 이 컴포넌트에 살아서다(위 주석) — 밖으로
  // 끌어내면 두 화면이 같은 상태를 두 벌 든다. 그래서 홈의 바도 이 메뉴에 답한다.
  useEffect(() => {
    const show = () => {
      if (supported()) setOpen(true);
    };
    window.addEventListener("dira:find", show);
    return () => window.removeEventListener("dira:find", show);
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
  }, [open]);

  // **훑기.** 질의가 바뀌면 다시 걷고, **스레드가 다시 그려질 때마다도 다시 걷는다**(§7 §답은
  // 흐른다): 토큰이 붙으면 React가 텍스트 노드를 갈아 끼우고 우리가 들고 있던 `Range`는 그
  // 순간 아무 데도 안 가리킨다. 이 옵저버 하나가 "토큰이 붙을 때마다 지워지지 않는다"의 전부다.
  // ponytail: 붙을 때마다 전체 재스캔이다. 옵저버 콜백이 마이크로태스크당 한 번이라 폴링
  //           주기(500ms)에 한 번꼴이고 스레드는 턴 수십 개다 — 느려지면 바뀐 노드만 다시 걷는다.
  useEffect(() => {
    const root = open ? scope.current : null;
    // 훑을 자리가 없거나(온보딩 화면) 질의가 비면 **0건이다** — 그 경우도 `scan`을 거치는 것이
    // 값이다: 여기서 `setHits([])`를 직접 부르면 `react-hooks/set-state-in-effect`가 잡는다.
    const scan = () => setHits(root && query ? collect(root, query) : []);
    scan();
    if (!root || !query) return;
    const ob = new MutationObserver(scan);
    ob.observe(root, { childList: true, characterData: true, subtree: true });
    return () => ob.disconnect();
  }, [open, query, scope]);

  // 건수가 줄면 지금 자리가 목록 밖으로 나간다(스트리밍 중에도 난다) — 렌더 때 접는다.
  const pos = hits.length ? Math.min(idx, hits.length - 1) : -1;

  // 칠하기 — **겹치지 않게 나눈다**(§30 ④): 지금 것은 `dira-find`에서 **빼고**
  // `dira-find-current`에만 넣는다. 그래서 `Highlight.priority`를 안 쓴다.
  useEffect(() => {
    if (!supported()) return;
    const cur = hits[pos];
    if (!cur) {
      CSS.highlights.delete(FIND);
      CSS.highlights.delete(CURRENT);
      return;
    }
    CSS.highlights.set(FIND, new Highlight(...hits.filter((_, i) => i !== pos)));
    CSS.highlights.set(CURRENT, new Highlight(cur));
    if (jump.current) {
      jump.current = false;
      center(cur);
    }
    // 닫을 때(그리고 언마운트할 때) 레지스트리 둘을 지운다(§30 ④ 걷기).
    return () => {
      CSS.highlights.delete(FIND);
      CSS.highlights.delete(CURRENT);
    };
  }, [hits, pos]);

  /** 다음(`+1`) · 이전(`-1`). **0건이면 그 이상 아무 일도 안 한다**(§7). */
  const go = (d: number) => {
    if (!hits.length) return;
    jump.current = true;
    setIdx((n) => (Math.min(n, hits.length - 1) + d + hits.length) % hits.length);
  };

  /** `Esc` 또는 닫기 버튼(§7) — 하이라이트가 걷히고 포커스가 돌아갈 자리로 간다.
   *  **`Esc`로 화면을 떠나지 않는다**: 포커스가 이 `<input>` 안이라 §0-7의 *글을 쓰는 중이면
   *  안 듣는다*(`isTyping`)가 그대로 걸린다. 홈은 부모가 없어 어차피 무동작이다. */
  const close = () => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setIdx(0);
    restore.current?.focus();
  };

  if (!open) return null;

  // **안 찾았으면 빈칸 · 0건이면 `0/0`**(§30 ③) — *안 찾은 것*과 *못 찾은 것*은 다른 사실이다.
  const label = query === "" ? "" : `${pos + 1}/${hits.length}`;
  // §30 ⑥ 빈 상태는 *질의가 빔*이지만 잠그는 값은 **순회할 것이 있나** 하나로 족하다(0건에서도
  // `go`가 무동작이라 화면과 실효가 갈리면 안 된다). `disabled`가 아니라 `aria-disabled`다 —
  // `input-group`의 흐림이 `:has(:disabled)`라 그릇이 통째로 흐려진다(§21 실측).
  const idle = hits.length === 0;

  return (
    // 떠 있는 층 하나(§30 ①) — `fixed`라 어느 화면의 세로 계산에도 안 든다(§24의 뺄셈 무수정).
    // `bg-background`가 여기 있는 이유는 `InputGroup`이 라이트에서 배경 없이 살기 때문이다:
    // 그 밑으로 산문이 비치면 글자가 겹친다. `shadow-md`는 `popover.tsx`가 이미 쓰는 값이다.
    <div className="fixed top-14 right-6 rounded-lg bg-background shadow-md">
      {/* 그릇이 `<form>`이라 **`Enter`는 다음이 0줄이다**(§30 ⑤). `⇧Enter`만 아래에서 가로챈다 */}
      <form onSubmit={(e) => { e.preventDefault(); go(1); }}>
        <InputGroup className="h-9 w-80">
          {/* 앞머리 아이콘이 없다(§30 ②) — `⌘F`로 불러낸 바라 *이것이 검색 칸이다*가 이미
              끝나 있다. placeholder는 라벨이 아니라 `aria-label`을 같이 준다(§21과 같은 처리) */}
          <InputGroupInput
            ref={input}
            aria-label="찾기"
            placeholder="찾기"
            value={query}
            onChange={(e) => {
              jump.current = true;
              setIdx(0);
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                go(-1);
              }
            }}
          />
          {/* 손잡이 — 왼쪽부터 **건수 → 이전 → 다음 → 닫기**(§30 ②). 조치가 아니라 읽는 값이 먼저다 */}
          <InputGroupAddon align="inline-end">
            {/* `min-w-14`가 없으면 자릿수가 바뀔 때마다 입력칸이 최대 27.5px 흔들려 캐럿이
                옮겨간다(§30 ③ 실측). `role="status"`는 사람이 방금 친 글자의 답이라 낭독한다 */}
            <InputGroupText role="status" className="min-w-14 justify-end text-xs tabular-nums">
              {label}
            </InputGroupText>
            <InputGroupButton
              size="icon-xs"
              aria-label="이전"
              aria-disabled={idle}
              className="aria-disabled:opacity-50"
              onClick={() => go(-1)}
            >
              <ChevronUp aria-hidden className="size-3.5" />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              aria-label="다음"
              aria-disabled={idle}
              className="aria-disabled:opacity-50"
              onClick={() => go(1)}
            >
              <ChevronDown aria-hidden className="size-3.5" />
            </InputGroupButton>
            <InputGroupButton size="icon-xs" aria-label="닫기" onClick={close}>
              <X aria-hidden className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}

/** 훑을 자리 — **지금 화면의 `main`**이다. 모든 화면의 `main`이 스크롤러라(`app/layout.tsx`)
 *  본문 전체가 그 안에 있고, `center()`가 찾는 스크롤 조상도 그것이다.
 *  ref로 안 꿴 이유: `main`을 그리는 것이 두 셸의 레이아웃(서버 컴포넌트)이라 ref를 붙이려면
 *  화면마다 클라이언트 조각이 하나씩 는다. getter라 **읽는 순간**(= 바가 열린 뒤) 푼다. */
const MAIN: RefObject<HTMLElement | null> = {
  get current() {
    return document.querySelector("main");
  },
};
/** 돌아갈 포커스가 없다 — 이 화면들의 바는 `⌘F`(또는 메뉴)로만 뜨고 떠나온 입력칸이 없다.
 *  홈이 프롬프트 칸을 주는 자리다(§30 ⑤). `restore.current?.focus()`가 그대로 무동작이다. */
const NONE: RefObject<HTMLElement | null> = { current: null };

/** **N5의 찾기 바** (DESIGN.md §데스크톱 앱 N5) — 보드·홈이 아닌 모든 화면(`/` · 워커 ·
 *  페르소나 · 프로토콜 · 티켓 상세)에 위 `<FindBar>`를 세운다. 갈리는 값 둘만 채우고
 *  나머지는 홈과 한 수도 안 갈린다.
 *
 *  **데스크톱에서만 선다.** `.app`에는 크롬 찾기 바가 없어서 이것이 대신 서고, 브라우저에는
 *  그 바가 그대로 있으므로 **우리 코드가 0줄인 것이 그 화면의 계약이다** — 안 그리면
 *  `useHotkey`도 안 걸리고 `preventDefault`도 없다. 판정은 `path-picker.tsx`가 이미 쓰는
 *  `window.dira`의 유무 하나다(N3).
 *
 *  **루트 레이아웃에 한 번 선다**(`app/layout.tsx`) — 붙는 화면이 다섯이고 그중 둘은
 *  레이아웃이 같아서(워커·페르소나·프로토콜·상세가 `p/[project]/layout.tsx` 아래다) 화면마다
 *  얹으면 같은 두 줄이 다섯 벌이 된다. 여기 서면 **빼는 곳이 정규식 한 줄**이다. */
export function DesktopFindBar() {
  const desktop = useIsDesktop();
  const path = usePathname();
  if (!desktop || !hasFindBar(path)) return null;
  return <FindBar scope={MAIN} restore={NONE} />;
}
