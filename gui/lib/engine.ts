/** 테넌트의 워커 스크립트 서브프로세스 호출 (DESIGN.md §아키텍처 · 제약 2).
 *
 *  claim(`os.link`)·release·reap의 원자성 보장은 `tickets.py` 안에만 있다. TS로 다시 구현하면
 *  두 판정이 갈리고, 갈리는 순간 티켓이 사라진다. 그래서 GUI는 **워커 스크립트를 부른다**.
 *  지금 부르는 건 `reap` 하나고, `unassign`은 티켓 상세 티켓이 같은 함수를 쓴다. */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NAME_RE, resolveWithin } from "./paths.ts";

/** rc와 출력을 그대로 넘긴다. 실패해도 삼키지 않는다 — 화면이 원문을 보여준다(§6 에러 3요소). */
export type Run = { ok: boolean; output: string };

/** `<root>/workers/<name>.sh <args…>`.
 *
 *  이름은 `NAME_RE`를 통과해야 하고, 경로는 조립한 문자열을 믿지 않고 `resolveWithin`으로
 *  workers/ 안인지 확인한다 — 여기서 실행되는 건 셸 스크립트다. 신뢰 경계다. */
export async function runWorker(root: string, name: string, args: string[]): Promise<Run> {
  if (!NAME_RE.test(name)) return { ok: false, output: `워커 이름 형식이 아닙니다: ${name}` };
  let file: string;
  try {
    file = await resolveWithin(path.join(root, "workers"), `${name}.sh`);
  } catch (e) {
    return { ok: false, output: (e as Error).message };
  }
  try {
    // ponytail: reap은 python 스캔 한 번이라 초 단위로 끝난다. 60초면 매달린 걸 알아채기 충분하다.
    const { stdout, stderr } = await promisify(execFile)(file, args, {
      timeout: 60_000,
      maxBuffer: 4 << 20,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const out = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
    return { ok: false, output: out || err.message };
  }
}
