// 서비스 워커의 요청 분류 (P549 결정 3). sw.js가 importScripts로 읽고, sw-route.test.ts가 require로 읽는다.
// 입력은 { method, url, mode, headers: { get } } 모양이면 된다(Request 그대로 넘겨도 된다).
// 반환: "static"(캐시 우선) | "navigate"(네트워크 우선, 연결 실패면 오프라인 셸) | "pass"(손대지 않는다).
// 데이터(API, RSC, 서버 액션, POST)는 절대 "pass" 밖으로 나가지 않는다 - 옛 값을 보이는 것은 회귀다.
function classifyRequest(req, origin) {
  if (req.method !== "GET") return "pass";
  var u;
  try { u = new URL(req.url); } catch (e) { return "pass"; }
  if (u.origin !== origin) return "pass";
  var p = u.pathname;
  if (p.indexOf("/api/") === 0 || p === "/api") return "pass";
  if (u.searchParams.has("_rsc")) return "pass";
  var h = req.headers;
  if (h && (h.get("RSC") || h.get("Next-Action") || h.get("Next-Router-State-Tree"))) return "pass";
  if (p.indexOf("/_next/static/") === 0 || p.indexOf("/fonts/") === 0 || p === "/icon.svg" || p === "/boot-shell.html" || p === "/offline.html") return "static";
  if (req.mode === "navigate") return "navigate";
  return "pass";
}
if (typeof module !== "undefined") module.exports = { classifyRequest: classifyRequest };
