"use client";

/** 다음 디스패치까지 남은 초 — idle 워커 풀 뒤에 뜬다 (DESIGN.md §1-6).
 *
 *  서버는 idle 워커마다 cron 주기(30·60)만 내려준다 — 값 자체(`secondsLeft`, `lib/next-dispatch.ts`)는
 *  클라이언트가 벽시계로 1초마다 다시 잰다. 서버 왕복 0회 · 새 폴링 0개(§1-6 §갱신).
 *  `periods`가 비어 있으면(idle 워커 0개) 아무것도 그리지 않는다(§1-6 §뜨는 조건). */
import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { secondsLeft } from "@/lib/next-dispatch";

export function NextDispatch({ periods, locale }: { periods: readonly (30 | 60)[]; locale: Locale }) {
  const key = periods.join(",");
  const [left, setLeft] = useState(() => secondsLeft(periods));

  useEffect(() => {
    setLeft(secondsLeft(periods));
    const timer = setInterval(() => setLeft(secondsLeft(periods)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key`가 `periods`의 값을 대표한다(배열 참조는 매 렌더 갈린다)
  }, [key]);

  if (left === null) return null;

  return (
    <span className="shrink-0 tabular-nums" title={t(locale, "statusbar.nextDispatch.title")}>
      {t(locale, "statusbar.nextDispatch.prefix")} {left}
      {t(locale, "statusbar.nextDispatch.suffix")}
    </span>
  );
}
