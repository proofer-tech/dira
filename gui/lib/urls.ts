/** 클라이언트와 서버가 **같은 규칙을 써야 하는** 순수 URL 헬퍼.
 *
 *  `tenants.ts`에 두지 못하는 이유는 하나다: 그 파일은 `node:fs`를 import하므로 클라이언트
 *  번들에 들어갈 수 없다. 등록 폼은 입력하는 동안 슬러그 미리보기를 보여주고(서버 왕복 없이),
 *  전환기는 브라우저에서 `usePathname()`으로 목적지를 만든다. 규칙이 갈리면 미리보기가
 *  거짓말을 하므로 함수는 한 곳에 둔다. **여기에 `node:*` import를 추가하지 않는다.** */

/** 이름 → URL 조각 (DESIGN.md §테넌트 > `id` 슬러그 규칙).
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

/** 테넌트 전환 목적지 — **같은 화면 종류를 유지한다**(DESIGN.md §0-1).
 *  `/t/a/workers` → `/t/b/workers`. 필터·검색 searchParams는 애초에 안 받는다
 *  (호출자가 `usePathname()`을 넘기므로 공짜로 버려진다 — 테넌트마다 persona·kind 값이 다르다).
 *
 *  티켓 상세만 예외로 보드로 떨어뜨린다: 해시는 테넌트마다 독립이라
 *  (DESIGN.md §데이터 모델) 옮겨 붙이면 남의 큐에 없는 티켓을 열어 404가 된다. */
export function tenantPath(pathname: string, id: string): string {
  const rest = /^\/t\/[^/]+(\/.*)?$/.exec(pathname)?.[1] ?? "";
  if (/^\/tickets\/(?!new(\/|$))./.test(rest)) return `/t/${id}`;
  return `/t/${id}${rest === "/" ? "" : rest}`;
}

/** 홈 디렉터리를 `~`로 줄인 표시용 경로. 잘리는 길이 자체를 줄인다(DESIGN.md §6 텍스트 잘림).
 *  표시 전용이다 — 이 값을 다시 파일 경로로 쓰지 않는다. */
export function tildePath(abs: string, home: string): string {
  if (abs === home) return "~";
  return abs.startsWith(home + "/") ? "~" + abs.slice(home.length) : abs;
}
