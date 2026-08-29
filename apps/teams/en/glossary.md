# Glossary

This file decides the English word for every product term the manual uses. Every English
chapter under `en/` follows it. The Korean manual is the source; this table is the only
place where its vocabulary is fixed for English.

**A word the screen already says wins.** For anything the app puts on screen, the English
dictionary in `lib/i18n.ts` is the fact, and the rows here copy it. The manual tells a reader
which button to press, so a label this table invents on its own sends them looking for a button
that is not there. For manual prose with no screen behind it, this table decides.

If you need a word that is not here, pick one and add the row in the same session. A term
that appears in two chapters with two different English words is a bug, and it costs a
second translation to undo.

## What stays exactly as it is

Never translate, never re-spell:

- File and directory names, paths, URLs, and everything inside a code block.
- Commands and their subcommands: `tick.sh`, `tickets.py`, `reap`, `unassign`, `claim`.
- frontmatter keys and their values: `kind:`, `persona:`, `deps:`, `req:`, `epic:`,
  `awaiting:`, `attempts:`, `owner:`.
- Filename suffixes: `.wip`, `.done`, `.md`.
- Log tags: `REAP`, `ASK`, `SUSPECT`, `WARN`.
- Whole log lines the engine prints. They are Korean in the file whatever language the site is
  in, so quote them as they are and put the English meaning in the sentence around them.
- Section headings the engine or the screen reads. `## Goal` and `## Done when` are
  already English. `## 블록`, `## 질문 n`, `## 결과`, `## 진행 계획` are Korean tokens, and
  they stay Korean because the parser matches those letters. Gloss them once on first
  mention in a chapter, like `## 블록` (the block section), and use the token alone after
  that.

## Core terms

