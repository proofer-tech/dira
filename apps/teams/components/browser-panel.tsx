"use client";

/** 홈 `browser` 탭 하나가 그리는 실제 화면 (DESIGN.md §11-11 결정 2 · 6). `cdp/[hash]` GET을
 *  읽어 프레임을 `<img>`에 그리고(선례는 `terminal-panel.tsx`의 pty 스트림 배선), 그 위에
 *  **랩 레이어 세 상태**(막힘 - 경고 - 걷힘)를 얹는다 — 사람이 그린 그림 그대로다(결정 6).
 *
 *  **마운트할 때마다 막힘이다** — 걷힌 상태를 어디에도 안 남긴다(결정 6 §저장하지 않는다).
 *  탭을 닫으면(부모가 이 컴포넌트를 언마운트한다) 다음에 열 때 새 인스턴스가 다시 막힘으로
 *  시작한다. `TerminalSurface`처럼 탭을 오가는 동안(표면 전환)은 `hidden`으로만 접히므로
 *  그 사이에는 걷힌 상태가 유지된다 — 결정 6이 요구하는 것은 새로고침·탭 닫기 재시작 둘뿐이다. */
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/language-provider";
import { readCdpFrameStream } from "@/lib/cdp-relay";
import { keyBody, mouseButtonBody, scaleToFrame, wheelBody, type KeyCdpBody, type MouseCdpBody } from "@/lib/browser-input";
import { Button } from "@/components/ui/button";

function postInput(url: string, body: MouseCdpBody | KeyCdpBody): void {
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

export function BrowserMirror({ projectId, hash }: { projectId: string; hash: string }) {
  const t = useT();
  const url = `/p/${projectId}/cdp/${hash}`;
  const [frame, setFrame] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      let res: Response;
      try {
        res = await fetch(url, { signal: ac.signal });
      } catch {
        return; // abort(언마운트) — 조용히 물러난다
      }
      const outcome = await readCdpFrameStream(res, (b64) => setFrame(b64), ac.signal);
      if (outcome === "disconnected") setLost(true);
    })();
    return () => ac.abort();
  }, [url]);

  // 걷힌 동안 포커스를 미러로 옮긴다 — 곧바로 키가 들어간다(§11-11 결정 6 §승인하면 걷힌다).
  useEffect(() => {
    if (unlocked) containerRef.current?.focus();
  }, [unlocked]);

  const point = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    return scaleToFrame(
      clientX,
      clientY,
      img.getBoundingClientRect(),
      { width: img.naturalWidth || 1, height: img.naturalHeight || 1 },
    );
  };

  if (lost) {
    return <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">{t("terminal.disconnected")}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* §11-11 결정 6 §승인하면 걷힌다 — `입력 열림` 표식 + `다시 잠그기`가 몸통 머리 줄에 선다. */}
      {unlocked && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5">
          <span className="text-xs font-medium">{t("browser.wrap.unlocked")}</span>
          <Button size="xs" variant="outline" onClick={() => setUnlocked(false)}>
            {t("browser.wrap.lock")}
          </Button>
        </div>
      )}
      <div
        ref={containerRef}
        tabIndex={unlocked ? 0 : -1}
        className="relative min-h-0 flex-1 bg-black outline-none"
        onKeyDown={(e) => {
          if (!unlocked) return;
          e.preventDefault();
          postInput(url, keyBody("keydown", e.key, e.code));
        }}
        onKeyUp={(e) => {
          if (!unlocked) return;
          e.preventDefault();
          postInput(url, keyBody("keyup", e.key, e.code));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- base64 데이터 URL, `next/image`의 최적화 대상이 아니다 */}
        <img
          ref={imgRef}
          alt=""
          src={frame ? `data:image/jpeg;base64,${frame}` : undefined}
          className="h-full w-full object-contain"
        />
        {/* 랩 레이어(§11-11 결정 6) — 막힌 동안은 투명한 이 층이 전부를 받는다. 걷힌 동안에는
            이 층이 곧 입력 캡처 표면이다(이미지 자신은 상호작용 요소가 아니다 — 마우스·휠을
            여기서 잡아 POST로 옮긴다). */}
        <div
          className="absolute inset-0"
          onClick={() => {
            if (unlocked) return;
            if (window.confirm(t("browser.wrap.confirm"))) setUnlocked(true);
          }}
          onMouseDown={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, mouseButtonBody("mousedown", e.button, x, y));
          }}
          onMouseUp={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, mouseButtonBody("mouseup", e.button, x, y));
          }}
          onMouseMove={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, mouseButtonBody("mousemove", e.button, x, y));
          }}
          onWheel={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, wheelBody(x, y, e.deltaX, e.deltaY));
          }}
        />
      </div>
    </div>
  );
}
