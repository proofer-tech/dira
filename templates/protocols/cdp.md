# 브라우저를 띄울 때 (CDP)

인라인 `AGENTS.md` §브라우저를 띄울 때에서 내려온 세부다. 에이전트가 브라우저를 띄우는
프로젝트에서만 해당한다.

사람이 이 화면 앞에서 다른 일을 하고 있다. **크롬이 앞으로 튀어나오면 그 사람의 작업을
끊는다.**

- 브라우저를 띄우기 전에, 살아 있는 크롬이 참조하지 않는 오래된 `/tmp/qa-*`를 먼저 지운다
  (`ps -eo command | grep -o -- '--user-data-dir=[^ ]*'`로 살아 있는 경로를 뽑아 그 목록에
  없는 `/tmp/qa-*`만 지운다). **이 정리가 실패해도 브라우저 기동은 막지 않는다** - 실패하면
  건너뛰고 계속한다.
- 기본은 헤드리스다. 스크린샷-클릭-폼 입력-팝오버 전부 CDP로 되고 창이 아예 안 뜬다. 사람이
  쓰는 `/Applications/Google Chrome.app`를 그대로 쓰지 않는다 - 그 앱의 자동 업데이트가
  프레임워크를 제자리에서 교체하면 실행 중인 헤드리스 인스턴스가 깨진다. 갱신 주기가 분리된
  전용 바이너리 `chrome-headless-shell`을 쓴다(`npx @puppeteer/browsers install
  chrome-headless-shell@stable --path ~/.cache/dira`로 설치, 경로는 사람마다 다를 수 있으니
  환경 변수 `DIRA_CHROME_HEADLESS`를 먼저 보고 없으면 그 설치 경로를 기본값으로 쓴다). 포트는
  `0`으로 줘서 커널이 고르게 하고(고정 포트는 다른 세션과 부딪힌다), crashpad와 각종 백그라운드
  동작은 전용 디렉터리로 돌리거나 꺼서 사람의 GUI 크롬 crashpad와 안 섞이게 한다:
  `"${DIRA_CHROME_HEADLESS:-$HOME/.cache/dira/chrome-headless-shell/mac_arm-152.0.7977.64/chrome-headless-shell-mac-arm64/chrome-headless-shell}" --remote-debugging-port=0 --user-data-dir=/tmp/qa-<해시>/chrome-profile --crash-dumps-dir=/tmp/qa-<해시>/chrome-profile/crashpad --disable-breakpad --disable-component-update --disable-background-networking --no-first-run --no-default-browser-check --window-size=1440,900 about:blank &`
  `chrome-headless-shell`은 이미 헤드리스 전용 바이너리라 `--headless` 플래그가 없다.
  실제 포트는 커널이 고른 값이라 `<user-data-dir>/DevToolsActivePort` 파일 첫 줄에서 읽는다:
  `head -1 /tmp/qa-<해시>/chrome-profile/DevToolsActivePort`
- **사람의 로그인이 들어 있는 프로필에는 헤드리스를 붙이지 않는다.** 헤드리스는 키체인에 못
  붙어 쿠키를 복호화하지 못하고 **그 쿠키를 지운다** - 읽기가 아니라 파괴다. 한 번 지우면
  사람이 다시 로그인해야 한다(실측: 인증쿠키 18건 -> 0건, 다음 로드가 로그인 화면).
  그런 프로필은 아래 `open -g`로 띄우고 CDP로 몬다.
- 눈으로 볼 창이 정말 필요하면 **`open -g`로 띄운다**(창은 뜨고 포커스는 안 넘어간다):
  `open -na "Google Chrome" -g --args --remote-debugging-port=<포트> --user-data-dir=/tmp/qa-<해시>/chrome-profile --no-first-run --no-default-browser-check about:blank`
  바이너리를 직접 실행하면 앱이 활성화돼 포커스를 뺏는다 - 창이 필요할 땐 `open -g`만 쓴다.
  창이 떠 있어도 `Page.navigate`-`Runtime.evaluate`-클릭은 전부 CDP로 된다.
- 포트는 세션마다 다르게(9222는 이미 다른 프로세스가 쓰고 있을 수 있다). `--user-data-dir`은
  반드시 전용 임시 경로 - 빼면 사람이 쓰는 크롬 창에 붙는다.
- **끝나면 죽인다.** 남긴 크롬은 다음 세션의 포트를 먹는다. 프로세스를 죽인 다음
  `/tmp/qa-<해시>` 디렉터리도 지운다 - 안 지우면 다음 검사에서 오래된 항목으로 쌓인다.
- CDP를 부르는 일회용 스크립트(`cdp.mjs`, `expr*.js` 같은 것)도 워크트리 안에 만들지
  않는다. `mktemp -d`가 준 경로에 쓴다 - 워크트리 안에 남으면 다음 세션이 부르는
  `git add -A`가 그걸 자기 커밋에 담아 간다.