| Korean | English | Notes |
|---|---|---|
| 티켓 | ticket | Never issue, card, or task. |
| 큐 | queue | The directory. `큐 루트` is the queue root. |
| 워커 | worker | The shell script. Plural workers. |
| 세션 | session | The agent process a worker starts. |
| 페르소나 | persona | Plural personas. |
| 스쿼드 | squad | |
| 에픽 | epic | |
| 온톨로지 | ontology | Takes `the`: the ontology, the ontology graph. |
| 프로토콜 | protocol | `협업 프로토콜` is the collaboration protocol. |
| 디스패치 | dispatch | Verb and noun both. A ticket is dispatched to a session. |
| 회수 | reclaim | The engine command stays `reap` and the log line stays `REAP`. Prose says reclaim: the engine reclaims a ticket whose session died. |
| 상신 | escalate, escalation | What `reap` does on the third attempt: it escalates the ticket into a question for the human. |
| 발행 | issue | Issue a ticket. The noun is a ticket, never an issue. |
| 요구 | request | `kind: request`. `요구 접수` is submitting a request. |
| 해시 | hash | The eight characters that name a ticket. |
| 보드 | board | |
| 레인 | lane | |
| 백로그 | backlog | |
| 엔진 | engine | Both the two-file engine under the app and the CLI an LLM runs behind. Say LLM engine when the second one could be meant. |
| 스테일 | stale | A ticket whose session is gone. |
| 락, 잠금 | lock | The rename is the lock. |
| 참견 | interject | Noun and verb both. Sending a line into a session that is already running. The screen says `Interject`, so the manual does not call it a barge-in. |
| 되묻기 | asking back | What pm does instead of guessing. |
| 이어받기 | handoff, follow-up | Two different things. A session passing the rest of a ticket on is a handoff, and `이어받기 티켓` is a handoff ticket. The screen feature, where a person writes a line on a done ticket to open a new one, is `Follow-up`. |
| 통합 브랜치 | integration branch | |
| 스펙 문서 | spec document | |
| 슬러그 | slug | |
| 수행자 | assignee | The persona or squad a ticket is issued to. |
| 진행 기록 | Progress record | The per-session record a ticket page shows. The screen label is `Progress record`, and prose uses the same words. |
| 폴링 대기 | Polling | The section a scheduled ticket carries, and the badge on its card. |
| 선점 | preempt, preemption | What priority 5 does to a running session. The section the engine writes into the body stays `## 선점`. |
| 선행, 후행 | prerequisite, the ticket waiting on it | `deps` is a frontmatter key, not a word for prose. |
| 우선순위 | priority | The field label is `Priority`. |
| 마감 | due date | The field label is `Due date`. |
| 첨부 | attachment | The button and the chip group read `Attachments`. |
| 트랜스크립트 | transcript | The file the engine leaves. Never a log. |
| 프로젝트 워커 | project worker | The worker that belongs to one project. |
| 공통 워커 | shared worker | The machine-wide slot several projects take turns using. In prose it is a shared worker; the screen label for the pool is `Common worker pool`. |
| 워커 락 | worker lock | What keeps one worker from starting a second session. |
| 후보 | candidate | A ticket a worker may take this round. |
| 상한 | cap | The ceiling in prose. The screen label is `Limit`. |
| 워크트리 | worktree | git's own word. `git 워크트리` is a git worktree. |
| 코어 | the core | `코어 프로토콜` is the core protocol. |
| 예산 | budget | The byte budget on a file that is inlined into every prompt. |
| 알림 종 | notification bell | |
| 위지윅 | rich text | The editor mode. The toggle reads `Switch to rich text`. |
| 표식 | marker | A hash or epic number in the writing that you can press. Manual-only word; nothing on screen is called this. |
| 사건 | event | One line in the progress record. |
| 단계 | stage | One line of the plan a session writes, and the accordion panel it becomes. |
| 도구 | tool | What a session uses to read a file or run a command. |
| 워커 마크 | worker mark | The `w6` at the end of the meta line on an in-progress card. |
| 인라인 상자 | inline box | The progress record as it sits in the ticket page column, as opposed to the dialog. |
| 다이얼로그 | dialog | Never modal or popup. |
| 팝오버 | popover | What the bell opens. Not a dialog. |
| 칩 | chip | The tool-name-and-count pills under the stream dialog's head. |
| 창 (5시간 - 7일) | window | The stretch a usage percentage covers. |
| 복귀 알림 | return notification | The bell item for stretches the queue sat stopped. |
| 프로필 | profile | The `PROFILE.md` body. A persona has one profile. |
| 스킬 | skill | |
| 메모리 | memory | Uncountable in prose. One file is a memory file, and the count on screen is `Memory n`. |
| 회고 | retrospective | What a session leaves in memory at the end of a ticket. |
| 디스패치 정책 | dispatch policy | |
| 리더 | leader | The first line of a squad's `members`. |
| 멤버 | member | Plural members. |
| 역할 | role | The one line describing what a member does in a squad. |
| 규칙 | rules | Say the `rules` file, never the rules, so it does not read as the protocol. |
| 되돌아옴 | reassigned | The same word as `다시 할당` below. A ticket dispatched again after a session was cut off. |
| 스케줄 | schedule | The row on the home screen. The group label is `Schedules`. |
| 회차 | run | One firing of a schedule: one question and one answer. Never an iteration or a cycle. |
| 홈 에이전트 | home agent | The session that answers on the home screen, and the one a schedule wakes. |
| 웹훅 | webhook | The settings node is `Webhook`. |
| 통합 게이트 | dispatch gate | The screen calls it that (`Apply dispatch gate`), so prose does too, even though the branch it guards is the integration branch. |
| 받는 트리 | receiving tree | The original the workers' worktrees branched off - the project folder itself. |
| 사용 통계 | usage analytics | The chapter word. The settings node reads `Usage stats`. |
| 폴링 스크립트 | polling script | The file under `polls/` a scheduled ticket runs to judge its condition. |
| 카드 | card | One file in the ontology. Never a node or an entry. A kanban card is also a card, so say ontology card where both could be meant. |
| 지도 | map | `_ontology/SCHEMA.md`. Never a schema in prose - `Schema violations` is a screen label and stays as it is. |
| 종류 | kind | What a card is. The screen calls the definition an `object type`, and prose says kind because that is what the manual asks the reader to pick. |
| 관계 | relation | The line between two cards. Never an edge. `숨은 간선` is the one exception: the metric is `Hidden edges` and `간선` is edge there. |
| 아카이빙 | archiving | The loop a done ticket sets off. The three card lines share `Archiving` as their head. |
| 아카이브 티켓 | archive ticket | The one ticket that loop issues. Its target is `archives:` in frontmatter. |
| 정리 티켓 | cleanup ticket | What `Fix violations` issues. The link on the screen reads `Cleanup ticket`. |
| 마이그레이션 | migration | Re-applying the latest conventions to an ontology. Never an upgrade. |
| 가져오기 | import | Pulling a folder from outside into cards. The button reads `Import`. |
| 빈손 | empty-handed | A round that left nothing behind. The metric is `Empty-handed rate`. |
| 스윔레인 | swimlane | `?lane=epic`. One horizontal band per epic. |
| 띠 | band | One swimlane row. It holds cards, so it appears only once a card is in it. |
| 에픽 메모리 | epic memory | The `memory/` folder under one epic. Personas have their own memory, so name the owner. |

