// §데스크톱 앱 고정하는 것 4 — 창은 자기가 지금 떠 있는 오리진 안의 주소만 그 안에서 열고,
// 그 밖의 http(s) 주소만 기본 브라우저로 보낸다.
// 스펙: ../../docs/DESIGN.md §데스크톱 앱 (Electron) §고정하는 것 4.
//
// 판정은 입력값(url·지금 오리진)만 보는 순수 함수다 — 오리진을 창을 만들 때 받은 값으로
// 굳혀 두지 않고 부를 때마다 이 함수에 지금 값을 넘기면, 되살리기로 포트가 바뀐 뒤에도
// 새 오리진의 주소는 internal로, 옛 오리진의 주소는 external로 갈린다 (`revive.ts`와 같은 관용구).

export type LinkAction = "internal" | "external" | "ignore";

/** url이 지금 오리진 안이면 그 안에서 열고(internal), 밖의 http(s)면 기본 브라우저로
 *  보내고(external), 그 밖의 스킴은 아무것도 안 한다(ignore) — 거부·허용 판정 자체는
 *  종전 그대로다. */
export function classifyLink(url: string, origin: string): LinkAction {
  if (url === origin || url.startsWith(`${origin}/`)) return "internal";
  const u = URL.parse(url);
  return u && (u.protocol === "http:" || u.protocol === "https:") ? "external" : "ignore";
}
