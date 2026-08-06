/** 클라이언트와 서버가 **같은 규칙을 써야 하는** 순수 헬퍼(대부분 URL).
 *
 *  `projects.ts`에 두지 못하는 이유는 하나다: 그 파일은 `node:fs`를 import하므로 클라이언트
 *  번들에 들어갈 수 없다. 등록 폼은 입력하는 동안 슬러그 미리보기를 보여주고(서버 왕복 없이),
 *  전환기는 브라우저에서 `usePathname()`으로 목적지를 만든다. 규칙이 갈리면 미리보기가
 *  거짓말을 하므로 함수는 한 곳에 둔다. **여기에 `node:*` import를 추가하지 않는다.** */

/** 이름 → URL 조각 (DESIGN.md §프로젝트 > `id` 슬러그 규칙).
 *  한글 이름이면 빈 문자열이 되는 게 정상이다 — 그때는 등록 폼이 id를 직접 받는다. */
export function slugify(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** 라우트 파라미터의 티켓 해시 → 실제 해시. Next는 세그먼트를 **퍼센트 인코딩된 원문으로**
 *  넘기므로(실측 16.2.12) 조회 전에 풀어야 한다 — 안 풀면 한글 해시가 전부 404다(a606dd0e).
 *
 *  인코딩이 깨진 URL(`%zz`)은 던지지 않고 원문을 돌려준다: 어차피 그 이름의 티켓은 없어서
 *  호출자가 404로 처리하고, 던지면 404여야 할 것이 500이 된다.
 *  ponytail: 해시에 `%`가 **글자로** 들어 있으면(`50%할인`) 링크로 왕복시킬 방법이 없다 —
 *  파일명에 `%`를 쓰는 큐가 나오면 그때 이중 인코딩을 고민한다. */
export function decodeHash(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 프로젝트 전환 목적지 — **같은 화면 종류를 유지한다**(DESIGN.md §0-1).
 *  `/p/a/workers` → `/p/b/workers`. 필터·검색 searchParams는 애초에 안 받는다
 *  (호출자가 `usePathname()`을 넘기므로 공짜로 버려진다 — 프로젝트마다 persona·kind 값이 다르다).
 *
 *  티켓 상세만 예외로 보드로 떨어뜨린다: 해시는 프로젝트마다 독립이라
 *  (DESIGN.md §데이터 모델) 옮겨 붙이면 남의 큐에 없는 티켓을 열어 404가 된다.
 *
 *  **페르소나 선택도 같은 예외다**(§5 §선택이 경로에 담긴다 ④): `/personas/<이름>`의 이름은
 *  프로젝트마다 독립이라 옮겨 붙이면 남의 큐에 없는 이름을 연다. 화면 종류는 유지되므로
 *  보드가 아니라 **`/personas`(선택 없음)로** 떨어진다 — 세그먼트는 명시 선택만 담는다. */
export function projectPath(pathname: string, id: string): string {
  const rest = /^\/p\/[^/]+(\/.*)?$/.exec(pathname)?.[1] ?? "";
  if (/^\/tickets\/(?!new(\/|$))./.test(rest)) return `/p/${id}`;
  if (/^\/personas\/./.test(rest)) return `/p/${id}/personas`;
  return `/p/${id}${rest === "/" ? "" : rest}`;
}

/** 화면의 **부모** — DESIGN.md §0-7 선언 표 6줄의 단일 출처. `Esc`가 여기로 올린다.
 *  `/`와 보드는 부모가 없다(`null`) — 보드의 부모는 `/`가 아니다. 프로젝트 밖으로 나가는 것은
 *  이 화면을 닫는 일이 아니라 다른 큐로 옮기는 일이고, 그 길은 전환기 하단 한 곳이다(§0-7).
 *  표에 없는 경로도 `null`이다 — 선언에 없는 화면에 부모를 지어내지 않는다.
 *
 *  **`projectPath()`와 합치지 않는다**(§0-7): 저쪽은 "프로젝트를 바꾸면 어느 화면인가"(같은
 *  화면 종류를 유지한다)이고 이쪽은 "위가 어디인가"다. 합치면 워커에서 프로젝트를 바꿀 때
 *  보드로 떨어져 §0-1이 깨진다. 겹치는 줄은 티켓 상세 하나뿐이다.
 *
 *  티켓 stem은 퍼센트 인코딩된 채로 온다(`decodeHash` 주석) — 목적지가 프로젝트 id뿐이라
 *  풀 필요가 없다. */
export function parentPath(pathname: string): string | null {
  const [, id, rest = ""] = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname) ?? [];
  if (!id) return null; // `/` · 모르는 경로
  return /^\/(tickets|workers|personas|protocols)(\/|$)/.test(rest) ? `/p/${id}` : null;
}

/** 사용 통계의 화면 enum (DESIGN.md §0-11 이벤트 표 `screen_view`). **`lib/analytics.ts`가
 *  이 타입을 가져다 쓴다** — 정의가 여기 있는 이유는 매핑(`screenOf`)이 `usePathname()`을 받는
 *  클라이언트 코드라서다(저 파일은 `node:fs`를 탄다). */
export type Screen = "root" | "board" | "ticket" | "workers" | "personas" | "protocols" | "home";

/** 경로 → 화면 enum. **`screen_view`가 보내는 값을 만드는 유일한 곳이다**(§0-11 익명 규칙):
 *  `/p/<project>/tickets/<hash>`는 프로젝트 이름과 티켓 해시를 둘 다 담으므로 URL은 안 나가고
 *  이 함수가 접은 enum 하나만 나간다.
 *
 *  **표에 없는 경로는 `null`이고 아무것도 안 보낸다** — 404·모르는 경로에 화면 이름을
 *  지어내면 통계에 없는 화면이 뜬다(`parentPath`가 표 밖을 `null`로 두는 것과 같은 규칙). */
export function screenOf(pathname: string): Screen | null {
  if (pathname === "/") return "root";
  const [, id, rest = ""] = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname) ?? [];
  if (!id) return null;
  if (rest === "" || rest === "/") return "board";
  // 없는 해시는 404로 떨어지지만 그 판정은 서버에 있다 — 클라이언트가 아는 것은 자리뿐이다.
  if (/^\/tickets\/./.test(rest)) return "ticket";
  // 페르소나는 선택이 경로에 담긴다(§5 §선택이 경로에 담긴다 ①) — 세그먼트가 더 붙어도 같은
  // 화면이다. **이름은 통계로 안 나간다**(§0-11 익명 규칙): 접힌 enum 하나가 그대로 나간다.
  if (/^\/personas(\/|$)/.test(rest)) return "personas";
  const seg = rest.slice(1);
  return seg === "workers" || seg === "protocols" || seg === "home" ? seg : null;
}

