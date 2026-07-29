# fs-ticket-system

파일시스템이 곧 큐인 티켓 디스패처. 매 분 cron이 열린 티켓 1건을 골라 헤드리스 `claude -p` 세션에
넘긴다. 상주 루프 세션도, DB도, 인덱스도 없다 — **상태 SoT는 티켓 파일 자체**(파일명 접미사 +
frontmatter)다.

프로젝트별 값은 config 파일 하나에만 있다. 엔진은 어느 프로젝트도 모른다.

## 설치

```bash
git clone <this> ~/Projects/fs-ticket-system
mkdir -p ~/.ticket-cron                                   # 상태 디렉터리(로그·토큰·config)
cp ~/Projects/fs-ticket-system/config.sh.example ~/.ticket-cron/myproject.config.sh
$EDITOR ~/.ticket-cron/myproject.config.sh                # TICKET_CWD(프로젝트 경로) 지정
claude setup-token                                        # 헤드리스 인증 토큰 발급
printf %s '<토큰>' > ~/.ticket-cron/oauth-token && chmod 600 ~/.ticket-cron/oauth-token

TICKET_CONFIG=~/.ticket-cron/myproject.config.sh ~/Projects/fs-ticket-system/tick.sh dryrun
```

크론(프로젝트당 한 줄):

```
* * * * * TICKET_CRON=1 TICKET_CONFIG=$HOME/.ticket-cron/myproject.config.sh $HOME/Projects/fs-ticket-system/tick.sh >> $HOME/.ticket-cron/cron.log 2>&1
```

중지는 그 줄 삭제. 코드(레포)와 상태(`~/.ticket-cron`, `TICKET_STATE`로 덮어쓰기)는 분리돼 있다.

## 티켓 레이아웃

```
<TICKET_CWD>/.fs-tickets/          <- 기본 티켓 루트. 프로젝트 안에 큐가 산다
  tickets/<hash>.md                <- 큐. 평면이다. 하위 디렉터리 없음
  personas/<이름>/PROFILE.md
```

스트림에 설치하면 `~/Projects/stream/.fs-tickets`, 프루퍼면 `~/Projects/proofer/.fs-tickets`.
루트가 없으면 만든다. 다른 위치(클라우드 워크스페이스 등)에 두려면 config에서 `TICKET_ROOT`나
`resolve_ticket_root`로 덮어쓴다 — **명시로 준 경로는 없으면 에러**다(미마운트를 빈 큐로 착각하면
디스패처가 조용히 아무것도 안 하게 된다).

**큐는 하나다. 디렉터리로 나누던 건 전부 frontmatter로 갔다** — 역할별 수신함(`to-<역할>/`)도,
성격별 디렉터리(`request/`·`work/`·`feedback/`)도 없다. 라우팅은 `persona:`가, 성격은 `kind:`가 한다.
디렉터리 하나에 다 있으니 파일 이동 없이 frontmatter 한 줄로 수행자와 성격이 바뀐다.

```markdown
---
ticket: a1b2c3d4
title: 정산 리포트 컬럼 추가
kind: work            # request=부탁 / work=지시 / feedback=결과보고
persona: developer    # 생략하면 페르소나 없는 평범한 에이전트가 처리한다
deps: [f0e1d2c3]
---
```

- 상태만 여전히 **파일명 접미사**: `<hash>.md`(미착수) / `<hash>.wip.md` / `<hash>.done.md`
  (접미사 문자열은 `TICKET_INPROGRESS`·`TICKET_DONE`). rename이 원자적 락이라 상태는 파일명에 남는다.
  다른 접미사로 만든 티켓이 이미 있는 설치는 config에서 그 값으로 고정하거나 일괄 rename해야 한다 —
  안 하면 옛 접미사가 이름의 일부로 보여서 이미 잡힌 티켓이 큐에 다시 뜬다.
- 파일명은 해시. 제목은 `title:`.
- `deps: [<hash>...]` = 하드 선후. 전부 완료여야 착수(디스패처가 큐에서 빼고, 사람·세션도 착수 직전 확인).
- `kind:`는 디스패처가 로그·`list`에 표시만 한다. 값을 강제하지 않는다(오탈자는 `-`로 보인다).
- 구 레이아웃(`to-*/`, `request/`…)에 티켓이 남아 있으면 `list`·`select`가 stderr로 경고한다 —
  큐에서 안 보이므로 조용히 굶는 대신 알린다. 옮기는 건 `mv`:
  ```bash
  cd <TICKET_ROOT> && mkdir -p tickets && mv to-*/*/*.md tickets/   # 그 뒤 kind:/persona: 추가
  ```

