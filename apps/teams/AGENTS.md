# apps/teams/ 코드베이스 규약

dira 큐를 보는 로컬 웹 UI. **스펙은 `../docs/DESIGN.md`가 단일 출처**다.
여기 있는 건 코드 규약뿐이다. 스펙과 다르게 만들고 싶으면 `kind: feedback` 티켓을 올린다.

## 구조

```
apps/teams/
  app/                  App Router. fs 접근은 전부 여기(서버) 아니면 lib/
    layout.tsx          html·폰트·TooltipProvider + **키맵을 읽는 유일한 곳**(§0-6 배선 —
                        두 셸이 다 이 아래고 파일 하나짜리 읽기다. 셸마다 읽지 않는다)
    (list)/page.tsx     프로젝트 목록·등록 (`/`). 라우트 그룹이라 URL은 `/`다
    (list)/loading.tsx  이 그룹만 덮는다 — app/ 최상단에 두면 모든 라우트가 즉시 스트리밍돼
                        레이아웃의 notFound()가 404 상태를 못 세운다(실측)
    not-found.tsx       404. `p/[project]/layout.tsx`의 notFound()를 받는 경계가 여기다
    api/awaiting/       유일한 API 라우트. **화면이 쓰지 않는다** — Electron main이 답변 대기를
                        물어보는 창구다(DESIGN.md §데스크톱 앱 N2 · 못박는 것 5). 판정은
                        `lib/queue.ts`의 `isAwaiting` 하나고 여기서 다시 쓰지 않는다.
                        화면이 필요한 데이터는 종전대로 서버 컴포넌트가 `lib/`를 직접 부른다
    actions.ts          Server Action (프로젝트 등록·이름·순서·해제·재해석). 큐 파일은 안 건드린다
    p/[project]/         프로젝트 스코프. layout.tsx가 셸(헤더·내비·전환기)
    p/[project]/(board)/ 보드(`/p/<project>`). 라우트 그룹이라 URL은 그대로다.
                        loading.tsx(테이블 스켈레톤)를 **보드에만** 걸려고 감쌌다 —
                        `p/[project]/loading.tsx`면 워커·페르소나·프로토콜에도 표가 뜬다.
                        **이 그룹의 loading.tsx는 notFound() 경로에 영향이 없다**(A/B 실측 —
                        아래 §notFound()와 빈 SSR). 404가 백지면 여기를 의심하지 않는다
                        큐 파일을 건드리는 Server Action은 그 화면 폴더에 둔다
                        (`workers/actions.ts`·`tickets/[hash]/actions.ts`·`(board)/actions.ts`·
                        `protocols/actions.ts`). 발행·요구 접수는 **라우트가 아니라 보드의
                        다이얼로그**라 `createTicket`이 `(board)/`에 산다(DESIGN.md §3).
                        클라이언트에서 `@/app/p/[project]/…/actions`로 그냥 import된다
    globals.css         Tailwind v4 + shadcn 토큰. 색은 여기서만 정의한다
  lib/
    projects.ts          프로젝트 레지스트리 읽기·쓰기, 검증, 설정 해석, 목록 요약,
                        페르소나 CRUD (기준 디렉터리가 `resolveConfig().personas`라 여기 있다)
                        + **키맵 파일 3함수**(`keymapPath`·`readKeymap`·`writeKeymap`, §0-6).
                        `keymap.ts`가 아니라 여기 있는 이유는 그 파일 머리 주석에 있다 —
                        저기는 클라이언트 번들로 가고, 이 셋이 필요한 건 `registryPath()`뿐이다
    keymap.ts           키맵 코어 (§0-6): `DEFAULT_KEYMAP`(액션 8개) · `matchCombo` ·
                        `formatCombo` · `validateBinding`. **`node:*` import 금지** —
                        키를 듣는 것도 그리는 것도 클라이언트 컴포넌트다(`urls.ts`와 같은 축).
                        화면에 키를 적는 코드는 `formatCombo` 하나만 쓴다
    urls.ts             슬러그·전환 경로·`~` 축약·배지 경과 접미사·스트림 폼 모드. **순수 함수만** —
                        클라이언트가 import한다(배지도 클라이언트 컴포넌트에 들어간다).
                        JSX는 `node --test`가 못 읽으므로 컴포넌트의 순수 판정은 여기서 검증한다
    paths.ts            경로 탈출 방어 (신뢰 경계) + 셸 값 해석(`shellValue` — projects·workers 공용)
    queue.ts            티켓 읽기 코어 (tickets.py 미러). 프로젝트를 인자로 받는다
    workers.ts          워커 파일·락·crontab 판정, TICKET_CONTEXT 블록 파싱·치환
    protocols.ts        프로토콜 파일트리·읽기·쓰기. 기준은 **해석된 TICKET_PROTOCOLS**(루트 아니다)
    scaffold.ts         새 프로젝트 스캐폴딩 (DESIGN.md §0-3). **등록되지 않은 경로에 파일을 쓰는
                        유일한 곳** — 경계가 파일 목록 자체고 전부 `wx`다(있는 파일은 안 덮는다)
    engine.ts           엔진 서브프로세스 호출 (워커 `reap`·`unassign` · `tickets.py find`)
    transcript.ts       세션 스트림(§2-1) 읽기 코어. 트랜스크립트 경로 찾기 · 바이트 오프셋 테일 ·
                        jsonl 레코드 → 사건 매핑. **root 밖(`~/.claude/projects`)을 읽는 유일한 곳** —
                        방어는 `session_id` UUID 정규식 하나다(사람 입력을 받지 않는다)
    interject.ts        참견 보내기(§2-2). 티켓 fm의 `inbox:` FIFO에 JSON 한 줄. **읽는 쪽이
                        `transcript.ts`인 것과 짝**이라 그쪽에 안 얹었다 — 저긴 순수 읽기 코어고
                        여긴 유일한 쓰기다. `O_WRONLY|O_NONBLOCK`이 이 파일의 존재 이유고
                        (없으면 Server Action이 영영 안 끝난다) 실패 사유를 갈라서 돌려준다
    followup.ts         이어받기(§2-2 완료 티켓의 참견). 완료 티켓 + 참견 → **새 열린 티켓 한 장**.
                        `interject.ts`와 **짝이고 한 파일이 아니다**: 저긴 FIFO에 쓰고 티켓 파일을
                        안 건드리고, 여긴 큐에 파일을 만들고 FIFO를 모른다. 모드 판정이 반대
                        방향(`.done` / `.wip`)이라 합치면 한 함수가 두 계약을 들게 된다.
                        해시·`O_EXCL`·10회 재시도는 `createTicket`과 **같은 코드가 두 벌**이다
                        (`"use server"` 파일에서 import 못 한다 — 그쪽 머리 주석이 같은 대가를 적는다)
    auth.ts             Claude 장기 토큰 경로·상태·저장 + `claude setup-token` pty 드라이버
                        (DESIGN.md §0-4). 엔진 계약을 **따라 쓸 뿐**이다(`tick.sh:52-54` —
                        개행 없는 한 줄 · 0600). `.authwarn`은 안 건드린다. 드라이버는 `script`로
                        pty를 주고(네이티브 모듈 0) 세션이 하나뿐인 모듈 상태다 — 왜 `cat |`이고
                        왜 종료를 pty 안 표식으로 아는지는 그 파일 주석에 실측과 함께 있다
    utils.ts            shadcn cn() — 건드리지 않는다
    *.test.ts           node --test
  components/           손으로 만드는 컴포넌트 (DESIGN.md §5 커스텀)
    status-badge.tsx    상태 표현의 유일한 출처 (티켓 5 · 워커 4 · 연결 2) + deps 배지
    worker-mark.tsx     `.wip` 워커 마크의 유일한 출처 (§비주얼 §19). 자리가 셋이고
                        (칸반 카드 · 테이블 `owner` 셀 · 상세 잠금 `Alert`) 클래스 문자열이
                        셋에서 같아야 한다. **`status-badge.tsx`에 못 얹는 이유**: 그 파일은
                        클라이언트 컴포넌트가 import해서 번들로 가는데 여기는 `workerOf`
                        (= `lib/workers.ts`, `node:fs`)가 필요하다. 부르는 곳은 서버 페이지 둘뿐
    persona-badge.tsx   persona 값 표시의 유일한 출처 (점+이름 배지 · 점만 그리는 모드).
                        색은 레지스트리에 있고 자리가 5곳이다 — 조회를 자리마다 다시 쓰면
                        어느 화면 하나가 조용히 색 없이 남는다. 팔레트 표는 `lib/urls.ts`
    keymap-provider.tsx 서버가 읽은 키맵을 클라이언트로 나르는 통로 (§0-6 배선):
                        `KeymapProvider`(`useContext` 하나) · `useKeymap()` ·
                        **`useHotkey()`**. 전역 키를 거는 코드는 이 훅만 쓴다 — 글 쓰는 중
                        가드(`lib/keymap.ts`의 `shouldFire`)를 자리마다 다시 짜면 어느 한 곳이
                        조용히 검색 칸을 먹는다. **새 파일인 이유**: 쓰는 곳이 셸 · 티켓 상세 ·
                        설정 다이얼로그 셋이라 어디에 얹어도 나머지 둘이 그 파일을 import한다
    project-switcher.tsx 전환기 · 내비 · 다시 확인 (셸의 클라이언트 조각) + **브랜드 마크**
                        (§비주얼 §14). 마크는 두 셸(`p/[project]/layout.tsx` · `(list)/page.tsx`)이
                        같이 쓰고 `href`만 다르다 — 셸마다 인라인하면 §14가 2벌로 고정한 사본이
                        3벌이 된다. 새 파일 대신 여기 둔 이유는 아래 "새 파일을 늘리지 않는다"
    settings-dialog.tsx `설정` 다이얼로그(§0-4) + 그것을 여는 트리거. **두 셸 헤더 우측 끝과
                        프로젝트 셸 인증 배너 CTA가 같이 쓴다** — 자리가 둘이라 어느 한쪽에
                        인라인하면 그때부터 두 벌이다. 트리거를 JSX로 안 받고 `icon`·`link`
                        두 값으로 받는 이유: 배너 쪽 호출자가 **서버 컴포넌트**다
    projects-ui.tsx      등록 폼 · 해석 결과 표 · **목록 표** · 행 액션 (`/`의 클라이언트 조각).
                        목록 표가 서버가 아니라 여기 있는 이유는 `<ProjectRows>` 주석에 있다
                        (`955a8237`: 서버가 행 엘리먼트를 그리면 순서 변경이 화면에 안 붙는다)
    ticket-ui.tsx       편집 폼 · 할당 해제 · 삭제 · 답변 카드 + **보드의 발행 · 요구 접수
                        다이얼로그**(§3 — 라우트가 아니다. 트리거가 보드에 산다)
    personas-ui.tsx     생성 · PROFILE.md 편집 · 삭제 (페르소나 화면의 클라이언트 조각)
    protocols-ui.tsx    md 에디터 · 새 파일 · 이름변경 · 삭제 (프로토콜의 클라이언트 조각)
    session-stream.tsx  세션 스트림(§2-1 · §비주얼 §9). 2초 폴링 + 자동 스크롤 + 네이티브 <details>.
                        읽기·파싱은 전부 lib/transcript.ts고 여기는 그리기만 한다.
                        **참견 입력 form(§2-2 · §비주얼 §21)도 여기 있다** — 상자 밖·밑. 이 파일
                        하나에 다니까 티켓 상세와 워커 다이얼로그가 같은 폼을 그린다(§2-1 Q2=(a)).
                        **그 칸은 모드가 둘이다**: `.wip`이면 참견(`lib/interject.ts` → FIFO),
                        `.done`이면 이어받기(`lib/followup.ts` → 새 열린 티켓 + 그 상세로 이동).
                        모드를 고르는 판정은 `lib/urls.ts`의 `interjectMode` 하나고 보내도 되는지는
                        **서버가 파일을 다시 읽어** 판정한다(어긋나면 실패 + 사유). 폼은 **낙관적
                        에코를 그리지 않는다**: 보낸 문장은 다음 폴링의 `enqueue` 줄로 돌아온다
    markdown.tsx        읽기 전용 마크다운 렌더(§비주얼 §10). **왕복 스레드와 `.wip` 본문의
                        유일한 출처** — 편집기는 종전대로 원문이다. 자리별 오버라이드 없음
    copy-command.tsx    실행 대신 복사시키는 명령 블록
  components/ui/        shadcn CLI 산출물. 손으로 만들지 않는다.
                        **예외 1건: `alert.tsx` 기본 변종에서 `*:[svg]:text-current`를 뺐다**
                        (`b532bf8b`). 그게 아이콘의 `text-status-*`를 21곳 전부에서 덮어
                        §비주얼 §2의 색 겹이 죽어 있었다. `shadcn add alert`를 다시 돌리면
                        되살아난다 — 돌린 뒤 그 한 조각만 다시 뺀다
  components.json       shadcn 설정
```

