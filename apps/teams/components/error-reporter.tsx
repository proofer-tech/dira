"use client";

/** 렌더러 오류 수집(DESIGN.md §P513 결정 3 - 4). 브라우저는 서버 액션만 부르고 서버가 보낸다.
 *  `raw`는 콘솔 오류 최근 50건이다. */
import { useEffect } from "react";
import { reportRendererErrorAction } from "@/app/actions";

const consoleTail: string[] = [];
let tapped = false;

function tapConsole() {
  if (tapped) return;
  tapped = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      consoleTail.push(args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(" "));
      if (consoleTail.length > 50) consoleTail.shift();
    } catch {}
    orig(...args);
  };
}

export function reportRenderer(kind: "uncaught" | "unhandled_rejection" | "boundary", e: unknown): void {
  tapConsole();
  const err = e instanceof Error ? e : null;
  void reportRendererErrorAction({
    kind,
    message: err ? err.message : String(e),
    stack: err?.stack ?? "",
    raw: consoleTail.join("\n"),
  }).catch(() => {});
}

export function ErrorReporter() {
  useEffect(() => {
    tapConsole();
    const onError = (ev: ErrorEvent) => reportRenderer("uncaught", ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => reportRenderer("unhandled_rejection", ev.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
