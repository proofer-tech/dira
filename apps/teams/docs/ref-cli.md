# CLI

두 층입니다. 워커 스크립트는 사람이 부르는 진입점이고, `tickets.py`는 대개 그 워커
스크립트가 안에서 부르는 헬퍼입니다.

## 워커 스크립트 (`<루트>/workers/<이름>.sh`)

`tick.sh`를 직접 실행하면 rc=2로 거절합니다. 워커 파일이 어디 있는지 모르면 루트도
알 수 없기 때문입니다. 아래 명령은 전부 그 워커 파일을 거쳐서 씁니다.

| 명령 | 뜻 |
|---|---|
| (인자 없음) | 1회 디스패치. cron 진입점 — 워커 락 획득 → `reap` → 선정 → 실행 |
| `list` | 열린 티켓 큐 상태(대기·할당됨·deps 대기) |
| `dryrun` | claim·실행 없이 선정 결과와 조립된 프롬프트만 출력 |
| `reap` | 스테일 수거만 1회 |
| `unassign <해시> [--force]` | 할당 해제(`session_id` 비우기 + 진행중 접미사 떼기) → 큐 복귀 |

`list`·`dryrun`·`reap`·`unassign`은 큐 전체를 보기 때문에 같은 루트의 어느 워커
파일로 불러도 결과가 같습니다.

`unassign`은 세션이 아직 살아 있으면 거부하고 rc=3으로 끝냅니다. 산 세션을 두고 할당만 풀면
티켓이 다시 열려 두 워커가 같은 것을 뭅니다. 자기 자신을 푸는 경우는 예외입니다 — 부르는
세션이 그 티켓의 주인이면 그대로 통과합니다.

`--force`는 그 세션의 `pid`를 끊습니다. 끊기 **전에** 티켓을 답변 대기로 잠그기 때문에
풀린 티켓은 백로그로 안 돌아갑니다. 사람의 답을 기다리는 자리에 섭니다. 티켓에 `pid`가
없으면 강제도 소용이 없습니다. 끊을 대상이 없으니 그 세션을 직접 끝내셔야 합니다.

## `tickets.py` 서브커맨드

큐와 frontmatter를 다루는 헬퍼입니다. 대부분은 위 워커 스크립트가 안에서 부르고,
사람이 직접 쓰는 것은 `handclaim`과 `find` 정도입니다.

| 명령 | 인자 | 뜻 | 누가 쓰나 |
|---|---|---|---|
| `handclaim` | `<티켓경로> ["<owner>"]` | 대화형 세션이 손으로 티켓을 잡습니다. `claim` + `pid`·`claimed_at`·`transcript` 기록(생존 확인용) | **사람**(대화형 세션) |
| `find` | `<루트> <해시>` | 해시로 티켓 경로를 찾습니다 | 사람(`deps` 적기 전 존재 확인 등) 또는 엔진 |
| `select` | `<루트>` | 미할당 열린 티켓을 유효 우선순위 높은 순으로 `path\|hash\|kind\|persona\|priority\|baseline\|effective` 줄로 냅니다. 같은 값끼리는 생성일 오름차순입니다 | 엔진(`tick.sh`가 후보를 고를 때) |
| `wips` | `<루트>` | 지금 진행중인 티켓을 `path\|hash\|유효우선순위\|assigned_at\|pid\|owner` 줄로 냅니다. `select`의 반대쪽 — 누가 도는 중인지입니다 | 엔진(선점할 피해자를 고를 때) |
| `list` | `<루트>` | 열린 티켓 전체 상태 표 | 엔진(워커 `list`가 그대로 위임) |
| `claim` | `<경로>` | `<hash>.md` → `<hash><진행중접미사>.md` 원자적 잡기 | 엔진 |
| `release` | `<경로>` | 진행중 → 원래 이름으로 되돌리기(백로그 복귀) | 엔진 |
| `assign` | `<경로> <sid> ["<owner>"]` | frontmatter에 `session_id`·`assigned_at`(·`owner`) 기록. `pid`는 같이 비웁니다 | 엔진 |
| `setpid` | `<경로> <pid>` | frontmatter에 `pid` 기록 | 엔진 |
| `setinbox` | `<경로> <inbox경로>` | frontmatter에 `inbox`(참견 FIFO 경로) 기록 | 엔진 |
| `askhuman` | `<경로> [--if-blocked]` | 티켓을 답변 대기로 잠급니다 — 본문에 `## 질문 n`을 붙이고 없는 해시 하나를 `deps`와 `awaiting`에 넣습니다. `--if-blocked`면 마지막 절이 신선한 `## 블록`일 때만 겁니다 | 엔진(`unassign`의 두 갈래) |
| `clear` | `<경로>` | `session_id`·`assigned_at`·`pid`·`inbox` 비우기 | 엔진(`unassign`·디스패치 실패 경로) |
| `reap` | `<루트>` | 세션이 죽은 진행중 티켓을 백로그로 회수 | 엔진(매 tick 맨 앞) |

`select`는 `find`처럼 스크립트를 짜 붙일 때 그대로 부를 수 있습니다. 다만 사람이 평소에
큐를 만지는 자리는 워커 스크립트의 `list`·`dryrun`·`unassign`과 `handclaim` 하나로
충분합니다.

다음은 [frontmatter 필드](/docs/ref-frontmatter)입니다.