`lib/`의 파일 목록은 DESIGN.md §아키텍처가 정한 것이다. **새 파일을 늘리지 않는다** —
300줄짜리 `queue.ts` 하나가 50줄짜리 6개보다 낫다. 위에 없는 파일을 만들려면 티켓에 이유를 적는다.

**`node:*`를 import하는 모듈은 클라이언트 컴포넌트에서 import하지 못한다.** 그래서 슬러그·전환
경로처럼 **양쪽이 같은 규칙을 써야 하는 순수 함수는 `lib/urls.ts`에** 둔다. 여기에 `node:*`
import을 추가하면 등록 폼과 전환기가 빌드에서 깨진다.

## `notFound()`와 빈 SSR

`notFound()`가 그리는 화면은 **SSR HTML이 비어 온다.** `/p/<없는id>`의 응답은 27,887바이트인데
렌더된 엘리먼트가 0개다(`<main>` 0 · `<h1>` 0, `<body>`는 `<div hidden><!--$--><!--/$--></div>`
하나). 404 본문은 flight 페이로드 안에만 있고 하이드레이션이 채운다. 응답 끝에 셸이 abort된 흔적
(`NEXT_HTTP_ERROR_FALLBACK;404`)이 남는다 — Next 16의 동적 라우트 + `notFound()` 동작이다.

