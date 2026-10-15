"use client";

/** 디스패치 멈춤 버튼 - 다음 디스패치 시계 바로 뒤 (DESIGN.md §P501 §화면).
 *  멎음이 `null`이면 안 그린다. 값은 서버가 보드 폴링에 실어 보낸다(새 폴링 0). 판정은 `judgeStall`. */
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { stallLine, stallTodo, type Stall } from "@/lib/dispatch-stall";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function StallButton({ stall, project, locale }: { stall: Stall | null; project: string; locale: Locale }) {
  if (!stall) return null;
  const line = stallLine(locale, stall.reason, stall.params);
  const todo = stallTodo(locale, stall.reason, stall.params);
  const base = `/p/${project}`;
  const link =
    stall.reason === "priority"
      ? { href: `${base}/tickets/${stall.params.hash}`, label: t(locale, "stall.link.ticket") }
      : stall.reason === "noCandidate"
        ? { href: `${base}/board?status=awaiting`, label: t(locale, "stall.link.awaiting") }
        : stall.reason === "notWaking"
          ? { href: `${base}/workers`, label: t(locale, "stall.link.workers") }
          : null;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${t(locale, "stall.ariaPrefix")} ${line}`}
        className="min-w-0 truncate text-left text-xs text-muted-foreground"
      >
        <span className="text-foreground">{t(locale, "stall.label")}</span> {line}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[90vw] gap-2 text-xs">
        <p className="font-medium">{line}</p>
        <p>{todo}</p>
        {link && (
          <Link href={link.href} className="underline">
            {link.label}
          </Link>
        )}
        <div className="border-t pt-2">
          <p className="text-muted-foreground">{t(locale, "stall.workers")}</p>
          <ul className="space-y-1">
            {stall.perWorker.map((w) => (
              <li key={w.name}>
                <span className="font-mono">{w.name}</span> - {stallLine(locale, w.reason, w.params)}
                {w.raw && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">{t(locale, "stall.raw")}</summary>
                    <code className="block break-all font-mono">{w.raw}</code>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
        {stall.watchdog.length > 0 && (
          <div className="border-t pt-2">
            <p className="text-muted-foreground">{t(locale, "stall.watchdog.heading")}</p>
            {stall.watchdog.map((d) => (
              <p key={`${d.code}${d.text}`}>
                {d.code} {d.text}
              </p>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
