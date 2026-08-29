"use client";

/** 이른 갱신 폴 조각 — `BoardPolling`에서 뗀 1초 축을 화면 여섯이 나눠 쓴다
 *  (DESIGN.md §이른 갱신이 붙는 화면 §개정 1 · 3, 요구 `de0b759d`).
 *
 *  `/api/revision`이 주는 메모리 안 정수를 1초마다 묻고 **갈린 회차에만** `router.refresh()`를
 *  부른다. 기준선은 서버가 그린 시점의 `rev`라 첫 회차가 무조건 재렌더를 부르지 않는다 —
 *  `BoardPolling`·(종전) `WipBodyPolling`과 같은 자리다. 숨은 탭은 아무것도 안 하고, 앞 왕복이
 *  끝난 뒤에 다음을 예약한다(겹친 왕복이 같은 변경에 `router.refresh()`를 두 번 부르는 것을 막는다).
 *
 *  **5초 바닥은 여기 없다**(§개정 2) — 보드만 `BoardPolling`에서 그 바닥을 따로 얹는다. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function EarlyRefreshPolling({ project, rev }: { project: string; rev: number }) {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let since = rev;
    const poll = async () => {
      try {
        if (!document.hidden) {
          const r = await fetch(`/api/revision?project=${encodeURIComponent(project)}`).then(
            (res) => res.json() as Promise<{ rev: number }>,
          );
          if (stop) return;
          if (r.rev !== since) {
            since = r.rev;
            router.refresh();
          }
        }
      } catch {
        // 이 왕복 하나만 버린다 — 한 회차 실패로 폴링까지 끊기지 않는다.
      }
      if (!stop) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [project, rev, router]);

  return null;
}
