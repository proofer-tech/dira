"use client";

/** 레이아웃 기록기(P549 결정 4). 테마-사이드바-화면-큰 패널 폭이 바뀌면 `localStorage` `dira-layout`에
 *  쓰고, 데스크톱 앱이면 `dira.saveLayout`으로 main에도 넘긴다. 쓰기는 마지막 쓰기와 1초 이상 띄운다. */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LAYOUT_KEY, serializeLayout } from "@/lib/layout-record";
import { screenOf } from "@/lib/urls";

/** 지금 DOM에서 치수를 읽는다. 브라우저 전용. */
function readLayout(pathname: string): string | null {
  const dark =
    document.documentElement.classList.contains("dark") || matchMedia("(prefers-color-scheme: dark)").matches;
  const sb = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
  const main = document.querySelector("main");
  return serializeLayout({
    theme: dark ? "dark" : "light",
    sidebar: {
      width: sb?.offsetWidth ?? 0,
      collapsed: /(?:^|; )sidebar_state=false/.test(document.cookie),
    },
    screen: screenOf(pathname),
    panes: { main: main?.clientWidth ?? 0 },
  });
}


export function LayoutRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    let last = 0;
    let prev = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      timer = undefined;
      const json = readLayout(pathname);
      if (!json || json === prev) return;
      prev = json;
      last = Date.now();
      try { localStorage.setItem(LAYOUT_KEY, json); } catch { /* 저장소 거부 */ }
      window.dira?.saveLayout?.(json);
    };
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(write, Math.max(300, 1000 - (Date.now() - last)));
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    // ponytail: 사이드바 접힘은 쿠키라 변화 신호가 없어 data-state 변경을 body 하위에서 본다
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", schedule);
    addEventListener("resize", schedule);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", schedule);
      removeEventListener("resize", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);
  return null;
}
