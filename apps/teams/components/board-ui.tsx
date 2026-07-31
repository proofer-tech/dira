"use client";

/** 보드(`/p/<project>/`)의 클라이언트 조각 — 검색 · 다중 선택 필터 · 5초 폴링.
 *
 *  **상태는 URL이 담는다**(제약: 클라이언트 상태 라이브러리 없음). 여기 있는 `useState`는 아직
 *  확정되지 않은 입력 글자뿐이고, 확정된 값은 항상 `searchParams`에 있다 — 그래서 필터 결과를
 *  공유하고 새로고침해도 그대로다. 정렬 헤더·필터 해제 링크는 서버가 그린 `<Link>`라 여기 없다.
 *
 *  필터 UI를 `command`로 하는 것은 DESIGN.md §5가 정한 것이다(검색·키보드 이동을 직접 쓰면
 *  수백 줄이고, 전환기가 이미 같은 컴포넌트를 쓴다). */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, ListFilter, Search } from "lucide-react";
import { PersonaDot } from "@/components/persona-badge";
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
import { relationPath, type Anchor } from "@/lib/urls";
import type { RelationEdge } from "@/lib/queue";

/** 필터·검색은 히스토리를 남기지 않는다(`replace`) — 글자마다 한 칸씩 쌓이면 뒤로가기로
 *  보드에서 나갈 수 없다. 정렬·필터 해제는 `<Link>`(push)라 뒤로가기가 정상 동작한다. */
function useUrlNav() {
  const router = useRouter();
  const pathname = usePathname();
  // 문자열로 받는다 — 객체 신원으로 비교하면 폴링 리렌더마다 effect가 다시 돈다(디바운스가 안 끝난다).
  const qs = useSearchParams().toString();
  const replace = (next: URLSearchParams) => {
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return { qs, replace };
}

export function BoardSearch() {
  const { qs, replace } = useUrlNav();
  const url = new URLSearchParams(qs).get("q") ?? "";
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

  return (
    <InputGroup className="h-8 max-w-xs">
      <InputGroupAddon>
        <Search aria-hidden className="size-3.5" />
      </InputGroupAddon>
      <InputGroupInput
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
            className="h-8 max-w-52 gap-2 data-[popup-open]:bg-muted"
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
 *            숨은 탭은 아예 건너뛴다 — 배경 탭 열 개가 5초마다 큐를 훑을 이유가 없다. */
export function BoardPolling() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

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
 *     그래서 호버 stem이 effect 안의 지역변수가 아니라 `useState`다(effect가 다시 돌아도 산다).
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
      // §1의 보이는 판정 하나: 그 카드가 자기 레인 스크롤러의 보이는 상자와 겹치는가.
      if (r.bottom <= lr.top || r.top >= lr.bottom) return null;
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
