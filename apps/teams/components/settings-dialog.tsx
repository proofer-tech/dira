"use client";

/** `설정` 다이얼로그 — 두 셸(`/` · `/p/<project>`)이 헤더 **우측 끝**에 같이 갖는 앱 액션
 *  (DESIGN.md §0-4 자리 표 · §비주얼 §4). 라우트가 아니다.
 *
 *  섹션은 **인증 · 키설정 · 사용 통계 셋**이다(§0-4 · §0-6 · §0-11). 그릇 이름이 `인증`이 아니라
 *  `설정`인 이유가 "다음 항목이 올 때 자리를 또 옮기지 않는다"였고 키설정이 그 다음, 사용 통계가
 *  그 다음이다 — 섹션이 하나 늘 뿐 자리도 라우트도 다이얼로그 폭도 안 바뀐다.
 *
 *  인증 층은 셋이다: ①상태 · ②`claude setup-token`을 GUI가 몬다 · ③직접 넣기.
 *  **③은 ②가 된 뒤에도 남는다** — 남의 TUI를 긁는 일이라 깨질 수 있고, 깨지면 여기가 바닥이다.
 *
 *  진입점 둘(헤더 버튼 · 셸 알림 종 ① 항목의 CTA)은 **이 컴포넌트를 두 번 쓴다.** 전역 상태도
 *  URL 파라미터도 만들지 않는다 — 동시에 열릴 수 없고, 상태는 어느 쪽이든 서버가 준 같은
 *  props에서 온다(§0-4). 트리거를 JSX로 받지 않고 두 값 중 하나로 받는 이유는 부르는 쪽이
 *  **서버 컴포넌트**라서다: 넘길 수 있는 것은 값이고, 모양은 두 가지뿐이다. */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CirclePlay,
  Circle as CircleIcon,
  Clock,
  Pencil,
  Power,
  RotateCcw,
  Settings,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  deleteTokenAction,
  readAnalyticsAction,
  readTokenRowsAction,
  resetKeymapAction,
  saveTokenAction,
  sendSetupCodeAction,
  setAnalyticsAction,
  setBindingAction,
  setTokenEnabledAction,
  setTokenLabelAction,
  startSetupAction,
  pollSetupAction,
  stopSetupAction,
  useTokenAction,
} from "@/app/actions";
import type { OtherEngineAuth, SetupState, TokenRow, TokenStatus } from "@/lib/auth";
import { useHotkey, useKeymap } from "@/components/keymap-provider";
import { DEFAULT_KEYMAP, MODIFIER_KEYS, formatCombo } from "@/lib/keymap";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** §0-15 트리 4노드 — 순서가 §45 ③ 트리 그림·검색 인덱스의 순서다. */
type SettingsNode = "claude" | "other" | "keymap" | "stats";

/** 머신당 하나뿐인 Claude 장기 토큰의 자리와 저장 시각. 프로젝트마다 있지 않다(§0-4). */
export type AuthView = {
  path: string;
  savedAt: string | null;
  /** 층 ⓪ 준비물 — `claude` 실행파일을 찾은 절대경로, 없으면 `null`. 판정은 서버의
   *  `findClaude()`고 층 ②가 실제로 모는 값과 같다(§0-4 ⓪). */
  cli: string | null;
  /** claude 엔진 워커가 어딘가에 있는가 — **끄는 쪽에 증거가 필요하다**(§0-4). 등록된 프로젝트를
   *  전부 읽었고 그 전부에서 claude가 0일 때만 `false`고, 그때만 `인증 필요`가 안 뜬다.
   *  못 읽은 프로젝트·프로젝트 0건은 판정 불가라 `true`다. 판정은 부르는 쪽(서버)이 한다. */
  claudeUsed: boolean;
  /** §4-3 카탈로그의 claude 아닌 나머지 — 상태 층뿐이다(§0-4 §개정 `b0966e66`).
   *  claude 블록은 이 필드가 있든 없든 한 줄도 안 갈린다. */
  otherEngines: OtherEngineAuth[];
};

/** §0-6 섹션의 층 셋 — ①목록 ②캡처 ③되돌리기. 값은 전부 `DEFAULT_KEYMAP`·props에서 오고
 *  **이 파일에 키 문자열이 없다**(표기는 `formatCombo` 하나가 그린다). */
