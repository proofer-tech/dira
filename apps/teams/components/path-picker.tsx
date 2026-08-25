"use client";

/** 네이티브 경로 피커의 `찾아보기` 버튼 (DESIGN.md §데스크톱 앱 N3).
 *
 *  **데스크톱이 아니면 아무것도 그리지 않는다** — 브라우저(`pnpm dev`)로 연 화면은 지금 그대로
 *  타이핑이다. 판정이 하이드레이션 뒤인 이유는 SSR에 `window.dira`가 없어서다: 서버 렌더에서
 *  버튼을 그리면 두 HTML이 어긋난다.
 *
 *  **값을 채울 뿐이다.** 고른 경로가 유효한지는 서버가 종전대로 판정한다(§0 해석 결과 표) —
 *  상대경로 환산·`$TICKET_CWD` 접두는 부르는 쪽이 `lib/urls.ts`의 순수 함수로 한다.
 *  자리가 두 파일(projects-ui · workers-ui)이라 여기 있다(AGENTS.md 새 파일 규칙). */
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/language-provider";
import { wrap } from "@/lib/i18n";

declare global {
  interface Window {
    /** `apps/desktop/preload.cjs`가 노출한다. 오가는 것은 경로 문자열 하나뿐이다 — `fs`도
     *  `ipcRenderer` 원본도 렌더러에 없다.
     *
     *  `updateAction`은 §릴리스 - 자동 업데이트 §표면이 창 안으로 들어온다 T7 - `update-toast.tsx`가
     *  쓴다. 인자는 미리 아는 이름 하나이고 main이 `switch`로 갈라 모르는 값은 버린다(고정하는 것 4). */
    dira?: {
      pickPath(mode: "file" | "directory"): Promise<string | null>;
      updateAction(
        action: "state",
      ): Promise<{ version: string } | null>;
      updateAction(action: "notes"): Promise<string | null>;
      updateAction(action: "restart" | "later"): Promise<null>;
    };
  }
}

/** 서버 스냅숏은 항상 `false`이고 클라이언트 스냅숏만 `window`를 본다 — `useEffect` + `setState`로
 *  같은 일을 하면 렌더 직후 한 번 더 렌더한다(eslint `set-state-in-effect`). 값이 바뀌는 일이
 *  없으므로 구독은 빈 함수다. */
const NEVER = () => () => {};
const isDesktop = () => !!window.dira;
const NOT_DESKTOP = () => false;

/** **데스크톱 셸인가**(§데스크톱 앱 N3). 판정이 두 곳이라(이 버튼 · §N5 찾기 바 —
 *  `find-bar.tsx`) export한다: 두 벌이 되면 한쪽이 SSR 어긋남 처리를 빠뜨린다. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(NEVER, isDesktop, NOT_DESKTOP);
}

export function PickPath({
  mode,
  label,
  onPick,
}: {
  mode: "file" | "directory";
  /** 어느 칸인지 — 한 화면에 이 버튼이 여럿이라 `찾아보기`만으로는 구분되지 않는다 */
  label: string;
  onPick: (abs: string) => void;
}) {
  const t = useT();
  const desktop = useIsDesktop();
  if (!desktop) return null;

  return (
    <Button
      type="button"
      variant="outline"
      aria-label={wrap(label, t("pathPicker.browse"), "")}
      onClick={async () => {
        const picked = await window.dira?.pickPath(mode);
        if (picked) onPick(picked);
      }}
    >
      {t("pathPicker.browse")}
    </Button>
  );
}
