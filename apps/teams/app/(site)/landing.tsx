"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Typed from "typed.js";
import { Pause, Play, TriangleAlert } from "lucide-react";
import { registerProject, type CreateState, type RegisterState } from "@/app/actions";
import { CREATE_BLURB, ConfigTable, CreateDialog, CreateForm } from "@/components/projects-ui";
import { CopyCommand } from "@/components/copy-command";
import { PickPath } from "@/components/path-picker";
import { SettingsDialog, type AuthView } from "@/components/settings-dialog";
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
   *  슬롯에 선다(§비주얼 §47, P199-10). */
  children?: React.ReactNode;
}) {
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
        <Label htmlFor="home-register-name">이름</Label>
        <Input
          id="home-register-name"
          name="name"
          placeholder="dira 자체"
          value={registerName}
          onChange={(e) => setRegisterName(e.target.value)}
        />
        {registerErr?.code === "name" && (
          <p className="text-xs text-destructive">{registerErr.message}</p>
        )}
      </div>
      {registerShowId && (
        <div className="space-y-2">
          <Label htmlFor="home-register-id">URL 조각</Label>
          <Input id="home-register-id" name="id" className="font-mono" placeholder="dira" />
          <p className="text-xs text-muted-foreground">
            {registerErr &&
            (registerErr.code === "needId" || registerErr.code === "badId" || registerErr.code === "dupId")
              ? registerErr.message
              : "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈)."}
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="home-register-root">경로</Label>
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
          <PickPath mode="directory" label="큐 경로" onPick={setRegisterRoot} />
        </div>
        <p className="text-xs text-muted-foreground">절대경로. ~는 확장됩니다</p>
      </div>
      {registerErr &&
        (registerErr.code === "root" || registerErr.code === "dupRoot" || registerErr.code === "unknown") && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>등록하지 못했습니다</AlertTitle>
            <AlertDescription className="grid gap-2">
              <span className="break-all">{registerErr.message}</span>
              {registerErr.dup && <Link href={`/p/${registerErr.dup.id}`}>{registerErr.dup.name} 열기</Link>}
            </AlertDescription>
          </Alert>
        )}
      <div className="flex justify-end">
        <Button type="submit" disabled={registerPending}>
          {registerPending ? "등록 확인 중…" : "프로젝트 등록"}
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
          {createdInfo ? "만들었습니다" : "등록됨"} — {view.project.name}{" "}
          <span className="font-mono text-xs text-muted-foreground">{view.project.shortRoot}</span>
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link href={`/p/${view.project.id}`} />}>
            보드 열기
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            닫기
          </Button>
        </div>
      </div>
      {createdInfo && (
        <div className="space-y-1 text-sm">
          <p>
            파일 {createdInfo.written}개를 만들었습니다.
            {createdInfo.skipped.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                이미 있어 건너뜀: <span className="font-mono text-xs">{createdInfo.skipped.join(" ")}</span>
              </span>
            )}
          </p>
          <p className="text-muted-foreground">
            엔진 레포 <span className="font-mono text-xs">{createdInfo.repo}</span>
          </p>
          {createdInfo.cron ? (
            <p>crontab에 등록됨 — 30초 뒤부터 티켓을 물어갑니다</p>
          ) : (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>crontab에 등록하지 못했습니다</AlertTitle>
              <AlertDescription className="grid gap-2">
                <span className="break-all">{createdInfo.cronError}</span>
                <CopyCommand cmd={createdInfo.registerCmd} />
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
    // 중앙 10%) 위로 올라가 `scrollY=0`에서 레인 0이 조용히 안 서는 경우가 생긴다(§비주얼
    // §47 실측). `.armed`와 같은 배치다 — JS가 죽으면 data-lane이 없고 카드는 레인 0에
    // 그냥 서 있다. reduce에서도 레인은 그대로 간다: 이름이 갈리는 것은 모션이 아니라
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
        // 못 읽으면 stars가 빈 채로 남아 개수 칸이 아예 안 선다 — 콘솔에도 아무것도 안 띄운다.
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
        // GitHub이 자산 응답에 붙이는 Content-Disposition: attachment다(DESIGN §서는 못 ①②).
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

{/* ① 릴리스 배너 — 풀 모드에서 안 선다(§한 코드베이스 §홈 표). 파는 절이라서다. */}
{!fullMode && (
<div className="ann">
  <div className="wrap">
    <span>자동 업데이트를 켜고 최신 버전(v{version})의 dira를 써보세요!</span>
    <a href="https://github.com/proofer-tech/dira/releases">릴리스 보기</a>
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
      <a className={fullMode ? "btn btn-manual" : "btn"} href="/docs/">매뉴얼</a>
      <a className="btn star"
         href="https://github.com/proofer-tech/dira" target="_blank" rel="noopener"
         aria-label="Star proofer-tech/dira on GitHub">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>
        Star
        {stars && <span className="star-count" aria-hidden="true">{stars}</span>}
      </a>
      {/* ② 헤더 `앱 다운로드` → `새로 만들기`·`설정` 둘로 갈린다(§한 코드베이스 §홈 표 ·
          §비주얼 §46 ③). `프로젝트 관리`는 목적지가 자기가 서 있는 페이지의 꼭대기라 안
          올린다(`/#projects`는 이미 이 페이지에 열려 있다) — §홈 §자기 자신을 가리키던 버튼.
          0건이면 `새로 만들기`가 빠져 primary가 0개다. */}
      {fullMode ? (
        <>
          {!empty && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              새로 만들기
            </button>
          )}
          {auth && <SettingsDialog auth={auth} trigger="text" />}
        </>
      ) : (
        <a className="btn btn-primary" href={dmg}>앱 다운로드</a>
      )}
    </nav>
  </div>
</header>

<main>

{/* 여행하는 티켓 한 장(DESIGN §랜딩 §개편 §움직이는 티켓). 페이지가 파는 것을 페이지가
    수행한다 — 이 제품에서 레인을 건너는 것은 애니메이션이 아니라 `rename` 한 번이다
    (코어 §큐의 불변식 1). 실리는 글자는 전부 제품이 쓰는 식별자이고 산문 노드가 0개다.
    장식이라 aria-hidden이다(§서는 못 ②). 절마다 새 카드를 세우지 않는다 — 이 한 장이
    <main> 안에서 sticky로 붙어 페이지를 끝까지 따라간다. */}
<div className="travel wrap" aria-hidden="true">
  <div className="lanes">
    <span className="tk"><span className="tk-hash">a1b2c3d4</span><span className="tk-name"><i>.md</i><i>.wip.md</i><i>.done.md</i></span></span>
  </div>
</div>

{/* 목록·온보딩·오류 슬롯 — 풀 모드에서 `<main>`의 첫 블록이다(§한 코드베이스 §홈 ⓪,
    §비주얼 §47). `id="projects"`가 그 슬롯이다 — 표가 아니라 **자리**를 가리킨다
    (0건에서는 목록이 아니라 온보딩 폼이, 오류에서는 배너가 그 자리에 선다). 랜딩-only에는
    이 블록 자체가 없다. */}
{fullMode && (
  <div id="projects" className="wrap">
    {registryError ? (
      <Alert variant="destructive" className="max-w-3xl">
        <TriangleAlert aria-hidden />
        <AlertTitle>프로젝트 레지스트리를 읽지 못했습니다</AlertTitle>
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
              등록된 프로젝트가 없습니다. 하나 만들면 시작합니다.
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
                  이미 만들어 둔 .dira가 있다면 등록합니다.
                </p>
                <Button variant="outline" size="sm" onClick={() => setRegistering(true)}>
                  프로젝트 등록
                </Button>
              </div>
              <Card className="mt-4 max-w-3xl gap-4 p-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-medium">새 프로젝트</h2>
                  <p className="text-xs text-muted-foreground">{CREATE_BLURB}</p>
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
  <p className="eyebrow">로컬 멀티 에이전트 매니지먼트 시스템</p>
  <h1>나만의 AI 팀을 만들어보세요</h1>
  <p className="body">
    요구사항을 정말 아무렇게나 던져도 찰떡같이 알아듣습니다. 티켓을 나누고 에이전트끼리
    협업해 끝내는 과정은 jira처럼 실시간으로 지켜볼 수 있습니다. PC에 나만의 멀티 에이전트
    시스템을 아주 쉽게 만들어보세요.
  </p>
  {/* 랜딩-only에서만 선다 — 풀 모드는 이 자리가 걷혀 아무것도 안 들어온다(§한 코드베이스
      §홈 표 ③, 걷힌 근거는 목록이 이제 위 `#projects`로 나가서다). */}
  {!fullMode && (
    <>
      <div className="cta">
        <a className="btn btn-primary btn-lg" href={dmg}>macOS 앱 다운로드</a>
        <a className="btn btn-lg" href="/docs/install">설치 가이드</a>
      </div>
      <p className="cta-note">with Claude Code · Codex</p>
    </>
  )}

  <figure>
    <img className="shot" src="/shots/board.gif" alt="dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있고, 그중 한 장이 다음 레인으로 건너갑니다." width="1600" height="1000"/>
    <figcaption>놀라운 사실: dira 앱 또한 dira로 만들어졌습니다.</figcaption>
  </figure>
</div>

{/* SECTION A 한 무대(로드맵 §P237-5, 값은 §P237-1 판정표 자리 ④). 세 절을 그릇 하나가
    감싸 901px 이상 + `animation-timeline: view()` 지원 브라우저에서만 sticky 크로스페이드가
    선다 — `landing.css`의 `@supports`가 거짓이면 이 그릇은 그냥 빈 껍데기라 세 절이
    지금처럼 세로로 쌓인다. 노드는 하나도 안 늘거나 줄지 않았다. 첫 패널(§자리 ④ 확장,
    `e0701973`)이 무대에 합류해 지나는 장면이 둘 → 셋이 됐다 — 절은 안 합쳐지고 `<h2>`
    셋이 그대로 선다. */}
<div className="stage">
<section className="wrap reveal">
  <h2>말하면 이루어집니다</h2>
  <ol className="steps">
    <li>
      <span className="sig">.md</span>
      <b>① 요구사항을 접수하세요</b>
      <p>대화하듯 자연스럽게 무엇을 원하는지 적어주시면 끝입니다. 귀찮고 복잡한 나머지
      일은 에이전트가 알아서 합니다.</p>
    </li>
    <li>
      <span className="sig">.wip</span>
      <b>② 일사불란하게 움직입니다</b>
      <p>요구사항을 받은 에이전트가 그걸 구체화해 작업 단위 티켓으로 나눕니다. 티켓마다
      맞는 페르소나의 워커가 알아서 붙고 서로 협업해 주신 요구사항을
      끝냅니다.</p>
    </li>
    <li>
      <span className="sig">.done</span>
      <b>③ 끝이에요. 쉽죠?</b>
      <p>워커들이 뭘 읽고 어떻게 고치는지 실시간으로 보입니다. 진행 중에 막히면
      사용자에게 물어도 봅니다. 그저 사람과 일하듯 자연스럽게 요구하고 대답하다 보면
      원하던 기능이 완성됩니다!</p>
    </li>
  </ol>
</section>
{/* 아카이빙·온톨로지 — `.done` 다음 이야기라 30초 설명 바로 뒤에 선다(로드맵 §P228 §랜딩).
    번호가 없는 것은 §한 코드베이스 §홈 표에 안 실려서다 — 두 모드 다 선다. 새 CSS 0. */}
<section className="wrap reveal">
  <h2>끝난 일은 기록으로 남습니다</h2>
  <ul className="marks">
    <li><b>티켓이 <code>.done</code>이 되면 아카이빙 티켓이 한 장 따라 붙습니다.</b> 완료 카드
    아래에 <code>아카이빙중</code> 한 줄이 서고 이것도 워커가 받아서 하는 일이라 어디까지
    갔는지 그대로 보입니다</li>
    <li><b>남는 것은 마크다운 한 장과 티켓 맨 아래 한 절입니다.</b> 아카이빙을 맡은 워커가 방금
    끝난 일에서 사실을 추려 프로젝트 폴더의 <code>.dira/ontology/</code>에 적고 그 티켓 본문에는{" "}
    <code>## 아카이브</code> 절을 붙입니다</li>
    <li><b>다음 세션은 그 자리를 알고 시작합니다.</b> 온톨로지가 어디에 있고 어떻게 찾는지가
    워커에게 나가는 프롬프트마다 실립니다</li>
    <li><b>파일은 그냥 마크다운입니다.</b> <code>[[링크]]</code>로 서로 이어져 있어 Obsidian 같은
    도구로 폴더째 열립니다. 프로젝트를 옮기면 기록도 같이 따라갑니다</li>
  </ul>
  {/* ④ 「일을 할수록 더 능숙해지는」 — 기전을 이 절이 이미 다 말해서 약속 한 줄만 붙는다
      (로드맵 §P229, 사람 답 `14cd1aad`가 §P228의 비교 금지 한 축을 뒤집었다).
      `.body`는 margin 0이라 위 목록에 붙는다 — `.marks`·`.arrows`와 같은 24px를 인라인으로
      준다(새 CSS 규칙 0). */}
  <p className="body" style={{ marginTop: 24 }}>일을 시킬수록 워커는 이 프로젝트에
  능숙해집니다. 어제 누가 무엇을 정했는지 읽고 시작하니, 같은 이야기를 두 번 하지 않아도
  됩니다.</p>
  {/* 그림 — 목록 첫 항목이 말하는 그 한 줄이 실제로 선 자리(로드맵 §P235-1). 자리가 `.arrows`
      바로 앞인 것은 아래 절과 같은 규칙이다: 절은 언제나 나가는 링크로 끝난다.
      `.gallery` 밖이라 `figure`는 margin 0이다 — 위 `.body`와 **같은 인라인 24**를 준다
      (새 CSS 규칙 0). `.zoom`은 갤러리 셋과 같은 부품이다(§랜딩 §갤러리 ③ — 라이트박스 0). */}
  <figure style={{ marginTop: 24 }}>
    <a className="zoom" href="/shots/10-archiving.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/10-archiving.png" loading="lazy" alt="dira 보드의 진행중·완료 두 레인. 완료 레인 둘째 카드 a732ce19의 아래 칸에 서류함 아이콘과 «아카이빙중» 한 줄이 붙어 있고, 그 위 카드에는 그 줄이 없습니다." width="1664" height="664"/></a>
    <figcaption>이 한 줄은 링크입니다. 누르면 아카이빙을 맡은 티켓으로 건너가, 그 워커가 지금
    어디까지 갔는지가 보입니다.</figcaption>
  </figure>
  <p className="arrows"><a href="/docs/ontology">아카이빙과 온톨로지</a></p>
</section>

{/* 「오로지 내 PC에」 — 앞 절이 «기록이 프로젝트 폴더에 남는다»로 끝나서, 그 파일이 어디에도
    안 간다는 이야기가 여기서 이어진다(로드맵 §P229 §랜딩). 모델 호출은 감추지 않고 한 마디로
    적는다 — 셋째 항목이 그 자리다. 두 모드 다 선다. 새 CSS 0. */}
<section className="wrap reveal">
  <h2>계정을 만들 필요가 없습니다</h2>
  <ul className="marks">
    <li><b>dira에는 서버가 없습니다.</b> 가입도 로그인도 없습니다. 내려받아 열면 그게 전부이고
    만든 프로젝트가 어딘가로 올라가지 않습니다</li>
    <li><b>티켓도 기록도 프로젝트 폴더 안에 있습니다.</b> 큐는{" "}
    <code>&lt;프로젝트&gt;/.dira</code> 디렉터리 하나이고 담긴 것은 마크다운 파일입니다. 따로
    권한을 설정하는 자리가 없어서 그 폴더를 열 수 있으면 그것이 곧 권한입니다</li>
    <li><b>모델에는 일감이 나갑니다.</b> 워커가 세션을 띄울 때 티켓 본문과 필요한 코드가
    고르신 엔진을 거쳐 모델로 갑니다. 그 통로 밖으로 작업한 내용을 dira가
    따로 가져가지는 않습니다</li>
    <li><b>사용 통계는 끄면 그만입니다.</b> 화면에서 무엇을 눌렀는지 여덟 가지만 셉니다. 티켓
    제목·본문·파일 경로·프롬프트는 실리지 않습니다. 설정에서 끄면 그때부터 아무것도 나가지
    않고 남은 것까지 지우시려면 <code>~/.config/dira/analytics.json</code> 한 개를 지우면
    됩니다</li>
  </ul>
  {/* 그림 — 새로 찍지 않는다. `08-onboarding`이 §매뉴얼 §스크린샷이 박아 둔 «프로젝트 0건일
      때의 `/`»고 그것이 설치 후 첫 화면이다(로드맵 §P235-1). alt는 `docs/first-ticket.md:14`가
      이미 쓰던 문장에서 이 절이 가리키는 것만 남겼다. 자리·간격은 위 절과 같다. */}
  <figure style={{ marginTop: 24 }}>
    <a className="zoom" href="/shots/08-onboarding.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/08-onboarding.png" loading="lazy" alt="프로젝트가 0건일 때의 첫 화면. 등록된 프로젝트가 없다는 한 줄 아래에 새 프로젝트 카드가 펼쳐져 있고, 이름·프로젝트 폴더·통합 브랜치·스펙 문서 칸과 프로젝트 만들기 버튼이 있습니다." width="1600" height="700"/></a>
    <figcaption>설치하고 처음 열면 이 화면입니다. 적는 것은 이름과 프로젝트 폴더뿐이고 계정을
    넣는 칸이 없습니다.</figcaption>
  </figure>
  <p className="arrows"><a href="/docs/analytics">사용 통계와 끄는 법</a></p>
</section>
</div>

<div className="wrap stats reveal">
  {/* `stats-list`는 §모션 §판정표 ①이 격자 그릇을 대상에서 빼는 자리다 — 텍스트는 0자 안 갈렸다. */}
  <ul className="stats-list">
    <li><b>0</b><span>엔진 의존성<br/>bash + python3 표준 라이브러리</span></li>
    <li><b>8</b><span>이 레포에서 동시에 도는 워커</span></li>
    <li><b>1775</b><span>자기 큐가 받은 티켓<br/>완료 1762</span></li>
    <li><b>62시간</b><span>첫 커밋에서 첫 릴리스까지<br/>커밋 351</span></li>
  </ul>
  <p className="stats-note">2026-08-12 기준</p>
</div>

{/* `no-hi`는 §모션 §판정표 ④가 하이라인을 안 긋는 예외다(`.stats + section`이 이미
    border-top을 0으로 죽인 절과 같다) — 텍스트는 0자 안 갈렸다. */}
<section className="wrap reveal no-hi">
  <div className="gallery">
    <figure>
      <a className="zoom" href="/shots/barge.gif" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/barge.gif" loading="lazy" alt="세션 스트림이 도구 호출을 한 줄씩 늘려 가는 동안, 아래 입력창에 문장을 넣고 보내기를 누르자 그 문장이 참견 줄로 스트림에 나타나고 세션이 이어서 방향을 바꿉니다." width="1760" height="1408"/></a>
      <figcaption>
        "그럴 수 있죠 이해해요, 어떻게 사람이 완벽할까요?" 반드시 완벽한 요구사항을 줄
        필요가 없습니다. 가볍게 요구하고 작업 중에도 참견할 수 있습니다.
      </figcaption>
      <p className="arrows"><a href="/docs/barge-in">도는 세션에 말 걸기</a></p>
    </figure>
    <figure>
      <a className="zoom" href="/shots/07-qa-thread.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/07-qa-thread.png" loading="lazy" alt="요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있습니다." width="1440" height="450"/></a>
      <figcaption>어련히 모르면 물어보지 않겠어요? 에이전트들도 일하다 모르는 게 생기면 물어봅니다. 질문에 대답해주세요. 그럼 또 알아서 하러 갑니다.</figcaption>
      <p className="arrows"><a href="/docs/requirements#되묻기와-답변-대기">문의 · 답변</a></p>
    </figure>
    <figure>
      <a className="zoom" href="/shots/04-ticket-running.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/04-ticket-running.png" loading="lazy" alt="진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계." width="1600" height="1000"/></a>
      <figcaption>일이 어떻게 흘러가는지 티켓 단위로 들여다볼 수 있습니다. 생각과 다른 방향으로 가고 있으면 티켓을 할당 해제해 중단시킵니다. 아직 시작하지 않은 티켓은 본문을 고쳐 원하는 방향을 자세히 적어 둘 수도 있습니다.</figcaption>
      <p className="arrows"><a href="/docs/screens#티켓-상세">업무 투명성</a></p>
    </figure>
    {/* 넷째는 12열을 통째로 쓴다. `.gallery`가 3열이라 넷이 한 줄에 못 서는데, 열을 넷으로
        줄이는 쪽은 §랜딩 §갤러리가 이미 버린 안이다(1열 1032px에서도 캡처가 0.65로 줄어
        안 읽힌다 — `landing.css` 갤러리 주석 ③). 그래서 셋은 두고 넷째만 한 줄을 쓴다.
        900 이하 1열에서도 `1 / -1`이 그 한 칸이라 접힘이 안 갈린다. 레일은 무채색 —
        ①과 같이 상태가 아닌 것이다. 앞 셋과의 간격 24는 `landing.css` 갤러리 주석 ⑤
        (`.gallery figure:last-child`의 margin-top)가 준다. */}
    <figure style={{ gridColumn: "1 / -1" }}>
      <a className="zoom" href="/shots/09-ontology.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/09-ontology.png" loading="lazy" alt="온톨로지 화면. 제목 아래에 카드가 사는 폴더 경로가 있고, 그 밑 지표 판에 객체 · 관계 96 · 184를 비롯한 칸이 열두 개 있습니다. 아래는 왼쪽이 카드 파일트리, 오른쪽이 고른 파일 _ontology/SCHEMA.md를 위지윅으로 연 편집기입니다." width="1600" height="760"/></a>
      <figcaption>티켓이 끝날 때마다 그 일에서 추린 사실이 한 장씩 여기 쌓입니다. 프로젝트 폴더 안에 마크다운으로 남아서 다음 세션도 사람도 같은 자리를 열어 봅니다.</figcaption>
      <p className="arrows"><a href="/docs/ontology">아카이빙과 온톨로지</a></p>
    </figure>
  </div>
</section>

{/* ⑥ 설치 3단계 — 풀 모드에서 안 선다(§한 코드베이스 §홈 표). 파는 절이라서다. */}
{!fullMode && (
<section className="wrap reveal">
  <p className="eyebrow">설치</p>
  <h2>다운로드해서 설치하면 끝</h2>
  <p className="body" style={{ maxWidth: "44em" }}>
    받아서 열기만 하면 되고 터미널을 켤 일이 없습니다.
  </p>
  <div className="two">
    <div>
      <ul className="marks">
        {/* JSX는 태그와 맞닿은 줄바꿈을 통째로 지운다(HTML은 공백 하나로 접는다) — 그래서
            줄 끝이 글자고 다음 줄이 태그로 시작하는 자리마다 `{" "}`로 그 공백을 명시한다.
            이 파일에 그런 자리가 셋이다. 산문은 0자 안 갈린다. */}
        <li><b>① <code>.dmg</code>를 열고 끌어다 놓습니다.</b> <code>dira.app</code>을{" "}
        <code>응용 프로그램</code>으로 옮기면 그것으로 설치가 끝납니다. 서명·공증된 빌드라
        처음 열 때 맥이 낯선 앱이라며 막지 않습니다</li>
        <li><b>② 앱을 처음 열면 폼이 펼쳐져 있습니다.</b> 이름과 프로젝트 폴더를 넣고{" "}
        <code>프로젝트 만들기</code>를 누릅니다</li>
        <li><b>③ 30초 뒤부터 워커가 큐를 훑습니다.</b> 티켓을 써 두면 그때부터 물어 갑니다</li>
      </ul>
    </div>
    <div>
      <ul className="marks">
        <li><b>엔진은 <code>claude</code>와 <code>codex</code>, grok과 agy 넷 중에 고릅니다.</b> 워커를 만들
        때 모델까지 같이 정하고 목록에 없는 이름은 직접 적어 넣습니다. 만든 뒤에도 워커 화면의{" "}
        <code>엔진</code> 열을 눌러 바꿉니다. 참견은 <code>claude</code>에만 있고
        세션 스트림은 claude와 grok에 있습니다. 앱은 Apple Silicon 맥에서만 돕니다</li>
        <li><b>화면 없이 엔진만 돌릴 수도 있습니다.</b> Linux에서 굴리거나 화면이 필요 없으면
        레포를 직접 받는 <a href="/docs/install#앱-없이-엔진만-쓰기">그 갈래</a>로 가세요</li>
      </ul>
      <p className="arrows">
        <a href="/docs/install">전체 설치 가이드</a>
        <a href="/docs/first-ticket">첫 프로젝트 만들기</a>
        <a href="/docs/cron">엔진만으로 돌리기</a>
      </p>
    </div>
  </div>
</section>
)}

<section className={`wrap plan-sec reveal${planStopped ? " stopped" : ""}`}>
  <p className="eyebrow">
    플랜
    {/* 정지 손잡이(§P237-1 §정지 손잡이) — 보이는 글자 0자, 상태·다음 동작을
        `aria-label`이 진다. `:hover`/`:focus-within`(§랜딩 §고름·`.plans`)과 겹치지
        않는다 — 이 버튼은 `.plans` 밖(`.eyebrow` 안)이라 누르러 오는 포커스가
        `:focus-within`을 안 켠다. */}
    <button
      type="button"
      className="plan-cycle-toggle"
      aria-label={planStopped ? "플랜 카드 순환 다시 돌리기" : "플랜 카드 순환 멈추기"}
      onClick={() => setPlanStopped((s) => !s)}
    >
      {planStopped ? <Play aria-hidden size={14} /> : <Pause aria-hidden size={14} />}
    </button>
  </p>
  <h2>내 PC에서 무료로 시작해보세요</h2>
  {/* 카드는 순서가 없어 <ul>이다(.plans는 .steps에서 분리했다 — 30초 설명과 규칙이 갈린다). */}
  <ul className="plans">
    <li>
      <b>Free</b>
      <ul className="marks">
        <li>로컬 앱과 엔진을 직접 설치해 쓰기</li>
        <li>동료들과 P2P 협업 <span className="soon">준비중</span></li>
        <li>엔진 MCP <span className="soon">준비중</span></li>
      </ul>
      <p>로컬 엔진과 앱은 영원히 무료로 제공합니다. dira는 빌더들의
      멀티 에이전트 생태계를 응원합니다.</p>
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
        <li>클라우드 프로젝트 <span className="soon">준비중</span></li>
        <li>dira 자체 클라우드 LLM 사용 <span className="soon">준비중</span></li>
        <li>결과물 웹 호스팅 <span className="soon">준비중</span></li>
        <li>클라우드 워커 <span className="soon">준비중</span></li>
      </ul>
    </li>
    <li>
      <b>Enterprise</b>
      <ul className="marks">
        <li>엔터프라이즈 전용 커스텀 <span className="soon">준비중</span></li>
        <li>사내툴과 연동 <span className="soon">준비중</span></li>
      </ul>
    </li>
    {/* 열이 아니라 행이 는다 — 이 카드는 유료 열 셋과 같은 열에 안 서고 전 열을 잡는다. */}
    <li className="wide">
      <b>페르소나 마켓 <span className="soon">준비중</span></b>
      <ul className="marks">
        <li>생태계도 같이 만듭니다</li>
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
      <p className="body">가입도 결제도 없습니다. 안 맞으면 지우면 그만이니 일단 깔아보세요.</p>
      <div className="cta">
        <a className="btn btn-primary btn-lg" href={dmg}>macOS 앱 다운로드</a>
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
        <p className="fnote">로컬 멀티 에이전트 매니지먼트 시스템</p>
      </div>
      <div className="fcol">
        <h4>제품</h4>
        <ul>
          {/* ⑨ footer `제품 › 다운로드` — 풀 모드에서 그 한 줄만 걷는다(§한 코드베이스 §홈 표).
              `릴리스`·`엔진`과 나머지 세 열은 그대로다. */}
          {!fullMode && <li><a href={dmg}>다운로드</a></li>}
          <li><a href="https://github.com/proofer-tech/dira/releases">릴리스</a></li>
          <li><a href="/docs/what-is-dira">엔진</a></li>
        </ul>
      </div>
      <div className="fcol">
        <h4>문서</h4>
        <ul>
          <li><a href="/docs/">매뉴얼</a></li>
          <li><a href="/docs/install">설치 가이드</a></li>
          <li><a href="https://github.com/proofer-tech/dira#readme">README</a></li>
          <li><a href="https://github.com/proofer-tech/dira/tree/master/templates">템플릿</a></li>
        </ul>
      </div>
      <div className="fcol">
        <h4>레포</h4>
        <ul>
          <li><a href="https://github.com/proofer-tech/dira">proofer-tech/dira</a></li>
          <li><a href="https://github.com/proofer-tech/dira/issues">이슈</a></li>
          <li><a href="https://github.com/proofer-tech/dira/blob/master/LICENSE">MIT 라이선스</a></li>
        </ul>
      </div>
    </div>
    <div className="fbot">
      <span>© 2026 프루퍼 주식회사. MIT.</span>
      <a href="/terms">이용약관</a>
      <a href="/privacy">개인정보처리방침</a>
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
          <DialogTitle>프로젝트 등록</DialogTitle>
          <DialogDescription>이미 있는 .dira를 목록에 올립니다. 파일은 만들지 않습니다.</DialogDescription>
        </DialogHeader>
        {registerForm}
      </DialogContent>
    </Dialog>
  </>
)}

    </div>
  );
}
