/** 경로 탈출 방어 — 신뢰 경계. 사용자 입력이 파일 경로가 되는 지점은 전부 여기를 통과한다.
 *  클라이언트 검증은 검증이 아니다(DESIGN.md §경로 방어). */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** 워커·페르소나 이름. tickets.py의 PERSONA_RE와 같은 규칙 — 엔진이 이 값으로 경로를 만든다. */
export const NAME_RE = /^[A-Za-z0-9_-]+$/;
/** 티켓 해시. 통과해도 경로를 조립하지 않고 실제 파일 목록에서 찾는다. */
export const HASH_RE = /^[a-z0-9-]{4,40}$/;
/** 테넌트 id. 경로 조각은 아니지만(레지스트리 조회 키) URL에 실리므로 제한한다. */
export const TENANT_ID_RE = /^[a-z0-9-]+$/;

export const isName = (s: string) => NAME_RE.test(s);
export const isHash = (s: string) => HASH_RE.test(s);
export const isTenantId = (s: string) => TENANT_ID_RE.test(s);

/** `~` 확장. 사용자가 손으로 치는 경로 입력에만 쓴다(셸이 안 거치므로 직접 편다). */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** 셸 값 한 줄을 해석한다. 해석 못 하면 null(호출자가 기본값 + `기본값 가정`으로 처리).
 *
 *  **셸을 실행하지 않는다.** 등록된 경로의 임의 코드가 GUI 권한으로 도는 걸 막는 게 이 함수의
 *  존재 이유다(DESIGN.md §결정 기록). 그 대가로 `$HOME` 말고 다른 변수는 못 읽는다.
 *  `tenants.ts`와 `workers.ts`가 같은 규칙을 써야 해서 여기 있다(둘이 서로를 import하면 순환이다). */
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
  if (/\$[A-Za-z_{]/.test(v)) return null; // 남은 변수 참조 = 해석 실패
  return v || null; // 빈 값은 미설정과 같다(tickets.py도 `or 기본값`)
}

/** 기준 디렉터리 안의 실제 경로를 돌려준다. 밖이면 던진다.
 *
 *  기준은 테넌트 root가 아니라 **그 용도의 해석된 디렉터리**다 — 페르소나 편집의 기준은
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
