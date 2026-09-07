"use client";

/** 터미널 탭 하나가 그리는 실제 화면 (DESIGN.md §11-1). `@xterm/xterm`이 ANSI를 직접 그린다 —
 *  이 컴포넌트는 그 라이브러리를 pty 스트림에 잇는 배선뿐이다.
 *
 *  **폴링에 안 든다**(§11 결정 4) — 마운트할 때 `home/pty/[id]` GET을 한 번 열어 그 응답 스트림을
 *  그대로 읽는다(청크마다 `term.write`). 언마운트(탭을 접거나 표면을 벗어나면)하면 스트림을
 *  끊는다 — 서버 쪽 pty 자체는 안 죽는다(`lib/pty.ts`의 backlog가 다음 구독자를 위해 남는다).
 *
 *  **이 컴포넌트 자신은 "다시 연결"을 하지 않는다** — 마운트되면 무조건 연다. 새로고침 뒤
 *  `끊김`으로 보이는 것은 부모(`TerminalSurface`, `home-ui.tsx`)가 이 컴포넌트를 아예 마운트하지
 *  않는 것으로 만든다(§11 결정 2 — 사람이 `다시 열기`를 눌러야 `restartTerminal` 액션이 새
 *  pty를 심고, 그 뒤에야 이 컴포넌트가 뜬다). */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { readPtyStream } from "@/lib/pty-stream";

/** `lib/pty.ts`의 `stty cols 120 rows 32`와 같은 값 — 서버가 그 크기로 셸을 열었으므로 화면도
 *  같은 크기로 맞춘다. ponytail: 고정 크기, 창 크기 반영은 다음 티켓(§11-1 수용조건 밖). */
const COLS = 120;
const ROWS = 32;

export function TerminalPanel({
  projectId,
  id,
  onDisconnect,
}: {
  projectId: string;
  id: string;
  /** 200이 아닌 응답이거나 한 바이트도 못 받고 끝난 스트림 — 부모가 이 탭을 `끊긴 터미널입니다`
   *  화면으로 되돌린다(§11-1 §개정). 언마운트가 낸 abort는 이 콜백을 안 부른다(`readPtyStream`이
   *  `"aborted"`로 갈라낸다) — 다른 탭으로 옮겼다 돌아와도 정상 화면이 그대로 떠야 해서다. */
  onDisconnect?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = `/p/${projectId}/home/pty/${id}`;
    const term = new Terminal({ cols: COLS, rows: ROWS, cursorBlink: true, scrollback: 5000 });
    if (hostRef.current) term.open(hostRef.current);

    const dataSub = term.onData((data) => {
      fetch(url, { method: "POST", body: data }).catch(() => {});
    });

    const ac = new AbortController();
    (async () => {
      let res: Response;
      try {
        res = await fetch(url, { signal: ac.signal });
      } catch {
        return; // abort(언마운트) — 조용히 물러난다
      }
      const outcome = await readPtyStream(res, (text) => term.write(text), ac.signal);
      if (outcome === "disconnected") onDisconnect?.();
    })();

    return () => {
      ac.abort();
      dataSub.dispose();
      term.dispose();
    };
  }, [projectId, id]);

  return <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden p-2" />;
}
