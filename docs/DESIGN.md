# fs-tickets GUI — 제품 스펙

**스펙의 단일 출처.** 구현이 이 문서와 다르면 구현이 틀린 것이다. 스펙을 바꿔야 한다고 판단되면
`persona: pm` + `kind: feedback` 티켓으로 올린다(코드가 문서를 앞지르지 않는다).

소유: `## 스펙`~`## 로드맵` = PM / `## 비주얼 디렉션` = designer.

---

## 무엇

`.fs-tickets` 큐를 **보고 만지는 로컬 웹 UI**. CLI(`w1.sh list`, `vim tickets/*.md`)로 하던 일을
화면에서 한다. 엔진을 대체하지 않는다 — 엔진이 유일한 실행 주체이고 GUI는 같은 파일을 보는 창이다.

`gui/`에 격리된 Next.js 앱. `pnpm dev`로 띄우고 localhost에서 쓴다.

### 비목표

배포하지 않는다. 인증·멀티유저·팀 협업 기능 없다(파일시스템 권한이 곧 권한이다).
큐를 여러 개 붙이는 루트 스위처 없다(루트 1개. 두 번째가 실제로 생기면 그때 만든다).
실시간 푸시 없다(폴링). 모바일 레이아웃 없다.

## 제약 (깨면 블록)

1. **엔진 무수정.** `tick.sh`·`tickets.py`·`test_*.py`는 읽기 전용. 의존성 0이 제품 약속이다.
2. **상태 전이는 엔진에 위임.** claim(`os.link`)·release·reap을 TS로 다시 구현하지 않는다.
   할당 해제·스테일 수거는 `workers/<w>.sh unassign|reap`를 **서브프로세스로 호출**한다.
   원자성 보장은 그 코드 안에만 있다.
3. **읽기는 TS, 단 판정은 `tickets.py`와 같아야 한다.** 다르면 GUI가 거짓말을 한다.
   눈으로 맞추지 말고 패리티 테스트로 못박는다(→ 스펙 §읽기 코어).
4. **crontab은 읽기 전용.** GUI는 `crontab -l`을 파싱해 현황만 보여주고, 등록·해제는 명령어를
   복사해 준다. 사람이 실행한다.
5. **`.wip` 티켓은 편집 금지.** 그 파일로 지금 세션이 일하고 있다. 읽기만.

## 아키텍처

```
gui/
  app/                     App Router. 모든 fs 접근은 서버(Server Component / Server Action)
    page.tsx               보드 (테이블 · 칸반)
    tickets/[hash]/        티켓 상세
    tickets/new/           티켓 발행
    workers/               워커 현황·관리 + 컨텍스트 경로
    personas/              페르소나 편집
    protocols/             프로토콜 파일트리 + md 에디터
  lib/
    root.ts                루트 확정 + 경로 탈출 방어 (신뢰 경계)
    queue.ts               티켓 읽기 코어 (tickets.py 미러)
    queue.test.ts          패리티 테스트 (node --test)
    workers.ts             워커 파일·락·crontab 판정, TICKET_CONTEXT 파싱
    engine.ts              tick.sh 서브프로세스 호출 (unassign · reap · list)
  AGENTS.md                코드베이스 규약 (스캐폴드 티켓이 만든다)
```

- **런타임**: 모든 라우트 `nodejs`. Edge 없음(fs 필요).
- **상태 갱신**: Server Action → `revalidatePath`. 큐는 cron이 밖에서 바꾸므로 보드는
  `router.refresh()` 5초 폴링. `fs.watch`·SSE 없음. `// ponytail: 폴링. 체감 지연이 문제되면 SSE`.
- **클라이언트 상태 라이브러리 없음.** 필터·검색은 URL searchParams가 담는다(공유·새로고침 무료).
- **스택**: Next.js App Router / TypeScript strict / Tailwind v4 / shadcn / pnpm.
  테스트는 `node --test` + Node 내장 TS 스트리핑(Node 25). 테스트 프레임워크 추가 안 한다.

### 루트 확정 + 경로 방어 (`lib/root.ts`)

```
루트 = process.env.FS_TICKETS_ROOT ?? path.resolve(process.cwd(), '../.fs-tickets')
```

