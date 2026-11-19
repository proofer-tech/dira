/** 세션이 넘긴(`by=agent`, `pending`) 핸드오프의 알약 문구 - 대기 중인지 대기 종료인지(P567 결정 2).
 *  순수 함수라 화면이 `t`와 현재 시각을 넣어 부른다. `waitingUntil`이 없거나 지났으면 대기 종료다. */
import type { BrowserHandoff } from "./browser-pool.ts";

export function handoffWaitText(h: BrowserHandoff, nowSec: number, t: (key: string) => string): string {
  if (h.waitingUntil !== null && nowSec < h.waitingUntil) {
    return t("browser.handoff.waiting").replace("{m}", String(Math.ceil((h.waitingUntil - nowSec) / 60)));
  }
  const left = Math.max(0, Math.ceil((h.since + (h.ttl ?? 7200) - nowSec) / 60));
  const hh = Math.floor(left / 60);
  const text = t(hh > 0 ? "browser.handoff.ended" : "browser.handoff.endedMin");
  return text.replace("{h}", String(hh)).replace("{m}", String(left % 60));
}
