/** `.wip` 워커 마크 — **자리 여섯의 유일한 출처** (DESIGN.md §비주얼 §19 · §52 ⑥ · §1 보드 · §2).
 *
 *  말하는 사실은 한 문장이다: **이 티켓을 지금 `<워커>`가 물고 있다.** 자리는 여섯이고
 *  ① 칸반 카드 메타 줄 끝 · ② 보드 테이블 `owner` 셀 · ③ 티켓 상세 `.wip` 잠금 `Alert` 꼬리
 *  (`WipWorker`, 주어는 티켓 하나) · ④ 에픽 사이드바 항목 2행 · ⑤ 스윔레인 띠 머리 · ⑥ 에픽 화면
 *  요약 줄(`WorkerChips`, 주어는 그 에픽의 `.wip` 워커 묶음 — §에픽 결정 9). **클래스 문자열은
 *  여섯에서 같다**(§19) — 한 사실을 여러 모양으로 그리면 사람이 그것들을 다른 뜻으로 읽는다.
 *
 *  파싱은 `workerOf` 하나다(워커 화면과 **같은 규칙**). `null`이면 **아무것도 안 그린다** —
 *  `?`도 아니다. 원문은 ②의 셀 텍스트와 상세 frontmatter 표에 그대로 남는다.
 *
 *  `components/status-badge.tsx`에 얹지 않은 이유: 그 파일은 `ticket-ui.tsx` 등 클라이언트
 *  컴포넌트가 import해서 클라이언트 번들로 간다. 여기는 `workerOf`(= `lib/workers.ts`,
 *  `node:fs`를 끈다)가 필요해서 그 파일에 두면 빌드가 깨진다. 부르는 곳은 서버 페이지 둘뿐이다. */
import { workerOf } from "@/lib/workers";
import type { Ticket } from "@/lib/queue";
// 프롭 이름 `t`(Ticket)가 이미 있어 사전 함수는 별칭으로 들인다.
import { DEFAULT_LOCALE, t as translate, type Locale } from "@/lib/i18n";

/** §19 프리미티브 — `<span>` 칩 하나. `Badge`가 아닌 이유는 §19(옆의 `PersonaBadge`·중립 상태
 *  배지와 실루엣이 겹친다). 뒤집는 축은 **밝기와 그릇 둘뿐**이고 서체·크기는 종전 그대로다. */
const CHIP =
  "shrink-0 rounded-sm bg-muted-foreground/15 px-1 font-mono text-xs font-normal leading-4 text-foreground";

/**
 * @param full ② 테이블 `owner` 셀. 셀 원문(`pm / w6-83533def`)을 **값 무수정으로** 그대로 두고
 *   그 안의 워커 이름 구간만 칩으로 세운다. ①③과 반대로 정본이 셀 원문이라 시각 렌더를 통째로
 *   `aria-hidden`으로 두고 원문을 `sr-only`로 한 번 더 낸다(§19 접근성) — 칩 안의 `워커 `
 *   접두어도 그 안에 들어가 같이 숨는다. 마크가 없으면(`.done` 행 등) 종전 그대로 전문뿐이다.
 */
export function WipWorker({
  t,
  full,
  locale = DEFAULT_LOCALE,
}: {
  t: Ticket;
  full?: boolean;
  locale?: Locale;
}) {
  const name = t.state === "wip" ? workerOf(t.fm.owner ?? "") : null;
  // ①③에서 워커 이름을 말하는 글자는 이 마크뿐이라 `aria-hidden`이 아니다(§12 점·§18 모션과 갈린다)
  const chip = name && (
    <span className={CHIP}>
      <span className="sr-only">{translate(locale, "workerMark.srPrefix")}</span>
      {name}
    </span>
  );
  if (!full) return chip || null;

  const owner = t.fm.owner ?? "";
  if (!name) return owner || "—";
  // `workerOf`의 계약 그대로 — 이름 뒤는 `-` + sid 8자다. 새 파싱 규칙이 아니라 그 결과가 선 자리고,
  // 둘이 갈리지 않는 것은 `lib/workers.test.ts`의 "워커 마크 ② 전문 자리"가 못박는다
  const at = owner.length - name.length - 9;
  return (
    <>
      <span aria-hidden>
        {owner.slice(0, at)}
        {chip}
        {owner.slice(at + name.length)}
      </span>
      <span className="sr-only">{owner}</span>
    </>
  );
}

/**
 * ④⑤⑥ — 에픽 줄이 집계한 워커 칩 묶음(§에픽 결정 9 · §52 ⑥). 주어가 티켓 하나가 아니라
 * 묶음이라 `WipWorker`와 입구가 갈린다 — `names`는 `lib/epics.ts`의 `Epic.workers`(distinct·
 * 오름차순, 이미 정렬돼 온다. 여기서 다시 안 정렬한다).
 *
 * @param cap 슬롯 상한(§52 ⑥) — **사이드바(④)에만 건다.** 넘는 이름은 칩 하나(`+n`)로 접히고
 *   접힌 이름은 그 칩 안에 `sr-only`로 전부 남는다. ⑤⑥은 `cap`을 안 준다 — 그 자리는 안 자른다.
 */
export function WorkerChips({
  names,
  cap,
  locale = DEFAULT_LOCALE,
}: {
  names: string[];
  cap?: number;
  locale?: Locale;
}) {
  if (names.length === 0) return null; // 0명이면 새 글자 0(§에픽 결정 9 — `없음`도 `-`도 아니다)
  const shown = cap && names.length > cap ? names.slice(0, cap) : names;
  const rest = names.slice(shown.length);
  return (
    <>
      {/* 묶음에 접두어 한 번 — 칩 안에 넣으면 `워커 w3 워커 w4`가 된다(§52 ⑥ 접근성) */}
      <span className="sr-only">{translate(locale, "workerMark.srPrefix")}</span>
      {shown.map((name) => (
        <span key={name} className={CHIP}>
          {name}
        </span>
      ))}
      {rest.length > 0 && (
        <span className={CHIP}>
          <span className="sr-only">{rest.join(", ")}</span>+{rest.length}
        </span>
      )}
    </>
  );
}