**나머지 화면은 전부 서버 렌더된다.** 그래서 JS가 안 돌면 404 화면만 백지다(실측):

| JS 끄고 로드 | 본문 |
|---|---|
| `/p/nope` · `/p/<t>/tickets/<없는해시>` | 백지 (HTTP 404는 정상으로 선다) |
| `/nosuchpage` | 정상 — 정적 프리렌더 `/_not-found`(빌드 출력 `○`)라 JS가 필요 없다 |
| `/p/dira` 등 | 정상 — 서버 HTML을 낸다 |

함정 셋:

- **`curl`로 404 화면을 판정하지 않는다.** SSR HTML은 원래 비어 있어서 항상 "깨졌다"로 보인다.
  판정은 **하이드레이션 후 DOM**으로 한다(헤드리스 Chrome + CDP `Runtime.evaluate`).
- **경계를 옮겨서 못 고친다**(실측). `(board)/loading.tsx`를 빼도, `app/p/[project]/not-found.tsx`를
  더해도, `global-not-found`를 켜도 SSR HTML은 여전히 `<main>` 0개다. 스켈레톤 위치는 무관하다.
- **"라우트 미스는 멀쩡한데 `notFound()`만 백지"는 앱 회귀가 아니라 JS가 안 돌았다는 신호다.**
  서버가 새 빌드로 안 올라갔거나 청크 로드가 실패한 쪽을 먼저 본다. 이 비대칭을 회귀로
  오귀속하는 데 세션 하나를 썼다(`1c9de45f`).

