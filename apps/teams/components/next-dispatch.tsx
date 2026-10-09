"use client";

/** 다음 디스패치까지 남은 초 — idle 워커 풀 앞 시계 아이콘이다 (DESIGN.md §1-6).
 *
 *  서버는 idle 워커마다 cron 주기(30·60)만 내려준다 — 값 자체(`secondsLeft`, `lib/next-dispatch.ts`)는
 *  클라이언트가 벽시계로 1초마다 다시 잰다. 서버 왕복 0회 · 새 폴링 0개(§1-6 §갱신).
 *  `periods`가 비어 있으면(idle 워커 0개) 호 없는 종전 `Clock`을 그린다(§1-6 §뜨는 조건). */
import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { Clock } from "lucide-react";
import { dispatchProgress } from "@/lib/next-dispatch";

export function NextDispatch({ periods, locale }: { periods: readonly (30 | 60)[]; locale: Locale }) {
  const key = periods.join(",");
  const [left, setLeft] = useState(() => dispatchProgress(periods));
  // `periods`가 갈리면(= `key`가 갈리면) 렌더 중에 바로 잰다 — 이펙트 안에서 동기 `setState`를
  // 하면 추가 렌더가 끼어든다(React 공식 패턴: "prop이 바뀌면 렌더 중에 state를 조정한다").
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setLeft(dispatchProgress(periods));
  }

  useEffect(() => {
    const timer = setInterval(() => setLeft(dispatchProgress(periods)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key`가 `periods`의 값을 대표한다(배열 참조는 매 렌더 갈린다)
  }, [key]);

  // idle 0개: 종전 아이콘 그대로(호 없음 - 툴팁 없음, P471 결정 1)
  if (left === null) return <Clock aria-hidden className="size-3 shrink-0" />;

  const first = `${t(locale, "statusbar.nextDispatch.prefix")} ${left.left}${t(locale, "statusbar.nextDispatch.suffix")}`;
  return (
    <span
      role="img"
      aria-label={first}
      title={`${first}\n${t(locale, "statusbar.nextDispatch.title")}`}
      className="inline-flex shrink-0"
    >
      {/* lucide Clock과 같은 윤곽. 깔린 원 opacity 0.3 + 12시부터 시계 방향 호. transition 없음 */}
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3">
        <circle cx="12" cy="12" r="10" opacity={0.3} />
        <circle cx="12" cy="12" r="10" pathLength={1} strokeDasharray={`${left.left / left.period} 1`} transform="rotate(-90 12 12)" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    </span>
  );
}
