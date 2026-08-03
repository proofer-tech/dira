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
  <h1>에이전트 팀이 일하는 걸 화면에서 본다</h1>
  <p class="body">
    할 일을 마크다운 파일 하나로 적어 두면, 1분마다 깨어나는 워커가 그걸 집어
    <code>claude -p</code> 세션에 넘깁니다. 세션이 지금 무엇을 하는지 화면에서 보고,
    <b>도는 중에 말을 겁니다.</b>
  </p>
  <div class="cta">
    <a class="btn btn-primary btn-lg" href="https://github.com/proofer-tech/dira/releases/latest">macOS 앱 받기</a>
    <a class="btn btn-lg" href="/docs/install">설치 가이드</a>
  </div>
  <p class="cta-note">v{{ version }} · macOS (Apple Silicon) · MIT · 자동 업데이트</p>

  <figure>
    <img class="shot" src="/shots/02-board.png" alt="dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있습니다." width="1600">
    <figcaption>이 화면은 <b>dira가 자기를 만드는 큐</b>입니다. 완료 622건이 전부 이 레포의 커밋입니다.</figcaption>
  </figure>
</div>

<section class="wrap">
  <p class="eyebrow">30초</p>
  <h2>파일 하나 쓰면 워커가 물어 간다</h2>
  <ol class="steps">
    <li>
      <b>① 티켓을 쓴다</b>
      <p>마크다운 파일 하나입니다. 무엇을 원하는지, 무엇이 되면 끝인지를 적습니다.
      큐는 그 파일이 담긴 <b>디렉터리 하나</b>가 전부입니다.</p>
    </li>
    <li>
      <b>② 워커가 문다</b>
      <p><b>워커</b>는 셸 스크립트 한 줄입니다. macOS에는 정해 둔 시각마다 명령을 자동으로
      실행해 주는 cron이 있습니다. 거기 걸어 두면 1분에 한 번 깨어나, 열린 티켓 하나를 골라
      <code>claude -p</code> 세션에 넘기고 끝날 때까지 기다립니다.</p>
    </li>
    <li>
      <b>③ 도는 걸 본다</b>
      <p>세션이 무엇을 읽고 무엇을 고치는지 화면에서 따라갑니다.
      <b>끝난 뒤 로그를 뒤지는 게 아니라, 도는 동안 말을 겁니다.</b></p>
    </li>
  </ol>
</section>

<section class="wrap">
  <div class="pillars">
    <div class="pillar">
      <span class="tag t-queue">큐</span>
      <h3>티켓 하나가 파일 하나다</h3>
      <p>디렉터리 하나가 큐의 전부입니다. 상태는 파일 이름 끝에 붙고, 나머지 정보는 파일 맨 위 frontmatter에 적습니다.</p>
    </div>
    <div class="pillar">
      <span class="tag t-worker">워커</span>
      <h3>워커 하나가 티켓 한 건을 문다</h3>
      <p>동시에 몇 건을 굴릴지는 워커 파일 개수가 정합니다. 더 돌리고 싶으면 워커를 하나 더 만드세요.</p>
    </div>
    <div class="pillar">
      <span class="tag t-ui">화면</span>
      <h3>도는 세션을 보고, 말을 건다</h3>
      <p>보드·티켓·워커·페르소나·프로토콜. 세션이 도는 중에 문장을 넣어 방향을 바꿉니다.</p>
    </div>
    <div class="pillar">
      <span class="tag t-engine">엔진</span>
      <h3>bash와 python3 표준 라이브러리</h3>
      <p>그 밖으로 나가지 않습니다. 늘 떠 있는 프로세스도, 데이터베이스도, 인덱스도 없습니다.</p>
    </div>
  </div>
</section>

<div class="wrap stats">
  <ul>
    <li><b>0</b><span>엔진 의존성<br>bash + python3 표준 라이브러리</span></li>
    <li><b>6</b><span>이 레포에서 동시에 도는 워커</span></li>
    <li><b>631</b><span>자기 큐가 받은 티켓<br>완료 622</span></li>
    <li><b>62시간</b><span>첫 커밋에서 첫 릴리스까지<br>커밋 351</span></li>
  </ul>
  <p class="stats-note">2026-08-03 기준</p>
</div>

