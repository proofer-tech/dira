"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "@/components/link";
import Typed from "typed.js";
import { Pause, Play, TriangleAlert } from "lucide-react";
import { registerProject, type CreateState, type RegisterState } from "@/app/actions";
import { ConfigTable, CreateDialog, CreateForm } from "@/components/projects-ui";
import { CopyCommand } from "@/components/copy-command";
import { PickPath } from "@/components/path-picker";
import { SettingsDialog, type AuthView } from "@/components/settings-dialog";
import { LanguageToggle } from "@/components/language-toggle";
import { useT } from "@/components/language-provider";
import { wrap } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/urls";

import "./fonts.css";
// `landing.css`는 `globals.css` 머리의 분할 `@import`가 `landing` 레이어로 싣는다
// (§비주얼 §46 ①) — 여기서 또 물면 레이어 밖에 중복으로 실려 그 처방이 무효가 된다.

// `.vitepress/theme/Landing.vue`를 옮긴 것이다(§사이트 기반 §갈아 끼우는 것). 텍스트 노드는
// 0자 갈렸다 — 판정이 `check-landing-prose.py`다. 갈린 것은 그릇뿐이다:
// `ref` → `useState` · `onMounted`/`onUnmounted` → `useEffect` · `:href`/`{{ }}`/`v-if` → JSX.
// 초기 버전은 서버 컴포넌트(`page.tsx`)가 빌드 시점 `version.ts`에서 읽어 내려준다 —
// 이 파일이 `node:fs`를 못 읽는 것이 종전 `useData()` 갈래와 갈리는 유일한 자리다.

declare global {
  interface Window {
    ChannelIO?: ((...args: unknown[]) => void) & { q?: unknown[][]; c?: (a: unknown[]) => void };
  }
}

