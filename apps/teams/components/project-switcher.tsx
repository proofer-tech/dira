"use client";

/** 셸의 클라이언트 조각 — 브랜드 마크(§14, 두 셸 공용) · 전환기(DESIGN.md §0-1 · §4-1) ·
 *  내비 · `다시 확인` 버튼.
 *
 *  전환기는 헤더 우측 한 자리에 "지금 어느 큐인지"와 "다른 큐로 가는 길"을 겹쳐 둔다. 카운트는
 *  여기서 세지 않는다 — 셸이 서버에서 세서 props로 넘긴다. 내비는 활성 링크 판정에 현재 경로가
 *  필요해서 여기 있다(서버 레이아웃은 pathname을 모른다). */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCommandState } from "cmdk";
import { Check, ChevronDown, ChevronsUpDown, ChevronUp, List, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { useLocale, useT } from "@/components/language-provider";
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
import { ProjectSettingsDialog } from "@/components/projects-ui";
import { parentPath, projectPath, screenOf } from "@/lib/urls";
import {
  markFailuresReadAction,
  markResumeReadAction,
  moveProjectAction,
  trackEvent,
} from "@/app/actions";
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
/** `screen_view` 하나 (DESIGN.md §0-11 이벤트 표). 루트 레이아웃에 한 번 서서 **화면 8종 전부**를
 *  덮는다 — 페이지마다 심으면 enum이 7곳에 흩어지고 한 곳이 조용히 빠진다.
 *
 *  **URL이 아니라 enum 하나가 나간다**(익명 규칙). 접는 것은 `screenOf` 하나고 표 밖의 경로
 *  (404·모르는 길)는 `null`이라 아무것도 안 보낸다.
 *
 *  **서버 컴포넌트에서 못 보낸다**: 보드가 5초마다 `router.refresh()`를 돌아(`BoardPolling`)
 *  렌더마다 보내면 한 사람이 한 화면에 머문 시간이 조회수가 된다. 이 훅은 `screen`이 **바뀔 때만**
 *  돈다 — 폴링은 이 컴포넌트를 언마운트하지 않으므로 refresh로는 안 난다.
 *
 *  **새 파일 대신 여기 둔 이유**는 `BrandMark`와 같다(AGENTS.md §구조). 이 파일이 이미
 *  `usePathname()`을 쓰는 셸의 클라이언트 조각이고, 그리는 것이 없어 번들에 붙는 것은 몇 줄이다. */
export function ScreenView() {
  const screen = screenOf(usePathname());
  useEffect(() => {
    // await하지 않는다 — 통계 왕복이 화면 전환을 못 막는다(§0-11 §어떻게 보내나).
    if (screen) void trackEvent("screen_view", { screen });
  }, [screen]);
  return null;
}

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
        <path d="M2 0H10A2 2 0 0 1 12 2V6H30A2 2 0 0 1 32 8V30A2 2 0 0 1 30 32H2A2 2 0 0 1 0 30V2A2 2 0 0 1 2 0ZM10 10H22A2 2 0 0 1 24 12V14A4 4 0 0 0 24 22V24A2 2 0 0 1 22 26H10A2 2 0 0 1 8 24V22A4 4 0 0 0 8 14V12A2 2 0 0 1 10 10Z" />
      </svg>
    </Link>
  );
}

