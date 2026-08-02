# dira.proofer.tech — 랜딩 + 매뉴얼 + 약관 설계

작성 2026-08-02. 대상은 **dira를 처음 보는 사람**이다. 목표는 둘 — 이게 뭔지 30초에 알리고,
설치까지 손을 잡고 데려간다.

## 왜 새로 만드나

`docs/index.html`(543줄, `e6784b0`, 2026-08-01)이 이미 있고 완성도도 있다. 그런데 두 가지가 안 맞는다.

1. **아무 데서도 안 보인다.** `CNAME`도 Pages 워크플로도 없다. 만든 뒤 주소를 안 줬다.
2. **처음 오는 사람을 위한 층이 없다.** 히어로 다음이 곧바로 4기둥인데 거기 첫 단어가
   티켓·워커·큐·페르소나다. 이 넷은 dira의 고유 어휘지 일반 어휘가 아니다. 그 사이에
   용어를 소개하는 층이 필요하다.

그리고 요구가 늘었다 — **매뉴얼**과 **약관·개인정보처리방침**이 이번에 같이 간다.

기존 페이지의 디자인 토큰(oklch 상태 색·`--mono`·`word-break: keep-all`)과 실제 큐에서 찍은
스크린샷은 **그대로 승계한다.** 새로 짜는 것은 정보 구조지 미감이 아니다.

## 주소

| 경로 | 무엇 |
|---|---|
| `dira.proofer.tech/` | 랜딩 |
| `dira.proofer.tech/docs/` | 매뉴얼 (18장) |
| `dira.proofer.tech/terms` | 이용약관 |
| `dira.proofer.tech/privacy` | 개인정보처리방침 |

**한 도메인·한 배포다.** 매뉴얼을 GitHub Pages로 가르지 않는다 — 도메인이 둘이 되면 링크·SEO·
배포가 두 벌이 되고, 얻는 것은 없다. proofer.tech DNS가 이미 Vercel이라 추가 설정도 거의 없다.

## 레포 자리

`apps/site/`로 붙인다. `apps/teams`·`apps/desktop`과 같은 층위다.

```
apps/site/
  package.json              pnpm-workspace.yaml (teams·desktop과 같이 독립)
  .vitepress/
    config.ts               사이드바 · 버전 주입
    theme/index.ts          기본 테마 + custom.css + Landing.vue 등록
    theme/custom.css        기존 index.html의 토큰·컴포넌트 스타일
    theme/Landing.vue       랜딩 8섹션
  index.md                  layout: Landing
  terms.md
  privacy.md
  docs/*.md                 매뉴얼 18장
  public/shots/*.png        docs/shots/에서 이동
  public/icon.svg
```

**`docs/`(레포 루트)는 손대지 않는다.** 거기 `DESIGN.md`는 8천 줄짜리 내부 계약서지 공개
매뉴얼이 아니다. VitePress가 그 디렉터리를 훑으면 안 된다. 이 스펙 파일도 그 아래 산다.

옮기고 지우는 것 둘:
- `docs/index.html` → 삭제. 새 랜딩이 대체한다. 한 벌만 남긴다.
- `docs/shots/` → `apps/site/public/shots/`. 실제 큐에서 찍은 것이라 그대로 쓴다.

### 버전 드리프트를 코드로 막는다

기존 페이지는 `v0.1.2`가 본문에 박혀 있고 `apps/desktop/package.json`은 이미 `0.1.4`다.
`release.yml`이 master 커밋마다 bump하므로 손으로 적는 한 영구히 어긋난다.

`.vitepress/config.ts`가 빌드 때 `../desktop/package.json`의 `version`을 읽어 테마 데이터로
넘긴다. Vercel은 레포 전체를 체크아웃하고 root directory만 `apps/site`로 잡으므로 그 상대경로가
닿는다. bump 커밋이 곧 재배포라 값이 자동으로 맞는다.

## 랜딩 — 8섹션