export default function Landing({
  version: initialVersion,
  fullMode,
  empty,
  registryError,
  auth,
  home,
  children,
}: {
  version: string;
  /** 풀 모드(= 랜딩-only가 아님) — 헤더 버튼 셋 갈림·절 셋 걷힘의 유일한 판정 지점이다
   *  (§한 코드베이스 §홈 표 · `lib/flags.ts`의 `isLandingOnly` 반대값. `page.tsx`가 계산해 내린다). */
  fullMode: boolean;
  /** 프로젝트 0건인가 — 풀 모드에서만 쓰인다(§0 규칙이 자리만 옮겨 그대로 · §비주얼 §46 ⑤). */
  empty: boolean;
  /** 레지스트리를 못 읽었을 때. GUI가 고쳐 쓰려 들지 않는다 — 원문 + 여는 명령이다(§7 그대로). */
  registryError?: { message: string; openCmd: string } | null;
  /** 헤더 `설정`이 쓴다(§0-4). 랜딩-only에서는 안 읽으므로 `null`이다. */
  auth?: AuthView | null;
  /** 경로 피커·생성 폼이 `~`로 친 값을 펴는 데만 쓴다. */
  home?: string;
  /** 프로젝트 목록 표(§한 코드베이스 §홈). 풀 모드에서 `<main>`의 첫 블록 `#projects`
   *  슬롯에 뜬다(§비주얼 §47, P199-10). */
  children?: React.ReactNode;
}) {
  const t = useT();
  // 초기값은 빌드 시점의 `apps/desktop/package.json`. 비우면 hydration이 어긋난다.
  const [version, setVersion] = useState(initialVersion);
  // 초기값 = 실패값. SSR·fetch 실패·`.dmg` 없음 셋 다 지금 동작(릴리스 페이지)으로 떨어진다.
  const [dmg, setDmg] = useState("https://github.com/proofer-tech/dira/releases/latest");
  // 빈 문자열 = 개수를 못 읽은 상태. SSR HTML에도 클라이언트 첫 렌더에도 개수 칸이 없다.
  const [stars, setStars] = useState("");
  // 플랜 카드 순환의 정지 손잡이(§P237 자리 ⑥). SSR·초기값은 "돈다" — `.cycling`이
  // 안 붙는 한(아래 useEffect, JS 죽음·reduce) 순환 자체가 안 생기니 안전하다.
  const [planStopped, setPlanStopped] = useState(false);

  // ── 목록 자리(`#projects`)의 상태 — 헤더 `새로 만들기`와 히어로 온보딩이 결과 슬롯을
  //    공유한다(§7 CreateForm 계약: "성공하면 결과는 목록 아래 결과 슬롯으로 올라간다" —
  //    어느 그릇으로 만들었느냐와 무관하게 자리가 하나다). 걷힌 `<ProjectsSection>`의 그
  //    조각을 자리만 옮겨 그대로 잇는다(§비주얼 §46 ⑤).
  const [creating, setCreating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerRoot, setRegisterRoot] = useState("");
  const [made, setMade] = useState<CreateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const showResult = !!made?.done && !dismissed;

  const openRegister = (root: string) => {
    setRegisterRoot(root);
    setRegistering(true);
  };
  const handleCreated = (s: CreateState) => {
    setMade(s);
    setDismissed(false);
  };

  // 등록 다이얼로그 — 헤더에 자기 버튼이 없다(§홈 — `프로젝트 등록`은 안 올린다). 열리는 길은
  // 둘뿐이다: 0건 온보딩의 "이미 만들어 둔 .dira가 있다면 등록합니다." 줄 · `CreateForm`이
  // `.dira`가 이미 큐로 있음을 만났을 때의 "등록으로" 되돌림(`openRegister`). 폼 자체는
  // 걷힌 `<ProjectsSection>`의 그 폼을 자리만 옮긴 것이다(§7).
  const [registerPending, startRegister] = useTransition();
  const [registerState, setRegisterState] = useState<RegisterState>({});
  const [registerName, setRegisterName] = useState("");
  const registerSlug = slugify(registerName);
  const registerShowId =
    (registerName.trim() !== "" && registerSlug === "") || !!registerState.needId;
  const registerErr = registerState.error;
  const registerForm = (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startRegister(async () => {
          const r = await registerProject({}, f);
          setRegisterState(r);
          if (r.done) {
            handleCreated({ done: r.done });
            setRegistering(false);
            setRegisterName("");
            setRegisterRoot("");
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="home-register-name">{t("landing.register.nameLabel")}</Label>
        <Input
          id="home-register-name"
          name="name"
          placeholder={t("landing.register.namePlaceholder")}
          value={registerName}
          onChange={(e) => setRegisterName(e.target.value)}
        />
        {registerErr?.code === "name" && (
          <p className="text-xs text-destructive">{registerErr.message}</p>
        )}
      </div>
      {registerShowId && (
        <div className="space-y-2">
          <Label htmlFor="home-register-id">{t("landing.register.idLabel")}</Label>
          <Input id="home-register-id" name="id" className="font-mono" placeholder="dira" />
          <p className="text-xs text-muted-foreground">
            {registerErr &&
            (registerErr.code === "needId" || registerErr.code === "badId" || registerErr.code === "dupId")
              ? registerErr.message
              : t("landing.register.idHint")}
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="home-register-root">{t("landing.register.rootLabel")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="home-register-root"
            name="root"
            className="font-mono"
            placeholder="~/Projects/myproject/.dira"
            value={registerRoot}
            onChange={(e) => setRegisterRoot(e.target.value)}
          />
          {/* 고르는 것은 `.dira` 자신이다(디렉터리) — dotfile이라 main이 `showHiddenFiles`를 켠다 */}
          <PickPath mode="directory" label={t("landing.register.rootPickerLabel")} onPick={setRegisterRoot} />
        </div>
        <p className="text-xs text-muted-foreground">{t("landing.register.rootHint")}</p>
      </div>
      {registerErr &&
        (registerErr.code === "root" || registerErr.code === "dupRoot" || registerErr.code === "unknown") && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t("landing.register.errorTitle")}</AlertTitle>
            <AlertDescription className="grid gap-2">
              <span className="break-all">{registerErr.message}</span>
              {registerErr.dup && (
                <Link href={`/p/${registerErr.dup.id}`}>
                  {wrap(
                    t("landing.register.dupOpenPrefix"),
                    registerErr.dup.name,
                    t("landing.register.dupOpenSuffix"),
                  )}
                </Link>
              )}
            </AlertDescription>
          </Alert>
        )}
      <div className="flex justify-end">
        <Button type="submit" disabled={registerPending}>
          {registerPending ? t("landing.register.pendingLabel") : t("landing.register.title")}
        </Button>
      </div>
    </form>
  );

  // 생성·등록 성공 결과 — 걷힌 `<ProjectsSection>`과 같은 표(§7). `created`가 있으면 만든
  // 파일 수·엔진 레포·crontab 등록 여부 세 줄이 표 위에 더 붙는다(생성만의 정보).
  const view = made?.done;
  const createdInfo = made?.created;
  const resultCard = view && (
    <Card className="max-w-3xl gap-3 p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">
          {createdInfo ? t("landing.result.createdLabel") : t("landing.result.registeredLabel")} — {view.project.name}{" "}
          <span className="font-mono text-xs text-muted-foreground">{view.project.shortRoot}</span>
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link href={`/p/${view.project.id}`} />}>
            {t("landing.result.openBoardLabel")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            {t("common.close")}
          </Button>
        </div>
      </div>
      {createdInfo && (
        <div className="space-y-1 text-sm">
          <p>
            {t("landing.result.filesWrittenPrefix")} {createdInfo.written}
            {t("landing.result.filesWrittenSuffix")}
            {createdInfo.skipped.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                {t("landing.result.skippedPrefix")}{" "}
                <span className="font-mono text-xs">{createdInfo.skipped.join(" ")}</span>
              </span>
            )}
          </p>
          <p className="text-muted-foreground">
            {t("landing.result.engineRepoLabel")} <span className="font-mono text-xs">{createdInfo.repo}</span>
          </p>
          {createdInfo.cron ? (
            <p>{t("landing.result.cronRegistered")}</p>
          ) : (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>{t("landing.result.cronFailedTitle")}</AlertTitle>
              <AlertDescription className="grid gap-2">
                <span className="break-all">{createdInfo.cronError}</span>
                <CopyCommand cmd={createdInfo.registerCmd} />
              </AlertDescription>
            </Alert>
          )}
          {createdInfo.ontologyError && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>{t("landing.result.ontologyFailedTitle")}</AlertTitle>
              <AlertDescription className="grid gap-2">
                <span className="break-all">{createdInfo.ontologyError}</span>
                <Link href={`/p/${view.project.id}/ontology`} className="underline">
                  {t("landing.result.ontologyFailedLink")}
                </Link>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
      <ConfigTable view={view} />
    </Card>
  );

  useEffect(() => {
    // 히어로 h1 타이핑(DESIGN §랜딩 §인트로 오버레이 폐기 §자리 ②). 마운트에서 바로 시작 —
    // 기다릴 사건이 없다(예전엔 인트로 오버레이가 걷히는 `gone` 사건을 기다렸다). reduce·JS
    // 죽음이면 켜지지 않고 정지 문장이 HTML에 그대로 남는다.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const h1 = document.querySelector<HTMLHeadingElement>(".hero h1");
    if (!h1) return;
    // 완성 문장이 390에서만 두 줄이라 타이핑 중 짧은 문자열이 한 줄로 접혀 아래 전부가
    // 튄다 — 최종 높이(정지 텍스트 기준)로 고정하고 끝나면 지운다.
    const text = h1.textContent ?? "";
    h1.style.minHeight = `${h1.offsetHeight}px`;
    // typed.js는 그릇에 이미 있는 글자를 "이미 친 문자열"로 재활용해 smartBackspace로
    // 한 글자만 건드리고 끝낸다(같은 문자열끼리는 그 최적화가 통째로 스킵돼 버린다) —
    // 16자를 한 자씩 치는 모션이 서려면 여기서 비우고 넘겨야 한다.
    h1.textContent = "";
    const typed = new Typed(h1, {
      strings: [text],
      typeSpeed: 26,
      startDelay: 0,
      showCursor: false,
      onComplete: () => { h1.style.minHeight = ""; },
    });
    return () => typed.destroy();
  }, []);

  useEffect(() => {
    // 스크롤 진입 등장(DESIGN §랜딩 §모션 §판정표 ⑥). JS로 움직이므로 전역
    // 킬 스위치 밖이다 — matchMedia를 직접 보고 reduce면 무장을 아예 안 한다.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        },
        { rootMargin: "0px 0px -10% 0px" },
      );
      for (const el of document.querySelectorAll(".reveal")) {
        // 이미 그려진 글이 깜빡였다 다시 나타나는 것을 막는다 — 첫 화면은 무장하지 않는다.
        if (el.getBoundingClientRect().top >= window.innerHeight) {
          el.classList.add("armed");
          io.observe(el);
        }
      }
      // 플랜 카드 순환(§P237 자리 ⑥). `.cycling`이 없으면 `::before`의 content가 아예
      // 없다 — 이 줄이 안 도는 것(JS 죽음·reduce)이 곧 정지 수단이 필요없는 상태다.
      document.querySelector(".plan-sec")?.classList.add("cycling");
    }
    // 여행하는 티켓의 레인(DESIGN §랜딩 §개편 §움직이는 티켓). 절 마크업에 표식을 안 심는다 —
    // 관측 대상은 <main> 직계 블록 중 `.travel`·`#projects`를 뺀 나머지(`.wrap`)이고, 첫
    // 블록(`.hero`)이 레인 0 · 마지막 둘이 레인 2 · 그 사이가 레인 1이다. `#projects`는
    // 슬롯이라 셈에서 뺀다 — 안 빼면 프로젝트 수에 따라 `.hero` 상단이 관측 띠(뷰포트
    // 중앙 10%) 위로 올라가 `scrollY=0`에서 레인 0이 조용히 안 뜨는 경우가 생긴다(§비주얼
    // §47 실측). `.armed`와 같은 배치다 — JS가 죽으면 data-lane이 없고 카드는 레인 0에
    // 그냥 떠 있다. reduce에서도 레인은 그대로 간다: 이름이 갈리는 것은 모션이 아니라
    // 내용이고, 미끄러지는 420ms만 킬 스위치의 `transition-duration: 0s !important`가 지운다.
    const travel = document.querySelector<HTMLElement>(".travel");
    if (travel) {
      const blocks = [
        ...document.querySelectorAll("main > .wrap:not(.travel):not(#projects), main > .stage"),
      ];
      const inband = new Set<Element>();
      const io2 = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            e.isIntersecting ? inband.add(e.target) : inband.delete(e.target);
          // <main>을 지나면(닫는 절·footer) 띠가 빈다 — 그때는 마지막 레인을 그대로 둔다.
          if (!inband.size) return;
          // 띠 안에 둘 이상이면 아래쪽이 이긴다 — 스크롤이 빨라도 레인이 뒤로 안 샌다.
          const i = Math.max(...[...inband].map((b) => blocks.indexOf(b)));
          const next = i === 0 ? "0" : i < blocks.length - 2 ? "1" : "2";
          travel.dataset.lane = next;
        },
        { rootMargin: "-45% 0px -45% 0px" },
      );
      for (const b of blocks) io2.observe(b);
    }
    (async () => {
      try {
        // 위젯이 부르던 바로 그 URL이다(DESIGN §별 버튼을 우리 버튼으로 §고르는 것 ②).
        // 못 읽으면 stars가 빈 채로 남아 개수 칸이 아예 안 뜬다 — 콘솔에도 아무것도 안 띄운다.
        const repo = await (
          await fetch("https://api.github.com/repos/proofer-tech/dira")
        ).json();
        if (typeof repo.stargazers_count === "number")
          setStars(repo.stargazers_count.toLocaleString("en-US"));
      } catch {}
      try {
        const r = await fetch(
          "https://api.github.com/repos/proofer-tech/dira/releases/latest",
        );
        const rel = await r.json();
        if (rel.tag_name) setVersion(rel.tag_name.replace(/^v/, ""));
        // 자산은 셋인데 `.dmg`는 하나다. `download`/`target`은 안 붙인다 — 받아지게 하는 것은
        // GitHub이 자산 응답에 붙이는 Content-Disposition: attachment다(DESIGN §남는 규칙 ①②).
        const asset = rel.assets?.find((a: { name: string }) => a.name.endsWith(".dmg"));
        if (asset) setDmg(asset.browser_download_url);
      } catch {
        // 릴리스를 못 읽으면 초기값 그대로 둔다 — 화면에도 콘솔에도 아무것도 안 띄운다.
      }
    })();
    // 상담 위젯(DESIGN §랜딩 §채널톡 상담 위젯 §자리·값). 공식 설치 스니펫 그대로다 —
    // 큐 shim을 세우고 async <script>를 붙인다. npm 래퍼(`react-channel-plugin`)는 이 열 줄을
    // React 훅으로 감싼 것뿐이라 얻는 것이 0이다(§실측 ④).
    if (!window.ChannelIO) {
      const ch = (...args: unknown[]) => ch.c!(args);
      ch.q = [] as unknown[][];
      ch.c = (args: unknown[]) => ch.q!.push(args);
      window.ChannelIO = ch;
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://cdn.channel.io/plugin/ch-plugin-web.js";
      document.head.appendChild(s);
    }
    // 플러그인 키는 공개값이다 — proofer 클라이언트 번들에도 그대로 있다(§실측 ⑤).
    // 지금 이 채널은 도메인이 안 떠 있어 boot이 401이고 런처가 안 뜬다(§답이 왔다, 답변 `2b829e22`).
    window.ChannelIO("boot", {
      pluginKey: "22e3f817-68e9-4717-a399-f2d78154abea",
      language: "ko",
    });
    // 랜딩을 떠나도 문서가 다시 안 뜬다 — 걷지 않으면 요구가 지목하지 않은 매뉴얼 26장 위에
    // 런처가 남는다(§자리·값). 그래서 `랜딩페이지에`를 참으로 만드는 것이 이 줄이다.
    return () => window.ChannelIO?.("shutdown");
  }, []);

  return (
    <div className="dira-landing">

{/* ① 릴리스 배너 — 풀 모드에서 안 뜬다(§한 코드베이스 §홈 표). 파는 절이라서다. */}
{!fullMode && (
<div className="ann">
  <div className="wrap">
    <span>{t("landing.banner.text").replace("{count}", version)}</span>
    <a href="https://github.com/proofer-tech/dira/releases">{t("landing.banner.releasesLink")}</a>
  </div>
</div>
)}

<header>
  <div className="wrap">
    <a className="brand" href="/" aria-label="dira">
      <svg viewBox="0 0 32 32" fillRule="evenodd" aria-hidden="true"><path d="M2 0H10A2 2 0 0 1 12 2V6H30A2 2 0 0 1 32 8V30A2 2 0 0 1 30 32H2A2 2 0 0 1 0 30V2A2 2 0 0 1 2 0ZM10 10H22A2 2 0 0 1 24 12V14A4 4 0 0 0 24 22V24A2 2 0 0 1 22 26H10A2 2 0 0 1 8 24V22A4 4 0 0 0 8 14V12A2 2 0 0 1 10 10Z"/></svg>
      dira
    </a>
    <nav>
      {/* ② 640 이하에서 `매뉴얼`을 걷는다 — 이 페이지에서 회수된다(footer §문서 열.
          §비주얼 §46 ③). `btn-manual`은 풀 모드에서만 붙는다 — 랜딩-only 헤더(넷 이하)는
          이 접힘 규칙 밖이다. */}
      <a className={fullMode ? "btn btn-manual" : "btn"} href="/docs/">{t("landing.nav.manualLink")}</a>
      <a className="btn star"
         href="https://github.com/proofer-tech/dira" target="_blank" rel="noopener"
         aria-label="Star proofer-tech/dira on GitHub">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>
        Star
        {stars && <span className="star-count" aria-hidden="true">{stars}</span>}
      </a>
      {/* ② 헤더 `앱 다운로드` → `새로 만들기`·`설정` 둘로 갈린다(§한 코드베이스 §홈 표 ·
          §비주얼 §46 ③). `프로젝트 관리`는 목적지가 자기가 떠 있는 페이지의 꼭대기라 안
          올린다(`/#projects`는 이미 이 페이지에 열려 있다) — §홈 §자기 자신을 가리키던 버튼.
          0건이면 `새로 만들기`가 빠져 primary가 0개다. */}
      {fullMode ? (
        <>
          {!empty && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t("landing.nav.createLabel")}
            </button>
          )}
          {auth && <SettingsDialog auth={auth} trigger="text" />}
        </>
      ) : (
        <>
          <a className="btn btn-primary" href={dmg}>{t("landing.nav.downloadAppLabel")}</a>
          <LanguageToggle />
        </>
      )}
    </nav>
  </div>
</header>

<main>

{/* 여행하는 티켓 한 장(DESIGN §랜딩 §개편 §움직이는 티켓). 페이지가 파는 것을 페이지가
    수행한다 — 이 제품에서 레인을 건너는 것은 애니메이션이 아니라 `rename` 한 번이다
    (코어 §큐의 불변식 1). 실리는 글자는 전부 제품이 쓰는 식별자이고 산문 노드가 0개다.
    장식이라 aria-hidden이다(§남는 규칙 ②). 절마다 새 카드를 만들지 않는다 — 이 한 장이
    <main> 안에서 sticky로 붙어 페이지를 끝까지 따라간다. */}
<div className="travel wrap" aria-hidden="true">
  <div className="lanes">
    <span className="tk"><span className="tk-hash">a1b2c3d4</span><span className="tk-name"><i>.md</i><i>.wip.md</i><i>.done.md</i></span></span>
  </div>
</div>

{/* 목록·온보딩·오류 슬롯 — 풀 모드에서 `<main>`의 첫 블록이다(§한 코드베이스 §홈 ⓪,
    §비주얼 §47). `id="projects"`가 그 슬롯이다 — 표가 아니라 **자리**를 가리킨다
    (0건에서는 목록이 아니라 온보딩 폼이, 오류에서는 배너가 그 자리에 뜬다). 랜딩-only에는
    이 블록 자체가 없다. */}
{fullMode && (
  <div id="projects" className="wrap">
    {registryError ? (
      <Alert variant="destructive" className="max-w-3xl">
        <TriangleAlert aria-hidden />
        <AlertTitle>{t("landing.projects.registryErrorTitle")}</AlertTitle>
        <AlertDescription className="grid gap-2">
          <span className="font-mono text-xs break-all">{registryError.message}</span>
          <CopyCommand cmd={registryError.openCmd} />
        </AlertDescription>
      </Alert>
    ) : (
      <>
        {empty && !showResult && (
          <div className="max-w-3xl space-y-2">
            <h2 className="text-lg font-semibold">dira</h2>
            <p className="text-sm text-muted-foreground">
              {t("landing.projects.emptyHint")}
            </p>
          </div>
        )}
        {children}
        {showResult ? (
          resultCard
        ) : (
          empty && (
            <>
              <div className="mt-6 flex max-w-3xl items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {t("landing.projects.registerHint")}
                </p>
                <Button variant="outline" size="sm" onClick={() => setRegistering(true)}>
                  {t("landing.register.title")}
                </Button>
              </div>
              <Card className="mt-4 max-w-3xl gap-4 p-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-medium">{t("landing.projects.newProjectTitle")}</h2>
                  <p className="text-xs text-muted-foreground">{t("project.create.blurb")}</p>
                </div>
                <CreateForm home={home ?? ""} onCreated={handleCreated} onRegister={openRegister} />
              </Card>
            </>
          )
        )}
      </>
    )}
  </div>
)}

<div className="hero wrap">
  <p className="eyebrow">{t("landing.hero.eyebrow")}</p>
  <h1>{t("landing.hero.title")}</h1>
  <p className="body">
    {t("landing.hero.body")}
  </p>
  {/* 랜딩-only에서만 뜬다 — 풀 모드는 이 자리가 걷혀 아무것도 안 들어온다(§한 코드베이스
      §홈 표 ③, 걷힌 근거는 목록이 이제 위 `#projects`로 나가서다). */}
  {!fullMode && (
    <>
      <div className="cta">
        <a className="btn btn-primary btn-lg" href={dmg}>{t("landing.hero.downloadCta")}</a>
        <a className="btn btn-lg" href="/docs/install">{t("landing.nav.installGuide")}</a>
      </div>
      <p className="cta-note">with Claude Code · Codex</p>
    </>
  )}

  <figure>
    <img className="shot" src="/shots/board.gif" alt={t("landing.hero.shotAlt")} width="1600" height="1000"/>
    <figcaption>{t("landing.hero.shotCaption")}</figcaption>
  </figure>
</div>

{/* SECTION A 한 무대(로드맵 §P237-5, 값은 §P237-1 판정표 자리 ④). 세 절을 그릇 하나가
    감싸 901px 이상 + `animation-timeline: view()` 지원 브라우저에서만 sticky 크로스페이드가
    뜬다 — `landing.css`의 `@supports`가 거짓이면 이 그릇은 그냥 빈 껍데기라 세 절이
    지금처럼 세로로 쌓인다. 노드는 하나도 안 늘거나 줄지 않았다. 첫 패널(§자리 ④ 확장,
    `e0701973`)이 무대에 합류해 지나는 장면이 둘 → 셋이 됐다 — 절은 안 합쳐지고 `<h2>`
    셋이 그대로 뜬다. */}
<div className="stage">
<section className="wrap reveal">
  <h2>{t("landing.steps.title")}</h2>
  <ol className="steps">
    <li>
      <span className="sig">.md</span>
      <b>{t("landing.steps.step1Title")}</b>
      <p>{t("landing.steps.step1Body")}</p>
    </li>
    <li>
      <span className="sig">.wip</span>
      <b>{t("landing.steps.step2Title")}</b>
      <p>{t("landing.steps.step2Body")}</p>
    </li>
    <li>
      <span className="sig">.done</span>
      <b>{t("landing.steps.step3Title")}</b>
      <p>{t("landing.steps.step3Body")}</p>
    </li>
  </ol>
</section>
{/* 아카이빙·온톨로지 — `.done` 다음 이야기라 30초 설명 바로 뒤에 뜬다(로드맵 §P228 §랜딩).
    번호가 없는 것은 §한 코드베이스 §홈 표에 안 실려서다 — 두 모드 다 뜬다. 새 CSS 0. */}
<section className="wrap reveal">
  <h2>{t("landing.archiving.title")}</h2>
  <ul className="marks">
    <li><b>{t("landing.archiving.item1BoldPrefix")} <code>.done</code>{t("landing.archiving.item1BoldSuffix")}</b>{" "}
    {t("landing.archiving.item1Prefix")} <code>{t("boardPage.archive.inProgress")}</code> {t("landing.archiving.item1Suffix")}</li>
    <li><b>{t("landing.archiving.item2Bold")}</b> {t("landing.archiving.item2Prefix")}{" "}
    <code>.dira/ontology/</code>{t("landing.archiving.item2Mid")}{" "}
    <code>## 아카이브</code> {t("landing.archiving.item2Suffix")}</li>
    <li><b>{t("landing.archiving.item3Bold")}</b> {t("landing.archiving.item3Body")}</li>
    <li><b>{t("landing.archiving.item4Bold")}</b> <code>{t("landing.archiving.item4Wikilink")}</code>{t("landing.archiving.item4Body")}</li>
  </ul>
  {/* ④ 「일을 할수록 더 능숙해지는」 — 기전을 이 절이 이미 다 말해서 약속 한 줄만 붙는다
      (로드맵 §P229, 사람 답 `14cd1aad`가 §P228의 비교 금지 한 축을 뒤집었다).
      `.body`는 margin 0이라 위 목록에 붙는다 — `.marks`·`.arrows`와 같은 24px를 인라인으로
      준다(새 CSS 규칙 0). */}
  <p className="body" style={{ marginTop: 24 }}>{t("landing.archiving.promiseBody")}</p>
  {/* 그림 — 목록 첫 항목이 말하는 그 한 줄이 실제로 뜨는 자리(로드맵 §P235-1). 자리가 `.arrows`
      바로 앞인 것은 아래 절과 같은 규칙이다: 절은 언제나 나가는 링크로 끝난다.
      `.gallery` 밖이라 `figure`는 margin 0이다 — 위 `.body`와 **같은 인라인 24**를 준다
      (새 CSS 규칙 0). `.zoom`은 갤러리 셋과 같은 부품이다(§랜딩 §갤러리 ③ — 라이트박스 0). */}
  <figure style={{ marginTop: 24 }}>
    <a className="zoom" href="/shots/10-archiving.png" target="_blank" rel="noopener" title={t("landing.gallery.openOriginal")}><img className="shot" src="/shots/10-archiving.png" loading="lazy" alt={t("landing.archiving.shotAlt")} width="1664" height="664"/></a>
    <figcaption>{t("landing.archiving.shotCaption")}</figcaption>
  </figure>
  <p className="arrows"><a href="/docs/ontology">{t("landing.archiving.arrowLink")}</a></p>
</section>

{/* 「오로지 내 PC에」 — 앞 절이 «기록이 프로젝트 폴더에 남는다»로 끝나서, 그 파일이 어디에도
    안 간다는 이야기가 여기서 이어진다(로드맵 §P229 §랜딩). 모델 호출은 감추지 않고 한 마디로
    적는다 — 셋째 항목이 그 자리다. 두 모드 다 뜬다. 새 CSS 0. */}
<section className="wrap reveal">
  <h2>{t("landing.noAccount.title")}</h2>
  <ul className="marks">
    <li><b>{t("landing.noAccount.item1Bold")}</b> {t("landing.noAccount.item1Body")}</li>
    <li><b>{t("landing.noAccount.item2Bold")}</b> {t("landing.noAccount.item2Prefix")}{" "}
    <code>&lt;{t("landing.noAccount.projectPlaceholder")}&gt;/.dira</code> {t("landing.noAccount.item2Suffix")}</li>
    <li><b>{t("landing.noAccount.item3Bold")}</b> {t("landing.noAccount.item3Body")}</li>
    <li><b>{t("landing.noAccount.item4Bold")}</b> {t("landing.noAccount.item4Prefix")}{" "}
    <code>~/.config/dira/analytics.json</code> {t("landing.noAccount.item4Suffix")}</li>
  </ul>
  {/* 그림 — 새로 찍지 않는다. `08-onboarding`이 §매뉴얼 §스크린샷이 정해 둔 «프로젝트 0건일
      때의 `/`»고 그것이 설치 후 첫 화면이다(로드맵 §P235-1). alt는 `docs/first-ticket.md:14`가
      이미 쓰던 문장에서 이 절이 가리키는 것만 남겼다. 자리·간격은 위 절과 같다. */}
  <figure style={{ marginTop: 24 }}>
    <a className="zoom" href="/shots/08-onboarding.png" target="_blank" rel="noopener" title={t("landing.gallery.openOriginal")}><img className="shot" src="/shots/08-onboarding.png" loading="lazy" alt={t("landing.noAccount.shotAlt")} width="1600" height="700"/></a>
    <figcaption>{t("landing.noAccount.shotCaption")}</figcaption>
  </figure>
  <p className="arrows"><a href="/docs/analytics">{t("landing.noAccount.arrowLink")}</a></p>
</section>
</div>

<div className="wrap stats reveal">
  {/* `stats-list`는 §모션 §판정표 ①이 격자 그릇을 대상에서 빼는 자리다 — 텍스트는 0자 안 갈렸다. */}
  <ul className="stats-list">
    <li><b>0</b><span>{t("landing.stats.dependenciesLabel")}<br/>{t("landing.stats.dependenciesValue")}</span></li>
    <li><b>8</b><span>{t("landing.stats.concurrentWorkersLabel")}</span></li>
    <li><b>1775</b><span>{t("landing.stats.ticketsLabel")}<br/>{t("landing.stats.ticketsValue")}</span></li>
    <li><b>{t("landing.stats.hoursBig")}</b><span>{t("landing.stats.hoursLabel")}<br/>{t("landing.stats.hoursCommitsValue")}</span></li>
  </ul>
  <p className="stats-note">{t("landing.stats.note")}</p>
</div>

{/* `no-hi`는 §모션 §판정표 ④가 하이라인을 안 긋는 예외다(`.stats + section`이 이미
    border-top을 0으로 죽인 절과 같다) — 텍스트는 0자 안 갈렸다. */}
<section className="wrap reveal no-hi">
  <div className="gallery">
    <figure>
      <a className="zoom" href="/shots/barge.gif" target="_blank" rel="noopener" title={t("landing.gallery.openOriginal")}><img className="shot" src="/shots/barge.gif" loading="lazy" alt={t("landing.gallery.bargeAlt")} width="1760" height="1408"/></a>
      <figcaption>
        {t("landing.gallery.bargeCaption")}
      </figcaption>
      <p className="arrows"><a href="/docs/barge-in">{t("landing.gallery.bargeArrowLink")}</a></p>
    </figure>
    <figure>
      <a className="zoom" href="/shots/07-qa-thread.png" target="_blank" rel="noopener" title={t("landing.gallery.openOriginal")}><img className="shot" src="/shots/07-qa-thread.png" loading="lazy" alt={t("landing.gallery.qaAlt")} width="1440" height="450"/></a>
      <figcaption>{t("landing.gallery.qaCaption")}</figcaption>
      <p className="arrows"><a href="/docs/requirements#되묻기와-답변-대기">{t("landing.gallery.qaArrowLink")}</a></p>
    </figure>
    <figure>
      <a className="zoom" href="/shots/04-ticket-running.png" target="_blank" rel="noopener" title={t("landing.gallery.openOriginal")}><img className="shot" src="/shots/04-ticket-running.png" loading="lazy" alt={t("landing.gallery.runningAlt")} width="1600" height="1000"/></a>
      <figcaption>{t("landing.gallery.runningCaption")}</figcaption>
      <p className="arrows"><a href="/docs/screens#티켓-상세">{t("landing.gallery.runningArrowLink")}</a></p>
    </figure>
    {/* 넷째는 12열을 통째로 쓴다. `.gallery`가 3열이라 넷이 한 줄에 못 뜨는데, 열을 넷으로
        줄이는 쪽은 §랜딩 §갤러리가 이미 버린 안이다(1열 1032px에서도 캡처가 0.65로 줄어
        안 읽힌다 — `landing.css` 갤러리 주석 ③). 그래서 셋은 두고 넷째만 한 줄을 쓴다.
        900 이하 1열에서도 `1 / -1`이 그 한 칸이라 접힘이 안 갈린다. 레일은 무채색 —
        ①과 같이 상태가 아닌 것이다. 앞 셋과의 간격 24는 `landing.css` 갤러리 주석 ⑤
        (`.gallery figure:last-child`의 margin-top)가 준다. */}
    <figure style={{ gridColumn: "1 / -1" }}>
      <a className="zoom" href="/shots/09-ontology.png" target="_blank" rel="noopener" title={t("landing.gallery.openOriginal")}><img className="shot" src="/shots/09-ontology.png" loading="lazy" alt={t("landing.gallery.ontologyAlt")} width="1600" height="760"/></a>
      <figcaption>{t("landing.gallery.ontologyCaption")}</figcaption>
      <p className="arrows"><a href="/docs/ontology">{t("landing.archiving.arrowLink")}</a></p>
    </figure>
  </div>
</section>

{/* ⑥ 설치 3단계 — 풀 모드에서 안 뜬다(§한 코드베이스 §홈 표). 파는 절이라서다. */}
{!fullMode && (
<section className="wrap reveal">
  <p className="eyebrow">{t("landing.install.eyebrow")}</p>
  <h2>{t("landing.install.title")}</h2>
  <p className="body" style={{ maxWidth: "44em" }}>
    {t("landing.install.body")}
  </p>
  <div className="two">
    <div>
      <ul className="marks">
        {/* JSX는 태그와 맞닿은 줄바꿈을 통째로 지운다(HTML은 공백 하나로 접는다) — 그래서
            줄 끝이 글자고 다음 줄이 태그로 시작하는 자리마다 `{" "}`로 그 공백을 명시한다.
            이 파일에 그런 자리가 셋이다. 산문은 0자 안 갈린다. */}
        <li><b>① <code>.dmg</code>{t("landing.install.step1BoldSuffix")}</b> <code>dira.app</code>{t("landing.install.step1AppSuffix")}{" "}
        <code>{t("landing.install.applicationsFolder")}</code>{t("landing.install.step1Body")}</li>
        <li><b>{t("landing.install.step2Bold")}</b> {t("landing.install.step2Prefix")}{" "}
        <code>{t("project.create.submit")}</code>{t("landing.install.step2Suffix")}</li>
        <li><b>{t("landing.install.step3Bold")}</b> {t("landing.install.step3Body")}</li>
      </ul>
    </div>
    <div>
      <ul className="marks">
        <li><b>{t("landing.install.item1BoldPrefix")} <code>claude</code>{t("landing.install.item1BoldMid")} <code>codex</code>{t("landing.install.item1BoldSuffix")}</b>{" "}
        {t("landing.install.item1Prefix")}{" "}
        <code>{t("persona.engine.label")}</code> {t("landing.install.item1Mid")} <code>claude</code>{t("landing.install.item1Suffix")}</li>
        <li><b>{t("landing.install.item2Bold")}</b> {t("landing.install.item2Prefix")}{" "}
        <a href="/docs/install#앱-없이-엔진만-쓰기">{t("landing.install.item2LinkText")}</a>{t("landing.install.item2Suffix")}</li>
      </ul>
      <p className="arrows">
        <a href="/docs/install">{t("landing.install.fullGuideLink")}</a>
        <a href="/docs/first-ticket">{t("landing.install.firstTicketLink")}</a>
        <a href="/docs/cron">{t("landing.install.cronOnlyLink")}</a>
      </p>
    </div>
  </div>
</section>
)}

<section className={`wrap plan-sec reveal${planStopped ? " stopped" : ""}`}>
  <p className="eyebrow">
    {t("landing.plan.eyebrow")}
    {/* 정지 손잡이(§P237-1 §정지 손잡이) — 보이는 글자 0자, 상태·다음 동작을
        `aria-label`이 진다. `:hover`/`:focus-within`(§랜딩 §고름·`.plans`)과 겹치지
        않는다 — 이 버튼은 `.plans` 밖(`.eyebrow` 안)이라 누르러 오는 포커스가
        `:focus-within`을 안 켠다. */}
    <button
      type="button"
      className="plan-cycle-toggle"
      aria-label={planStopped ? t("landing.plan.cycleResumeAriaLabel") : t("landing.plan.cyclePauseAriaLabel")}
      onClick={() => setPlanStopped((s) => !s)}
    >
      {planStopped ? <Play aria-hidden size={14} /> : <Pause aria-hidden size={14} />}
    </button>
  </p>
  <h2>{t("landing.plan.title")}</h2>
  {/* 카드는 순서가 없어 <ul>이다(.plans는 .steps에서 분리했다 — 30초 설명과 규칙이 갈린다). */}
  <ul className="plans">
    <li>
      <b>Free</b>
      <ul className="marks">
        <li>{t("landing.plan.freeItem1")}</li>
        <li>{t("landing.plan.freeItem2")} <span className="soon">{t("landing.plan.soon")}</span></li>
        <li>{t("landing.plan.freeItem3")} <span className="soon">{t("landing.plan.soon")}</span></li>
      </ul>
      <p>{t("landing.plan.freeBody")}</p>
      {/* 헤더의 별 버튼과 같은 마크업이다(DESIGN §별 버튼을 우리 버튼으로 §값). */}
      <div className="cta">
        <a className="btn star"
           href="https://github.com/proofer-tech/dira" target="_blank" rel="noopener"
           aria-label="Star proofer-tech/dira on GitHub">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>
          Star
          {stars && <span className="star-count" aria-hidden="true">{stars}</span>}
        </a>
      </div>
    </li>
    <li>
      <b>Pro</b>
      <ul className="marks">
        <li>{t("landing.plan.proItem1")} <span className="soon">{t("landing.plan.soon")}</span></li>
        <li>{t("landing.plan.proItem2")} <span className="soon">{t("landing.plan.soon")}</span></li>
        <li>{t("landing.plan.proItem3")} <span className="soon">{t("landing.plan.soon")}</span></li>
        <li>{t("landing.plan.proItem4")} <span className="soon">{t("landing.plan.soon")}</span></li>
      </ul>
    </li>
    <li>
      <b>Enterprise</b>
      <ul className="marks">
        <li>{t("landing.plan.enterpriseItem1")} <span className="soon">{t("landing.plan.soon")}</span></li>
        <li>{t("landing.plan.enterpriseItem2")} <span className="soon">{t("landing.plan.soon")}</span></li>
      </ul>
    </li>
    {/* 열이 아니라 행이 는다 — 이 카드는 유료 열 셋과 같은 열에 안 뜨고 전 열을 잡는다. */}
    <li className="wide">
      <b>{t("landing.plan.personaMarket")} <span className="soon">{t("landing.plan.soon")}</span></b>
      <ul className="marks">
        <li>{t("landing.plan.personaMarketItem")}</li>
      </ul>
    </li>
  </ul>
  {/* 옛 ⑧ 마지막 CTA 절이 여기로 합쳐졌다(§랜딩 §플랜 절과 마지막 CTA가 한 절이
      된다, 요구 `79011562`) — 카드 넷을 든 쪽이 안 움직이고 옮기는 것은 언제나 작은 쪽이다.
      `.body`는 아직 빈 노드다 — 넛지 문장은 사용자가 읽는 산문이라 developer가 안 쓰고
      후속 writer 티켓(`1466dd10`)이 채운다. 레포로 가는 버튼은 안 옮긴다 — 같은 절 Free
      카드의 `Star`와 목적지가 이미 같다. 풀 모드는 이 두 줄만 걷힌다(③ 히어로 CTA와 같은
      이유 — 앱을 연 사람에게 <받아서 깔아보세요>는 이미 참이 아니다). */}
  {!fullMode && (
    <>
      <p className="body">{t("landing.plan.ctaBody")}</p>
      <div className="cta">
        <a className="btn btn-primary btn-lg" href={dmg}>{t("landing.hero.downloadCta")}</a>
      </div>
    </>
  )}
</section>

</main>

<footer>
  <div className="wrap">
    <div className="fgrid">
      <div>
        <div className="fbrand">
          <svg viewBox="0 0 32 32" fillRule="evenodd" aria-hidden="true"><path d="M2 0H10A2 2 0 0 1 12 2V6H30A2 2 0 0 1 32 8V30A2 2 0 0 1 30 32H2A2 2 0 0 1 0 30V2A2 2 0 0 1 2 0ZM10 10H22A2 2 0 0 1 24 12V14A4 4 0 0 0 24 22V24A2 2 0 0 1 22 26H10A2 2 0 0 1 8 24V22A4 4 0 0 0 8 14V12A2 2 0 0 1 10 10Z"/></svg>
          dira
        </div>
        <p className="fnote">{t("landing.hero.eyebrow")}</p>
      </div>
      <div className="fcol">
        <h4>{t("landing.footer.productHeading")}</h4>
        <ul>
          {/* ⑨ footer `제품 › 다운로드` — 풀 모드에서 그 한 줄만 걷는다(§한 코드베이스 §홈 표).
              `릴리스`·`엔진`과 나머지 세 열은 그대로다. */}
          {!fullMode && <li><a href={dmg}>{t("landing.footer.downloadLink")}</a></li>}
          <li><a href="https://github.com/proofer-tech/dira/releases">{t("landing.footer.releasesLink")}</a></li>
          <li><a href="/docs/what-is-dira">{t("landing.footer.engineLink")}</a></li>
        </ul>
      </div>
      <div className="fcol">
        <h4>{t("landing.footer.docsHeading")}</h4>
        <ul>
          <li><a href="/docs/">{t("landing.nav.manualLink")}</a></li>
          <li><a href="/docs/install">{t("landing.nav.installGuide")}</a></li>
          <li><a href="https://github.com/proofer-tech/dira#readme">README</a></li>
          <li><a href="https://github.com/proofer-tech/dira/tree/master/templates">{t("landing.footer.templatesLink")}</a></li>
        </ul>
      </div>
      <div className="fcol">
        <h4>{t("landing.footer.repoHeading")}</h4>
        <ul>
          <li><a href="https://github.com/proofer-tech/dira">proofer-tech/dira</a></li>
          <li><a href="https://github.com/proofer-tech/dira/issues">{t("landing.footer.issuesLink")}</a></li>
          <li><a href="https://github.com/proofer-tech/dira/blob/master/LICENSE">{t("landing.footer.licenseLink")}</a></li>
        </ul>
      </div>
    </div>
    <div className="fbot">
      <span>{t("landing.footer.copyright")}</span>
      <a href="/terms">{t("landing.footer.termsLink")}</a>
      <a href="/privacy">{t("landing.footer.privacyLink")}</a>
    </div>
  </div>
</footer>

{fullMode && (
  <>
    {/* 헤더 `새로 만들기`의 그릇 — 걷힌 `<ProjectsSection>`과 같은 `CreateDialog`다(§0-3).
        `.dira`가 이미 큐로 있으면 `onRegister`로 아래 등록 다이얼로그를 연다. */}
    <CreateDialog
      open={creating}
      onOpenChange={setCreating}
      home={home ?? ""}
      onCreated={handleCreated}
      onRegister={openRegister}
    />
    {/* 등록 다이얼로그 — 헤더에 자기 버튼이 없다(§홈 — `프로젝트 등록`은 안 올린다). 여는 길은
        0건 온보딩의 "등록합니다" 줄과 `CreateForm`의 "등록으로" 되돌림 둘뿐이다. */}
    <Dialog open={registering} onOpenChange={setRegistering}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("landing.register.title")}</DialogTitle>
          <DialogDescription>{t("landing.registerDialog.description")}</DialogDescription>
        </DialogHeader>
        {registerForm}
      </DialogContent>
    </Dialog>
  </>
)}

    </div>
  );
}