/** 알림 종 팝오버의 그릇 (§비주얼 §28 ④ `누르면`). 트리거·내용 마크업은 셸(서버 컴포넌트)에
 *  그대로 있고 여기는 `children`으로 받는다 — 여기 있는 것은 **열림 상태 하나**다(§0-10:
 *  종은 새 저장소를 안 만든다 — URL도 전역도 아니다).
 *
 *  **화면을 바꾸는 링크를 누르면 닫는다.** 셸 레이아웃은 이동해도 언마운트되지 않아서, 안 닫으면
 *  448px 상자가 방금 연 상세 위에 그대로 남는다(`46992e91` 실측 ⓑ).
 *
 *  판정이 링크마다가 아니라 이 한 곳인 이유: 규칙이 걸린 대상은 ④의 링크가 아니라 **화면을
 *  바꾸는 링크 전부**고, 이 상자 안에서 그건 `<a>` 하나로 정확히 갈린다 — 남아야 하는 둘
 *  (①의 `토큰 저장` · ③의 `할당 해제`)은 둘 다 `<button>`이다. 링크가 하나 늘어도 따라간다.
 *
 *  포탈 안의 클릭이 이 `div`로 올라오는 것은 React 합성 이벤트가 DOM이 아니라 **React 트리**를
 *  타기 때문이다 — `PopoverContent`는 `Popover.Portal` 안에 있어도 여기의 자식이다.
 *  `contents`라 상자를 만들지 않는다: 헤더 묶음의 `gap-2`가 무수정으로 남는다(§28 ①). */
export function NotificationPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className="contents"
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest("a")) setOpen(false);
        }}
      >
        {children}
      </div>
    </Popover>
  );
}

/** ② `세션이 열리자마자 죽는 워커 <n>개`의 `읽음으로 표시` (§0-5 §읽음 처리 · §비주얼 §28 ⑤).
 *
 *  **지금 나열된 실패를 그대로 넘긴다.** 단위가 워커도 항목도 아니라 실패 하나이고 키가 그
 *  로그 파일명이라(§0-5) 서버에서 다시 세면 렌더와 클릭 사이에 온 **새 실패까지** 묻는다 —
 *  사람이 못 본 사고가 조용히 사라지는 길이다. 프로젝트 루트는 그래도 클라이언트가 안 보낸다:
 *  액션이 `id`로 레지스트리에서 찾는다(신뢰 경계).
 *
 *  **초점을 먼저 옮긴다**(§28 ⑤ 초점). 항목이 걷히면 이 버튼 노드가 사라지고 초점이 `body`로
 *  떨어져 Tab도 `Esc`도 끊긴다 — 걷히기 **전에** 그릇으로 옮겨 두면 순서에 안 걸린다.
 *
 *  ponytail: 결과 표시가 없다. 성공하면 항목이 통째로 사라지는 것이 결과고, 로컬 파일 한 번
 *  쓰기라 실패할 길이 디스크뿐이다. 라벨도 안 바꾼다(§28 ⑤ — 새 문구는 §0-10이 정한다). */
export function MarkFailuresReadButton({
  project,
  failures,
}: {
  project: string;
  failures: { log: string; at: string }[];
}) {
  const [pending, start] = useTransition();
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        e.currentTarget.closest<HTMLElement>('[data-slot="popover-content"]')?.focus();
        start(async () => {
          await markFailuresReadAction(
            project,
            failures.map((f) => ({ log: f.log, at: f.at })),
          );
        });
      }}
    >
      {t("bell.markRead")}
    </Button>
  );
}

/** ⑥ `잠자기·꺼짐에서 복귀`의 `읽음으로 표시` (§0-14 §읽음 처리 · §비주얼 §4-3).
 *  ②의 그 벌 — 행 오른쪽 끝, 초점을 먼저 그릇으로 옮기고, 결과 표시 없이 항목이 사라진다.
 *
 *  **넘기는 것은 `to` 하나다.** 누르는 사이 병합으로 `to`가 자랐으면 표시가 빗나가 항목이
 *  남는다 — 그것이 맞다(새 사실은 다시 봐야 한다, §0-14). */
export function MarkResumeReadButton({ toMs }: { toMs: number }) {
  const [pending, start] = useTransition();
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        e.currentTarget.closest<HTMLElement>('[data-slot="popover-content"]')?.focus();
        start(async () => {
          await markResumeReadAction(toMs);
        });
      }}
    >
      {t("bell.markRead")}
    </Button>
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

