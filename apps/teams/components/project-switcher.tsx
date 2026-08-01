"use client";

/** 셸의 클라이언트 조각 — 브랜드 마크(§14, 두 셸 공용) · 전환기(DESIGN.md §0-1 · §4-1) ·
 *  내비 · `다시 확인` 버튼.
 *
 *  전환기는 헤더 우측 한 자리에 "지금 어느 큐인지"와 "다른 큐로 가는 길"을 겹쳐 둔다. 카운트는
 *  여기서 세지 않는다 — 셸이 서버에서 세서 props로 넘긴다. 내비는 활성 링크 판정에 현재 경로가
 *  필요해서 여기 있다(서버 레이아웃은 pathname을 모른다). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parentPath, projectPath } from "@/lib/urls";
import { formatCombo } from "@/lib/keymap";
import { isTyping, useHotkey, useKeymap } from "@/components/keymap-provider";

/** 헤더 좌측 브랜드 마크 (§비주얼 §14 `헤더 표시`). **두 셸이 같이 쓴다** — 프로젝트 스코프 셸과
 *  루트 셸에서 값이 전부 같고 다른 건 `href` 하나다(§4: 프로젝트는 `/p/<project>`, 루트는 `/`).
 *
 *  `-m-2`가 32×32 히트 박스를 되돌려 셸의 `px-6`(·`gap-6`)을 무수정으로 둔다.
 *
 *  탭 자산 `app/icon.svg`와 `d`가 문자 단위로 같다. 다른 건 fill 하나 — 화면 안에서는
 *  currentColor다(§14: 브랜드 파랑은 상태색 계열이라 화면에 들이지 않는다). 사본 **2벌**은
 *  의도된 값이고 이 컴포넌트가 그중 화면쪽 한 벌이다 — 셸마다 인라인하면 3벌이 된다.
 *  형상을 고칠 땐 §14 SVG 소스를 고치고 두 벌에 같이 반영한다.
 *
 *  ponytail: 훅이 없는 정적 마크업인데 이 파일의 `"use client"`에 얹혀 클라이언트 번들로 간다.
 *  새 파일을 늘리지 않는 쪽을 택했다(AGENTS.md §구조). 마크업 몇 백 바이트라 재는 값이 아니다. */
export function BrandMark({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="dira"
      className="-m-2 flex size-8 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <svg
        aria-hidden
        viewBox="0 0 32 32"
        fill="currentColor"
        fillRule="evenodd"
        className="size-4"
      >
        <path d="M4.5 2H11.5L15.5 8H27.5A2.5 2.5 0 0 1 30 10.5V27.5A2.5 2.5 0 0 1 27.5 30H4.5A2.5 2.5 0 0 1 2 27.5V4.5A2.5 2.5 0 0 1 4.5 2ZM9.5 12H22.5A1.5 1.5 0 0 1 24 13.5V15A3 3 0 0 0 24 21V22.5A1.5 1.5 0 0 1 22.5 24H9.5A1.5 1.5 0 0 1 8 22.5V21A3 3 0 0 0 8 15V13.5A1.5 1.5 0 0 1 9.5 12Z" />
      </svg>
    </Link>
  );
}

export type SwitcherProject = {
  id: string;
  name: string;
  shortRoot: string;
  /** 못 읽은 프로젝트는 `null`이다 — 0으로 적지 않는다(읽지 못한 것과 0건은 다른 사실이다). */
  open: number | null;
  running: number;
  connected: boolean;
};

