/** 엔진을 **서브프로세스로** 부른다 (DESIGN.md §아키텍처 · 제약 2 · §경로 방어).
 *
 *  claim(`os.link`)·release·reap의 원자성 보장은 `tickets.py` 안에만 있다. TS로 다시 구현하면
 *  두 판정이 갈리고, 갈리는 순간 티켓이 사라진다. 그래서 **상태 전이는 워커 스크립트를 부른다**
 *  (`reap`·`unassign`).
 *
 *  **읽기 조회는 부르지 않는다**: 해시 → 경로는 `lib/queue.ts`의 미러(`findPath` = `find_any`)가
 *  답한다. 스폰이 요청마다 160~360ms고 세션 스트림은 2초마다 그 길로 온다(38b11db5). 미러는
 *  패리티 테스트로 고정돼 있고, 원자성이 걸린 건 여기 없다 — 판정은 파일 목록 하나다. */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { NAME_RE, isHash, resolveWithin } from "./paths.ts";
import { findPath, listTickets, type Suffixes } from "./queue.ts";
import { healCommonContextFile, listWorkers } from "./workers.ts";

/** rc와 출력을 그대로 넘긴다. 실패해도 삼키지 않는다 — 화면이 원문을 보여준다(§6 에러 3요소).
 *
 *  `code`는 **엔진의 종료 코드**다(§2-5 §종료 코드). 화면이 갈래를 이 수로 가른다 — 거부 문구를
 *  정규식으로 읽으면 문구를 고치는 순간 그 갈래가 조용히 사라진다. 성공(`ok`)이면 `0`이고,
 *  스폰 자체가 실패하면(`ENOENT` 등 코드가 수가 아닌 경우) `undefined`다. */
export type Run = { ok: boolean; output: string; code?: number };

/** `<root>/workers/<name>.sh <args…>`.
 *
 *  이름은 `NAME_RE`를 통과해야 하고, 경로는 조립한 문자열을 믿지 않고 `resolveWithin`으로
 *  workers/ 안인지 확인한다 — 여기서 실행되는 건 셸 스크립트다. 신뢰 경계다.
 *
 *  여기서 실행하는 워커 `.sh`는 **번들 대상이 아니다.** 그래서 `pnpm build`가 `Encountered
 *  unexpected file in NFT list` 경고를 낸다 — 서브프로세스 경로가 런타임 값이라 트레이서가
 *  포기하는 것이고, 경고일 뿐 빌드는 통과한다. `turbopackIgnore` 주석으로도 안 사라진다(실측).
 *  워커 스크립트 경로가 프로젝트마다 다른 건 제약 2가 요구하는 설계다. */
