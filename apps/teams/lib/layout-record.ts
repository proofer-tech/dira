// 레이아웃 기록(P549 결정 4): 큰 상자의 치수와 선택 상태뿐이다. 티켓 이름-숫자-문구 같은 값은
// 구조상 들어갈 자리가 없다: 아는 키만 고른 새 객체를 만들고 모르는 키는 버린다.

export const LAYOUT_KEY = "dira-layout";

export type LayoutRecord = {
  v: 1;
  theme: "light" | "dark";
  sidebar: { width: number; collapsed: boolean };
  screen: string | null;
  panes: Record<string, number>;
};

const SCREENS = new Set(["root", "home", "ticket", "personas", "workers", "protocols", "ontology", "board"]);
const dim = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 10000) : 0);

/** 입력에서 아는 키만 골라 직렬화한다. 형태가 틀리면 null이다. */
export function serializeLayout(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const i = input as Record<string, unknown>;
  const sb = (typeof i.sidebar === "object" && i.sidebar !== null ? i.sidebar : {}) as Record<string, unknown>;
  const panes: Record<string, number> = {};
  if (typeof i.panes === "object" && i.panes !== null) {
    for (const k of ["main"]) {
      const n = (i.panes as Record<string, unknown>)[k];
      if (typeof n === "number") panes[k] = dim(n);
    }
  }
  const rec: LayoutRecord = {
    v: 1,
    theme: i.theme === "dark" ? "dark" : "light",
    sidebar: { width: dim(sb.width), collapsed: sb.collapsed === true },
    screen: typeof i.screen === "string" && SCREENS.has(i.screen) ? i.screen : null,
    panes,
  };
  return JSON.stringify(rec);
}