사용자 입력이 파일 경로가 되는 지점이 5개 있다(티켓 해시, 워커 이름, 페르소나 이름,
프로토콜 파일 경로, 컨텍스트 경로). **전부 서버에서 검증한다.**

- 이름류(워커·페르소나): `^[A-Za-z0-9_-]+$`. `tickets.py`의 `PERSONA_RE`와 같은 규칙.
- 해시: `^[a-z0-9-]{4,40}$` 통과 후 `tickets.py find`로 실제 경로를 얻는다(경로를 조립하지 않는다).
- 파일 경로: `fs.realpath` 후 루트 접두 확인. 심링크 탈출까지 막는다.
- 컨텍스트 경로는 **루트 밖을 허용한다**(그게 용도다). 대신 쓰기 대상이 아니라 문자열일 뿐이고,
  존재 여부만 표시한다.

## 데이터 모델

`tickets.py`가 이미 정의한 것을 TS 타입으로 옮긴 것이다. 새 개념을 만들지 않는다.

```ts
type TicketState = 'open' | 'wip' | 'done'

type Ticket = {
  hash: string            // frontmatter ticket: || 파일명 stem
  path: string            // 절대경로
  state: TicketState      // 파일명 접미사에서 (NFC 정규화 후 판정)
  title: string
  kind: string            // work | request | feedback | '' (강제 아님)
  persona: string         // PERSONA_RE 통과한 것만. 아니면 ''
  deps: string[]
  unmet: string[]         // .done이 아닌 deps. 못 찾은 해시도 미충족으로 본다
  assigned: boolean       // session_id 비어있지 않음
  fm: Record<string,string>  // 나머지 frontmatter 원본 (session_id·owner·attempts·pid…)
  body: string            // frontmatter 이후 본문 (검색 대상)
  birth: number           // st_birthtime ?? mtime. 큐 순서
}

type WorkerStatus = 'running' | 'idle' | 'stopped' | 'stale'
type Worker = {
  name: string; path: string
  status: WorkerStatus
  cron: boolean           // crontab에 이 파일 경로가 있는가
  lockPid: number | null
  holding: string | null  // 지금 물고 있는 티켓 해시 (.wip 티켓의 owner:로 역추적)
  context: { path: string; desc: string; exists: boolean }[]
  engine: string          // TICKET_ENGINE (표시용)
}
```

### 큐 판정 (`tickets.py`와 반드시 일치)

- 파일 목록: `tickets/*.md`, `.`으로 시작하는 파일 제외, **하위 디렉터리 안 봄**.
- 상태: stem이 NFC 정규화 후 `.wip`/`.done`으로 끝나는지. 접미사는 `TICKET_INPROGRESS`·
  `TICKET_DONE` 환경변수로 바뀔 수 있다 — 하드코딩하지 말고 읽는다.
- frontmatter: 첫 줄이 `---`, 닫는 `---`까지. 키는 `^[A-Za-z_][A-Za-z0-9_]*:` 스칼라만.
  **YAML 파서를 쓰지 않는다** — `tickets.py`가 정규식이므로 파서를 쓰면 판정이 갈린다.
- `deps`: 인라인 `[a, b]`와 블록 리스트(`- a`) 둘 다. 첫 `deps:` 키만 본다.
- 큐 순서: `birth` 오름차순, 동률이면 path.
- **디스패치 가능** = 상태 open + `assigned` false + `unmet` 빈 배열.

### 워커 상태 판정

락 경로를 tick.sh와 같이 조립한다: `${TICKET_LOCAL ?? ~/.config/fs-tickets}/run/<name>-<h>.lock`
where `h = sha1(<workers 절대경로>/<name>).hex[:8]`. 안의 `pid` 파일을 읽어 생존 확인.

| status | 판정 |
|---|---|
| `running` | 락 있음 + pid 생존 |
| `stale` | 락 있음 + pid 죽음 (다음 tick이 회수한다는 안내 표시) |
| `idle` | 락 없음 + crontab 등록됨 |
| `stopped` | 락 없음 + crontab 미등록 (파일만 존재) |

## 스펙 — 화면별

### 1. 보드 `/`

테이블 ↔ 칸반 토글(URL `?view=`). 기본 테이블.

- **테이블 컬럼**: 상태 · 해시 · title · kind · persona · deps · 생성일 · owner.
  정렬 가능. 기본은 큐 순서(birth 오름차순) — CLI `list`와 같은 순서로 보인다.
