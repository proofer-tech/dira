"use client";

/** 보드(`/p/<project>/`)의 클라이언트 조각 — 검색 · 다중 선택 필터 · 5초 폴링.
 *
 *  **상태는 URL이 담는다**(제약: 클라이언트 상태 라이브러리 없음). 여기 있는 `useState`는 아직
 *  확정되지 않은 입력 글자뿐이고, 확정된 값은 항상 `searchParams`에 있다 — 그래서 필터 결과를
 *  공유하고 새로고침해도 그대로다. 정렬 헤더·필터 해제 링크는 서버가 그린 `<Link>`라 여기 없다.
 *
 *  필터 UI를 `command`로 하는 것은 DESIGN.md §5가 정한 것이다(검색·키보드 이동을 직접 쓰면
 *  수백 줄이고, 전환기가 이미 같은 컴포넌트를 쓴다). */
import { Children, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTrackedRouter } from "@/lib/route-pending";
import { Check, ChevronsUpDown, ListFilter, Search, TriangleAlert } from "lucide-react";
import { setTicketEpic } from "@/app/(app)/p/[project]/tickets/[hash]/actions";
import { EarlyRefreshPolling } from "@/components/early-refresh";
import { useHotkey } from "@/components/keymap-provider";
import { useT } from "@/components/language-provider";
import { PersonaDot } from "@/components/persona-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { doneLimit, DONE_LANE_LIMIT, relationPath, rowLimit, ROW_PAGE, type Anchor } from "@/lib/urls";
import type { RelationEdge } from "@/lib/queue";

/** 필터·검색은 히스토리를 남기지 않는다(`replace`) — 글자마다 한 칸씩 쌓이면 뒤로가기로
 *  보드에서 나갈 수 없다. 정렬·필터 해제는 `<Link>`(push)라 뒤로가기가 정상 동작한다. */