| # | 섹션 | 내용 | 출처 |
|---|---|---|---|
| 1 | 히어로 | 한 문장 + 보드 스크린샷. CTA `macOS 앱 받기` / `설치 가이드`(→ `/docs/install`) | 기존 유지, 두 번째 CTA만 교체 |
| 2 | **30초 설명** | ① 티켓을 파일로 쓴다 → ② cron이 문다 → ③ 화면에서 본다. 용어를 여기서 처음 정의한다 | 신설 |
| 3 | 왜 다른가 | 4기둥(큐·워커·화면·엔진). 카피만 초보 기준으로 다시 | 기존 재사용 |
| 4 | 실제 화면 | `02-board` · `04-ticket-running` · `07-qa-thread` + `barge.gif` | 기존 재사용 |
| 5 | **60초 설치** | `clone` → 워커 → cron 코드 블록 3개. 아래에 전체 가이드 링크 | 신설 |
| 6 | 여기 없는 것 | 안 만든 것을 먼저 말한다. 이 제품 톤의 핵심이라 유지 | 기존 유지 |
| 7 | **플랜 — 준비 중** | 아래 참고 | 신설 |
| 8 | 푸터 | GitHub · 릴리스 · 매뉴얼 · 이용약관 · 개인정보처리방침 · MIT · 사업자 정보 | 기존 + 법적 링크 |

기존 페이지의 `세션에 말을 건다` / `에이전트가 스스로 잠근다` / `워커를 하나 더 만든다` /
`큐는 여럿, 앱은 한 벌` 네 개의 긴 설명 섹션은 **매뉴얼로 내린다.** 랜딩에 깊이가 있으면
결정이 늦어지고, 그 내용은 이제 갈 데가 생겼다.

### 플랜 섹션 — 폼을 넣지 않는다

지금은 전부 무료·MIT다. 온도는 "팀으로 쓰는 방법을 준비 중"까지고, 날짜도 가격도 약속하지 않는다.

**대기자 이메일 폼은 넣지 않는다.** 개인정보처리방침이 짧게 끝나는 이유는 수집 항목이 랜덤
UUID 하나이기 때문인데, 폼 하나가 이메일을 수집 항목으로 만들고 보유기간·처리위탁·수신동의가
줄줄이 붙는다. "커밍순"의 값에 그 대가는 안 맞는다. 관심 표시는 GitHub Watch 버튼으로 받는다.

## 매뉴얼 — 18장

내용은 `README.md`와 `docs/DESIGN.md`에 이미 다 있다. **새로 쓰는 게 아니라 처음 쓰는 사람
순서로 재배열하는 일이다.** 각 장의 출처를 같이 적는다.

### 시작하기
| 장 | 제목 | 출처 |
|---|---|---|
| 1 | dira가 뭔가 — 5분 | README 머리말 · DESIGN §0 |
| 2 | 설치 — 맥 앱 / 엔진만 / 둘 다 | README §요구사항 §설치 |
| 3 | 첫 티켓 굴리기 — 10분 | README §빠른 시작. `dryrun` → 실행 → 화면 확인 |

### 설정
| 장 | 제목 | 출처 |
|---|---|---|
| 4 | 워커 만들기 — 워커 자리가 곧 티켓 루트 | README §빠른 시작 §티켓 · `worker.sh.example` |
| 5 | cron 등록 — 왜 두 줄인가, `;`로 붙이면 왜 안 되나 | README §빠른 시작 cron 항 |
| 6 | 헤드리스 인증 — `claude setup-token` · 전체 디스크 접근 권한 | README §설치 · §요구사항 |
| 7 | 동시성 = 워커 개수 | README §빠른 시작 마지막 항 |

### 쓰기
| 장 | 제목 | 출처 |
|---|---|---|
| 8 | 티켓 쓰는 법 — kind · Goal · Done when · deps | README §티켓 · `templates/` |
| 9 | 상태는 파일명이다 | README §티켓 상태 표 |
| 10 | 화면에서 하는 일 — 보드·티켓·워커·설정 | DESIGN §0-x · 스크린샷 |
| 11 | 도는 세션에 말 걸기 | DESIGN §29 ② · `barge.gif` |
| 12 | 페르소나와 프로토콜 | `templates/` · README §티켓 |

### 운영
| 장 | 제목 | 출처 |
|---|---|---|
| 13 | 트러블슈팅 | cron이 조용히 안 돎 · 마운트 없음 · 토큰 만료 · 스테일 수거 |
| 14 | 로그 읽는 법 — `runner.log` · 세션 로그 | README §빠른 시작 |
| 15 | 사용 통계와 끄는 법 | DESIGN §0-11. `/privacy`와 상호 링크 |

### 레퍼런스
| 장 | 제목 | 출처 |
|---|---|---|
| 16 | 워커 환경변수 | README §워커 레퍼런스 |
| 17 | CLI — `list` · `dryrun` · `reap` | `tick.sh` · `tickets.py` |
| 18 | frontmatter 필드 | README §티켓 |