- **칸반 컬럼**: `대기` / `deps 대기` / `할당됨` / `진행중` / `완료`.
  드래그 없음(상태는 엔진 소관이다. 드래그로 옮기면 프로토콜을 깬다).
- **필터**: kind · persona · 상태 (다중 선택). URL에 반영.
- **검색**: title + 본문 + frontmatter 값 전체를 대소문자 무시 부분일치. 서버에서.
- **deps 표현**: deps 컬럼에 선행 해시를 badge로. 미충족은 시각적으로 구분(색만으로 하지 않는다 —
  아이콘·텍스트 동반). badge 클릭 → 그 티켓 상세.
- 빈 큐: "열린 티켓 없음" + 발행 버튼. 필터 결과 0건: 필터 초기화 버튼.

### 2. 티켓 상세 `/tickets/[hash]`

- frontmatter 표 + 본문 마크다운 원문. 상태 배지.
- **관계**: `막고 있는 것`(이 티켓의 unmet deps) / `이 티켓이 막는 것`(역참조).
- 편집: 상태 `open`·`done`만. `wip`은 잠금 + 사유 표시("세션이 물고 있다").
- 액션: `할당 해제`(assigned일 때. `w1.sh unassign <hash>` 호출) · 삭제(확인 다이얼로그).

### 3. 티켓 발행 `/tickets/new`

- title(필수) · kind(select) · persona(select — `personas/` 실제 목록에서) · deps(기존 티켓
  멀티셀렉트. 자유 입력 금지 → 오타 해시로 인한 영구 대기를 구조적으로 없앤다) · 본문(textarea).
- 해시는 서버가 생성(`randomUUID().slice`, 8 hex). 충돌 시 재시도.
- 파일 생성은 `O_EXCL`. `## Goal`/`## Done when` 골격을 본문 기본값으로 채운다.
- 발행 후 상세로 이동 + 큐에 뜨는지 확인 가능.

### 4. 워커 `/workers`

- 카드/행 목록: 이름 · status 배지 · 물고 있는 티켓 · pid · 엔진 · 마지막 활동(runner.log 테일).
- **생성**: 이름 입력 → `workers/<name>.sh` 작성(기존 워커를 템플릿으로) + `chmod 755`.
  이어서 **crontab 등록 명령어를 보여주고 복사**시킨다(제약 4).
- **중단**: crontab 해제 명령어 복사 안내 + 파일은 보존. `running`이면 "지금 물고 있는 티켓이
  끝난 뒤 멈춘다"고 알린다(진행중 세션을 죽이지 않는다).
- **삭제**: 파일 삭제. `running`이면 막는다 — 락과 세션이 붕 뜬다. 확인 다이얼로그 + 해제 명령어 안내.
- `reap` 버튼(`w1.sh reap` 호출) + 출력 표시.
- **컨텍스트 경로 관리**: 워커별 `TICKET_CONTEXT` 항목 추가·수정·삭제·순서. 경로 존재 여부를
  체크 표시(없는 경로는 엔진이 건너뛰고 WARN만 남긴다는 안내). 워커 간 복사 액션.
  `.sh` 편집은 `TICKET_CONTEXT=( … )` 블록 전체 치환. 블록 모양이 예상과 다르면 **거부**하고
  "손으로 편집하라"고 알린다(엉뚱한 라인을 밟지 않는다).

### 5. 페르소나 `/personas`

- `personas/*/PROFILE.md` 목록 + 편집(textarea). 생성·삭제(확인).
- 이름 규칙 `^[A-Za-z0-9_-]+$` 위반 시 서버 거부 + 이유 표시(엔진이 그 값으로 경로를 만든다).
- 티켓이 참조하지만 프로필이 없는 페르소나명을 경고로 띄운다(엔진은 WARN만 남기고 그냥 돈다).

### 6. 프로토콜 `/protocols`

- `protocols/` 파일트리(중첩 지원) + 선택 파일 md 에디터(monospace textarea) + 저장.
- 새 파일·삭제·이름변경. 루트 밖 경로는 서버 거부.
- `AGENTS.md`는 **모든 세션 프롬프트에 인라인된다**는 배지를 붙인다(길이가 곧 비용이다 —
  현재 문자 수를 표시). 나머지 파일은 "세션이 필요할 때 읽음"으로 표시.
