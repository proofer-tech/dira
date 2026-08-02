<script setup>
import { useData } from "vitepress";
const { theme } = useData();
const version = theme.value.diraVersion;
</script>

<template>

<div class="ann">
  <div class="wrap">
    <span>v{{ version }}가 나와 있습니다. 앱이 스스로 받습니다.</span>
    <a href="https://github.com/proofer-tech/dira/releases">릴리스 보기</a>
  </div>
</div>

<header>
  <div class="wrap">
    <a class="brand" href="/" aria-label="dira">
      <svg viewBox="0 0 32 32" fill-rule="evenodd" aria-hidden="true"><path d="M4.5 2H11.5L15.5 8H27.5A2.5 2.5 0 0 1 30 10.5V27.5A2.5 2.5 0 0 1 27.5 30H4.5A2.5 2.5 0 0 1 2 27.5V4.5A2.5 2.5 0 0 1 4.5 2ZM9.5 12H22.5A1.5 1.5 0 0 1 24 13.5V15A3 3 0 0 0 24 21V22.5A1.5 1.5 0 0 1 22.5 24H9.5A1.5 1.5 0 0 1 8 22.5V21A3 3 0 0 0 8 15V13.5A1.5 1.5 0 0 1 9.5 12Z"/></svg>
      dira
    </a>
    <nav>
      <a class="btn" href="/docs/">매뉴얼</a>
      <a class="btn" href="https://github.com/proofer-tech/dira">GitHub</a>
      <a class="btn btn-primary" href="https://github.com/proofer-tech/dira/releases/latest">앱 받기</a>
    </nav>
  </div>
</header>

<main>

<div class="hero wrap">
  <p class="eyebrow">로컬 에이전트 러너</p>
  <h1>에이전트 팀을 화면으로 본다</h1>
  <p class="body">
    티켓을 큐에 넣으면 cron에 물린 워커가 <code>claude -p</code> 세션에 넘긴다.
    도는 동안 무엇을 하고 있는지 화면에서 보고, <b>도는 세션에 말을 건다.</b>
  </p>
  <div class="cta">
    <a class="btn btn-primary btn-lg" href="https://github.com/proofer-tech/dira/releases/latest">macOS 앱 받기</a>
    <a class="btn btn-lg" href="/docs/install">설치 가이드</a>
  </div>
  <p class="cta-note">v{{ version }} · macOS (Apple Silicon) · MIT · 자동 업데이트</p>
</div>

<section class="wrap">
  <p class="eyebrow">30초</p>
  <h2>파일 하나 쓰면, cron이 물어 간다</h2>
  <ol class="steps">
    <li>
      <b>① 티켓을 쓴다</b>
      <p>마크다운 파일 하나다. 무엇을 원하는지와 무엇이 되면 끝인지를 적는다.
      큐는 그 파일들이 담긴 <b>디렉터리 하나</b>가 전부다.</p>
    </li>
    <li>
      <b>② 워커가 문다</b>
      <p><b>워커</b>는 cron에 걸린 셸 스크립트 한 줄이다. 1분에 한 번 깨어나 열린 티켓
      하나를 골라 <code>claude -p</code> 세션에 넘기고, 그 세션이 끝날 때까지 기다린다.</p>
    </li>
    <li>
      <b>③ 도는 걸 본다</b>
      <p>세션이 무엇을 읽고 무엇을 고치는지 화면에서 따라간다.
      <b>끝난 뒤 로그를 뒤지는 게 아니라 도는 동안 말을 건다.</b></p>
    </li>
  </ol>
</section>

<!-- SECTION 3: 4기둥 — Task 4 -->
<!-- SECTION 4: 실제 화면 — Task 4 -->

<section class="wrap">
  <p class="eyebrow">60초</p>
  <h2>설치는 clone이 끝이다</h2>
  <p class="body" style="max-width:44em">
    엔진은 <b>bash와 python3 표준 라이브러리</b> 밖으로 나가지 않는다.
    빌드도, 패키지 매니저도, 설정 파일도 없다.
  </p>
  <div class="two" style="margin-top:32px">
    <div>
      <pre><span class="c"># ① 엔진을 받는다</span>
git clone \
  https://github.com/proofer-tech/dira.git \
  ~/Projects/dira

<span class="c"># ② 워커 하나. 놓인 자리가 곧 큐의 루트다</span>
mkdir -p ~/myproject/.dira/workers
cat &gt; ~/myproject/.dira/workers/w1.sh &lt;&lt;'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x ~/myproject/.dira/workers/w1.sh

