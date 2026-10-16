"use client";

/** 마이그레이션 블러 오버레이 (DESIGN.md P505 "화면 (오버레이)").
 *
 *  보이는 조건과 걷힘 시점은 `lib/migration-view.ts`의 순수 판정이다. 폴링은 5초, 보이는 동안 1초.
 *  뒤 화면은 클릭 - 스크롤 - 키 입력이 못 닿는다: 전체를 덮는 레이어가 포인터를 받고, 키보드는
 *  문서 캡처 리스너가 Esc를 먹고 Tab을 오버레이 안에 가둔다. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/components/language-provider";
import {
  mmss, overlayShown, needsOverlay, waitExpired, CLOSE_DELAY_MS,
  type MigrationRow, type MigrationStatus,
} from "@/lib/migration-view";

const fill = (text: string, p: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => String(p[k] ?? m));

export function MigrationOverlay() {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState<MigrationRow[] | undefined>();
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const was = useRef(false);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/migrations", { cache: "no-store" });
      if (!r.ok) return;
      const body = (await r.json()) as { status: MigrationStatus | null };
      const next = body.status?.rows;
      const needs = needsOverlay(next);
      if (was.current && !needs) setDoneAt(Date.now());
      was.current = needs;
      setRows(next);
    } catch {
      /* 서버가 잠깐 없다 - 다음 폴링이 다시 본다 */
    }
  }, []);

  const shown = overlayShown(rows, doneAt, now);
  useEffect(() => {
    void poll();
  }, [poll]);
  useEffect(() => {
    const id = setInterval(() => void poll(), shown ? 1000 : 5000);
    return () => clearInterval(id);
  }, [poll, shown]);
  useEffect(() => {
    if (doneAt === null) return;
    setNow(Date.now());
    const id = setTimeout(() => setNow(Date.now()), CLOSE_DELAY_MS + 20);
    return () => clearTimeout(id);
  }, [doneAt]);

  useEffect(() => {
    if (!shown) return;
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Tab") {
        const f = [...(root.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (f.length === 0) return e.preventDefault();
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      } else if (!root.current?.contains(e.target as Node)) {
        e.stopPropagation(); // 뒤 화면의 단축키가 못 듣는다
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!root.current?.contains(e.target as Node)) root.current?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [shown]);

  const post = (action: "retry" | "skip" | "wait", key: string) =>
    fetch("/api/migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, key }),
    }).then(poll);

  if (!shown || !rows) return null;
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("migration.title")}
      data-testid="migration-overlay"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/60 backdrop-blur-md outline-none"
    >
      <div className="max-h-[80vh] w-[min(40rem,92vw)] overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">{t("migration.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("migration.subtitle")}</p>
        <ul className="mt-4 space-y-3">
          {[...rows].sort((a, b) => +(b.key === "machine") - +(a.key === "machine")).map((r) => (
            <Row key={r.key} r={r} t={t} en={locale === "en"} post={post} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Row({ r, t, en, post }: {
  r: MigrationRow;
  t: (k: string) => string;
  en: boolean;
  post: (a: "retry" | "skip" | "wait", key: string) => Promise<void>;
}) {
  const name = r.key === "machine" ? t("migration.machine") : r.name;
  const expired = waitExpired(r);
  return (
    <li className="text-sm" data-state={r.state}>
      <div className="flex items-center gap-2">
        {r.state === "진행" ? <Loader2 className="size-4 animate-spin" /> : r.state === "완료" ? <Check className="size-4" /> : (
          <span className={`size-2 rounded-full ${r.state === "실패" ? "bg-destructive" : "bg-muted-foreground/50"}`} />
        )}
        <span className="font-medium">{name}</span>
      </div>
      <div className="ml-6 text-muted-foreground">
        {r.state === "대기" && t("migration.state.waiting")}
        {r.state === "세션 대기" && fill(t("migration.state.sessions"), { n: r.sessions, time: mmss(r.waited_s) })}
        {r.state === "진행" && <><code>{r.item}</code> {en ? r.desc_en : r.desc}</>}
        {r.state === "완료" && t("migration.state.done")}
        {r.state === "건너뜀" && t("migration.state.skipped")}
        {r.state === "실패" && (
          <div className="space-y-1">
            <div className="text-destructive">{r.error}</div>
            <div className="break-all select-text">{t("migration.log")}: {r.log}</div>
            {r.backup && <div className="break-all select-text">{t("migration.backup")}: {r.backup}</div>}
          </div>
        )}
      </div>
      {(r.state === "실패" || expired) && (
        <div className="ml-6 mt-2 flex gap-2">
          {r.state === "실패" && <Button size="sm" onClick={() => post("retry", r.key)}>{t("migration.retry")}</Button>}
          {expired && <Button size="sm" onClick={() => post("wait", r.key)}>{t("migration.wait")}</Button>}
          {r.key !== "machine" && (
            <Button size="sm" variant="outline" onClick={() => post("skip", r.key)}>{t("migration.skip")}</Button>
          )}
        </div>
      )}
    </li>
  );
}