/** 항목의 액션 레일 — `/`의 `ProjectRowActions`와 같은 벌(같은 버튼 셋 · 같은 아이콘 · 같은
 *  순서), 자리만 다르다: 그리드 밖 셋째 열, `self-center`(DESIGN.md §비주얼 §4-1 §액션 레일).
 *
 *  **클릭과 `↑` `↓` `Enter` 키다운을 항목으로 안 올린다.** `cmdk`의 선택·키 핸들러가 전부
 *  `Command` 루트 하나의 리스너라(`cmdk`가 `CommandItem`엔 `onClick`, 루트엔 `onKeyDown` 하나만
 *  둔다) 이 그릇 하나에서 막으면 위로 안 올라간다 — `Esc`·`Tab`은 안 막아 그대로 통과한다.
 *
 *  **탭 순서**는 `useCommandState`(cmdk 공개 API)로 지금 선택된 줄의 `value`를 읽어 그 줄만
 *  `tabIndex=0`, 나머지는 `-1`로 둔다 — `Command`를 controlled로 바꾸지 않는다(검색·화살표
 *  이동은 그대로 uncontrolled로 둬 이 개정이 건드리는 표면을 레일 하나로 좁힌다). */
function SwitcherActionRail({
  project,
  value,
  searching,
  first,
  last,
  onOpenSettings,
}: {
  project: SwitcherProject;
  value: string;
  searching: boolean;
  first: boolean;
  last: boolean;
  onOpenSettings: (p: SwitcherProject) => void;
}) {
  const selectedValue = useCommandState((s) => s.value);
  const tabIndex = selectedValue === value ? 0 : -1;
  const [pending, start] = useTransition();
  const move = (dir: -1 | 1) => start(async () => void (await moveProjectAction(project.id, dir)));

  return (
    <div
      className="flex shrink-0 items-center gap-1 self-center"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") e.stopPropagation();
      }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        tabIndex={tabIndex}
        aria-label={`${project.name} 위로`}
        disabled={first || pending || searching}
        onClick={() => move(-1)}
      >
        <ChevronUp aria-hidden className="text-muted-foreground" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        tabIndex={tabIndex}
        aria-label={`${project.name} 아래로`}
        disabled={last || pending || searching}
        onClick={() => move(1)}
      >
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        tabIndex={tabIndex}
        aria-label={`${project.name} 설정`}
        onClick={() => onOpenSettings(project)}
      >
        <Settings2 aria-hidden className="text-muted-foreground" />
      </Button>
    </div>
  );
}