**왜 안 고치나** — `bb21be0a` wontfix(사람 결정 2026-07-30). 원인이 Next 소스에 있다:
`server/app-render/app-render.js`의 `getErrorRSCPayload`가 런타임 dynamic 요청의 `notFound()`에서
루트 레이아웃을 `<html id="__next_error__">` + 빈 `<body>`로 **갈아치운다**. `renderToStream`의
catch가 무조건 그 경로라 파일 배치로는 못 고친다(위 둘째 함정의 근거다. 응답의
`id="__next_error__"`가 표식이다). 되는 길은 렌더 전에 정적 `/_not-found`로 rewrite하는 `proxy.ts`
하나뿐인데, 재보니 티켓 상세가 **요청당 +68ms(+69%)**이고(`proxy`와 페이지가 `tickets.py find`를
각각 부른다) 404 판정이 두 곳으로 갈린다. **JS를 끄면 `/`도 스켈레톤에 고정되므로** 고쳐도
"JS 없이 되는 앱"이 되지 않는다 — 제일 많이 여는 화면을 느리게 할 값이 없다.
프로토타입·실측은 `bb21be0a.done.md` §3~5에 있다.

## 명령

| | |
|---|---|
| `pnpm dev` | 개발 서버 (localhost:7331, `PORT=...`로 덮어쓴다) |
| `pnpm build` | 프로덕션 빌드 + 타입체크. **티켓 완료 전에 반드시 통과** |
| `pnpm test` | `node --test "lib/**/*.test.ts"` |
| `pnpm lint` | eslint |