<section class="wrap">
  <div class="gallery">
    <figure>
      <a class="zoom" href="/shots/barge.gif" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/barge.gif" loading="lazy" alt="세션 스트림이 도구 호출을 한 줄씩 늘려 가는 동안, 아래 입력창에 문장을 넣고 보내기를 누르자 그 문장이 참견 줄로 스트림에 나타나고 세션이 이어서 방향을 바꿉니다." width="1760" height="1408"></a>
      <figcaption>
        <b>실제 왕복입니다. 재현이 아닙니다.</b> 티켓은 <q>세 파일을 읽어 세 줄로 쓴다</q>였고,
        참견은 <q>지금 읽은 것까지만, 한 줄로</q>였습니다.
        세션은 <code>c.md</code>를 읽지 않고 멈춰 <b>한 줄짜리 파일</b>을 남겼습니다.
      </figcaption>
      <p class="arrows"><a href="/docs/barge-in">도는 세션에 말 걸기</a></p>
    </figure>
    <figure>
      <a class="zoom" href="/shots/07-qa-thread.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/07-qa-thread.png" loading="lazy" alt="요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있습니다." width="1440" height="450"></a>
      <figcaption>오른쪽 <code>awaiting:</code>에 걸린 해시는 <b>아직 없는 파일</b>입니다. 답변을 쓰면 그 파일이 생깁니다.</figcaption>
      <p class="arrows"><a href="/docs/ticket-writing">티켓 쓰는 법</a></p>
    </figure>
    <figure>
      <a class="zoom" href="/shots/04-ticket-running.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/04-ticket-running.png" loading="lazy" alt="진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계." width="1600" height="1000"></a>
      <figcaption>티켓 한 장의 전부. 왼쪽은 사람이 쓴 마크다운, 오른쪽 <code>session_id</code>·<code>pid</code>·<code>owner</code>·<code>inbox</code>는 <b>디스패처가 쓰고 사람은 건드리지 않습니다.</b></figcaption>
      <p class="arrows"><a href="/docs/states">상태는 파일명</a></p>
    </figure>
  </div>
</section>

<section class="wrap">
  <p class="eyebrow">60초</p>
  <h2>설치는 clone이 끝이다</h2>
  <p class="body" style="max-width:44em">
    엔진은 <b>bash와 python3 표준 라이브러리</b> 밖으로 나가지 않습니다.
    빌드도, 패키지 매니저도, 설정 파일도 없습니다.
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
        <li><b>루트를 어디에도 적지 않습니다.</b> <code>workers/</code>의 부모 디렉터리가 곧 큐입니다</li>
        <li><b>두 줄인 이유는 cron이 1분보다 잘게는 못 돌기 때문입니다.</b> 30초 간격을 그렇게 냅니다.
        한 줄에 <code>;</code>로 붙이면 안 됩니다. 워커는 앞 세션이 끝나야 다음으로 넘어갑니다.
        뒤에 붙인 쪽이 30초 뒤가 아니라 앞 세션이 끝난 뒤에 뜹니다</li>
        <li><b>멈추려면 그 두 줄을 지웁니다</b></li>
        <li>돌리기 전에 <code>w1.sh dryrun</code>을 걸면 어떤 티켓이 뽑히는지, 프롬프트가 어떻게
        나가는지만 먼저 봅니다</li>
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
  <p class="body" style="max-width:44em; margin-bottom:32px">아래는 아직 못 만든 것이 아니라, 안 만들기로 한 것입니다.</p>
  <ul class="limits">
    <li><b>서버로 배포하지 않습니다.</b> 호스팅도 도메인도 원격 접속도 없습니다. 앱은 설치한 맥에서만 돌고, 그 맥의 파일을 직접 읽고 씁니다.</li>
    <li><b>로그인도 계정 구분도 없습니다.</b> 그 맥의 파일 권한이 곧 권한입니다.</li>
    <li><b>데스크톱 앱은 macOS(Apple Silicon)만 됩니다.</b> 엔진 자체는 macOS와 Linux에서 돕니다.</li>
    <li><b>실시간 알림이 없습니다.</b> 화면이 주기적으로 다시 읽어 옵니다. 모바일 레이아웃도 없습니다.</li>
    <li><b>프로젝트를 자동으로 찾지 않습니다.</b> 디스크를 훑지 않고, 쓸 프로젝트를 직접 등록합니다.</li>
    <li><b>우선순위가 없습니다.</b> 순서는 만든 날짜와 <code>deps</code>(먼저 끝나야 하는 티켓) 둘이 정합니다.</li>
    <li><b>티켓 수백 건 규모를 전제합니다.</b> 워커가 깨어날 때마다 큐 디렉터리를 통째로 훑습니다. 인덱스가 없습니다.</li>
    <li><b>워커를 만들 때마다 macOS가 <code>앱 관리</code> 권한을 묻습니다.</b> 한 번 허용해도 다음 등록 때 또 묻습니다.</li>
  </ul>
</section>

<section class="wrap">
  <p class="eyebrow">플랜</p>
  <h2>지금은 전부 무료다</h2>
  <p class="body" style="max-width:40em">
    엔진도 앱도 MIT 라이선스입니다. 계정도, 서버도, 요금도 없습니다.
    <b>여럿이 한 큐를 같이 쓰는 방법을 준비하고 있습니다.</b> 날짜도 가격도 아직 약속하지 않습니다.
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
      이름은 <code>dir</code>와 <code>jira</code>를 합친 것입니다. 큐가 디렉터리 하나라서 <code>dir</code>이고,
      그 디렉터리를 티켓으로 보는 도구라서 <code>jira</code>에서 따왔습니다.
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
        <p class="fnote">이 페이지의 화면은 전부 실제 큐에서 찍었습니다. 목업이 없습니다.</p>
      </div>
      <div class="fcol">
        <h4>제품</h4>
        <ul>
          <li><a href="https://github.com/proofer-tech/dira/releases/latest">다운로드</a></li>
          <li><a href="https://github.com/proofer-tech/dira/releases">릴리스</a></li>
          <li><a href="/docs/what-is-dira">엔진</a></li>
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