- 미리보기 렌더링은 넣지 않는다. `// ponytail: 원문 편집만. 렌더가 실제로 필요해지면 그때 의존성`.

## 로드맵

| # | 티켓 | persona | deps |
|---|---|---|---|
| P0 | 비주얼 디렉션·토큰 확정 | designer | — |
| P0 | Next.js 스캐폴드 + `gui/AGENTS.md` | developer | — |
| P0 | 읽기 코어 `lib/queue.ts` + 패리티 테스트 | developer | 스캐폴드 |
| P1 | 보드 테이블 + 필터·검색 | developer | 읽기코어, 디렉션 |
| P1 | 칸반 뷰 + deps 관계 표현 | developer | 테이블 |
| P2 | 티켓 상세 + 편집 + 할당 해제 | developer | 읽기코어, 디렉션 |
| P2 | 티켓 발행 | developer | 티켓 상세 |
| P3 | 워커 현황 + 생성·중단·삭제 | developer | 읽기코어, 디렉션 |
| P3 | 컨텍스트 경로 관리 | developer | 워커 현황 |
| P4 | 페르소나 편집 | developer | 읽기코어, 디렉션 |
| P4 | 프로토콜 파일트리 + 에디터 | developer | 읽기코어, 디렉션 |
| P5 | QA — 보드·티켓 | qa | 칸반, 발행 |
| P5 | QA — 워커·페르소나·컨텍스트·프로토콜 | qa | P3·P4 전부 |
| P6 | 릴리스 판정 + README에 gui/ 문서화 | pm | QA 2건 |

## 수용조건 (전체)

개별 티켓의 `## Done when`이 계약이고, 아래는 제품 전체의 종료 조건이다.

- [ ] `cd gui && pnpm dev` → localhost에서 6개 화면 전부 열린다.
- [ ] 보드에 보이는 열린 티켓 집합·순서가 `.fs-tickets/workers/w1.sh list`와 같다.
- [ ] `node --test gui/lib/*.test.ts` 통과 — 읽기 판정이 `tickets.py`와 일치.
- [ ] GUI로 발행한 티켓이 `w1.sh list`에 `대기`로 뜨고, 실제로 디스패치된다.
- [ ] GUI로 만든 워커가 crontab 한 줄 추가 후 실제로 티켓을 물어간다.
- [ ] `git diff --stat` 결과에 `tick.sh`·`tickets.py`·`test_*.py`가 없다.
- [ ] `gui/package.json` 의존성에 스펙에 근거가 적히지 않은 패키지가 없다.

---

## 비주얼 디렉션

> designer 소유. P0 티켓에서 채운다. 아래는 PM이 못박는 경계뿐이다.
>
> - 로컬 개발자 관제 도구다. 정보 밀도 > 여백. 히어로·애니메이션 없음.
> - shadcn 기본값을 이기려 하지 않는다. 커스텀은 부족한 이유를 여기 적고 만든다.
> - 색만으로 의미를 전달하지 않는다. 라이트/다크 둘 다 정의한다. 대비 4.5:1.
> - 빈 상태 / 로딩 / 에러 / 텍스트 잘림 / 필터 0건 — 다섯 상태가 없는 스펙은 미완성이다.

### 0. 기준선

**베이스는 shadcn 기본 테마(`new-york` / base color `neutral`)를 그대로 쓴다.** `--background`
`--foreground` `--card` `--muted` `--border` `--ring` `--primary` `--destructive` 등은 재정의하지
않는다. 아래에서 정의하는 것은 **shadcn에 없는 것뿐**이다.

**색은 예외를 표시한다.** 정상 흐름(대기·idle)은 중립색이고, 시선은 막힌 것(deps 대기)과
깨진 것(stale)으로 가야 한다. 완료가 초록으로 화면을 채우는 대시보드는 상태를 못 읽게 한다.

**다크모드 전환 UI는 없다.** `prefers-color-scheme`을 따른다. 로컬 도구고 OS 설정이 이미 있다.
`// ponytail: 시스템 설정 추종. 토글이 실제로 필요해지면 그때 next-themes`.

아이콘은 **lucide-react**(shadcn이 이미 끌고 오는 것 — 새 의존성 아님). 기본 `size-4`,
배지 안에서는 `size-3.5`.