/** **N5의 찾기 바가 이 경로에 서나** (DESIGN.md §데스크톱 앱 N5). 보드·홈은 `⌘F`가 자기 일을
 *  하고(§0-6) 나머지 다섯은 이 바가 크롬 찾기 바를 대신한다 — `screenOf`가 이미 그 다섯을
 *  이름으로 갈라 놓아서 여기서 경로를 다시 파싱하지 않는다(두 벌이 되면 한쪽만 화면이 는다).
 *  **표 밖(`null` — 404·모르는 경로)에는 안 선다**: N5가 적은 자리가 그 다섯이다. */
export function hasFindBar(pathname: string): boolean {
  const s = screenOf(pathname);
  return s !== null && s !== "board" && s !== "home";
}

/** 배지의 경과 접미사 — `답변 대기 · 3일`의 ` · 3일` (DESIGN.md §비주얼 §2 경과 표시 표).
 *  **`0`이면 붙이지 않는다**: `· 0일`은 고장으로 읽힌다. `undefined`(경과를 안 주는 상태)와 같은 처리다.
 *  판정만 여기 있는 이유는 `pnpm test`가 JSX를 못 읽어서다 — `status-badge.tsx`에 두면 검증이 없다.
 *  이 파일이어야 하는 이유는 배지가 클라이언트 컴포넌트에도 들어가서다(`node:fs`를 못 끌고 온다). */
export const elapsedSuffix = (days?: number) => (days ? ` · ${days}일` : "");

