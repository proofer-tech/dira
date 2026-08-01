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
 *  (DESIGN.md §데이터 모델) 옮겨 붙이면 남의 큐에 없는 티켓을 열어 404가 된다. */
export function projectPath(pathname: string, id: string): string {
  const rest = /^\/p\/[^/]+(\/.*)?$/.exec(pathname)?.[1] ?? "";
  if (/^\/tickets\/(?!new(\/|$))./.test(rest)) return `/p/${id}`;
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

/** 배지의 경과 접미사 — `답변 대기 · 3일`의 ` · 3일` (DESIGN.md §비주얼 §2 경과 표시 표).
 *  **`0`이면 붙이지 않는다**: `· 0일`은 고장으로 읽힌다. `undefined`(경과를 안 주는 상태)와 같은 처리다.
 *  판정만 여기 있는 이유는 `pnpm test`가 JSX를 못 읽어서다 — `status-badge.tsx`에 두면 검증이 없다.
 *  이 파일이어야 하는 이유는 배지가 클라이언트 컴포넌트에도 들어가서다(`node:fs`를 못 끌고 온다). */
export const elapsedSuffix = (days?: number) => (days ? ` · ${days}일` : "");

/** 세션 스트림(§2-1)의 사건 줄을 **펼칠 수 있나** — 셰브런·`<details>`를 거는 유일한 판정.
 *  본문이 없으면 펼쳐도 빈 상자라 어포던스를 주지 않는다: `thinking` 본문은 암호화돼
 *  빈 문자열로 오는 게 전부다(실측 75/75). §2-1의 계약은 "펼치면 원문"이고, 원문이 없는 줄에서
 *  셰브런이 "여기 원문이 있다"고 말하면 그 계약이 그 줄에서만 거짓이 된다.
 *  `elapsedSuffix`와 같은 이유로 여기 산다 — `pnpm test`가 JSX를 못 읽고, 스트림은 클라이언트다. */
export const expandable = (e: { body: string }) => e.body !== "";

/** 스트림 아래 입력 form의 **모드** (§비주얼 §21 `어느 폼을 그리나`). 같은 칸이 티켓 상태에 따라
 *  둘로 갈린다: `.wip`이면 `참견`(도는 세션에 말이 간다), `.done`이면 `이어받기`(새 열린 티켓
 *  1장이 생긴다). 열림에는 이 입구가 없다(§2-2 안 만드는 것 3).
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
 *  `elapsedSuffix`와 같은 이유로 JSX가 아니라 여기 산다(`pnpm test`가 JSX를 못 읽는다). */
export type InterjectMode = "interject" | "followup" | null;

export function interjectMode(s: {
  polled: boolean;
  live: boolean;
  done: boolean;
  failed: boolean;
}): InterjectMode {
  if (!s.polled) return null;
  if (s.done) return "followup";
  return s.live || s.failed ? "interject" : null;
}

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