export async function runWorker(
  root: string,
  name: string,
  args: string[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<Run> {
  if (!NAME_RE.test(name)) {
    return { ok: false, output: `${t(locale, "engine.invalidWorkerNamePrefix")} ${name}` };
  }
  let file: string;
  try {
    file = await resolveWithin(path.join(root, "workers"), `${name}.sh`);
  } catch (e) {
    return { ok: false, output: (e as Error).message };
  }
  // 워커 화면(`readCommonContext`)을 거치지 않고도 여기로 바로 오는 호출(`unassign`·`reap`)이
  // 있다(bcac177c) — 셸을 부르기 전에 여기서도 낫힌다. 이미 있으면 `stat` 한 번으로 끝난다.
  await healCommonContextFile(root);
  try {
    // ponytail: reap은 python 스캔 한 번이라 초 단위로 끝난다. 60초면 매달린 걸 알아채기 충분하다.
    const { stdout, stderr } = await promisify(execFile)(file, args, {
      timeout: 60_000,
      maxBuffer: 4 << 20,
    });
    return { ok: true, output: (stdout + stderr).trim(), code: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const out = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
    // `err.code`는 종료 코드(수)이거나 스폰 실패의 문자열(`ENOENT`)이다 — 수일 때만 싣는다.
    // 신호로 죽으면(`killed`) 코드가 아예 없다. 어느 쪽이든 `undefined`가 "코드가 없다"다.
    const code = typeof err.code === "number" ? err.code : undefined;
    return { ok: false, output: out || err.message, code };
  }
}

/** 어느 워커가 불렸는지 — 화면이 `w1.sh unassign <해시>`라고 적어야 한다. */
export type UnassignRun = Run & { worker: string | null };

/** `workers/<w>.sh unassign <해시>` — 할당 해제(session_id 비우기 + 진행중 접미사 떼기).
 *
 *  넘기는 값은 **파일명 stem**이어야 한다: 이 명령은 `tickets.py find`로 떨어지고 그건 파일명만
 *  본다(§식별자). 표시값(`Ticket.hash`)을 넘기면 `ticket:`이 파일명과 갈린 티켓에서 `티켓을 못
 *  찾음`으로 실패한다 — 호출자가 `findTicket`이 준 경로에서 stem을 뽑아 넘긴다.
 *
 *  워커 이름을 **인자로 받지 않는다**: 디스크 목록의 첫 워커를 쓴다. `unassign`은 큐 전체를 보므로
 *  같은 루트의 어느 워커로 불러도 같고(README §워커 레퍼런스), 그러면 사용자 입력이 경로가 되는
 *  지점이 하나 줄어든다. 워커가 0개면 부를 스크립트가 없다 — 호출자가 액션을 비활성화한다.
 *
 *  `force`면 `--force`가 붙는다(§2-5). 산 세션을 만나면 엔진이 그 세션을 끊고 푼다 — **죽이는
 *  것도 푸는 것도 엔진 안이다**(제약 2·3: GUI는 `process.kill`도 생존 판정도 하지 않는다).
 *  플래그가 갈라 놓는 자리는 거부하던 그 한 곳뿐이라 죽은 세션에는 붙어도 아무 일이 없다. */
export async function unassign(
  root: string,
  hash: string,
  force = false,
  locale: Locale = DEFAULT_LOCALE,
): Promise<UnassignRun> {
  if (!isHash(hash)) {
    return { ok: false, output: `${t(locale, "engine.invalidHashPrefix")} ${hash}`, worker: null };
  }
  const workers = await listWorkers(root);
  if (workers.length === 0) {
    return {
      ok: false,
      output: t(locale, "engine.noWorkerToUnassign"),
      worker: null,
    };
  }
  const name = workers[0].name;
  const args = force ? ["unassign", hash, "--force"] : ["unassign", hash];
  return { ...(await runWorker(root, name, args, locale)), worker: name };
}

/** 해시 → 실제 티켓 경로. 없으면 null(404의 근거).
 *
 *  **경로를 조립하지 않는다.** 형식 검증을 통과한 해시를 큐 스캔(`findPath`)에 물어 실제 파일을
 *  받는다 — 상태 접미사가 붙은 이름·`re-<해시>` 폴백을 두 곳에서 판정하지 않으려는 것도 같은
 *  이유다. 접미사는 프로젝트별이라(제약 6) 해석된 값을 인자로 받는다.
 *
 *  `find_any`는 **파일명 stem으로만** 찾는데 화면이 URL에 싣는 `Ticket.hash`는 frontmatter
 *  `ticket:`이 우선이다(`tickets.py ticket_hash`도 같다). 둘이 갈리는 티켓은 보드가 그린 링크가
 *  404였다(a606dd0e) — 그래서 stem이 빗나가면 frontmatter 해시로 한 번 더 본다. */
export async function findTicket(
  root: string,
  hash: string,
  sfx: Suffixes,
): Promise<string | null> {
  if (!isHash(hash)) return null;
  const hit = await findPath(root, hash, sfx);
  if (hit) return hit;
  // 여기서도 경로를 조립하지 않는다: 큐 스캔이 준 실제 파일 경로를 돌려준다. 비교는 NFC로 —
  // URL에서 온 한글과 파일에 적힌 한글의 정규화가 다를 수 있다(엔진 `find_any`도 nfc한다).
  // ponytail: 폴백에서만 파일을 연다(`findPath`는 이름만 본다). stem이 맞는 흔한 경우엔
  // readdir 한 번이 전부다. 폴백까지 오면 큐 전체를 읽는데, 그건 상세가 어차피 하는 일이다.
  const want = hash.normalize("NFC");
  const found = (await listTickets(root, sfx)).find((t) => t.hash.normalize("NFC") === want);
  return found?.path ?? null;
}
