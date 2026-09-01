/** 대기 -> 진행중 레인 드롭의 갈래 둘 (DESIGN.md §1-5 갈래 B·C).
 *
 *  `pnpm test` 글롭(`package.json`)은 `*.test.ts` + `lib/**\/*.test.ts`만 훑고 `app/**`은 안 본다
 *  — 그래서 판정을 `(board)/actions.ts`에 직접 두면 테스트가 안 잡는다. `sendInterject` 계열이
 *  이미 쓰는 규칙과 같다: **판정은 lib에 하나만 두고 액션은 부르기만 한다.**
 *
 *  idle 워커가 있으면 지목 kick(갈래 B), 없으면 `preempt --dryrun`으로 피해자를 물어 호출자에게
 *  돌려준다(갈래 C 1단계) — 확인 다이얼로그가 그 값으로 문장을 만든다. `confirmed`가 그 확인
 *  뒤의 재호출이다(갈래 C 2단계, `--dryrun` 없이 진짜로 끊는다). */
import { kickTicket } from "./kick.ts";
import { preempt } from "./engine.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { listWorkers } from "./workers.ts";

export type DispatchToWipResult =
  | { ok: true }
  | { ok: false; reason: "confirm"; victim: string }
  | { ok: false; reason: "other"; error: string };

export async function dispatchToWip(
  root: string,
  hash: string,
  confirmed: boolean,
  locale: Locale = DEFAULT_LOCALE,
): Promise<DispatchToWipResult> {
  const idle = (await listWorkers(root)).find((w) => w.status === "idle");
  if (idle) {
    // 결과를 안 본다 — 던진 것도 kick 실패도 이 갈래를 실패로 만들지 않는다(`kickTicket`의 계약).
    await kickTicket(root, hash);
    return { ok: true };
  }

  if (!confirmed) {
    const r = await preempt(root, hash, true, locale);
    if (!r.ok || !r.output) {
      return { ok: false, reason: "other", error: r.output || t(locale, "engine.noWorkerToPreempt") };
    }
    return { ok: false, reason: "confirm", victim: r.output };
  }

  const r = await preempt(root, hash, false, locale);
  if (!r.ok) return { ok: false, reason: "other", error: r.output };
  return { ok: true };
}
