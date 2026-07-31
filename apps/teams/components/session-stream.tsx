"use client";

/** 세션 스트림 (DESIGN.md §2-1 · §비주얼 §9). 티켓이 진행되는 과정의 `tail -f`.
 *
 *  **줄 모양이 둘뿐이고 그 둘이 서로 안 닮은 것**이 이 파일의 전부다(§9):
 *  접힌 `<Marker>` 한 줄(회색·mono 섞임) / 전면 전문 줄(검정·여러 줄).
 *  색 토큰은 하나도 안 쓴다 — 스트림에는 상태가 없다. 갈리는 건 밝기·폭·서체 셋이다.
 *
 *  읽기·파싱은 전부 `lib/transcript.ts`고 여기는 그리기만 한다. 접기는 네이티브 `<details>`,
 *  툴팁은 네이티브 `title`, 스크롤도 네이티브 — shadcn은 `button`과 `marker` 둘뿐이다(§5). */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronRight } from "lucide-react";
import { tailSession } from "@/app/p/[project]/tickets/[hash]/actions";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import type { StreamEvent } from "@/lib/transcript";
import { expandable } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** 레코드의 `timestamp`는 UTC다 — **로컬 시간으로 렌더한다**(§2-1: `13:55:10Z` = KST `22:55:10`).
 *  `toLocaleTimeString`을 쓰지 않는 이유: 로케일에 따라 `오후 10:55:10`이 나온다. 8자 고정이라
 *  열 정렬을 버린 뒤에도 시각만은 줄마다 세로로 맞는다(§9). */
function localTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 바닥에 붙어 있나. 줄 1.5개(32px) 안이면 붙은 것으로 본다(§9 자동 스크롤). */
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 32;