function KeymapSection({ className }: { className?: string }) {
  // 루트 레이아웃이 읽어 내린 값이다(§0-6 배선) — 다이얼로그가 열릴 때 이미 손에 있다
  const keymap = useKeymap();
  const router = useRouter();
  // 캡처 중인 줄. `null`이면 목록이다 — 한 번에 하나만 잡는다(§비주얼 §22)
  const [capturing, setCapturing] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = DEFAULT_KEYMAP.filter((a) => keymap.bindings[a.id] !== a.combo);
  const busy = capturing !== null || pending;

  const stop = () => {
    setCapturing(null);
    setRejected(null);
  };
  const reset = (id?: string) =>
    start(async () => {
      await resetKeymapAction(id);
      router.refresh();
    });

  return (
    <section className={cn("space-y-2 border-t pt-4 md:border-t-0 md:pt-0", className)}>
      <h3 className="text-sm font-medium">키설정</h3>
      <p className="text-xs text-muted-foreground">
        단축키입니다. 이 컴퓨터에 하나뿐이고 등록된 프로젝트 전부에 적용됩니다.
      </p>

      {/* 깨진 파일만 `Alert`다 — 원문 블록이 있는 쪽이 여기고, 줄 단위 거절은 보조 줄이다
          (§비주얼 §22 ③). 조용히 기본값으로 돌아가면 사람은 자기 키가 왜 안 듣는지 모른다 */}
      {keymap.broken && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>keymap.json을 읽지 못해 전부 기본값으로 떴습니다</AlertTitle>
          <AlertDescription className="grid gap-1">
            <span className="font-mono text-xs break-all">{keymap.error}</span>
            <span className="font-mono text-xs break-all">{keymap.path}</span>
            <span>여기서 키를 바꾸면 파일을 다시 씁니다.</span>
          </AlertDescription>
        </Alert>
      )}

      {/* 격자는 **목록이 갖고 줄은 빌린다**(§비주얼 §22 ①). 줄마다 `flex ml-auto`로 밀면
          여덟 줄이 서로를 몰라 키가 각자 다른 x에 선다 — `auto` 트랙이 여덟 줄의 최대폭이다 */}
      <ul className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3">
        {DEFAULT_KEYMAP.map((a) => {
          const combo = keymap.bindings[a.id];
          const active = capturing === a.id;
          return (
            <li
              key={a.id}
              className={cn("col-span-4 grid grid-cols-subgrid items-center", !active && "h-9")}
            >
              <span className="min-w-0 truncate text-sm">{a.name}</span>
              {active ? (
                <>
                  {/* `<input>`이 아닌 이유: 캐럿·IME·자동완성이 전부 딸려 오고 그중 무엇도
                      이 상자가 원하는 것이 아니다. 값은 `input.tsx`의 포커스 상태를 빌린 것 */}
                  <button
                    type="button"
                    autoFocus
                    className="col-span-3 h-8 w-full rounded-lg border border-ring px-2.5 text-left text-sm text-muted-foreground ring-3 ring-ring/50 outline-none"
                    onBlur={stop}
                    onKeyDown={(e) => {
                      // **`stopPropagation`이 이 기능의 전제다.** 없으면 `Esc`가 캡처를 끄면서
                      // 다이얼로그까지 닫고, 전역 핸들러(`⌘K` 등)가 지정하려는 키를 같이 먹는다.
                      // `preventDefault`는 `Space`·`Enter`가 버튼 click으로 새는 것을 막는다
                      e.preventDefault();
                      e.stopPropagation();
                      if (pending) return;
                      const ne = e.nativeEvent;
                      if (ne.isComposing) return; // 한글 조합 중의 key는 누른 글자가 아니다
                      if (e.key === "Escape") return stop(); // 취소다. 지정 대상이 아니다
                      // ⌘를 먼저 누르는 사이 거절이 번쩍이지 않는다 — 아직 누르는 중이다
                      if (MODIFIER_KEYS.has(e.key)) return;
                      start(async () => {
                        // 조합 문자열은 **서버가** 만든다(`comboOf`) — 여기서 조립해 보내면
                        // 액션이 받는 것이 임의 문자열이 된다
                        const r = await setBindingAction(a.id, {
                          key: ne.key,
                          metaKey: ne.metaKey,
                          ctrlKey: ne.ctrlKey,
                          altKey: ne.altKey,
                          shiftKey: ne.shiftKey,
                        });
                        if (r.error) return setRejected(r.error);
                        // 큐가 아니라 머신 설정이 바뀌었다 — 다시 그릴 것은 루트 레이아웃이다
                        router.refresh();
                        stop();
                      });
                    }}
                  >
                    {pending ? "저장 중…" : "키를 누르세요"}
                  </button>
                  {/* 거절은 **보조 줄 그 자리**에 뜬다 — 줄이 하나 더 생기지 않으므로 아래
                      일곱 줄이 안 밀린다. 아이콘이 붙는 이유는 색만으로 뜻을 전하지 않기 위해서다 */}
                  {rejected ? (
                    <p
                      role="alert"
                      className="col-span-4 flex items-center gap-1 pb-1 text-xs text-destructive"
                    >
                      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                      {rejected} 다른 키를 누르세요 · <Kbd>Esc</Kbd> 취소
                    </p>
                  ) : (
                    <p className="col-span-4 pb-1 text-xs text-muted-foreground">
                      누른 조합이 그대로 지정됩니다 · 다른 단축키는 그동안 듣지 않습니다 ·{" "}
                      <Kbd>Esc</Kbd> 취소
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Kbd className="justify-self-start">{formatCombo(combo)}</Kbd>
                  {/* 트랙은 **항상 자리를 차지한다**(`invisible`) — `hidden`으로 지우면 폭이
                      0↔28px로 흔들리고, 사람 눈이 정확히 거기 있는 순간 키 열이 미끄러진다 */}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${a.name} 기본값으로 되돌리기`}
                          className={combo === a.combo ? "invisible" : undefined}
                          disabled={busy}
                          onClick={() => reset(a.id)}
                        >
                          <RotateCcw aria-hidden />
                        </Button>
                      }
                    />
                    <TooltipContent>기본값 {formatCombo(a.combo)}(으)로 되돌립니다</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setCapturing(a.id)}
                  >
                    바꾸기
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/* 바꾼 것이 하나라도 있을 때만 뜬다 — 늘 떠 있는 되돌리기는 누를 일이 없는 동안
          층 하나를 차지한다(§비주얼 §22 ③층) */}
      {changed.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => reset()}>
            전부 기본값으로
          </Button>
        </div>
      )}
    </section>
  );
}

/** §0-11 §끄는 자리 — 층은 둘이다: ①지금 보내는지 한 줄 ②끄기/켜기 버튼 하나.
 *
 *  **`switch`도 `checkbox`도 설치하지 않는다**(§비주얼 §5의 이 판정 문단). 켜짐/꺼짐 둘뿐인
 *  상태는 라벨이 바뀌는 버튼 하나가 이미 말한다 — 위 인증 섹션의 버튼들과 같은 벌이다.
 *
 *  값은 **다이얼로그가 열릴 때** 읽는다(닫히면 이 컴포넌트가 unmount된다). 서버 프롭으로 안
 *  내리는 이유는 `readAnalyticsAction`의 주석에 있다. */
function AnalyticsSection({ className }: { className?: string }) {
  const [view, setView] = useState<{ configured: boolean; enabled: boolean } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void readAnalyticsAction().then(setView);
  }, []);

  return (
    <section className={cn("space-y-2 border-t pt-4 md:border-t-0 md:pt-0", className)}>
      <h3 className="text-sm font-medium">사용 통계</h3>
      <p className="text-xs text-muted-foreground">
        몇 벌이 도는지와 어떤 화면 동작이 있었는지만 익명으로 보냅니다. 경로·프로젝트 이름·티켓
        내용은 보내지 않습니다.
      </p>

      {/* 파일을 읽어 오기 전에는 층 둘 다 안 그린다 — 기본값을 먼저 그리면 껐던 사람에게
          `보내는 중입니다`가 한 번 번쩍인다(그 한 줄이 이 섹션의 유일한 사실이다) */}
      {view && (
        <div className="flex items-center justify-between gap-4">
          {/* ① 자격값이 없으면 켜짐/꺼짐과 무관하게 아무것도 안 나간다 — 그렇게 말한다 */}
          <p className="text-sm">
            {!view.configured
              ? "보내지 않습니다 — 이 빌드에 설정이 없습니다"
              : view.enabled
                ? "보내는 중입니다"
                : "보내지 않습니다 — 껐습니다"}
          </p>
          {/* ② 안 보내는 빌드에는 버튼이 없다 — 거기 선 `끄기`는 켜져 있다는 거짓말이다.
              끌 것이 없는 자리에 끄는 버튼을 두지 않는다(위 한 줄이 이미 전부를 말했다) */}
          {view.configured && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => setView(await setAnalyticsAction(!view.enabled)))
              }
            >
              {pending ? "저장 중…" : view.enabled ? "끄기" : "켜기"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** 행 하나의 상태 배지 — §0-13 §화면의 네 상태. 색·아이콘 레시피는 `status-badge.tsx`와 같은
 *  토큰(`text-status-active`·`text-status-stale`)을 그대로 쓴다(`projects-ui.tsx`도 같은 문자열을
 *  그대로 반복한다 — Tailwind가 클래스명을 정적으로 봐야 해서 이 프로젝트는 상수로 묶지 않는다). */
function TokenStatusBadge({ status }: { status: TokenStatus }) {
  switch (status.kind) {
    case "active":
      return (
        <Badge
          variant="outline"
          className="text-status-active bg-status-active/10 border-status-active/30"
        >
          <CirclePlay aria-hidden />
          활성
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="secondary">
          <CircleIcon aria-hidden />
          대기
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="outline">
          <Power aria-hidden />
          비활성
        </Badge>
      );
    case "exhausted":
      return (
        <Badge
          variant="outline"
          className="text-status-stale bg-status-stale/10 border-status-stale/30"
        >
          <Clock aria-hidden />
          소진 · {status.resumesAt}
        </Badge>
      );
  }
}

/** §0-13 §화면 — 인증 섹션의 목록 층. 값은 다이얼로그가 열릴 때 읽는다(`AnalyticsSection`과
 *  같은 이유 — `readTokenRowsAction`의 주석에 있다: 다이얼로그를 그리는 자리가 셋이라 값 하나
 *  때문에 레이아웃 둘·컴포넌트 둘의 프롭이 같이 늘어난다).
 *
 *  `추가`는 새 버튼을 만들지 않는다 — 바로 아래 층 ②·③(발급·직접 넣기)이 이미 그 자리다. 결과가
 *  덮어쓰기가 아니라 append고, **활성은 안 움직인다**(§0-13 §화면, P179) — 새/중복 토큰은 `대기`로
 *  들어간다(eligible한 활성이 없을 때만 예외로 활성이 된다). 지금 쓸 토큰은 `대기` 행의 `사용`
 *  버튼으로 사람이 직접 고른다. 활성화·사용 어느 쪽도 `oauth-token` 쓰기는 이 컴포넌트가 직접
 *  하지 않는다 — `setTokenEnabledAction`·`useTokenAction`이 `lib/auth.ts`의 `writeTokens` 안에서만 한다. */
function TokensSection({ refreshKey }: { refreshKey: string | null }) {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [pending, start] = useTransition();
  // 행 라벨 편집(P180-1, §0-13 §라벨) — 한 번에 한 행만 연다. `editValue`는 `rawLabel`에서
  // 시작한다(표시용 `label`은 `계정 N` 순번이 섞여 있어 그대로 프리필하면 그 문자열이 저장된다).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // `refreshKey`는 부르는 쪽의 `savedAt`이다 — 층 ②·③이 토큰을 저장하면 그 값이 바뀌어 목록을
  // 다시 읽는다("인증하기/토큰추가 시 토큰 목록에 추가됩니다", §0-13 §화면). 새 폴링 루프를
  // 따로 만들지 않는다 — 이미 있는 신호를 의존성으로 빌린다.
  useEffect(() => {
    void readTokenRowsAction().then(setRows);
  }, [refreshKey]);

  const setEnabled = (row: TokenRow, enabled: boolean) =>
    start(async () => setRows(await setTokenEnabledAction(row.id, enabled)));
  const remove = (row: TokenRow) => start(async () => setRows(await deleteTokenAction(row.id)));
  const use = (row: TokenRow) => start(async () => setRows(await useTokenAction(row.id)));
  const saveLabel = (row: TokenRow) =>
    start(async () => {
      setRows(await setTokenLabelAction(row.id, editValue));
      setEditingId(null);
    });

  if (rows === null) return null; // 아직 안 읽었다 — 빈 목록과 헷갈리지 않는다
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">등록된 토큰이 없습니다.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border p-2"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              {editingId === row.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveLabel(row);
                  }}
                >
                  <Input
                    autoFocus
                    className="h-7 w-40 text-sm"
                    placeholder="이메일 등 알아볼 이름"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={pending}>
                    저장
                  </Button>
                </form>
              ) : (
                <>
                  <span className="text-sm font-medium">{row.label}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${row.label} 라벨 편집`}
                    disabled={pending}
                    onClick={() => {
                      setEditingId(row.id);
                      setEditValue(row.rawLabel);
                    }}
                  >
                    <Pencil aria-hidden />
                  </Button>
                </>
              )}
              <TokenStatusBadge status={row.status} />
            </div>
            {/* 가린 값 — 값 전체를 그리지 않는다. `복사` 버튼도 없다(§0-13 §화면) */}
            <p className="font-mono text-xs break-all text-muted-foreground">
              {row.masked} <span className="font-sans">· {row.addedAt} 추가</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* `대기` 행에만 붙는다 — `비활성`·`소진`은 각각 `활성화` 버튼(사람 축)과
                §4-9 "지우는 손잡이는 안 만든다"가 이미 막은 자리다(§0-13 §화면 · P179) */}
            {row.status.kind === "pending" && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => use(row)}>
                사용
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setEnabled(row, row.status.kind === "disabled")}
            >
              {row.status.kind === "disabled" ? "활성화" : "비활성화"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${row.label} 삭제`}
              disabled={pending}
              onClick={() => remove(row)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** claude 아닌 엔진 한 줄 — 사실 둘(CLI 경로 · 자격증명 파일)만 말한다. 판정을 안 내리므로
 *  `TriangleAlert`도 색도 안 쓴다 — claude ⓪처럼 "이게 없으면 워커가 못 뜬다"를 아는 것이
 *  아니라 "찾았다/못 찾았다"만 아는 층이다(§0-4 §개정 `b0966e66`). */
function OtherEngineRow({ engine }: { engine: OtherEngineAuth }) {
  const cred =
    engine.engine === "agy" ? (
      "인증은 macOS 로그인 키체인에 있습니다 — 이 화면이 읽지 않습니다"
    ) : engine.credPath ? (
      <>
        <span className="font-mono text-xs break-all">{engine.credPath}</span> · {engine.credMtime}
      </>
    ) : engine.engine === "codex" ? (
      "발견 못 함 — OPENAI_API_KEY로 도는 워커는 이 판정 밖입니다"
    ) : (
      "발견 못 함 — 터미널에서 grok 로그인이 필요합니다"
    );
  return (
    <div className="space-y-1 border-t pt-2">
      <h4 className="text-xs font-medium text-muted-foreground">{engine.engine}</h4>
      <p className="text-sm">
        {engine.cli ? (
          <span className="font-mono text-xs break-all">{engine.cli}</span>
        ) : (
          "설치되지 않았습니다"
        )}
      </p>
      <p className="text-sm text-muted-foreground">{cred}</p>
    </div>
  );
}

/** 화면에 키를 적는 그릇 하나 — 값은 §비주얼 §21이 박았다(**배경 없음**: `bg-muted`를 깔면
 *  라이트 4.34로 AA 미달). 안에 들어가는 글자는 `formatCombo`가 만든다. */
function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd className={cn("border px-1 font-mono text-xs text-muted-foreground", className)}>
      {children}
    </kbd>
  );
}

export function SettingsDialog({
  auth,
  trigger = "icon",
}: {
  auth: AuthView;
  /** `icon` = 두 셸 헤더 우측 끝. `link` = 셸 알림 종 ① 항목의 `토큰 저장`(§0-10 문구 표 ①).
   *  라벨이 `인증하기`에서 갈린 것은 자리가 배너에서 종으로 옮겨 가면서다(§0-4 개정). */
  trigger?: "icon" | "link";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [label, setLabel] = useState(""); // 층 ③ 라벨 칸(선택, P180-1 · §0-13 §라벨)
  const [result, setResult] = useState<{ savedAt?: string; error?: string }>({});
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  // §0-13 §화면 — 층 ②·③(발급·직접 넣기)을 토큰 목록 자리에 딸린 하나의 자리로 접는다.
  // 닫혀 있다가도 인증이 필요하면 자동으로 펼친다(아래 `onOpenChange` · `setup?.savedAt` effect).
  const [addOpen, setAddOpen] = useState(false);
  // §0-15 트리 선택 — 첫 선택은 항상 `claude`다(§45 ③), 종 CTA로 열려도 같다
  const [activeNode, setActiveNode] = useState<SettingsNode>("claude");
  // 저장 직후엔 서버 프롭이 아직 옛 값이다 — 방금 쓴 것이 이긴다(층 ②·③ 어느 쪽이든)
  const savedAt = setup?.savedAt ?? result.savedAt ?? auth.savedAt;
  // 토큰이 없어도 **claude 워커가 하나도 없으면** 이 컴퓨터는 이 토큰을 안 쓴다 — 안 말한다(§0-4)
  const needsAuth = !savedAt && auth.claudeUsed;

  // `⌘;`(§0-6 `settings.open`) — 두 셸 어디서나 이 다이얼로그를 연다. **`icon` 트리거만 듣는다**:
  // 프로젝트 셸에는 이 컴포넌트가 둘(헤더 버튼 · 알림 종 ① 항목의 CTA)이고 둘 다 들으면 키 한 번에
  // 다이얼로그가 둘 열린다. 헤더 버튼은 두 셸에 항상 하나씩 있고 종 안은 조건부라 이쪽이 기준이다 —
  // 전역 상태도 URL 파라미터도 만들지 않는다는 §0-4의 자리 그대로다.
  // 글 쓰는 중 가드는 `useHotkey`가 들고, 캡처 중에는 위 캡처 상자의 `stopPropagation`이
  // 이벤트를 window까지 안 보낸다 — 이 키도 그래서 안 듣는다(§0-6 `언제 안 듣는가`).
  useHotkey("settings.open", () => {
    if (trigger === "icon") setOpen(true);
  });

  // 진행 로그는 폴링으로 받는다 — 이 앱에 소켓은 없다(세션 스트림과 같은 방식).
  // 돌고 있을 때만 돈다: `running`이 꺼지면 effect가 정리되고 폴링이 멈춘다
  useEffect(() => {
    if (!setup?.running) return;
    const id = setInterval(async () => setSetup(await pollSetupAction()), 1000);
    return () => clearInterval(id);
  }, [setup?.running]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // 토큰이 없어 인증이 필요하면 열자마자 그 경로가 보인다 — 클릭을 더 요구하지 않는다.
          setAddOpen(needsAuth);
          setActiveNode("claude");
        } else {
          setToken("");
          setLabel("");
          setResult({});
          setCode("");
          setSetup(null);
          setAddOpen(false);
          // 닫으면 죽인다 — 살아남은 `setup-token`은 pty를 물고 다음 시도를 막는다(§0-4)
          void stopSetupAction();
        }
      }}
    >
      {/* 인증이 필요하면 **이 버튼이** 말한다 — 배지를 따로 세우지 않는다(§0-4 · §비주얼 §4).
          그때만 아이콘 칸(size-9 정사각)을 풀어 글자를 들인다. 접근가능 이름은 두 경우 다 `설정`이다 */}
      <DialogTrigger
        render={
          trigger === "icon" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="설정"
              className={needsAuth ? "w-auto gap-1 px-2" : undefined}
            >
              <Settings aria-hidden />
              {needsAuth && (
                <>
                  <TriangleAlert aria-hidden className="text-status-stale" />
                  <span className="text-sm">인증 필요</span>
                </>
              )}
            </Button>
          ) : (
            <button type="button" className="text-sm underline">
              토큰 저장
            </button>
          )
        }
      />
      {/* 폭·높이는 §비주얼 §45(요구 `6793ecb7`)가 못박은 값이다 — 패널 내용폭 480 정박에서
          역산된다. `md:overflow-hidden`이 다이얼로그 쪽 스크롤을 닫는다 — md+에서는 패널만
          스크롤한다(아래 SidebarProvider). md 미만은 종전처럼 다이얼로그 하나가 스크롤한다. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto md:overflow-hidden sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
          <DialogDescription>
            이 컴퓨터의 dira 설정입니다. 등록된 프로젝트 전부에 적용됩니다.
          </DialogDescription>
        </DialogHeader>

        {/* 2단 행 자신이다(§45 ① · §34 ①) — `Sidebar`가 `collapsible="none"`에서도
            `useSidebar()`를 무조건 부르므로 Provider가 있어야 한다. `min-h-0`이 Provider 기본
            `min-h-svh`를 덮는다 — 안 덮으면 다이얼로그가 뷰포트 높이만큼 자란다. `min-w-0`은
            그리드 아이템(`DialogContent`가 `grid`)의 `min-width: auto` 함정을 막는다(§3). */}
        <SidebarProvider className="min-h-0 min-w-0 flex-col gap-4 md:h-[32rem] md:max-h-[calc(100dvh-11rem)] md:flex-row">
          {/* md 미만(767 이하)은 트리가 없다 — 종전 모양(섹션 넷 세로 나열 + 단일 스크롤)이
              그대로 서고 검색 줄만 산다(§45 ③). */}
          <Sidebar collapsible="none" className="hidden w-44 shrink-0 rounded-lg border bg-surface md:flex">
            <SidebarContent className="gap-4 px-2 py-2">
              <SidebarGroup className="p-0">
                <SidebarGroupLabel className="text-muted-foreground">인증</SidebarGroupLabel>
                <SidebarMenu aria-label="인증">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "claude"}
                      aria-current={activeNode === "claude" ? "true" : undefined}
                      onClick={() => setActiveNode("claude")}
                    >
                      <span>Claude 계정</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "other"}
                      aria-current={activeNode === "other" ? "true" : undefined}
                      onClick={() => setActiveNode("other")}
                    >
                      <span>기타 엔진</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
              {/* 둘째 그룹은 머리가 없다 — `키설정`·`사용 통계`는 최상위 노드 자신이 항목인
                  분류다(§45 ③). 묶는 낱말을 새로 만들지 않는다. */}
              <SidebarGroup className="p-0">
                <SidebarMenu aria-label="설정 분류">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "keymap"}
                      aria-current={activeNode === "keymap" ? "true" : undefined}
                      onClick={() => setActiveNode("keymap")}
                    >
                      <span>키설정</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "stats"}
                      aria-current={activeNode === "stats" ? "true" : undefined}
                      onClick={() => setActiveNode("stats")}
                    >
                      <span>사용 통계</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          {/* 패널 — 선택된 노드 하나만 렌더한다(md+). 넷 다 항상 마운트해 두고 `md:hidden`으로
              가린다 — 조건부 마운트는 트리 선택마다 언마운트된 섹션의 데이터를 다시 읽고
              (`TokensSection`·`AnalyticsSection`의 마운트 시 fetch), 입력 중이던 캡처 상자·
              편집 칸의 상태를 날린다. 패딩 0 — 오른쪽 여백은 `DialogContent p-4`가 이미 낸다. */}
          <div className="relative min-w-0 flex-1 md:overflow-y-auto">
            <section className={cn("space-y-2", activeNode !== "claude" && "md:hidden")}>
              {/* 제목이 엔진 이름을 말한다 — 이 토큰을 읽는 것은 `TICKET_ENGINE[0]`이 claude인
                  워커뿐이다(`tick.sh:52`). 다른 엔진(Codex 등)은 자체 인증을 쓴다(§0-4) */}
              <h3 className="text-sm font-medium">Claude 인증</h3>
              <p className="text-xs text-muted-foreground">
                워커가 Claude에 붙을 때 쓰는 장기 토큰 목록입니다. 이 컴퓨터에 하나뿐이고, 계정
                여러 개를 두면 리밋을 만난 쪽 대신 다음 계정으로 돌아갑니다.
              </p>

              {/* ⓪ 준비물 — 한 줄. 없으면 설치를 대신하지도 바깥으로 링크하지도 않는다(§0-4 ⓪) */}
              {auth.cli ? (
                <p className="text-sm">
                  claude CLI —{" "}
                  <span className="font-mono text-xs break-all text-muted-foreground">{auth.cli}</span>
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm">
                  <TriangleAlert aria-hidden className="size-4 shrink-0 text-status-stale" />
                  claude CLI를 찾지 못했습니다 — 워커가 세션을 띄우지 못합니다
                </p>
              )}

              {/* ① 목록 — 토큰 하나가 아니라 여러 계정을 확인·사용·활성화/비활성화·삭제한다(§0-13 §화면) */}
              <TokensSection refreshKey={savedAt} />

              {/* ②·③(발급·직접 넣기)은 상시 렌더되는 블록이 아니라 이 트리거 하나로 접힌다
                  (§0-13 §화면 — 목록 통합). 로직·문구·에러 처리는 무수정, 렌더 위치만 옮겼다. */}
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger render={<Button variant="outline" size="sm" />}>추가</PopoverTrigger>
                <PopoverContent align="start" className="w-96 max-h-[70vh] space-y-4 overflow-y-auto">
                  {/* ② 발급 — CLI에게 터미널을 대신 내어 준다 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <Label>브라우저로 인증</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={setup?.running}
                        onClick={() => start(async () => setSetup(await startSetupAction()))}
                      >
                        {setup?.running ? "진행 중…" : setup ? "다시 시도" : "브라우저로 인증하기"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      claude setup-token을 대신 실행합니다. 새 탭에서 승인한 뒤 받은 코드를 여기에
                      붙여 넣으면 토큰이 제자리에 저장됩니다.
                    </p>

                    {setup && setup.lines.length > 0 && (
                      // 원문 그대로 흘리면 `Opening[12Gbrowser[20Gto`가 뜬다 — 서버가 escape를 걷어낸
                      // 뒤 사람이 읽을 줄만 넘긴다(§0-4)
                      <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2">
                        {setup.lines.map((l, i) => (
                          <p key={i} className="font-mono text-xs break-all text-muted-foreground">
                            {l}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* CLI가 코드를 기다린다(실측: `Paste code here if prompted`). 이 입력이 그
                        통로다 — 프롬프트 문구로 감지하지 않는다: 남의 TUI 문구는 바뀌고, 안 쓰면
                        그만인 칸이다 */}
                    {setup?.running && (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          start(async () => {
                            const s = await sendSetupCodeAction(code);
                            setSetup(s);
                            setCode("");
                            if (s.savedAt) setAddOpen(false);
                          });
                        }}
                      >
                        <Input
                          className="font-mono"
                          placeholder="브라우저에서 받은 코드"
                          autoComplete="off"
                          spellCheck={false}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <Button type="submit" variant="outline" disabled={!code.trim()}>
                          코드 보내기
                        </Button>
                      </form>
                    )}

                    {/* 조용히 실패하지 않는다 — 사유 원문 + 다음 행동(§비주얼 §6 에러 3요소).
                        층 ③은 바로 아래 그대로 서 있다: 이 폴백이 제품의 바닥이다(§0-4 천장 항) */}
                    {setup?.error && (
                      <Alert variant="destructive">
                        <TriangleAlert aria-hidden />
                        <AlertTitle>토큰을 받지 못했습니다</AlertTitle>
                        <AlertDescription className="grid gap-1">
                          <span>{setup.error}</span>
                          {/* 원인 원문은 위 진행 로그가 이미 그대로 담고 있다 — 여기 문장을
                              `font-mono`로 쓰지 않는다(§비주얼 §3). 다음 행동은 `다시 시도`와 아래
                              층 ③ 둘이다 */}
                          <span>&quot;직접 넣기&quot;에 이미 발급받은 토큰을 붙여 넣어도 됩니다.</span>
                        </AlertDescription>
                      </Alert>
                    )}
                    {setup?.savedAt && <p className="text-xs">토큰을 받아 저장했습니다.</p>}
                  </div>

                  {/* ③ 직접 넣기 */}
                  <form
                    className="space-y-2 border-t pt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      start(async () => {
                        const r = await saveTokenAction(token, label);
                        setResult(r);
                        if (r.savedAt) {
                          setToken("");
                          setLabel("");
                          setAddOpen(false);
                        }
                      });
                    }}
                  >
                    <Label htmlFor="auth-token">토큰</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="auth-token"
                        className="font-mono"
                        placeholder="sk-ant-oat…"
                        autoComplete="off"
                        spellCheck={false}
                        value={token}
                        onChange={(e) => {
                          setToken(e.target.value);
                          setResult({});
                        }}
                      />
                      <Button type="submit" disabled={pending}>
                        {pending ? "저장 중…" : "저장"}
                      </Button>
                    </div>
                    {/* 선택 칸 — 형식을 검증하지 않는다(§0-13 §라벨). 비우면 종전대로 `계정 N` */}
                    <Label htmlFor="auth-token-label">라벨(선택)</Label>
                    <Input
                      id="auth-token-label"
                      placeholder="이메일 등 알아볼 이름"
                      autoComplete="off"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      이미 발급받은 토큰이 있으면 여기에 붙여 넣습니다. 목록에 대기로 추가됩니다 —
                      지금 쓸 토큰은 목록에서 &quot;사용&quot;으로 고릅니다.
                    </p>
                    {result.error && <p className="text-xs text-destructive">{result.error}</p>}
                    {/* 삼키지 않는 것이 요건이지 미리 아는 것이 요건이 아니다 — 형식으로 거르지
                        않으므로 "저장했다"까지만 말한다(§0-4) */}
                    {result.savedAt && (
                      <p className="text-xs">저장했습니다. 유효한지는 다음 디스패치에서 드러납니다.</p>
                    )}
                  </form>
                </PopoverContent>
              </Popover>
            </section>

            {/* claude 아닌 나머지 §4-3 카탈로그 엔진 — 자기 트리 노드를 갖는다(§0-15 §트리).
                조작·문구는 한 줄도 안 바뀐다 — 섹션 껍데기만 갈린다. */}
            <section
              className={cn(
                "space-y-2 border-t pt-4 md:border-t-0 md:pt-0",
                activeNode !== "other" && "md:hidden",
              )}
            >
              {auth.otherEngines.map((e) => (
                <OtherEngineRow key={e.engine} engine={e} />
              ))}
            </section>

            <KeymapSection className={cn(activeNode !== "keymap" && "md:hidden")} />
            <AnalyticsSection className={cn(activeNode !== "stats" && "md:hidden")} />
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
