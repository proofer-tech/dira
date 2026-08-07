"use client";

import { useEffect, useState } from "react";

import "./fonts.css";
import "./landing.css";

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
  children,
}: {
  version: string;
  /** 프로젝트 목록 표(§한 코드베이스 §홈). 히어로 CTA 자리에 선다 — 자리만 이 티켓이 정하고
   *  폭·간격·버튼 재배치는 P199-3(designer)·P199-4(조립)의 몫이다. */
  children?: React.ReactNode;
}) {
  // 초기값은 빌드 시점의 `apps/desktop/package.json`. 비우면 hydration이 어긋난다.
  const [version, setVersion] = useState(initialVersion);
  // 초기값 = 실패값. SSR·fetch 실패·`.dmg` 없음 셋 다 지금 동작(릴리스 페이지)으로 떨어진다.
  const [dmg, setDmg] = useState("https://github.com/proofer-tech/dira/releases/latest");
  // 빈 문자열 = 개수를 못 읽은 상태. SSR HTML에도 클라이언트 첫 렌더에도 개수 칸이 없다.
  const [stars, setStars] = useState("");

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
    }
    // 여행하는 티켓의 레인(DESIGN §랜딩 §개편 §움직이는 티켓). 절 마크업에 표식을 안 심는다 —
    // 관측 대상은 <main> 직계 블록 여섯(`.wrap`)이고, 첫 블록이 레인 0 · 마지막 둘이 레인 2 ·
    // 그 사이가 레인 1이다. 블록이 늘거나 순서가 바뀌어도 이 셋의 뜻이 안 갈린다.
    // `.armed`와 같은 배치다 — JS가 죽으면 data-lane이 없고 카드는 레인 0에 그냥 서 있다.
    // reduce에서도 레인은 그대로 간다: 이름이 갈리는 것은 모션이 아니라 내용이고,
    // 미끄러지는 420ms만 킬 스위치의 `transition-duration: 0s !important`가 지운다.
    const travel = document.querySelector<HTMLElement>(".travel");
    if (travel) {
      const blocks = [...document.querySelectorAll("main > .wrap:not(.travel)")];
      const inband = new Set<Element>();
      const io2 = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            e.isIntersecting ? inband.add(e.target) : inband.delete(e.target);
          // <main>을 지나면(닫는 절·footer) 띠가 빈다 — 그때는 마지막 레인을 그대로 둔다.
          if (!inband.size) return;
          // 띠 안에 둘 이상이면 아래쪽이 이긴다 — 스크롤이 빨라도 레인이 뒤로 안 샌다.
          const i = Math.max(...[...inband].map((b) => blocks.indexOf(b)));
          travel.dataset.lane = i === 0 ? "0" : i < blocks.length - 2 ? "1" : "2";
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

<div className="ann">
  <div className="wrap">
    <span>자동 업데이트를 켜고 최신 버전(v{version})의 dira를 써보세요!</span>
    <a href="https://github.com/proofer-tech/dira/releases">릴리스 보기</a>
  </div>
</div>

<header>
  <div className="wrap">
    <a className="brand" href="/" aria-label="dira">
      <svg viewBox="0 0 32 32" fillRule="evenodd" aria-hidden="true"><path d="M2 0H10A2 2 0 0 1 12 2V6H30A2 2 0 0 1 32 8V30A2 2 0 0 1 30 32H2A2 2 0 0 1 0 30V2A2 2 0 0 1 2 0ZM10 10H22A2 2 0 0 1 24 12V14A4 4 0 0 0 24 22V24A2 2 0 0 1 22 26H10A2 2 0 0 1 8 24V22A4 4 0 0 0 8 14V12A2 2 0 0 1 10 10Z"/></svg>
      dira
    </a>
    <nav>
      <a className="btn" href="/docs/">매뉴얼</a>
      <a className="btn star"
         href="https://github.com/proofer-tech/dira" target="_blank" rel="noopener"
         aria-label="Star proofer-tech/dira on GitHub">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>
        Star
        {stars && <span className="star-count" aria-hidden="true">{stars}</span>}
      </a>
      <a className="btn btn-primary" href={dmg}>앱 다운로드</a>
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

<div className="hero wrap">
  <p className="eyebrow">로컬 멀티 에이전트 매니지먼트 시스템</p>
  <h1>나만의 AI 팀을 만들어보세요</h1>
  <p className="body">
    요구사항을 정말 아무렇게나 던져도 찰떡같이 알아들어 티켓을 나누고 에이전트간 협업을 통해
    완수하며 그 과정을 마치 jira처럼 실시간으로 볼 수 있습니다. PC에 나만의 멀티 에이전트
    시스템을 아주 쉽게 구축해보세요.
  </p>
  <div className="cta">
    <a className="btn btn-primary btn-lg" href={dmg}>macOS 앱 다운로드</a>
    <a className="btn btn-lg" href="/docs/install">설치 가이드</a>
  </div>
  <p className="cta-note">with Claude Code · Codex</p>

  {/* 프로젝트 목록(§한 코드베이스 §홈) — 히어로 CTA 자리에 선다. 목록이 shadcn(tailwind)이라
      `overflow-x-auto`만 얹는다. 폭·간격은 P199-3(designer)이 정한다 — 이 티켓은 자리만 낸다. */}
  {children && <div className="overflow-x-auto">{children}</div>}

  <figure>
    <img className="shot" src="/shots/board.gif" alt="dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있고, 그중 한 장이 다음 레인으로 건너갑니다." width="1600" height="1000"/>
    <figcaption>놀라운 사실: dira 앱 또한 dira로 만들어졌습니다.</figcaption>
  </figure>
</div>

<section className="wrap reveal">
  <h2>말하면 이루어집니다</h2>
  <ol className="steps">
    <li>
      <span className="sig">.md</span>
      <b>① 요구사항을 접수하세요</b>
      <p>자연스럽게 대화하듯이 무엇을 원하는지를 적어주시면 끝입니다. 나머지 귀찮고 복잡한
      일들은 에이전트가 알아서 합니다.</p>
    </li>
    <li>
      <span className="sig">.wip</span>
      <b>② 일사불란하게 움직입니다</b>
      <p>최초 요구사항을 받은 에이전트가 요구사항을 구체화하여 작업 단위 티켓으로 분리하고,
      적절한 페르소나를 가진 워커를 알아서 할당하여 에이전트간 협업을 통해 주신 요구사항을
      완료합니다.</p>
    </li>
    <li>
      <span className="sig">.done</span>
      <b>③ 끝이에요. 쉽죠?</b>
      <p>워커들이 뭘 읽고 어떻게 고치는지 실시간으로 확인할 수 있습니다. 진행중에 막히면
      사용자에게 물어도 봅니다. 그저 사람과 일하듯이 자연스럽게 요구하고 대답하다 보면,
      원하던 기능이 완성됩니다!</p>
    </li>
  </ol>
</section>

<div className="wrap stats reveal">
  <ul>
    <li><b>0</b><span>엔진 의존성<br/>bash + python3 표준 라이브러리</span></li>
    <li><b>6</b><span>이 레포에서 동시에 도는 워커</span></li>
    <li><b>631</b><span>자기 큐가 받은 티켓<br/>완료 622</span></li>
    <li><b>62시간</b><span>첫 커밋에서 첫 릴리스까지<br/>커밋 351</span></li>
  </ul>
  <p className="stats-note">2026-08-03 기준</p>
</div>

<section className="wrap reveal">
  <div className="gallery">
    <figure>
      <a className="zoom" href="/shots/barge.gif" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/barge.gif" loading="lazy" alt="세션 스트림이 도구 호출을 한 줄씩 늘려 가는 동안, 아래 입력창에 문장을 넣고 보내기를 누르자 그 문장이 참견 줄로 스트림에 나타나고 세션이 이어서 방향을 바꿉니다." width="1760" height="1408"/></a>
      <figcaption>
        "그럴 수 있죠 이해해요, 어떻게 사람이 완벽할까요?" 반드시 완벽한 요구사항을 줄
        필요가 없습니다. 가볍게 요구하고 작업중에도 참견할 수 있습니다.
      </figcaption>
      <p className="arrows"><a href="/docs/barge-in">도는 세션에 말 걸기</a></p>
    </figure>
    <figure>
      <a className="zoom" href="/shots/07-qa-thread.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/07-qa-thread.png" loading="lazy" alt="요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있습니다." width="1440" height="450"/></a>
      <figcaption>어련히 모르면 물어보지 않겠어요? 에이전트들이 업무를 수행하다 모르는 게 생기면 물어봅니다. 질문에 대답해주세요. 그럼 또 알아서 하러 갑니다.</figcaption>
      <p className="arrows"><a href="/docs/requirements#되묻기와-답변-대기">문의 · 답변</a></p>
    </figure>
    <figure>
      <a className="zoom" href="/shots/04-ticket-running.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img className="shot" src="/shots/04-ticket-running.png" loading="lazy" alt="진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계." width="1600" height="1000"/></a>
      <figcaption>일이 어떻게 진행되고 있는지 티켓 단위로 확인해볼 수 있습니다. 만약 내가 생각했던 것과 다른 방향으로 진행되고 있다면, 티켓을 할당 해제하여 중단시킬 수도 있고, 아직 시작하지 않은 티켓은 본문을 수정하여 내가 원하는 방향대로 자세히 수정할 수도 있습니다.</figcaption>
      <p className="arrows"><a href="/docs/screens#티켓-상세">업무 투명성</a></p>
    </figure>
  </div>
</section>

<section className="wrap reveal">
  <p className="eyebrow">설치</p>
  <h2>다운로드하여 설치하면 끝</h2>
  <p className="body" style={{ maxWidth: "44em" }}>
    받아서 열기만 하면 되고, 터미널을 켤 일이 없습니다.
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
        <li><b>엔진은 <code>claude</code>와 <code>codex</code> 중에 고릅니다.</b> 워커를 만들
        때 모델까지 같이 정하고, 목록에 없는 이름은 직접 적어 넣습니다. 만든 뒤에도 워커 화면의{" "}
        <code>엔진</code> 열을 눌러 바꿉니다. 세션 스트림과 참견은 <code>claude</code> 쪽에만
        있습니다. 앱은 Apple Silicon 맥에서만 돕니다</li>
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

<section className="wrap plan-sec reveal">
  <p className="eyebrow">플랜</p>
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
</section>

</main>

<div className="closing reveal">
  <div className="wrap">
    <h2>나만의 AI 팀을 만들어보세요</h2>
    <p className="body">
      dira와 함께 PC에 나만의 멀티 에이전트 시스템을 아주 쉽게 구축해보세요.
    </p>
    <div className="cta">
      <a className="btn btn-primary btn-lg" href={dmg}>macOS 앱 다운로드</a>
      <a className="btn btn-lg" href="https://github.com/proofer-tech/dira">GitHub에서 보기</a>
    </div>
  </div>
</div>

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
          <li><a href={dmg}>다운로드</a></li>
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

    </div>
  );
}