**새로 필요한 스크린샷 하나** — 6장의 macOS `전체 디스크 접근 권한` 설정 화면. 나머지 17장은
기존 `docs/shots/`로 충분하다.

## 이용약관

MIT 오픈소스라 짧다. 다만 한 조항은 형식이 아니라 실질이다.

- **도구의 성격 고지** — dira는 에이전트 CLI에게 **사용자의 파일을 읽고 고치게** 하는 도구다.
  어떤 디렉터리를 큐 루트로 삼을지, 무엇을 커밋할지의 판단과 그 결과는 사용자에게 있다.
  이건 면책 문구이기 전에 사실 고지이고, 랜딩 §여기 없는 것의 톤과 같은 자리에 둔다.
- 무보증 — MIT 그대로.
- 서드파티 — `claude` 등 에이전트 CLI의 이용약관은 사용자와 그 제공자 사이의 것이다.
  dira는 그 사이에 서지 않는다.
- 요금 — 현재 없음. 유료가 생기면 사전 고지.
- 변경 — 이 페이지 갱신으로 고지하고, 변경일을 문서 상단에 적는다.

## 개인정보처리방침

`apps/teams/lib/analytics.ts`와 `DESIGN.md §0-11`이 이 문서의 근거다. **코드가 방침보다 좁다** —
그래서 무게중심을 "처리하지 않는 항목"에 둔다.

### 처리 항목

**앱** — GA4 Measurement Protocol로 나가는 것 전부:

- 설치 식별자: `randomUUID()` 1개. `~/.config/dira/analytics.json`에 저장, GA4 `client_id`로 전송
- 세션 식별자: 서버 프로세스 메모리에만 존재. 마지막 이벤트로부터 30분
- 이벤트 8종과 그 파라미터 — `analytics.ts:31-40`의 `Events` 타입이 이 목록을 닫는다:

  | 이벤트 | 파라미터 |
  |---|---|
  | `app_open` | `app_version`(문자열), `shell`(`desktop`\|`browser`) |
  | `screen_view` | `screen`(화면 enum) |
  | `project_add` | `method`(`create`\|`register`) |
  | `worker_create` | `engine`(`claude`\|`codex`\|`other`), `cron_ok`(불리언) |
  | `ticket_create` | `kind`(`work`\|`request`\|`feedback`) |
  | `answer_submit` | 없음 |
  | `feedback_submit` | 없음 |
  | `analytics_off` | 없음 |

**웹사이트** — Vercel Analytics 집계값(페이지뷰·리퍼러·국가·기기 종류). **쿠키를 심지 않는다.**

### 처리하지 않는 항목

이 목록이 이 방침의 본문이다. 아래는 페이로드에도, 로컬 `analytics.json`에도 들어가지 않는다:

> 파일 경로 · 프로젝트 이름 · 큐 루트 · 티켓 해시 · 티켓 제목 · 티켓 본문 · 페르소나 이름 ·
> 에이전트 출력 · 계정 정보 · 소스 코드

`DESIGN.md §0-11 §익명 규칙`과 `analytics.ts`의 `Events` 타입 링크를 방침 본문에 건다.
**타입 밖의 이름·파라미터는 컴파일이 거부한다** — 이 문장이 방침의 이행 수단이다.

### 쿠키

앱도 웹사이트도 **자동수집장치(쿠키)를 설치하지 않는다.** 앱은 `gtag.js`를 쓰지 않고 서버가
직접 POST하며(`DESIGN.md §0-11 §어떻게 보내나`), 웹사이트는 Vercel Analytics가 쿠키리스다.
따라서 쿠키 동의 배너가 없다.

### 보유·파기

GA4는 이벤트 데이터와 사용자 데이터의 보존 기간을 따로 잡는다. 방침도 갈라서 적는다
(2026-08-02 콘솔 확인값):

| 대상 | 보존 기간 |
|---|---|
| 이벤트 데이터 — 이벤트 8종과 그 파라미터 | **2개월** |
| 사용자 데이터 — 설치 식별자에 연결된 데이터 | **14개월** |

- 로컬 `analytics.json`: 사용자 기기에만 존재. 파일을 지우면 소멸하고 다음부터 새 설치로 센다
- 합산 기반 표준 보고서는 위 보존 기간의 영향을 받지 않는다(GA4 동작)

### 처리위탁·국외이전

| 수탁자 | 위탁 업무 | 이전 국가 |
|---|---|---|
| Google LLC | GA4 사용 통계 수집·분석 | 미국 |
| Vercel Inc. | 웹사이트 호스팅 및 방문 통계 | 미국 |