### 1. 색 토큰

shadcn 기본 배지 변종은 4개(`default`/`secondary`/`destructive`/`outline`)인데 표시할 상태는
티켓 5 + 워커 4 = 9개다. 부족하므로 **상태 색 토큰 5개를 추가**한다. 그 외 색은 추가하지 않는다.

`gui/app/globals.css`:

```css
:root {
  --status-active:   oklch(0.52 0.18 258);   /* 진행중 · running */
  --status-assigned: oklch(0.52 0.19 295);   /* 할당됨 */
  --status-blocked:  oklch(0.52 0.13 75);    /* deps 대기 */
  --status-done:     oklch(0.50 0.13 155);   /* 완료 */
  --status-stale:    oklch(0.52 0.19 25);    /* stale */
}
.dark {
  --status-active:   oklch(0.75 0.15 258);
  --status-assigned: oklch(0.76 0.15 295);
  --status-blocked:  oklch(0.80 0.13 80);
  --status-done:     oklch(0.76 0.14 155);
  --status-stale:    oklch(0.75 0.15 25);
}
@theme inline {                              /* Tailwind v4 — bg-status-*/text-status-* 노출 */
  --color-status-active:   var(--status-active);
  --color-status-assigned: var(--status-assigned);
  --color-status-blocked:  var(--status-blocked);
  --color-status-done:     var(--status-done);
  --color-status-stale:    var(--status-stale);
}
```

**배지 레시피는 하나다** — 9개 상태 전부 같은 모양, 색과 아이콘만 다르다:

```
text-status-X  bg-status-X/10  border-status-X/30
```

중립 상태(대기·idle)는 shadcn `secondary` 배지, `stopped`는 shadcn `outline` 배지를 그대로 쓴다.

**대비 검증** (WCAG AA 4.5:1 — 텍스트 색 vs 실제 배경인 10% 틴트):

| 토큰 | 라이트 | 다크 |
|---|---|---|
| `--status-active` | 4.89 | 7.64 |
| `--status-assigned` | 5.21 | 7.66 |
| `--status-blocked` | 4.89 | 9.05 |
| `--status-done` | 4.85 | 8.50 |
| `--status-stale` | 5.17 | 7.40 |

두 가지 함정이 실측으로 확인됐다. 지키지 않으면 AA가 깨진다:

- **`--muted-foreground`를 배지 텍스트로 쓰지 않는다.** `--muted` 위에서 라이트 4.34로 미달한다.
  중립 배지는 `--secondary-foreground`(=`--foreground` 계열)를 쓴다.
- **`--destructive`를 stale 배지에 재사용하지 않는다.** 라이트 틴트 3.99, 다크 솔리드(흰 글씨)
  2.89로 양쪽 다 미달한다. `--destructive`는 **삭제 버튼 등 파괴적 액션 전용**으로 남긴다.
  그래서 `--status-stale`이 따로 있다.

포커스 링은 shadcn 기본(`focus-visible:ring-ring/50 ring-[3px]`)을 유지한다. 테이블 행 전체가
링크면 링은 행에 건다. `outline-none`만 남기는 코드는 리뷰에서 반려한다.

### 2. 상태 표현 — 색 + 아이콘 + 텍스트 (셋 다 항상)

라벨 문자열은 `tickets.py list` 출력과 같은 말을 쓴다. CLI와 GUI가 다른 단어를 쓰면 안 된다.

**티켓 5상태**

| 상태 | 라벨 | 토큰 / 변종 | 아이콘 |
|---|---|---|---|
| open · 미할당 · deps 충족 | `대기` | shadcn `secondary` | `Circle` |
| open · unmet deps 있음 | `deps 대기` | `--status-blocked` | `Lock` |
| open · `session_id` 있음 | `할당됨` | `--status-assigned` | `CircleDot` |
| `.wip` | `진행중` | `--status-active` | `CirclePlay` |
| `.done` | `완료` | `--status-done` | `CircleCheck` |

**워커 4상태**

