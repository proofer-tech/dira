/** 링크 클릭 하나를 어디로 보낼지 고르는 순수 판정(DESIGN.md §P449 결정 2) — 앱 창 클릭
 *  리스너(`link-interceptor.tsx`)와 터미널 링크(`terminal-panel.tsx`)가 같이 쓴다. Cmd
 *  (`metaKey`)나 Ctrl(`ctrlKey`)을 누른 채 눌렀으면 내장 브라우저(`openLink`)를 건너뛰고
 *  `window.open`으로 기본 브라우저에 넘긴다. 판정과 실행을 한 함수에 묶어 두 호출부가 분기
 *  로직을 각자 베끼지 않게 한다. */
export function dispatchLinkClick(
  mods: { metaKey: boolean; ctrlKey: boolean },
  url: string,
  openLink: () => void,
  windowOpen: (url: string, target: string, features: string) => void,
): void {
  if (mods.metaKey || mods.ctrlKey) {
    windowOpen(url, "_blank", "noopener");
    return;
  }
  openLink();
}
