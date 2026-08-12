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
import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
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
  readMultiplayAction,
  readMultitokenAction,
  readTokenRowsAction,
  resetKeymapAction,
  saveTokenAction,
  sendSetupCodeAction,
  setAnalyticsAction,
  setBindingAction,
  setLanguageAction,
  setMultiplayAction,
  setMultitokenAction,
  setTokenEnabledAction,
  setTokenLabelAction,
  startSetupAction,
  pollSetupAction,
  stopSetupAction,
  setActiveTokenAction,
} from "@/app/actions";
import type { OtherEngine, OtherEngineAuth, SetupState, TokenRow, TokenStatus } from "@/lib/auth";
import { useHotkey, useKeymap } from "@/components/keymap-provider";
import { useLocale, useT } from "@/components/language-provider";
import type { Locale } from "@/lib/i18n";
import { DEFAULT_KEYMAP, MODIFIER_KEYS, actionName, formatCombo, type ActionId } from "@/lib/keymap";
import { wrap } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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

/** §0-17 트리 — `claude` + §4-3 카탈로그의 나머지 엔진(`OtherEngine`) + §0-16 다섯째 `language`.
 *  순서가 §45 ③ 트리 그림·검색 인덱스의 순서다. 노드 목록을 여기서 다시 적지 않는다 —
 *  카탈로그(`OtherEngine`)가 늘면 이 유니온도 트리도 저절로 는다. */
/** `multiplay` — §0-18 §자리의 숨은 여섯째 노드. 트리에는 안 선다(사이드바에 항목이 없다),
 *  검색으로만 닿는다. 잠금 밖으로 나온 뒤로는 조건 없이 존재한다(§0-18 §기본값이 된다). */
type SettingsNode = "claude" | OtherEngine | "keymap" | "stats" | "language" | "multiplay";

/** §0-15 §검색 레지스트리 한 줄 — `{트리 경로, 항목 이름, 이동 대상}`. `crumbs`가 빈 문자열이면
 *  결과 줄은 `name` 하나만 그린다(트리 노드 이름 자신 — §45 ⑤ 예시의 `키설정`). `anchor`는
 *  `data-setting="<anchor>"`를 짚는 문자열 하나다(§45 ⑥ §자리). */
