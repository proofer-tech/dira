# 브라우저를 띄울 때 (CDP)

인라인 `AGENTS.md` §브라우저를 띄울 때에서 내려온 세부다. 에이전트가 브라우저를 띄우는
프로젝트에서만 해당한다.

사람이 이 화면 앞에서 다른 일을 하고 있다. **크롬이 앞으로 튀어나오면 그 사람의 작업을
끊는다.**

- 브라우저를 띄우기 전에, 살아 있는 크롬이 참조하지 않는 오래된 `/tmp/qa-*`를 먼저 지운다
  (`ps -eo command | grep -o -- '--user-data-dir=[^ ]*'`로 살아 있는 경로를 뽑아 그 목록에
  없는 `/tmp/qa-*`만 지운다). **이 정리가 실패해도 브라우저 기동은 막지 않는다** - 실패하면
  건너뛰고 계속한다.
- 기본은 헤드리스다. 스크린샷-클릭-폼 입력-팝오버 전부 CDP로 되고 창이 아예 안 뜬다. 포트는
  `0`으로 줘서 커널이 고르게 하고(고정 포트는 다른 세션과 부딪힌다), crashpad와 각종 백그라운드
  동작은 전용 디렉터리로 돌리거나 꺼서 사람의 GUI 크롬 crashpad와 안 섞이게 한다:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --remote-debugging-port=0 --user-data-dir=/tmp/qa-<해시>/chrome-profile --crash-dumps-dir=/tmp/qa-<해시>/chrome-profile/crashpad --disable-breakpad --disable-component-update --disable-background-networking --no-first-run --no-default-browser-check --window-size=1440,900 about:blank &`
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