| status | 라벨 | 토큰 / 변종 | 아이콘 | 보조 문구 |
|---|---|---|---|---|
| `running` | `running` | `--status-active` | `Play` | 물고 있는 티켓 해시 |
| `idle` | `idle` | shadcn `secondary` | `Clock` | — |
| `stopped` | `stopped` | shadcn `outline` | `Power` | `crontab 미등록` |
| `stale` | `stale` | `--status-stale` | `TriangleAlert` | `다음 tick이 회수한다` |

`idle`과 `stopped`는 둘 다 중립이다 — 솔리드/아웃라인, 아이콘, 라벨 세 겹으로 구분된다.
`running`은 애니메이션하지 않는다(점 깜빡임 금지). 폴링으로 5초마다 다시 그리는 화면에서
움직이는 요소는 노이즈다.

**deps 배지** (보드 deps 컬럼·상세 관계 절):

- 충족: `outline` 배지 + `Check` + 해시
- 미충족: `--status-blocked` + `Lock` + 해시
- 큐에 없는 해시(오타 등): `--status-blocked` + `HelpCircle` + 해시 + 툴팁 `큐에 없는 해시 — 영구 대기`

### 3. 타이포 · 간격

**폰트.** 본문 Geist Sans, 등폭 Geist Mono — `create-next-app` 기본값이라 추가 작업이 0이다.
**한글 웹폰트는 로드하지 않는다.** 로컬 도구에 수백 KB 폰트를 받게 하지 않는다. 시스템 폰트로 떨어진다.

**크기 단계.** 이 5개 밖으로 나가지 않는다.

| 클래스 | 쓰는 곳 |
|---|---|
| `text-xs` (12px) | 상태 배지, 테이블 메타 컬럼(생성일·owner·pid), 보조 설명, 인라인 해시 |
| `text-sm` (14px) | **기본값** — 테이블 셀, 폼 라벨·입력, 버튼, 내비 |
| `text-base` (16px) | 티켓 본문 마크다운 원문, md 에디터 textarea |
| `text-lg` (18px) | 화면 제목 `h1`, 티켓 상세 title |
| `text-xl` (20px) | 없음. 쓰지 않는다 |

숫자·날짜 컬럼은 `tabular-nums`(자릿수가 흔들리면 스캔이 안 된다).

**테이블 밀도.** shadcn `Table` 기본 셀 패딩 `p-4`는 1440×900에서 12행밖에 안 들어간다 —
40~60건 큐를 한 화면에서 읽는다는 성공 기준을 못 맞춘다. **이것이 유일한 shadcn 오버라이드다.**

| | 값 |
|---|---|
| 헤더 행 | `h-9` (36px), `text-xs`, `font-medium`, `text-muted-foreground` |
| 본문 행 | `h-9` (36px), 셀 `px-3 py-0` |
| 행 구분 | `border-b border-border` (줄무늬 배경 없음) |
| hover | `bg-muted/50` |

**간격.** 4px 단위 중 `1 2 3 4 6 8`만 쓴다.

- 페이지 패딩 `px-6 py-6` · 섹션 간격 `space-y-6` · 폼 필드 간격 `space-y-4` · 인라인 갭 `gap-2`
- 카드 패딩 `p-4` · 칸반 컬럼 폭 `w-72`, 카드 간격 `space-y-2`
- 반경은 shadcn `--radius` 기본값 유지. 조정하지 않는다.

**monospace 사용처** (이 목록에 있으면 반드시 `font-mono`):

해시 · 파일/디렉터리 경로 · `session_id` · `owner` · pid · 환경변수 이름 · crontab 한 줄 ·
`runner.log` 테일 · 프로토콜/페르소나 에디터 · 티켓 본문 원문 · 에러 메시지 원문.

읽는 문장(설명·라벨·빈 상태 문구)에는 쓰지 않는다.

### 4. 레이아웃 셸

**상단 고정 바.** 사이드바를 쓰지 않는다 — 목적지가 4개뿐이고, 이 앱의 주력 화면은 컬럼 8개짜리
테이블이라 가로 240px이 사이드바보다 테이블에 더 값지다. shadcn `sidebar`는 부수 의존
컴포넌트가 5개 붙는데 그만큼의 값이 없다.

```
┌────────────────────────────────────────────────────────────────────┐
│ fs-tickets   보드  워커  페르소나  프로토콜        ~/Projects/…/.fs-tickets │  h-12, border-b, sticky
├────────────────────────────────────────────────────────────────────┤
│ px-6 py-6                                                          │
│   h1 (text-lg) + 화면별 액션 버튼 (우측 정렬)                          │
│   ───                                                              │
│   본문                                                              │
```

