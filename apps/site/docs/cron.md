# 엔진만으로 돌리기

**앱을 쓰신다면 이 장은 건너뛰셔도 됩니다.** 부록입니다. 워커 화면에서 하나 추가하면 워커
파일 작성도 crontab 등록도 앱이 알아서 끝냅니다. 본선은 [워커](/docs/worker)입니다.

여기부터는 `.dmg` 없이 `git clone`으로 엔진만 받은 경우입니다([설치](/docs/install)
§엔진만). 화면이 없으니 워커 파일을 손으로 만들고, cron에 손으로 걸고, 결과를 셸에서 봅니다.

## 1. 워커 파일 하나 만들기

프로젝트 하나에 dira를 붙이는 데 필요한 건 이 파일 하나입니다. 필수는 `tick.sh`를 source하는
**한 줄**뿐입니다. 그리고 **이 파일이 놓인 위치가 곧 큐 루트입니다.** `<루트>/workers/w1.sh`라면
`workers`의 부모가 루트입니다. 그래서 어느 설정값에도 루트 경로를 적을 일이 없습니다.

```bash
mkdir -p ~/Projects/myproject/.dira/workers
cat > ~/Projects/myproject/.dira/workers/w1.sh <<'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x ~/Projects/myproject/.dira/workers/w1.sh
```

`tick.sh` 자체는 직접 실행하지 않습니다. 실행해 보면 rc=2로 거절하는데, 워커 파일이 어디
놓였는지를 모르면 루트도 알 수 없기 때문입니다. 진입점은 언제나 이 워커 파일 쪽입니다.

```
<루트>/
  tickets/<hash>.md          <- 큐. 평면이다
  personas/<이름>/PROFILE.md
  protocols/AGENTS.md
  workers/w1.sh w2.sh        <- 워커. 여기 있는 파일 개수가 곧 동시성이다
  workers/runner.log logs/   <- 디스패치 기록·세션별 출력
```

페르소나와 프로토콜의 출발점이 필요하면 템플릿을 복사하세요. 없어도 그대로 돕니다. 페르소나
없는 평범한 에이전트가 티켓을 처리합니다.

```bash
cp -r ~/Projects/dira/templates/* ~/Projects/myproject/.dira/
```

## 2. 큐를 프로젝트 밖에 둘 때 — `TICKET_CWD`

루트가 프로젝트 안에 있어야 할 이유는 없습니다. 여러 사람이 같은 큐에 붙는다면 마운트된 공유
드라이브(구글드라이브 등)에 `workers/`를 두고 cron이 그 경로를 가리키게 하세요.

세션은 기본적으로 **루트의 부모**에서 시작합니다(`<프로젝트>/.dira`가 루트면 `<프로젝트>`).
큐를 프로젝트 밖에 두면 이 기본값이 의미가 없어지니, `TICKET_CWD`로 작업 디렉터리를 직접
지정하시면 됩니다.

```bash
mkdir -p "/Volumes/TeamShare/myteam/.dira/workers"
cat > "/Volumes/TeamShare/myteam/.dira/workers/w1.sh" <<'EOF'
#!/bin/bash
TICKET_CWD="$HOME/Projects/myproject"
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x "/Volumes/TeamShare/myteam/.dira/workers/w1.sh"
```

**함정이 하나 있습니다. 마운트가 안 붙어 있으면 워커 파일 자체가 없습니다.** cron이 그 경로를
때려도 실행할 스크립트가 없으니 아무 로그도 안 남기고 조용히 실패합니다. 큐가 비어서 안 도는
게 아니라 파일이 없어서 안 도는 겁니다. `ls "/Volumes/TeamShare/myteam/.dira/workers"`로 워커
파일이 실제로 보이는지부터 확인하세요. "빈 큐라 안 도는구나"로 오해하고 방치하는 사고를 이
구분이 막아 줍니다.

## 3. 엔진 바꾸기 — `TICKET_ENGINE`

기본 엔진은 `claude -p`입니다. 워커는 프로젝트를 모르는 엔진 코드(`tick.sh`)를 불러 쓰는
자리라, 다른 CLI 에이전트로 바꾸는 것도 이 파일에 한 줄 얹으면 끝납니다.

```bash
#!/bin/bash
TICKET_ENGINE=(codex exec --json "{prompt}")
. "$HOME/Projects/dira/tick.sh"
```

`{prompt}` 자리에는 실행 직전 조립된 프롬프트가 들어갑니다. 응답 JSON의 실제 `session_id`로
frontmatter를 정정하는 단계는 `claude` 전용이라, 다른 엔진이면 그냥 건너뜁니다. 얹을 수 있는
값 전체는 [워커 환경변수](/docs/ref-env)에 있습니다.