type SearchEntry = { node: SettingsNode; crumbs: string; name: string; anchor: string };

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
  const t = useT();
  const locale = useLocale();
  const name = (id: ActionId) => actionName(locale, id);
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
      <h3 data-setting="keymap" className="text-sm font-medium">
        {t("settings.tree.keymap")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("settings.keymap.description")}</p>

      {/* 깨진 파일만 `Alert`다 — 원문 블록이 있는 쪽이 여기고, 줄 단위 거절은 보조 줄이다
          (§비주얼 §22 ③). 조용히 기본값으로 돌아가면 사람은 자기 키가 왜 안 듣는지 모른다 */}
      {keymap.broken && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t("settings.keymap.brokenTitle")}</AlertTitle>
          <AlertDescription className="grid gap-1">
            <span className="font-mono text-xs break-all">{keymap.error}</span>
            <span className="font-mono text-xs break-all">{keymap.path}</span>
            <span>{t("settings.keymap.brokenHint")}</span>
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
              data-setting={a.id}
              className={cn("col-span-4 grid grid-cols-subgrid items-center", !active && "h-9")}
            >
              <span className="min-w-0 truncate text-sm">{name(a.id)}</span>
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
                    {pending ? t("common.saving") : t("settings.keymap.capturePrompt")}
                  </button>
                  {/* 거절은 **보조 줄 그 자리**에 뜬다 — 줄이 하나 더 생기지 않으므로 아래
                      일곱 줄이 안 밀린다. 아이콘이 붙는 이유는 색만으로 뜻을 전하지 않기 위해서다 */}
                  {rejected ? (
                    <p
                      role="alert"
                      className="col-span-4 flex items-center gap-1 pb-1 text-xs text-destructive"
                    >
                      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                      {rejected} {t("settings.keymap.captureRejectedSuffix")} <Kbd>Esc</Kbd>{" "}
                      {t("settings.keymap.captureCancelSuffix")}
                    </p>
                  ) : (
                    <p className="col-span-4 pb-1 text-xs text-muted-foreground">
                      {t("settings.keymap.captureHint")}{" "}
                      <Kbd>Esc</Kbd> {t("settings.keymap.captureCancelSuffix")}
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
                          aria-label={wrap(
                            t("settings.keymap.resetActionPrefix"),
                            name(a.id),
                            t("settings.keymap.resetActionSuffix"),
                          )}
                          className={combo === a.combo ? "invisible" : undefined}
                          disabled={busy}
                          onClick={() => reset(a.id)}
                        >
                          <RotateCcw aria-hidden />
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {t("settings.keymap.resetTooltipPrefix")} {formatCombo(a.combo)}
                      {t("settings.keymap.resetTooltipSuffix")}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setCapturing(a.id)}
                  >
                    {t("settings.keymap.change")}
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
        <div data-setting="keymap.resetAll" className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => reset()}>
            {t("settings.keymap.resetAll")}
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
  const t = useT();

  useEffect(() => {
    void readAnalyticsAction().then(setView);
  }, []);

  return (
    <section className={cn("space-y-2 border-t pt-4 md:border-t-0 md:pt-0", className)}>
      <h3 data-setting="stats" className="text-sm font-medium">
        {t("settings.tree.stats")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("settings.stats.description")}</p>

      {/* 파일을 읽어 오기 전에는 층 둘 다 안 그린다 — 기본값을 먼저 그리면 껐던 사람에게
          `보내는 중입니다`가 한 번 번쩍인다(그 한 줄이 이 섹션의 유일한 사실이다) */}
      {view && (
        <div className="flex items-center justify-between gap-4">
          {/* ① 자격값이 없으면 켜짐/꺼짐과 무관하게 아무것도 안 나간다 — 그렇게 말한다 */}
          <p data-setting="stats.status" className="text-sm">
            {!view.configured
              ? t("settings.stats.notConfigured")
              : view.enabled
                ? t("settings.stats.sending")
                : t("settings.stats.disabled")}
          </p>
          {/* ② 안 보내는 빌드에는 버튼이 없다 — 거기 선 `끄기`는 켜져 있다는 거짓말이다.
              끌 것이 없는 자리에 끄는 버튼을 두지 않는다(위 한 줄이 이미 전부를 말했다) */}
          {view.configured && (
            <Button
              variant="outline"
              size="sm"
              data-setting="stats.toggle"
              disabled={pending}
              onClick={() => start(async () => setView(await setAnalyticsAction(!view.enabled)))}
            >
              {pending ? t("common.saving") : view.enabled ? t("settings.stats.turnOff") : t("settings.stats.turnOn")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** §0-16 §설정 노드 — 다섯째 트리 노드. 항목은 `한국어`/`English` 둘, 하나만 고른다.
 *
 *  **`switch`도 `radio-group`도 설치하지 않는다** — `AnalyticsSection`과 같은 판정이다. 고르는
 *  즉시 반영되는 이유는 값이 머신 설정(파일 하나)이고 루트 레이아웃이 그 값을 읽어
 *  `LanguageProvider`로 내리기 때문이다: `router.refresh()`가 레이아웃을 다시 그리면
 *  `useLocale()`을 쓰는 화면 전부가 새 값을 받는다(§0-6 키설정 저장과 같은 배선). */
function LanguageSection({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (next: Locale) => {
    if (next === locale) return;
    start(async () => {
      await setLanguageAction(next);
      router.refresh();
    });
  };

  return (
    <section className={cn("space-y-2 border-t pt-4 md:border-t-0 md:pt-0", className)}>
      <h3 data-setting="language" className="text-sm font-medium">
        {t("settings.language.label")}
      </h3>
      <div role="radiogroup" aria-label={t("settings.language.label")} className="flex gap-2">
        <Button
          type="button"
          role="radio"
          aria-checked={locale === "ko"}
          variant={locale === "ko" ? "default" : "outline"}
          size="sm"
          disabled={pending}
          data-setting="language.ko"
          onClick={() => choose("ko")}
        >
          {t("settings.language.ko")}
        </Button>
        <Button
          type="button"
          role="radio"
          aria-checked={locale === "en"}
          variant={locale === "en" ? "default" : "outline"}
          size="sm"
          disabled={pending}
          data-setting="language.en"
          onClick={() => choose("en")}
        >
          {t("settings.language.en")}
        </Button>
      </div>
    </section>
  );
}

/** §0-18 §자리 — 숨은 여섯째 노드. 사이드바에 항목이 없다(§0-18 §자리 표) — 이 컴포넌트를
 *  거는 유일한 길은 검색이다. 이제 잠금 밖이라 부르는 쪽이 조건 없이 렌더한다
 *  (§0-18 §기본값이 된다 — 패널은 잠금 밖으로 나온다).
 *
 *  `switch`를 새로 설치하지 않는다 — `AnalyticsSection`과 같은 판정(버튼 하나가 라벨로 상태를
 *  말한다). 값은 다이얼로그가 열릴 때 읽는다 — 같은 이유(다이얼로그를 그리는 자리가 셋).
 *
 *  토글이 둘이다 — `다중계정 허용`(신설, `multitoken` 파일)과 `다중계정 동시사용`(기존
 *  `multiplay`, 무수정). 서로 다른 파일-다른 서버 액션이라 한쪽이 다른 쪽을 막지 않는다. 두
 *  줄이 같은 문구 `허용되어 있습니다`류를 쓰면 어느 쪽인지 이름으로 안 갈리므로 각 줄에
 *  검색 색인과 같은 이름을 그대로 접두로 단다(중복 값 0 — `lib/i18n.ts` §키 규약).
 *
 *  `다중계정 허용`은 부르는 쪽(`SettingsDialog`)의 상태를 받는다 — `claude` 절의 설명·트리거
 *  문구·힌트도 같은 값을 읽어서다(`accountCount`/`onCount`와 같은 벌 — 콜백으로 올려 바로
 *  갱신해야 재시작 없이 같은 화면에서 목록이 갈린다, §0-18 §검증 2). `다중계정 동시사용`은
 *  이 값이 다른 자리에 안 쓰이므로 종전대로 자기 상태를 스스로 든다. */
function MultiplaySection({
  className,
  multiToken,
  onMultiTokenChange,
}: {
  className?: string;
  multiToken: boolean | null;
  onMultiTokenChange: (v: boolean) => void;
}) {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [pendingAllow, startAllow] = useTransition();
  const [pendingEnabled, startEnabled] = useTransition();
  const t = useT();

  useEffect(() => {
    void readMultiplayAction().then(setEnabledState);
  }, []);

  return (
    <section className={cn("space-y-2 border-t pt-4 md:border-t-0 md:pt-0", className)}>
      <h3 data-setting="multiplay" className="text-sm font-medium">
        {t("settings.tree.multiplay")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("settings.multiplay.description")}</p>

      {multiToken !== null && (
        <div data-setting="multiplay.allow" className="flex items-center justify-between gap-4">
          <p className="text-sm">
            <span className="font-medium">{t("settings.search.multitokenToggle")}</span>{" "}
            {multiToken ? t("settings.multitoken.enabled") : t("settings.multitoken.disabled")}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={pendingAllow}
            onClick={() =>
              startAllow(async () => onMultiTokenChange(await setMultitokenAction(!multiToken)))
            }
          >
            {pendingAllow
              ? t("common.saving")
              : multiToken
                ? t("settings.multitoken.turnOff")
                : t("settings.multitoken.turnOn")}
          </Button>
        </div>
      )}

      {enabled !== null && (
        <div data-setting="multiplay.toggle" className="flex items-center justify-between gap-4">
          <p className="text-sm">
            <span className="font-medium">{t("settings.search.multiplayToggle")}</span>{" "}
            {enabled ? t("settings.multiplay.enabled") : t("settings.multiplay.disabled")}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={pendingEnabled}
            onClick={() =>
              startEnabled(async () => setEnabledState(await setMultiplayAction(!enabled)))
            }
          >
            {pendingEnabled
              ? t("common.saving")
              : enabled
                ? t("settings.multiplay.turnOff")
                : t("settings.multiplay.turnOn")}
          </Button>
        </div>
      )}
    </section>
  );
}

/** 행 하나의 상태 배지 — §0-13 §화면의 네 상태. 색·아이콘 레시피는 `status-badge.tsx`와 같은
 *  토큰(`text-status-active`·`text-status-stale`)을 그대로 쓴다(`projects-ui.tsx`도 같은 문자열을
 *  그대로 반복한다 — Tailwind가 클래스명을 정적으로 봐야 해서 이 프로젝트는 상수로 묶지 않는다). */
function TokenStatusBadge({ status }: { status: TokenStatus }) {
  const t = useT();
  switch (status.kind) {
    case "active":
      return (
        <Badge
          variant="outline"
          className="text-status-active bg-status-active/10 border-status-active/30"
        >
          <CirclePlay aria-hidden />
          {t("settings.tokens.active")}
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="secondary">
          <CircleIcon aria-hidden />
          {t("settings.tokens.pending")}
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="outline">
          <Power aria-hidden />
          {t("settings.tokens.disabledBadge")}
        </Badge>
      );
    case "exhausted":
      return (
        <Badge
          variant="outline"
          className="text-status-stale bg-status-stale/10 border-status-stale/30"
        >
          <Clock aria-hidden />
          {t("settings.tokens.exhausted")} · {status.resumesAt}
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
 *  하지 않는다 — `setTokenEnabledAction`·`setActiveTokenAction`이 `lib/auth.ts`의 `writeTokens` 안에서만 한다. */
function TokensSection({
  refreshKey,
  onCount,
  multiToken,
}: {
  refreshKey: string | null;
  /** §0-13 §트리거 문구 — 트리거가 행 수를 알아야 `추가`/`변경`을 가른다. 새 서버 왕복을 안 낸다. */
  onCount?: (n: number) => void;
  /** §0-18 §읽는 쪽 — 부르는 쪽(`SettingsDialog`)이 다이얼로그가 열릴 때 읽어 내린 상태다.
   *  이 컴포넌트가 또 읽지 않는 이유는 §0-18 §패널이 그 값을 바꾸는 자리라서다 — 여기서 따로
   *  읽으면 토글 직후 이 목록만 옛 값에 머문다(§0-18 §검증 2, 재시작 없이 같은 화면에서 갈린다).
   *  `null`(로딩 중)은 잠김 쪽으로 그린다(§0-18 §읽는 쪽 — 누락이 안전한 쪽). */
  multiToken: boolean | null;
}) {
  const t = useT();
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [pending, start] = useTransition();
  // 행 라벨 편집(P180-1, §0-13 §라벨) — 한 번에 한 행만 연다. `editValue`는 `rawLabel`에서
  // 시작한다(표시용 `label`은 `계정 N` 순번이 섞여 있어 그대로 프리필하면 그 문자열이 저장된다).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const apply = (r: TokenRow[]) => {
    setRows(r);
    onCount?.(r.length);
  };

  // `refreshKey`는 부르는 쪽의 `savedAt`이다 — 층 ②·③이 토큰을 저장하면 그 값이 바뀌어 목록을
  // 다시 읽는다("인증하기/토큰추가 시 토큰 목록에 추가됩니다", §0-13 §화면). 새 폴링 루프를
  // 따로 만들지 않는다 — 이미 있는 신호를 의존성으로 빌린다.
  // `multiToken`도 의존성이다 — 서버의 `readTokenRows`가 잠금 여부로 행 자체를 거른다
  // (§0-13 §잠금 계약 ②). 이 값이 없으면 `다중계정 허용`을 켜도 목록이 옛 필터(행 하나)에
  // 머문다(§0-18 §검증 2 — 재시작 없이 같은 화면에서 갈린다).
  useEffect(() => {
    void readTokenRowsAction().then(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, multiToken]);

  const setEnabled = (row: TokenRow, enabled: boolean) =>
    start(async () => apply(await setTokenEnabledAction(row.id, enabled)));
  const remove = (row: TokenRow) => start(async () => apply(await deleteTokenAction(row.id)));
  const use = (row: TokenRow) => start(async () => apply(await setActiveTokenAction(row.id)));
  const saveLabel = (row: TokenRow) =>
    start(async () => {
      apply(await setTokenLabelAction(row.id, editValue));
      setEditingId(null);
    });

  if (rows === null) return null; // 아직 안 읽었다 — 빈 목록과 헷갈리지 않는다
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("settings.tokens.empty")}</p>;
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border p-2"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex min-w-0 items-center gap-2">
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
                    placeholder={t("settings.tokens.labelPlaceholder")}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={pending}>
                    {t("common.save")}
                  </Button>
                </form>
              ) : (
                <>
                  <span className="truncate text-sm font-medium" title={row.label}>
                    {row.label}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={wrap(
                      t("settings.tokens.editLabelPrefix"),
                      row.label,
                      t("settings.tokens.editLabelSuffix"),
                    )}
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
              {row.masked}{" "}
              <span className="font-sans">
                · {row.addedAt} {t("settings.tokens.addedSuffix")}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* `대기` 행에만 붙는다 — `비활성`·`소진`은 각각 `활성화` 버튼(사람 축)과
                §4-9 "지우는 손잡이는 안 만든다"가 이미 막은 자리다(§0-13 §화면 · P179) */}
            {/* §0-13 §잠금 계약 ② — 회전을 전제한 조작(`사용`·`활성화/비활성화`)은 잠김에서
                안 그려진다. 고를 대상이 목록에 하나뿐이라 도달 불가한 상태다. */}
            {multiToken && row.status.kind === "pending" && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => use(row)}>
                {t("settings.tokens.use")}
              </Button>
            )}
            {multiToken && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setEnabled(row, row.status.kind === "disabled")}
              >
                {row.status.kind === "disabled" ? t("settings.tokens.enable") : t("settings.tokens.disable")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={wrap(
                t("settings.tokens.deletePrefix"),
                row.label,
                t("settings.tokens.deleteSuffix"),
              )}
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

/** claude 아닌 엔진 노드 하나 — 사실 둘(CLI 경로 · 자격증명 파일)만 말한다. 판정을 안 내리므로
 *  `TriangleAlert`도 색도 안 쓴다 — claude ⓪처럼 "이게 없으면 워커가 못 뜬다"를 아는 것이
 *  아니라 "찾았다/못 찾았다"만 아는 층이다(§0-4 §개정 `b0966e66`). §0-17로 자기 트리 노드가
 *  됐으므로 머리도 claude와 같은 벌(패널 `h3` · `font-mono`, §비주얼 §45 ③ §벌)이다. */
function OtherEngineSection({ engine, className }: { engine: OtherEngineAuth; className?: string }) {
  const t = useT();
  const cred =
    engine.engine === "agy" ? (
      t("settings.other.agyCred")
    ) : engine.credPath ? (
      <>
        <span className="font-mono text-xs break-all">{engine.credPath}</span> · {engine.credMtime}
      </>
    ) : engine.engine === "codex" ? (
      t("settings.other.codexMissing")
    ) : (
      t("settings.other.grokMissing")
    );
  return (
    <section className={cn("space-y-2 border-t pt-4 md:border-t-0 md:pt-0", className)}>
      <h3 data-setting={engine.engine} className="font-mono text-sm font-medium">
        {engine.engine}
      </h3>
      <p className="text-sm">
        {engine.cli ? (
          <span className="font-mono text-xs break-all">{engine.cli}</span>
        ) : (
          t("settings.other.notInstalled")
        )}
      </p>
      <p className="text-sm text-muted-foreground">{cred}</p>
    </section>
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
   *  라벨이 `인증하기`에서 갈린 것은 자리가 배너에서 종으로 옮겨 가면서다(§0-4 개정).
   *  `text` = 홈 헤더(랜딩 `.btn`, §비주얼 §46 ③ — 아이콘 0개·글자만·`인증 필요` 확장 없음). */
  trigger?: "icon" | "link" | "text";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [label, setLabel] = useState(""); // 층 ③ 라벨 칸(선택, P180-1 · §0-13 §라벨)
  const [result, setResult] = useState<{ savedAt?: string; error?: string }>({});
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  // §0-13 §화면 — 층 ②·③(발급·직접 넣기)을 토큰 목록 자리에 딸린 하나의 자리로 접는다.
  // 닫혀 있다가도 인증이 필요하면 자동으로 펼친다(아래 `onOpenChange` · 폴링 effect의 `savedAt` 판정).
  const [addOpen, setAddOpen] = useState(false);
  // §0-13 §트리거 문구 — 잠김에서 행이 있으면 트리거가 `추가`가 아니라 `변경`이다. 행 수는
  // `TokensSection`만 안다 — `readTokenRowsAction`을 여기서 또 부르지 않고 그 컴포넌트가 이미
  // 읽은 값을 콜백으로 올려 받는다.
  const [accountCount, setAccountCount] = useState<number | null>(null);
  // §0-18 §읽는 쪽 — 동기 `isMultiToken()` 다섯 자리가 갈린 상태. `auth`(서버 `AuthView`) 프롭에
  // 안 얹는 이유는 `readTokenRowsAction` 주석과 같다 — 이 컴포넌트를 그리는 자리가 셋이라 값
  // 하나 때문에 레이아웃 둘·컴포넌트 둘의 프롭이 같이 는다. 다이얼로그가 열릴 때 서버 액션
  // 하나로 여기서 읽고, `TokensSection`·`MultiplaySection`에는 보통 프롭으로 내린다(`accountCount`
  // 콜백과 같은 벌) — 그래야 `다중계정 허용`을 켠 순간 셋 다 재시작 없이 같은 값을 본다
  // (§0-18 §검증 2). `null`(로딩 중)은 잠김 쪽으로 그린다.
  const [multiToken, setMultiToken] = useState<boolean | null>(null);
  // §0-15 트리 선택 — 첫 선택은 항상 `claude`다(§45 ③), 종 CTA로 열려도 같다
  const [activeNode, setActiveNode] = useState<SettingsNode>("claude");
  // 저장 직후엔 서버 프롭이 아직 옛 값이다 — 방금 쓴 것이 이긴다(층 ②·③ 어느 쪽이든)
  const savedAt = setup?.savedAt ?? result.savedAt ?? auth.savedAt;
  // 토큰이 없어도 **claude 워커가 하나도 없으면** 이 컴퓨터는 이 토큰을 안 쓴다 — 안 말한다(§0-4)
  const needsAuth = !savedAt && auth.claudeUsed;
  // §0-16 §설정 노드 — 트리 라벨·검색 인덱스 이름에 쓰는 그 하나의 키
  const t = useT();
  const locale = useLocale();
  const languageLabel = t("settings.language.label");

  // §0-15 §검색 — 항목 열 전부 + 트리 노드 이름 자신(§45 ④). 키설정 8줄은 `DEFAULT_KEYMAP`에서
  // 유도한다(레지스트리에 문자열 복사 0) — 이름을 옮기면 검색도 저절로 따라온다(§0-6).
  const authCrumb = t("settings.tree.authGroup");
  // §0-17 — 이름은 §4-3 카탈로그의 엔진 id 그대로다. 사전 키가 아니다(id는 번역이 없다).
  const claudeCrumb = "claude";
  const keymapCrumb = t("settings.tree.keymap");
  const statsCrumb = t("settings.tree.stats");
  const multiplayCrumb = t("settings.tree.multiplay");
  const searchIndex: SearchEntry[] = [
    { node: "claude", crumbs: authCrumb, name: claudeCrumb, anchor: "claude" },
    {
      node: "claude",
      crumbs: `${authCrumb} › ${claudeCrumb}`,
      name: t("settings.search.claudeCli"),
      anchor: "claude.cli",
    },
    {
      node: "claude",
      crumbs: `${authCrumb} › ${claudeCrumb}`,
      name: t("settings.search.claudeAccounts"),
      anchor: "claude.accounts",
    },
    {
      node: "claude",
      crumbs: `${authCrumb} › ${claudeCrumb}`,
      name: t("settings.search.claudeAdd"),
      anchor: "claude.add",
    },
    // §0-17 — codex·grok·agy는 노드 이름 하나만 인덱스에 싣는다. 엔진별 CLI·자격증명 항목은
    // 인덱스에 안 더한다(§0-17 §검증 6).
    ...auth.otherEngines.map(
      (e): SearchEntry => ({ node: e.engine, crumbs: authCrumb, name: e.engine, anchor: e.engine }),
    ),
    { node: "keymap", crumbs: "", name: keymapCrumb, anchor: "keymap" },
    ...DEFAULT_KEYMAP.map(
      (a): SearchEntry => ({
        node: "keymap",
        crumbs: keymapCrumb,
        name: actionName(locale, a.id),
        anchor: a.id,
      }),
    ),
    {
      node: "keymap",
      crumbs: keymapCrumb,
      name: t("settings.keymap.resetAll"),
      anchor: "keymap.resetAll",
    },
    { node: "stats", crumbs: "", name: statsCrumb, anchor: "stats" },
    {
      node: "stats",
      crumbs: statsCrumb,
      name: t("settings.search.statsStatus"),
      anchor: "stats.status",
    },
    {
      node: "stats",
      crumbs: statsCrumb,
      name: t("settings.search.statsToggle"),
      anchor: "stats.toggle",
    },
    { node: "language", crumbs: "", name: languageLabel, anchor: "language" },
    {
      node: "language",
      crumbs: languageLabel,
      name: t("settings.language.ko"),
      anchor: "language.ko",
    },
    {
      node: "language",
      crumbs: languageLabel,
      name: t("settings.language.en"),
      anchor: "language.en",
    },
    // §0-18 §기본값이 된다 — 패널이 잠금 밖으로 나온 뒤로 이 세 줄은 조건 없이 선다(§검증 5).
    // 노드 자신 + 토글 둘(§0-18 §패널).
    { node: "multiplay" as const, crumbs: "", name: multiplayCrumb, anchor: "multiplay" },
    {
      node: "multiplay" as const,
      crumbs: multiplayCrumb,
      name: t("settings.search.multitokenToggle"),
      anchor: "multiplay.allow",
    },
    {
      node: "multiplay" as const,
      crumbs: multiplayCrumb,
      name: t("settings.search.multiplayToggle"),
      anchor: "multiplay.toggle",
    },
  ];

  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);

  const clearHighlight = () => {
    highlightedRef.current?.classList.remove("rounded-md", "ring-2", "ring-primary");
    highlightedRef.current = null;
  };

  // §45 ⑥ 하이라이트 — 링 하나(밑면 무수정) + 포커스(AT 채널) + 즉시 스크롤. `tabIndex`는
  // 이미 포커스 가능한 요소(버튼 등)를 실수로 짚었을 때 탭 순서를 깨지 않도록 음수일 때만 준다.
  const applyHighlight = (anchor: string) => {
    clearHighlight();
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-setting="${anchor}"]`);
    if (!el) return;
    el.classList.add("rounded-md", "ring-2", "ring-primary");
    if (el.tabIndex < 0) el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
    highlightedRef.current = el;
  };

  // 트리에서 직접 고르는 것 — 검색이 아니라 사람이 다른 노드를 눌렀다(§45 ⑥ 수명 ③)
  const selectNode = (node: SettingsNode) => {
    setActiveNode(node);
    clearHighlight();
  };

  // 결과 선택 — 그 노드로 이동 + 질의를 비워 목록을 닫고(패널이 다시 보인다) + 하이라이트를 건다.
  // `flushSync`로 노드 전환을 먼저 커밋시킨다 — 안 그러면 `md:hidden`이 아직 안 걷힌 섹션을
  // `querySelector`가 짚는다(md+에서 숨은 섹션은 앵커가 있어도 스크롤·포커스가 안 먹는다).
  const selectSearchResult = (entry: SearchEntry) => {
    setQuery("");
    flushSync(() => setActiveNode(entry.node));
    applyHighlight(entry.anchor);
  };

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
  // 돌고 있을 때만 돈다: `running`이 꺼지면 effect가 정리되고 폴링이 멈춘다.
  // 층 ②가 코드 입력 없이 끝나는 길도 여기서 닫는다 — `savedAt`이 폴링으로 늦게 도착하고, 층
  // ③·코드 보내기의 onSubmit(위 `setSetup(s); if (s.savedAt) setAddOpen(false);`)과 같은
  // 자리에서 같은 값 하나로 판정한다(§0-13 §저장이 끝나면).
  useEffect(() => {
    if (!setup?.running) return;
    const id = setInterval(async () => {
      const s = await pollSetupAction();
      setSetup(s);
      if (s.savedAt) setAddOpen(false);
    }, 1000);
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
          // §0-18 §읽는 쪽 — 이 함수 몸통이 직접 쓰는 세 자리(설명·트리거 문구·힌트)의 상태.
          // `TokensSection`은 자기 몫을 자기가 읽는다(위 그 컴포넌트의 effect).
          void readMultitokenAction().then(setMultiToken);
        } else {
          setToken("");
          setLabel("");
          setResult({});
          setCode("");
          setSetup(null);
          setAddOpen(false);
          setQuery("");
          setMultiToken(null);
          clearHighlight(); // §45 ⑥ 수명 ④ — 다이얼로그가 닫히면 하이라이트도 죽는다
          // 닫으면 죽인다 — 살아남은 `setup-token`은 pty를 물고 다음 시도를 막는다(§0-4)
          void stopSetupAction();
        }
      }}
    >
      {/* 인증이 필요하면 **이 버튼이** 말한다 — 배지를 따로 세우지 않는다(§0-4 · §비주얼 §4).
          그때만 아이콘 칸(size-9 정사각)을 풀어 글자를 들인다. 접근가능 이름은 두 경우 다
          `t("settings.dialog.title")`로 같다 */}
      <DialogTrigger
        render={
          trigger === "icon" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("settings.dialog.title")}
              className={needsAuth ? "w-auto gap-1 px-2" : undefined}
            >
              <Settings aria-hidden />
              {needsAuth && (
                <>
                  <TriangleAlert aria-hidden className="text-status-stale" />
                  <span className="text-sm">{t("settings.dialog.needsAuth")}</span>
                </>
              )}
            </Button>
          ) : trigger === "text" ? (
            <button type="button" className="btn">
              {t("settings.dialog.title")}
            </button>
          ) : (
            <button type="button" className="text-sm underline">
              {t("settings.dialog.triggerLink")}
            </button>
          )
        }
      />
      {/* 폭·높이는 §비주얼 §45(요구 `6793ecb7`)가 못박은 값이다 — 패널 내용폭 480 정박에서
          역산된다. `md:overflow-hidden`이 다이얼로그 쪽 스크롤을 닫는다 — md+에서는 패널만
          스크롤한다(아래 SidebarProvider). md 미만은 종전처럼 다이얼로그 하나가 스크롤한다. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto md:overflow-hidden sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle>{t("settings.dialog.title")}</DialogTitle>
          <DialogDescription>{t("settings.dialog.description")}</DialogDescription>
        </DialogHeader>

        {/* 2단 행 하나가 `Command`다(§45 ① §개정 · §0-15 §검색) — 그릇 후보는 이미 설치된
            `command`(§4-1 전환기 선례), 고르는 이유는 키보드(↑↓·Enter·활성 항목 표식이 전부
            등록 항목이다). 덮는 것은 `p-1` 하나 — 나머지 등록 클래스는 이 자리에서 하는 일이
            없다(배경·모서리가 다이얼로그 면과 같은 값이라 안 보인다, §45 ①). `filter`를 안
            준다 — cmdk 기본 필터(대소문자 무시 부분수열)가 §0-15의 하한(부분 일치)을 덮는다.
            `gap-4`가 없다 — 자식이 SidebarProvider 하나다(검색칸이 트리 안으로 옮겨서). */}
        <Command className="min-h-0 min-w-0 p-0">
          {/* 2단 행 자신이다(§45 ① · §34 ①) — `Sidebar`가 `collapsible="none"`에서도
              `useSidebar()`를 무조건 부르므로 Provider가 있어야 한다. `min-h-0`이 Provider 기본
              `min-h-svh`를 덮는다 — 안 덮으면 다이얼로그가 뷰포트 높이만큼 자란다. `min-w-0`은
              그리드 아이템(`DialogContent`가 `grid`)의 `min-width: auto` 함정을 막는다(§3).
              행 상한이 `7.75rem`이다 — 검색칸이 트리로 들어가 행 밖 세로가 144에서 92로 줄었다
              (§45 ②). */}
          <SidebarProvider className="min-h-0 min-w-0 flex-col gap-4 md:h-[32rem] md:max-h-[calc(100dvh-7.75rem)] md:flex-row">
          {/* 왼쪽 열 — 요구 `530f8e2c`가 더하는 요소 하나(§45 ①). 검색칸과 트리가 md+에서 한
              상자(테두리·면·폭)를 나누고 md 미만에서는 그 상자가 안 걸려 검색칸만 남는다(종전
              검색 줄과 같은 모양). `Sidebar`가 지던 상자 클래스가 여기로 옮겨 왔다. */}
          <div className="flex flex-col gap-2 md:w-44 md:shrink-0 md:rounded-lg md:border md:bg-surface md:p-1">
            <CommandInput
              autoFocus
              placeholder={t("settings.search.placeholder")}
              aria-label={t("settings.search.placeholder")}
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                clearHighlight(); // §45 ⑥ 수명 ② — 질의가 갈리거나 비워지면 하이라이트가 죽는다
              }}
              onKeyDown={(e) => {
                // `Esc` 두 번 — 질의가 있으면 질의만 비운다(같은 자리의 캡처 상자 `stopPropagation`과
                // 같은 전제: 안 막으면 Radix가 다이얼로그까지 닫는다, §45 ④).
                if (e.key === "Escape" && query !== "") {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
            {/* md 미만(767 이하)은 트리가 없다 — 종전 모양(섹션 넷 세로 나열 + 단일 스크롤)이
                그대로 서고 검색칸만 산다(§45 ③). `w-full`이 등록 `w-(--sidebar-width)`를 덮고
                `bg-transparent`는 다크에서 필요하다(`--sidebar` 0.205 ≠ `--surface` 0.18, ③). */}
            <Sidebar collapsible="none" className="hidden min-h-0 w-full flex-1 bg-transparent md:flex">
              <SidebarContent className="gap-4 px-1 pb-1">
              <SidebarGroup className="p-0">
                <SidebarGroupLabel className="text-muted-foreground">{authCrumb}</SidebarGroupLabel>
                <SidebarMenu aria-label={authCrumb}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "claude"}
                      aria-current={activeNode === "claude" ? "true" : undefined}
                      onClick={() => selectNode("claude")}
                    >
                      <span className="font-mono">{claudeCrumb}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* §0-17 — 나머지 §4-3 카탈로그 엔진. 목록을 여기서 다시 적지 않는다
                      (`auth.otherEngines`가 이미 그 카탈로그의 유도값이다 — 카탈로그가 늘면
                      이 트리도 는다). */}
                  {auth.otherEngines.map((e) => (
                    <SidebarMenuItem key={e.engine}>
                      <SidebarMenuButton
                        isActive={activeNode === e.engine}
                        aria-current={activeNode === e.engine ? "true" : undefined}
                        onClick={() => selectNode(e.engine)}
                      >
                        <span className="font-mono">{e.engine}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
              {/* 둘째 그룹은 머리가 없다 — `키설정`·`사용 통계`는 최상위 노드 자신이 항목인
                  분류다(§45 ③). 묶는 낱말을 새로 만들지 않는다. */}
              <SidebarGroup className="p-0">
                <SidebarMenu aria-label={t("settings.tree.categoryGroup")}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "keymap"}
                      aria-current={activeNode === "keymap" ? "true" : undefined}
                      onClick={() => selectNode("keymap")}
                    >
                      <span>{keymapCrumb}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "stats"}
                      aria-current={activeNode === "stats" ? "true" : undefined}
                      onClick={() => selectNode("stats")}
                    >
                      <span>{statsCrumb}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* §0-16 다섯째 노드 — 넷과 같은 그릇, 같은 헤더 없는 그룹(§45 ③ 판정 그대로) */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeNode === "language"}
                      aria-current={activeNode === "language" ? "true" : undefined}
                      onClick={() => selectNode("language")}
                    >
                      <span>{languageLabel}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
            </Sidebar>
          </div>

          {/* 패널 — 선택된 노드 하나만 렌더한다(md+). 넷 다 항상 마운트해 두고 `md:hidden`으로
              가린다 — 조건부 마운트는 트리 선택마다 언마운트된 섹션의 데이터를 다시 읽고
              (`TokensSection`·`AnalyticsSection`의 마운트 시 fetch), 입력 중이던 캡처 상자·
              편집 칸의 상태를 날린다. 패딩 0 — 오른쪽 여백은 `DialogContent p-4`가 이미 낸다. */}
          <div ref={panelRef} className="relative min-w-0 flex-1 md:overflow-y-auto">
            {/* §45 ④ 목록 자리 — 패널을 덮는다(md+, 트리는 그대로 보인다) · md 미만은 흐름에 서서
                섹션들을 밀어낸다. 서는 조건은 질의가 비어 있지 않을 때뿐이다. */}
            {query && (
              <CommandList className="max-h-72 bg-popover md:absolute md:inset-0 md:z-10 md:max-h-none">
                <CommandEmpty>{`"${query}"${t("settings.search.emptySuffix")}`}</CommandEmpty>
                {searchIndex.map((entry) => (
                  <CommandItem
                    key={entry.anchor}
                    value={[entry.crumbs, entry.name].filter(Boolean).join(" ")}
                    onSelect={() => selectSearchResult(entry)}
                  >
                    <span className="truncate">
                      {entry.crumbs && (
                        <span className="text-muted-foreground group-data-selected/command-item:text-foreground">
                          {entry.crumbs} ›{" "}
                        </span>
                      )}
                      {entry.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            )}

            <section className={cn("space-y-2", activeNode !== "claude" && "md:hidden")}>
              {/* 제목이 엔진 이름을 말한다 — 이 토큰을 읽는 것은 `TICKET_ENGINE[0]`이 claude인
                  워커뿐이다(`tick.sh:52`). 다른 엔진(Codex 등)은 자체 인증을 쓴다(§0-4).
                  §0-17 — 이름은 카탈로그 id 그대로, 넷 다 같은 벌(`font-mono`)이다. */}
              <h3 data-setting="claude" className="font-mono text-sm font-medium">
                {claudeCrumb}
              </h3>
              <p className="text-xs text-muted-foreground">
                {multiToken
                  ? t("settings.claude.descriptionMulti")
                  : t("settings.claude.descriptionSingle")}
              </p>

              {/* ⓪ 준비물 — 한 줄. 없으면 설치를 대신하지도 바깥으로 링크하지도 않는다(§0-4 ⓪) */}
              {auth.cli ? (
                <p data-setting="claude.cli" className="text-sm">
                  claude CLI —{" "}
                  <span className="font-mono text-xs break-all text-muted-foreground">{auth.cli}</span>
                </p>
              ) : (
                <p data-setting="claude.cli" className="flex items-center gap-2 text-sm">
                  <TriangleAlert aria-hidden className="size-4 shrink-0 text-status-stale" />
                  {t("settings.claude.cliMissing")}
                </p>
              )}

              {/* ① 목록 — 토큰 하나가 아니라 여러 계정을 확인·사용·활성화/비활성화·삭제한다(§0-13 §화면) */}
              <div data-setting="claude.accounts">
                <TokensSection refreshKey={savedAt} onCount={setAccountCount} multiToken={multiToken} />
              </div>

              {/* ②·③(발급·직접 넣기)은 상시 렌더되는 블록이 아니라 이 트리거 하나로 접힌다
                  (§0-13 §화면 — 목록 통합). 로직·문구·에러 처리는 무수정, 렌더 위치만 옮겼다.
                  §0-13 §트리거 문구 — 잠김(!multiToken)에서 행이 있으면 `추가`가 아니라
                  `변경`이다. 해금은 행 수와 무관하게 늘 `추가`(요구 `1681a5d9`). */}
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger render={<Button variant="outline" size="sm" data-setting="claude.add" />}>
                  {!multiToken && accountCount !== null && accountCount > 0
                    ? t("settings.claude.changeTrigger")
                    : t("common.add")}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-96 max-h-[70vh] space-y-4 overflow-y-auto">
                  {/* ② 발급 — CLI에게 터미널을 대신 내어 준다 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <Label>{t("settings.claude.authBrowserLabel")}</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={setup?.running}
                        onClick={() => start(async () => setSetup(await startSetupAction()))}
                      >
                        {setup?.running
                          ? t("settings.claude.authBrowserRunning")
                          : setup
                            ? t("settings.claude.authBrowserRetry")
                            : t("settings.claude.authBrowserStart")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("settings.claude.authBrowserDesc")}</p>

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
                          placeholder={t("settings.claude.codePlaceholder")}
                          autoComplete="off"
                          spellCheck={false}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <Button type="submit" variant="outline" disabled={!code.trim()}>
                          {t("settings.claude.codeSubmit")}
                        </Button>
                      </form>
                    )}

                    {/* 조용히 실패하지 않는다 — 사유 원문 + 다음 행동(§비주얼 §6 에러 3요소).
                        층 ③은 바로 아래 그대로 서 있다: 이 폴백이 제품의 바닥이다(§0-4 천장 항) */}
                    {setup?.error && (
                      <Alert variant="destructive">
                        <TriangleAlert aria-hidden />
                        <AlertTitle>{t("settings.claude.authErrorTitle")}</AlertTitle>
                        <AlertDescription className="grid gap-1">
                          <span>{setup.error}</span>
                          {/* 원인 원문은 위 진행 로그가 이미 그대로 담고 있다 — 여기 문장을
                              `font-mono`로 쓰지 않는다(§비주얼 §3). 다음 행동은 `다시 시도`와 아래
                              층 ③ 둘이다 */}
                          <span>{t("settings.claude.authErrorFallback")}</span>
                        </AlertDescription>
                      </Alert>
                    )}
                    {setup?.savedAt && <p className="text-xs">{t("settings.claude.authSaved")}</p>}
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
                    <Label htmlFor="auth-token">{t("settings.claude.tokenLabel")}</Label>
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
                        {pending ? t("common.saving") : t("common.save")}
                      </Button>
                    </div>
                    {/* 선택 칸 — 형식을 검증하지 않는다(§0-13 §라벨). 비우면 종전대로 `계정 N` */}
                    <Label htmlFor="auth-token-label">{t("settings.claude.tokenLabelOptional")}</Label>
                    <Input
                      id="auth-token-label"
                      placeholder={t("settings.tokens.labelPlaceholder")}
                      autoComplete="off"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {multiToken
                        ? t("settings.claude.tokenHintMulti")
                        : t("settings.claude.tokenHintSingle")}
                    </p>
                    {result.error && <p className="text-xs text-destructive">{result.error}</p>}
                    {/* 삼키지 않는 것이 요건이지 미리 아는 것이 요건이 아니다 — 형식으로 거르지
                        않으므로 "저장했다"까지만 말한다(§0-4) */}
                    {result.savedAt && <p className="text-xs">{t("settings.claude.tokenSaved")}</p>}
                  </form>
                </PopoverContent>
              </Popover>
            </section>

            {/* claude 아닌 나머지 §4-3 카탈로그 엔진 — 각자 자기 트리 노드다(§0-17). 조작·문구는
                한 줄도 안 바뀐다 — 종전에 한 섹션으로 접혀 있던 껍데기가 노드마다 하나씩으로
                갈릴 뿐이다. */}
            {auth.otherEngines.map((e) => (
              <OtherEngineSection
                key={e.engine}
                engine={e}
                className={cn(activeNode !== e.engine && "md:hidden")}
              />
            ))}

            <KeymapSection className={cn(activeNode !== "keymap" && "md:hidden")} />
            <AnalyticsSection className={cn(activeNode !== "stats" && "md:hidden")} />
            <LanguageSection className={cn(activeNode !== "language" && "md:hidden")} />
            {/* §0-18 §자리 — 가리는 클래스가 다섯과 다르다: `hidden`이라 폭과 무관하게 검색으로
                고른 뒤에만 선다(§검증 11 — 767 이하에서도 세로로 쌓이는 섹션에 안 낀다).
                §0-18 §기본값이 된다 — 패널이 잠금 밖으로 나와 조건 없이 렌더한다. */}
            <MultiplaySection
              className={cn(activeNode !== "multiplay" && "hidden")}
              multiToken={multiToken}
              onMultiTokenChange={setMultiToken}
            />
          </div>
          </SidebarProvider>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