`pnpm build`가 타입체크를 겸한다. 따로 `tsc`를 돌리지 않는다.

## 규칙

**fs 접근은 전부 서버.** Server Component / Server Action / `lib/`. 클라이언트 컴포넌트에서
`node:fs`를 import하는 코드는 리뷰에서 되돌린다.

**런타임은 nodejs.** App Router 기본값이다. `export const runtime = 'edge'`를 쓰지 않는다
(fs가 필요하다). 기본값이므로 라우트마다 `runtime = 'nodejs'`를 적지도 않는다 — 노이즈다.

**클라이언트 상태 라이브러리 없음.** zustand·jotai·redux·tanstack-query 다 안 쓴다.
필터·검색·뷰 전환은 URL `searchParams`가 담는다(공유·새로고침 공짜). 서버 데이터는
Server Component가 읽고, 갱신은 Server Action → `revalidatePath`다.

**링크·URL·엔진 인자는 `Ticket.stem`이다.** `Ticket.hash`는 **화면 표시값**이다
(`fm.ticket || 파일명`). 엔진 조회(`tickets.py find` → `find_any`)는 파일명만 보므로 표시값을
URL·엔진에 실으면 `ticket:`이 파일명과 갈린 티켓에서 상세가 404가 되거나 `unassign`만
`티켓을 못 찾음`으로 실패한다. `stem`은 `listTickets`가 한 번 만든다 — 호출부에서 basename을
쪼개지 않는다. 규칙은 DESIGN.md §데이터 모델 > 식별자다.

**신뢰 경계는 게으르지 않는다.** 사용자 입력이 파일 경로가 되는 지점(티켓 해시·워커 이름·
페르소나 이름·프로토콜 경로)은 **서버에서** 검증한다. 클라이언트 검증은 검증이 아니다.
규칙은 DESIGN.md §루트 확정 + 경로 방어에 있다. 경로를 문자열로 조립하지 말고
`tickets.py find`로 얻거나 `fs.realpath` 후 루트 접두를 확인한다.

**엔진은 읽기 전용.** `../tick.sh`·`../tickets.py`·`../test_*.py`를 수정하지 않는다.
상태 전이(claim·unassign·reap)는 TS로 다시 구현하지 않고 `workers/<w>.sh`를 서브프로세스로 부른다.
`.wip` 티켓 파일은 쓰지 않는다 — 그 파일로 지금 세션이 일하고 있다.

**의존성 추가는 티켓에 근거를 적는다.** 무엇이 없어서 필요했는지, 몇 줄을 대체했는지.
표준 라이브러리 → 플랫폼 기능 → 이미 설치된 것 → 그 다음이 새 패키지다.
YAML 파서는 특히 금지다 — `tickets.py`가 정규식이라 파서를 쓰면 판정이 갈린다.

