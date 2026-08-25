// §데스크톱 앱 고정하는 것 9 — 기동 뒤에 죽은 것(렌더러 · 로드 · 자식 서버)을 보고 되살린다.
// 스펙: ../../docs/DESIGN.md §데스크톱 앱 (Electron) §고정하는 것 9.
//
// 이 파일은 electron도 자식 프로세스도 만지지 않는다. 판정 둘 다 입력값만 보는 순수 함수라
// `revive.test.ts`가 창도 자식도 없이 분기 전부를 밟는다 — `release-notes.ts`와 같은 관용구다.

export type ReviveAction = "show" | "reload-window" | "restart-server";

/** 창 파괴 여부 · 콘텐츠(렌더러/로드) 사망 여부 · 서버 생사, 셋을 보고 갈린다. 셋 다
 *  안 죽었으면 그냥 보여준다 — 되살릴 것이 없다. 하나라도 죽었으면(서버만 죽은 경우도
 *  포함이다 — 창은 멀쩡해도 죽은 서버를 보고 있던 것이다) 서버 생사 하나로 갈린다 —
 *  살아 있으면 창만 다시 읽고, 죽어 있으면 자식부터 다시 띄운다. */
export function decideRevive(state: { winDestroyed: boolean; contentDead: boolean; serverAlive: boolean }): ReviveAction {
  if (!state.winDestroyed && !state.contentDead && state.serverAlive) return "show";
  return state.serverAlive ? "reload-window" : "restart-server";
}

/** 자식의 `exit`가 우리가 `killServer()`로 먼저 지운 것인지, 밖에서 죽은 것인지. `killServer()`가
 *  죽이기 직전에 그 자식을 `killedIntentionally`에 적어 두므로, 이 exit의 주인공이 그 참조와
 *  같으면 우리가 벌인 일이고 다르면(= `null`이거나 다른 자식이 적혀 있으면) 밖에서 죽은 것이다. */
export function isExternalDeath(exited: unknown, killedIntentionally: unknown): boolean {
  return exited !== killedIntentionally;
}
