# dira

**파일시스템이 곧 큐인 티켓 디스패처.** 워커 하나가 cron에 물려 열린 티켓 1건을 골라 헤드리스
에이전트 세션(`claude -p` 등)에 넘기고, 그 세션이 끝날 때까지 기다린다. 상주 루프도, DB도, 인덱스도
없다 — **상태의 단일 출처는 티켓 파일 자체**(파일명 접미사 + frontmatter)다.

**이름은 `dira`다** — `dir` + `jira`. 큐가 디렉터리 하나라서 `dir`이고, 그 디렉터리를 티켓으로
보는 도구라서 `jira`의 오마주다. 웹 UI는 `dira teams`이고 `apps/teams/`에 있다.

- **의존성 0** — bash + python3 표준 라이브러리. 설치는 `git clone`이 끝이다. 이 약속은 **엔진의
  것이다**(`tick.sh`·`tickets.py`). 선택 사항인 [GUI](#gui-선택)는 `apps/teams/`에 격리된 별개 앱이라 여기 없다.
- **워커 = 크론잡 1개 = 티켓 1건** — 동기 프로세스다. 더 돌리려면 `workers/`에 워커를 더 둔다.
- **프로젝트 무관** — 엔진은 어느 프로젝트도 모른다. 프로젝트별 값은 워커 파일에만 있다.
- **엔진 무관** — `claude -p`가 기본이지만 워커 한 줄로 다른 CLI 에이전트로 바꾼다.
- **잡기 = 원자적 파일 연산** — 락 서버도 타임아웃도 없이 두 세션이 같은 티켓을 못 든다.
- **죽은 세션 자동 회수** — 프로세스 생존을 직접 확인해서 회수한다(시간 만료 아님).

```
$ .dira/workers/w1.sh list
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
git clone https://github.com/proofer-tech/dira.git ~/Projects/dira
```

`tick.sh`는 엔진 코드일 뿐이고 직접 실행하지 않는다 — 진입점은 워커다(아래).

헤드리스 인증(cron으로 돌릴 때만). 토큰은 **머신 로컬**에 하나만 둔다. 티켓 루트가 공유 드라이브에
있어도 비밀이 같이 동기화되지 않게:

```bash
mkdir -p ~/.config/dira
claude setup-token
printf %s '<토큰>' > ~/.config/dira/oauth-token && chmod 600 ~/.config/dira/oauth-token
```

## 빠른 시작

프로젝트 하나 붙이는 데 필요한 것은 워커 파일 하나다. **워커가 놓인 위치가 곧 티켓 루트다.**

```bash
mkdir -p ~/Projects/myproject/.dira/workers
cat > ~/Projects/myproject/.dira/workers/w1.sh <<'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x ~/Projects/myproject/.dira/workers/w1.sh

# (선택) 프로토콜·페르소나 출발점을 복사한다 — 엔진은 이게 없어도 그대로 돈다
cp -r ~/Projects/dira/templates/* ~/Projects/myproject/.dira/

# 티켓 하나 만들고
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

# 실행 없이 선정 결과·프롬프트만 확인
~/Projects/myproject/.dira/workers/w1.sh dryrun
```

cron 등록(**워커당 두 줄**):

```
* * * * * $HOME/Projects/myproject/.dira/workers/w1.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
* * * * * sleep 30; $HOME/Projects/myproject/.dira/workers/w1.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
```

cron의 제일 잔 필드가 분이라(`man 5 crontab`) 30초 폴링은 이렇게 낸다. **한 줄에 `;`로 붙이지
않는다** — 워커는 동기 프로세스라 앞 호출이 세션을 물면 뒷반쪽이 30초 뒤가 아니라 그 세션이
끝난 뒤에 뜬다. 두 줄이어야 :00·:30이 결정적이다. 중복 디스패치는 워커 락이 막는다.

중지는 그 두 줄 삭제. 진행 상황은 `<루트>/workers/runner.log`, 세션별 출력은
`<루트>/workers/logs/<시각>-<워커>-<해시>.log`.

**동시에 두 건을 돌리려면 워커를 하나 더 둔다** — `w2.sh`를 만들고 cron에 두 줄 더. 워커 하나는
한 번에 티켓 1건만 물고(락), 앞 실행이 아직 세션을 쥐고 있으면 그 분의 tick은 그냥 넘어간다.
동시 실행 상한 같은 설정값은 없다. **동시성 = 워커 개수**다.

## 티켓

```
<프로젝트>/.dira/          <- 티켓 루트. 워커가 놓인 위치가 루트를 정한다
  tickets/<hash>.md              <- 큐. 평면이다. 하위 디렉터리 없음
  personas/<이름>/PROFILE.md     <- 누가 (티켓이 고른다)
  protocols/AGENTS.md            <- 어떻게 같이 일하는가 (전원 공통)
  workers/w1.sh w2.sh            <- 크론잡. 하나가 실행 1회에 티켓 1건
  workers/runner.log logs/       <- 디스패치 기록·세션별 출력
```

루트를 어디에도 적지 않는다 — `<루트>/workers/w1.sh`에서 `workers`의 부모가 루트다. 프로젝트 안에
둘 필요도 없다: 공유 클라우드 워크스페이스에 큐를 두면 그 안에 `workers/`를 만들고 cron이 그 경로를
가리킨다(마운트가 안 붙으면 워커 파일 자체가 없어 cron이 조용히 실패한다 — 빈 큐로 오해하고 도는 일이
없다). 큐 디렉터리(`tickets/`)는 없으면 만든다.

세션의 작업 디렉터리는 기본이 **루트의 부모**다(`<프로젝트>/.dira` → `<프로젝트>`).
큐를 프로젝트 밖에 뒀으면 워커에서 `TICKET_CWD`로 지정한다.

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

여기 예시는 짧게 뒀고, 바로 쓸 수 있는 실물 프로필 4종(pm·developer·qa·designer)은
[§템플릿](#템플릿)에 있다.

## 협업 프로토콜

```
<TICKET_PROTOCOLS 또는 $TICKET_ROOT/protocols>/
  AGENTS.md          <- 이 파일만 자동으로 실린다
  handoff.md         <- AGENTS.md가 가리키면 세션이 필요할 때 직접 읽는다
```

페르소나가 **누구**라면 프로토콜은 **어떻게 같이 일하는가**다 — 티켓 성격별 처리, 핸드오프, 보고,
블록 규약. `AGENTS.md`가 있으면 모든 세션의 프롬프트에 인라인된다. 페르소나와 달리 티켓이 고르지
않는다(전원 공통 규약이므로). 없으면 그냥 넘어간다.

디렉터리인 이유는 `AGENTS.md`가 목차 역할을 하기 때문이다 — 길어지는 세부 규약은 옆 파일로 빼고
`AGENTS.md`에서 가리키면, 세션이 필요할 때만 읽는다(프롬프트에 전부 싣지 않는다).

여러 큐가 같은 규약을 쓰면 워커에서 `TICKET_PROTOCOLS`를 공유 경로로 준다.

```markdown
# 협업 프로토콜

## 티켓 성격
- `kind: request`를 받으면 답을 `kind: feedback` 티켓으로 새로 만든다. 원본에 덧붙이지 않는다.
- `kind: work`는 착수 전에 deps가 전부 `.done`인지 확인한다.

## 핸드오프
- 다른 페르소나에게 넘길 일이 생기면 티켓을 새로 만들고 `deps:`로 엮는다. 남의 티켓을 고치지 않는다.
- 넘긴 사실을 원본 티켓 본문에 한 줄 남긴다.

## 막혔을 때
- 사람 판단이 필요하면 티켓 본문에 `## 블록` 절을 추가하고 이유를 적고 종료한다.
- 추측으로 진행하지 않는다. 세부는 [handoff.md](handoff.md) 참조.
```

여기 예시는 뼈대만이고, 바로 쓸 수 있는 실물 `AGENTS.md`는 [§템플릿](#템플릿)에 있다.

프롬프트 조립 순서는 **페르소나 -> 프로토콜 -> 티켓 지시 -> 참조 컨텍스트**다. `dryrun`으로 실제
조립 결과를 그대로 볼 수 있다.

## 템플릿

프로토콜과 페르소나는 **직접 쓰기 전에 복사부터 한다.** 빈 파일에서 시작하지 않게 이 레포가
출발점을 들고 있다.

```
templates/
  protocols/AGENTS.md              <- 큐를 다루는 규약. 전원 프롬프트에 실린다
  protocols/tickets.md             <- 티켓 파일 작성법. AGENTS.md가 가리키고 필요할 때 읽힌다
  personas/pm/PROFILE.md           <- 무엇을 만들지 정하고 쪼개서 티켓으로 내보낸다
  personas/developer/PROFILE.md    <- 티켓을 돌아가는 코드로 바꾸고 증거를 남긴다
  personas/qa/PROFILE.md           <- "됐다"는 주장을 돌려보고 깬다
  personas/designer/PROFILE.md     <- 화면을 확정한다. UI가 있는 프로젝트에서만 둔다
```

```bash
cp -r ~/Projects/dira/templates/* ~/Projects/myproject/.dira/
```

**복사한 순간부터 프로젝트의 것이다.** 고쳐 쓰라고 있는 것이고, 업스트림과 동기화되지 않는다 —
템플릿이 나중에 바뀌어도 복사본은 그대로다(엔진이 템플릿을 찾아가지 않으니 그럴 방법도 없다).
프로젝트 이름·경로·금지사항은 복사 직후 손으로 채운다.

내용의 출처는 이 레포 자신의 도그푸딩이다 — `.dira/`에서 실제로 돌던 규약에서
프로젝트 고유 부분을 걷어내고 뽑았다.

## 명령

전부 워커 스크립트로 실행한다(`tick.sh`를 직접 부르면 rc=2로 거절한다 — 워커 위치 없이는 루트를
알 수 없다).

```
w1.sh                    1회 디스패치(cron 진입점. 워커 락 -> reap -> 선정 -> 실행)
w1.sh list               열린 티켓 큐 + 할당·deps 대기 상태
w1.sh dryrun             claim·실행 없이 선정 결과·엔진·프롬프트만 출력
w1.sh reap               스테일 수거만 1회
w1.sh unassign <해시>    할당 해제(session_id 비우기 + 진행중 접미사 떼기) -> 큐 복귀
```

`list`·`dryrun`·`reap`·`unassign`은 큐 전체를 보므로 같은 루트의 어느 워커로 불러도 같다.

`tickets.py`는 큐·frontmatter 헬퍼이고 단독 CLI로도 쓴다. 사람이 직접 쓰는 건 사실상 하나다:

```
python3 tickets.py handclaim <티켓경로> "<페르소나 / 세션식별>"
```

대화형 세션이 티켓을 손으로 잡을 때 쓴다. **맨손 `mv`로 잡으면 생존 신호(`pid`)가 없어 세션이
조용히 죽었을 때 영구 좀비가 된다.** 나머지 서브커맨드(`select`·`claim`·`release`·`assign`·`clear`·
`find`·`list`·`reap`)는 `tick.sh`가 호출하지만 스크립트를 짜 붙일 때 그대로 쓸 수 있다 —
`select`는 `path|hash|kind|persona` 줄을 낸다.

## GUI (선택)

**큐를 보고 만지는 로컬 웹 UI.** `w1.sh list`·`vim tickets/*.md`로 하던 일을 화면에서 한다 —
보드(테이블·칸반)·티켓 편집·발행·할당 해제·워커 현황·페르소나·프로토콜. 상태 전이는 그대로 엔진에
위임한다(`unassign`·`reap`을 서브프로세스로 부른다), crontab은 **그 프로젝트의 워커 줄만** GUI가
쓰고(워커 생성이 등록까지 한 동작으로 끝난다) 나머지 줄은 바이트 그대로 보존한다.

```bash
cd apps/teams && pnpm install && pnpm dev     # http://localhost:7331
```

**프로젝트마다 띄우지 않는다.** GUI는 이 레포에서 한 벌만 돌고, 큐 위치를 **프로젝트로 등록**해
여러 프로젝트의 큐를 한 앱에서 전환하며 본다 — 프로젝트가 5개면 인스턴스 5개가 아니라 등록 5개다.
등록 목록은 `~/.config/dira/gui-projects.json` 하나에 있고 등록 경로 외의 정보는 담지 않는다.
디스크를 스캔해 큐를 자동으로 찾아다니지 않고, 등록을 해제해도 그 프로젝트의 큐 파일은 그대로다.

**엔진 없이도 돌지만 엔진을 대체하지 않는다.** GUI만 띄워도 큐를 읽고 티켓을 만들 수 있지만
그 티켓을 실제로 물어 세션에 넘기는 건 여전히 cron에 물린 워커다. GUI는 같은 파일을 보는 창이고,
읽기 판정이 `tickets.py`와 갈리지 않도록 패리티 테스트로 못박아 둔다(`cd apps/teams && pnpm test`).

위 **의존성 0은 엔진에 대한 약속**이고 GUI는 그 밖이다 — 별개 Next.js 앱이라 자기 의존성을 가지며,
안 쓰면 `pnpm install`을 할 일도 없다. 제품 스펙은 [`docs/DESIGN.md`](docs/DESIGN.md).

## 릴리스

```bash
cd apps/desktop && pnpm release <patch|minor|major>
```

**사람만 치는 명령이다.** 원격에 push하는 유일한 자리이고, 협업 프로토콜 §git이 세션에게
원격 push를 금지한다 — 에이전트 세션은 이걸 실행하지 않는다. `master`에 들어온 커밋을
`patch`로 굽는 자동 경로는 따로 있고(`.github/workflows/release.yml`), `minor`·`major`를
손으로 낼 자리가 이 명령이다.

서명·공증 준비물(Developer ID 인증서·Apple 계정)이 하나라도 없으면 **버전을 올리기 전에**
멈추고 무엇이 없는지 이름을 찍는다 — 태그만 남고 자산이 없는 릴리스는 나오지 않는다.

절차·순서·조건의 정본은 [`docs/DESIGN.md`](docs/DESIGN.md) §릴리스다.

## 워커 레퍼런스

워커는 `tick.sh`를 `.`(source)하는 셸 스크립트다. 필수는 그 source 한 줄뿐이고, 위에 값을 얹어
덮어쓴다. 전체 예시는 [`worker.sh.example`](worker.sh.example).

```sh
#!/bin/bash
TICKET_NAME="reviewer"
TICKET_ENGINE=(codex exec --json "{prompt}")
. "$HOME/Projects/dira/tick.sh"
```

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `TICKET_NAME` | 워커 파일명 | 로그 접두 + 티켓 `owner` 표기 |
| `TICKET_CWD` | 티켓 루트의 부모 | 디스패치된 세션의 작업 디렉터리 |
| `TICKET_PERSONAS` | `<루트>/personas` | 페르소나 프로필 디렉터리 |
| `TICKET_PROTOCOLS` | `<루트>/protocols` | 협업 프로토콜 디렉터리. 그 안의 `AGENTS.md`가 전원 프롬프트에 실린다 |
| `TICKET_CONTEXT` | (없음) | `("<경로>\|<설명>" ...)` 배열. 프롬프트 꼬리에 참조 자료로 붙는다. 없는 경로는 건너뛰고 `WARN`만 |
| `TICKET_ENGINE` | `(claude -p "{prompt}" --session-id "{sid}" --dangerously-skip-permissions --output-format json)` | 실행 엔진 argv. `{prompt}`·`{sid}` 치환 |
| `TICKET_PROMPT_FMT` | `%s 티켓을 확인해 주세요. ...` | printf 포맷. `%s` = 티켓 해시 하나뿐 |
| `TICKET_INPROGRESS` | `.wip` | 진행중 접미사 |
| `TICKET_DONE` | `.done` | 완료 접미사 |
| `TICKET_MAXRUN` | `5400` | 세션 1건 실행 상한(초). 초과 시 TERM→KILL 후 백로그 복귀 |

티켓 루트는 워커의 위치가 정하므로 설정값이 없다. 응답 JSON에서 실제 `session_id`를 읽어
frontmatter를 정정하는 단계는 `claude` 전용이고 다른 엔진이면 그냥 건너뛴다.

머신 로컬 상태(호출 시점 환경변수):

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `TICKET_LOCAL` | `~/.config/dira` | 토큰(`oauth-token`)과 워커 락(`run/`). 티켓 루트가 공유 드라이브여도 여기는 로컬 |

## 동작

1. 워커 위치 → `TICKET_ROOT` 확정. 워커 락 획득(못 얻으면 `SKIP` 후 종료).
2. `reap`(스테일 수거).
3. 상태 접미사 없고 `session_id`가 비었고 `deps`가 다 충족된 티켓을 생성일(`st_birthtime`)
   최고참부터 훑는다.
4. **잡기 = 원자적 link.** `os.link`로 `<hash>.wip.md`를 만들고 원본을 지운다. 목적지가 있으면
   커널이 `EEXIST`를 주므로 먼저 성공한 쪽만 이긴다 — 판정과 획득이 한 시스템콜 안에 있어 틈이 없다.
   이미 잡혔으면 다음 후보로 넘어간다.
   하드링크 미지원 파일시스템(구글드라이브 등 FUSE·SMB)에서는 `O_CREAT|O_EXCL`로 폴백한다.
   **`os.rename` 폴백은 락이 아니다** — 목적지가 있어도 조용히 덮어쓰고, `exists()` 선검사는
   TOCTOU라 두 프로세스가 둘 다 통과한다.
5. frontmatter에 `session_id`/`assigned_at`/`owner`를 먼저 기록(디스패치 순간부터 큐에서 제외)하고
   `cd $TICKET_CWD` 후 엔진을 띄운다. 프롬프트는 [페르소나 프로필] + [협업 프로토콜] + [본문 지시]
   + [참조 컨텍스트] 순.
6. rc=0이면 응답의 실제 `session_id`로 frontmatter를 정정. rc≠0이면 할당 회수 + 백로그 복귀
   (다음 tick이 다시 집는다).

**워커 락**은 `$TICKET_LOCAL/run/<워커>-<해시>.lock` 디렉터리다(`mkdir`이 원자적이라 그것 자체가
락이다). 안에 pid를 적어두고, 락이 이미 있으면 그 pid의 생존을 확인한다 — 살아있으면 `SKIP`,
죽었으면(재부팅·강제종료) 스테일로 회수하고 진행한다. 락을 머신 로컬에 두는 이유는 pid가 이 머신에서만
뜻이 있기 때문이다. **티켓 중복 방지는 락이 아니라 claim(원자적 link)이 담당한다** — 락은 "한 워커가
겹쳐 돌지 않는다"만 보장한다.

전체 동시 실행량은 워커 개수로 조절한다. 서로 다른 티켓을 든 워커 여럿이 같은 파일·공유 dev DB를
만지는 위험은 남아 있고(동시 4세션이 컬럼을 드롭한 사례가 근거) 그건 워커를 몇 개 둘지로 사람이
정한다.

## 스테일 수거 (`reap`)

매 tick 맨 앞에 돈다. 없으면 **세션이 사람에게 질문하고 rc=0으로 종료한 티켓이 영구 유실된다**
(rc≠0 회수 경로가 그 경우를 못 잡는다).

- **디스패처 세션**: frontmatter `session_id`를 `ps`의 `--session-id`와 대조해 **죽은 것만** 회수.
  유예 3분, `attempts`를 올리며 2회까지만 자동 회수한다(같은 이유로 죽는 티켓이 세션을 무한히
  태우는 걸 막는다). 3회째는 **답변 요청으로 올린다** — 본문에 `## 질문 n`을 붙이고 `awaiting:`에
  없는 해시를 걸어 열림으로 되돌린다(`ASK` 로그). 열려 있으니 화면에서 답할 수 있고, 답변
  파일(`<awaiting>.done.md`)이 생기기 전엔 `deps`가 미충족이라 아무 워커도 집어 가지 않는다.
  답이 달리면 잠금이 저절로 풀려 큐에 다시 뜨고 `attempts`는 0에서 다시 센다.
  옛 동작(`.wip` 유지 + `HOLD` 로그)은 사람이 눈으로 찾을 때까지 방치됐다 — `.wip`은 화면이
  편집하지 못하기 때문이다(2026-07-31 `5aa9486d`: 인증서가 없어 막힌 티켓이 `attempts` 49까지
  로그만 쌓았다).
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
- **동시성 knob이 워커 개수인 이유**: 예전엔 `ps` 출력에서 엔진 프로세스를 세는 전역 상한이었는데,
  엔진을 바꾸면 세는 패턴도 같이 바꿔야 하고 안 바꾸면 항상 0으로 세져 상한이 조용히 무력화됐다.
  "몇 개 돌릴지"를 파일 개수로 표현하면 설정도 카운트도 필요 없다. 상한이 왜 있어야 하는지는
  여전히 유효하다 — 동시 4세션이 같은 소스·공유 dev DB를 만져 컬럼 드롭이 관측됐다.
- **`reap`이 있는 이유**: 질문하고 rc=0으로 끝난 세션의 티켓이 하루 3건 유실돼 수동 복구했다.
- **성격·상태 3종·해시 파일명·claim 락은 워커로 열지 않는다.** 프로토콜 자체다.

## 테스트

의존성 없이 그냥 돌린다. 실패하면 `assert`로 죽는다.

```bash
python3 test_generic.py       # 평면 큐·kind/persona·접미사·프롬프트·deps·워커 루트/락/인증게이트
python3 test_reap_manual.py   # 스테일 판정 6케이스
python3 test_claim_race.py    # claim 락 동시성: 24프로세스 동시 claim, link·O_EXCL 두 경로
```

## 파일

```
레포:
  tick.sh              디스패처 엔진(워커가 source한다. 직접 실행하지 않는다)
  tickets.py           큐·frontmatter 헬퍼(단독 CLI로도 쓴다)
  worker.sh.example    워커 계약
  test_*.py            자체검증 3종

<티켓루트>/workers/     크론잡: <워커>.sh, runner.log, logs/
~/.config/dira/   머신 로컬: oauth-token, run/<워커>.lock
```

## 라이선스

MIT. [`LICENSE`](LICENSE) 참조.

## 한계

- 티켓 수백 건 규모를 전제한다. 매 tick마다 루트를 glob으로 훑는다(인덱스 없음).
- 우선순위가 없다. 순서는 생성일 + `deps`뿐이다.
- 티켓 본문 형식을 강제하지 않는다. 무엇을 완료로 볼지는 티켓에 사람이 쓴다.
- 협업 프로토콜의 **내용**은 엔진의 것이 아니다. 엔진에는 `protocols/AGENTS.md`로 실어 보내는
  자리만 있고, 무엇을 규약으로 쓸지는 프로젝트가 정한다. 엔진은 그 문서를 읽지도 검증하지도 않는다.
  레포가 주는 건 [§템플릿](#템플릿)의 **출발점**뿐이고, 복사되는 순간 그것도 프로젝트의 것이다.