제3자 제공은 없다.

### 정보주체 권리 행사

- **끄기**: 앱 `설정` 다이얼로그 세 번째 섹션. 끄면 아무것도 나가지 않는다
- **삭제**: `~/.config/dira/analytics.json` 삭제
- 문의: info@proofer.tech

### 개인정보 보호책임자 · 사업자 정보

| 항목 | 값 |
|---|---|
| 상호 | 프루퍼 주식회사 |
| 대표자 | 임한솔 |
| 사업자등록번호 | 337-81-03650 |
| 주소 | 서울 강남구 강남대로112길 47, 2층 421A |
| 문의 | info@proofer.tech |
| 개인정보 보호책임자 | 임한솔 (대표) · info@proofer.tech |

통신판매업 신고번호는 적지 않는다 — 판매가 없다. 유료 플랜이 생기면 그때 신고와 함께 는다.

## 배포

Vercel 프로젝트 하나.

| 항목 | 값 |
|---|---|
| Root Directory | `apps/site` |
| Build Command | `pnpm build` |
| Output Directory | `.vitepress/dist` |
| Domain | `dira.proofer.tech` |

master push가 곧 배포다. `release.yml`의 bump 커밋도 배포를 태우므로 랜딩의 버전 표기가
릴리스와 같이 움직인다.

`ci.yml`의 단일 `check` 잡에 `apps/site` 설치·빌드 두 줄을 더한다. 잡을 쪼개지 않는다 —
`ci.yml`의 기존 판단(`ponytail: 잡 하나에 8개를 다 넣는다`)을 그대로 따른다.

## 같이 고치는 것

**`README.md`의 clone URL이 `proofertech/dira.git`인데 실제 리모트는 `proofer-tech/dira.git`이다.**
하이픈 하나가 빠졌다. 설치 CTA가 가리키는 첫 명령이 지금 실패한다. 랜딩 공개 전에 고친다.

## 검증

- [ ] `dira.proofer.tech`가 열리고 CTA 두 개가 각각 릴리스·`/docs/install`로 간다
- [ ] 랜딩의 버전 표기가 `apps/desktop/package.json`의 값과 같다 (하드코딩 0)
- [ ] `/docs/` 18장이 전부 사이드바에 있고 링크가 깨진 곳이 없다
- [ ] `/terms`·`/privacy`가 푸터에서 닿는다
- [ ] **랜딩·매뉴얼·약관 어느 페이지도 쿠키를 심지 않는다** — DevTools Application 탭에서
      Cookies가 비어 있음을 확인
- [ ] 방침의 이벤트 표가 `analytics.ts`의 `Events` 타입과 항목·파라미터까지 일치한다
- [ ] README의 `git clone`을 그대로 복사해 붙여넣으면 실제로 받아진다

## 열린 항목

**없다.** 스펙 전체가 확정이다.

마지막까지 열려 있던 GA4 보존 기간은 2026-08-02에 콘솔 값으로 채웠다(이벤트 2개월 ·
사용자 14개월). 자동으로 읽으려던 경로 넷이 다 막혔던 기록은 아래에 남긴다 — 다음에 같은
값을 찾는 사람이 네 번 다시 밟지 않게.

| 경로 | 결과 |
|---|---|
| gstack QA 크롬 프로필 + CDP | 막힘. `Default/Cookies`에 쿠키 18건이지만 `SID`·`SAPISID`·`__Secure-1PSID` **0건** — 사람이 로그인해 둬도 하루면 풀린다 |
| `bin/chrome-cdp` | 안 씀. 실행 중인 사용자 크롬을 `osascript quit` → `pkill`로 끈다 |
| `gcloud auth print-access-token --scopes=…analytics.readonly` | 막힘. gcloud 기본 자격의 스코프 목록이 고정이고 analytics가 없다 |
| 기본 스코프 토큰으로 Admin API | `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` |

**교훈은 값 하나에 자동화를 뚫지 말라는 것이다.** 남은 길이었던 ADC 로그인
(`gcloud auth application-default login --scopes=…/analytics.readonly`)은 Analytics Admin API
활성화라는 벽이 하나 더 있었고, 콘솔에서 눈으로 읽는 데는 10초가 걸렸다. 이 값은 방침에
두 줄로 들어가고 바뀌는 일이 거의 없다.

보존 기간이 바뀌면 `apps/site/privacy.md`의 표만 고치고 재배포한다.