/** 테이블 바디가 한 번에 그리는 행 수(§1 보드 §테이블 바디는 30행씩 그린다. 요구 `1208e64a`). */
export const ROW_PAGE = 30;

/** 표뷰가 **서버에서 그릴** 행 수 — `?rows=` 하나가 정한다(§성능 예산 §초과분 ②).
 *
 *  **서버와 클라이언트가 같은 수를 유도해야 한다**: 서버는 이 수만큼 잘라 그리고 바디는 이 수에
 *  30을 더해 다음 URL을 만든다. 자리마다 적으면 한쪽이 조용히 30행씩 밀린다.
 *
 *  **하한이 `ROW_PAGE`다.** 파라미터가 없는 정본 URL은 물론이고 `?rows=0`·`?rows=abc` 같은
 *  사람 입력도 전부 30행으로 떨어진다(`Number("")`가 0인 것도 여기서 같이 접힌다).
 *  상한은 두지 않는다 — 큰 값이면 전체를 그리는 종전 동작이고 그게 이 절이 고치려던 것의
 *  반대편일 뿐, 새 위험이 아니다(읽는 파일 수는 `rows`와 무관하다). */
export const rowLimit = (rows: string | null) => Math.max(ROW_PAGE, Number(rows) || 0);

/** 칸반 `완료` 레인이 그리는 카드 수(§1 보드 §완료 항, 요구 `79cad792`) — `?done=` 하나가 정한다.
 *  **`rowLimit`과 나란한 값이다**: 서버는 이 수만큼 자르고 레인 감시행은 이 수에 20을 더해
 *  다음 URL을 만든다. 하한도 같은 이유로 `DONE_LANE_LIMIT`이고 상한은 없다(큰 값이면 전체를
 *  그리는 것이고 그게 새 위험이 아니다 — `rowLimit` 주석과 같다). */
export const DONE_LANE_LIMIT = 20;
export const doneLimit = (done: string | null) => Math.max(DONE_LANE_LIMIT, Number(done) || 0);

/** 시각 한 칸 (DESIGN.md §비주얼 §26 ④) — **오늘 안이면 `HH:MM`, 다른 날이면 `M/D`.**
 *
 *  **24시간제**고 `toLocaleTimeString`을 안 쓴다: 로케일에 따라 `오후 5:40`이 나와 폭이 흔들린다
 *  (`session-stream.tsx`의 `localTime`과 같은 판단, 다만 초는 안 쓴다).
 *
 *  **쓰는 곳이 둘이다** — 사용량 리셋 시각(§26 ④, 서버 렌더)과 **홈 대화 목록의 만든 시각**
 *  (§비주얼 §24, 클라이언트 렌더). `lib/usage.ts`에 있던 `resetLabel`이 여기로 온 이유가 그것이다:
 *  저 파일은 `node:fs`를 import해서 클라이언트 번들에 못 들어간다(`elapsedSuffix`와 같은 축).
 *  §24가 대화 목록에 **"새 서식 0"**을 박았으므로 두 화면이 같은 함수를 쓴다. */
export function timeLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const p = (v: number) => String(v).padStart(2, "0");
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 셸 알림 종 ⑥(머신 복귀, §0-14 · §비주얼 §28)의 `<from>`·`<to>` 표기 — **같은 날이면
 *  `HH:MM`, 아니면 `M/D HH:MM`**. `timeLabel`을 그대로 못 쓰는 이유: 그 함수는 다른 날이면
 *  시각을 버려서(`M/D`만) 밤샘 복귀가 `8/5부터 09:12까지`가 된다 — 이쪽은 시각을 버리지 않는다.
 *  `from`·`to`는 **각각** 지금(렌더 시각) 기준으로 "같은 날"을 따로 재므로 한 이벤트 안에서도
 *  둘의 표기가 갈릴 수 있다(§비주얼 §28 ⑤). */
