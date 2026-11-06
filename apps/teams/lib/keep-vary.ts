import { ServerResponse } from "node:http";

/** P548 결정 2 후속(`865118b4`). Next 16의 app-page 템플릿(`build/templates/app-page.js`)은 렌더 직전에
 *  `res.setHeader('Vary', rsc, next-router-...)`로 **덮어쓴다** - `proxy.ts`와 `next.config.ts`
 *  `headers()`가 단 `Vary: Accept-Language, Cookie`가 200 응답에서 사라지는 원인이다(실측: setHeader 추적).
 *  `Vary`는 넓히기만 하는 헤더라, 덮어쓰기를 합치기로 바꾸면 의미가 안 깨진다. Next가 고치면 이 파일을 지운다.
 *  // ponytail: 프로토타입 전역 패치. 응답 후처리 훅이 Next에 생기면 그쪽으로 옮긴다. */
const MARK = Symbol.for("dira.keepVary");

export function mergeVary(current: unknown, next: unknown): string {
  const flat = (v: unknown) => (Array.isArray(v) ? v.join(",") : v == null ? "" : String(v)).split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  return [...flat(current), ...flat(next)].filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).join(", ");
}

export function keepVary(proto: { setHeader: (...a: never[]) => unknown } = ServerResponse.prototype) {
  const p = proto as unknown as Record<symbol, boolean> & { setHeader: (this: ServerResponse, n: string, v: unknown) => unknown };
  if (p[MARK]) return;
  p[MARK] = true;
  const orig = p.setHeader;
  p.setHeader = function (name, value) {
    if (typeof name === "string" && name.toLowerCase() === "vary") value = mergeVary(this.getHeader("vary"), value);
    return orig.call(this, name, value);
  };
}
