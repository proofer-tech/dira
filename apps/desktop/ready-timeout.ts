// §데스크톱 앱 준비 타임아웃 화면 — 자식이 준비 전에 죽은 경우와 살아 있는 채 응답만 없는
// 경우를 사유 문장과 행동 단서로 가른다. 실제 사례는 macOS trustd가 먹통이라 Electron
// Helper가 코드서명 확인에서 멈췄는데 stderr는 비어 있었다 — 그 자리를 이 판정이 메운다.
// 스펙: ../../docs/DESIGN.md §데스크톱 앱 (Electron) §고정하는 것 2.
//
// 이 파일은 electron도 자식 프로세스도 만지지 않는다. 판정 둘 다 입력값만 보는 순수 함수라
// `ready-timeout.test.ts`가 자식도 네트워크도 없이 두 갈래를 검증한다 — `revive.ts`와 같은
// 관용구다.

export type ReadyTimeoutState =
  | { kind: "exited"; code: number | null; signal: string | null }
  | { kind: "hung"; pid: number | undefined; stdoutTail: string };

/** 실패 화면 첫 줄. 준비 전에 죽었으면 종료 코드를 적고, 살아 있는 채 시간이 다 됐으면 그
 *  사실과 PID를 적는다 — 문장이 달라야 사람이 화면만 보고 두 사고를 가른다. */
export function describeReadyTimeout(timeoutSec: number, origin: string, state: ReadyTimeoutState): string {
  if (state.kind === "exited") {
    return `서버 프로세스가 준비되기 전에 종료했습니다 (code ${state.code ?? state.signal ?? "?"})`;
  }
  return `프로세스는 살아 있으나 응답하지 않음 (PID ${state.pid ?? "?"}) — ${timeoutSec}초 안에 ${origin}/ 가 응답하지 않았습니다`;
}

/** 살아 있는 채 멈춘 경우에만 다음 행동 단서를 만든다. 죽은 경우는 종료 코드가 이미 사유
 *  문장에 있어 따로 적을 것이 없다(빈 문자열 — `showFailure`가 그 블록을 통째로 건너뛴다). */
export function readyTimeoutHint(state: ReadyTimeoutState): string {
  if (state.kind === "exited") return "";
  const tail = state.stdoutTail.trim();
  return `표준출력 마지막 줄:\n${tail || "(비어 있음)"}\n\n멈춘 위치를 보는 명령:\nsample ${state.pid ?? "<PID>"} 1000`;
}