## States and badges

The board has three lanes, and the badges below cover what a card can be while it sits in one.
Capitalize them as labels, lowercase them in running prose.

| Korean | English | Notes |
|---|---|---|
| 대기 | Open | The lane, and the filter option. The file is `<hash>.md`, open and waiting for the next tick. Token status has its own word (`Pending`), which is a different thing. |
| 진행중 | In progress | The lane. The file is `<hash>.wip.md`. |
| 완료 | Done | The lane. The file is `<hash>.done.md`. |
| 답변 대기 | Awaiting answer | The badge, and the frontmatter key stays `awaiting`. |
| deps 대기 | Blocked | The badge and the filter option. The tag on the card itself still reads `deps`, and the unmet hashes sit next to it in orange. |
| 대기중 | Polling | The badge a scheduled ticket carries, with the time left. |
| 상한 지남 | Deadline passed | What that badge turns into once the polling deadline is past. |
| 할당됨 | Assigned | The badge on an open file that has a `session_id` written in it. |
| 완료(이어짐) | Done (continued) | The done badge on a ticket carrying `continued:`. |
| 다시 할당 | Reassigned | The count on the ticket page. |

## Chapter titles

The first `# ` heading of each English chapter is the title below, and the sidebar and the
table of contents use the same words. `meta.ts` reads the heading for `<title>` and
`og:title`, so a chapter whose heading does not match this table ships a wrong page title.

| File | Korean | English |
|---|---|---|
| `index.md` | 매뉴얼 | Manual |
| `what-is-dira.md` | dira에 대하여 | About dira |
| `install.md` | 설치 | Install |
| `first-ticket.md` | 첫 프로젝트 만들기 | Create your first project |
| `requirements.md` | 요구사항 접수하기 | Submitting a request |
| `screens.md` | 화면 소개 | The screens |
| `barge-in.md` | 도는 세션에 말 걸기 | Talking to a running session |
| `ticket-writing.md` | 티켓 직접 발행하기 | Writing a ticket yourself |
| `states.md` | 티켓이 지나는 상태 | The states a ticket passes through |
| `worker.md` | 워커 | Workers |
| `concurrency.md` | 동시에 몇 개 돌릴까 | How many to run at once |
| `personas.md` | 페르소나 | Personas |
| `squads.md` | 스쿼드 | Squads |
| `protocols.md` | 프로토콜 | Protocols |
| `ontology.md` | 아카이빙과 온톨로지 | Archiving and the ontology |
| `epics.md` | 에픽 | Epics |
| `auth.md` | 인증 | Authentication |
| `troubleshooting.md` | 트러블슈팅 | Troubleshooting |
| `logs.md` | 로그 읽는 법 | Reading the logs |
| `analytics.md` | 사용 통계와 끄는 법 | Usage analytics, and how to turn them off |
| `schedules.md` | 스케줄 | Schedules |
| `webhook.md` | 답변 대기를 밖으로 보내기 | Sending Awaiting answer somewhere else |
| `closing.md` | 마치면서 | Closing |
| `cron.md` | 엔진만으로 돌리기 | Running the engine alone |
| `ref-env.md` | 워커 환경변수 | Worker environment variables |
| `ref-cli.md` | CLI | CLI |
| `ref-frontmatter.md` | frontmatter 필드 | frontmatter fields |

