"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/language-provider";

// 셸에서 실제로 손이 닿는 곳만 여기 있다. 나머지(사이드바·아웃라인·이전/다음·코드블록)는
// 전부 서버가 굽는다 — 이 파일이 클라이언트로 나가는 전부다.
// 상태를 React가 안 든다. 셋 다 `<html>`의 클래스 하나를 뒤집고 나머지는 CSS가 한다 —
// 서랍을 열려고 사이드바를 클라이언트 컴포넌트로 끌어올리지 않아도 되는 자리다.
const flip = (c: string) => document.documentElement.classList.toggle(c);

export const THEME_KEY = "dira-manual-theme";

/** 첫 페인트 전에 `<html>.dark`를 정한다. 이 문자열이 산출 HTML의 첫 `<script>`로 나가고,
 *  없으면 다크를 고른 사람이 매 이동마다 흰 화면을 한 번 본다. */
export const NO_FLASH = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))
document.documentElement.classList.add("dark")}catch(e){}`;

export function DarkToggle() {
  const t = useT();
  // 서버는 어느 모드인지 모른다. 아이콘은 CSS가 고르므로 화면은 안 깜빡이고, `aria-checked`만
  // 붙고 나서 맞춘다.
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      type="button"
      className="appearance"
      role="switch"
      aria-checked={dark}
      aria-label={t("manualShell.darkToggleAriaLabel")}
      onClick={() => {
        const on = flip("dark");
        setDark(on);
        try {
          localStorage.setItem(THEME_KEY, on ? "dark" : "light");
        } catch {
          /* 사파리 프라이빗에서 던진다. 이번 세션만 안 남을 뿐이라 삼킨다. */
        }
      }}
    >
      <svg className="sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}

/** `<768`에서 네브 메뉴 둘을 접었다 편다. */
export function NavToggle() {
  const t = useT();
  return (
    <button
      type="button"
      className="hamburger"
      aria-label={t("manualShell.navToggleAriaLabel")}
      onClick={() => flip("nav-open")}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1 4h14M1 8h14M1 12h14" />
      </svg>
    </button>
  );
}

/** `<960`에서 사이드바 서랍을 여는 유일한 손잡이다. */
export function MenuToggle() {
  const t = useT();
  return (
    <button
      type="button"
      className="menu-btn"
      aria-label={t("manualShell.menuToggleAriaLabel")}
      onClick={() => flip("sidebar-open")}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1 4h14M1 8h14M1 12h14" />
      </svg>
      {t("manualShell.menuLabel")}
    </button>
  );
}

/** 그리는 것이 없다. 위임 클릭(복사)과 아웃라인 현재 항목 둘만 건다. */
export function Behaviors() {
  const t = useT();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const backdrop = target.closest(".backdrop");
      if (backdrop) return void flip("sidebar-open");
      const btn = target.closest<HTMLButtonElement>("button.copy");
      if (!btn) return;
      const pre = btn.parentElement?.querySelector("pre");
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent ?? "").then(() => {
        btn.textContent = t("manualShell.copiedLabel");
        setTimeout(() => (btn.textContent = t("manualShell.copyLabel")), 1500);
      });
    };
    document.addEventListener("click", onClick);

    // 아웃라인 현재 항목. 헤딩이 위쪽 경계를 지날 때마다 마지막으로 지난 것을 켠다.
    // ponytail: 관찰 대상이 페이지당 2~9개다. 늘면 rootMargin 대신 스크롤 위치로 잰다.
    const heads = [...document.querySelectorAll<HTMLElement>(".doc h2[id]")];
    const links = new Map(
      [...document.querySelectorAll<HTMLAnchorElement>(".outline a")].map((a) => [
        decodeURIComponent(a.hash.slice(1)),
        a,
      ]),
    );
    const io = new IntersectionObserver(
      () => {
        const top = 80;
        const cur = heads.filter((h) => h.getBoundingClientRect().top <= top).pop() ?? heads[0];
        for (const [id, a] of links) a.classList.toggle("on", id === cur?.id);
      },
      { rootMargin: "-80px 0px 0px 0px", threshold: [0, 1] },
    );
    for (const h of heads) io.observe(h);

    return () => {
      document.removeEventListener("click", onClick);
      io.disconnect();
    };
  }, [t]);
  return null;
}
