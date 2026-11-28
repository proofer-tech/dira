# 엔진 MCP

> `dira mcp` 명령, HTTP 서버, 설정 화면의 `MCP` 절은 v1.2.19부터 들어 있습니다.
> `dira mcp`가 명령을 찾지 못한다는 오류로 끝나거나 설정 화면에 `MCP` 절이 없으면 앱이 그보다
> 낮은 버전입니다. 앱을 v1.2.19 이상으로 올리세요. 지금 올릴 수 없다면 아래
> [앱 없이 붙이기](#앱-없이-붙이기)대로 `python3`로 서버를 직접 지정하면 됩니다.

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
| `awaiting_list` | 답변 대기 티켓과 그 질문을 모아 봅니다. `root`를 빼면 등록된 프로젝트 전부를 훑습니다. 아래 [답변 대기를 다른 에이전트에게 맡기기](#답변-대기를-다른-에이전트에게-맡기기) |
| `ticket_answer` | 답변 대기 티켓에 답을 답니다. 화면의 `답변 쓰기`와 같은 파일을 만듭니다 |
| `ticket_status` | 티켓의 지금 상태를 돌려줍니다. 인자는 `hash` 또는 `uri`이고, `hashes`로 여러 장을 한 번에 받습니다. 아래 [티켓 상태 받아보기](#티켓-상태-받아보기) |
| `ticket_wait` | 티켓 상태가 `since`와 달라질 때까지 기다렸다가 돌려줍니다. 아래 [티켓 상태 받아보기](#티켓-상태-받아보기) |
| `graph_query` | 온톨로지에 묻습니다(`graph.py query`) |
| `ontology_objects` `ontology_object` `ontology_search` | 온톨로지 객체를 목록-하나-검색으로 읽습니다. 아래 [온톨로지 읽기](#온톨로지-읽기) |
| `ontology_versions` `ontology_version` `ontology_schema` | 객체의 지난 판과 온톨로지 스키마를 읽습니다. 아래 [온톨로지 읽기](#온톨로지-읽기) |
| `env_list` `env_create` `env_replace` `env_delete` | 프로젝트 환경변수를 다룹니다. 값은 응답에 싣지 않습니다 |
| `project_register` | 이미 만들어 둔 큐를 앱의 프로젝트 목록에 등록합니다. 인자는 `path` `name` `id`이고, 화면에서 등록할 때와 같은 검사를 거칩니다. 아래 [프로젝트 등록과 설정을 다른 에이전트에게 맡기기](#프로젝트-등록과-설정을-다른-에이전트에게-맡기기) |
| `project_rename` | 등록된 프로젝트의 이름을 바꿉니다. 인자는 `id` `name` |
| `project_reorder` | 프로젝트 목록의 순서를 바꿉니다. 인자는 `ids` |
| `project_unregister` | 프로젝트를 목록에서만 뺍니다. 큐 파일은 지우지 않습니다 |
| `settings_get` | 이 컴퓨터의 설정(언어, 주도성, 오토파일럿, 다중계정, 세션 상한)을 읽습니다 |
| `settings_set` | 이 컴퓨터의 설정 중 인자로 준 것만 바꿉니다 |
| `project_settings_get` | 큐 하나의 통합 브랜치, `쉬는 동안 작업 트리 비우기` 상태, 워커 목록을 읽습니다 |
| `project_slim` | 큐 하나의 `쉬는 동안 작업 트리 비우기`를 켜거나 끕니다 |
| `ops_status` | 실행기 도구가 붙어 있는지 알려 줍니다. 아래 [화면 없이 프로젝트를 만들고 설정하기](#화면-없이-프로젝트를-만들고-설정하기) |

프로젝트 만들기, 워커 추가, 페르소나 편집처럼 원래 화면에서만 하던 일은 실행기 도구로 따로 붙습니다.
`project_create`부터 `ticket_save`까지 이름이 많아서 위 표 대신
[실행기 도구 목록](#실행기-도구-목록)에 무리별로 모았습니다.

이 표에 없는 작업은 `engine_exec`로 합니다. `program`에 아래 허용목록 중 하나를, `args`에 인자
배열을 줍니다. 셸을 거치지 않고 실행하며 결과는 `{rc, stdout, stderr}`로 돌아옵니다. 시간
상한 `timeout`의 기본값은 600초입니다.

- `tickets.py` `graph.py` `learn.py` `dira_env.py`
- `workers/<w>.sh` - 큐 루트 안에 실제로 있는 워커 파일만
- `push.sh` `token-rotate.sh` - `push.sh`는 `cwd`를 받는데 큐 루트 `worktrees/` 아래 실제 디렉터리만 됩니다

예를 들어 손으로 티켓을 가져가는 `handclaim`은 `program`을 `tickets.py`로, `args`를
`["handclaim", "<티켓 경로>"]`로 줍니다. 엔진에 서브커맨드가 늘면 이 경로로 같이 닿습니다.

### 온톨로지 읽기

`ontology_`로 시작하는 도구 여섯은 온톨로지 위치의 `objects/` `versions/` `_ontology/` 아래 `.md`
파일을 직접 읽어 JSON으로 돌려줍니다. 이 여섯은 v1.2.19보다 뒤의 판에 들어오므로, 도구 목록에
`ontology_`로 시작하는 이름이 없으면 앱을 올리세요. [원격 큐](/docs/remote#웹에서-온톨로지를-볼-때)에서 웹이
온톨로지를 볼 때와 같은 코드를 거치므로 두 쪽의 답이 같습니다. 부를 때마다 파일을 새로 읽습니다.

| 도구 | 인자 | 돌려주는 것 |
|---|---|---|
| `ontology_objects` | `types` `cursor` `limit` | `objects/` 아래 객체 목록을 경로 순으로 돌려줍니다. 본문은 없습니다. `limit`은 기본 200, 최대 1,000이고, 남은 것이 있으면 `cursor`가 붙습니다. 다음 쪽은 그 값을 `cursor`로 다시 부릅니다 |
| `ontology_object` | `name` `backlinks` | 객체 하나에 본문(`body`)과 파일 원문(`content`)을 더해 돌려줍니다. 없으면 `object`가 `null`입니다. `backlinks`를 `true`로 주면 이 객체를 가리키는 관계도 함께 돌려줍니다 |
| `ontology_search` | `q` `types` `limit` | 이름-제목-속성 값-본문에서 `q`를 찾아 객체와 처음 맞은 자리 앞뒤 100자 안팎(`excerpt`)을 돌려줍니다. 이름이나 제목에서 맞은 것이 먼저 옵니다. `limit`은 기본 20, 최대 100입니다 |
| `ontology_versions` | `name` | 그 객체의 지난 판 목록을 판 이름-경로-`sha256`-수정 시각으로 돌려줍니다 |
| `ontology_version` | `name` `version` | 지난 판 하나의 원문과 `sha256`을 돌려줍니다. 없으면 `content`가 `null`입니다 |
| `ontology_schema` | 없음 | `_ontology/`의 객체 타입(`object_types`)과 관계 타입(`link_types`) 정의를 돌려줍니다 |

객체 하나는 `{name, type, path, sha256, title, props, links}`로 옵니다. `props`는 frontmatter에서
`name` `type` `links`를 뺀 나머지이고, `links`는 `[{type, to, props}]`입니다. frontmatter를 해석하지
못한 파일은 객체에서 빠지고 `errors`에 경로와 사유로 실립니다. 사유 다섯 가지는
[원격 큐](/docs/remote#웹에서-온톨로지를-볼-때)에 있습니다. `ontology_objects`는 첫 쪽에만 `errors`를
싣습니다.

`graph_query`는 온톨로지에서 만든 그래프에 질문을 던지고, 이 여섯은 파일 내용을 구조 그대로 읽습니다.
객체 하나의 속성이나 본문이 필요하면 `ontology_object`를 부르세요.

원격 작업 세션에는 이 MCP 서버가 저절로 붙지 않습니다. 그 세션에서 이 도구를 쓰려면 페르소나의
`mcp.json`에 `dira mcp` 서버가 들어 있어야 합니다.

### 답변 대기를 다른 에이전트에게 맡기기

세션이 `## 질문 n`을 남기고 멈춘 티켓은 [답변 대기](/docs/states#레인에-없는-표시-넷)로 잠깁니다. 이 답은
화면에서만 쓰는 것이 아닙니다. dira MCP를 붙인 다른 에이전트(Claude Cowork 등)에게 맡기면 그 에이전트가
브라우저를 열지 않고 도구 두 개로 처리합니다. 도구 목록에 `awaiting_list`와 `ticket_answer`가 없으면 앱을
올리세요.

에이전트에게는 이렇게 맡기면 됩니다.

> dira MCP로 등록된 프로젝트의 답변 대기 티켓을 모아 보고, 질문마다 선택지를 고르거나 직접 답을 써서
> 달아 줘. 판단이 서지 않는 질문은 답하지 말고 나에게 물어봐.

에이전트는 먼저 `awaiting_list`를 부릅니다. `root`를 주면 그 큐만 보고, 빼면 등록된 프로젝트 전부를
봅니다. 나오는 티켓은 화면에서 `답변 대기` 배지가 붙는 티켓과 같습니다. 프로젝트 순서대로 오고, 한
프로젝트 안에서는 오래 기다린 티켓이 먼저 옵니다. 큐 루트를 읽지 못한 프로젝트는 건너뛰고
`skipped`에 프로젝트와 사유를 적습니다. 항목 하나에는 이런 값이 실립니다.

| 키 | 뜻 |
|---|---|
| `project` `root` | 프로젝트 이름과 큐 루트 |
| `hash` `title` `persona` | 티켓 해시, 제목, 맡은 페르소나 |
| `awaiting` | 답 파일의 이름이 될 해시 |
| `round` `question` | 마지막 `## 질문 n` 절의 `n`과 그 절 전문 |
| `items` | 그 절에서 읽은 문항 목록 `[{number, title, options: [{letter, label}]}]` |

`items`는 문항이 `### 1.` `### 1-1.`로, 선택지가 `(a)` `(a-1)`로 시작하는 절만 읽습니다. 형식이 다른
절이면 `items`가 빈 배열로 오고, 이때 에이전트는 `question` 전문을 읽고 직접 답을 씁니다.

답은 `ticket_answer`에 `hash`와 함께 줍니다. 답을 주는 인자는 `picks`와 `text` 두 가지이고, 둘 중
하나는 반드시 있어야 합니다. 둘 다 주면 `picks`로 만든 줄 다음에 빈 줄 하나를 두고 `text`를 붙입니다.

- `picks`는 고른 선택지입니다. `[{number, letters, note}]` 꼴이고, `number`는 문항 번호(`items`의
  `number`), `letters`는 고른 글자의 배열, `note`는 그 문항에 덧붙일 말입니다. `note`는 빼도 됩니다.
  화면에서 선택지를 고를 때 만들어지는 줄과 같은 형식으로 바뀝니다. 예를 들어 `{"number": "1", "letters": ["a", "a-1"]}`은
  `1.(a)(a-1)` 한 줄이 됩니다.
- `text`는 직접 쓴 답입니다. 맞는 선택지가 없거나 `items`가 비었을 때 씁니다.

`ticket_answer`는 화면과 같은 순서로 검사하고, 하나라도 걸리면 아무 파일도 만들지 않습니다. 그 티켓이
지금 답변 대기여야 하고, 같은 답이 아직 달리지 않았어야 합니다. `picks`의 번호와 글자는 마지막 질문
절에 실제로 있어야 하고, `a-1` 같은 하위 글자는 부모 글자 `a`도 같이 골랐을 때만 받습니다. 오류
문구에는 어느 검사에 걸렸는지 적혀 있습니다.

검사를 통과하면 `tickets/<awaiting>.done.md`를 만듭니다. 화면의 `답변 쓰기`가 만드는 파일과 글자
하나까지 같습니다. 이 파일이 생기는 순간 잠금이 풀리고, 그 티켓은 다시 큐에 올라 워커가 가져갈 수
있게 됩니다. 도구는 이어서 워커를 한 번 깨웁니다. 응답은 `{path, round, body, dispatch}`이고
`dispatch`에 그 결과가 실립니다. 워커를 깨우지 못해도 답 파일은 남으므로, 그 티켓은 다음 워커
실행 때 가져갑니다.

### 티켓 상태 받아보기

MCP로 티켓을 만든 뒤에도 그 티켓이 어떻게 되는지 같은 대화에서 받아 볼 수 있습니다. 워커가 티켓을
잡았는지, 질문을 남기고 멈췄는지, 끝났는지를 `ticket_read`로 다시 읽어 확인하지 않아도 됩니다. 받는
방법은 MCP 호스트(dira MCP를 붙인 클라이언트)가 무엇을 지원하느냐에 따라 셋으로 나뉩니다. 도구 목록에
`ticket_status`와 `ticket_wait`가 없으면 앱을 올리세요.

#### 내 호스트는 어디에 해당하나

| 호스트가 지원하는 것 | 받는 방법 |
|---|---|
| MCP 규격 `2026-07-28`과 tasks 확장(`io.modelcontextprotocol/tasks`) | [작업 핸들 따라가기](#작업-핸들-따라가기) |
| 리소스 구독. 이전 규격(`2025-06-18` `2025-11-25`)이면 stdio로 붙였을 때만 해당합니다 | [리소스 구독](#리소스-구독) |
| 둘 다 없거나, 이전 규격 호스트를 HTTP로 붙였을 때 | [도구로 폴링](#도구로-폴링) |

어디에 해당하는지는 호스트 문서에서 지원하는 MCP 규격 버전과 "tasks", "resource subscriptions" 항목을
찾아 보면 압니다. 문서로 가리기 어려우면 `ticket_create`를 한 번 불러 응답을 봅니다. 응답이
`"resultType": "task"`와 `task` 객체로 오면 첫째 경우입니다. 평소처럼 결과 JSON이 오고 끝에
`dira://ticket/...` 링크(`resource_link`)가 붙어 있으면 호스트가 tasks 확장을 선언하지 않은 것입니다.
이때는 그 링크를 구독할 수 있느냐가 둘째와 셋째를 가릅니다.

셋째 방법은 어느 호스트에서나 됩니다. 앞의 두 방법이 되는지 확신이 서지 않으면 `ticket_wait`부터 쓰세요.

#### 상태 넷

세 방법 모두 같은 상태 값을 돌려줍니다. 티켓 상태를 MCP 작업 상태(`status`)로 옮긴 것이고,
`statusMessage`에 사람이 읽을 설명이 붙습니다.

| 티켓 | `status` | `statusMessage` | 할 일 |
|---|---|---|---|
| 대기 | `working` | `대기 - 아직 워커가 안 잡았다` | 기다립니다 |
| 진행 중 | `working` | `진행 중 - <맡은 워커>`. 세션이 막혔으면 `막힘 - <블록 첫 줄>` | 기다립니다. `막힘`이면 `ticket_read`로 `## 블록` 절을 읽어 봅니다 |
| 답변 대기 | `input_required` | 마지막 `## 질문 n` 절의 제목 | 답을 답니다(아래) |
| 완료 | `completed` | `완료` | `result`를 읽습니다(아래) |

대기와 진행 중은 `status`가 둘 다 `working`이므로 `statusMessage`의 앞말로 구분합니다. 세션이 일을 다
못 끝내고 이어받기 티켓을 낸 경우에는 원래 티켓이 `.done`이어도 완료로 치지 않습니다. 이어받은 티켓을
끝까지 따라가 마지막 티켓의 상태를 돌려줍니다. dira는 `failed`와 `cancelled`를 쓰지 않습니다. 해시에
맞는 티켓 파일이 없으면 상태 대신 오류(-32602)가 옵니다.

**답변 대기일 때.** 상태에 `inputRequests`가 함께 옵니다. 마지막 질문 절의 문항마다 `q1` `q2` 같은 키가
하나씩 있고, 값에 문항 제목과 선택지 글자가 들어 있습니다. 답은 두 가지 중 편한 쪽으로 답니다.

- tasks 확장을 쓰는 호스트는 `tasks/update`의 `inputResponses`에 같은 키로 답을 넣습니다. 값은
  `{"letters": ["a"], "note": "덧붙일 말"}` 꼴이고 `note`는 빼도 됩니다.
- 그 밖의 호스트는 `ticket_answer`를 부릅니다. 인자는
  [답변 대기를 다른 에이전트에게 맡기기](#답변-대기를-다른-에이전트에게-맡기기)에 있습니다.

두 길 모두 화면의 `답변 쓰기`와 같은 파일을 만듭니다. 답이 달리면 그 티켓은 다시 큐에 오르고 상태도
`working`으로 돌아갑니다.

**완료일 때.** `result`에 그 티켓의 결과가 도구 결과 모양으로 들어 있습니다. `content`의 첫 항목은
티켓 본문의 `## 결과` 절 전문이고, 이어서 후속 티켓마다 `dira://ticket/...` 링크가 하나씩 붙습니다.
후속 티켓은 그 티켓을 `req:`로 가리키는 티켓과 `## 결과`에 `-> <해시>`로 적힌 핸드오프 티켓입니다.
같은 내용이 `structuredContent`에 `{hash, state, result, followups}`로도 실립니다. 후속 티켓의 상태도
알고 싶으면 그 링크를 같은 방법으로 다시 따라가면 됩니다.

#### 작업 핸들 따라가기

호스트가 요청의 `_meta`에 `io.modelcontextprotocol/protocolVersion: "2026-07-28"`을 싣고, 요청의
`clientCapabilities.extensions`에 `io.modelcontextprotocol/tasks`를 선언하면 이 방법을 씁니다.
선언하지 않은 요청에는 작업 핸들을 돌려주지 않습니다. 이 경우 도구 셋이 평소 결과 대신 작업 핸들을
돌려줍니다.

| 도구 | 핸들이 가리키는 티켓 |
|---|---|
| `ticket_create` | 만든 티켓 |
| `ticket_answer` | 답을 단 원래 티켓 |
| `dispatch_now`(워커를 지금 띄웁니다) | `hash`로 지목한 티켓. `hash`를 빼면 핸들 없이 평소 결과가 옵니다 |

핸들은 이렇게 생겼습니다.

```json
{"resultType": "task",
 "task": {"taskId": "dira://ticket/caff757c?root=%2FUsers%2F<나>%2FProjects%2Fapp%2F.dira",
          "ticketHash": "caff757c", "status": "working",
          "statusMessage": "대기 - 아직 워커가 안 잡았다",
          "ttlMs": null, "pollIntervalMs": 5000}}
```

호스트는 `taskId`를 그대로 들고 `tasks/get`을 불러 상태를 다시 읽습니다. `pollIntervalMs`가 5000이므로
5초에 한 번이면 충분합니다. 기다리지 않고 바뀔 때만 받으려면 `subscriptions/listen`의
`notifications.taskIds`에 `taskId`를 넣습니다. 그러면 상태가 바뀔 때마다 `notifications/tasks`로 작업
상태 전체가 옵니다. tasks 확장을 선언하지 않은 요청에서 `taskIds`를 신청하면 오류(-32021)가 납니다.

`taskId`는 티켓 해시와 큐 루트를 담은 URI라서 만료되지 않고(`ttlMs`가 `null`), MCP 서버가 다시 떠도
그대로 통합니다. `tasks/cancel`은 빈 응답만 돌려주고 티켓은 건드리지 않습니다. 티켓은 큐에 그대로
남아 워커가 계속 처리합니다.

#### 리소스 구독

티켓 하나하나와 큐 목록이 MCP 리소스로도 열려 있습니다. 읽으면 JSON(`application/json`)이 옵니다.

| URI | 읽으면 |
|---|---|
| `dira://ticket/<해시>?root=<큐 루트>` | 위의 작업 상태에 `title` `kind` `persona` `owner`를 더한 것 |
| `dira://queue?root=<큐 루트>` | `queue_list`와 같은 열린 티켓 목록 |
| `dira://awaiting` | `awaiting_list`와 같은 답변 대기 목록(등록된 프로젝트 전부) |
| `dira://projects` | `projects`와 같은 프로젝트 목록 |

`resources/list`에는 큐 목록과 답변 대기, 프로젝트 목록만 나옵니다. 티켓 URI는 템플릿
`dira://ticket/{hash}{?root}`로만 나오므로, 티켓을 만든 응답에 붙은 링크를 그대로 쓰는 편이 쉽습니다.
`root`는 큐 루트 절대 경로를 퍼센트 인코딩한 값입니다.

구독하는 방법은 호스트가 말하는 규격에 따라 다릅니다.

- 이전 규격 호스트를 stdio로 붙였다면 `resources/subscribe`에 URI를 줍니다. 그 리소스가 바뀌면
  `notifications/resources/updated`가 그 URI와 함께 오고, 호스트는 `resources/read`로 새 내용을 읽습니다.
  구독을 끊을 때는 `resources/unsubscribe`를 부릅니다.
- `2026-07-28` 호스트는 `subscriptions/listen` 요청 하나로 신청합니다. `resourceSubscriptions`에 URI
  목록을 넣고, 프로젝트가 등록되거나 빠지는 것도 받으려면 `resourcesListChanged`를, 도구 목록이 바뀌는
  것도 받으려면 `toolsListChanged`를 켭니다. 서버는 먼저 `notifications/subscriptions/acknowledged`에
  받아들인 항목을 돌려주고, 그 뒤로 바뀔 때마다 알림을 보냅니다. HTTP로 붙였으면 그 요청의 응답이
  이벤트 스트림(SSE)으로 열린 채 남고, 연결을 닫으면 구독도 끝납니다. stdio로 붙였으면
  `notifications/cancelled`로 그 요청을 취소할 때 끝납니다.

서버는 2초마다 구독된 큐의 티켓 파일을 살펴 바뀜을 찾습니다. 그래서 알림은 실제 바뀜보다 2초 안팎 늦게
옵니다. 이전 규격 호스트를 HTTP로 붙였다면 서버가 먼저 보낼 길이 없어서 구독을 받지 않습니다. 이때는
다음 방법을 씁니다.

#### 도구로 폴링

호스트가 tasks 확장도 리소스 구독도 쓰지 않아도, 도구 두 개로 같은 상태를 받습니다. 둘 다 위의
상태 넷과 같은 JSON을 돌려줍니다.

- `ticket_status`는 지금 상태를 바로 돌려줍니다. `hash`나 `uri` 하나를 주거나, `hashes`에 해시 배열을
  주면 여러 장을 `{tasks: [...]}`로 한 번에 받습니다.
- `ticket_wait`는 `since`에 직전에 받은 `status`를 주면 그 값과 달라질 때까지 기다렸다가 돌려줍니다.
  기다리는 상한은 `timeout_s`이고 기본 50초, 최대 300초입니다. 결과의 `changed`가 `true`면 상태가
  바뀐 것이고, `false`면 시간이 다 되어 돌아온 것입니다. `since`를 빼면 기다리지 않고 바로 돌려줍니다.

에이전트에게는 이렇게 맡기면 됩니다.

> dira MCP로 티켓을 만들고, `ticket_wait`를 직전 `status`로 거듭 불러서 상태가 바뀔 때마다 알려 줘.
> `input_required`가 되면 질문을 보여 주고, `completed`가 되면 `## 결과`를 요약해 줘.

`since`는 `status`만 비교합니다. 대기에서 진행 중으로 넘어가는 것은 둘 다 `working`이라 바뀜으로 치지
않고, 그 사이 `ticket_wait`는 `timeout_s`가 다 될 때까지 기다립니다. 워커가 잡았는지까지 알고 싶으면
`changed`가 `false`로 돌아올 때마다 `statusMessage`를 확인하세요.

### 프로젝트 등록과 설정을 다른 에이전트에게 맡기기

앱의 프로젝트 목록과 설정도 MCP로 바꿀 수 있습니다. 도구는 화면이 쓰는 파일을 같은 형식으로 쓰므로,
에이전트가 바꾼 값은 앱 화면에 그대로 보입니다. 도구 목록에 `project_register`와 `settings_set`이
없으면 앱을 올리세요.

에이전트에게는 이렇게 맡기면 됩니다.

> dira MCP로 `~/Projects/shop/.dira`를 `shop`이라는 이름으로 등록하고 프로젝트 목록 맨 위로 올려 줘.
> 그 큐는 쉬는 동안 작업 트리를 비우게 하고, 이 컴퓨터의 세션 상한은 4로 맞춰 줘.

#### 프로젝트 목록

프로젝트 도구 넷은 `~/.config/dira/gui-projects.json`을 고칩니다. 대상 프로젝트는 `id`로 고르고,
각 프로젝트의 `id`는 `projects`가 알려 줍니다. 응답은 고친 뒤의 프로젝트 목록 전체입니다.

`project_register`는 `path`에 큐 루트(`<프로젝트>/.dira`)를, `name`에 화면에 보일 이름을 받습니다.
`id`를 빼면 이름을 소문자로 바꾸고 영문과 숫자가 아닌 글자를 `-`로 바꿔 40자 안에서 만듭니다. 검사는
화면과 같은 순서로 합니다.

1. 이름이 비어 있지 않은가
2. 경로가 절대경로이고 실제로 있는 디렉터리인가(`~`로 시작하면 홈으로 풉니다)
3. 그 안에 `tickets`나 `workers`가 있는가
4. 같은 큐나 같은 `id`가 이미 등록되어 있지 않은가

하나라도 걸리면 목록을 쓰지 않고, 어느 검사에 걸렸는지 적은 오류로 끝납니다. 3번을 통과하면 큐의 부모
디렉터리 `.gitignore`에 `.dira` 줄이 있는지 보고, 없으면 그 자리에서 더합니다. 화면도 이렇게 하므로
4번에서 걸려도 이 줄은 남습니다. 성공하면 응답에 새 항목이 `project`로 따로 실립니다. 화면에서
등록하면 코어 프로토콜을 큐에 바로 복사하지만, 이 도구로 등록하면 앱을 다음에 켤 때 복사합니다.

나머지 셋은 짧습니다.

- `project_rename`은 `id`와 새 `name`을 받습니다. 이름이 비었거나 없는 `id`면 오류입니다.
- `project_reorder`는 `ids`에 준 순서대로 앞에 놓고, `ids`에 없는 프로젝트는 원래 순서대로 그 뒤에
  붙입니다. 하나만 맨 위로 올리려면 그 `id` 하나만 주면 됩니다. 모르는 `id`는 무시합니다.
- `project_unregister`는 목록에서만 뺍니다. 큐 디렉터리와 티켓은 한 바이트도 건드리지 않으므로,
  같은 큐를 나중에 `project_register`로 다시 등록할 수 있습니다. 없는 `id`면 오류입니다.

#### 이 컴퓨터의 설정

`settings_get`과 `settings_set`은 `~/.config/dira/` 아래 설정 파일을 읽고 씁니다. 큐와 상관없이 이
컴퓨터 전체에 걸리는 설정이라 `root`를 받지 않습니다. `settings_set`이 받는 키는 이렇습니다.

| 키 | 화면 이름 | 값 |
|---|---|---|
| `language` | `언어` | `ko` 또는 `en` |
| `autonomy_level` | `주도성` | 정수 1~5 |
| `autopilot` | `오토파일럿` | `true` 또는 `false`. `true`는 주도성이 5일 때만 받습니다 |
| `multitoken` | `다중계정 허용` | `true` 또는 `false` |
| `multiplay` | `다중계정 동시사용` | `true` 또는 `false` |
| `session_limit` | `머신 전체 세션 상한` | 0 이상의 정수. `null`을 주면 상한을 없앱니다 |

`settings_set`은 준 키만 바꿉니다. 값을 모두 먼저 검사하고, 하나라도 틀리면 파일을 하나도 쓰지
않습니다. 주도성만 바꾸면 오토파일럿 값은 그대로 두고, 오토파일럿만 바꾸면 주도성 값을 그대로 둡니다.
화면의 두 컨트롤과 같은 동작입니다. 그래서 오토파일럿을 켠 채 주도성을 4로 내리면 오토파일럿은 꺼진
것으로 읽히고, 다시 5로 올리면 켜진 상태로 돌아옵니다. 주도성이 4 이하일 때 주도성 5와 오토파일럿을 한 번에
켜려면 `autonomy_level`과 `autopilot`을 같은 호출에 함께 줍니다.

응답은 바꾼 뒤의 `settings_get` 결과입니다. `settings_get`은 주도성과 오토파일럿을
`autonomy: {level, autopilot}`으로, 세션 상한을 `session_limit: {limit, warn}`으로 묶어 돌려줍니다.
`multitoken`이 `null`이면 아직 아무도 정하지 않아 앱 빌드의 기본값을 따르는 상태입니다. 상한 파일을
읽지 못하면 `warn`이 붙습니다.

#### 큐 하나의 설정

`project_settings_get`과 `project_slim`은 다른 도구처럼 `root`로 큐를 고릅니다.

`project_settings_get`은 `integration_branch`(통합 브랜치), `slim`(작업 트리 비우기 상태),
`workers`(워커 이름 목록)를 돌려줍니다. 큐의 `integration-branch` 파일이 없거나 그 첫 줄을 브랜치
이름으로 읽을 수 없으면 `integration_branch`는 `null`입니다. 화면은 이때 git에서 브랜치를 찾아 파일을
채우지만, 이 도구는 읽기만 하고 아무것도 쓰지 않습니다.

`project_slim`은 `on`에 `true`나 `false`를 받아
[쉬는 동안 작업 트리 비우기](/docs/screens#쉬는-동안-작업-트리-비우기)를 켜거나 끕니다. 켤 때 비우기가
거절되어도 켜짐은 저장되고, 거절 사유는 응답의 `message`에 실립니다. 화면 스위치와 같습니다. 응답의
나머지는 바꾼 뒤의 작업 트리 비우기 상태입니다.

새 프로젝트 만들기, 워커 만들기와 지우기, 통합 브랜치 바꾸기는 이 절의 도구가 아니라 실행기 도구가
합니다. 다음 절을 보세요.

### 화면 없이 프로젝트를 만들고 설정하기

dira 화면을 켜지 않고도 다른 에이전트가 MCP만으로 새 프로젝트를 만들고 워커까지 세울 수 있습니다. 이
일을 하는 도구를 실행기 도구라고 부릅니다. 실행기 도구는 화면의 버튼이 부르는 함수를 그대로 부르므로,
같은 입력이면 화면에서 만든 프로젝트와 같은 파일이 생깁니다.

에이전트에게는 이렇게 맡기면 됩니다.

> dira MCP로 `~/Projects/shop`에 프로젝트를 만들어 줘. 이름은 `shop`, 통합 브랜치는 `dev`야. 온톨로지
> 위치는 `~/Drive/shop-ontology`로 하고, 모든 워커가 `docs/DESIGN.md`를 참조 자료로 읽게 해 줘.
> 워커는 하나 더 만들어서 두 개로 맞춰 줘.

#### 먼저 앱을 한 번 켭니다

실행기 도구는 앱을 한 번 켠 뒤에 붙습니다. 앱이 뜰 때 실행기의 위치를 `~/.config/dira/ops.json`에
적어 두고, MCP 서버는 이 파일을 보고 실행기를 부릅니다. 파일이 한 번 생기면 그 뒤로는 앱을 닫아도
실행기 도구가 동작합니다. 화면 서버를 거치지 않고 실행기가 혼자 돌기 때문입니다.

붙어 있는지는 `ops_status`로 확인합니다. 인자는 없습니다.

| 키 | 뜻 |
|---|---|
| `available` | `true`면 실행기 도구를 쓸 수 있습니다 |
| `argv` | MCP 서버가 실행기를 띄우는 명령입니다 |
| `error` | `available`이 `false`인 사유입니다. 파일이 없으면 앱을 한 번 켜면 생긴다는 문장이 옵니다 |

`available`이 `false`면 dira 앱을 한 번 켰다가 닫으세요. 그래도 도구 목록에 `project_create`가 보이지
않으면 클라이언트에서 dira MCP 서버를 다시 연결합니다. MCP 서버는 클라이언트가 도구 목록을 받을 때
실행기에 목록을 물어 붙이므로, 이미 받아 둔 목록에는 새 도구가 없습니다. `available`이 `false`여도
`queue_list`나 `ticket_create` 같은 위 표의 도구는 그대로 동작합니다.

실행기 도구가 실패하면 실행기가 돌려준 오류 문장이 도구 오류로 그대로 옵니다. 호출 하나의 시간
상한은 300초입니다. `project_create`는 스킬을 내려받으므로 네트워크 상태에 따라 오래 걸릴 수 있습니다.

#### 프로젝트를 세우는 순서

순서는 `project_create` -> `project_ontology_set` -> `project_context_set` -> `worker_create`입니다.
`project_create` 다음부터는 프로젝트를 `id`(레지스트리 id)나 `root`(큐 루트) 중 하나로 고릅니다.

**1. `project_create`로 만듭니다.** 화면의 새 프로젝트 폼과 같은 일을 합니다. `.dira`를 만들고, 워커
`w1`을 crontab에 올리고, 앱의 프로젝트 목록에 등록하고, 기본 스킬을 깝니다.

| 인자 | 화면 칸 | 넣는 것 |
|---|---|---|
| `path` | `프로젝트 폴더` | `.dira`의 부모 폴더입니다. 없으면 만듭니다 |
| `name` | `이름` | 화면에 보일 이름입니다 |
| `branch` | `통합 브랜치` | 세션이 결과를 올릴 브랜치입니다. 비우면 오류입니다 |
| `ontology` | `온톨로지 위치` | 선택입니다. 온톨로지 폴더 경로입니다 |
| `specDoc` | `스펙 문서` | 선택입니다. `docs/DESIGN.md` 같은 스펙 파일 경로입니다 |
| `id` | `URL 조각` | 선택입니다. 빼면 이름으로 만듭니다 |

결과에는 `error` `exists` `created` 중 하나가 실립니다.

- `error`는 입력이 틀렸다는 뜻이고 아무것도 만들지 않았습니다.
- `exists`는 그 폴더에 `.dira`가 이미 있다는 뜻이고, 이때도 아무것도 만들지 않았습니다. `queue`가
  `true`면 이미 쓸 수 있는 큐이므로 `project_register`로 등록하세요.
- `created`에는 만든 큐 루트 `root`가 실립니다. 다음 호출부터 이 값을 `root`로 씁니다. `cron`이
  `false`면 파일은 다 만들었고 crontab 등록만 실패한 것입니다. 사유는 `cronError`에 있고, 손으로
  등록하는 명령은 `registerCmd`에 있습니다. `ontologyError`가 있으면 온톨로지 위치만 정해지지 않은
  것이니 다음 단계에서 다시 정합니다.

**2. `project_ontology_set`으로 온톨로지 위치를 정합니다.** 인자는 `path` 하나이고 빈 문자열을 주면
위치를 지웁니다. 화면에서 온톨로지 위치를 저장할 때와 같은 검사를 거칩니다. 1단계에서 `ontology`를 주었고
`ontologyError`가 없었다면 이미 정해져 있으니, `project_ontology_get`으로 `value`만 확인하고 넘어가도
됩니다.

**3. `project_context_set`으로 참조 자료를 정합니다.** 참조 자료는 세션 프롬프트 끝에 붙는 파일
목록입니다. `items`에 `[{path, desc}]`를 줍니다. `worker`를 빼면 모든 워커가 함께 읽는 공통 목록
(`context.sh`)을 쓰고, `worker`에 `w1` 같은 이름을 주면 그 워커 파일의 `TICKET_CONTEXT`를 씁니다.
준 `items`가 그 목록 전체를 대신하므로, 있던 항목을 남기려면 `project_context_get`으로 읽어서 함께
줍니다. 한 워커의 목록을 다른 워커로 옮겨 적을 때는 `project_context_copy`에 `from`과 `to`를 줍니다.

**4. `worker_create`로 워커를 늘립니다.** `name`에 `w2` 같은 이름을 줍니다. `engine` `model`
`effort`는 선택이고, 빼면 화면처럼 `claude`와 `모델 지정 안 함`입니다. 워커 파일을 쓰고 crontab에
올리고 워크트리를 만듭니다. `project_settings_get`의 `workers`에 새 이름이 보이면 끝난 것입니다.

만든 뒤에 바꾸는 도구도 있습니다.

- `project_settings_set`은 `integration_branch`와 `slim` 중 준 키만 바꿉니다. 통합 브랜치를 바꾸면
  그 이름이 쓰인 큐 안의 자리들을 화면처럼 함께 고칩니다.
- `worker_stop`과 `cron_unregister`는 워커의 crontab 줄만 빼고, `cron_register`는 그 줄을 다시
  넣습니다. 워커 파일과 워크트리는 그대로 남습니다.
- `worker_delete`는 워커를 지웁니다. 세션이 도는 중인 워커는 지우지 않고 오류로 끝납니다.

#### 실행기 도구 목록

이름은 화면의 무리별로 묶었습니다. `*`로 끝나는 이름은 그 접두사로 시작하는 도구 여럿을 뜻하며,
정확한 이름과 인자는 `tools/list`에 나옵니다.

| 무리 | 도구 |
|---|---|
| 프로젝트 만들기 | `project_create` |
| 프로젝트 설정 | `project_settings_set` |
| 온톨로지 위치와 참조 자료 | `project_ontology_get` `project_ontology_set` `project_context_get` `project_context_set` `project_context_copy` |
| 워커 | `worker_list` `worker_create` `worker_delete` `worker_stop` `worker_retry_worktree` `cron_register` `cron_unregister` |
| 워커 고치기 버튼 | `project_repair` - 고칠 것을 `kind`로 고릅니다 |
| 페르소나 | `persona_*` |
| 스쿼드 | `squad_*` |
| 휴지통 | `trash_*` |
| 스킬 | `skill_list` `skill_install` - 주소로 까는 것만 됩니다 |
| 마켓 | `market_*` |
| 프로토콜 | `protocol_*` |
| 에픽 | `epic_*` |
| 커맨드와 일정 | `command_*` `schedule_*` |
| 티켓 편집 | `ticket_save` `ticket_frontmatter_set` `ticket_epic_set` `ticket_delete` `ticket_followup` `polling_dispatch_now` `polling_extend` `backoff_retry_now` |
| 온톨로지 쓰기 | `ontology_save` `ontology_create` `ontology_delete` `ontology_rename` `ontology_fix_schema` `ontology_publish_migration` `ontology_publish_import` `ontology_survey_submit` `ontology_metrics` |
| 비상 정지 | `emergency_stop_get` - 읽기만 합니다 |

#### MCP로 안 되는 것

아래는 화면에서만 합니다.

- 비상 정지를 켜고 끄기. 사람이 세션을 멈추려고 거는 안전장치라서 에이전트가 풀 수 없게 두었습니다.
  지금 켜져 있는지는 `emergency_stop_get`으로 읽습니다.
- 자격 증명. 토큰과 계정, 엔진 프로필, 로그인 설정, Vercel, 웹훅이 여기에 듭니다. 비밀값이라
  MCP 응답에 오가지 않게 했습니다.
- 사용 통계 동의. 사람이 직접 동의하는 설정이라 에이전트가 켜고 끄는 길을 두지 않았습니다.
- 화면 상호작용. 홈 대화, 터미널, 소스 컨트롤, 탐색기, 브라우저 탭, 이기적 모드, 키설정이 여기에
  듭니다. 이 기능들은 화면의 상태를 다루므로 MCP로 열어도 에이전트가 할 수 있는 일이 늘지
  않습니다. 에이전트는 셸과 git과 파일을 직접 쓰면 됩니다.
- 파일 올리기. 스킬을 파일로 올려 까는 것과 티켓 첨부는 받지 않습니다. 스킬은 `skill_install`에
  주소를 줍니다.

### 어느 큐인지 정하기

모든 도구는 `root` 인자로 큐 루트(`<프로젝트>/.dira`)를 받습니다. 빠뜨리면 환경변수
`TICKET_ROOT`를 쓰고 그것도 없으면 `root가 필요합니다`로 끝납니다. `awaiting_list` 하나만 예외로, `root`를 빼면 등록된 프로젝트 전부를 훑습니다. 프로젝트 도구 넷과
`settings_get` `settings_set`은 큐를 고르지 않으므로 `root`를 받지 않습니다. 실행기 도구는 `root` 대신
레지스트리 `id`를 받기도 하고, 앱에 등록되지 않은 큐는 다루지 않습니다. 큐 루트를 모르면 `projects`부터
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

### HTTP - cron이 띄워 둔 서버

```json
{"type":"http","url":<url>,"headers":{"Authorization":"Bearer <token>"}}
```

`<url>`과 `<token>`은 설정 화면에서 복사한 값에 이미 채워져 있습니다. 서버는 `127.0.0.1`에만
열리므로 다른 기기에서는 붙을 수 없습니다. 토큰이 없거나 틀린 요청은 `401`로 거절하고, 다른 사이트의 브라우저
요청은 `403`으로 막습니다.

**한 번 붙여 두면 계속 씁니다.** 토큰은 처음 한 번 만들어 `~/.config/dira/mcp/token`에 두고,
서버를 다시 띄울 때도 그 값을 씁니다. 포트는 `47823`을 먼저 씁니다. 다른 프로그램이 그 포트를
쓰고 있으면 빈 포트로 뜨는데, 이때는 주소가 바뀌므로 설정 화면에서 HTTP 설정을 다시 복사해
넣으세요. 지금 값은 `~/.config/dira/run/mcp.json`의 `url`과 `token`에도 있습니다.

v1.2.20 이하의 앱은 HTTP 서버를 앱 안에서 띄웠고, 토큰도 앱을 켤 때마다 새로 만들었습니다. 그
버전을 쓰고 있다면 앱을 올린 뒤 HTTP 설정을 한 번 다시 복사하세요.

### 앱 없이 붙이기

`git clone`으로 엔진만 받았다면 엔진 레포의 `mcp_server.py`를 `python3`로 직접 지정합니다.
경로는 엔진을 받은 자리로 바꾸세요.

```json
{"command":"python3","args":["/Users/<나>/Projects/dira/mcp_server.py"]}
```

## 앱을 꺼도 HTTP 서버는 떠 있습니다

HTTP 서버는 워커처럼 cron이 지킵니다. dira 앱을 한 번 켜면 앱이 두 가지를 해 둡니다.

- 감시 스크립트를 `~/.config/dira/mcp/keepalive.sh`에 둡니다.
- crontab에 그 스크립트를 매분 부르는 줄을 하나 넣습니다. 줄이 이미 있으면 그대로 두고, 다른
  줄은 건드리지 않습니다.

```
* * * * * "<홈>/.config/dira/mcp/keepalive.sh" "<엔진>/tick.sh" >> "<홈>/.config/dira/run/mcp.log" 2>&1
```

`<엔진>`은 워커의 cron 줄이 부르는 `tick.sh`와 같은 자리입니다. 앱은 줄을 넣은 직후 스크립트를
한 번 직접 돌리므로, 다음 분을 기다리지 않고 서버가 뜹니다.

그 뒤로는 앱을 닫아도 cron이 매분 스크립트를 부릅니다. 스크립트는 `mcp.json`의 `pid`가 살아 있는
`mcp_server.py`면 아무것도 하지 않고 끝납니다. 서버가 죽어 있으면 같은 토큰으로 다시 띄우고
`mcp.json`을 새 `pid`로 다시 씁니다. 서버가 죽더라도 1분 안에 같은 주소와 같은 토큰으로 돌아오므로
클라이언트 설정은 고칠 필요가 없습니다.

설정 화면 `MCP` 절의 상태 줄은 `mcp.json`을 읽어 지금 상태를 보여 줍니다. 앱 창과 브라우저에서
연 화면이 같은 값을 봅니다. `켜짐 - <url>`이면 HTTP로 붙을 수 있습니다. `꺼짐`이면 떠 있는 서버가
없다는 뜻이고, 그 아래에 `dira 앱을 한 번 켜면 cron이 띄웁니다`가 나옵니다.

### 서버가 안 뜰 때

`꺼짐`이 1분 넘게 이어지면 두 곳을 봅니다.

```bash
crontab -l | grep 'mcp/keepalive.sh'
tail -n 20 ~/.config/dira/run/mcp.log
```

- `crontab -l`에 줄이 없으면 앱이 crontab에 쓰지 못한 것입니다. 앱이 crontab을 고칠 때 macOS가
  `앱 관리` 권한을 묻는데, 이 창을 거부하면 이렇게 됩니다. `설정 › 개인정보 보호 및 보안 › 앱 관리`에서
  dira를 승인하고 앱을 다시 켜세요.
- 줄은 있는데 서버가 없으면 `mcp.log`를 아래에서부터 읽습니다. cron이 부를 때마다 스크립트와
  서버가 남긴 출력이 이 파일에 쌓입니다.

### dira를 지우면 같이 사라집니다

감시 스크립트는 매분 인자로 받은 `<엔진>/tick.sh`가 있는지부터 봅니다. 이 파일이 없으면 dira가
지워졌다고 보고 다음을 정리합니다.

- 떠 있는 `mcp_server.py`를 내립니다.
- `~/.config/dira/run/mcp.json`을 지웁니다.
- crontab에서 `mcp/keepalive.sh` 줄만 뺍니다. 다른 줄은 바이트 하나 바꾸지 않습니다.
- `~/.config/dira/mcp/`를 토큰과 함께 지웁니다.

워커가 cron 줄을 거두는 기준도 같은 `tick.sh`라서, 워커가 멈추는 때에 MCP 서버도 같이 내려갑니다.
dira를 다시 설치하고 앱을 켜면 줄과 스크립트가 다시 들어갑니다. 토큰은 새로 만들어지므로 HTTP
설정을 다시 복사해 클라이언트에 넣으세요.

stdio는 cron과 상관없이 클라이언트가 필요할 때만 띄웁니다. 포트를 열어 두고 싶지 않다면 stdio로
붙이세요. 단 `env_*` 도구는 [CLI](/docs/ref-cli)의 `dira env`처럼 앱이 떠 있어야 값을 읽고 씁니다.

다음은 [원격 큐](/docs/remote)입니다.
