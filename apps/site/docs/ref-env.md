# 워커 환경변수

워커 파일에서 `tick.sh`를 source하기 **전에** 값을 얹으면 기본값을 덮어씁니다. 꼭 있어야
하는 줄은 source 한 줄뿐이고, 아래는 전부 선택입니다. 실제 소스는
[`tick.sh`](https://github.com/proofer-tech/dira/blob/master/tick.sh)에 있습니다.

## 워커 설정값

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `TICKET_NAME` | 워커 파일명(`.sh` 제외) | 로그 접두 + 티켓 `owner` 표기 |
| `TICKET_CWD` | 티켓 루트의 부모 | 디스패치된 세션의 작업 디렉터리 |
| `TICKET_PERSONAS` | `<루트>/personas` | 페르소나 프로필 디렉터리 |
| `TICKET_PROTOCOLS` | `<루트>/protocols` | 협업 프로토콜 디렉터리. 안의 `AGENTS.md`가 전원 프롬프트에 실립니다 |
| `TICKET_CONTEXT` | (없음) | `("<경로>\|<설명>" ...)` 배열. 프롬프트 꼬리에 참조 자료로 붙습니다. 없는 경로는 건너뛰고 `WARN`만 남깁니다 |
| `TICKET_ENGINE` | `(claude -p --session-id "{sid}" --dangerously-skip-permissions --input-format stream-json --output-format stream-json --verbose)` | 실행 엔진 argv. `{prompt}`·`{sid}`가 실행 직전에 치환됩니다. 기본 엔진은 스트리밍 입력이라 최초 프롬프트도 stdin(FIFO)으로 들어갑니다. [도는 세션에 말 걸기](/docs/barge-in)가 그 통로입니다 |
| `TICKET_PROMPT_FMT` | `%s 티켓을 확인해 주세요. (...)` | printf 포맷. `%s` = 티켓 해시 하나뿐 |
| `TICKET_INPROGRESS` | `.wip` | 진행중 상태 파일명 접미사 |
| `TICKET_DONE` | `.done` | 완료 상태 파일명 접미사 |
| `TICKET_MAXRUN` | `5400`(초) | 세션 1건 실행 상한. 초과 시 TERM → KILL 후 백로그 복귀 |
| `TICKET_FEED_TIMEOUT` | `120`(초) | 최초 프롬프트가 FIFO를 다 통과할 때까지 기다리는 상한. 스트리밍 입력 엔진 전용이고, 엔진이 이 안에 stdin을 안 읽으면 `STALL`로 실패 처리합니다 |

티켓 루트는 설정값이 없습니다. 워커 파일이 놓인 자리가 그대로 루트를 정하기 때문입니다.
응답 JSON에서 실제 `session_id`를 읽어 frontmatter를 고쳐 쓰는 단계는 `claude` 엔진
전용이라, 다른 엔진을 쓰면 그냥 건너뜁니다.

## 머신 로컬 상태

호출하는 시점의 환경변수로만 바뀝니다. 워커 파일에 적는 값이 아닙니다.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `TICKET_LOCAL` | `~/.config/dira` | 토큰(`oauth-token`)과 워커 락(`run/`)이 사는 자리. 티켓 루트가 공유 드라이브에 있어도 여기는 이 머신만의 것입니다 |

다음은 [CLI](/docs/ref-cli)입니다.
