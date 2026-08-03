<script setup>
import { onMounted, ref } from "vue";
import { useData } from "vitepress";
const { theme } = useData();
// 초기값은 빌드 시점의 `apps/desktop/package.json`. 비우면 hydration이 어긋난다.
const version = ref(theme.value.diraVersion);
onMounted(async () => {
  try {
    const r = await fetch(
      "https://api.github.com/repos/proofer-tech/dira/releases/latest",
    );
    const tag = (await r.json()).tag_name;
    if (tag) version.value = tag.replace(/^v/, "");
  } catch {
    // 릴리스를 못 읽으면 초기값 그대로 둔다 — 화면에도 콘솔에도 아무것도 안 띄운다.
  }
});
</script>

<template>

<div class="ann">
  <div class="wrap">
    <span>자동 업데이트를 켜고 최신 버전(v{{ version }})의 dira를 써보세요!</span>
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
  <p class="eyebrow">로컬 멀티 에이전트 매니지먼트 시스템</p>
  <h1>나만의 AI 팀을 만들어보세요</h1>
  <p class="body">
    요구사항을 정말 아무렇게나 던져도 찰떡같이 알아들어 티켓을 나누고 에이전트간 협업을 통해
    완수하며 그 과정을 마치 jira처럼 실시간으로 볼 수 있습니다. PC에 나만의 멀티 에이전트
    시스템을 아주 쉽게 구축해보세요.
  </p>
  <div class="cta">
    <a class="btn btn-primary btn-lg" href="https://github.com/proofer-tech/dira/releases/latest">macOS 앱 받기</a>
    <a class="btn btn-lg" href="/docs/install">설치 가이드</a>
  </div>
  <p class="cta-note">with Claude Code · Codex</p>

  <figure>
    <img class="shot" src="/shots/board.gif" alt="dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있고, 그중 한 장이 다음 레인으로 건너갑니다." width="1600" height="1000">
    <figcaption>놀라운 사실: dira 앱 또한 dira로 만들어졌습니다.</figcaption>
  </figure>
</div>

<section class="wrap">
  <h2>말하면 이루어집니다</h2>
  <ol class="steps">
    <li>
      <b>① 요구사항을 접수하세요</b>
      <p>자연스럽게 대화하듯이 무엇을 원하는지를 적어주시면 끝입니다. 나머지 귀찮고 복잡한
      일들은 에이전트가 알아서 합니다.</p>
    </li>
    <li>
      <b>② 일사불란하게 움직입니다</b>
      <p>최초 요구사항을 받은 에이전트가 요구사항을 구체화하여 작업 단위 티켓으로 분리하고,
      적절한 페르소나를 가진 워커를 알아서 할당하여 에이전트간 협업을 통해 주신 요구사항을
      완료합니다.</p>
    </li>
    <li>
      <b>③ 끝이에요. 쉽죠?</b>
      <p>워커들이 뭘 읽고 어떻게 고치는지 실시간으로 확인할 수 있습니다. 진행중에 막히면
      사용자에게 물어도 봅니다. 그저 사람과 일하듯이 자연스럽게 요구하고 대답하다 보면,
      원하던 기능이 완성됩니다!</p>
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
        "그럴 수 있죠 이해해요, 어떻게 사람이 완벽할까요?" 반드시 완벽한 요구사항을 줄
        필요가 없습니다. 가볍게 요구하고 작업중에도 참견할 수 있습니다.
      </figcaption>
      <p class="arrows"><a href="/docs/barge-in">도는 세션에 말 걸기</a></p>
    </figure>
    <figure>
      <a class="zoom" href="/shots/07-qa-thread.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/07-qa-thread.png" loading="lazy" alt="요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있습니다." width="1440" height="450"></a>
      <figcaption>어련히 모르면 물어보지 않겠어요? 에이전트들이 업무를 수행하다 모르는 게 생기면 물어봅니다. 질문에 대답해주세요. 그럼 또 알아서 하러 갑니다.</figcaption>
      <p class="arrows"><a href="/docs/requirements#되묻기와-답변-대기">문의 · 답변</a></p>
    </figure>
    <figure>
      <a class="zoom" href="/shots/04-ticket-running.png" target="_blank" rel="noopener" title="원본 크기로 열기"><img class="shot" src="/shots/04-ticket-running.png" loading="lazy" alt="진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계." width="1600" height="1000"></a>
      <figcaption>일이 어떻게 진행되고 있는지 티켓 단위로 확인해볼 수 있습니다. 만약 내가 생각했던 것과 다른 방향으로 진행되고 있다면, 티켓을 할당 해제하여 중단시킬 수도 있고, 아직 시작하지 않은 티켓은 본문을 수정하여 내가 원하는 방향대로 자세히 수정할 수도 있습니다.</figcaption>
      <p class="arrows"><a href="/docs/ticket-writing#고칠-수-있는-티켓-못-고치는-티켓">업무 투명성</a></p>
    </figure>
  </div>
</section>

<section class="wrap">
  <p class="eyebrow">설치</p>
  <h2>다운로드하여 설치하면 끝</h2>
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
        <li><b>엔진은 <code>claude</code>와 <code>codex</code> 중에 고릅니다.</b> 워커를 만들
        때 모델까지 같이 정하고, 목록에 없는 이름은 직접 적어 넣습니다. 만든 뒤에도 워커 화면의
        <code>엔진</code> 열을 눌러 바꿉니다. 세션 스트림과 참견은 <code>claude</code> 쪽에만
        있습니다. 앱은 Apple Silicon 맥에서만 돕니다</li>
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
    로컬 엔진과 앱은 영원히 무료로 제공합니다. dira는 빌더들의 멀티 에이전트 생태계를 응원합니다.
  </p>
  <div class="cta" style="justify-content:flex-start; margin-top:24px">
    <a class="btn" href="https://github.com/proofer-tech/dira">GitHub에서 Watch</a>
  </div>
</section>

</main>

<div class="closing">
  <div class="wrap">
    <h2>나만의 AI 팀을 만들어보세요</h2>
    <p class="body">
      dira와 함께 PC에 나만의 멀티 에이전트 시스템을 아주 쉽게 구축해보세요.
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
        <p class="fnote">로컬 멀티 에이전트 매니지먼트 시스템</p>
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
    </div>
  </div>
</footer>

</template>