export function dateTimeLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const p = (v: number) => String(v).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/** 홈 대화 목록의 한 줄들 (§비주얼 §24 대화 목록) — **정렬 · 제목 · 시각이 여기서 끝난다.**
 *
 *  - **만든 시각 내림차순**(최근이 위). ISO 문자열이라 사전순이 곧 시간순이고, 옛 형식에서
 *    올라온 줄은 `created`가 빈 문자열이라 **맨 아래**로 간다(그 줄이 실제로 가장 오래된 것이다).
 *  - **제목이 없으면 `새 대화`.** `(제목 없음)`이 아니다 — 비어 있는 것이 정상이고, 방금 사람이
 *    누른 버튼의 이름이 그대로 그 줄의 정체다(§24).
 *  - 시각을 못 읽으면(옛 형식) **빈 칸**이다. 지어내지 않는다.
 *
 *  판정이 컴포넌트가 아니라 여기 있는 이유는 `elapsedSuffix`와 같다 — `pnpm test`가 JSX를 못 읽는다. */
export function chatRows(
  conversations: { id: string; title: string; created: string }[],
  now = Date.now(),
): { id: string; title: string; time: string }[] {
  return [...conversations]
    .sort((a, b) => b.created.localeCompare(a.created))
    .map((c) => {
      const at = Date.parse(c.created);
      return { id: c.id, title: c.title || "새 대화", time: Number.isNaN(at) ? "" : timeLabel(at, now) };
    });
}

/** 세션 스트림(§2-1)의 사건 줄을 **펼칠 수 있나** — 셰브런·`<details>`를 거는 유일한 판정.
 *  본문이 없으면 펼쳐도 빈 상자라 어포던스를 주지 않는다: `thinking` 본문은 암호화돼
 *  빈 문자열로 오는 게 전부다(실측 75/75). §2-1의 계약은 "펼치면 원문"이고, 원문이 없는 줄에서
 *  셰브런이 "여기 원문이 있다"고 말하면 그 계약이 그 줄에서만 거짓이 된다.
 *  `elapsedSuffix`와 같은 이유로 여기 산다 — `pnpm test`가 JSX를 못 읽고, 스트림은 클라이언트다. */
export const expandable = (e: { body: string }) => e.body !== "";

/** 기능 → **그 기능이 되는 엔진 이름 집합** (§4-3 §codex를 고르면 GUI 기능 둘이 죽는다, 표).
 *
 *  **`=== "codex"`로 적지 않는다**(§4-3 개정 2026-08-05, 요구 `390f788b`). 엔진이 둘일 때는
 *  *codex다* 와 *claude가 아니다* 가 같은 집합이라 판정이 전자로 적혀 있었고, 셋째 엔진이 서면
 *  그 둘이 갈린다 — grok이 그 비교를 통과하지 못해 claude로 읽히고 참견 form이 서서 아무 일도
 *  안 한다. 그래서 **집합이 여기 한 벌 있고 부르는 쪽은 엔진 이름을 세지 않는다.**
 *
 *  `label`은 그 기능을 화면이 부르는 이름이다 — 없는 기능을 열거하는 문장(§비주얼 §23 ⑤ 예고
 *  줄)이 이름을 따로 적으면 표를 고칠 때 문장이 안 따라온다.
 *
 *  `urls.ts`에 사는 이유는 이 파일 머리의 그 이유다: 판정하는 자리가 서버(§2 티켓 상세 ·
 *  §0-8 잔여)와 클라이언트(§2-1 스트림 · §4 워커 폼) 양쪽이고, `lib/workers.ts`는 `node:fs`를
 *  물어 클라이언트 번들에 못 들어간다. */
const FEATURE_ENGINES = {
  /** §2-2 참견 — `--input-format stream-json` 인접이 있어야 `tick.sh:263-270`이 FIFO를 판다 */
  interject: { label: "참견", engines: ["claude"] },
  /** §2-1 세션 스트림 — 트랜스크립트 파일이 있어야 한다. grok은 자리·형식이 다를 뿐 **있다** */
  stream: { label: "세션 스트림", engines: ["claude", "grok"] },
} as const;

export type EngineFeature = keyof typeof FEATURE_ENGINES;

/** 이 엔진에서 그 기능이 되는가. `engine`이 `null`이면 **`null`**이다 — 된다도 안 된다도 아니고
 *  (완료 티켓은 아무도 안 물고 있어 되짚을 워커가 없다) 화면은 없는 값을 추측해 문구를 고르지
 *  않는다(§비주얼 §23 ⑤ 마지막 항). 집합 밖 이름(손으로 쓴 `TICKET_ENGINE`)은 `false`다. */
