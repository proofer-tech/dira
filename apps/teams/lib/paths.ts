/** 경로 탈출 방어 — 신뢰 경계. 사용자 입력이 파일 경로가 되는 지점은 전부 여기를 통과한다.
 *  클라이언트 검증은 검증이 아니다(DESIGN.md §경로 방어). */
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

/** 워커/페르소나 이름. tickets.py의 PERSONA_RE와 같은 규칙. */
export const NAME_RE = /^[A-Za-z0-9_-]+$/;
/** 티켓 해시로 **쓸 수 없는** 것: 경로 구분자와 제어문자. 아래 `isHash` 참고. */
const HASH_DENY = /[/\\\p{Cc}]/u;
/** 프로젝트 id. 경로 조각은 아니지만(레지스트리 조회 키) URL에 실리므로 제한한다. */
export const PROJECT_ID_RE = /^[a-z0-9-]+$/;

export const isName = (s: string) => NAME_RE.test(s);
export const isProjectId = (s: string) => PROJECT_ID_RE.test(s);

/** §5-5 §할당 입구 둘의 select 값 — `persona:<이름>` / `squad:<이름>` 접두사 하나, 빈 값은
 *  `없음`. 이름에 `:`이 못 들어가므로(`NAME_RE`) 첫 `:`에서 한 번만 가른다. 발행(`createTicket`)
 *  과 편집(`saveTicket`) 양쪽이 같은 파싱을 써야 판정이 갈리지 않는다 — 그래서 `"use server"`
 *  파일 밖 여기 하나에 둔다(`fmValue` 네 줄과 달리 이건 진짜 공유할 수 있다). */
export function parseAssignment(
  raw: string,
  locale: Locale = DEFAULT_LOCALE,
): { persona: string; squad: string } {
  const v = raw.trim();
  if (!v) return { persona: "", squad: "" };
  const i = v.indexOf(":");
  const prefix = i < 0 ? "" : v.slice(0, i);
  const name = i < 0 ? v : v.slice(i + 1);
  if ((prefix !== "persona" && prefix !== "squad") || !NAME_RE.test(name)) {
    throw new Error(`${t(locale, "paths.invalidAssignmentPrefix")} ${raw}`);
  }
  return prefix === "squad" ? { persona: "", squad: name } : { persona: name, squad: "" };
}

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
 *  `analytics.json`·`alerts.json`·락이 전부 여기 있다.
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
export async function resolveWithin(
  baseDir: string,
  target: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  const base = await realpath(expandHome(baseDir));
  const real = await realpathOfDeepestExisting(path.resolve(base, expandHome(target)));
  if (real !== base && !real.startsWith(base + path.sep)) {
    throw new Error(
      `${t(locale, "paths.outsideBasePrefix")} ${target} -> ${real} ${t(locale, "paths.outsideBaseSuffix")} ${base})`,
    );
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

/** import(DESIGN.md §5-3 §import ①)가 받는 폴더 — `resolveWithin`과 반대 방향의 검증이다.
 *  고르는 폴더는 머신 어디든이라 기준 디렉터리가 없다 — 보는 것은 절대경로인가와 실재하는
 *  디렉터리인가 둘뿐이다(`~`는 `expandHome`으로 편 뒤 본다 — `shellPath`의 `:76`과 같은 관용구,
 *  이 앱의 다른 경로 칸이 다 받는 그 표기다). 읽기 권한은 이미 머신 전역이라
 *  (`--allowed-tools Read Glob Grep`) 여기서 더 좁히지 않는다. */
export async function isRealDirectory(p: string): Promise<boolean> {
  const expanded = expandHome(p);
  if (!path.isAbsolute(expanded)) return false;
  try {
    return (await stat(expanded)).isDirectory();
  } catch {
    return false;
  }
}

export type OpenResult = { ok: boolean; message?: string };

/** 절대경로 하나를 OS가 확장자에 지정해 둔 기본 앱으로 연다(macOS `open`, DESIGN.md §10).
 *  인자는 배열로 넘어가고 셸을 안 지난다. 실패해도 던지지 않는다 — rc가 0이 아니거나 스폰 자체가
 *  안 되면(예: `open` 없는 플랫폼) 화면이 그대로 보여줄 사유를 돌려준다.
 *
 *  **이 함수 자신은 경로를 검증하지 않는다** — 호출자가 `resolveWithin`을 지난 값만 넘겨야
 *  한다(아래 `openWithinApp`이 그 순서를 하나로 묶는다). */
export async function openInApp(absPath: string): Promise<OpenResult> {
  try {
    await promisify(execFile)("open", [absPath]);
    return { ok: true };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    return { ok: false, message: (err.stderr || err.message || "").trim() };
  }
}

/** `resolveWithin`을 지난 경우에만 `openInApp`을 부른다 — 신뢰 경계 검사와 실행 사이에
 *  다른 호출자가 끼어들 자리를 안 만든다(§경로 방어. `openInApp` 머리 주석과 짝). 기준 밖이면
 *  `resolveWithin`이 던지고, 그 예외가 이 함수를 지나 그대로 호출자에게 간다 — `open`은
 *  안 불린다. */
export async function openWithinApp(
  baseDir: string,
  rel: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<OpenResult> {
  const full = await resolveWithin(baseDir, rel, locale);
  return openInApp(full);
}