Section groups, in the table of contents and in the sidebar:

| Korean | English |
|---|---|
| 목차 | Contents |
| 시작하기 | Getting started |
| 지켜보기 | Watching |
| 직접 쓰기 | Writing your own |
| 늘리기 | Scaling up |
| 운영 | Operating |
| 부록 | Appendix |

## Section titles quoted across chapters

One chapter naming a section of another has to use the same words that chapter's own English
heading uses. Every row below is copied from the heading in that chapter's English file. When a
chapter you need to quote has no English file yet, decide the wording, add the row, and the
session that writes that chapter follows it.

| Chapter | Korean | English |
|---|---|---|
| `install.md` | 앱 없이 엔진만 쓰기 | Running the engine without the app |
| `auth.md` | 앱 없이 - 엔진만 쓸 때 | Without the app - using the engine alone |
| `personas.md` | 디스패치 정책 - 상한과 엔진 | Dispatch policy - the cap and the engine |
| `troubleshooting.md` | 티켓이 보드에 안 보인다 | A ticket is not on the board |
| `troubleshooting.md` | 대기인데 아무도 안 집는다 | It is Open and nobody claims it |

## Screen labels the manual quotes

The manual tells the reader which button to press, so a label quoted here has to be the
label the screen actually shows. These rows are copied from the English dictionary in
`lib/i18n.ts`. When the two disagree, the dictionary is right and this table gets fixed.

