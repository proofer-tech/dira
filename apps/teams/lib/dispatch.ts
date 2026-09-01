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
    // `runWorker`(engine.ts)는 스크립트가 실패하면 실제 출력이 비어도 execFile의 원문 에러
    // 메시지로 `output`을 채운다 — 그래서 `!r.output`으로는 "피해자가 없다"를 못 가른다.
    // 가르는 값은 `r.worker`다: **`null`일 때만** `preempt()`의 이른 리턴(워커가 아예 0개,
    // `engine.noWorkerToPreempt`)이고, 그 밖은 스크립트를 불렀는데도 실패한 것이다 — 그 실패는
    // 도는 `.wip`이 0건이거나 전부 유효 5라 `--dryrun`이 빈 출력에 0이 아닌 코드로 끝난
    // 것뿐이다. 화면이 이 둘을 못 가르므로 전용 문장 하나를 쓴다 — `noWorkerToPreempt`를
    // 재사용하면 워커가 있는데도 "워커가 없다"고 거짓말하게 된다.
    if (!r.ok) {
      return {
        ok: false,
        reason: "other",
        error: r.worker === null ? r.output : t(locale, "board.lane.noVictim"),
      };
    }
    if (!r.output) {
      return { ok: false, reason: "other", error: t(locale, "board.lane.noVictim") };
    }
    return { ok: false, reason: "confirm", victim: r.output };
  }

  const r = await preempt(root, hash, false, locale);
  if (!r.ok) return { ok: false, reason: "other", error: r.output };
  return { ok: true };
}
