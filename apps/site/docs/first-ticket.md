# 첫 티켓 굴리기

여기서는 cron을 등록하지 않는다. `dryrun`으로 먼저 확인하고, 손으로 한 번 돌려
결과를 본 다음 끝낸다 — cron은 헤드리스 인증과 전체 디스크 접근 권한이 더
필요해서, 그것부터 붙이면 첫 성공이 그 벽에 걸린다. cron 등록은
[다음 장](/docs/cron)에서 따로 다룬다.

## 1. 워커 파일 하나 만든다

프로젝트 하나에 dira를 붙이는 데 필요한 건 워커 파일 하나뿐이다. **워커가 놓인
위치가 곧 티켓 루트다.**

```bash
mkdir -p ~/Projects/myproject/.dira/workers
cat > ~/Projects/myproject/.dira/workers/w1.sh <<'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x ~/Projects/myproject/.dira/workers/w1.sh
```

## 2. (선택) 템플릿을 복사한다

페르소나·프로토콜 출발점이 필요하면 복사한다. 엔진은 이게 없어도 그대로 돈다 —
없으면 페르소나 없는 평범한 에이전트가 티켓을 처리한다.

```bash
cp -r ~/Projects/dira/templates/* ~/Projects/myproject/.dira/
```

## 3. 티켓 하나를 쓴다

큐 디렉터리에 마크다운 파일 하나를 만든다. 파일명이 곧 티켓 해시고, 본문에는
무엇을 원하는지와 무엇이 되면 끝인지를 적는다.

```bash
mkdir -p ~/Projects/myproject/.dira/tickets
cat > ~/Projects/myproject/.dira/tickets/a1b2c3d4.md <<'EOF'
---
ticket: a1b2c3d4
title: 정산 리포트에 환불 컬럼 추가
kind: work
---

## Goal
`/reports/settlement`에 환불 합계 컬럼을 추가한다.

## Done when
- [ ] 컬럼이 보이고 합계가 기존 총액과 맞는다
EOF
```

## 4. `dryrun`으로 먼저 본다

실행 없이 선정 결과와 조립된 프롬프트만 확인한다. 세션을 띄우기 전에 워커가
이 티켓을 정말 고르는지, 프롬프트가 뭘로 채워지는지 여기서 눈으로 본다.

```bash
~/Projects/myproject/.dira/workers/w1.sh dryrun
```

## 5. 손으로 한 번 돌린다

cron 없이 워커를 직접 실행한다. 워커가 티켓을 잡고, 세션을 띄우고, 그 세션이
끝날 때까지 기다린다.

```bash
~/Projects/myproject/.dira/workers/w1.sh
```

## 6. `list`로 결과를 본다

```bash
~/Projects/myproject/.dira/workers/w1.sh list
```

티켓이 큐에서 사라졌으면(또는 완료로 표시됐으면) 방금 세션이 그 티켓을 물고
끝낸 것이다. 세션별 출력은 `<루트>/workers/logs/`에 남는다.

## 여기까지가 손 실행이다

지금까지는 사람이 그 자리에서 워커를 불러 확인한 것이다. 1분마다 저절로
돌게 하려면 cron에 등록해야 하는데, cron은 로그인 키체인에 접근하지 못해
헤드리스 인증이 따로 필요하고 티켓 루트가 클라우드 마운트라면 전체 디스크 접근
권한도 있어야 한다. 그 등록은 [cron 등록](/docs/cron)에서 이어 간다.
