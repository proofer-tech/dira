# 엔진 MCP

> 2026-10-11 현재 엔진에는 MCP 서버(`mcp_server.py`)가 들어와 있습니다. `dira mcp` 명령, 앱이
> HTTP 서버를 띄우는 부분, 설정 화면의 `MCP` 절은 아직 구현 중입니다. `dira mcp`가 명령을 찾지
> 못한다는 오류로 끝나거나 설정 화면에 `MCP` 절이 없으면 아래 [앱 없이 붙이기](#앱-없이-붙이기)대로
> `python3`로 서버를 직접 지정하세요.

MCP를 지원하는 클라이언트(Claude Code, Claude Desktop, Cursor 등)에서 dira 큐를 다룹니다.
티켓 만들기와 읽기, 절 덧붙이기, 워커 돌리기, 도는 세션에 참견 보내기를 그 클라이언트의
대화 안에서 합니다. 앱 화면이나 셸에서 하던 엔진 작업은 MCP로도 전부 할 수 있습니다.

## 무엇을 할 수 있나

자주 쓰는 작업은 이름 붙은 도구로 있습니다.

| 도구 | 하는 일 |
|---|---|
| `projects` | 앱에 등록된 프로젝트와 큐 루트를 돌려줍니다(`~/.config/dira/gui-projects.json`) |
| `queue_list` | 열린 티켓 목록. `<w>.sh list`와 같습니다 |
| `dispatch` | 워커를 1회 돌립니다. `worker` 인자에 워커 이름을 줍니다 |
| `dryrun` | 실행 없이 선정 결과만 봅니다 |
| `reap` | 세션이 죽은 티켓을 회수합니다 |
| `unassign` | 티켓 할당을 풉니다. 인자는 `hash`, `force` |
| `ticket_find` | 해시로 티켓 경로를 찾습니다(`tickets.py find`) |
| `ticket_read` | 티켓 본문 전문을 읽습니다 |
| `ticket_create` | frontmatter와 본문으로 새 `<8자 해시>.md`를 만듭니다. 같은 해시가 있으면 실패합니다 |
| `ticket_append` | 그 해시의 현재 파일명을 다시 찾아 끝에 절을 더합니다. 파일이 0개거나 2개 이상이면 실패합니다 |
| `ticket_done` | `.wip`을 `.done`으로 바꿉니다. 다른 rename은 하지 않습니다 |
| `interject` | 진행 중인 세션에 참견 한 줄을 보냅니다. 화면의 참견과 같은 길로 갑니다 |
| `graph_query` | 온톨로지에 묻습니다(`graph.py query`) |
| `env_list` `env_create` `env_replace` `env_delete` | 프로젝트 환경변수를 다룹니다. 값은 응답에 싣지 않습니다 |

이 표에 없는 작업은 `engine_exec`로 합니다. `program`에 아래 허용목록 중 하나를, `args`에 인자
배열을 줍니다. 셸을 거치지 않고 실행하며 결과는 `{rc, stdout, stderr}`로 돌아옵니다. 시간
상한 `timeout`의 기본값은 600초입니다.

- `tickets.py` `graph.py` `learn.py` `dira_env.py`
- `workers/<w>.sh` - 큐 루트 안에 실제로 있는 워커 파일만
- `push.sh` `token-rotate.sh` - `push.sh`는 `cwd`를 받는데 큐 루트 `worktrees/` 아래 실제 디렉터리만 됩니다

예를 들어 손으로 티켓을 가져가는 `handclaim`은 `program`을 `tickets.py`로, `args`를
`["handclaim", "<티켓 경로>"]`로 줍니다. 엔진에 서브커맨드가 늘면 이 경로로 같이 닿습니다.

### 어느 큐인지 정하기

모든 도구는 `root` 인자로 큐 루트(`<프로젝트>/.dira`)를 받습니다. 빠뜨리면 환경변수
`TICKET_ROOT`를 쓰고 그것도 없으면 `root가 필요합니다`로 끝납니다. 큐 루트를 모르면 `projects`부터
부르세요. 한 프로젝트만 다룰 거라면 클라이언트 설정에 `TICKET_ROOT`를 넣어 두는 편이 편합니다.

### MCP가 하지 않는 것

MCP를 거쳐도 큐 규칙은 그대로입니다. 티켓을 가져가는(claim) 길은 `tickets.py`의 원자적 link
하나뿐이고, 티켓 이름을 바꾸는 도구는 `ticket_done` 하나입니다. `push --force`, `reset --hard`,
`stash`, 원격 push를 실행하는 도구는 없습니다.

## 클라이언트에 붙이기

붙이는 방법은 stdio와 HTTP 두 가지입니다. 설정 화면의 `MCP` 절에 두 방법의 연결 설정이 복사
버튼과 함께 있습니다. 복사한 값을 클라이언트의 MCP 서버 설정에 서버 하나로 넣으세요. 넣는
파일과 바깥 모양은 클라이언트마다 다르니 그 클라이언트의 문서를 따릅니다.

### stdio - `dira mcp`

```json
{"command":"dira","args":["mcp"]}
```

클라이언트가 필요할 때 `dira mcp`를 띄우고 다 쓰면 내립니다. 앱이 꺼져 있어도 됩니다. 엔진만
설치되어 있으면 언제나 뜹니다. 큐 루트를 고정하려면 클라이언트 설정의 환경변수 자리에
`TICKET_ROOT`를 넣습니다.

### HTTP - 앱이 띄운 서버

```json
{"type":"http","url":<url>,"headers":{"Authorization":"Bearer <token>"}}
```

`<url>`과 `<token>`은 설정 화면에서 복사한 값에 이미 채워져 있습니다. 서버는 `127.0.0.1`에만
열리므로 다른 기기에서는 붙을 수 없습니다. 토큰이 없거나 틀린 요청은 `401`로 거절하고, 다른 사이트의 브라우저
요청은 `403`으로 막습니다.

**토큰은 앱을 켤 때마다 새로 만들어집니다.** 앱을 다시 켰다면 설정 화면에서 HTTP 설정을 다시
복사해 클라이언트에 넣으세요. 옛 토큰은 `401`로 끝납니다. 지금 값은 `~/.config/dira/run/mcp.json`의
`url`과 `token`에도 있습니다.

### 앱 없이 붙이기

`git clone`으로 엔진만 받았다면 엔진 레포의 `mcp_server.py`를 `python3`로 직접 지정합니다.
경로는 엔진을 받은 자리로 바꾸세요.

```json
{"command":"python3","args":["/Users/<나>/Projects/dira/mcp_server.py"]}
```

## 앱이 꺼지면 HTTP도 꺼집니다

엔진에는 상주 프로세스가 없습니다. cron이 매분 워커를 한 번 띄우고 끝납니다. 계속 떠 있는 것은
데스크톱 앱뿐이라 HTTP 서버는 앱이 데리고 있습니다.

- 앱이 켜지면 HTTP 서버가 뜨고 `~/.config/dira/run/mcp.json`에 `{url, token, pid, started_at}`가
  적힙니다.
- 서버가 앱보다 먼저 죽으면 1초 뒤 앱이 다시 띄우고 `mcp.json`을 새 값으로 다시 씁니다.
- 60초 안에 5번 죽으면 앱이 더 띄우지 않고 트레이 메뉴에 `MCP 서버가 멈췄습니다 - 다시 시작`을
  띄웁니다. 누르면 다시 띄웁니다.
- 앱을 닫으면 서버도 내려가고 `mcp.json`이 지워집니다.

설정 화면 `MCP` 절의 상태 줄이 지금 상태를 보여 줍니다. `켜짐 - <url>`이면 HTTP로 붙을 수 있고,
`꺼짐`이면 앱이 띄운 서버가 없습니다. 브라우저에서 연 화면에는 HTTP 설정 대신 `앱에서만 뜹니다`가
나옵니다.

stdio는 앱과 상관없이 돕니다. 앱을 자주 끄거나 엔진만 쓴다면 stdio로 붙이세요. 단 `env_*` 도구는
[CLI](/docs/ref-cli)의 `dira env`처럼 앱이 떠 있어야 값을 읽고 씁니다.

다음은 [트러블슈팅](/docs/troubleshooting)입니다.