export function engineCan(feature: EngineFeature, engine: string | null): boolean | null {
  const ok: readonly string[] = FEATURE_ENGINES[feature].engines;
  return engine === null ? null : ok.includes(engine);
}

/** 이 엔진에 **없는** 기능들의 화면 이름. claude면 빈 배열이라 부르는 쪽이 아무것도 안 그린다. */
export function engineMissing(engine: string): string[] {
  return Object.values(FEATURE_ENGINES)
    .filter((f) => !(f.engines as readonly string[]).includes(engine))
    .map((f) => f.label);
}

/** 스트림 아래 입력 form의 **모드** (§비주얼 §21 `어느 폼을 그리나` · §2-3 ③). 같은 칸이 티켓
 *  상태에 따라 셋으로 갈린다: `.wip`이면 `참견`(도는 세션에 말이 간다), **답변 대기면 `답변`**
 *  (`tickets/<awaiting>.done.md`가 생긴다), `.done`이면 `이어받기`(새 열린 티켓 1장이 생긴다).
 *  그 외 열림에는 이 입구가 없다(§2-2 안 만드는 것 3).
 *
 *  **`live` 하나로는 안 갈린다** — `.done`과 열림이 둘 다 `live === false`다. 그래서 폴링이
 *  `done` 비트를 같이 들고 온다(`tailSession`).
 *
 *  두 예외가 이 함수의 전부다:
 *  - `polled`가 아니면 아직 모른다 — 첫 폴링 전에 그리면 `참견을 받지 못합니다`가 한 번 깜빡인다.
 *  - **`failed`면 `live`가 내려가도 `참견`이 남는다.** `ENXIO`는 세션이 끝나서 나는 실패라
 *    다음 폴링이 곧 `live`를 내리고, 그때 폼이 사라지면 방금 실패한 사유와 사람이 쓴 글이 같이
 *    증발한다(§21 예외 항). `.done`이 되면 그쪽이 이긴다 — 실패 Alert만 지우고 글은 남긴다.
 *
 *  **`awaiting`은 `.wip` 뒤에서 본다.** §2-3 ③의 표는 세 모드가 배타라고 적고 있고 실제로도
 *  그렇다(`awaiting`은 열린 티켓에만 걸린다 — 제약 5). 그래도 순서를 이렇게 두는 이유는
 *  **제약 5를 호출부의 예의가 아니라 이 함수의 구조로 지키기 위해서다**: 둘이 동시에 참인 값이
 *  어쩌다 들어와도 `.wip`에서 답변칸이 서지 않는다.
 *
 *  `elapsedSuffix`와 같은 이유로 JSX가 아니라 여기 산다(`pnpm test`가 JSX를 못 읽는다). */
export type InterjectMode = "interject" | "followup" | "answer" | null;

export function interjectMode(s: {
  polled: boolean;
  live: boolean;
  done: boolean;
  failed: boolean;
  /** 답변 대기인가 — 열림 + `awaiting` 미충족(`queue.ts`의 `awaitingAnswer`). 서버가 준다 */
  awaiting?: boolean;
}): InterjectMode {
  if (!s.polled) return null;
  if (s.done) return "followup";
  if (s.live || s.failed) return "interject";
  return s.awaiting ? "answer" : null;
}

/** 진행 기록 한 줄 (§2-3 ②) — 스트림 사건 **또는** 스레드 칸이고, 원본을 통째로 들고 있다.
 *  뭉개지 않는 것이 §2-3 ⑥3이다: 화면이 둘을 다른 모양으로 그려야 해서 둘을 한 모양으로
 *  접은 중간 타입을 만들지 않는다. */
export type ProgressItem<E, T> = { event: E; thread?: never } | { event?: never; thread: T };

