# 설치

**받는 것은 `.dmg` 하나다.** 엔진이 앱 안에 들어 있어서 `git clone`할 것이 없다.

[최신 릴리스](https://github.com/proofer-tech/dira/releases/latest)에서 `.dmg`를
받아 열고 `dira.app`을 `응용 프로그램`으로 끌어다 놓는다. 서명·공증된 빌드라
처음 열 때 Gatekeeper가 막지 않는다. 업데이트는 앱이 스스로 받는다.

## 필요한 것

- **macOS(Apple Silicon).** 앱은 여기서만 돈다.
- **에이전트 CLI 1종.** 기본값은 [`claude`](https://claude.com/claude-code)다.
  워커가 티켓을 물고 띄우는 세션이 이것이라 없으면 티켓이 `대기`에서 움직이지
  않는다.
- **claude 장기 토큰.** cron으로 도는 워커는 로그인 키체인에 붙지 못해 토큰
  파일이 따로 필요하다. 앱의 `설정` 다이얼로그가 대신 발급해 제자리에 놓는다 —
  [인증](/docs/auth)에서 다룬다. 지금 없어도 설치는 끝난다.

`python3`와 `bash`는 macOS에 이미 있다. 엔진이 쓰는 것은 그 둘의 표준
라이브러리뿐이라 따로 설치할 패키지가 없다.

## 앱 없이 엔진만 쓰기

화면이 필요 없거나 Linux에서 돌릴 경우다. 이 갈래는 레포를 직접 받는다.

```bash
git clone https://github.com/proofer-tech/dira.git ~/Projects/dira
```

조직명은 하이픈이 있는 `proofer-tech`다. 하이픈을 빼면 존재하지 않는 계정이라
clone이 그 자리에서 죽는다.

받았다고 뭔가 도는 건 아니다 — `tick.sh`는 엔진 코드일 뿐이고 진입점은 워커다.
워커 파일을 손으로 만들고 cron에 거는 절차는 부록 [엔진만으로
돌리기](/docs/cron)에 있다. 앱을 같이 쓰더라도 상관없다. 앱은 자기 몫의 엔진을
번들 안에 따로 들고 있고, 둘 다 같은 티켓 루트(`<프로젝트>/.dira`)만 보고 있으면
서로의 존재를 몰라도 같은 큐를 돌본다.

다음은 [첫 프로젝트 만들기](/docs/first-ticket)다.
