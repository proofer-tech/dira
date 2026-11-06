"use client";

/** 서비스 워커 등록(P549 결정 3). `(app)` 레이아웃에서만 쓴다 - 공개 사이트 `(site)`에는 두지 않는다.
 *  버전을 쿼리로 실어 앱이 바뀌면 새 워커가 설치되고 옛 캐시가 지워진다. */
import { useEffect } from "react";

export function SwRegister({ version }: { version: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`).catch(() => {});
  }, [version]);
  return null;
}