/** 세션 스트림 사건과 질문·답변 스레드를 **시간순 한 줄기**로 (§2-3 ②). 읽기 전용 조립이다.
 *
 *  규칙은 §2-3 ②의 표 그대로다:
 *  - 사건은 자기 `ts`. **`ts`가 없거나 못 읽으면 앞 사건과 같은 시각**이다 — 트랜스크립트의
 *    줄 순서가 곧 시간순이라(§2-1) 사건끼리의 순서는 준 순서 그대로 유지된다.
 *  - 답변은 답변 티켓의 `birth`. 질문은 **자기 시각이 없어서** 짝인 답변과 한 덩어리로 움직인다
 *    (`threadOf`가 이미 index로 짝을 엮는다 — 질문에 시각을 지어내지 않는다).
 *  - 답이 아직 없는 꼬리 질문은 **맨 끝**이다. 정렬 규칙이 아니라 UX 결정이고(§2-3 ②),
 *    바로 밑 입력칸이 그 답을 쓰는 자리다.
 *
 *  라운드 2 이상에서 옛 답변이 지금 세션의 첫 사건보다 위에 서는 것이 이 함수가 지키는 값이다 —
 *  스트림은 여전히 지금 `session_id` 하나고(§2-1 Q2=(a)) 옛 라운드는 스레드로만 남는다.
 *
 *  타입을 제네릭으로 받는 이유는 하나다: 이 파일은 `node:*`를 못 타서 `StreamEvent`(transcript.ts)도
 *  `ThreadItem`(queue.ts)도 여기서 import하지 않는다. 화면은 자기 타입을 그대로 돌려받는다. */
export function mergeProgress<E extends { ts?: string }, T extends { role: string; birth?: number }>(
  events: E[],
  thread: T[],
): ProgressItem<E, T>[] {
  // 사건의 시각. 못 읽으면 앞 사건 값을 물려받는다(첫 줄이면 0 = 그 자리가 맨 앞이다).
  let prev = 0;
  const at = events.map((e) => {
    const t = Date.parse(e.ts ?? "");
    return (prev = Number.isNaN(t) ? prev : t);
  });
  // 스레드를 덩어리로. 답변이 덩어리를 닫고, 그 앞에 쌓인 질문들이 답변 바로 앞에 붙는다.
  const chunks: { at: number; items: T[] }[] = [];
  let pending: T[] = [];
  for (const item of thread) {
    pending.push(item);
    if (item.role === "answer") {
      chunks.push({ at: item.birth ?? 0, items: pending });
      pending = [];
    }
  }
  if (pending.length) chunks.push({ at: Infinity, items: pending }); // 답 없는 꼬리 질문 = 맨 끝
  // 두 줄기를 앞에서부터 흘려 합친다. 사건끼리의 순서는 손대지 않는다.
  const out: ProgressItem<E, T>[] = [];
  let i = 0;
  for (const c of chunks) {
    while (i < events.length && at[i] <= c.at) out.push({ event: events[i++] });
    for (const item of c.items) out.push({ thread: item });
  }
  while (i < events.length) out.push({ event: events[i++] });
  return out;
}

/** `mergeProgress`가 짠 한 줄기를 **말풍선과 그 사이 묶음**으로 (§2-6 ②, designer `f0202829`).
 *  경계는 말풍선이다 — 스레드 항목과 `isBubble`이 참인 사건. 그 사이(상자 시작·끝 포함)의 연속
 *  사건이 접힌 한 버킷이 된다. **0건이면 버킷을 안 만든다**(빈 묶음 줄은 소음이다) — `n`이
 *  1이어도 만드는 것과 짝을 이루는 규칙이다. */
export type GroupedItem<E, T> =
  | { kind: "event"; event: E }
  | { kind: "thread"; thread: T }
  | { kind: "bundle"; events: E[] };

export function groupProgress<E, T>(
  items: ProgressItem<E, T>[],
  isBubble: (e: E) => boolean,
): GroupedItem<E, T>[] {
  const out: GroupedItem<E, T>[] = [];
  let bucket: E[] = [];
  const flush = () => {
    if (bucket.length) {
      out.push({ kind: "bundle", events: bucket });
      bucket = [];
    }
  };
  for (const it of items) {
    if (it.event !== undefined) {
      if (isBubble(it.event)) {
        flush();
        out.push({ kind: "event", event: it.event });
      } else {
        bucket.push(it.event);
      }
    } else {
      flush();
      out.push({ kind: "thread", thread: it.thread as T });
    }
  }
  flush();
  return out;
}