| Korean | English | Notes |
|---|---|---|
| 요구 접수 | New request |
| 티켓 발행 | New ticket |
| 프로젝트 만들기 | Create project |
| 새 프로젝트 | New project |
| 새로 만들기 | New |
| 프로젝트 등록 | Register a project |
| 보드 열기 | Open the board |
| 닫기 | Close |
| 설정 | Settings |
| 매뉴얼 | Manual |
| 인증 | Authentication |
| 이름 | Name |
| 프로젝트 폴더 | Project folder |
| 통합 브랜치 | Integration branch |
| 스펙 문서 | Spec document |
| 접수한 요구 보기 | See the request you submitted |
| 복제 | Duplicate |
| 할당 해제 | Unassign |
| 답변 쓰기 | Write an answer |
| 버리고 닫기 | Discard and close |
| 진행 기록 | Progress record |
| 폴링 대기 | Polling |
| 우선순위 | Priority |
| 마감 | Due date |
| 없음 | None |
| 스쿼드 default | Squad default |
| 워커 | Workers |
| 프로토콜 | Protocols |
| 워커 설정 | Worker settings |
| 워커 생성 | New worker | The button on the workers screen. The one in `Settings` › `Workers` is `Create worker`. |
| 공통 컨텍스트 | Common context |
| 공통 워커 빌리기 | Borrow shared workers |
| 나머지 워커 설정 (표시만) | The rest of the worker settings (read-only) |
| 스테일 수거 | Stale collection |
| 공통 워커 풀 | Common worker pool |
| 전체 워커 | All workers |
| 설정 분류 | Setting categories |
| 공통 | Shared |
| crontab 미등록 | not in the crontab | Lowercase - it is a tail next to the badge. |
| `<n>곳` | `<n> projects` |
| 필터 초기화 | Clear filters |
| 상한 | Limit |
| 동시 빌리기 상한 | Concurrent borrow limit |
| 저장 | Save |
| 되돌리기 | Revert |
| 스트림 | Stream |
| 중단 | Stop |
| 재등록 | Re-register | The row button. The one in `Settings` › `Workers` is `Register`. |
| 삭제 | Delete |
| 이름변경 | Rename |
| 새 파일 | New file |
| 엔진 | Engine |
| 지정 없음 | Not set |
| 직접 입력 | Type one in… |
| 준비물 | What you need |
| 계정 | Accounts |
| 추가 | Add |
| 변경 | Change |
| 브라우저로 인증하기 | Start sign-in |
| 브라우저에서 받은 코드 | Code from the browser |
| 코드 보내기 | Send code |
| 토큰 | Token |
| 라벨(선택) | Label (optional) |
| 계정 1 | Account 1 |
| 멀티플레잉 | Multiplaying |
| 다중계정 | multi-account |
| 다중계정 허용 | Allow multi-account |
| 다중계정 동시사용 | Simultaneous multi-account use |
| 허용되어 있습니다 | Allowed |
| 허용되지 않았습니다 | Not allowed |
| 켜기 | Turn on |
| 끄기 | Turn off |
| 활성화 | Enable |
| 비활성화 | Disable |
| 사용 | Use |
| 활성 | Active |
| 비활성 | Disabled |
| 소진 | Exhausted |
| 토큰 저장 | Save a token |
| 인증 필요 | Needs auth |
| 파일 목록 접기 | Collapse the file list |
| 파일 목록 펴기 | Expand the file list |
| 기본값 가정 | assumed default | Lowercase - it is a tail next to the path. |
| 원문으로 | Switch to source |
| 위지윅으로 | Switch to rich text |
| 전원 프롬프트에 인라인 | Inlined in every prompt |
| 세션이 필요할 때 읽음 | Read when a session needs it |
| 초과 | over |
| 상태 | Status |
| 물고 있는 티켓 | Holding |
| 컨텍스트 | Context |
| 마지막 활동 | Last activity |
| 토큰(5시간) | Tokens (5h) |
| 액션 | Actions |
| 프로젝트 | Project |
| 종류 | Kind |
| 모아보기 | Group view |
| 자세히 보기 | Expand |
| 보관 | Archive |
| 보관함 | Archived |
| 미착수 | Not started |
| 취소 (계획 단계) | Cancelled |
| 배정 | Assignment |
| 마무리 | Wrap-up |
| 모름 | Unknown |
| 프로젝트 관리 | Manage projects |
| 참견 | Interject |
| 이어받기 (완료 티켓의 칸) | Follow-up |
| 대화 (홈 좌측 그룹) | Conversations |
| 스케줄 | Schedules |
| 워커 세션 | Worker sessions |
| 더보기 | Show more |
| 중지 | Stop |
| 입력 | Input |
| 결과 | Result |
| 오류 | Error |
| 마크다운 | Markdown |
| 복사 | Copy |
| 생각 | Thinking |
| 대화 (스트림 필터) | Messages |
| 도구 (스트림 필터) | Tools |
| 프롬프트 (스트림 필터) | Prompts |
| 이 기록 검색 | Search this record |
| 맞는 기록이 없습니다 | No matching records |
| 줄을 고르면 여기에 입력과 결과가 뜹니다 | Pick a row to see its input and result |
| 소요 | Elapsed |
| 아카이빙 대기 | Archiving — queued |
| 아카이빙중 | Archiving |
| 아카이빙 답변 대기 | Archiving — awaiting answer |
| 알림 없음 | No notifications |
| 보관한 알림 없음 | No archived notifications |
| 한도를 읽을 수 없습니다 | Can't read the limit |
| 최근 5시간 토큰 | Tokens, last 5 hours |
| 키설정 | Keyboard shortcuts |
| 사용 통계 | Usage stats |
| 언어 | Language |
| 웹훅 | Webhook |
| 경로 | Path |
| 열림 | Open |
| 연결 | Connected |
| 주소 | Address |
| 테스트 보내기 | Send test |
| 보냈습니다 | Sent |
| 보내지 못했습니다 | Couldn't send |
| 보내지 않습니다 | Not sending |
| 새 스케줄 | New schedule |
| 스케줄 삭제 | Delete schedule |
| 반복 | Repeat |
| 한 번만 | Once |
| 매일 | Daily |
| 매주 | Weekly |
| 매월 | Monthly |
| 시각 | Time |
| 문장 | Prompt |
| 만들기 | Create |
| 회차 없음 | No runs yet |
| 새 대화 | New conversation |
| 보내기 | Send |
| 답하는 중 | Answering |
| 답변 달기 | Post answer |
| 통합 게이트 적용 | Apply dispatch gate |
| 마지막 폴링 | Last polled |
| 마지막 출력 | Last output |
| 의견 보내기 | Send feedback |
| GitHub 이슈로 보내기 | Open a GitHub issue |
| 펼치기 (frontmatter 읽기 전용 표) | Expand |
| 평문으로 | Switch to plain text |

