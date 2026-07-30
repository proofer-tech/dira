# gui/ 코드베이스 규약

fs-tickets 큐를 보는 로컬 웹 UI. **스펙은 `../docs/DESIGN.md`가 단일 출처**다.
여기 있는 건 코드 규약뿐이다. 스펙과 다르게 만들고 싶으면 `kind: feedback` 티켓을 올린다.

## 구조

```
gui/
  app/                  App Router. fs 접근은 전부 여기(서버) 아니면 lib/
    layout.tsx          html·폰트·TooltipProvider
    (list)/page.tsx     테넌트 목록·등록 (`/`). 라우트 그룹이라 URL은 `/`다
    (list)/loading.tsx  이 그룹만 덮는다 — app/ 최상단에 두면 모든 라우트가 즉시 스트리밍돼
                        레이아웃의 notFound()가 404 상태를 못 세운다(실측)
    not-found.tsx       404. `t/[tenant]/layout.tsx`의 notFound()를 받는 경계가 여기다
    actions.ts          Server Action (테넌트 등록·이름·순서·해제·재해석). 큐 파일은 안 건드린다
    t/[tenant]/         테넌트 스코프. layout.tsx가 셸(헤더·내비·전환기)
                        큐 파일을 건드리는 Server Action은 그 화면 폴더에 둔다
                        (`workers/actions.ts`·`tickets/[hash]/actions.ts`).
                        클라이언트에서 `@/app/t/[tenant]/…/actions`로 그냥 import된다
    globals.css         Tailwind v4 + shadcn 토큰. 색은 여기서만 정의한다
  lib/
    tenants.ts          테넌트 레지스트리 읽기·쓰기, 검증, 설정 해석, 목록 요약,
                        페르소나 CRUD (기준 디렉터리가 `resolveConfig().personas`라 여기 있다)
    urls.ts             슬러그·전환 경로·`~` 축약. **순수 함수만** — 클라이언트가 import한다
    paths.ts            경로 탈출 방어 (신뢰 경계) + 셸 값 해석(`shellValue` — tenants·workers 공용)
    queue.ts            티켓 읽기 코어 (tickets.py 미러). 테넌트를 인자로 받는다
    workers.ts          워커 파일·락·crontab 판정, TICKET_CONTEXT 블록 파싱·치환
    engine.ts           엔진 서브프로세스 호출 (워커 `reap`·`unassign` · `tickets.py find`)
    utils.ts            shadcn cn() — 건드리지 않는다
    *.test.ts           node --test
  components/           손으로 만드는 컴포넌트 (DESIGN.md §5 커스텀)
    status-badge.tsx    상태 표현의 유일한 출처 (티켓 5 · 워커 4 · 연결 2) + deps 배지
    tenant-switcher.tsx 전환기 · 내비 · 다시 확인 (셸의 클라이언트 조각)
    tenants-ui.tsx      등록 폼 · 해석 결과 표 · 행 액션 (`/`의 클라이언트 조각)
    ticket-ui.tsx       편집 폼 · 할당 해제 · 삭제 (티켓 상세의 클라이언트 조각)
    personas-ui.tsx     생성 · PROFILE.md 편집 · 삭제 (페르소나 화면의 클라이언트 조각)
    copy-command.tsx    실행 대신 복사시키는 명령 블록
  components/ui/        shadcn CLI 산출물. 손으로 만들지 않는다
  components.json       shadcn 설정
```

`lib/`의 파일 목록은 DESIGN.md §아키텍처가 정한 것이다. **새 파일을 늘리지 않는다** —
300줄짜리 `queue.ts` 하나가 50줄짜리 6개보다 낫다. 위에 없는 파일을 만들려면 티켓에 이유를 적는다.

**`node:*`를 import하는 모듈은 클라이언트 컴포넌트에서 import하지 못한다.** 그래서 슬러그·전환
경로처럼 **양쪽이 같은 규칙을 써야 하는 순수 함수는 `lib/urls.ts`에** 둔다. 여기에 `node:*`
import을 추가하면 등록 폼과 전환기가 빌드에서 깨진다.

## 명령

| | |
|---|---|
| `pnpm dev` | 개발 서버 (localhost:3000) |
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
| `cmdk` | shadcn `command`가 직접 import. DESIGN.md §5가 전환기·deps 멀티셀렉트·필터를 `command`로 정한 것의 대가다(검색·키보드 이동·필터링을 직접 쓰면 수백 줄). `add command`가 끌고 왔다 |
