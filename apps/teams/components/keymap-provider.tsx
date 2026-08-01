"use client";

/** 키맵을 서버에서 클라이언트로 나르는 통로 (DESIGN.md §0-6 `#### 배선`).
 *
 *  키맵은 **파일**이고 키를 듣는 것도 그리는 것도 **클라이언트 컴포넌트**다. 그래서 루트
 *  레이아웃이 `readKeymap()`을 한 번 읽어 여기로 내리고, 아래는 `useContext`로 꺼내 쓴다.
 *  **§아키텍처가 금지한 "클라이언트 상태 라이브러리"가 아니다** — 서버가 준 값을 나르기만
 *  하고 쓰는 것은 서버 액션이다(§0-6이 근거째 적어 뒀다).
 *
 *  props로 꿰지 않는 이유: `session-stream`이 티켓 상세 깊숙이 있어 중간 컴포넌트 전부가
 *  안 쓰는 값을 들게 된다.
 *
 *  **새 파일인 이유**(AGENTS.md "새 파일을 늘리지 않는다"): 쓰는 곳이 셸(전환기) · 티켓 상세
 *  (참견 칸) · 설정 다이얼로그 셋으로 갈린다. 어느 한쪽에 얹으면 나머지 둘이 그 파일을
 *  import한다 — `session-stream`이 `project-switcher`를 부르는 모양이 된다. */

import { createContext, useContext, useEffect, useRef } from "react";
import { defaultBindings, shouldFire, type ActionId, type Keymap } from "@/lib/keymap";

/** 기본값은 Provider 밖에서도 화면이 키를 그릴 수 있게 하는 안전망이다(레이아웃이 늘 감싸므로
 *  실제로 쓰일 일은 없다). `broken`은 여기서 거짓말하지 않는다 — 파일을 못 읽은 것이 아니다. */
// `path`가 빈 문자열인 것은 거짓말이 아니다 — 그리는 자리가 `broken`일 때뿐이고 여긴 false다
const KeymapContext = createContext<Keymap>({
  bindings: defaultBindings(),
  broken: false,
  path: "",
});

export function KeymapProvider({
  keymap,
  children,
}: {
  keymap: Keymap;
  children: React.ReactNode;
}) {
  return <KeymapContext value={keymap}>{children}</KeymapContext>;
}

export function useKeymap(): Keymap {
  return useContext(KeymapContext);
}

/** 입력칸 안에서 난 이벤트인가. `[contenteditable]`은 `="false"`도 잡지만 이 앱에 그런 노드가
 *  없다 — §0-6이 적은 선택자 그대로다. 키맵 밖의 고정 키(`Esc` — §0-7)도 같은 판정을 써야 해서
 *  export한다. 선택자가 두 벌이 되면 한쪽에서만 쓰던 글이 날아간다. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, [contenteditable]") !== null;
}

/** **전역 키 하나** — `window`에 걸고 글 쓰는 중 가드를 받는다. 판정은 `lib/keymap.ts`의
 *  `shouldFire` 하나고 여기는 DOM만 댄다(가드를 부르는 쪽마다 다시 짜지 않는다).
 *
 *  `preventDefault`는 호출자가 한다 — 브라우저 기본을 뺏어도 되는지는 액션마다 다르다. */
export function useHotkey(action: ActionId, handler: (e: KeyboardEvent) => void): void {
  const { bindings } = useKeymap();
  const combo = bindings[action];
  // 핸들러는 매 렌더 새 함수라 deps에 넣으면 리스너를 매번 다시 건다. 최신 것만 들고 있는다.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldFire(e, combo, isTyping(e.target))) latest.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo]);
}