## 페르소나

```
<TICKET_PERSONAS 또는 $TICKET_ROOT/personas>/
  pm/PROFILE.md  designer/PROFILE.md  developer/PROFILE.md
```

페르소나는 이제 수신함이 아니라 **이것 하나뿐인 역할 개념**이다. 프로필을 만들어두고 티켓
frontmatter에서 이름으로 부른다.

티켓의 `persona:` 이름으로 프로필을 찾아 **본문을 프롬프트 머리에 인라인**한다(경로만 주면 세션이
안 읽고 시작할 수 있다). 프로필과 티켓 지시가 충돌하면 티켓을 따르고 충돌 사실을 티켓에 남기라고
지시한다.

**`persona:`가 없으면 페르소나 없는 평범한 에이전트**가 처리한다. 그게 정상 경로다 — 롤플레잉이
필요한 티켓에만 붙인다. 이름은 있는데 프로필 파일이 없으면 `WARN`만 남기고 그냥 디스패치한다.

`persona:` 값은 경로 조각이 되므로 `[A-Za-z0-9_-]+`만 통과하고, 아니면 페르소나 없음으로 떨어진다
(`persona: ../../.ssh` 같은 값으로 임의 파일이 프롬프트에 실려 나가지 않게).

`PROFILE.md`는 형식이 없다 — 그냥 마크다운이다. 예:

```markdown
# PM

스펙 확정과 우선순위 조정이 내 일이다. 코드는 직접 짜지 않고
`persona: developer` + `kind: work` 티켓으로 넘긴다.

## 판단 기준
- 요구가 모호하면 구현 전에 `kind: request` 티켓으로 되묻는다. 추측으로 스펙을 채우지 않는다.
- 범위가 커지면 쪼개서 deps로 엮는다.

## 산출물
- 결정은 `kind: feedback` 티켓으로 남긴다.
```

## 동작

1. config 로드 -> `TICKET_ROOT` 확정(기본 `$TICKET_CWD/.fs-tickets`, 또는 고정 경로/`resolve_ticket_root`).
2. `reap`(스테일 수거) -> 동시 실행 상한 확인.
3. 상태 접미사 없고 frontmatter `session_id`가 빈 티켓 중 생성일(st_birthtime) 최고참부터 훑는다.
4. **잡기 = 원자적 link**(`os.link`로 `<hash>.wip.md`를 만들고 원본을 지운다. dst가 있으면 `EEXIST`라
   먼저 성공한 쪽만 이긴다). 이미 잡혔으면 다음 후보.
   하드링크 미지원 파일시스템(구글드라이브 등 FUSE·SMB)에서는 `O_CREAT|O_EXCL`로 폴백한다 —
   **`os.rename` 폴백은 락이 아니다**(dst가 있어도 조용히 덮어쓰고, `exists()` 선검사는 TOCTOU라
   두 프로세스가 둘 다 통과한다). 두 경로 모두 `test_claim_race.py`가 24프로세스 동시 claim으로 잰다.
5. frontmatter에 `session_id`/`assigned_at`/`owner` 기록 -> `cd $TICKET_CWD && claude -p ... --session-id`.
   프롬프트 머리에는 티켓 `persona:`의 `PROFILE.md`가 인라인되고(위 절), 꼬리에는 config의 `TICKET_CONTEXT=("<경로>|<설명>" ...)`가 목록으로 붙는다(참조 자료 안내.
   없는 경로는 건너뛰고 `WARN`만 남긴다 — 클라우드 마운트가 안 붙었다고 디스패치를 막지는 않는다).
   실행 엔진은 config의 `TICKET_ENGINE` 배열로 바꾼다(`{prompt}`·`{sid}` 치환). 바꿨으면
   `TICKET_ENGINE_PS`(동시성 카운트용 ps 패턴)도 같이 바꿔야 상한이 걸린다.
6. rc=0이면 응답의 실제 session_id로 frontmatter 정정. rc!=0이면 할당 회수 + 백로그 복귀(다음 tick 재시도).

동시성 상한(`TICKET_MAXCONC`, 기본 3)은 **살아있는 세션 수**로 센다(진행중 파일 수로 세지 않는다 —
`HOLD` 티켓이 영구히 슬롯을 먹어 굶는다). 카운트는 머신 전역이다: CPU·API·공유 DB 경합이 프로젝트를
가리지 않는다. 근거는 동시 4세션이 같은 소스·공유 dev DB를 만져 컬럼 드롭이 관측된 사고(2026-07-28).