Four more for the same reason, all macOS wording rather than ours: `허용` is `Allow`, `앱 관리` is
`App Management`, `개인정보 보호 및 보안` is `Privacy & Security`, and `전체 디스크 접근 권한` is
`Full Disk Access`.

The app screens have their own English dictionary in `lib/i18n.ts` already, so labels on the
board, the ticket detail, and the Personas and Squads screens are not copied into this table.
Read the label out of that file and quote it letter for letter. This table stays what it is for:
the manual's prose, which has no dictionary.

## Placeholders

Angle-bracket placeholders are prose, not paths, so they get translated. Anything outside the
brackets stays byte for byte.

| Korean | English |
|---|---|
| `<프로젝트>` | `<project>` |
| `<경로>` | `<path>` |
| `<해시>` | `<hash>` |
| `<사용자 이름>` | `<your name>` |
| `<루트>` | `<root>` |
| `<이름>` | `<name>` |
| `<날짜>` | `<date>` |
| `<토큰>` | `<token>` |
| `<브랜치>` | `<branch>` |
| `<큐 폴더>` | `<queue folder>` |
| `<파일명>` | `<filename>` |
| `<워커이름>` | `<worker name>` |
| `<받는 트리>` | `<receiving tree>` |
| `<시각>` | `<time>` |
| `<워커>` | `<worker>` |
| `<번호>` | `<number>` |
| `<키>` | `<key>` |
| `<제목>` | `<title>` |
| `<에픽 제목>` | `<epic title>` |
| `<종류>` | `<kind>` |
| `<폴더 이름>` | `<folder name>` |
| `P숫자` | `P<number>` |
| `<설명>` | `<description>` |
| `<티켓경로>` | `<ticket path>` |
| `<inbox경로>` | `<inbox path>` |
| `<진행중접미사>` | `<in-progress suffix>` |
| `<스크립트 파일명>` | `<script filename>` |
| `<상한>` | `<cap>` |
| `<페르소나 디렉터리>` | `<persona directory>` |
| `<페르소나 또는 agent>` | `<persona or agent>` |
| `<sid 앞8자리>` | `<first 8 of the sid>` |

## Screen sentences the manual quotes

Full sentences the app puts on screen, quoted inside the manual. Same rule as the labels above:
these rows copy the English dictionary, and when the two disagree the dictionary is right.