**shadcn 기본값을 이기려 하지 않는다.** 컴포넌트는 `pnpm dlx shadcn@latest add <이름>`으로
받는다. 색은 `globals.css`의 시맨틱 토큰(`bg-background`·`text-muted-foreground`)만 쓴다.
`bg-zinc-50` 같은 원시값이나 손으로 쓴 `dark:` 색 오버라이드는 라이트/다크가 갈린다.

**의도한 단순화는 `// ponytail:` 주석으로 천장과 업그레이드 경로를 적는다.**
예: `// ponytail: 전체 재스캔. 티켓 수천 건 되면 mtime 캐시`.

## 검증

비자명한 로직(파서·경로 처리·상태 판정)은 `lib/*.test.ts`에 **돌아가는 검증 하나**를 남긴다.
프레임워크는 추가하지 않는다 — Node 25가 `.ts`를 직접 실행하므로 `node:test` + `node:assert`로 끝난다.

```ts
import { test } from "node:test";
import assert from "node:assert";
import { listTickets } from "./queue.ts";   // lib 안에서는 확장자 `.ts`를 붙인다
```

**`lib/` 내부 상대 import는 확장자 `.ts`를 붙인다.** Node의 타입 스트리핑이 실제 파일을 찾기
때문이고(`tsconfig`의 `allowImportingTsExtensions`가 이걸 허용한다), 안 붙이면 `pnpm test`가
모듈을 못 찾는다. 앱 코드에서 `lib/`를 부를 때는 종전대로 `@/lib/queue`다.
**타입만 가져올 때는 `import type`을 쓴다** — 안 쓰면 런타임에 없는 바인딩을 import해서 터진다.

`lib/queue.ts`는 `tickets.py`와 판정이 같아야 한다(NFC 정규화, 상태 접미사, `deps` 두 문법,
미할당 판정). 눈으로 맞추지 말고 **패리티 테스트**로 못박는다 — 같은 픽스처 큐에 대해
`python3 tickets.py list`와 TS 결과를 비교한다.

## 의존성 근거

스캐폴드가 넣은 것 전부. 여기 없는 패키지가 `package.json`에 있으면 회귀다.

| 패키지 | 왜 |
|---|---|
| `next`·`react`·`react-dom` | 스택 |
| `typescript`·`@types/*`·`eslint`·`eslint-config-next` | 스택 |
| `tailwindcss`·`@tailwindcss/postcss` | 스택 |
| `shadcn` | CLI 겸 **런타임 CSS**. `globals.css`가 `@import "shadcn/tailwind.css"`로 읽는다 |
| `@base-ui/react`·`class-variance-authority`·`clsx`·`tailwind-merge`·`tw-animate-css` | shadcn 컴포넌트가 직접 import |
| `lucide-react` | `components.json`의 `iconLibrary`. shadcn 기본 |
| `react-markdown` | 읽기 전용 마크다운 렌더(`components/markdown.tsx` · DESIGN.md §비주얼 §10). 파서 + AST + React 매핑을 직접 쓰면 수백 줄이다. **기본값이 raw HTML 무시**라 새니타이저를 따로 안 들인다(`rehype-raw`를 켜지 않는 근거) — 티켓 본문은 세션이 쓰는 파일이라 HTML이 섞일 수 있다. `marked` + `dangerouslySetInnerHTML`은 그 이유로 거절했다 |
| `remark-gfm` | 이 큐의 본문이 표와 체크리스트(`- [ ]`)로 가득한데 CommonMark에 둘 다 없다. `react-markdown`이 GFM을 기본으로 안 켠다 |
| `cmdk` | shadcn `command`가 직접 import. DESIGN.md §5가 전환기·deps 멀티셀렉트·필터를 `command`로 정한 것의 대가다(검색·키보드 이동·필터링을 직접 쓰면 수백 줄). `add command`가 끌고 왔다 |