## 스테일 수거 (`reap`)

매 tick 맨 앞에 돈다. 없으면 **세션이 사람에게 질문하고 rc=0으로 종료한 티켓이 영구 유실된다**
(rc!=0 회수 경로가 그 경우를 못 잡는다. 2026-07-28 하루 3건 물려서 수동 복구).

- 디스패처 세션: frontmatter `session_id`를 `ps`의 `--session-id`와 대조해 **죽은 것만** 회수.
  유예 3분, `attempts`를 올리며 **2회까지만** 자동 회수하고 3회째부터 `.wip` 유지 + `HOLD` 로그
  (같은 이유로 죽는 티켓이 세션을 무한히 태우는 걸 막는다. 이후엔 사람이 원인 해소 후 `unassign`).
- 손 클레임(대화형 세션): `ps`에 `--session-id`가 안 뜨므로 `handclaim`이 적어둔 `pid`로 본다.
  pid 죽음 = 회수. pid 살아있으면 트랜스크립트를 테일해 유휴만 `SUSPECT`로 **보고만** 한다 —
  작업 중인 워크트리에 미완 변경분이 있을 수 있어 자동 회수는 사람 판단(블록 처리)을 건너뛴다.
  `pid`가 없는 손 클레임은 건드리지 않는다(생존을 확인할 방법이 없으면 회수도 하지 않는다).

**버린 대안: 시간 기반 클레임 만료**(kanban-md의 1시간 만료 같은 것). 오래 걸리는 정상 세션을
살아있는데도 회수해 같은 티켓을 두 세션이 동시에 수행하게 된다. 프로세스 생존이 직접 증거이고,
시간은 판정이 아니라 점검 트리거로만 쓴다. 실행 상한(`TICKET_MAXRUN`, 기본 90분)은 별개 장치다 —
매달린 세션 하나가 2시간 14분간 티켓을 쥐고 있던 사례가 근거.

## 명령

```
tick.sh                 1회 디스패치(cron 진입점. 맨 앞에서 reap도 돈다)
tick.sh list            열린 티켓 큐 + 할당·deps 대기 상태
tick.sh dryrun          claim·실행 없이 선정 결과와 프롬프트만
tick.sh reap            스테일 수거만 1회
tick.sh unassign <해시> 할당 해제(session_id 비우기 + 진행중 접미사 떼기) -> 큐 복귀
```

대화형 세션이 티켓을 손으로 잡을 때는 맨손 `mv`가 아니라:

```
python3 tickets.py handclaim <티켓경로> "<페르소나 / 세션식별>"
```

맨손 `mv`로 잡으면 생존 신호(`pid`)가 없어 세션이 조용히 죽었을 때 **영구 좀비**가 된다.

## 파일

- `tick.sh` 디스패처 / `tickets.py` 큐·frontmatter 헬퍼(단독 CLI로도 쓴다)
- `config.sh.example` 프로젝트 바인딩 계약
- `test_generic.py` 파라미터화 자체검증(평면 큐·kind/persona·접미사·프롬프트·deps·기본 루트)
- `test_reap_manual.py` 스테일 판정 자체검증 6케이스
- `test_claim_race.py` claim 락 동시성 자체검증(24프로세스 동시 claim, link·O_EXCL 두 경로)
- 상태(레포 밖): `~/.ticket-cron/{<이름>.config.sh, oauth-token, runner.log, logs/}`

## 전제

- macOS/Linux + python3(표준 라이브러리만) + `claude` CLI. 외부 의존성 없음.
- cron에 전체 디스크 접근 권한(티켓 루트가 클라우드 마운트일 때 필수).
- `oauth-token`: cron은 로그인 키체인에 접근하지 못해 GUI 세션 인증을 못 쓴다.

## 유래

스트림 프로젝트(`~/Projects/stream` + 구글드라이브 워크스페이스)의 전용 디스패처
(`~/.stream-ticket-cron`)에서 프로젝트 전제를 config로 뺀 것. 위 사고 이력·버린 대안은 모두 거기서
왔다. 그때는 역할이 수신함 디렉터리(`to-pm/` 등)였는데, 페르소나 프로필이 들어오면서 수신함은
지웠다 — 같은 것을 두 곳(디렉터리 + 프로필)에서 정의할 이유가 없다. 핸드오프 규약 등 **사람/에이전트가
지키는 협업 프로토콜**은 아직 이 레포에 없다(스트림 워크스페이스 문서에 있고, 정본화는 별도 작업).
