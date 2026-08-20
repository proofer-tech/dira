/** 보드 이른 갱신 — revision 카운터 (DESIGN.md §아키텍처 §보드 갱신, 요구 `7cd6dea2`).
 *
 *  큐 티켓 디렉터리 하나당 `fs.watch` 하나를 걸고, 이벤트마다 정수를 하나 올린다. 프로젝트
 *  root로 키를 잡은 모듈 전역 맵이고, 처음 물어본 요청이 만들고 닫지 않는다(상한이 등록
 *  프로젝트 수라 사람 손이 정한다) — 선례는 `machine-state.ts`의 `g.__diraMachineTimer`다.
 *  §아키텍처의 "모듈 전역에 현재 프로젝트를 두지 않는다"를 어기지 않는다: 담는 것은 현재
 *  프로젝트가 아니라 **프로젝트별 카운터**이고, 읽기는 여전히 root를 인자로 받는다.
 *
 *  워처가 죽으면(디렉터리가 사라짐 등) 맵에서 지운다 — 다음 호출이 새로 건다. 그 창 동안
 *  카운터는 그냥 안 오를 뿐이라 보드는 5초 바닥으로 계속 따라간다(회귀 없음). */
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

export type Watcher = Pick<FSWatcher, "on" | "unref" | "close">;
export type WatchFn = (dir: string, onEvent: () => void) => Watcher;

type Entry = { rev: number; watcher: Watcher };
type Globals = { __diraBoardRevision?: Map<string, Entry> };
const g = globalThis as unknown as Globals;

function registry(): Map<string, Entry> {
  if (!g.__diraBoardRevision) g.__diraBoardRevision = new Map();
  return g.__diraBoardRevision;
}

/** 지금 revision. 그 root의 워처가 없으면 여기서 건다. `workers/`는 절대 안 건다 —
 *  러너 로그가 초당 여러 번 자라 250ms 폴이 전체 렌더를 초당 네 번 부르게 된다.
 *
 *  `watchImpl`은 테스트 주입용(선례: `machine-state.ts`의 `startHeartbeat(deps)`) — 실제
 *  `fs.watch` 이벤트 지연(실측 12~27ms)을 기다리지 않고 카운팅 로직만 결정적으로 검증한다. */
export function boardRevision(root: string, watchImpl: WatchFn = watch as unknown as WatchFn): number {
  const reg = registry();
  const hit = reg.get(root);
  if (hit) return hit.rev;

  const entry: Entry = { rev: 0, watcher: null as unknown as Watcher };
  try {
    entry.watcher = watchImpl(path.join(root, "tickets"), () => {
      entry.rev++;
    });
  } catch {
    return 0; // 디렉터리가 아직 없거나 못 읽는다 — 캐시하지 않고 다음 호출이 다시 시도한다
  }
  entry.watcher.on("error", () => {
    entry.watcher.close();
    reg.delete(root);
  });
  entry.watcher.unref();
  reg.set(root, entry);
  return entry.rev;
}