<span class="c"># ③ cron 두 줄</span>
* * * * * ~/myproject/.dira/workers/w1.sh
* * * * * sleep 30; ~/…/w1.sh</pre>
    </div>
    <div>
      <ul class="marks">
        <li><b>루트를 어디에도 적지 않는다.</b> <code>workers/</code>의 부모가 큐다</li>
        <li><b>두 줄인 이유는 cron의 최소 단위가 분이라서다.</b> 30초 폴링을 그렇게 낸다.
        한 줄에 <code>;</code>로 붙이면 안 된다 — 워커는 동기 프로세스라 뒷반쪽이
        30초 뒤가 아니라 앞 세션이 끝난 뒤에 뜬다</li>
        <li><b>중지는 그 두 줄을 지우는 것이다</b></li>
        <li>돌리기 전에 <code>w1.sh dryrun</code>으로 선정 결과와 프롬프트만 먼저 본다</li>
      </ul>
      <p class="arrows">
        <a href="/docs/install">전체 설치 가이드</a>
        <a href="/docs/first-ticket">첫 티켓 굴리기</a>
        <a href="/docs/auth">cron 인증 설정</a>
      </p>
    </div>
  </div>
</section>

<!-- SECTION 6: 여기 없는 것 — Task 4 -->

<section class="wrap">
  <p class="eyebrow">플랜</p>
  <h2>지금은 전부 무료다</h2>
  <p class="body" style="max-width:40em">
    엔진도 앱도 MIT다. 계정도, 서버도, 요금도 없다.
    <b>여럿이 한 큐를 같이 쓰는 방법을 준비 중이다</b> — 날짜도 가격도 아직 약속하지 않는다.
  </p>
  <div class="cta" style="justify-content:flex-start; margin-top:24px">
    <a class="btn" href="https://github.com/proofer-tech/dira">GitHub에서 Watch</a>
  </div>
</section>

</main>

<div class="closing">
  <div class="wrap">
    <h2>큐는 디렉터리 하나다</h2>
    <p class="body">
      이름은 <code>dir</code> + <code>jira</code>다. 큐가 디렉터리 하나라서 <code>dir</code>이고,
      그 디렉터리를 티켓으로 보는 도구라서 <code>jira</code>의 오마주다.
    </p>
    <div class="cta">
      <a class="btn btn-primary btn-lg" href="https://github.com/proofer-tech/dira/releases/latest">macOS 앱 받기</a>
      <a class="btn btn-lg" href="https://github.com/proofer-tech/dira">GitHub에서 보기</a>
    </div>
  </div>
</div>

<footer>
  <div class="wrap">
    <div class="fgrid">
      <div>
        <div class="fbrand">
          <svg viewBox="0 0 32 32" fill-rule="evenodd" aria-hidden="true"><path d="M4.5 2H11.5L15.5 8H27.5A2.5 2.5 0 0 1 30 10.5V27.5A2.5 2.5 0 0 1 27.5 30H4.5A2.5 2.5 0 0 1 2 27.5V4.5A2.5 2.5 0 0 1 4.5 2ZM9.5 12H22.5A1.5 1.5 0 0 1 24 13.5V15A3 3 0 0 0 24 21V22.5A1.5 1.5 0 0 1 22.5 24H9.5A1.5 1.5 0 0 1 8 22.5V21A3 3 0 0 0 8 15V13.5A1.5 1.5 0 0 1 9.5 12Z"/></svg>
          dira
        </div>
        <p class="fnote">이 페이지의 화면은 전부 실제 큐에서 찍었다. 목업이 없다.</p>
      </div>
      <div class="fcol">
        <h4>제품</h4>
        <ul>
          <li><a href="https://github.com/proofer-tech/dira/releases/latest">다운로드</a></li>
          <li><a href="https://github.com/proofer-tech/dira/releases">릴리스</a></li>
          <li><a href="#engine">엔진</a></li>
        </ul>
      </div>
      <div class="fcol">
        <h4>문서</h4>
        <ul>
          <li><a href="/docs/">매뉴얼</a></li>
          <li><a href="/docs/install">설치 가이드</a></li>
          <li><a href="https://github.com/proofer-tech/dira#readme">README</a></li>
          <li><a href="https://github.com/proofer-tech/dira/tree/master/templates">템플릿</a></li>
        </ul>
      </div>
      <div class="fcol">
        <h4>레포</h4>
        <ul>
          <li><a href="https://github.com/proofer-tech/dira">proofer-tech/dira</a></li>
          <li><a href="https://github.com/proofer-tech/dira/issues">이슈</a></li>
          <li><a href="https://github.com/proofer-tech/dira/blob/master/LICENSE">MIT 라이선스</a></li>
        </ul>
      </div>
    </div>
    <div class="fbot">
      <span>© 2026 프루퍼 주식회사. MIT.</span>
      <a href="/terms">이용약관</a>
      <a href="/privacy">개인정보처리방침</a>
      <span class="sep">bash + python3 표준 라이브러리</span>
    </div>
  </div>
</footer>

</template>