function useUrlNav() {
  const router = useTrackedRouter();
  const pathname = usePathname();
  // 문자열로 받는다 — 객체 신원으로 비교하면 폴링 리렌더마다 effect가 다시 돈다(디바운스가 안 끝난다).
  const qs = useSearchParams().toString();
  /** `rows`(표뷰가 지금 받아 둔 행 수)·`done`(칸반 완료 레인이 지금까지 그린 카드 수)은
   *  **목록이 갈리면 지운다** — 검색·필터가 바뀌면 다른 목록이고 처음 몫부터가 맞다
   *  (§1 §테이블 바디는 30행씩 · §완료 항 `?done=`, 요구 `79cad792`). 이 훅을 거치는 것이 그
   *  둘뿐이라 판정이 여기 한 줄이고, 서버가 그리는 링크(정렬·필터 해제·뷰 전환)는 `page.tsx`의
   *  `qs()`가 같은 일을 한다. 그 값을 **세우는** 자리는 각자의 감시행 하나뿐이다(`keep`) —
   *  둘을 동시에 세우는 자리는 없다(표와 칸반 레인은 같은 렌더에 안 같이 갈린다). */
  const replace = (next: URLSearchParams, keep?: "rows" | "done") => {
    if (keep !== "rows") next.delete("rows");
    if (keep !== "done") next.delete("done");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return { qs, replace };
}

export function BoardSearch() {
  const { qs, replace } = useUrlNav();
  const url = new URLSearchParams(qs).get("q") ?? "";
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(url);
  const [shown, setShown] = useState(url);
  if (shown !== url) {
    // URL이 밖에서 바뀌었다(뒤로가기·필터 초기화). 입력 칸을 URL에 맞춘다.
    setShown(url);
    setText(url);
  }

  useEffect(() => {
    if (text === (new URLSearchParams(qs).get("q") ?? "")) return;
    // ponytail: 고정 300ms 디바운스. 서버가 큐 전체를 재스캔해도 수십 건이라 이게 제일 싸다 —
    //           수천 건 되면 디바운스를 늘리는 게 아니라 queue.ts에 인덱스를 둔다.
    const timer = setTimeout(() => {
      const next = new URLSearchParams(qs);
      if (text) next.set("q", text);
      else next.delete("q");
      replace(next);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replace는 매 렌더 새 함수다(qs가 실질 의존)
  }, [text, qs]);

  // `⌘F`(§0-6 `board.search`의 **보드 갈래**). **보드에만 있는 컴포넌트라 범위가 저절로 맞는다.**
  // `Mod` 조합이고 화면을 안 떠나는 액션이라 글 쓰는 중에도 듣는다 — 검색 칸에 글을 쓰다 눌러도
  // 온다(`useHotkey`의 가드는 그 둘로 판정한다). `preventDefault`는 크롬 찾기 바를 뺏는다 — 이 화면에서 찾기는
  // 우리 것이라고 요구가 적었다(`6218440d`).
  useHotkey("board.search", (e) => {
    e.preventDefault();
    input.current?.focus();
  });

  return (
    <InputGroup className="h-8 max-w-xs">
      <InputGroupAddon>
        <Search aria-hidden className="size-3.5" />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="title · 본문 · frontmatter 검색"
        aria-label="티켓 검색"
      />
    </InputGroup>
  );
}

export type FilterOption = {
  value: string;
  label: string;
  /** persona 필터만 쓴다 — 레지스트리의 팔레트 키다(§5 · §비주얼 §12). 항목에 **점만** 붙는다:
   *  껍데기(배지) 안에 배지를 또 넣지 않는다. 색을 안 고른 페르소나도 빈 점이 와야 자리가
   *  흔들리지 않으므로 `undefined`가 "점을 그리지 않는다"를 뜻하지 않는다 — 그 판정은 `dot`이다. */
  color?: string;
};

/** 다중 선택 하나(kind·persona·상태). 선택값은 `?<param>=a&<param>=b`로 URL에 쌓인다 —
 *  구분자를 쓰지 않는 이유는 kind 값에 무엇이 들어올지 우리가 정하지 않기 때문이다. */
export function BoardFilter({
  param,
  label,
  options,
  defaults,
  preset,
  dot,
}: {
  param: string;
  label: string;
  options: FilterOption[];
  /** 항목마다 색 점을 그린다(persona 필터 하나뿐 — §5의 붙는 자리 표). 트리거 라벨
   *  (`persona: pm, qa`)은 손대지 않는다: 값 표시가 아니라 선택 요약 문자열이다. */
  dot?: boolean;
  /** 파라미터가 URL에 **하나도 없을 때**의 실효값(상태 필터의 완료 숨김만 쓴다 — §1 보드).
   *  서버의 유도와 같은 식이어야 한다: 하나라도 실려 있으면 실린 값이 전부다. 체크 표시는
   *  결과에 대한 진술이므로 기본값으로 걸러진 화면에서 체크가 6개면 그 진술이 거짓이 된다.
   *  안 넘기면 종전 그대로다(`kind`·`persona`). */
  defaults?: string[];
  /** 목록 맨 위의 1클릭 항목 — 이 필터를 `values`로 **갈아 쓴다**(토글이 아니다).
   *  상태 필터의 `전체 보기`만 쓴다(§1 보드). 다른 파라미터는 건드리지 않는다. */
  preset?: { label: string; values: string[] };
}) {
  const { qs, replace } = useUrlNav();
  const [open, setOpen] = useState(false);
  const sp = new URLSearchParams(qs);
  const selected = sp.has(param) ? sp.getAll(param) : (defaults ?? []);

  const set = (values: string[]) => {
    const next = new URLSearchParams(qs);
    next.delete(param);
    for (const v of values) next.append(param, v);
    replace(next);
  };

  const toggle = (value: string) =>
    set(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            className="h-8 max-w-52 gap-2"
          >
            <span className="truncate">
              {label}
              {selected.length > 0 &&
                `: ${selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")}`}
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={`${label} 검색`} />
          <CommandList className="max-h-72">
            <CommandEmpty>일치하는 {label} 0건</CommandEmpty>
            {preset && (
              <>
                {/* 값이 아니라 동작이다 — 체크 자리를 비워 두면 "안 고른 값"으로 읽힌다.
                    구분선으로 값 목록에서 떼고, 아이콘 자리에는 동작 아이콘을 넣는다. */}
                <CommandItem value={preset.label} onSelect={() => set(preset.values)}>
                  <ListFilter aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{preset.label}</span>
                </CommandItem>
                <CommandSeparator />
              </>
            )}
            {options.map((o) => (
              <CommandItem
                key={o.value}
                value={`${o.value} ${o.label}`}
                onSelect={() => toggle(o.value)}
              >
                {/* 선택 안 된 항목도 같은 폭을 차지한다 — 정렬이 흔들리면 스캔이 깨진다(§4-1) */}
                <span className="w-4 shrink-0">
                  {selected.includes(o.value) && <Check aria-hidden className="size-4" />}
                </span>
                {/* `[체크 자리 w-4] [점] [이름]` — 간격은 CommandItem 기본 gap-2다(§비주얼 §12) */}
                {dot && <PersonaDot color={o.color} />}
                <span className="truncate">{o.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 큐는 cron이 GUI 밖에서 바꾼다 — 5초마다 서버 컴포넌트를 다시 받는다(DESIGN.md §아키텍처).
 *  갱신 중 로딩 표시는 내지 않는다(§6): 5초마다 깜빡이는 화면은 읽을 수 없다.
 *
 *  ponytail: 고정 5초 전체 재스캔. 천장은 큐 크기다(파일 수십 개 × 4바이트 stat이라 지금은 공짜).
 *            수백 건이 되거나 탭을 여러 개 켜두는 게 문제되면 mtime 조건부 응답 → 그 다음이 SSE.
 *            숨은 탭은 아예 건너뛴다 — 배경 탭 열 개가 5초마다 큐를 훑을 이유가 없다.
 *
 *  **5초 바닥 위에 이른 갱신을 얹는다**(DESIGN.md §보드 갱신, 요구 `7cd6dea2`) — 지우지 않는다,
 *  그게 안전망이다. 250ms 축은 `EarlyRefreshPolling`(`components/early-refresh.tsx`)으로 뗐다
 *  (DESIGN.md §이른 갱신이 붙는 화면 §개정 1, 요구 `de0b759d`) — 보드만 이 5초 바닥을 그 위에
 *  더 얹는다. */
export function BoardPolling({ project, rev }: { project: string; rev: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  return <EarlyRefreshPolling project={project} rev={rev} />;
}

/** 테이블 `tbody` — 30행씩 그리고 바닥에 닿으면 30행 더(§1 보드). **자르기가 아니다**:
 *  계속 내리면 필터에 걸린 행이 전부 나온다.
 *
 *  **자르는 쪽이 서버다**(§성능 예산 §초과분 ② — 페이로드 786행 3.1MB). 여기가 클라이언트
 *  경계라 `children`으로 오는 행은 **전부 RSC 페이로드로 직렬화된다** — DOM에 30행만 넣어도
 *  오가는 것은 786행이고 그게 5초 폴링마다다. 그래서 서버가 `?rows=`만큼만 그리고 여기는
 *  받은 것을 그대로 그린다. 필터·검색·정렬은 종전대로 서버에 남고(자르는 것은 **정렬한 뒤**의
 *  앞 n행이다) 건수 줄도 그리는 수와 무관하다 — 갈린 것은 기전뿐이고 동작은 §1 그대로다.
 *
 *  **바닥 판정은 `IntersectionObserver` 하나다.** 마지막 행 뒤에 1px 감시행을 두고 그게 보이면
 *  `?rows=`를 30 올린다. root는 기본값(뷰포트)으로 충분하다 — 교차 사각형은 조상의 클립(= 헤더가
 *  sticky로 붙어 있는 그 스크롤 컨테이너)을 타고 계산되므로 **새 스크롤러도 컨테이너 조회도 없다**.
 *
 *  **되감는 것은 URL이 갈릴 때뿐이다**(§1): 5초 폴링은 `router.refresh()`라 URL이 그대로고
 *  서버가 **지금 받아 둔 만큼**을 다시 그린다 — 80행까지 내려 읽던 사람이 갱신 한 번에 30행으로
 *  돌아가면 이 화면은 읽을 수가 없다. 정렬·필터·검색이 바뀌면 다른 목록이라 30행부터고, 그
 *  판정은 `rows`를 지우는 두 자리(`useUrlNav`·`page.tsx`의 `qs()`)에 있다. */
export function BoardRows({ more, children }: { more: boolean; children: React.ReactNode }) {
  const { qs, replace } = useUrlNav();
  const shown = Children.count(children);
  const sentinel = useRef<HTMLTableRowElement>(null);

  // `qs`가 의존에 있는 이유: 감시행은 다 그리면 사라지고 폴링으로 행이 늘면 다시 돌아온다
  // (그때 새 노드라 다시 observe해야 한다). `shown`은 감시행이 시야에 남아 있을 때 —
  // 화면이 30행보다 길면 — 다음 30행이 이어서 붙게 한다.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return;
      const next = new URLSearchParams(qs);
      // **요청은 그려진 행에서 센다**(URL이 아니다). URL은 `router.replace` 직후 바로 갱신되고
      // 행은 서버 응답이 와야 늘어서, URL로 세면 응답을 기다리는 동안 감시행이 계속 보이는 만큼
      // `rows`가 60·90·120으로 달아난다. 이미 요청해 둔 몫이면 아무것도 안 한다.
      if (shown + ROW_PAGE <= rowLimit(next.get("rows"))) return;
      next.set("rows", String(shown + ROW_PAGE));
      replace(next, "rows");
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replace는 매 렌더 새 함수다(qs가 실질 의존)
  }, [qs, shown]);

  // 다른 목록이면 **상자도 맨 위부터**다. 검색·필터는 `replace(scroll: false)`라 스크롤이 바닥에
  // 남는데(그래야 글자마다 화면이 튀지 않는다) 새 목록을 30행만 그리면 그 위치가 곧 바닥이라
  // 감시행이 즉시 다시 걸린다 — 30행부터 그리라는 §1이 눈에 보이지 않는다.
  // **`rows`는 빼고 본다** — 그 값이 오르는 것은 같은 목록을 이어 읽는 중이라는 뜻이다.
  const list = (() => {
    const p = new URLSearchParams(qs);
    p.delete("rows");
    return p.toString();
  })();
  useEffect(() => {
    sentinel.current?.closest("[data-slot=table-container]")?.scrollTo(0, 0);
  }, [list]);

  return (
    <>
      {children}
      {/* 1px 감시행. 높이가 0이면 교차비가 0으로 굳어 안 걸린다 */}
      {more && (
        <tr ref={sentinel} aria-hidden>
          <td className="h-px p-0" />
        </tr>
      )}
    </>
  );
}

/** 칸반 `완료` 레인 카드 스택 — 20건씩 그리고 바닥에 닿으면 20건 더(§1 보드 §완료 항, 요구
 *  `79cad792`). 감시행 판정은 `BoardRows`와 **같다**(1px 감시행 · `IntersectionObserver` 기본
 *  root · 이미 요청해 둔 몫이면 아무것도 안 한다) — 그릇만 `<tr>`이 아니라 `<div>`다(카드 스택은
 *  `data-lane` 스크롤러이지 표가 아니다). `되감기`도 표와 같은 이유로 손대지 않는다: 5초
 *  폴링은 `router.refresh()`라 URL이 그대로고 서버가 지금 받아 둔 만큼을 다시 그린다. */
export function BoardDoneLane({ more, children }: { more: boolean; children: React.ReactNode }) {
  const { qs, replace } = useUrlNav();
  const shown = Children.count(children);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return;
      const next = new URLSearchParams(qs);
      // **요청은 그려진 카드에서 센다**(URL이 아니다) — `BoardRows`와 같은 이유다.
      if (shown + DONE_LANE_LIMIT <= doneLimit(next.get("done"))) return;
      next.set("done", String(shown + DONE_LANE_LIMIT));
      replace(next, "done");
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replace는 매 렌더 새 함수다(qs가 실질 의존)
  }, [qs, shown]);

  return (
    <>
      {children}
      {/* 1px 감시행. 높이가 0이면 교차비가 0으로 굳어 안 걸린다 */}
      {more && <div ref={sentinel} aria-hidden className="h-px" />}
    </>
  );
}

/** §1의 보이는 판정 **하나** — 그 세로 구간이 자기 레인 스크롤러의 보이는 상자와 겹치는가.
 *  §17 관계선과 §20 레인 이동이 **같은 함수**를 부른다(판정이 갈리면 화면이 거짓알려 준다).
 *  rect가 아니라 `top`·`bottom`을 받는 이유는 §20이 **지금 DOM에 없는 자리**(종전 자리)도
 *  같은 판정에 태우기 때문이다. */
const laneVisible = (top: number, bottom: number, lr: DOMRect) => bottom > lr.top && top < lr.bottom;

/** 칸반 호버 관계선 (DESIGN.md §1 보드 · §비주얼 §17). **스트립의 `absolute` 자식**이고
 *  간선은 서버가 준다(`relationEdges` — fs 읽기가 늘지 않는다). 여기가 하는 일은 셋뿐이다:
 *  호버된 stem을 알아내고, 그 stem의 상대를 DOM에서 찾고, rect를 재서 `d`를 만든다.
 *
 *  **호버 상태는 URL에 담지 않는다**(§1) — 확정되지 않은 입력이라 여기 남는다(파일 머리 규칙).
 *
 *  §1이 요구한 좌표 추종 넷이 어디서 풀리는지:
 *   - **스트립 가로 스크롤** — 리스너가 없다. 오버레이가 스크롤 컨테이너의 `absolute` 자식이라
 *     콘텐츠와 같이 움직인다(그래서 좌표 원점이 스트립 **콘텐츠 박스**다).
 *   - **레인 세로 스크롤** — `scroll`은 버블하지 않으므로 스트립에서 **캡처로** 받는다.
 *   - **창 리사이즈** — `window` 리스너.
 *   - **5초 폴링 리렌더** — 서버가 `relations`를 새로 주면 아래 effect가 다시 돌아 재측정한다.
 *     그래서 호버 stem이 effect 안의 지역변수가 아니라 `useState`다(effect가 다시 돌아도 그대로다).
 *
 *  못 그리는 것은 **조용히 뺀다**(§17 에러): 상대가 DOM에 없거나(필터·검색·완료 20건 자르기)
 *  자기 레인의 보이는 상자와 안 겹치면 그 획만 없다. `화면 밖 N건` 같은 표시는 없다. */
export function BoardRelations({ relations }: { relations: Map<string, RelationEdge[]> }) {
  const ref = useRef<SVGSVGElement>(null);
  const [stem, setStem] = useState<string | null>(null);
  const [paths, setPaths] = useState<{ d: string; kind: RelationEdge["kind"] }[]>([]);

  // 호버·포커스는 스트립 하나에 위임한다 — 카드마다 핸들러를 달면 보드가 통째로 클라이언트가 된다.
  // 카드는 `focus-within:bg-muted/50`으로 이미 둘을 같이 받고 있다(§1: 호버 **와** 포커스).
  useEffect(() => {
    const strip = ref.current?.parentElement;
    if (!strip) return;
    const stemOf = (n: EventTarget | null) =>
      (n instanceof Element ? n.closest("[data-stem]") : null)?.getAttribute("data-stem") ?? null;
    const enter = (e: Event) => setStem(stemOf(e.target));
    // 포커스가 카드에서 카드로 옮겨 갈 때 `focusout`이 먼저 온다 — 여기서 그냥 비우면 선이
    // 100ms 동안 한 번 사라졌다 다시 뜬다. 받을 쪽(relatedTarget)을 보고 한 번에 갈아 끼운다.
    const leave = (e: Event) => setStem(stemOf((e as FocusEvent).relatedTarget));
    const clear = () => setStem(null);
    strip.addEventListener("mouseover", enter);
    strip.addEventListener("mouseleave", clear);
    strip.addEventListener("focusin", enter);
    strip.addEventListener("focusout", leave);
    return () => {
      strip.removeEventListener("mouseover", enter);
      strip.removeEventListener("mouseleave", clear);
      strip.removeEventListener("focusin", enter);
      strip.removeEventListener("focusout", leave);
    };
  }, []);

  // 좌표는 **호버가 시작된 뒤에** 잰다(§1) — 카드 전부의 rect를 상시 들고 있으면 5초 폴링마다
  // 레이아웃을 강제로 계산한다.
  useEffect(() => {
    const strip = ref.current?.parentElement;
    const edges = (stem && relations.get(stem)) || [];
    if (!strip || !edges.length) {
      setPaths([]);
      return;
    }
    const find = (s: string) => strip.querySelector(`[data-stem="${CSS.escape(s)}"]`);
    const anchor = (el: Element, sr: DOMRect): Anchor | null => {
      const lane = el.closest("[data-lane]");
      if (!lane) return null;
      const r = el.getBoundingClientRect();
      const lr = lane.getBoundingClientRect();
      if (!laneVisible(r.top, r.bottom, lr)) return null;
      const dx = strip.scrollLeft - sr.left; // 원점 = 스트립 콘텐츠 박스(§17 좌표계)
      return {
        left: r.left + dx,
        right: r.right + dx,
        cx: (r.left + r.right) / 2 + dx,
        // 앵커 클램프(§17) — 2px만 걸친 카드도 위 판정을 통과하는데 그 카드의 세로 중앙은
        // 레인 밖이다. 클램프가 없으면 선이 레인 아래로 삐져나가 허공에 뜬다.
        y: Math.min(Math.max((r.top + r.bottom) / 2, lr.top + 2), lr.bottom - 2) - sr.top,
      };
    };
    const draw = () => {
      const sr = strip.getBoundingClientRect();
      const el = stem && find(stem);
      const a = el && anchor(el, sr);
      if (!a) return setPaths([]);
      const next: { d: string; kind: RelationEdge["kind"] }[] = [];
      for (const e of edges) {
        const to = find(e.to);
        const b = to && anchor(to, sr);
        if (b) next.push({ d: relationPath(a, b), kind: e.kind });
      }
      setPaths(next);
    };
    draw();
    strip.addEventListener("scroll", draw, true); // 캡처 — 레인 스크롤은 버블하지 않는다
    window.addEventListener("resize", draw);
    return () => {
      strip.removeEventListener("scroll", draw, true);
      window.removeEventListener("resize", draw);
    };
  }, [stem, relations]);

  return (
    // `overflow-visible`이 없으면 가로로 스크롤한 자리의 선이 SVG 상자 밖이라 통째로 사라진다
    // (좌표는 콘텐츠 폭 기준인데 상자는 보이는 폭이다). 밖으로 나간 획은 스트립이 잘라 준다.
    // 배경을 깔지 않는다 — 카드 위(`z-10`)지만 1.5px 획이라 포커스 링(`ring-[3px]`)이 남는다.
    <svg
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-visible transition-opacity duration-100 ease-out motion-reduce:transition-none"
      style={{ opacity: paths.length ? 1 : 0 }}
    >
      {/* `deps`는 실선(선후) · `req`는 파선(출처)이다 — 색으로 가르지 않는다(§17) */}
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray={p.kind === "req" ? "4 3" : undefined}
          className="stroke-muted-foreground/60"
        />
      ))}
    </svg>
  );
}

/** 칸반 레인 이동 모션 (DESIGN.md §1 보드 · §비주얼 §20). 말하는 사실 한 문장 —
 *  **이 카드가 방금 저 레인에서 왔다.**
 *
 *  React가 그리는 것은 **빈 그릇 하나**뿐이다(§17 오버레이 `<svg>`의 형제 = 스트립의 두 번째
 *  `absolute` 자식). 날아가는 것은 도착 카드의 `cloneNode(true)`라 여기는 imperative다 —
 *  `key={t.path}`도 카드 마크업도 안 건드린다(§18 함정). 추적은 `data-stem`이다.
 *
 *  **왜 카드 자신이 아니라 고스트인가**: 레인이 `overflow-y-auto`라 가로도 클리핑 상자다
 *  — 카드를 이웃 레인까지 `translate`하면 레인 가장자리에서 사라진다(§20).
 *
 *  **폴링 갱신인지는 URL로 안다**(§20 함정): 직전 스냅샷과 경로+쿼리가 같을 때만 비교한다.
 *  필터·검색·정렬·뷰 토글은 URL을 바꾸므로 그 틱은 이동 0건이고, 첫 스냅샷도 0건이다.
 *  **새 상태 플래그를 만들지 않는다** — 판정이 이 문자열 비교 하나다.
 *
 *  ponytail: 틱마다 카드 전수의 rect를 잰다(레이아웃 1회 / 5초). 종전 자리는 DOM이 바뀌기
 *            전에만 알 수 있어서 이 기능의 하한이다. 카드가 수백 장 되면 그때 레인당
 *            `data-lane`만 먼저 비교해 갈린 stem을 추리고 rect는 그 몇 장만 잰다. */
export function BoardLaneMotion() {
  const ref = useRef<HTMLDivElement>(null);
  const seat = useRef<{
    url: string;
    at: Map<string, { lane: number; x: number; y: number; w: number; h: number }>;
  } | null>(null);
  const url = `${usePathname()}?${useSearchParams().toString()}`;

  // 의존성 배열이 **없다** — 폴링 리렌더마다 돌아야 다음 틱이 종전 자리를 안다.
  useEffect(() => {
    const host = ref.current;
    const strip = host?.parentElement;
    if (!strip) return;
    const before = seat.current;
    // 값이 틱마다 다른 측정값이라 CSS가 아니라 여기서 끈다(§20: `motion-reduce:`가 아닌 이유).
    const live =
      before?.url === url && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stop: (() => void)[] = [];

    const sr = strip.getBoundingClientRect();
    const at: NonNullable<typeof before>["at"] = new Map();
    const laneEls = [...strip.querySelectorAll<HTMLElement>("[data-lane]")];
    const lrs = laneEls.map((l) => l.getBoundingClientRect());
    laneEls.forEach((laneEl, lane) => {
      for (const el of laneEl.querySelectorAll<HTMLElement>("[data-stem]")) {
        const r = el.getBoundingClientRect();
        // 좌표 원점은 §17 그대로 — 스트립 **콘텐츠 박스**라 가로 스크롤이 공짜로 따라온다.
        const to = {
          lane,
          x: r.left - sr.left + strip.scrollLeft,
          y: r.top - sr.top,
          w: r.width,
          h: r.height,
        };
        at.set(el.dataset.stem!, to);
        const from = live ? before!.at.get(el.dataset.stem!) : undefined;
        // 레인이 갈린 카드만이다(생성·삭제·같은 레인 세로 이동은 대상이 아니다 — §20).
        if (!from || from.lane === to.lane) continue;
        // 보이는 판정은 **지금** 잰다 — 스냅샷에 굳혀 두면 그 사이 레인을 스크롤한 사용자에게
        // 화면 밖에서 고스트가 튀어나온다(실측 E). 재는 것은 "고스트가 실제로 뜨는 두 자리가
        // 각자 레인의 보이는 상자 안인가"이고, 어느 쪽이든 밖이면 안 그린다.
        // **스크롤은 건드리지 않는다** — 이 컴포넌트는 scrollLeft를 읽기만 한다(§20).
        const fromTop = from.y + sr.top; // 스트립은 세로로 스크롤하지 않는다(§1: 보드가 화면에 맞는다)
        if (
          !laneVisible(fromTop, fromTop + from.h, lrs[from.lane]) ||
          !laneVisible(r.top, r.bottom, lrs[lane])
        )
          continue;

        const ghost = el.cloneNode(true) as HTMLElement;
        // 복제본이 접근성 트리에 뜨면 같은 티켓이 두 개로 읽힌다(§20 접근성).
        ghost.setAttribute("aria-hidden", "true");
        ghost.setAttribute("inert", "");
        Object.assign(ghost.style, {
          position: "absolute",
          margin: "0",
          left: `${to.x}px`,
          top: `${to.y}px`,
          width: `${to.w}px`,
          height: `${to.h}px`,
        });
        host.append(ghost);
        // 원본은 자리를 잡은 채 숨는다 — 도착 순간 리플로우가 없다. 고스트의 끝 상태가
        // `transform: none`이라 마지막 프레임에서 원본과 픽셀이 겹친다(§20).
        el.style.visibility = "hidden";
        const anim = ghost.animate(
          [{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` }, { transform: "none" }],
          { duration: 300, easing: "ease-out" }, // §비주얼 §20. 반복은 WAAPI 기본값(1회)
        );
        // `finish`든 `cancel`이든 즉시 되돌린다 — 뒤에 남는 것이 없다(§20).
        const undo = () => {
          anim.cancel();
          ghost.remove();
          el.style.visibility = "";
        };
        anim.onfinish = undo;
        anim.oncancel = undo;
        stop.push(undo);
      }
    });

    seat.current = { url, at };
    return () => stop.forEach((f) => f());
  });

  // §17 오버레이와 **같은 층 값**이다 — 새 z도 새 포털도 0. 자기 크기를 안 갖고,
  // 밖으로 나간 고스트는 스트립이 잘라 준다.
  return <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 z-10" />;
}

/** 실패 사유는 원문 그대로(§6 에러 3요소) — `ticket-ui.tsx`의 `Failure`와 같은 값이다.
 *  공유 부품으로 뽑을 만큼 무겁지 않다(그 파일 주석과 같은 판단). */
function Failure({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="font-mono text-xs break-all">{message}</span>
      </AlertDescription>
    </Alert>
  );
}

/** 카드를 에픽에 끌어다 놓는다 (DESIGN.md §에픽 결정 8 · §비주얼 §52 ⑤). 사이드바(`epic-sidebar.tsx`)
 *  도 스윔레인 띠(`page.tsx`)도 서버 컴포넌트다 — 새 client 컴포넌트로 뒤집지 않고 **이미 client인
 *  이 파일**이 `window` 레벨 델리게이션으로 두 자리를 같이 받는다(결정 8 "이벤트 위임 자리가
 *  거기 있다"). 과녁은 `[data-epic-drop]`(사이드바 `SidebarMenuItem` · 스윔레인 띠 블록)이고
 *  링은 `[data-epic-ring]`(없으면 과녁 자신)에, 문장은 `[data-epic-line]`에 얹는다.
 *
 *  **`dragenter`/`dragleave` 카운터가 없다.** `dragover`마다 `closest()`로 지금 과녁을 다시
 *  찾고 이전 과녁과 다르면만 갈아 끼운다 — §함정 2(자식 경계마다 뜨는 `dragleave`가 표식을
 *  떨게 하는 것)를 애초에 만들지 않는 길이다. */
export function EpicDrag({ project }: { project: string }) {
  const t = useT();
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    let stem: string | null = null;
    let target: HTMLElement | null = null;
    // 원래 마크업을 되돌릴 값을 들고 있는다(innerHTML — 겨눈 줄의 2행에는 `진행중 n` 배지가
    // 중첩 `<span>`으로 들어 있어 textContent로 되돌리면 그 구조가 납작해진다).
    const saved = new Map<Element, string>();

    const groupLabels = () =>
      document.querySelectorAll<HTMLElement>("[data-epic-group-label]");

    const clearTarget = () => {
      if (!target) return;
      const ring = target.querySelector<HTMLElement>("[data-epic-ring]") ?? target;
      ring.classList.remove("inset-ring-2", "inset-ring-primary");
      const line = target.querySelector<HTMLElement>("[data-epic-line]");
      if (line && saved.has(line)) {
        line.innerHTML = saved.get(line)!;
        saved.delete(line);
      }
      target = null;
    };

    // §함정 3 — `drop`과 `dragend` 둘 다 이걸 부른다. 이미 꺼진 상태에서 다시 불러도 안전하다.
    const finish = () => {
      clearTarget();
      groupLabels().forEach((el) => {
        if (saved.has(el)) {
          el.innerHTML = saved.get(el)!;
          saved.delete(el);
        }
      });
      stem = null;
    };

    const onDragStart = (e: DragEvent) => {
      // `open` 카드만 `draggable="true"`를 든다(결정 8 · page.tsx `renderCard`) — 잠긴 카드는
      // 손을 대도 이 셀렉터에 안 걸려 고스트가 안 뜬다.
      const card = (e.target as Element)?.closest?.('[data-stem][draggable="true"]');
      if (!card) return;
      stem = card.getAttribute("data-stem");
      setFailure(null);
      e.dataTransfer!.effectAllowed = "move"; // §함정 4 — 소스가 링크라 브라우저가 안 정해준다
      groupLabels().forEach((el) => {
        saved.set(el, el.innerHTML);
        el.textContent = t("board.epic.dropPrompt");
      });
    };

    const onDragOver = (e: DragEvent) => {
      if (!stem) return;
      e.preventDefault(); // §함정 1 — 없으면 브라우저가 놓은 것을 열어 화면이 떠난다
      const hit = (e.target as Element)?.closest?.("[data-epic-drop]") as HTMLElement | null;
      if (hit !== target) {
        clearTarget();
        if (hit) {
          const ring = hit.querySelector<HTMLElement>("[data-epic-ring]") ?? hit;
          ring.classList.add("inset-ring-2", "inset-ring-primary");
          const line = hit.querySelector<HTMLElement>("[data-epic-line]");
          if (line) {
            saved.set(line, line.innerHTML);
            line.textContent =
              hit.dataset.epicDrop === "" ? t("board.epic.dropRemove") : t("board.epic.dropOnEpic");
          }
          target = hit;
        }
      }
      e.dataTransfer!.dropEffect = hit ? "move" : "none";
    };

    const onDrop = async (e: DragEvent) => {
      if (!stem) return;
      e.preventDefault();
      const hit = (e.target as Element)?.closest?.("[data-epic-drop]") as HTMLElement | null;
      const dragged = stem;
      finish();
      if (!hit) return;
      const epic = hit.dataset.epicDrop ?? "";
      const r = await setTicketEpic(project, dragged, epic);
      // 실패 갈래 셋(§비주얼 §52 ⑤) — 문구는 화면 어휘, `locked`만 서버의 `LOCKED[state]` 그대로다.
      setFailure(
        r.ok
          ? null
          : r.reason === "locked"
            ? { title: r.error, message: dragged }
            : r.reason === "missing"
              ? {
                  title: "티켓 파일을 찾지 못했습니다 — 큐에서 사라졌거나 상태가 갈렸습니다",
                  message: dragged,
                }
              : { title: "에픽을 옮기지 못했습니다", message: r.error },
      );
    };

    const onDragEnd = () => finish();

    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [project, t]);

  return failure ? <Failure title={failure.title} message={failure.message} /> : null;
}