## 4. cron에 걸기 전 손으로 한 번 돌려 보기

cron부터 걸면 첫 실패가 인증의 벽에 걸려 원인이 흐려집니다. 먼저 셸에서 왕복 한 번을 보세요.

`dryrun`은 실행 없이 선정 결과와 조립된 프롬프트만 냅니다. 세션을 띄우기 전에 워커가 그 티켓을
정말 고르는지, 프롬프트가 뭘로 채워지는지 여기서 눈으로 확인하시면 됩니다.

```bash
~/Projects/myproject/.dira/workers/w1.sh dryrun
```

인자 없이 부르면 실제 1회 디스패치입니다. 워커가 티켓을 잡고, 세션을 띄우고, 그 세션이 끝날
때까지 기다립니다.

```bash
~/Projects/myproject/.dira/workers/w1.sh
```

`list`는 열린 티켓 큐 상태(대기·할당됨·deps 대기)를 냅니다. 티켓이 큐에서 사라졌으면 방금
세션이 그것을 물고 끝낸 겁니다.

```bash
~/Projects/myproject/.dira/workers/w1.sh list
```

세 명령 모두 큐 전체를 보므로 같은 루트의 어느 워커 파일로 불러도 결과가 같습니다
([CLI](/docs/ref-cli) 참고).

## 5. crontab 두 줄

여기까지가 사람이 그 자리에서 워커를 부른 것입니다. 1분마다 저절로 돌게 하려면 cron에
등록합니다. cron은 로그인 키체인에 접근하지 못하므로 이 시점부터 장기 토큰이 필요하고
([인증](/docs/auth) §앱 없이 — 엔진만 쓸 때), 큐 루트가 클라우드 마운트라면 전체 디스크
접근 권한도 있어야 합니다.

```
* * * * * $HOME/Projects/myproject/.dira/workers/w1.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
* * * * * sleep 30; $HOME/Projects/myproject/.dira/workers/w1.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
```

`crontab -e`로 위 두 줄을 넣으세요. **워커 하나에 cron 두 줄**입니다.

### 두 줄인 이유

cron이 낼 수 있는 가장 잔 단위는 분입니다(`man 5 crontab`). 30초마다 큐를 보게 하려면 :00에
한 줄, :30에 한 줄이 필요합니다. 두 번째 줄은 `sleep 30`으로 30초를 당긴 뒤 같은 워커를
부릅니다.

### 한 줄에 `;`로 붙이면 안 되는 이유

**워커는 동기 프로세스라, 앞 호출이 세션을 물면 뒷반쪽이 30초 뒤가 아니라 그 세션이 끝난
뒤에 뜹니다.** 두 줄이어야 :00과 :30이 결정적입니다. 중복 디스패치는 워커 락이 막아 줍니다.

```
# 하면 안 되는 것
* * * * * w1.sh; sleep 30; w1.sh
```

이렇게 한 줄로 이으면 셸이 `w1.sh`가 끝나야 `sleep 30`으로 넘어갑니다. 앞 호출이 티켓 하나를
30분짜리 세션으로 물었다면, 뒷반쪽은 30초 뒤가 아니라 그 세션이 끝난 뒤인 30분 뒤에야
실행됩니다. 30초 폴링이 아니라 그냥 순차 실행이 되는 겁니다. 두 줄로 나눠야 cron 스케줄러가
각 줄을 **독립된 프로세스**로 :00과 :30에 각각 띄웁니다. 같은 분에 앞 실행이 아직 안
끝났으면 워커 락이 뒤 실행을 `SKIP`시키므로 두 실행이 같은 티켓을 동시에 물 일은 없습니다.

## 중지

crontab에서 그 두 줄을 지우면 됩니다. 워커 파일까지 지우실 필요는 없습니다. 다시 등록할 때
그대로 씁니다.

## 로그

- `<루트>/workers/runner.log` — 디스패치 진행 상황(선정·claim·SKIP 등)
- `<루트>/workers/logs/<시각>-<워커>-<해시>.log` — 세션별 실제 출력

위 crontab 줄이 리다이렉트하는 `cron.log`는 워커 스크립트 자체의 표준출력·표준에러입니다. 정상
동작 중엔 대개 비어 있고, 셸 자체가 깨졌을 때만 여기 남습니다. 티켓이 실제로 어떻게 처리됐는지는
`runner.log`와 `logs/`에서 보시면 됩니다([로그 읽는 법](/docs/logs)).

안 도는 것 같으면 [안 돌 때](/docs/troubleshooting)를 보세요. 그 장은 화면에서 볼 자리를 먼저
주지만, 각 증상의 셸 확인 명령은 화면 없이도 그대로 씁니다.

다음은 [워커 환경변수](/docs/ref-env)입니다.
