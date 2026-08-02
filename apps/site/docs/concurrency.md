# 동시성

## 동시성 knob은 없다

동시 실행 상한 같은 설정값은 없다. **동시성 = 워커 개수다.** 워커 파일을
하나 더 두면 그만큼 동시에 돈다. 워커가 하나뿐이면 큐에 티켓이 아무리 쌓여도
한 번에 한 세션만 돈다.

```bash
mkdir -p ~/Projects/myproject/.dira/workers
cat > ~/Projects/myproject/.dira/workers/w2.sh <<'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x ~/Projects/myproject/.dira/workers/w2.sh
```

cron에 두 줄을 더 건다([cron 등록](/docs/cron)과 같은 규칙 — 한 줄에 `;`로
붙이지 않는다):

```
* * * * * $HOME/Projects/myproject/.dira/workers/w2.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
* * * * * sleep 30; $HOME/Projects/myproject/.dira/workers/w2.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
```

## 워커 하나는 한 번에 티켓 1건

워커는 동기 프로세스다. 잡은 티켓의 세션이 끝날 때까지 다음 티켓을 잡지 않는다.
앞 실행이 아직 세션을 쥐고 있는 채로 다음 tick이 오면, 그 워커는 이번 분의
tick을 그냥 넘긴다(워커 락이 막는다). w1이 티켓 하나를 오래 물고 있어도 w2는
그동안 다른 티켓을 집을 수 있다 — 워커 여럿을 두는 값이 그것이다.

## 세션 하나의 실행 상한

세션이 오래 붙잡고 있으면 그 워커는 그만큼 못 돈다. 무한정 붙잡지 않게
`TICKET_MAXRUN`(기본 5400초) 하나가 있다. 넘으면 TERM 뒤 KILL로 세션을 끊고
티켓은 백로그로 돌아간다 — 다음 tick에 같은 워커든 다른 워커든 다시 집는다.

```bash
#!/bin/bash
TICKET_MAXRUN=1800
. "$HOME/Projects/dira/tick.sh"
```

## 왜 상한이 설정값이 아닌가

예전엔 `ps` 출력에서 엔진 프로세스를 세는 전역 상한이었다. 엔진을 바꾸면 세는
패턴도 같이 바꿔야 했고, 안 바꾸면 항상 0으로 세져 상한이 조용히 무력화됐다.
몇 개를 돌릴지를 워커 파일 개수로 표현하면 설정도 카운트도 필요 없다.

동시에 도는 워커가 여럿이면, 서로 다른 티켓이라도 같은 파일이나 공유 dev DB를
같이 건드릴 위험은 남는다(동시 4세션이 컬럼을 드롭한 사례가 있다). 그건 엔진이
막지 않는다 — 워커를 몇 개 둘지는 그 위험을 알고 사람이 정한다.

다음은 [티켓 쓰는 법](/docs/ticket-writing)이다.