/** 진행 표식 문구(§2-6 ③) — 파싱된 **마지막 스트림 레코드**의 종류 하나로 갈린다.
 *  `thinking` 뒤에 아무 레코드가 붙는 순간 종전 문구로 돌아간다. */
export const progressMarkerText = (lastKind?: string): string =>
  lastKind === "thinking" ? "생각하는 중 · 2초마다" : "따라가는 중 · 2초마다";

/** 페르소나 색 팔레트 키 (DESIGN.md §비주얼 §12). 레지스트리에 이 문자열 그대로 저장된다.
 *  **자유 hex가 아니라 고정 8색인 이유**는 §5에 있다 — 라이트/다크 두 벌과 대비를 사람이
 *  즉석에서 못 맞춘다. 서버(레지스트리 쓰기 검증)와 클라이언트(스와치 목록)가 같은 목록을
 *  써야 해서 여기 산다. 여기 없는 키는 에러가 아니라 **중립 점**이다(§12). */
export const PERSONA_COLORS = [
  "orange",
  "yellow",
  "green",
  "teal",
  "sky",
  "blue",
  "violet",
  "pink",
] as const;

/** 팔레트 키 → 점 클래스. **`bg-persona-${key}`로 조립하지 않는다** — Tailwind는 소스에서 클래스
 *  문자열을 정적으로 훑으므로 조립하면 8색이 통째로 빌드에서 빠진다.
 *
 *  **모르는 키·미할당은 빈 점이다 — 에러가 아니다**(§비주얼 §12): 레지스트리를 손으로 고쳐
 *  오타가 나도 화면이 안 깨지고, 회색으로 채우지 않아 "누가 고른 9번째 색"으로도 안 읽힌다.
 *  `<PersonaBadge>`가 그리는 자리 5곳과 색 고르는 스와치가 **같은 이 함수**를 쓴다 —
 *  자리마다 표를 다시 쓰면 어느 화면 하나가 조용히 색 없이 남는다.
 *  JSX가 아니라 여기 사는 이유는 `elapsedSuffix`와 같다(`pnpm test`가 JSX를 못 읽는다). */
const PERSONA_DOT = new Map([
  ["orange", "bg-persona-orange"],
  ["yellow", "bg-persona-yellow"],
  ["green", "bg-persona-green"],
  ["teal", "bg-persona-teal"],
  ["sky", "bg-persona-sky"],
  ["blue", "bg-persona-blue"],
  ["violet", "bg-persona-violet"],
  ["pink", "bg-persona-pink"],
]);

// 객체가 아니라 `Map`인 이유: 조회 키가 **레지스트리 파일에서 오는 남의 문자열**이라
// `{...}["toString"]`이 함수를 돌려주는 자리다. 여기서는 그게 클래스 문자열 자리로 새어
// 들어가 점이 사라진다 — `Map`이면 그 구멍이 없다(검증: `lib/projects.test.ts`).
export const personaDotClass = (color?: string): string =>
  PERSONA_DOT.get(color ?? "") ?? "border border-muted-foreground";

/** 칸반 호버 관계선 한 획의 `d` (DESIGN.md §비주얼 §17 기하). 좌표는 **스트립 콘텐츠 박스**
 *  기준이고 `y`는 호출자가 이미 레인의 보이는 상자로 클램프한 값이다(§17 앵커 클램프).
 *
 *  **분기가 없는 것이 이 식의 값이다** — 이웃 레인 · 레인 건너뜀 · 같은 레인 세 배치가 여기서
 *  같이 나온다. `s`는 접선 방향(상대가 오른쪽이면 +1 = 오른쪽 테두리에 붙는다. **같으면 둘 다
 *  +1**이라 같은 레인 선이 오른쪽 거터로 부푼다), `d`는 제어점 거리 `clamp(|Δx|/2, 24, 96)`다.
 *  하한 24는 레인 사이 거터 폭이고(카드 테두리 사이 `4+16+4`), 상한 96은 레인을 건너뛰는 선을 자른다.
 *
 *  제어점의 y가 앵커의 y와 같다 — 곡선이 두 앵커의 세로 범위를 못 벗어나므로 선이 레인 머리로
 *  올라가지 않는다. 지켜야 할 성질이라 값이 아니라 근거로 적는다(§17).
 *  JSX가 아니라 여기 사는 이유는 `elapsedSuffix`와 같다(`pnpm test`가 JSX를 못 읽는다). */
