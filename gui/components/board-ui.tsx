"use client";

/** 보드(`/p/<project>/`)의 클라이언트 조각 — 검색 · 다중 선택 필터 · 5초 폴링.
 *
 *  **상태는 URL이 담는다**(제약: 클라이언트 상태 라이브러리 없음). 여기 있는 `useState`는 아직
 *  확정되지 않은 입력 글자뿐이고, 확정된 값은 항상 `searchParams`에 있다 — 그래서 필터 결과를
 *  공유하고 새로고침해도 그대로다. 정렬 헤더·필터 해제 링크는 서버가 그린 `<Link>`라 여기 없다.
 *
 *  필터 UI를 `command`로 하는 것은 DESIGN.md §5가 정한 것이다(검색·키보드 이동을 직접 쓰면
 *  수백 줄이고, 전환기가 이미 같은 컴포넌트를 쓴다). */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

export type FilterOption = { value: string; label: string };

/** 다중 선택 하나(kind·persona·상태). 선택값은 `?<param>=a&<param>=b`로 URL에 쌓인다 —
 *  구분자를 쓰지 않는 이유는 kind 값에 무엇이 들어올지 우리가 정하지 않기 때문이다. */
export function BoardFilter({
  param,
  label,
  options,
}: {
  param: string;
  label: string;
  options: FilterOption[];
}) {
  const { qs, replace } = useUrlNav();
  const [open, setOpen] = useState(false);
  const sp = new URLSearchParams(qs);
  const selected = sp.getAll(param);

  const toggle = (value: string) => {
    const next = new URLSearchParams(qs);
    const kept = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    next.delete(param);
    for (const v of kept) next.append(param, v);
    replace(next);
  };

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
