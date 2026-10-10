# CLI

명령은 두 층으로 나뉩니다. 워커 스크립트는 사람이 부르는 진입점이고, `tickets.py`는 대개
그 워커 스크립트가 안에서 부르는 헬퍼입니다.

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

`list`, `dryrun`, `reap`, `unassign`은 큐 전체를 보기 때문에 같은 루트의 어느 워커
파일로 불러도 결과가 같습니다.

`unassign`은 세션이 아직 살아 있으면 거부하고 rc=3으로 끝냅니다. 살아 있는 세션을 두고 할당만
풀면 티켓이 다시 열려서 두 워커가 같은 티켓을 동시에 가져갑니다. 자기 자신을 푸는 경우는
예외입니다. 부르는 세션이 그 티켓의 주인이면 그대로 통과합니다.

`--force`는 그 세션의 `pid`로 프로세스를 종료합니다. 종료하기 **전에** 티켓을 답변 대기로
잠그기 때문에 풀린 티켓은 백로그로 안 돌아갑니다. 사람의 답을 기다리는 상태로 남습니다.
티켓에 `pid`가 없으면 `--force`를 붙여도 소용이 없습니다. 종료할 대상이 없으니 그 세션을
직접 끝내셔야 합니다.

## `tickets.py` 서브커맨드

큐와 frontmatter를 다루는 헬퍼입니다. 대부분은 위 워커 스크립트가 안에서 부르고,
사람이 직접 쓰는 것은 `handclaim`과 `find` 정도입니다.

| 명령 | 인자 | 뜻 | 누가 쓰나 |
|---|---|---|---|
| `handclaim` | `<티켓경로> ["<owner>"]` | 대화형 세션이 손으로 티켓을 가져갑니다. `claim` + `pid`·`claimed_at`·`transcript` 기록(생존 확인용) | **사람**(대화형 세션) |
| `find` | `<루트> <해시>` | 해시로 티켓 경로를 찾습니다 | 사람(`deps` 적기 전 존재 확인 등) 또는 엔진 |
| `select` | `<루트>` | 미할당 열린 티켓을 유효 우선순위 높은 순으로 `path\|hash\|kind\|persona\|priority\|baseline\|effective` 줄로 출력합니다. 같은 값끼리는 생성일 오름차순입니다 | 엔진(`tick.sh`가 후보를 고를 때) |
| `wips` | `<루트>` | 지금 진행중인 티켓을 `path\|hash\|유효우선순위\|assigned_at\|pid\|owner` 줄로 출력합니다. `select`와 반대로 지금 수행 중인 티켓을 보여줍니다 | 엔진(선점할 대상을 고를 때) |
| `list` | `<루트>` | 열린 티켓 전체 상태 표 | 엔진(워커 `list`가 그대로 위임) |
| `claim` | `<경로>` | `<hash>.md` → `<hash><진행중접미사>.md` 원자적 가져가기 | 엔진 |
| `release` | `<경로>` | 진행중 → 원래 이름으로 되돌리기(백로그 복귀) | 엔진 |
| `assign` | `<경로> <sid> ["<owner>"]` | frontmatter에 `session_id`·`assigned_at`(·`owner`) 기록. `pid`는 같이 비웁니다 | 엔진 |
| `setpid` | `<경로> <pid>` | frontmatter에 `pid` 기록 | 엔진 |
| `setinbox` | `<경로> <inbox경로>` | frontmatter에 `inbox`(참견 FIFO 경로) 기록 | 엔진 |
| `askhuman` | `<경로> [--if-blocked]` | 티켓을 답변 대기로 잠급니다 — 본문에 `## 질문 n`을 붙이고 없는 해시 하나를 `deps`와 `awaiting`에 넣습니다. `--if-blocked`면 마지막 절이 방금 적힌 `## 블록`일 때만 잠급니다 | 엔진(`unassign`의 두 갈래) |
| `clear` | `<경로>` | `session_id`·`assigned_at`·`pid`·`inbox` 비우기 | 엔진(`unassign`·디스패치 실패 경로) |
| `reap` | `<루트>` | 세션이 죽은 진행중 티켓을 백로그로 회수 | 엔진(매 tick 맨 앞) |

`select`는 `find`처럼 직접 스크립트를 작성해 연동할 때 그대로 부를 수 있습니다. 다만 사람이
평소에 큐를 다루는 데에는 워커 스크립트의 `list`, `dryrun`, `unassign`과 `handclaim`으로
충분합니다.

## `dira env` - 세션에서 프로젝트 환경변수 쓰기

> 2026-10-10 현재 이 절의 명령과 세션 시작 안내는 아직 구현 중입니다. 세션에서 `dira env list`를
> 실행해 명령을 찾지 못한다는 오류가 나면 아직 이 절대로 쓸 수 없는 상태입니다.