export function ProjectSwitcher({
  projects,
  currentId,
}: {
  projects: SwitcherProject[];
  currentId: string;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
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
  // 레일의 `설정` — 팔레트를 먼저 닫고(§4-1) 그 뒤에 이 다이얼로그를 띄운다. `key={id}`가
  // 대상이 바뀔 때만 상태를 새로 시작시키고(해석 결과 · 이름 입력 · 확인 화면), 같은
  // 대상을 다시 여닫을 때는 인스턴스를 유지해 닫힘 애니메이션이 산다.
  const [settingsProject, setSettingsProject] = useState<SwitcherProject | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 키도 하단 힌트도 **키맵에서 나온다**(§0-6 · §4-1 마지막 줄) — 하드코딩하면 사람이 키를
  // 바꾼 뒤에 화면이 옛 키를 말한다. 기본값 `Mod+k`는 브라우저 기본(검색창 포커스)을 뺏는다.
  const { bindings } = useKeymap();
  useHotkey("project.search", (e) => {
    e.preventDefault();
    setQ("");
    setOpen((v) => !v);
  });

  const current = going ?? projects.find((p) => p.id === currentId);
  if (!current) return null;

  // 닫을 때 검색어를 버린다 — 입력이 팝오버와 함께 언마운트되므로, 안 버리면 다시 열었을 때
  // 안 보이는 검색어로 목록이 걸러진 채 뜬다.
  const close = () => {
    setOpen(false);
    setQ("");
  };

  const openSettings = (p: SwitcherProject) => {
    close();
    setSettingsProject(p);
    setSettingsOpen(true);
  };

  return (
    <>
      <Popover open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              role="combobox"
              aria-expanded={open}
              aria-label={t("shell.switcher.ariaLabel")}
              className="ml-auto h-8 max-w-md gap-2"
            >
              <span className="truncate text-sm text-foreground">{current.name}</span>
              {!current.connected && <StatusBadge status="disconnected" locale={locale} />}
              <span className="truncate font-mono text-xs text-muted-foreground group-aria-expanded/button:text-foreground">
                {current.shortRoot}
              </span>
              <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-[28rem] p-0">
          <Command>
            <CommandInput
              placeholder={t("shell.switcher.searchPlaceholder")}
              value={q}
              onValueChange={setQ}
            />
            <CommandList className="max-h-80">
              <CommandEmpty>
                {q
                  ? `"${q}"${t("shell.switcher.emptyQueriedGlue")} ${t("shell.switcher.emptySuffix")}`
                  : t("shell.switcher.emptySuffix")}
              </CommandEmpty>
              {projects.map((p, i) => {
                const value = `${p.name} ${p.shortRoot}`;
                return (
                  <CommandItem
                    key={p.id}
                    value={value}
                    className="items-start gap-2 px-2 py-2"
                    onSelect={() => {
                      close();
                      if (p.id !== currentId) {
                        setGoing(p);
                        router.push(projectPath(pathname, p.id));
                      }
                    }}
                  >
                    {/* 현재 표식이 없는 항목도 같은 폭을 차지한다 — 정렬이 흔들리면 스캔이 깨진다 */}
                    <span className="w-4 shrink-0 pt-0.5">
                      {p.id === currentId && <Check aria-hidden className="size-4" />}
                    </span>
                    <span className="grid min-w-0 grow gap-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">{p.name}</span>
                        {p.connected ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-data-selected/command-item:text-foreground">
                            {t("shell.switcher.openLabel")} {p.open}
                            {p.running > 0 && ` · running ${p.running}`}
                          </span>
                        ) : (
                          <StatusBadge status="disconnected" className="shrink-0" locale={locale} />
                        )}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground group-data-selected/command-item:text-foreground">
                        {p.shortRoot}
                      </span>
                    </span>
                    <SwitcherActionRail
                      project={p}
                      value={value}
                      searching={q.length > 0}
                      first={i === 0}
                      last={i === projects.length - 1}
                      onOpenSettings={openSettings}
                    />
                  </CommandItem>
                );
              })}
              <CommandSeparator className="my-1" />
              {/* 찾는 큐가 없으면 다음 행동은 등록이다 — 검색으로 걸러지지 않는다 */}
              <CommandItem forceMount value={t("shell.nav.projects")} onSelect={() => router.push("/")}>
                <List aria-hidden className="size-4" />
                {t("shell.nav.projects")}
                <CommandShortcut>{formatCombo(bindings["project.search"])}</CommandShortcut>
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* 팔레트(Popover) 밖이다 — 안에 두면 닫히는 팔레트가 다이얼로그를 같이 걷어 간다(§4-1) */}
      {settingsProject && (
        <ProjectSettingsDialog
          key={settingsProject.id}
          id={settingsProject.id}
          name={settingsProject.name}
          shortRoot={settingsProject.shortRoot}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onUnregistered={() => {
            if (settingsProject.id === currentId) router.push("/");
          }}
        />
      )}
    </>
  );
}

