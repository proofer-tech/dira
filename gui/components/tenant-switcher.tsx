"use client";

/** 테넌트 셸의 클라이언트 조각 — 전환기(DESIGN.md §0-1 · §4-1) · 내비 · `다시 확인` 버튼.
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
import { tenantPath } from "@/lib/urls";

export type SwitcherTenant = {
  id: string;
  name: string;
  shortRoot: string;
  /** 못 읽은 테넌트는 `null`이다 — 0으로 적지 않는다(읽지 못한 것과 0건은 다른 사실이다). */
  open: number | null;
  running: number;
  connected: boolean;
};

export function TenantSwitcher({
  tenants,
  currentId,
}: {
  tenants: SwitcherTenant[];
  currentId: string;
}) {
  const router = useRouter();
  const pathname = usePathname(); // searchParams가 안 실린다 = 필터·검색을 공짜로 버린다
  const [open, setOpen] = useState(false);
  // 전환은 라우팅이라 지연이 보인다. 스피너 대신 트리거만 먼저 바꾼다(§4-1 전환 중 표시).
  const [going, setGoing] = useState<SwitcherTenant | null>(null);
  const [shown, setShown] = useState(currentId);
  if (shown !== currentId) {
    // 목적지가 도착했거나(전환 완료) 뒤로가기로 딴 데 왔다 — 낙관적 표시를 버린다.
    setShown(currentId);
    setGoing(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = going ?? tenants.find((t) => t.id === currentId);
  if (!current) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="테넌트 전환"
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
          <CommandInput placeholder="테넌트 검색 — 이름 또는 경로" />
          <CommandList className="max-h-80">
            <CommandEmpty>일치하는 테넌트 0건</CommandEmpty>
            {tenants.map((t) => (
              <CommandItem
                key={t.id}
                value={`${t.name} ${t.shortRoot}`}
                className="items-start gap-2 px-2 py-2"
                onSelect={() => {
                  setOpen(false);
                  if (t.id !== currentId) {
                    setGoing(t);
                    router.push(tenantPath(pathname, t.id));
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
            <CommandItem forceMount value="테넌트 관리" onSelect={() => router.push("/")}>
              <Settings2 aria-hidden />
              테넌트 관리
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 내비 — 목적지 4개(§4 화면 진입 구조). 티켓 발행·상세는 보드에서 들어간다.
 *  연결 안 됨 테넌트에서도 링크를 죽이지 않는다: 어느 링크를 눌러도 같은 사유 화면이 나오므로
 *  거짓말이 아니고, `aria-disabled`로 죽은 척하는 것보다 정직하다(§4-1). */
const NAV = [
  { seg: "", label: "보드" },
  { seg: "/workers", label: "워커" },
  { seg: "/personas", label: "페르소나" },
  { seg: "/protocols", label: "프로토콜" },
];

export function TenantNav({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/t/${id}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
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