설정 화면의 `환경변수`에 맡긴 값을 세션이 꺼내 쓰는 명령입니다. 화면 쪽 사용법과 지켜 주는
범위는 [화면 소개](/docs/screens)의 `프로젝트 환경변수` 절에 있습니다. 명령도 화면과 같은
값을 다루고, dira 데스크톱 앱이 떠 있어야 동작합니다.

워커 세션과 프로젝트 홈 세션은 시작할 때 이 프로젝트에 등록된 변수 이름과 아래 명령을
안내받습니다. 값과 revision은 받지 않습니다. 그 이름 목록은 세션이 시작된 시점의 것이라,
중간에 누가 바꿨을 수 있으면 `dira env list`로 다시 읽습니다. 프로젝트 없이 연 홈 세션에는 이
안내가 없습니다.

| 명령 | 뜻 |
|---|---|
| `dira env list` | 이름, 수정 시각, revision을 출력합니다. 값은 출력하지 않습니다 |
| `dira env create NAME --stdin` | stdin으로 받은 값을 새 이름으로 등록합니다. 같은 이름이 있으면 거절합니다 |
| `dira env replace NAME --revision REV --stdin` | 새 값으로 교체합니다. REV가 지금 revision과 다르면 충돌로 끝납니다 |
| `dira env delete NAME --revision REV` | 지웁니다. REV 판정은 `replace`와 같습니다 |
| `dira env run --keys NAME1,NAME2 -- COMMAND ARGS...` | 고른 이름만 COMMAND의 환경에 넣어 실행합니다 |

값은 stdin으로만 받습니다. 값을 명령 인자로 받는 옵션은 없고, 어떤 명령도 값을 출력하지
않습니다. 등록은 이렇게 합니다.

```sh
# 클립보드에 복사해 둔 값을 등록한다. 값이 명령줄에 남지 않는다
pbpaste | dira env create TEST_API_TOKEN --stdin

# list에서 읽은 revision을 넘겨 새 값으로 교체한다
dira env list
pbpaste | dira env replace TEST_API_TOKEN --revision <list에 나온 revision> --stdin
```

`echo`나 `printf`에 값을 적어 파이프로 넘기지 마세요. 값이 명령 인자가 되어 셸 기록에 남습니다.
세션이 사람만 가진 값이 필요하면 값을 대화로 받지 말고 설정 화면에 넣어 달라고 요청합니다.
값이 대화나 도구 호출 기록에 한 번 들어가면 dira가 그 기록을 지워 주지 않습니다.

`replace`나 `delete`가 충돌로 끝났으면 다른 세션이 먼저 바꾼 것입니다. `dira env list`로 새
revision을 읽고 다시 실행하세요. 두 세션이 같은 revision으로 동시에 교체하면 하나만 성공합니다.

### `run` - 고른 변수만 넣어 실행

```sh
dira env run --keys TEST_API_TOKEN,TEST_DB_URL -- python3 scripts/smoke.py --target staging
```

- `--keys`에 적은 이름만 들어갑니다. 등록돼 있어도 적지 않은 이름은 넘어가지 않습니다.
- 적은 이름이 하나라도 없으면 COMMAND를 아예 시작하지 않습니다. 지운 이름, 등록할 수 없는 이름이
  여기에 걸립니다.
- 셸 환경에 같은 이름이 이미 있으면 등록한 값이 우선합니다. `run`을 부른 셸의 환경은 바뀌지
  않습니다.
- COMMAND는 셸을 거치지 않고 적힌 인자 그대로 실행됩니다. 파이프나 `$TEST_API_TOKEN` 같은 확장이
  필요하면 `-- sh -c '...'`처럼 셸을 직접 부르세요.
- 종료 코드는 COMMAND의 것을 그대로 돌려주고, Ctrl-C 같은 취소 신호도 COMMAND에 전달됩니다.
- COMMAND의 stdout과 stderr, 진행 기록에서 넣은 값과 똑같은 문자열은 가려집니다. 여러 줄에 걸치거나
  출력이 여러 번에 나눠 나와도 가립니다. 값을 바꿔 출력하는 것까지는 가리지 못합니다.
- 값은 실행할 때마다 새로 읽습니다. 화면에서 교체하거나 지운 결과는 다음 `run`부터 반영되고, 이미
  떠 있는 COMMAND는 옛 값으로 계속 돕니다.

데스크톱 앱이 꺼져 있거나 연결이 끊기면 모든 `dira env` 명령이 `unavailable`로 끝납니다.
`run`은 COMMAND를 시작하지 않고, `create`, `replace`, `delete`는 아무것도 저장하지 않습니다.
변수가 없다는 뜻이 아니니 앱을 띄우고 다시 실행하세요. OS 키 저장소가 잠겼을 때 푸는 법은
[화면 소개](/docs/screens)의 `프로젝트 환경변수` 절 표에 있습니다.

다음은 [frontmatter 필드](/docs/ref-frontmatter)입니다.