| Korean | English | Notes |
|---|---|---|
| `등록된 프로젝트가 없습니다. 하나 만들면 시작합니다.` | `No projects yet. Create one to get started.` |
| `이미 만들어 둔 .dira가 있다면 등록합니다.` | `Already made a .dira? Register it.` |
| `.dira를 만들고 워커 하나를 crontab에 올립니다 — 30초 뒤부터 티켓을 물어갑니다.` | `Creates .dira and puts one worker in crontab — it starts picking up tickets 30 seconds later.` |
| `여기에 .dira를 만듭니다. ~는 확장됩니다` | `.dira goes in here. ~ is expanded` |
| `crontab에 등록됨 — 30초 뒤부터 티켓을 물어갑니다` | `Registered on crontab — it starts taking tickets 30 seconds later` |
| `권한 창이 뜨면 [허용]을 누르세요 — crontab 등록이 그 대답을 기다립니다.` | `Press [Allow] if a permission window opens — registering the crontab line waits on that answer.` | The project creation screen. The one under `Worker settings` opens with `Hit [Allow] when` instead. |
| `<경로>/.dira는 이미 dira 프로젝트입니다. 만들지 않고 등록하세요.` | `<path>/.dira is already a dira project. Register it instead of creating it.` |
| `claude CLI를 찾지 못했습니다 — 워커가 세션을 띄우지 못합니다` | `No claude CLI here — workers can't start a session` |
| `요구사항이 접수되었습니다. 곧 PM이 검토할 예정입니다.` | `Request received. The PM will review it shortly.` |
| `쓰던 내용이 있습니다` | `You have unsaved text` |
| `아무도 집지 않는 티켓 <n>건` | `Tickets no one will claim: <n>` |
| `(디스패치되지 않는 N건은 상단 알림)` | `(Not dispatched: N — see notifications)` |
| `수거할 스테일 티켓이 없습니다.` | `No stale tickets to collect.` |
| `crontab에 등록했습니다 — 30초 뒤부터 티켓을 물어갑니다.` | `Registered in the crontab — it starts claiming tickets in 30 seconds.` |
| `공통 워커가 없습니다 — 만들면 빌리기를 켠 프로젝트마다 들어갑니다.` | `No common workers — creating one adds it to every project that borrows.` |
| `0이거나 비우면 안 빌립니다 — 상한은 동시에 도는 수이고 예약이 아닙니다.` | `0 or empty means no borrowing — the limit is how many run at once, not a reservation.` |
| `공통 워커 <n>명이 이 프로젝트에 들어와 있습니다` | `<n> shared worker(s) are in this project` |
| `들어와 있는 공통 워커가 없습니다` | `No shared workers are in this project` |
| `pool-limit을 읽지 못했습니다 — 안 빌리는 것으로 읽습니다.` | `Couldn't read pool-limit — reading it as not borrowing.` |
| `티켓을 물고 있어 못 뺀 공통 워커: ` | `Still holding a ticket, couldn't remove: ` |
| `등록된 토큰이 없습니다.` | `No tokens yet.` |
| `<날짜> 추가` | `<date> added` |
| `저장했습니다. 유효한지는 다음 디스패치에서 드러납니다.` | `Saved. Whether it works shows up on the next dispatch.` |
| `Claude 토큰이 없습니다` | `No Claude token` |
| `워커가 티켓을 집어도 세션을 못 열고 그대로 끝냅니다.` | `Workers still claim tickets, but they can't open a session and end right there.` |
| `세션이 열리자마자 죽는 워커` | `Workers that die the moment a session opens:` |
| `답변을 기다리는 티켓` | `Tickets waiting on an answer:` |
| `커밋 안 된 변경이 디스패치를 막고 있습니다` | `Uncommitted changes are blocking dispatch` |
| `큐가 멈춰 있던 구간` | `Stretches the queue sat stopped:` |
| `이 워커는 받는 트리가 더러워도 그냥 디스패치됩니다` | `This worker dispatches even when the receiving tree is dirty` |
| `아직 안 돌림` | `Not run yet` |
| `스크립트 파일 없음` | `Script file not found` |
| `https 주소만 받습니다` | `Only https addresses are accepted` |
| `스케줄을 지웁니다` | `This deletes the schedule` |
| `이름을 바꾸면 프롬프트에서 빠집니다` | `Rename it and it drops out of the prompt` |
| `모든 세션이 협업 프로토콜 없이 시작합니다` | `Every session will start with no collaboration protocol` |
| `이 티켓 48M 토큰 · 세션 1개` | `This ticket 48M tokens · 1 session` |
| `· 이 합계에 없는 세션 3개` | `· outside this total: 3` |
| `이 해시의 로그 3개에 종료 기록이 없습니다` | `None of the 3 logs for this hash has an exit record` |
| `workers/logs/*-<해시>.log가 이 머신에 0개입니다` | `There are 0 workers/logs/*-<hash>.log files on this machine` |
| `기록 145건` | `Records 145` |

The em dash in those sentences is the app's, not ours. Keep it where the Korean has it.

The last five rows are the token figure and the record count. Korean puts the number in the middle
of the phrase and English puts it after the label, so the pieces are cut differently. The token
sentences are still Korean in `lib/usage.ts`; the English above is what they take when they move
into the dictionary.
