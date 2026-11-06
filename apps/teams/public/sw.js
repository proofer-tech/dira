// dira 서비스 워커 (P549 결정 3). 의존성 없음. 분류는 sw-route.js 한 곳이다.
// 캐시 이름에 앱 버전을 넣는다: 등록이 /sw.js?v=<버전>으로 하므로 버전이 바뀌면 새 워커가 설치된다.
importScripts("/sw-route.js");
var VERSION = new URL(self.location.href).searchParams.get("v") || "0";
var CACHE = "dira-static-" + VERSION;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(["/offline.html", "/boot-shell.html", "/icon.svg"]); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("dira-static-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var kind = classifyRequest(e.request, self.location.origin);
  if (kind === "static") {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (res) { if (res.ok) c.put(e.request, res.clone()); return res; });
      });
    }));
  } else if (kind === "navigate") {
    // 연결 실패(fetch 거부)일 때만 셸을 낸다. 서버가 5xx를 주면 그 응답이 그대로 간다.
    e.respondWith(fetch(e.request).catch(function () { return caches.match("/offline.html"); }));
  }
});