export function ProjectSwitcher({
  projects,
  currentId,
}: {
  projects: SwitcherProject[];
  currentId: string;
}) {
  const router = useRouter();
  const pathname = usePathname(); // searchParams가 안 실린다 = 필터·검색을 공짜로 버린다
  const [open, setOpen] = useState(false);
  // 0건 문구가 검색어를 되읽어야 해서(§6) 입력을 여기서 잡는다 — cmdk 내부 상태는 읽을 길이 없다.
  const [q, setQ] = useState("");
  // 전환은 라우팅이라 지연이 보인다. 스피너 대신 트리거만 먼저 바꾼다(§4-1 전환 중 표시).
  const [going, setGoing] = useState<SwitcherProject | null>(null);
  const [shown, setShown] = useState(currentId);
  if (shown !== currentId) {
    // 목적지가 도착했거나(전환 완료) 뒤로가기로 딴 데 왔다 — 낙관적 표시를 버린다.
    setShown(currentId);
    setGoing(null);
  }

  // 키도 하단 힌트도 **키맵에서 나온다**(§0-6 · §4-1 마지막 줄) — 하드코딩하면 사람이 키를
  // 바꾼 뒤에 화면이 옛 키를 말한다. 기본값 `Mod+k`는 브라우저 기본(검색창 포커스)을 뺏는다.
  const { bindings } = useKeymap();
  useHotkey("project.search", (e) => {
    e.preventDefault();
    setQ("");
    setOpen((v) => !v);
  });

  const current = going ?? projects.find((t) => t.id === currentId);
  if (!current) return null;

  // 닫을 때 검색어를 버린다 — 입력이 팝오버와 함께 언마운트되므로, 안 버리면 다시 열었을 때
  // 안 보이는 검색어로 목록이 걸러진 채 뜬다.
  const close = () => {
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="프로젝트 전환"
            className="ml-auto h-8 max-w-md gap-2 data-[popup-open]:bg-muted"
          >
            <span className="truncate text-sm text-foreground">{current.name}</span>
            {!current.connected && <StatusBadge status="disconnected" />}
            <span className="truncate font-mono text-xs text-muted-foreground">
              {current.shortRoot}
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[28rem] p-0">
        <Command>
          <CommandInput
            placeholder="프로젝트 검색 — 이름 또는 경로"
            value={q}
            onValueChange={setQ}
          />
          <CommandList className="max-h-80">
            <CommandEmpty>
              {q ? `"${q}"와 일치하는 프로젝트 0건` : "일치하는 프로젝트 0건"}
            </CommandEmpty>
            {projects.map((t) => (
              <CommandItem
                key={t.id}
                value={`${t.name} ${t.shortRoot}`}
                className="items-start gap-2 px-2 py-2"
                onSelect={() => {
                  close();
                  if (t.id !== currentId) {
                    setGoing(t);
                    router.push(projectPath(pathname, t.id));
                  }
                }}
              >
                {/* 현재 표식이 없는 항목도 같은 폭을 차지한다 — 정렬이 흔들리면 스캔이 깨진다 */}
                <span className="w-4 shrink-0 pt-0.5">
                  {t.id === currentId && <Check aria-hidden className="size-4" />}
                </span>
                <span className="grid min-w-0 grow gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{t.name}</span>
                    {t.connected ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        열림 {t.open}
                        {t.running > 0 && ` · running ${t.running}`}
                      </span>
                    ) : (
                      <StatusBadge status="disconnected" className="shrink-0" />
                    )}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {t.shortRoot}
                  </span>
                </span>
              </CommandItem>
            ))}
            <CommandSeparator className="my-1" />
            {/* 찾는 큐가 없으면 다음 행동은 등록이다 — 검색으로 걸러지지 않는다 */}
            <CommandItem forceMount value="프로젝트 관리" onSelect={() => router.push("/")}>
              <Settings2 aria-hidden />
              프로젝트 관리
              <CommandShortcut>{formatCombo(bindings["project.search"])}</CommandShortcut>
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 내비 — 목적지 4개(§4 화면 진입 구조). 티켓 발행·상세는 보드에서 들어간다.
 *  연결 안 됨 프로젝트에서도 링크를 죽이지 않는다: 어느 링크를 눌러도 같은 사유 화면이 나오므로
 *  거짓말이 아니고, `aria-disabled`로 죽은 척하는 것보다 정직하다(§4-1). */
const NAV = [
  { seg: "", label: "보드" },
  { seg: "/workers", label: "워커" },
  { seg: "/personas", label: "페르소나" },
  { seg: "/protocols", label: "프로토콜" },
];

export function ProjectNav({ id }: { id: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/p/${id}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";

  // `b`·`w`(§0-6 `nav.board`·`nav.workers`) — 바로 위 두 링크가 하는 일 그대로다. **프로젝트
  // 셸에서만 듣는다**: 이 컴포넌트가 그 셸에만 있어서 `/`(프로젝트 목록)에는 리스너가 아예
  // 안 걸린다(갈 프로젝트가 없다). `preventDefault`는 안 한다 — 글쇠 하나에 뺏을 브라우저
  // 기본이 없다. 글 쓰는 중 가드는 `useHotkey`가 들고, 키 지정 중에는 캡처 상자의
  // `stopPropagation`이 이벤트를 window까지 안 보낸다(§0-6 `언제 안 듣는가`).
  useHotkey("nav.board", () => router.push(base));
  useHotkey("nav.workers", () => router.push(`${base}/workers`));

  // `Esc`가 부모로 올린다(§0-7). **키맵에 없는 고정 키**라 `useHotkey`를 못 쓴다(그 훅은
  // `ActionId`를 받는다) — 대신 같은 두 가드를 손으로 댄다. 위 `b`·`w`와 같은 이유로
  // 이 컴포넌트가 있는 프로젝트 셸에서만 걸린다.
  // - **bubble 단계**여야 한다: Radix `DismissableLayer`가 capture로 먼저 받아 닫으면서
  //   `preventDefault()`를 부른다 — 열린 것이 있으면 `defaultPrevented`로 알아채고 물러난다.
  //   겹침 목록을 우리가 들지 않는 이유가 이것이다(§0-7 거동).
  // - `isTyping`이면 통과시킨다. 이 기능의 유일한 데이터 손실 표면이다(참견·티켓 편집기).
  // `preventDefault`는 안 한다 — 글쇠 하나에 뺏을 브라우저 기본이 없다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTyping(e.target)) return;
      const parent = parentPath(pathname);
      if (parent) router.push(parent);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, router]);

  return (
    <nav className="flex items-center gap-4">
      {NAV.map(({ seg, label }) => {
        // 보드는 티켓 화면(발행·상세)까지 자기 구역으로 본다 — 그쪽에서 들어가는 화면이다.
        const active = seg === "" ? rest === "" || rest.startsWith("/tickets") : rest.startsWith(seg);
        return (
          <Link
            key={seg}
            href={`${base}${seg}`}
            className={cn(
              "border-b-2 py-3 text-sm",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 연결 안 됨 화면의 유일한 재확인 경로. 이 화면은 5초 폴링을 하지 않는다 —
 *  없는 경로를 계속 stat하면 클라우드 마운트를 깨운다(§4-1). */
export function RefreshButton() {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" onClick={() => router.refresh()}>
      다시 확인
    </Button>
  );
}
