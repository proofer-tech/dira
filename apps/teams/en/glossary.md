# Glossary

This file decides the English word for every product term the manual uses. Every English
chapter under `en/` follows it. The Korean manual is the source; this table is the only
place where its vocabulary is fixed for English.

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
| 참견 | barge-in | Sending a line into a session that is already running. |
| 되묻기 | asking back | What pm does instead of guessing. |
| 이어받기 | handoff | A `이어받기 티켓` is a handoff ticket. |
| 통합 브랜치 | integration branch | |
| 스펙 문서 | spec document | |
| 슬러그 | slug | |
| 수행자 | assignee | The persona or squad a ticket is issued to. |
| 진행 기록 | activity log | The per-session record a ticket page shows. |
| 폴링 대기 | polling wait | The section a scheduled ticket carries. |

## States and badges

The board has three lanes and four badges. Capitalize them as labels, lowercase them in
running prose.

| Korean | English | Notes |
|---|---|---|
| 대기 | Backlog | The lane, and the filter option. The file is `<hash>.md`, open and waiting for the next tick. |
| 진행중 | In progress | The lane. The file is `<hash>.wip.md`. |
| 완료 | Done | The lane. The file is `<hash>.done.md`. |
| 답변 대기 | Awaiting answer | The badge, and the frontmatter key stays `awaiting`. |
| deps 대기 | Waiting on deps | The badge and the filter option. |
| 대기중 | Waiting | The badge a scheduled ticket carries, with the time left. |
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

## Screen labels the manual quotes

The manual tells the reader which button to press, so a label quoted here has to be the
label the screen actually shows. The English dictionary in `lib/i18n.ts` is written after
this file, and it takes its wording from this table.

| Korean | English |
|---|---|
| 요구 접수 | Submit a request |
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
| 접수한 요구 보기 | View the request |

Two more rows for the same reason, both macOS wording rather than ours: `허용` is `Allow` and
`앱 관리` is `App Management`.

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

## Screen sentences the manual quotes

Full sentences the app puts on screen, quoted inside the manual. Same rule as the labels above:
the English dictionary takes its wording from here.

| Korean | English |
|---|---|
| `등록된 프로젝트가 없습니다. 하나 만들면 시작합니다.` | `No projects yet. Create one to get started.` |
| `이미 만들어 둔 .dira가 있다면 등록합니다.` | `Already made a .dira? Register it.` |
| `.dira를 만들고 워커 하나를 crontab에 올립니다 — 30초 뒤부터 티켓을 물어갑니다.` | `Creates .dira and puts one worker on crontab — it starts taking tickets 30 seconds later.` |
| `여기에 .dira를 만듭니다. ~는 확장됩니다` | `.dira goes here. ~ is expanded` |
| `crontab에 등록됨 — 30초 뒤부터 티켓을 물어갑니다` | `Registered on crontab — it starts taking tickets 30 seconds later` |
| `권한 창이 뜨면 [허용]을 누르세요 — crontab 등록이 그 대답을 기다립니다.` | `If a permission dialog appears, press [Allow] — crontab registration is waiting on that answer.` |
| `<경로>/.dira는 이미 dira 프로젝트입니다. 만들지 않고 등록하세요.` | `<path>/.dira is already a dira project. Register it instead of creating one.` |
| `claude CLI를 찾지 못했습니다 — 워커가 세션을 띄우지 못합니다` | `claude CLI not found — workers cannot start sessions` |
| `요구사항이 접수되었습니다. 곧 PM이 검토할 예정입니다.` | `Your request has been submitted. pm will review it shortly.` |

The em dash in those sentences is the app's, not ours. Keep it where the Korean has it.
