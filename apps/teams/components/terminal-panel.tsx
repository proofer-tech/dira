"use client";

/** 터미널 탭 하나가 그리는 실제 화면 (DESIGN.md §11-1). `@xterm/xterm`이 ANSI를 직접 그린다 —
 *  이 컴포넌트는 그 라이브러리를 pty 스트림에 잇는 배선뿐이다.
 *
 *  **폴링에 안 든다**(§11 결정 4) — 마운트할 때 `home/pty/[id]` GET을 한 번 열어 그 응답 스트림을
 *  그대로 읽는다(청크마다 `term.write`). 언마운트(탭을 접거나 표면을 벗어나면)하면 스트림을
 *  끊는다 — 서버 쪽 pty 자체는 안 죽는다(`lib/pty.ts`의 backlog가 다음 구독자를 위해 남는다).
 *
 *  **이 컴포넌트 자신은 "다시 연결"을 하지 않는다** — 마운트되면 무조건 연다. `끊긴
 *  터미널입니다`로 보이는 것은 부모(`TerminalSurface`, `home-ui.tsx`)가 죽었다고 확인한
 *  탭만 이 컴포넌트를 아예 마운트하지 않는 것으로 만든다(§11-1 §개정 — 살아 있으면 새로고침
 *  이든 표면 이탈/복귀든 곧장 마운트한다. 죽은 탭만 사람이 `다시 열기`를 눌러야
 *  `restartTerminal` 액션이 새 pty를 심고, 그 뒤에야 이 컴포넌트가 뜬다). */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useHotkey } from "@/components/keymap-provider";
import { useT } from "@/components/language-provider";
import { readPtyStream } from "@/lib/pty-stream";
import { FindBarChrome } from "@/components/find-bar";
import { isShellBoundCtrlF, resultLabel, searchDecorations } from "@/lib/terminal-search";

/** `lib/pty.ts`의 `stty cols 120 rows 32`와 같은 값 — 서버가 그 크기로 셸을 열었으므로 화면도
 *  같은 크기로 맞춘다. ponytail: 고정 크기, 창 크기 반영은 다음 티켓(§11-1 수용조건 밖). */
const COLS = 120;
const ROWS = 32;

/** 탭 id -> 그 탭이 연 `Terminal`·`SearchAddon` 한 쌍(P405-2, §7 §터미널만 엔진이 갈린다).
 *  DOM `Range`를 쓰는 다른 표면은 `find-bar.tsx`의 `MAIN`·`EXPLORER_MAIN`처럼
 *  `document.querySelector` getter로 "활성 탭의 지금 것"을 집지만, 터미널은 DOM에 없는 값
 *  (라이브러리 인스턴스)이라 그 관용구가 안 통한다 — 탭이 마운트·언마운트될 때 이 맵 하나에
 *  등록·해제하는 것이 그 자리를 대신한다. `TerminalFindBar`가 활성 탭 id로 이 맵을 읽는다. */
const registry = new Map<string, { term: Terminal; search: SearchAddon }>();

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
    // `allowProposedApi` — `SearchAddon`의 데코레이션(`registerDecoration`)이 제안 API라, 이
    // 값 없이 `searchDecorations`를 넘기면 "You must set the allowProposedApi option" 예외로
    // `TerminalFindBar`가 통째로 죽는다(실측 - 헤드리스 CDP로 `Mod+f` 뒤 콘솔에서 잡았다).
    const term = new Terminal({ cols: COLS, rows: ROWS, cursorBlink: true, scrollback: 5000, allowProposedApi: true });
    if (hostRef.current) term.open(hostRef.current);

    // **`Ctrl+F`가 셸로 안 샌다**(P405-2, §7 §`Ctrl+F`가 셸로 새면 안 된다) — 판정은
    // `lib/terminal-search.ts`의 `isShellBoundCtrlF`(패리티 검증은 `terminal-search.test.ts`).
    term.attachCustomKeyEventHandler((e) => !isShellBoundCtrlF(e));

    const search = new SearchAddon();
    term.loadAddon(search);
    registry.set(id, { term, search });

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
      registry.delete(id);
      search.dispose();
      term.dispose();
    };
  }, [projectId, id]);

  return <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden p-2" />;
}

/** 임의 CSS 색(`oklch()`·`lab()`·`color-mix()`도)을 `#rrggbb`로 굽는다 - `lib/terminal-search.ts`의
 *  `searchDecorations`가 왜 이 값을 요구하는지는 그 파일 주석에 있다. 1x1 canvas에 검은 바탕
 *  위로 그 색을 `alpha`만큼 얹고 합성된 픽셀을 읽는다 - 브라우저의 색 공간 변환을 그대로 빌려
 *  쓰는 자리라 여기서 손으로 안 짠다. 검은 바탕인 이유는 터미널 배경이 실제로 검정이라서다
 *  (`terminal-panel.tsx` 위 ponytail 주석 - xterm 기본 테마 `#000`). */