export function SessionStream({
  project,
  stem,
  live: initialLive,
}: {
  project: string;
  stem: string;
  live: boolean; // 티켓이 `.wip`인가 — 서버가 매 폴링마다 다시 판정해 갱신한다
}) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [live, setLive] = useState(initialLive);
  const [detached, setDetached] = useState(false); // 바닥에서 떨어졌다 = 자동 스크롤 안 한다
  const offset = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  // 진행중이면 2초 폴링, 완료면 1회 읽고 멈춘다(§2-1). `live`가 false로 바뀌는 순간(세션이 끝났다)
  // 그 응답을 마지막으로 타이머를 끊는다 — 완료 티켓에서 요청이 반복되지 않는 근거가 이 줄이다.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      const r = await tailSession(project, stem, offset.current);
      if (stop) return;
      offset.current = r.offset;
      if (r.events.length) setEvents((prev) => [...prev, ...r.events]);
      if (!r.live) {
        setLive(false);
        clearInterval(timer);
      }
    };
    void poll();
    if (initialLive) timer = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [project, stem, initialLive]);

  // 붙어 있을 때만 따라간다. 첫 렌더가 맨 아래에서 시작하는 것도 이 효과다(§9).
  useEffect(() => {
    if (detached) return;
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events, detached]);

  // `<details>`를 여는 순간 자동 스크롤을 뗀다(바닥 판정과 무관하게) — 안 떼면 방금 연 블록이
  // 뒤에 온 사건에 밀려 화면 밖으로 나간다. 닫으면 다시 바닥 판정으로 돌아간다.
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) setDetached(true);
    else if (box.current) setDetached(!atBottom(box.current));
  };

  return (
    <div className="space-y-2">
      {/* 폴링 상태는 배지가 아니다 — 티켓 상태 배지가 이미 화면 머리에 있고, 같은 사실을 두 모양으로
          그리면 어느 쪽이 정본인지 모르게 된다(§9). 색도 아이콘도 없다.
          **`따라가는 중`은 여기 없다** — 상자 안 맨 아래로 옮겼다(§2-1 · §18 ④). 사건이 쌓일수록
          머리 문구가 "지금"에서 멀어져서다. 진행중이면 이 줄에는 `맨 아래로` 버튼만 남고,
          `h-8`은 그대로 둔다(버튼이 떴다 사라질 때 상자가 위아래로 튀지 않는다). */}
      <div className="flex h-8 items-center justify-end gap-2">
        {!live && <p className="mr-auto text-xs text-muted-foreground">끝난 세션 · 갱신 없음</p>}
        {detached && (
          <Button variant="ghost" size="sm" onClick={() => setDetached(false)}>
            <ArrowDown aria-hidden className="size-3.5" />
            맨 아래로
          </Button>
        )}
      </div>

      {/* 배경에 틴트를 깔지 않는다 — `--muted`를 깔면 접힌 줄의 `--muted-foreground`가 4.34로
          AA 미달이다(§9 함정 1). 512px인 이유는 머리와 바닥이 한 화면에 같이 들어와서다. */}
      <div
        ref={box}
        onScroll={(e) => setDetached(!atBottom(e.currentTarget))}
        className="h-[32rem] overflow-y-auto rounded-md border bg-background py-2"
      >
        {events.map((e) =>
          e.label ? (
            <Row key={e.key} e={e} onToggle={onToggle} />
          ) : (
            <FullText key={e.key} e={e} />
          ),
        )}
        {/* 진행 표식(§18 ④) — 마지막 사건 다음 줄이 올 자리를 지킨다. `<Marker>`도 `<details>`도
            아니다: §9가 Marker 기본값을 하나도 안 덮기로 했는데 여기는 `text-xs`여야 한다
            (폴링 상태 3종이 한 종류인 채로 자리만 옮겼다). 눌러 볼 것이 없으니 hover도 없다.
            `mx-1`이 8px 점을 16px 칸(= MarkerIcon 폭) 가운데 세워 문구를 다른 두 줄과 같은
            x=36px에 맞춘다. // ponytail: 정렬용 래퍼 대신 마진 4px. 점이 커지면 그때 래퍼.
            문구를 같이 드는 이유는 `prefers-reduced-motion`이다 — 모션만으로 말하지 않는다. */}
        {live && (
          <div className="flex items-center gap-2 px-3 text-xs leading-6 text-muted-foreground">
            <span
              aria-hidden
              className="mx-1 size-2 shrink-0 animate-wip-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
            />
            따라가는 중 · 2초마다
          </div>
        )}
      </div>
    </div>
  );
}

/** 접힌 줄 — `<Marker>` 한 줄. `tool_use`·`thinking`·`tool_result`·세션 프롬프트가 전부 이 모양이다.
 *  고정폭 4열은 (a)가 버렸다(요구 `e3020347`) — 시각(mono 8자)만 세로로 맞고 도구명부터 줄마다
 *  어긋난다. 도구명에 `max-w-[7rem]`만 남은 것이 종전 고정폭이 묶던 흔들림 범위를 대신한다.
 *  Marker 기본값(`flex gap-2 items-center text-sm text-muted-foreground w-full`)은 하나도 안 덮는다. */