export type Anchor = { left: number; right: number; cx: number; y: number };

export function relationPath(a: Anchor, b: Anchor): string {
  const s1 = b.cx < a.cx ? -1 : 1;
  const s2 = b.cx > a.cx ? -1 : b.cx < a.cx ? 1 : 1;
  const x1 = s1 > 0 ? a.right : a.left;
  const x2 = s2 > 0 ? b.right : b.left;
  const d = Math.min(96, Math.max(24, Math.abs(x2 - x1) / 2));
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M ${r(x1)},${r(a.y)} C ${r(x1 + s1 * d)},${r(a.y)} ${r(x2 + s2 * d)},${r(b.y)} ${r(x2)},${r(b.y)}`;
}

/** 홈 디렉터리를 `~`로 줄인 표시용 경로. 잘리는 길이 자체를 줄인다(DESIGN.md §6 텍스트 잘림).
 *  표시 전용이다 — 이 값을 다시 파일 경로로 쓰지 않는다. */
export function tildePath(abs: string, home: string): string {
  if (abs === home) return "~";
  return abs.startsWith(home + "/") ? "~" + abs.slice(home.length) : abs;
}

/** `tildePath`의 역방향. `lib/paths.ts`의 `expandHome`과 같은 규칙이고, 이쪽은 `home`을 인자로
 *  받아 **클라이언트에서도 돈다**(`node:os`를 import하면 폼이 빌드에서 깨진다 — AGENTS.md).
 *  셸 변수는 펴지 않는다: `$TICKET_CWD`는 워커마다 갈리는 값이라 한 값으로 굳히면 거짓이 된다. */
export function expandTilde(p: string, home: string): string {
  if (p === "~") return home;
  return p.startsWith("~/") ? home + p.slice(1) : p;
}

/** 네이티브 피커가 준 절대경로를 기준 디렉터리 **아래일 때만** 상대경로로 줄인다
 *  (DESIGN.md §데스크톱 앱 N3 — 스펙 파일은 프로젝트 루트 상대, 컨텍스트는 `$TICKET_CWD` 접두).
 *
 *  밖이면 절대경로 그대로다. 거르지 않는 것이 요건이다 — 피커는 값을 채울 뿐이고 그 경로가
 *  유효한지는 서버가 종전대로 판정한다(§0 해석 결과 표). `baseAbs`가 비면 줄일 기준이 없다. */
export function relativeUnder(picked: string, baseAbs: string): string {
  const base = baseAbs.replace(/\/+$/, "") + "/";
  return base !== "/" && picked.startsWith(base) ? picked.slice(base.length) : picked;
}

/** 한 문자열에서 **일치한 곳의 시작 오프셋 전부** (DESIGN.md §7 §대화 안에서 찾기 · §비주얼 §30).
 *  `<FindBar>`가 텍스트 노드마다 이걸 불러 `Range`를 만든다 — **JSX는 `node --test`가 못 읽으므로
 *  컴포넌트의 순수 판정이 여기 산다**(AGENTS.md). 훑는 자는 §1 보드 검색과 같은 것 하나다:
 *  **대소문자 무시 부분일치**. 정규식도 단어 단위도 대소문자 토글도 없다(§30 ⑦).
 *
 *  **겹치는 일치는 안 센다** — `aaa`에서 `aa`는 1건이다. 겹치면 §30 ④의 *겹침 없음*이 깨져
 *  `3/12`가 가리키는 자리가 둘이 되고, 두 레지스트리를 가르는 뺄셈도 성립하지 않는다.
 *
 *  ponytail: `toLowerCase()`가 길이를 바꾸는 글자(`İ` → 2자)가 섞이면 오프셋이 그만큼 밀린다.
 *  이 화면의 글은 한글·ASCII라 안 걸린다 — 걸리는 큐가 나오면 원문을 그대로 훑는 스캔으로 바꾼다. */
export function findMatches(text: string, query: string): number[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}
