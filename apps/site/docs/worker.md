# 워커 만들기

[첫 티켓 굴리기](/docs/first-ticket)에서 워커 파일 하나를 이미 만들어봤다. 이
장은 그 한 줄짜리 파일이 실제로 무엇을 정하는지, 위에 무엇을 더 얹을 수 있는지를
본다.

## 놓인 위치가 루트를 정한다

```bash
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
```

`tick.sh`는 엔진 코드일 뿐이라 직접 실행하지 않는다. 이 워커 파일을 source하는
것이 진입점이다. 필수는 저 한 줄뿐이고, **루트는 이 파일이 놓인 위치로 정해진다**
— `<루트>/workers/w1.sh`에서 `workers`의 부모가 루트다. 어느 설정값에도 루트
경로를 적지 않는다.

```
<루트>/
  tickets/<hash>.md          <- 큐. 평면이다
  personas/<이름>/PROFILE.md
  protocols/AGENTS.md
  workers/w1.sh w2.sh        <- 크론잡. 여기 있는 파일 개수가 곧 동시성이다
  workers/runner.log logs/   <- 디스패치 기록·세션별 출력
```

## 큐를 프로젝트 밖에 둘 때

루트가 프로젝트 안에 있을 필요는 없다. 여러 사람이 같은 큐에 붙는다면 마운트된
공유 드라이브(구글드라이브 등)에 `workers/`를 두고 cron이 그 경로를 가리키게
한다.

```bash
mkdir -p "/Volumes/TeamShare/myteam/.dira/workers"
cat > "/Volumes/TeamShare/myteam/.dira/workers/w1.sh" <<'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x "/Volumes/TeamShare/myteam/.dira/workers/w1.sh"
```

여기서 꼭 챙길 것 하나: **마운트가 안 붙어 있으면 워커 파일 자체가 없다.** cron이
그 경로를 때려도 실행할 스크립트가 없으니 아무 로그도 안 남기고 조용히 실패한다.
큐가 비어서 안 도는 게 아니라 파일이 없어서 안 도는 것이다 — `ls
"/Volumes/TeamShare/myteam/.dira/workers"`로 워커 파일이 실제로 보이는지부터
확인한다. "빈 큐라 안 도는구나"로 오해하고 그대로 방치하는 사고를 이 구분이
막아준다.

## 세션의 작업 디렉터리

세션은 기본적으로 **루트의 부모**에서 시작한다(`<프로젝트>/.dira`가 루트면
`<프로젝트>`). 큐를 프로젝트 밖에 뒀으면(위 사례) 이 기본값이 의미가 없으므로
`TICKET_CWD`로 직접 지정한다.

```bash
#!/bin/bash
TICKET_CWD="$HOME/Projects/myproject"
. "$HOME/Projects/dira/tick.sh"
```

## 엔진 바꾸기

기본 엔진은 `claude -p`다. 워커는 프로젝트를 모르는 엔진 코드(`tick.sh`)를
불러 쓰는 자리라, 다른 CLI 에이전트로 바꾸는 것도 이 파일에 한 줄 얹는 걸로
끝난다.

```bash
#!/bin/bash
TICKET_ENGINE=(codex exec --json "{prompt}")
. "$HOME/Projects/dira/tick.sh"
```

`{prompt}`는 실행 직전 조립된 프롬프트로 치환된다. 응답 JSON의 실제
`session_id`로 frontmatter를 정정하는 단계는 `claude` 전용이라, 다른 엔진이면
그냥 건너뛴다.

다음은 [cron 등록](/docs/cron)이다.