- 헤더 높이 `h-12`, `border-b`, `sticky top-0 z-50 bg-background`.
- 우측 큐 루트 경로: `text-xs font-mono text-muted-foreground`, `truncate max-w-xs`, 툴팁 전문.
  **어느 큐를 보고 있는지가 항상 화면에 있어야 한다.**
- 활성 링크: `text-foreground` + 하단 2px `border-primary`. 비활성 `text-muted-foreground`.
- 본문 최대 폭 제한 없음(테이블이 넓다). 단 **폼·에디터 화면은 `max-w-3xl`** — 100자 넘는
  입력 줄은 읽히지 않는다.

**6개 화면 진입 구조**

| 화면 | 경로 | 진입 |
|---|---|---|
| 보드 | `/` | 내비 `보드` |
| 티켓 상세 | `/tickets/[hash]` | 보드 행/카드 클릭, deps 배지 클릭 |
| 티켓 발행 | `/tickets/new` | 보드 우상단 `티켓 발행` 버튼, 빈 상태 버튼 |
| 워커 | `/workers` | 내비 `워커`, 티켓 상세의 owner 클릭 |
| 페르소나 | `/personas` | 내비 `페르소나`, 티켓의 persona 배지 클릭 |
| 프로토콜 | `/protocols` | 내비 `프로토콜` |

뒤로가기가 항상 동작해야 한다(필터·검색·뷰 토글이 URL에 있으므로 공짜다).

### 5. 컴포넌트 인벤토리

```
pnpm dlx shadcn@latest add alert alert-dialog badge button card command dialog \
  input label popover select skeleton sonner table textarea tooltip
```

| 컴포넌트 | 쓰는 곳 |
|---|---|
| `table` | 보드 테이블 |
| `badge` | 상태·kind·persona·deps 배지 |
| `button` | 전부 |
| `card` | 칸반 카드, 워커 목록 행 |
| `input` `label` `textarea` `select` | 티켓 발행, 페르소나·프로토콜 에디터, 워커 생성 |
| `command` + `popover` | deps 멀티셀렉트(자유 입력 금지 → 검색 가능한 선택), 필터 다중 선택 |
| `dialog` | 워커 생성, crontab 명령 안내 |
| `alert-dialog` | 삭제 확인(티켓·워커·페르소나·프로토콜 파일) |
| `alert` | 인라인 에러, `.wip` 잠금 안내, 프로필 없는 persona 경고 |
| `tooltip` | 잘린 텍스트 전문, stale 설명, `AGENTS.md` 인라인 배지 설명 |
| `skeleton` | `loading.tsx` |
| `sonner` | 서버 액션 결과(할당 해제·저장·복사) |

**설치하지 않는 것과 이유**

| | 왜 |
|---|---|
| `sidebar` | 상단 바로 충분(§4). 부수 컴포넌트 5개가 딸려온다 |
| `tabs` | 테이블↔칸반은 URL 상태다. 링크 2개면 된다 |
| `dropdown-menu` | 행 액션 메뉴 없음. 행 클릭 = 상세 |
| `separator` | `border-t` 한 줄 |
| `scroll-area` | 네이티브 스크롤로 충분 |
| `checkbox` | 다중 선택은 `command` 항목 내부 체크 아이콘으로 |

**커스텀 5개** — shadcn 기본이 부족한 이유를 한 줄로 남긴다.

| 컴포넌트 | 왜 커스텀인가 |
|---|---|
| `<StatusBadge state>` | Badge 변종 4개로 9개 상태를 못 담는다. Badge를 감싸 `data-status`로 토큰·아이콘·라벨을 한 곳에서 결정 — 상태 표현이 갈라지는 걸 구조적으로 막는다 |
| `<Hash hash>` | mono + 링크 + 클릭 복사. 6개 화면 전부에 나오는데 매번 다시 쓸 이유가 없다 |
| `<EmptyState>` | shadcn에 없다. §6의 빈/0건 문구 규칙을 한 컴포넌트가 강제한다 |
| `<CopyCommand cmd>` | 제약 4가 요구하는 것 — 실행 대신 복사시키는 mono 블록 + 복사 버튼 |
| 밀도 오버라이드 | §3. shadcn Table 기본 패딩이 밀도 목표를 못 맞춘다 |

