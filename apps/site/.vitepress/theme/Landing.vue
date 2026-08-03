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
  <h1>에이전트 팀이 일하는 걸 화면에서 봅니다</h1>
  <p class="body">
    할 일을 마크다운 파일로 적어 두면, 30초마다 깨어나는 워커가 그걸 집어
    <code>claude -p</code> 세션에 넘깁니다. 세션이 지금 무엇을 하는지 화면에서 보고,
    도는 중에 말을 겁니다.
  </p>
  <div class="cta">
    <a class="btn btn-primary btn-lg" href="https://github.com/proofer-tech/dira/releases/latest">macOS 앱 받기</a>
    <a class="btn btn-lg" href="/docs/install">설치 가이드</a>
  </div>
  <p class="cta-note">v{{ version }} · macOS (Apple Silicon) · MIT · 자동 업데이트</p>

  <figure>
    <img class="shot" src="/shots/02-board.png" alt="dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있습니다." width="1600">
    <figcaption>이 화면은 dira가 자기를 만드는 큐입니다. 카드에 적힌 티켓이 전부 dira 자신을 고치는 일입니다.</figcaption>
  </figure>
</div>

<section class="wrap">
  <h2>파일을 쓰면 워커가 물어 갑니다</h2>
  <ol class="steps">
    <li>
      <b>① 티켓을 씁니다</b>
      <p>마크다운 파일 하나입니다. 무엇을 원하는지, 무엇이 되면 끝인지를 적습니다.
      그 파일이 담긴 디렉터리가 곧 큐입니다.</p>
    </li>
    <li>
      <b>② 워커가 뭅니다</b>
      <p>워커는 셸 스크립트 한 줄입니다. macOS에는 정해 둔 시각마다 명령을 자동으로
      실행해 주는 cron이 있고, 프로젝트를 만들 때 앱이 그 워커를 거기 걸어 둡니다. 30초에
      한 번씩 깨어나 열린 티켓 하나를 골라 <code>claude -p</code> 세션에 넘기고 끝날 때까지
      기다립니다.</p>
    </li>
    <li>
      <b>③ 도는 걸 봅니다</b>
      <p>세션이 무엇을 읽고 무엇을 고치는지 화면에서 따라갑니다. 도구 호출이 한 줄씩 쌓이고,
      그 사이에 말을 겁니다.</p>
    </li>
  </ol>
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
        실제 왕복입니다. 티켓은 <q>세 파일을 읽어 세 줄로 쓴다</q>였고,
        참견은 <q>지금 읽은 것까지만 정리하고, summary.md는 한국어 한 줄로 줄여주세요.</q>였습니다.
        세션은 <code>c.md</code>를 읽지 않고 멈춰 한 줄짜리 파일을 남겼습니다.
      </figcaption>
      <p class="arrows"><a href="/docs/barge-in">도는 세션에 말 걸기</a></p>
    </figure>
    <figure>
      <a class="zoom" href="/shots/07-qa-thread.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/07-qa-thread.png" loading="lazy" alt="요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있습니다." width="1440" height="450"></a>
      <figcaption>질문에 답을 쓰면 그 답이 큐에 티켓 파일로 놓입니다. 오른쪽 <code>awaiting:</code>에 걸린 해시가 그 파일입니다.</figcaption>
      <p class="arrows"><a href="/docs/ticket-writing">티켓 쓰는 법</a></p>
    </figure>
    <figure>
      <a class="zoom" href="/shots/04-ticket-running.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/04-ticket-running.png" loading="lazy" alt="진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계." width="1600" height="1000"></a>
      <figcaption>티켓 한 장의 전부. 왼쪽은 사람이 쓴 마크다운, 오른쪽 <code>session_id</code>·<code>pid</code>·<code>owner</code>·<code>inbox</code>는 디스패처가 쓰고 사람은 건드리지 않습니다.</figcaption>
      <p class="arrows"><a href="/docs/states">상태는 파일명</a></p>
    </figure>
  </div>
</section>

<section class="wrap">
  <p class="eyebrow">설치</p>
  <h2>.dmg 하나에 엔진까지 들어 있습니다</h2>
  <p class="body" style="max-width:44em">
    받아서 열기만 하면 되고, 터미널을 켤 일이 없습니다.
  </p>
  <div class="two" style="margin-top:32px">
    <div>
      <ul class="marks">
        <li><b>① <code>.dmg</code>를 열고 끌어다 놓습니다.</b> <code>dira.app</code>을
        <code>응용 프로그램</code>으로 옮기면 그것으로 설치가 끝납니다. 서명·공증된 빌드라
        처음 열 때 맥이 낯선 앱이라며 막지 않습니다</li>
        <li><b>② 앱을 처음 열면 폼이 펼쳐져 있습니다.</b> 이름과 프로젝트 폴더를 넣고
        <code>프로젝트 만들기</code>를 누릅니다</li>
        <li><b>③ 30초 뒤부터 워커가 큐를 훑습니다.</b> 티켓을 써 두면 그때부터 물어 갑니다</li>
      </ul>
    </div>
    <div>
      <ul class="marks">
        <li><b>에이전트 CLI 하나만 미리 깔아 두면 됩니다.</b> 기본값은 <code>claude</code>이고,
        깔려 있는지는 앱 <code>설정</code>이 첫 줄에서 말해 줍니다. cron이 쓸 토큰도 그 자리에서
        발급합니다</li>
        <li><b>화면 없이 엔진만 돌릴 수도 있습니다.</b> Linux에서 굴리거나 화면이 필요 없으면
        레포를 직접 받는 <a href="/docs/install#앱-없이-엔진만-쓰기">그 갈래</a>로 가세요</li>
      </ul>
      <p class="arrows">
        <a href="/docs/install">전체 설치 가이드</a>
        <a href="/docs/first-ticket">첫 프로젝트 만들기</a>
        <a href="/docs/cron">엔진만으로 돌리기</a>
      </p>
    </div>
  </div>
</section>

<section class="wrap">
  <p class="eyebrow">플랜</p>
  <h2>전부 무료입니다</h2>
  <p class="body" style="max-width:40em">
    엔진도 앱도 MIT 라이선스입니다. 계정도 서버도 없고, 낼 요금도 없습니다. 받아서 그냥 씁니다.
  </p>
  <div class="cta" style="justify-content:flex-start; margin-top:24px">
    <a class="btn" href="https://github.com/proofer-tech/dira">GitHub에서 Watch</a>
  </div>
</section>

</main>

<div class="closing">
  <div class="wrap">
    <h2>디렉터리를 티켓으로 봅니다</h2>
    <p class="body">
      이름은 <code>dir</code>와 <code>jira</code>를 합친 것입니다. 큐가 디렉터리 하나라서 <code>dir</code>이고,
      티켓으로 보는 도구라서 <code>jira</code>에서 따왔습니다.
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
