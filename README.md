# fs-tickets

**파일시스템이 곧 큐인 티켓 디스패처.** cron이 1분마다 열린 티켓 1건을 골라 헤드리스 에이전트
세션(`claude -p` 등)에 넘긴다. 상주 루프도, DB도, 인덱스도 없다 — **상태의 단일 출처는 티켓 파일
자체**(파일명 접미사 + frontmatter)다.

- **의존성 0** — bash + python3 표준 라이브러리. 설치는 `git clone`이 끝이다.
- **프로젝트 무관** — 엔진은 어느 프로젝트도 모른다. 프로젝트별 값은 config 파일 하나에만 있다.
- **엔진 무관** — `claude -p`가 기본이지만 config 한 줄로 다른 CLI 에이전트로 바꾼다.
- **잡기 = 원자적 파일 연산** — 락 서버도 타임아웃도 없이 두 세션이 같은 티켓을 못 든다.
- **죽은 세션 자동 회수** — 프로세스 생존을 직접 확인해서 회수한다(시간 만료 아님).

```
$ tick.sh list
2026-07-29 17:16  a1b2c3d4     work      pm         대기
2026-07-29 17:20  f0e1d2c3     request   -          deps 대기 a1b2c3d4
```

## 요구사항

- macOS 또는 Linux, `python3`(표준 라이브러리만), `bash`
- 에이전트 CLI 1종 — 기본값은 [`claude`](https://claude.com/claude-code)
- cron으로 돌릴 경우: **전체 디스크 접근 권한**(티켓 루트가 클라우드 마운트일 때 필수)과
  **장기 인증 토큰**(cron은 로그인 키체인에 접근하지 못한다)

## 설치

```bash
git clone <this-repo> ~/Projects/fs-tickets
mkdir -p ~/.ticket-cron                  # 상태 디렉터리(config·로그·토큰). 코드와 분리된다
ln -s ~/Projects/fs-tickets/tick.sh ~/.local/bin/tick     # 선택: PATH에 얹기
```

`tick.sh`는 심링크로 설치돼도 자기 코드 위치를 찾는다. 코드(레포)와 상태(`~/.ticket-cron`)는
분리돼 있어서 레포를 아무 데나 두고 업데이트해도 상태가 안 섞인다.

헤드리스 인증(cron으로 돌릴 때만):

```bash
claude setup-token
printf %s '<토큰>' > ~/.ticket-cron/oauth-token && chmod 600 ~/.ticket-cron/oauth-token
```

## 빠른 시작

프로젝트 하나 붙이는 데 필요한 것은 config 한 줄이다.

```bash
echo 'TICKET_CWD="$HOME/Projects/myproject"' > ~/.ticket-cron/myproject.config.sh

# 티켓 하나 만들고
mkdir -p ~/Projects/myproject/.fs-tickets/tickets
cat > ~/Projects/myproject/.fs-tickets/tickets/a1b2c3d4.md <<'EOF'
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

# 실행 없이 선정 결과·프롬프트만 확인
TICKET_CONFIG=~/.ticket-cron/myproject.config.sh tick.sh dryrun
```

cron 등록(프로젝트당 한 줄):

```
* * * * * TICKET_CRON=1 TICKET_CONFIG=$HOME/.ticket-cron/myproject.config.sh $HOME/Projects/fs-tickets/tick.sh >> $HOME/.ticket-cron/cron.log 2>&1
```

중지는 그 줄 삭제. 진행 상황은 `~/.ticket-cron/runner.log`, 세션별 출력은
`~/.ticket-cron/logs/<시각>-<프로젝트>-<해시>.log`.

## 티켓

```
<TICKET_CWD>/.fs-tickets/        <- 기본 티켓 루트. 프로젝트 안에 큐가 산다
  tickets/<hash>.md              <- 큐. 평면이다. 하위 디렉터리 없음
  personas/<이름>/PROFILE.md
```

스트림에 설치하면 `~/Projects/stream/.fs-tickets`, 프루퍼면 `~/Projects/proofer/.fs-tickets`.
루트가 없으면 만든다. 다른 위치(공유 클라우드 워크스페이스 등)에 두려면 config에서 `TICKET_ROOT`나
`resolve_ticket_root()`로 덮어쓴다 — **명시로 준 경로는 없으면 에러**다(미마운트를 빈 큐로 착각하면
디스패처가 조용히 아무것도 안 한다).

**상태는 파일명, 나머지는 frontmatter.**

| 파일명 | 뜻 |
|---|---|
| `<hash>.md` | 미착수. 큐에 보인다 |
| `<hash>.wip.md` | 진행중(누군가 잡았다) |
| `<hash>.done.md` | 완료 |

접미사 문자열은 `TICKET_INPROGRESS`·`TICKET_DONE`으로 바꾼다. **상태가 파일명에 있는 이유는
rename이 그 자체로 락이기 때문**이다(아래 [동작](#동작) 참조).

| frontmatter | 필수 | 뜻 |
|---|---|---|
| `ticket:` | ✓ | 해시. 파일명과 같게 둔다(없으면 파일명에서 딴다) |
| `title:` | ✓ | 사람이 읽는 제목 |
| `kind:` | | `request`=부탁 / `work`=지시 / `feedback`=결과보고. 표시용이고 값을 강제하지 않는다 |
| `persona:` | | 수행할 페르소나 이름. 없으면 페르소나 없는 평범한 에이전트가 처리한다 |
| `deps:` | | `[<hash>...]` 하드 선후. 전부 완료돼야 큐에 뜬다 |
| `session_id:` `assigned_at:` `owner:` | | 디스패처가 쓴다. 사람이 건드리지 않는다 |
| `pid:` `claimed_at:` `transcript:` | | `handclaim`이 쓴다(생존 확인용) |

**큐는 하나다.** 역할별 수신함(`to-<역할>/`)도 성격별 디렉터리(`request/`·`work/`)도 없다 —
디렉터리로 나누던 건 전부 frontmatter로 갔다. 파일을 옮기지 않고 한 줄 고쳐 수행자와 성격이 바뀐다.
구 레이아웃에 티켓이 남아 있으면 `list`·`select`가 stderr로 경고한다(큐에서 안 보이므로 조용히
굶는 대신 알린다).

## 페르소나

```
<TICKET_PERSONAS 또는 $TICKET_ROOT/personas>/
  pm/PROFILE.md  designer/PROFILE.md  developer/PROFILE.md
```

티켓의 `persona:` 이름으로 프로필을 찾아 **본문을 프롬프트 머리에 인라인**한다(경로만 주면 세션이
안 읽고 시작할 수 있다). 프로필과 티켓 지시가 충돌하면 티켓을 따르고 충돌 사실을 티켓에 남기라고
지시한다.

`persona:`가 없으면 페르소나 없이 디스패치되고, 그게 정상 경로다 — 롤플레잉이 필요한 티켓에만
붙인다. 이름은 있는데 프로필 파일이 없으면 `WARN`만 남기고 그냥 돈다. 값은 경로 조각이 되므로
`[A-Za-z0-9_-]+`만 통과한다(`persona: ../../.ssh`로 임의 파일이 프롬프트에 실려 나가지 않게).

`PROFILE.md`는 형식이 없다 — 그냥 마크다운이다.

```markdown
# PM

스펙 확정과 우선순위 조정이 내 일이다. 코드는 직접 짜지 않고
`persona: developer` + `kind: work` 티켓으로 넘긴다.

## 판단 기준
- 요구가 모호하면 구현 전에 `kind: request` 티켓으로 되묻는다. 추측으로 스펙을 채우지 않는다.
- 범위가 커지면 쪼개서 deps로 엮는다.
```

## 명령

```
tick.sh                    1회 디스패치(cron 진입점. 맨 앞에서 reap도 돈다)
tick.sh list               열린 티켓 큐 + 할당·deps 대기 상태
tick.sh dryrun             claim·실행 없이 선정 결과·엔진·프롬프트만 출력
tick.sh reap               스테일 수거만 1회
tick.sh unassign <해시>    할당 해제(session_id 비우기 + 진행중 접미사 떼기) -> 큐 복귀
```

전부 `TICKET_CONFIG=<config>`를 앞에 붙여 쓴다(생략하면 `~/.ticket-cron/config.sh`).

`tickets.py`는 큐·frontmatter 헬퍼이고 단독 CLI로도 쓴다. 사람이 직접 쓰는 건 사실상 하나다:

```
python3 tickets.py handclaim <티켓경로> "<페르소나 / 세션식별>"
```

대화형 세션이 티켓을 손으로 잡을 때 쓴다. **맨손 `mv`로 잡으면 생존 신호(`pid`)가 없어 세션이
조용히 죽었을 때 영구 좀비가 된다.** 나머지 서브커맨드(`select`·`claim`·`release`·`assign`·`clear`·
`find`·`list`·`reap`)는 `tick.sh`가 호출하지만 스크립트를 짜 붙일 때 그대로 쓸 수 있다 —
`select`는 `path|hash|kind|persona` 줄을 낸다.

## config 레퍼런스

config는 `tick.sh`가 `.`(source)로 읽는 셸 스크립트다. 상태 디렉터리(로컬)에 둔다 — 티켓 루트가
클라우드 마운트일 때, 마운트가 안 붙은 상태에서도 부트스트랩이 되려면 탐색 로직 자체가 로컬에
있어야 한다. 전체 예시는 [`config.sh.example`](config.sh.example).

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `TICKET_CWD` | `$HOME` | **프로젝트 경로.** 디스패치된 세션의 작업 디렉터리 |
| `TICKET_ROOT` | `$TICKET_CWD/.fs-tickets` | 티켓 루트. 명시하면 없을 때 에러(안 만든다) |
| `resolve_ticket_root()` | — | `TICKET_ROOT`가 빌 때 호출되는 탐색 함수. 경로 한 줄을 stdout으로 |
| `TICKET_NAME` | config 파일명 | 로그 접두 |
| `TICKET_PERSONAS` | `$TICKET_ROOT/personas` | 페르소나 프로필 디렉터리 |
| `TICKET_CONTEXT` | (없음) | `("<경로>\|<설명>" ...)` 배열. 프롬프트 꼬리에 참조 자료로 붙는다. 없는 경로는 건너뛰고 `WARN`만 |
| `TICKET_ENGINE` | `(claude -p "{prompt}" --session-id "{sid}" --dangerously-skip-permissions --output-format json)` | 실행 엔진 argv. `{prompt}`·`{sid}` 치환 |
| `TICKET_ENGINE_PS` | `[c]laude -p .*--session-id` | 동시 실행 카운트용 `ps` 패턴 |
| `TICKET_PROMPT_FMT` | `%s 티켓을 확인해 주세요. ...` | printf 포맷. `%s` = 티켓 해시 하나뿐 |
| `TICKET_INPROGRESS` | `.wip` | 진행중 접미사 |
| `TICKET_DONE` | `.done` | 완료 접미사 |
| `TICKET_MAXCONC` | `3` | 동시 실행 상한(머신 전역 카운트) |
| `TICKET_MAXRUN` | `5400` | 세션 1건 실행 상한(초). 초과 시 TERM→KILL 후 백로그 복귀 |

**엔진을 바꾸면 `TICKET_ENGINE_PS`도 같이 바꿔야 한다.** 안 바꾸면 살아있는 세션이 항상 0으로 세져
동시 실행 상한이 조용히 무력화된다.

```sh
TICKET_ENGINE=(codex exec --json "{prompt}")
TICKET_ENGINE_PS="[c]odex exec"
```

응답 JSON에서 실제 `session_id`를 읽어 frontmatter를 정정하는 단계는 `claude` 전용이고 다른 엔진이면
그냥 건너뛴다.

호출 시점 환경변수(config가 아니라 명령줄에서 준다):

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `TICKET_CONFIG` | `$TICKET_STATE/config.sh` | 쓸 config 파일 |
| `TICKET_STATE` | `~/.ticket-cron` | 상태 디렉터리(config·로그·토큰) |
| `TICKET_CRON` | `0` | `1`이면 토큰 없을 때 조용히 종료(무의미한 디스패치 방지) |

## 동작

1. config 로드 → `TICKET_ROOT` 확정.
2. `reap`(스테일 수거) → 동시 실행 상한 확인.
3. 상태 접미사 없고 `session_id`가 비었고 `deps`가 다 충족된 티켓을 생성일(`st_birthtime`)
   최고참부터 훑는다.
4. **잡기 = 원자적 link.** `os.link`로 `<hash>.wip.md`를 만들고 원본을 지운다. 목적지가 있으면
   커널이 `EEXIST`를 주므로 먼저 성공한 쪽만 이긴다 — 판정과 획득이 한 시스템콜 안에 있어 틈이 없다.
   이미 잡혔으면 다음 후보로 넘어간다.
   하드링크 미지원 파일시스템(구글드라이브 등 FUSE·SMB)에서는 `O_CREAT|O_EXCL`로 폴백한다.
   **`os.rename` 폴백은 락이 아니다** — 목적지가 있어도 조용히 덮어쓰고, `exists()` 선검사는
   TOCTOU라 두 프로세스가 둘 다 통과한다.
5. frontmatter에 `session_id`/`assigned_at`/`owner`를 먼저 기록(디스패치 순간부터 큐에서 제외)하고
   `cd $TICKET_CWD` 후 엔진을 띄운다. 프롬프트는 [페르소나 프로필] + [본문 지시] + [참조 컨텍스트] 순.
6. rc=0이면 응답의 실제 `session_id`로 frontmatter를 정정. rc≠0이면 할당 회수 + 백로그 복귀
   (다음 tick이 다시 집는다).

**동시 실행 상한**(`TICKET_MAXCONC`)은 진행중 파일 수가 아니라 **살아있는 세션 수**로 센다.
파일 수로 세면 `HOLD` 티켓이 슬롯을 영구히 먹어 루프가 굶는다. 카운트는 머신 전역이다 — CPU·API·
공유 DB 경합은 프로젝트를 가리지 않는다.

## 스테일 수거 (`reap`)

매 tick 맨 앞에 돈다. 없으면 **세션이 사람에게 질문하고 rc=0으로 종료한 티켓이 영구 유실된다**
(rc≠0 회수 경로가 그 경우를 못 잡는다).

- **디스패처 세션**: frontmatter `session_id`를 `ps`의 `--session-id`와 대조해 **죽은 것만** 회수.
  유예 3분, `attempts`를 올리며 2회까지만 자동 회수하고 3회째부터 `.wip` 유지 + `HOLD` 로그
  (같은 이유로 죽는 티켓이 세션을 무한히 태우는 걸 막는다. 이후엔 사람이 원인을 없애고 `unassign`).
- **손 클레임**(대화형 세션): `ps`에 `--session-id`가 안 뜨므로 `handclaim`이 적어둔 `pid`로 본다.
  pid 죽음 = 회수. pid가 살아있으면 트랜스크립트를 테일해 유휴만 `SUSPECT`로 **보고만** 한다 —
  작업 중인 워크트리에 미완 변경분이 있을 수 있어 자동 회수는 사람 판단을 건너뛴다.
  `pid`가 없는 손 클레임은 건드리지 않는다(생존을 확인할 방법이 없으면 회수도 하지 않는다).

## 설계 근거

실제로 물려본 것들만 남긴 결정이다.

- **상태는 파일명, 락은 그 rename.** [Maildir](https://en.wikipedia.org/wiki/Maildir)와 같은 계보다.
  상태를 frontmatter로 옮기면 read-modify-write가 프로세스 간 원자적이지 않아 **별도 락을 새로
  사야 한다** — 공짜 락을 버리는 거래다.
- **버린 대안: 시간 기반 클레임 만료**(파일 기반 칸반 도구들이 흔히 쓰는 1시간 만료).
  오래 걸리는 정상 세션을 살아있는데도 회수해 같은 티켓을 두 세션이 동시에 수행한다.
  프로세스 생존이 직접 증거이고 시간은 판정이 아니라 점검 트리거로만 쓴다.
  실행 상한(`TICKET_MAXRUN`)은 별개 장치다 — 매달린 세션 하나가 2시간 14분간 티켓을 쥐고 있던
  사례가 근거.
- **동시 실행 상한이 있는 이유**: 동시 4세션이 같은 소스·공유 dev DB를 만져 컬럼 드롭이 관측됐다.
- **`reap`이 있는 이유**: 질문하고 rc=0으로 끝난 세션의 티켓이 하루 3건 유실돼 수동 복구했다.
- **성격·상태 3종·해시 파일명·claim 락은 config로 열지 않는다.** 프로토콜 자체다.

## 테스트

의존성 없이 그냥 돌린다. 실패하면 `assert`로 죽는다.

```bash
python3 test_generic.py       # 평면 큐·kind/persona·접미사·프롬프트·deps·기본 루트·커스텀 엔진
python3 test_reap_manual.py   # 스테일 판정 6케이스
python3 test_claim_race.py    # claim 락 동시성: 24프로세스 동시 claim, link·O_EXCL 두 경로
```

## 파일

```
tick.sh              디스패처(cron 진입점)
tickets.py           큐·frontmatter 헬퍼(단독 CLI로도 쓴다)
config.sh.example    프로젝트 바인딩 계약
test_*.py            자체검증 3종
~/.ticket-cron/      상태(레포 밖): <이름>.config.sh, oauth-token, runner.log, logs/
```

## 라이선스

MIT. [`LICENSE`](LICENSE) 참조.

## 한계

- 티켓 수백 건 규모를 전제한다. 매 tick마다 루트를 glob으로 훑는다(인덱스 없음).
- 우선순위가 없다. 순서는 생성일 + `deps`뿐이다.
- 티켓 본문 형식을 강제하지 않는다. 무엇을 완료로 볼지는 티켓에 사람이 쓴다.
- 협업 프로토콜(핸드오프 규약, 블록 처리 관례)은 이 레포에 없다. 큐와 디스패치만 담당한다.