### 6. 다섯 상태

**빈 상태.** `<EmptyState>` — 한 줄 설명 + 1차 액션 버튼 1개. 일러스트·아이콘 없다.

| 화면 | 문구 | 액션 |
|---|---|---|
| 보드 | `열린 티켓 없음` | `티켓 발행` |
| 워커 | `워커 없음 — 큐가 돌지 않는다` | `워커 생성` |
| 페르소나 | `페르소나 없음` | `페르소나 생성` |
| 프로토콜 | `파일 없음` | `새 파일` |
| 티켓 상세 관계 | `막고 있는 것 없음` / `이 티켓이 막는 것 없음` | — |

**로딩.** 라우트 `loading.tsx`에 **실제 레이아웃과 같은 모양의 Skeleton**(테이블은 8행,
행 높이 `h-9` 동일). 스피너 금지 — 레이아웃이 점프한다.

- **5초 폴링 갱신 중에는 아무 로딩 표시도 내지 않는다.** 5초마다 깜빡이는 화면은 못 읽는다.
- 서버 액션 진행 중에는 그 버튼만 `disabled` + 라벨을 `할당 해제 중…`처럼 바꾼다. 전면 오버레이 없다.

**에러.** `error.tsx` + `alert variant="destructive"`. 반드시 3요소:

1. 무엇이 실패했는지 (`워커 w2 삭제 실패`)
2. 원인 원문 — `font-mono text-xs` 블록. 삼키지 않는다
3. 다음 행동 — `다시 시도` 버튼, 또는 사람이 손으로 칠 명령어(`<CopyCommand>`)

`문제가 발생했습니다` 같은 문구는 금지다. 이 앱을 쓰는 사람은 원인을 보고 고칠 수 있는 사람이다.

**텍스트 잘림.**

- **식별자는 자르지 않는다** — 해시·경로·pid. 잘린 해시는 쓸모가 없다. 컨테이너를 넓히거나
  가로 스크롤시킨다.
- `session_id`(UUID 36자)는 테이블 컬럼에 넣지 않는다. 상세 frontmatter 표에서만 전문 표시.
- title은 테이블에서 `truncate`(1줄) + 툴팁 전문. 칸반 카드는 `line-clamp-2`.
- owner·경로는 `truncate` + 툴팁 전문.
- 본문 미리보기는 어디에도 넣지 않는다. 읽으려면 상세로 간다.

**필터 0건.** 빈 큐와 **다른 문구**를 쓴다(원인이 다르다).

```
조건에 맞는 티켓 0건
[kind: work ×] [persona: qa ×]        ← 적용된 필터를 배지로, 각각 개별 해제
[필터 초기화]
```

검색어가 있으면 `"<검색어>"와 일치하는 티켓 0건`. 테이블 헤더는 남긴다(컬럼이 사라지면
필터를 지운 건지 데이터가 없는 건지 구분이 안 된다).

## 결정 기록

- **읽기를 TS로 다시 쓰는 이유**: 본문·임의 frontmatter가 필요한데 `tickets.py list`의 출력은
  요약 한 줄이라 정보가 없다. 대신 판정이 갈릴 위험을 패리티 테스트로 산다.
- **쓰기 중 상태 전이만 위임하는 이유**: claim의 원자성은 `os.link`/`O_EXCL` 한 시스템콜 안에
  있다. 두 언어로 구현하면 두 곳에서 틀린다. 새 파일 생성은 해시가 유일해서 경합이 없으므로 직접 쓴다.
- **칸반 드래그를 넣지 않는 이유**: 상태 전이의 주체는 엔진과 티켓 수행 세션이다. 사람이 UI에서
  `.wip`으로 끌면 세션 없이 잡힌 티켓(생존 신호 없는 좀비)이 생긴다. reap이 못 잡는다.
- **deps를 자유 입력하지 않는 이유**: 오타 해시는 `deps_unmet`이 보수적으로 미충족 처리해
  **영구 대기**가 된다. 조용히 굶는 실패 모드라 입력 단계에서 구조적으로 막는다.
- **루트 스위처를 안 만드는 이유**: 큐가 하나다. 두 번째가 생기면 그때 만든다.
