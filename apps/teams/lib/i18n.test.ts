import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 `~/.config/dira/language.json`을 밟지 않는다. import 전에 건다 — `keymap.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-i18n-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { t, ko, en, wrap } = await import("./i18n.ts");
// 파일 읽기/쓰기는 `registryPath()` 옆에 산다 — `i18n.ts`가 클라이언트 번들로 가기 때문이다
// (그 파일 머리 주석, `keymap.test.ts`와 같은 이유로 같이 검증한다).
const { languagePath, readLanguage, setLanguage } = await import("./projects.ts");

test("없는 키는 ko로 떨어진다 — 빈 문자열도 키 이름 노출도 아니다", () => {
  assert.strictEqual(t("ko", "settings.language.label"), "언어");
  // 621c7a97이 설정 다이얼로그의 en을 채운 뒤로, 실제로 폴백에 걸리는 키는 **다음 묶음이
  // ko부터 넣는 동안**에만 생긴다. 그 상태를 여기서 만들어 못박는다 — 이 폴백이 109파일을
  // 묶음으로 쪼갤 수 있게 하는 못이다(§0-16 §장치 "없는 키").
  ko["test.koOnly"] = "아직 영어가 없다";
  try {
    assert.strictEqual(t("en", "test.koOnly"), "아직 영어가 없다");
  } finally {
    delete ko["test.koOnly"];
  }
});

test("ko에도 없는 키는 개발 실수로 던진다", () => {
  assert.throws(() => t("ko", "이런_키는_없다"));
});

// 30a8f5c3 첫 묶음 — `settings-dialog.tsx`가 변수와 조합해 그리는 문구는 원문과 한 글자도
// 안 갈려야 한다(§0-16 Done when). 단일 키 치환은 자명해 검증하지 않고, 조합만 못박는다.
test("settings-dialog.tsx의 조합 문구 — 원문 그대로 재조립된다", () => {
  assert.strictEqual(
    `${t("ko", "settings.keymap.resetTooltipPrefix")} ⌘K${t("ko", "settings.keymap.resetTooltipSuffix")}`,
    "기본값 ⌘K(으)로 되돌립니다",
  );
  assert.strictEqual(`"foo"${t("ko", "settings.search.emptySuffix")}`, `"foo"와 일치하는 설정 0건`);
  assert.strictEqual(`2026-01-01 ${t("ko", "settings.tokens.addedSuffix")}`, "2026-01-01 추가");
});

// 621c7a97 — 같은 자리들이 영어로도 읽히는 문장이 되어야 한다(한국어 어순이 남으면 여기서 걸린다).
test("settings-dialog.tsx의 조합 문구 — 영어도 문장이 된다", () => {
  assert.strictEqual(
    `${t("en", "settings.keymap.resetTooltipPrefix")} ⌘K${t("en", "settings.keymap.resetTooltipSuffix")}`,
    "Reset to the default ⌘K",
  );
  assert.strictEqual(`"foo"${t("en", "settings.search.emptySuffix")}`, `"foo": no matching settings`);
  assert.strictEqual(`2026-01-01 ${t("en", "settings.tokens.addedSuffix")}`, "2026-01-01 added");
  assert.strictEqual(
    `${t("en", "settings.keymap.captureHint")} Esc ${t("en", "settings.keymap.captureCancelSuffix")}`,
    "Whatever you press is assigned as-is · other shortcuts stop listening while this is open · Esc to cancel",
  );
});

// 932ae344 — 사전 밖에 있던 서버 문자열(키맵 액션 이름 · 거절 사유 · aria-label 조합 · 토큰
// 표시명 접두)을 ko 키로 뽑았다. 조합 결과가 원문과 한 글자도 안 갈리는지 여기서 못박는다.
test("932ae344 — 새로 뽑은 조합 문구들이 원문 그대로 재조립된다", () => {
  assert.strictEqual(
    `${t("ko", "settings.keymap.action.project.search")} ${t("ko", "settings.keymap.resetActionSuffix")}`,
    "프로젝트 검색 기본값으로 되돌리기",
  );
  assert.strictEqual(`A계정 ${t("ko", "settings.tokens.editLabelSuffix")}`, "A계정 라벨 편집");
  assert.strictEqual(`A계정 ${t("ko", "settings.tokens.deleteSuffix")}`, "A계정 삭제");
  assert.strictEqual(`${t("ko", "settings.tokens.accountFallbackPrefix")} 1`, "계정 1");
  assert.strictEqual(
    `${t("ko", "settings.keymap.reject.unknownAction")} nope.gone`,
    "모르는 액션입니다: nope.gone",
  );
});

// 6914f1d1 — 설정 다이얼로그 묶음은 여기서 끝난다. 폴백은 **다음 묶음이 ko를 먼저 넣는 동안**을
// 위한 장치지, 지금 든 묶음이 영어로 덜 서도 된다는 뜻이 아니다(§0-16 §발행).
//
// 이 판정은 **이미 다 찬 묶음**으로 좁힌다 — 다음 묶음이 ko를 먼저 넣는 동안에는 그 접두가
// 아직 이 목록에 없다(§0-16 §발행 "다음 티켓들이 여기 키를 늘린다"). 묶음의 en을 채우는
// 티켓이 자기 접두를 여기 더한다: `settings.`·`common.`(6914f1d1) · `ticket.priority.`(62e0b85e).
//
// **접두는 묶음 단위로 좁게 적는다.** `ticket.`으로 넓히면 아직 ko만 있는 다음 화면까지 걸려
// 그 묶음의 첫 티켓이 이 테스트를 깬다 — 폴백이 있는 이유가 그 상태를 허용하는 것이다.
// (`ticket.duedate.`·`bell.due.`는 5debff0e가 en을 채우고 여기 더했다. 셸 묶음의 넷
// `shell.`·`statusbar.`·`status.`·`dep.`은 90be3eeb가 더했고, 같은 티켓이 `bell.due.`를
// `bell.`로 넓혔다 — 종 일곱이 다 찼다.)
const FILLED = [
  "settings.",
  "common.",
  "ticket.priority.",
  "ticket.duedate.",
  "ticket.retries.", // 1cd7648d가 en을 채우고 여기 더했다
  "bell.",
  "shell.",
  "statusbar.",
  "status.",
  "dep.",
  "board.", // board.column.epic(806e483a)도 이 접두사로 덮인다
];

test("이미 찬 묶음(설정·마감·셸)의 ko 키는 en에 하나도 안 빠졌다", () => {
  assert.deepStrictEqual(
    Object.keys(ko).filter((k) => FILLED.some((p) => k.startsWith(p)) && !(k in en)),
    [],
  );
});

// 62e0b85e — 우선순위 묶음. 상속 한 줄은 해시·유효값 두 변수 사이에 사전 조각이 끼는 자리라
// 조립 결과를 두 언어 다 못박는다(`ticket-ui.tsx`의 JSX는 줄바꿈 공백을 지우므로, 조각과
// 해시 사이에 공백이 없고 조각과 유효값 사이에만 공백 하나가 있다).
test("우선순위 상속 한 줄 — 두 언어에서 다 문장이 된다", () => {
  const line = (l: "ko" | "en", hash: string, effective: number) =>
    `${hash}${t(l, "ticket.priority.inheritedMiddle")} ${effective}${t(l, "ticket.priority.inheritedAfter")}`;
  assert.strictEqual(line("ko", "high0002", 5), "high0002가 기다려 5로 뜹니다");
  assert.strictEqual(line("en", "high0002", 5), "high0002 is waiting on this, so it comes up as 5");
});

// select 다섯 항목은 숫자만 있으면 뜻이 없다 — 다섯 값 전부에 꼬리 문구가 있고, 영어에서
// 폴백(한국어)으로 안 떨어지는지 본다. 한글 판정은 아래 `en 사전에 한글이 없다`가 같이 잡는다.
test("우선순위 다섯 단계에 꼬리 문구가 전부 있다", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const key = `ticket.priority.level.${n}`;
    assert.ok(t("ko", key).length > 0, `ko ${key}`);
    assert.ok(t("en", key).length > 0, `en ${key}`);
    assert.notStrictEqual(t("en", key), t("ko", key));
  }
});

// 5debff0e — 마감 묶음. 값이 끼는 문장이 셋이라(파생 한 줄 · 종 ⑦ 제목 · 종 ⑦ 나열) 조립 결과를
// 두 언어 다 못박는다. 조립식은 `ticket-ui.tsx`·`layout.tsx`의 JSX 그대로다 — 줄바꿈 공백이
// 지워지는 자리(해시 뒤 · 숫자 뒤)에만 조각이 공백 없이 붙는다.
test("마감 파생 한 줄 — 두 언어에서 다 문장이 된다", () => {
  const line = (l: "ko" | "en", remaining: string, baseline: number) =>
    `${t(l, "ticket.duedate.derivedPrefix")} ${remaining} ${t(l, "ticket.duedate.derivedMiddle")} ${baseline}${t(l, "ticket.duedate.derivedAfter")}`;
  assert.strictEqual(line("ko", "3일", 1), "마감까지 3일 — 우선순위 1로 뜹니다");
  assert.strictEqual(line("en", "3 days", 1), "Due in 3 days — comes up as priority 1");
});

// §2-14 (2) · §비주얼 §11 §개정 — `{prefix} {n}{suffix}`. 한국어는 접미가 살고 영어는 빈다
// (`bell.assigned.title*`와 같은 조립 — ticket-ui.tsx `ReassignLine`).
test("되돌아온 횟수 한 줄 — 두 언어에서 다 문장이 된다", () => {
  const line = (l: "ko" | "en", n: number) =>
    `${t(l, "ticket.retries.linePrefix")} ${n}${t(l, "ticket.retries.lineSuffix")}`;
  assert.strictEqual(line("ko", 273), "다시 할당 273회");
  assert.strictEqual(line("en", 273), "Reassigned: 273");
});

test("마감 역전 한 줄 — 해시가 공백 없이 앞에 붙어도 두 언어에서 다 선다", () => {
  const line = (l: "ko" | "en", hash: string) => `${hash}${t(l, "ticket.duedate.reversalSuffix")}`;
  assert.strictEqual(
    line("ko", "high0002"),
    "high0002와 마감 순서가 어긋납니다 — 선행이 후행보다 늦게 끝날 수 없습니다",
  );
  assert.strictEqual(
    line("en", "high0002"),
    "high0002 and this due date are out of order — a prerequisite can't be due after the ticket waiting on it",
  );
});

test("종 ⑦ 제목·나열 — 두 언어에서 다 문장이 된다", () => {
  const title = (l: "ko" | "en", n: number) =>
    `${t(l, "bell.due.titlePrefix")} ${n}${t(l, "bell.due.titleSuffix")}`;
  assert.strictEqual(title("ko", 3), "마감을 못 지킬 티켓 3건");
  assert.strictEqual(title("en", 3), "Tickets that won't make their due date: 3");

  const blocked = (l: "ko" | "en", remaining: string, unmet: number) =>
    `${remaining} ${t(l, "bell.due.blockedMiddle")} ${unmet}${t(l, "bell.due.blockedSuffix")}`;
  assert.strictEqual(blocked("ko", "3시간 30분", 2), "3시간 30분 남았는데 선행 2건이 안 끝났습니다");
  assert.strictEqual(
    blocked("en", "3h 30m", 2),
    "3h 30m left, but blocked by 2 of its prerequisites",
  );
  // 1건이어도 문장이 선다 — 이 앱에 복수형 장치가 없어 숫자 뒤 명사를 그대로 두면 깨지는 자리다
  assert.strictEqual(blocked("en", "1h", 1), "1h left, but blocked by 1 of its prerequisites");
});

// 셸 둘째 묶음(§0-16 §발행 §묶음 표 2, `dd97c69c`) — 변수를 낀 조립 문구들이 원문과 한 글자도
// 안 갈리는지 못박는다. 조립식은 `layout.tsx`·`project-switcher.tsx`의 JSX 그대로다(줄바꿈만
// 있는 공백은 지워지고, 같은 줄의 공백 하나는 남는다).
test("dd97c69c — 알림 트리거·종 넷(②③④의 개수 제목)·전환기 0건 조립이 원문 그대로다", () => {
  const trigger = (n: number) =>
    `${t("ko", "bell.trigger.countPrefix")} ${n}${t("ko", "bell.trigger.countSuffix")}`;
  assert.strictEqual(trigger(3), "알림 3건");

  const failuresTitle = (n: number) =>
    `${t("ko", "bell.failures.titlePrefix")} ${n}${t("ko", "bell.failures.titleSuffix")}`;
  assert.strictEqual(failuresTitle(2), "세션이 열리자마자 죽는 워커 2개");

  const assignedTitle = (n: number) =>
    `${t("ko", "bell.assigned.titlePrefix")} ${n}${t("ko", "bell.assigned.titleSuffix")}`;
  assert.strictEqual(assignedTitle(2), "아무도 집지 않는 티켓 2건");

  const awaitingTitle = (n: number) =>
    `${t("ko", "bell.awaiting.titlePrefix")} ${n}${t("ko", "bell.awaiting.titleSuffix")}`;
  assert.strictEqual(awaitingTitle(2), "답변을 기다리는 티켓 2건");

  const empty = (q: string) =>
    q
      ? `"${q}"${t("ko", "shell.switcher.emptyQueriedGlue")} ${t("ko", "shell.switcher.emptySuffix")}`
      : t("ko", "shell.switcher.emptySuffix");
  assert.strictEqual(empty("foo"), `"foo"와 일치하는 프로젝트 0건`);
  assert.strictEqual(empty(""), "일치하는 프로젝트 0건");
});

test("dd97c69c — 연결 안 됨 배너 제목(변수 프로젝트 이름)이 원문 그대로다", () => {
  const title = (name: string) =>
    `${t("ko", "shell.error.titlePrefix")} "${name}"${t("ko", "shell.error.titleSuffix")}`;
  assert.strictEqual(title("myproj"), `프로젝트 "myproj"의 .dira를 읽을 수 없습니다`);
});

test("dd97c69c — 복귀(⑥) from·to 두 변수 조립이 원문 그대로다", () => {
  const body = (from: string, to: string) =>
    `${from}${t("ko", "bell.resume.middle")} ${to}${t("ko", "bell.resume.after")}`;
  assert.strictEqual(
    body("14:00", "15:30"),
    "14:00부터 15:30까지 큐가 멈춰 있었습니다. 잃은 것은 없습니다 — 이미 다시 돌고 있습니다.",
  );
});

test("dd97c69c — status bar `% 사용` 뒤에 창 이름이 붙어도 안 붙어도 원문 그대로다", () => {
  const usage = (pct: number, window: string) =>
    `${pct}% ${t("ko", "statusbar.usage.suffix")}${window && ` · ${window}`}`;
  assert.strictEqual(usage(42, ""), "42% 사용");
  assert.strictEqual(usage(42, "5시간"), "42% 사용 · 5시간");
});

// 90be3eeb — 그 조립들의 영어. 어순이 갈리는 자리(숫자를 콜론 뒤로 보낸 제목 · 꼬리가 빈
// 배너 제목 · 공백으로 여는 조각 둘)만 못박는다. 단일 키 치환은 위 전수 대조가 이미 잡는다.
test("90be3eeb — 셸 조립 문구가 영어에서도 문장이 된다", () => {
  const trigger = (n: number) =>
    `${t("en", "bell.trigger.countPrefix")} ${n}${t("en", "bell.trigger.countSuffix")}`;
  assert.strictEqual(trigger(3), "Notifications: 3");

  const failuresTitle = (n: number) =>
    `${t("en", "bell.failures.titlePrefix")} ${n}${t("en", "bell.failures.titleSuffix")}`;
  assert.strictEqual(failuresTitle(2), "Workers that die the moment a session opens: 2");

  const awaitingTitle = (n: number) =>
    `${t("en", "bell.awaiting.titlePrefix")} ${n}${t("en", "bell.awaiting.titleSuffix")}`;
  assert.strictEqual(awaitingTitle(2), "Tickets waiting on an answer: 2");

  // 검색어가 없으면 꼬리가 혼자 선다 — 그래서 이 조각만 대문자로 연다(설정 검색과 갈리는 지점)
  const empty = (q: string) =>
    q
      ? `"${q}"${t("en", "shell.switcher.emptyQueriedGlue")} ${t("en", "shell.switcher.emptySuffix")}`
      : t("en", "shell.switcher.emptySuffix");
  assert.strictEqual(empty("foo"), `"foo": No matching projects`);
  assert.strictEqual(empty(""), "No matching projects");

  const bannerTitle = (name: string) =>
    `${t("en", "shell.error.titlePrefix")} "${name}"${t("en", "shell.error.titleSuffix")}`;
  assert.strictEqual(bannerTitle("myproj"), `Can't read .dira in project "myproj"`);

  const resume = (from: string, to: string) =>
    `${from}${t("en", "bell.resume.middle")} ${to}${t("en", "bell.resume.after")}`;
  assert.strictEqual(
    resume("14:00", "15:30"),
    "14:00 to 15:30: the queue sat stopped. Nothing was lost — it's already running again.",
  );

  // idle 풀의 `sr-only` 꼬리는 라벨에 공백 없이 붙는다 — 값이 공백으로 열어야 낭독이 선다
  assert.strictEqual(
    `${t("en", "status.label.idle")}${t("en", "statusbar.idleSrOnlySuffix")}`,
    "idle workers",
  );
  // status bar 사유 넷은 `<엔진이나 경로>: ` 뒤에 붙는다(`lib/usage.ts`)
  assert.strictEqual(
    `codex: ${t("en", "statusbar.limit.unknownOriginSuffix")}`,
    "codex: no known source for its limit",
  );
  // `% 사용` 자리 — 창 이름이 붙어도 안 붙어도 선다(`windowLabel`이 `common.unit.*`를 탄다)
  const usage = (pct: number, window: string) =>
    `${pct}% ${t("en", "statusbar.usage.suffix")}${window && ` · ${window}`}`;
  assert.strictEqual(usage(42, ""), "42% used");
  assert.strictEqual(usage(42, "5h"), "42% used · 5h");
});

