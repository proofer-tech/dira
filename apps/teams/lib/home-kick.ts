/** 홈 대화 입구의 즉시 디스패치 (DESIGN.md §P498 결정 3). 세션이 `Write`로 요구 파일을 만들 뿐이라
 *  디스패치는 앱이 한다 - 턴이 끝난 뒤 그 턴 스냅샷이 준 새 티켓 해시로 열린 파일이 생겼으면 부른다.
 *  파일이 없거나(요구를 안 만든 턴) 이미 `.wip`이면 안 부른다. 던지지 않는다(kick.ts 계약). */
import { existsSync } from "node:fs";
import path from "node:path";
import { kickRequest } from "./kick.ts";

/** 스냅샷 문자열의 "새 요구사항 티켓 해시" 줄에서 8-hex를 꺼낸다. 큐를 못 읽은 스냅샷에는 줄이 없다. */
export function newHashOf(snapshot: string): string | null {
  return /새 요구사항 티켓 해시[^\n]*`([0-9a-f]{8})`/.exec(snapshot)?.[1] ?? null;
}

/** 부르면 true. `kick`은 테스트용 주입이다. */
export async function kickNewRequest(
  root: string,
  snapshot: string,
  kick: (root: string, hash: string) => Promise<boolean> = kickRequest,
): Promise<boolean> {
  try {
    const hash = newHashOf(snapshot);
    if (!hash || !existsSync(path.join(root, "tickets", `${hash}.md`))) return false;
    await kick(root, hash);
    return true;
  } catch {
    return false;
  }
}