function toHex(color: string, alpha = 1): string {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 1, 1);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** `--primary`가 지금 앉힌 값을 hex 둘로 굽는다(§7 §하이라이트도 ... `--primary` 계열을 그대로
 *  옮긴다) — 진한 현재 강조는 그 색 그대로, 옅은 전체 강조는 `find-bar.tsx`의 `CSS_RULES`와
 *  같은 25%다. 부를 때마다 `getComputedStyle`로 떠 읽는다 — 라이트·다크 전환에도 새 값을
 *  따라간다. */
function primaryHexPair(): { primary: string; muted: string } {
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  return { primary: toHex(primary), muted: toHex(primary, 0.25) };
}

/** **터미널 표면의 찾기 바** (P405-2, §7 §터미널은 활성 탭의 화면 32줄과 스크롤백 5,000줄).
 *  그릇은 `find-bar.tsx`의 `FindBarChrome` 그대로다 — 갈리는 것은 훑는 엔진뿐이다: DOM
 *  `Range` 대신 `registry`에서 활성 탭의 `SearchAddon`을 집어 `findNext`·`findPrevious`를
 *  부르고, 건수는 그 애드온의 `onDidChangeResults`로 받는다(새 API 0 — `home-ui.tsx`가 이미
 *  아는 `activeTab` id 하나만 받는다). */
export function TerminalFindBar({ activeTab }: { activeTab: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ index: number; count: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useHotkey("board.search", (e) => {
    e.preventDefault();
    setOpen(true);
    input.current?.focus();
    input.current?.select();
  });

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
  }, [open]);

  // **탭을 갈면 바가 닫힌다**(§7 §표면을 갈면 바가 닫힌다와 같은 이유, 탭 단위) — 훑을 자리가
  // 탭마다 다른 `SearchAddon` 인스턴스라, 열어 둔 채 넘기면 옛 탭에서 센 건수가 새 탭 위에
  // 남는다. 마운트 첫 렌더는 건너뛴다 — 그때는 아직 전환이 아니다.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setOpen(false);
    setQuery("");
    setResult(null);
  }, [activeTab]);

  const entry = activeTab ? registry.get(activeTab) : undefined;

  useEffect(() => {
    if (!open || !entry) return;
    const sub = entry.search.onDidChangeResults((e) => setResult({ index: e.resultIndex, count: e.resultCount }));
    return () => sub.dispose();
  }, [open, entry]);

  // 질의가 바뀌면 처음부터 다시 찾는다(`incremental` — 타이핑 중 선택을 그 질의가 맞는 동안
  // 넓힌다). 빈 질의면 데코레이션을 걷고 0건이다 — DOM판(`find-bar.tsx`)의 `collect()` 빈
  // 훑기와 같은 처리다.
  useEffect(() => {
    if (!open || !entry) return;
    // `scan`으로 감싸 부른다 — `find-bar.tsx`의 `scan()`과 같은 이유(§30 주석) — 직접 이 자리에
    // `setResult`를 적으면 `react-hooks/set-state-in-effect`가 잡는다.
    const scan = () => {
      if (!query) {
        entry.search.clearDecorations();
        setResult(null);
        return;
      }
      const { primary, muted } = primaryHexPair();
      entry.search.findNext(query, { decorations: searchDecorations(primary, muted), incremental: true });
    };
    scan();
  }, [open, entry, query]);

  const go = (dir: 1 | -1) => {
    if (!entry || !query) return;
    const { primary, muted } = primaryHexPair();
    const opts: ISearchOptions = { decorations: searchDecorations(primary, muted) };
    if (dir === 1) entry.search.findNext(query, opts);
    else entry.search.findPrevious(query, opts);
  };

  /** `Esc` 또는 닫기 버튼 — 데코레이션이 걷히고 **포커스가 그 터미널로 돌아간다**(§7 §닫을 때
   *  포커스가 가는 곳: 그 터미널) — 곧바로 타이핑이 들어간다. */
  const close = () => {
    entry?.search.clearDecorations();
    setOpen(false);
    setQuery("");
    setResult(null);
    entry?.term.focus();
  };

  if (!open) return null;

  const { label, idle } = resultLabel(query, result);

  return (
    <FindBarChrome
      inputRef={input}
      query={query}
      onQueryChange={setQuery}
      onSubmit={() => go(1)}
      onEscape={close}
      onShiftEnter={() => go(-1)}
      label={label}
      idle={idle}
      onPrev={() => go(-1)}
      onNext={() => go(1)}
      onClose={close}
      placeholder={t("findBar.placeholder")}
      prevLabel={t("findBar.prev")}
      nextLabel={t("findBar.next")}
      closeLabel={t("findBar.close")}
    />
  );
}