function Row({
  e,
  onToggle,
}: {
  e: StreamEvent;
  onToggle: (ev: React.SyntheticEvent<HTMLDetailsElement>) => void;
}) {
  const summary = e.sidechain ? `서브 · ${e.summary}` : e.summary;
  // 시각·도구명은 `shrink-0`이라, 줄이 넘칠 때 줄어드는 칸은 `MarkerContent` 하나다
  // (그 `min-w-0`이 종전 `minmax(0,1fr)`가 하던 일이다).
  const cells = (
    <>
      <span className="shrink-0 font-mono tabular-nums">{localTime(e.ts)}</span>
      {/* mono면 엔진이 실제로 부른 이름이고, sans면 우리가 붙인 이름이다(§9).
          판정은 `kind` 하나다 — 화면이 도구 목록을 다시 갖지 않는다. */}
      <span
        className={cn("max-w-[7rem] shrink-0 truncate", e.kind === "tool_use" && "font-mono")}
        title={e.label}
      >
        {e.label}
      </span>
      <MarkerContent className={cn("truncate", e.summaryMono && "font-mono")} title={summary}>
        {summary}
      </MarkerContent>
    </>
  );
  const line = "px-3 leading-6";

  // 펼칠 것이 없으면 어포던스도 없다(`expandable` — 판정은 `lib/urls.ts` 하나다).
  // 여기 오는 건 본문이 암호화된 `thinking`이다(실측 75/75). 줄 자체는 그대로 흘리고
  // — 빼면 생각하는 동안 화면이 조용해진다 — `MarkerIcon` 칸만 §9대로 **비워서 유지**한다.
  if (!expandable(e)) {
    return (
      <Marker className={line}>
        <MarkerIcon />
        {cells}
      </Marker>
    );
  }

  return (
    <details className="group" onToggle={onToggle}>
      {/* hover에서 글자를 같이 올리는 건 대비 때문이다 — `--muted-foreground`가 `bg-muted/50`
          위에서 라이트 4.54로 바닥에 붙는다(§9 함정 2). `text-foreground`면 18.97이다.
          색이 이제 Marker 루트의 기본 클래스라 hover도 같은 요소에 붙는다(변종이 이긴다). */}
      <Marker
        render={<summary />}
        className={cn(
          line,
          "cursor-pointer list-none hover:bg-muted/50 hover:text-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        {/* `MarkerIcon`은 `aria-hidden`이라 의미를 나르는 그림을 넣지 않는다 — 순수 어포던스뿐이다.
            `size-4`는 Marker 기본 규칙이 준다(§9: 덮지 않는다). */}
        <MarkerIcon>
          <ChevronRight className="group-open:rotate-90" />
        </MarkerIcon>
        {cells}
      </Marker>
      {/* 펼친 원문. `text-foreground`가 아니면 `--muted` 위에서 4.34로 미달한다(§9에서 가장
          밟기 쉬운 함정). `max-h-96`은 `tool_result` 실측 38173바이트가 컨테이너를 삼키는 걸 막는다. */}
      <div className="px-3">
        <pre className="mt-1 mb-2 ml-6 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
          {e.body}
        </pre>
      </div>
    </details>
  );
}

/** 전문 줄 — assistant `text`, 첫 번째 이후의 사용자 프롬프트, 그리고 **참견**(§2-2).
 *  **`<Marker>`가 아니다.** 다른 모양이라는 것 자체가 구분이고(§9), 시각도 어포던스도 없다 —
 *  전문이 이미 줄이라 펼칠 것이 없다(§2-1 표의 `펼치면 —`).
 *  사용자 쪽만 왼쪽 선을 받는다: 밖에서 들어온 말이라는 표시에 색을 쓰면 §0이 깨진다(정상 흐름이다).
 *  **참견도 밖에서 들어온 말이라 같은 선을 받고**, 갈리는 것은 §9가 `서브`에 쓴 것과 같은
 *  텍스트 마커 하나다. // ponytail: §비주얼 §21이 아직 없다(`7ac43367` 진행중) — 값이 서면
 *  이 두 줄이 그 자리다. 새 색 토큰도 새 모양도 만들지 않는다. */
function FullText({ e }: { e: StreamEvent }) {
  const outside = e.kind === "prompt" || e.kind === "interject";
  return (
    <div className="px-3">
      <p
        className={cn(
          "my-1 ml-6 text-sm break-words whitespace-pre-wrap text-foreground",
          outside && "border-l-2 border-border pl-3",
        )}
      >
        {e.sidechain && <span className="text-muted-foreground">서브 · </span>}
        {e.kind === "interject" && <span className="text-muted-foreground">참견 · </span>}
        {e.body}
      </p>
    </div>
  );
}
