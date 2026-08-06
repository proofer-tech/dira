/** 경로 탈출 방어 — 신뢰 경계. 사용자 입력이 파일 경로가 되는 지점은 전부 여기를 통과한다.
 *  클라이언트 검증은 검증이 아니다(DESIGN.md §경로 방어). */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** 워커/페르소나 이름. tickets.py의 PERSONA_RE와 같은 규칙. */
export const NAME_RE = /^[A-Za-z0-9_-]+$/;
/** 티켓 해시로 **쓸 수 없는** 것: 경로 구분자와 제어문자. 아래 `isHash` 참고. */
const HASH_DENY = /[/\\\p{Cc}]/u;
/** 프로젝트 id. 경로 조각은 아니지만(레지스트리 조회 키) URL에 실리므로 제한한다. */
export const PROJECT_ID_RE = /^[a-z0-9-]+$/;

export const isName = (s: string) => NAME_RE.test(s);
export const isProjectId = (s: string) => PROJECT_ID_RE.test(s);

/** 티켓 해시 = URL에 실리는 티켓 식별자. 파일명 stem이거나 frontmatter `ticket:` 값이고
 *  (`tickets.py ticket_hash`) **엔진은 둘 다 임의 문자열을 허용한다** — 한글 파일명으로 도는
 *  큐가 실제로 있다. 옛 규칙 `^[a-z0-9-]{4,40}$`은 엔진이 디스패치하는 티켓(`순수한글.md`)을
 *  GUI만 못 열게 했다(a606dd0e). 그래서 **글자를 고르지 않고 경로가 될 수 있는 것만** 막는다:
 *  경로 구분자·제어문자, 그리고 `.` 시작(`.`·`..`·dotfile — 큐 목록도 dotfile은 빼므로 없는 것과 같다).
 *
 *  이건 심층 방어의 첫 겹일 뿐이다: 통과해도 **경로를 조립하지 않는다.** 해시는
 *  `tickets.py find`(그리고 `engine.findTicket`의 폴백)에서 `tickets/*.md`의 실제 이름과
 *  비교되고, 돌아오는 것은 그 파일의 경로다 — 프로젝트 큐 밖을 가리킬 방법이 없다. */
export const isHash = (s: string) =>
  s.length > 0 && s.length <= 255 && !s.startsWith(".") && !HASH_DENY.test(s);

/** `~` 확장. 사용자가 손으로 치는 경로 입력에만 쓴다(셸이 안 거치므로 직접 편다). */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** 엔진의 `$LOCAL`(`tick.sh:33`) — 머신 로컬 저장 디렉터리. 레지스트리·토큰·키맵·
 *  `analytics.json`·`alerts.json`·락이 전부 여기 산다.
 *
 *  `shellValue`와 같은 이유로 여기 있다: `projects.ts`의 `registryPath()`와 `workers.ts`의
 *  `lockPath()`가 같은 규칙을 쓰는데 둘이 서로를 import하면 순환이다. **`TICKET_LOCAL` 존중이
 *  한 곳에만 있다** — 두 벌이면 한쪽만 고쳐도 GUI가 엔진과 다른 디렉터리를 본다. */
export function localDir(): string {
  return expandHome(process.env.TICKET_LOCAL || path.join(homedir(), ".config", "dira"));
}

/** 셸 값 한 줄을 해석한다. 해석 못 하면 null(호출자가 기본값 + `기본값 가정`으로 처리).
 *
 *  **셸을 실행하지 않는다.** 등록된 경로의 임의 코드가 GUI 권한으로 도는 걸 막는 게 이 함수의
 *  존재 이유다(DESIGN.md §결정 기록). 그 대가로 `$HOME` 말고 다른 변수는 못 읽는다.
 *  `projects.ts`와 `workers.ts`가 같은 규칙을 써야 해서 여기 있다(둘이 서로를 import하면 순환이다). */
export function shellValue(raw: string): string | null {
  const s = raw.trimStart();
  let v: string;
  if (s.startsWith("'")) {
    const e = s.indexOf("'", 1);
    if (e < 0) return null;
    return s.slice(1, e) || null; // 작은따옴표 안은 치환 없음(셸과 같다)
  } else if (s.startsWith('"')) {
    const e = s.indexOf('"', 1);
    if (e < 0) return null;
    v = s.slice(1, e);
  } else {
    v = s.split(/[ \t#]/)[0];
  }
  v = v.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, homedir());
  // 변수 참조·명령 치환이 남았다 = 해석 실패. `$(`와 백틱을 빼먹으면 `$(id -un)` 같은 원문이
  // 그대로 실효값이 되어 기준 디렉터리로 쓰인다(ce40243f).
  if (/\$[A-Za-z_{(]|`/.test(v)) return null;
  return v || null; // 빈 값은 미설정과 같다(tickets.py도 `or 기본값`)
}

/** 기준 디렉터리가 될 셸 값. 절대경로가 아니면 null이다 — 상대경로를 서버(Next) cwd 기준으로
 *  풀면 `apps/teams/` 밑을 읽고 쓴다. 워커가 어디서 도는지는 셸을 실행하지 않는 한 알 수 없다. */
export function shellPath(raw: string): string | null {
  const v = shellValue(raw);
  return v !== null && path.isAbsolute(expandHome(v)) ? v : null;
}

/** 기준 디렉터리 안의 실제 경로를 돌려준다. 밖이면 던진다.
 *
 *  기준은 프로젝트 root가 아니라 **그 용도의 해석된 디렉터리**다 — 페르소나 편집의 기준은
 *  해석된 TICKET_PERSONAS이고 그건 루트 밖일 수 있다(이 레포의 큐가 당장 그렇다).
 *  양쪽 다 realpath한 뒤 비교한다: 심링크로 나가는 건 문자열 비교로 못 막는다. */
export async function resolveWithin(baseDir: string, target: string): Promise<string> {
  const base = await realpath(expandHome(baseDir));
  const real = await realpathOfDeepestExisting(path.resolve(base, expandHome(target)));
  if (real !== base && !real.startsWith(base + path.sep)) {
    throw new Error(`경로가 기준 디렉터리 밖이다: ${target} -> ${real} (기준 ${base})`);
  }
  return real;
}

/** 아직 없는 파일(새로 만들 파일)도 검증 대상이라 존재하는 조상까지만 realpath한다.
 *  없는 구간은 심링크일 수 없으므로 path.resolve의 정규화(`..` 제거)로 충분하다. */
async function realpathOfDeepestExisting(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const parent = path.dirname(p);
    if (parent === p) throw e;
    return path.join(await realpathOfDeepestExisting(parent), path.basename(p));
  }
}
