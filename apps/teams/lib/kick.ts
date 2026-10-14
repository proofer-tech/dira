/** 즉시 디스패치 (DESIGN.md §4-5). 사람의 조작이 큐에 **열린 티켓을 만들거나 되돌렸으면**
 *  공통 디스패치 모듈(`dispatch.py`, P489)을 부른다 — 워커를 고르는 판단은 그쪽 한 곳이고,
 *  여기는 사유(`direct`/`request`)와 해시만 넘긴다. cron이 다음 분에 할 실행을 지금 한다.
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
import { childEnv } from "./child-env.ts";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { isHash } from "./paths.ts";

/** `dispatch.py` 위치. 설치본은 `bin/engines/`에 있다(`bin`은 TICKET_LOCAL을 안 탄다 - tick.sh BIN_DIR).
 *  `DIRA_DISPATCH_PY`는 테스트와 개발용 덮어쓰기다. */
function dispatchPy(): string {
  return process.env.DIRA_DISPATCH_PY || path.join(os.homedir(), ".config", "dira", "bin", "engines", "dispatch.py");
}

/** `dispatch.py run <루트> --reason <사유> [--hash <해시>]`를 띄우고 잊는다(detach). 띄웠으면 true.
 *  **테스트용 값이고 호출자는 안 본다** - 띄울지 말지의 판단은 모듈이 하고 결과는 `runner.log`에 남는다.
 *  `hash`가 있으면 경로가 될 수 없는 8 hex여야 한다(신뢰 경계). */
function launch(root: string, reason: "direct" | "request", hash?: string): boolean {
  try {
    if (hash !== undefined && !isHash(hash)) return false;
    const args = [dispatchPy(), "run", root, "--reason", reason, ...(hash ? ["--hash", hash] : [])];
    const child = spawn("python3", args, { detached: true, stdio: "ignore", env: childEnv() });
    child.on("error", () => {}); // python3가 없어도 던지지 않는다 - cron이 같은 일을 한다
    child.unref();
    return true;
  } catch {
    return false; // 액션은 kick 실패로 실패하지 않는다
  }
}

/** 해시 없는 즉시 디스패치(`--reason direct`). 열린 티켓이 방금 생겼거나 되돌아왔을 때 부른다. */
export async function kickIdleWorker(root: string): Promise<boolean> {
  return launch(root, "direct");
}

/** 지목 디스패치(DESIGN.md §1-5 갈래 B) - 후보를 그 해시 하나로 좁힌다. */
export async function kickTicket(root: string, hash: string): Promise<boolean> {
  return launch(root, "direct", hash);
}

/** 요구(`kind: request`) 티켓을 만든 자리(P489). 모듈이 부하 - idle 워커 - 다른 후보 0건을 본다. */
export async function kickRequest(root: string, hash: string): Promise<boolean> {
  return launch(root, "request", hash);
}
