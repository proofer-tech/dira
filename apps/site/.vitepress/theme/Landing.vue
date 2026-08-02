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

  <figure>
    <img class="shot" src="/shots/02-board.png" alt="dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있다." width="1600">
    <figcaption>이 화면은 <b>dira가 자기 자신을 만들고 있는 큐</b>다. 완료 387건이 전부 이 레포의 커밋이다.</figcaption>
  </figure>
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

<section class="wrap">
  <div class="pillars">
    <div class="pillar">
      <span class="tag t-queue">큐</span>
      <h3>티켓 하나가 파일 하나다</h3>
      <p>디렉터리 하나가 큐 전부다. 상태는 파일명 접미사에 있고, 나머지는 frontmatter다. DB도 인덱스도 없다.</p>
    </div>
    <div class="pillar">
      <span class="tag t-worker">워커</span>
      <h3>크론잡 하나가 티켓 한 건을 문다</h3>
      <p>동시성은 설정값이 아니라 워커 파일의 개수다. 더 돌리려면 워커를 하나 더 만든다.</p>
    </div>
    <div class="pillar">
      <span class="tag t-ui">화면</span>
      <h3>도는 세션을 보고, 말을 건다</h3>
      <p>보드·티켓·워커·페르소나·프로토콜. 끝난 뒤 로그를 뒤지는 대신 도는 동안 개입한다.</p>
    </div>
    <div class="pillar">
      <span class="tag t-engine">엔진</span>
      <h3>bash와 python3 표준 라이브러리</h3>
      <p>그 밖으로 나가지 않는다. 상주 루프도, DB도, 인덱스도 없다.</p>
    </div>
  </div>
</section>

<div class="wrap stats">
  <ul>
    <li><b>0</b><span>엔진 의존성<br>bash + python3 표준 라이브러리</span></li>
    <li><b>6</b><span>이 레포에서 동시에 도는 워커</span></li>
    <li><b>405</b><span>자기 큐가 처리한 티켓<br>완료 397</span></li>
    <li><b>4일</b><span>첫 커밋에서 첫 릴리스까지<br>커밋 389</span></li>
  </ul>
  <p class="stats-note">2026-08-01 기준</p>
</div>

<section class="wrap">
  <div class="gallery">
    <figure>
      <img class="shot" src="/shots/barge.gif" loading="lazy" alt="세션 스트림이 도구 호출을 한 줄씩 늘려 가는 동안, 아래 입력창에 문장을 넣고 보내기를 누르자 그 문장이 참견 줄로 스트림에 나타나고 세션이 이어서 방향을 바꾼다." width="1760">
      <figcaption>
        <b>실제 왕복이다. 재현이 아니다.</b> 티켓은 <q>세 파일을 읽어 세 줄로 쓴다</q>였고,
        참견은 <q>지금 읽은 것까지만, 한 줄로</q>였다.
        세션은 <code>c.md</code>를 읽지 않고 멈춰 <b>한 줄짜리 파일</b>을 남겼다.
      </figcaption>
      <p class="arrows"><a href="/docs/barge-in">도는 세션에 말 걸기</a></p>
    </figure>
    <figure>
      <img class="shot" src="/shots/07-qa-thread.png" loading="lazy" alt="요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있다." width="1600">
      <figcaption>오른쪽 <code>awaiting:</code>에 걸린 해시는 <b>아직 없는 파일</b>이다. 답변을 쓰면 그 파일이 생긴다.</figcaption>
      <p class="arrows"><a href="/docs/ticket-writing">티켓 쓰는 법</a></p>
    </figure>
    <figure>
      <img class="shot" src="/shots/04-ticket-running.png" loading="lazy" alt="진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계." width="1600">
      <figcaption>티켓 한 장의 전부. 왼쪽은 사람이 쓴 마크다운, 오른쪽 <code>session_id</code>·<code>pid</code>·<code>owner</code>·<code>inbox</code>는 <b>디스패처가 쓰고 사람은 건드리지 않는다.</b></figcaption>
      <p class="arrows"><a href="/docs/states">상태는 파일명</a></p>
    </figure>
  </div>
</section>

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

<section class="wrap">
  <p class="eyebrow">먼저 알아야 할 것</p>
  <h2>여기 없는 것</h2>
  <p class="body" style="max-width:44em; margin-bottom:32px">비목표는 아직 못 만든 것이 아니라 안 만들기로 한 것이다.</p>
  <ul class="limits">
    <li><b>서버로 배포하지 않는다.</b> 호스팅·도메인·원격 접속이 없다. 앱은 당신 맥에서 돌고 그 맥의 파일시스템에 붙는다.</li>
    <li><b>인증·멀티유저가 없다.</b> 파일시스템 권한이 곧 권한이다.</li>
    <li><b>데스크톱 앱은 macOS(Apple Silicon)뿐이다.</b> 엔진 자체는 macOS와 Linux에서 돈다.</li>
    <li><b>실시간 푸시가 없다.</b> 폴링이다. 모바일 레이아웃도 없다.</li>
    <li><b>프로젝트를 자동으로 찾지 않는다.</b> 디스크를 스캔하지 않고 당신이 등록한다.</li>
    <li><b>우선순위가 없다.</b> 순서는 생성일과 <code>deps</code>뿐이다.</li>
    <li><b>티켓 수백 건 규모를 전제한다.</b> 매 tick마다 큐를 glob으로 훑는다. 인덱스가 없다.</li>
    <li><b>워커를 만들 때마다 macOS가 <code>앱 관리</code> 권한을 묻는다.</b> 승인이 다음 등록까지 남지 않는다.</li>
  </ul>
</section>

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
