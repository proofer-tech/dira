/** 즉시 디스패치 (DESIGN.md §4-5). 사람의 조작이 큐에 **열린 티켓을 만들거나 되돌렸으면**
 *  그 자리에서 `idle` 워커 하나를 인자 없이 띄운다 — cron이 다음 분에 할 실행을 지금 한다.
 *
 *  **`engine.ts`의 `runWorker`를 쓰지 않는다.** 저건 `execFile` + 60초 타임아웃이고, tick이
 *  티켓을 물면 그 프로세스는 `claude` 세션을 5~25분 동기로 붙들고 있다 — 그 길로 부르면 이
 *  기능이 60초마다 세션을 죽이는 학살기가 된다. 띄우고 잊는다(detach spawn). 그 한 줄이
 *  달라서 `engine.ts`에 안 얹었다: 저 파일의 계약은 "rc와 출력을 그대로 넘긴다"인데
 *  여기는 결과가 없다.
 *
 *  **던지지 않는다.** 티켓은 이미 파일에 써졌고 spawn이 실패해도 cron이 ≤60초 뒤에 같은 일을
 *  한다 — 즉시 디스패치는 지연을 줄이는 최적화지 정확성의 일부가 아니다(§4-5 마지막 항).
 *  그래서 호출자는 결과를 보지 않고 화면에도 성공·실패를 그리는 자리가 없다. */
import { spawn } from "node:child_process";
import path from "node:path";
import { NAME_RE, resolveWithin } from "./paths.ts";
import { listWorkers } from "./workers.ts";

/** 띄운 워커 이름. 안 띄웠으면 null(idle 0개 · 경로 방어 실패 · spawn 실패) — **테스트용 값이고
 *  호출자는 안 본다.**
 *
 *  고르는 것은 `idle` **첫 하나**다(§4-5): `running`은 워커 락에 막혀 어차피 즉시 exit하고,
 *  `stopped`는 사람이 crontab에서 뺀 결정이며, `stale`의 락 회수는 다음 cron tick의 일이다.
 *  // ponytail: 한 번에 1개. 한 조작이 만드는 열린 티켓은 사실상 1장이다 — 늘릴 근거가 생기면
 *  // `find` → `filter` 한 글자다(§4-5). */
export async function kickIdleWorker(root: string): Promise<string | null> {
  try {
    const idle = (await listWorkers(root)).find((w) => w.status === "idle");
    // 워커 파일명은 디스크에서 온 값이지만 여기서 실행되는 건 셸 스크립트다 — `runWorker`와
    // 같은 방어를 지난다(§경로 방어). 조립한 문자열을 믿지 않고 workers/ 안인지 확인한다.
    if (!idle || !NAME_RE.test(idle.name)) return null;
    const file = await resolveWithin(path.join(root, "workers"), `${idle.name}.sh`);
    spawn(file, [], { detached: true, stdio: "ignore" }).unref();
    return idle.name;
  } catch {
    return null; // 액션은 kick 실패로 실패하지 않는다
  }
}