/** 내비 — 목적지 5개(§4 화면 진입 구조). 티켓 발행·상세는 보드에서 들어간다.
 *  연결 안 됨 프로젝트에서도 링크를 죽이지 않는다: 어느 링크를 눌러도 같은 사유 화면이 나오므로
 *  거짓말이 아니고, `aria-disabled`로 죽은 척하는 것보다 정직하다(§4-1).
 *
 *  **홈은 여기 없다 — 문은 헤더 로고 하나다**(요구 `070a7346` · §7 · §비주얼 §4). 항목을
 *  되살리기 전에 §7 뒤집기 항을 읽는다: 종전 근거는 거기 보존돼 있고 요구가 그것을 알고도
 *  로고 하나만 남기라고 했다. 툴팁·라벨로 대신하지도 않는다("그냥 로고 클릭"이 요구다). */
const NAV = [
  { seg: "", labelKey: "shell.nav.board" },
  { seg: "/personas", labelKey: "shell.nav.personas" },
  { seg: "/protocols", labelKey: "shell.nav.protocols" },
  { seg: "/ontology", labelKey: "shell.nav.ontology" },
  { seg: "/workers", labelKey: "shell.nav.workers" },
];

export function ProjectNav({ id }: { id: string }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/p/${id}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";

  // `⌘B`·`⌘E`(§0-6 `nav.board`·`nav.workers`) — 바로 위 두 링크가 하는 일 그대로다. **프로젝트
  // 셸에서만 듣는다**: 이 컴포넌트가 그 셸에만 있어서 `/`(프로젝트 목록)에는 리스너가 아예
  // 안 걸린다(갈 프로젝트가 없다). `preventDefault`는 안 한다 — 이 둘이 뺏을 브라우저 기본이
  // 없다(실측 `6831bfeb`: 크롬 `⌘B`·`⌘E` 둘 다 페이지에 그대로 오고 기본 동작이 없다).
  // **글 쓰는 중 가드는 `useHotkey`가 든다 — 이 둘은 화면을 떠나는 액션이라 `Mod` 조합인데도
  // 안 듣는다**(그래야 참견 칸에 쓰던 글이 `⌘B` 한 번에 안 사라진다). 키 지정 중에는 캡처
  // 상자의 `stopPropagation`이 이벤트를 window까지 안 보낸다(§0-6 `언제 안 듣는가`).
  useHotkey("nav.board", () => router.push(base));
  useHotkey("nav.workers", () => router.push(`${base}/workers`));

  // `Esc`가 부모로 올린다(§0-7). **키맵에 없는 고정 키**라 `useHotkey`를 못 쓴다(그 훅은
  // `ActionId`를 받는다) — 대신 같은 두 가드를 손으로 댄다. 위 `b`·`w`와 같은 이유로
  // 이 컴포넌트가 있는 프로젝트 셸에서만 걸린다.
  // - **bubble 단계**여야 한다: Radix `DismissableLayer`가 capture로 먼저 받아 닫으면서
  //   `preventDefault()`를 부른다 — 열린 것이 있으면 `defaultPrevented`로 알아채고 물러난다.
  //   겹침 목록을 우리가 들지 않는 이유가 이것이다(§0-7 거동).
  // - `isTyping`이면 통과시킨다. 데이터 손실 표면이 여기와 바로 위 두 줄이다(참견·티켓 편집기).
  // `preventDefault`는 안 한다 — `Esc`에 뺏을 브라우저 기본이 없다.
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
      {NAV.map(({ seg, labelKey }) => {
        // 보드는 티켓 화면(발행·상세)·에픽 화면까지 자기 구역으로 본다 — 둘 다 이 화면에서
        // 들어가는 화면이고 상단탭을 안 늘린다(§에픽 §결정 5·6).
        const active =
          seg === ""
            ? rest === "" || rest.startsWith("/tickets") || rest.startsWith("/epics")
            : rest.startsWith(seg);
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
            {t(labelKey)}
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
  const t = useT();
  return (
    <Button variant="outline" size="sm" onClick={() => router.refresh()}>
      {t("shell.error.refresh")}
    </Button>
  );
}
