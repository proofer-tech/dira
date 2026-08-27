// 렌더러가 얻는 것은 이 함수 하나다 — `ipcRenderer`도 `fs`도 넘기지 않는다
// (DESIGN.md §데스크톱 앱 N3 · 고정하는 것 4). 오가는 값은 경로 문자열 하나뿐이다.
//
// 확장자가 `.ts`가 아닌 이유(§데스크톱 앱 파일 표는 `preload.ts`라고 적혀 있다): preload는
// 렌더러 프로세스가 읽으므로 **Node의 타입 스트리핑을 안 거친다.** 실측 — 타입 표기 한 줄
// (`const n: number = 42`)을 넣은 `.ts` preload는 조용히 실패해 `window.probe`가 undefined였고,
// 같은 파일에서 그 표기만 빼면 42가 나왔다(Electron 40). 계약(contextBridge 하나)은 그대로다.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dira", {
  /** 네이티브 경로 다이얼로그. 고른 절대경로 하나, 취소면 null. */
  pickPath: (mode) => ipcRenderer.invoke("dira:pick-path", mode),
  /** §릴리스 · 자동 업데이트 T7 — 인자는 미리 아는 이름 하나("state"·"notes"·"restart"·"later")다. */
  updateAction: (action) => ipcRenderer.invoke("dira:update-action", action),
});
