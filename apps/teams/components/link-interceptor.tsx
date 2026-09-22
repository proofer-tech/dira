"use client";

/** 앱 창 링크 가로채기(DESIGN.md §11-15 결정 3) — 캡처 단계 클릭 리스너 하나가 `<a>` 클릭을
 *  잡는다. `href`의 스킴이 `http:` · `https:`고 오리진이 앱 자신이 아니면 기본 동작을 막고
 *  링크 슬롯(`c0ffee00`)으로 보낸다. 큐 내용의 링크와 제품이 자기 용도로 거는 링크(예:
 *  `feedback-dialog.tsx`가 아닌 다른 `<a>`)를 한 자리가 같이 잡는다(답 3(a)). 앱 안 경로
 *  (`/p/...`)와 앵커는 오리진이 같아서 그대로 지나간다.
 *
 *  **프로젝트 문맥이 없으면 안 잡는다** — `openLinkAction`이 `projectId`를 요구하는데
 *  `/market`처럼 프로젝트 밖 화면에서는 값이 없다. ponytail: 그 화면은 드물고 종전 기본
 *  동작(새 탭 · Electron `setWindowOpenHandler`)이 이미 있어서 별도 경로를 안 판다.
 *
 *  `app/(app)/layout.tsx`에 한 번 뜬다 — `<FeedbackDialog/>` · `<DesktopFindBar/>`와 같은
 *  자리(화면 하나마다 걸지 않고 셸에 한 벌)다. 랜딩 · 문서(`app/(site)`)는 별도 레이아웃이라
 *  이 컴포넌트가 아예 안 실린다(결정 3 §랜딩과 문서는 대상이 아니다). */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { openLink } from "@/components/browser-panel";
import { useLocale } from "@/components/language-provider";
import { useTrackedRouter } from "@/lib/route-pending";
import { projectIdFromPath } from "@/lib/urls";

export function LinkInterceptor() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useTrackedRouter();
  const projectId = projectIdFromPath(pathname);

  useEffect(() => {
    if (!projectId) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || !anchor.href) return;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin === window.location.origin) return;
      e.preventDefault();
      void openLink(projectId, url.href, locale, router.push);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [projectId, locale, router]);

  return null;
}