// 화면에 남은 한국어를 여기서 잡는다 — 사전 값 자체에 한글이 섞이면 폴백이 아니라 오타다.
// 언어 이름 둘만 예외다(영어 화면에서도 `한국어`는 `한국어`로 적는다).
test("en 사전에 한글이 없다 — 언어 이름 둘만 예외다", () => {
  const hangul = Object.entries(en)
    .filter(([k, v]) => /[가-힣]/.test(v) && !k.startsWith("settings.language."))
    .map(([k]) => k);
  assert.deepStrictEqual(hangul, []);
});

// 932ae344가 뽑은 자리들이 영어에서도 문장이 되는가. 한국어는 이름 뒤에 다 붙지만 영어는
// 동사가 앞에 서므로, 접두·접미 두 조각을 `wrap`이 붙이고 빈 쪽을 지운다.
test("6914f1d1 — 어순이 뒤집히는 조합 문구가 두 언어에서 다 선다", () => {
  const reset = (l: "ko" | "en", n: string) =>
    wrap(t(l, "settings.keymap.resetActionPrefix"), n, t(l, "settings.keymap.resetActionSuffix"));
  assert.strictEqual(reset("ko", "프로젝트 검색"), "프로젝트 검색 기본값으로 되돌리기");
  assert.strictEqual(reset("en", "Search projects"), "Reset Search projects to default");

  const edit = (l: "ko" | "en", n: string) =>
    wrap(t(l, "settings.tokens.editLabelPrefix"), n, t(l, "settings.tokens.editLabelSuffix"));
  assert.strictEqual(edit("ko", "A계정"), "A계정 라벨 편집");
  assert.strictEqual(edit("en", "Account 1"), "Edit label for Account 1");

  const del = (l: "ko" | "en", n: string) =>
    wrap(t(l, "settings.tokens.deletePrefix"), n, t(l, "settings.tokens.deleteSuffix"));
  assert.strictEqual(del("ko", "A계정"), "A계정 삭제");
  assert.strictEqual(del("en", "Account 1"), "Delete Account 1");

  // 라벨 없는 토큰의 표시 이름 · 모르는 액션 — 어순이 같아 접두 하나로 끝난다
  assert.strictEqual(`${t("en", "settings.tokens.accountFallbackPrefix")} 1`, "Account 1");
  assert.strictEqual(
    `${t("en", "settings.keymap.reject.unknownAction")} nope.gone`,
    "Unknown action: nope.gone",
  );
  // 캡처 거절 줄 전체(사유 + 안내 + Esc) — 사유가 마침표로 끝나야 두 조각이 안 붙는다
  assert.strictEqual(
    `${t("en", "settings.keymap.reject.tab")} ${t("en", "settings.keymap.captureRejectedSuffix")} Esc ${t("en", "settings.keymap.captureCancelSuffix")}`,
    "`Tab` moves focus. Press another key · Esc to cancel",
  );
});

test("wrap — 빈 조각은 빠지고 공백이 겹치지 않는다", () => {
  assert.strictEqual(wrap("", "가운데", "뒤"), "가운데 뒤");
  assert.strictEqual(wrap("앞", "가운데", ""), "앞 가운데");
  assert.strictEqual(wrap("", "혼자", ""), "혼자");
});

// 93c106b3 — 프로토콜 화면(묶음 7). 변수가 낀 조각 조립이 이행 전 원문과 바이트 단위로
// 같은지 못박는다(en은 아직 없으므로 ko만 — 7a86fd5c가 en을 채운 뒤 그쪽에서 두 언어를 본다).
// 조립식은 각 JSX의 실제 형태 그대로다(줄바꿈만 있는 자리는 공백 0, 명시 공백은 그대로 하나).
test("93c106b3 — 프로토콜 화면의 조립 문구가 원문과 바이트 단위로 같다(ko)", () => {
  const l = "ko" as const;

  assert.strictEqual(
    `${t(l, "protocols.new.descPrefix")} /${t(l, "protocols.new.descSuffix")}`,
    "프로토콜 디렉터리 기준 상대경로입니다. /를 넣으면 하위 디렉터리도 같이 만듭니다. 빈 파일로 만들고 바로 편집기가 열립니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.new.pathHintPrefix")}../ ${t(l, "protocols.new.pathHintSuffix")}`,
    "디렉터리 밖으로 나가는 경로(../ · 절대경로)는 서버가 거부합니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.editor.inlinedHintPrefix")} tick.sh${t(l, "protocols.editor.inlinedHintSuffix")}`,
    "이 파일은 tick.sh가 전문을 모든 세션 프롬프트 머리에 붙입니다 — 길이가 곧 매 세션의 비용입니다. 세부 규약은 같은 디렉터리의 다른 문서로 빼고 여기서 가리키면, 세션이 필요할 때만 읽습니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.rename.dialogTitlePrefix")} handoff.md`,
    "이름변경 — handoff.md",
  );
  assert.strictEqual(
    `${t(l, "protocols.rename.agentsWarnPrefix")} AGENTS.md${t(l, "protocols.rename.agentsWarnSuffix")}`,
    "tick.sh는 AGENTS.md라는 이름만 읽습니다. 다른 이름이 되면 세션은 협업 프로토콜 없이 시작합니다(에러 없이 조용히).",
  );
  assert.strictEqual(
    `handoff.md${t(l, "protocols.delete.descSuffix")}`,
    "handoff.md를 지웁니다. 되돌릴 수 없습니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.default.hintPrefix")} TICKET_PROTOCOLS${t(l, "protocols.default.hintMiddle")}${t(l, "protocols.default.rootPath")}${t(l, "protocols.default.hintSuffix")}`,
    "워커 파일에서 TICKET_PROTOCOLS를 읽지 못해 엔진 기본값 (<루트>/protocols)으로 봅니다. 워커에서 다른 경로로 재정의하면 이 화면도 그 경로를 따라갑니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.empty.bodyPrefix")} tick.sh${t(l, "protocols.empty.bodyMiddle")} AGENTS.md${t(l, "protocols.empty.bodySuffix")}`,
    "프로토콜이 없어도 이 프로젝트는 돕니다 — tick.sh는 AGENTS.md가 없으면 그냥 넘어갑니다. 세션이 협업 규약(티켓 분류별 처리·핸드오프·보고)을 모른 채 시작할 뿐입니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.core.vendoredPrefix")} tick.sh${t(l, "protocols.core.inlinedMiddle")} ${t(l, "protocols.core.inlinedAllProjects")}${t(l, "protocols.core.inlinedSuffix")} ${t(l, "protocols.core.readOnlyNote")}`,
    "이 파일은 이 큐에 vendored된 코어 사본입니다 — tick.sh가 전문을 모든 프로젝트의 모든 세션 프롬프트 맨 앞에 붙입니다. 여기서는 읽기만 합니다(이 화면이 고치는 것은 프로젝트 층입니다).",
  );
  assert.strictEqual(
    `${t(l, "protocols.core.notVendoredPrefix")} CORE-FOO.md${t(l, "protocols.core.notInlinedSuffix")} ${t(l, "protocols.core.readOnlyNote")}`,
    "이 파일은 큐가 아니라 엔진 레포에 있습니다 — CORE-FOO.md가 가리키면 세션이 필요할 때 직접 읽습니다(프롬프트에 인라인되지는 않습니다). 여기서는 읽기만 합니다(이 화면이 고치는 것은 프로젝트 층입니다).",
  );
  assert.strictEqual(
    wrap("CORE.md", t(l, "protocols.core.rawLabelSuffix"), ""),
    "CORE.md 원문",
  );
  assert.strictEqual(
    `${t(l, "protocols.core.notFoundPrefix")} missing.md`,
    "코어 프로토콜에 없는 파일입니다: missing.md",
  );

  // lib/protocols.ts가 짓는 fs 검증 사유(값 부분은 안 건드리는 원문 그대로).
  assert.strictEqual(
    `${t(l, "protocols.lib.coreReadFailPrefix")} /q/protocols (ENOENT)`,
    "코어 프로토콜을 읽지 못했습니다 — /q/protocols (ENOENT)",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.coreEmptyPrefix")} /q/protocols`,
    "코어 프로토콜이 없습니다 — /q/protocols",
  );
  assert.strictEqual(
    `${2000000}${t(l, "protocols.lib.tooLargeSuffix")}`,
    "2000000바이트 — 1MB가 넘어 편집기로 열지 않습니다.",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.missingPrefix")} handoff.md`,
    "파일이 없습니다(지워졌을 수 있습니다): handoff.md",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.notRegularPrefix")} handoff.md`,
    "일반 파일이 아닙니다: handoff.md",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.dirNoDeletePrefix")} sub`,
    "디렉터리는 이 화면에서 지우지 않습니다: sub",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.dirNoMovePrefix")} sub`,
    "디렉터리는 이 화면에서 옮기지 않습니다: sub",
  );
});

test("readLanguage — 파일 없으면 기본값 ko, set 뒤에는 그 값을 읽는다", async () => {
  rmSync(languagePath(), { force: true });
  assert.strictEqual(await readLanguage(), "ko");

  await setLanguage("en");
  assert.strictEqual(await readLanguage(), "en");
});
