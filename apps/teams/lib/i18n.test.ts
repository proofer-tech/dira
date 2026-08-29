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
// 파일 읽기/쓰기는 `registryPath()` 옆에 있다 — `i18n.ts`가 클라이언트 번들로 가기 때문이다
// (그 파일 머리 주석, `keymap.test.ts`와 같은 이유로 같이 검증한다).
const { languagePath, readLanguage, setLanguage } = await import("./projects.ts");

test("없는 키는 ko로 떨어진다 — 빈 문자열도 키 이름 노출도 아니다", () => {
  assert.strictEqual(t("ko", "settings.language.label"), "언어");
  // 621c7a97이 설정 다이얼로그의 en을 채운 뒤로, 실제로 폴백에 걸리는 키는 **다음 묶음이
  // ko부터 넣는 동안**에만 생긴다. 그 상태를 여기서 만들어 고정한다 — 이 폴백이 109파일을
  // 묶음으로 쪼갤 수 있게 하는 규칙이다(§0-16 §장치 "없는 키").
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
// 안 갈려야 한다(§0-16 Done when). 단일 키 치환은 자명해 검증하지 않고, 조합만 고정한다.
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
// 표시명 접두)을 ko 키로 뽑았다. 조합 결과가 원문과 한 글자도 안 갈리는지 여기서 고정한다.
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
  "protocols.", // 7a86fd5c가 en을 채우고 여기 더했다(묶음 7의 프로토콜 갈래)
  "persona.", // b5d9735d가 en을 채우고 여기 더했다(묶음 7의 페르소나 갈래)
  // 묶음 11(공용 컴포넌트·순수 유틸)은 화면 접두가 아니라 파일 스코프 접두라 줄이 열넷이다 —
  // `90db2822`가 en을 채우고 여기 더했다. `markdown.`은 점까지가 접두라 `markdownEditor.`·
  // `markdownWikilinks.`를 안 덮는다(그래서 셋을 따로 적는다).
  "budgets.",
  "markdownEditor.",
  "updateToast.",
  "workerMark.",
  "pathPicker.",
  "markdown.",
  "markdownWikilinks.",
  "copyCommand.",
  "attachmentLimit.",
  "skillUpload.",
  "paths.",
  "feedback.",
  "projectActions.",
  "appLayout.",
  "frontmatterRows.", // 9ff6dec3가 ko·en을 같이 채웠다(§비주얼 §50 §프론트매터 행 편집기)
  "boardPage.", // 6d818d48이 en을 채우고 여기 더했다(묶음 표 행 3의 보드 갈래)
  "findBar.", // 같은 티켓 — 찾기 바는 화면 접두가 아니라 파일 접두다(묶음 11과 같은 판단)
  "home.", // c357313f가 en을 채우고 여기 더했다(묶음 표 행 6의 홈 갈래)
  "ontology.", // 024ec871이 en을 채우고 여기 더했다(묶음 표 행 12의 온톨로지 갈래)
  // 4c075aa9가 en을 채우고 여기 더했다(묶음 표 행 8의 프로젝트 관리 루트 셸). 화면 접두 셋
  // (`errorBoundary.`·`notFound.`·`project.`)과 파일 스코프 접두 넷(`scaffold.`·`projects.`·
  // `resolve.`·`feedbackDialog.`)이라 줄이 일곱이다. `project.`은 점까지가 접두라 이미 찬
  // `projectActions.`를 안 덮고 `projects.`도 따로 적는다.
  "errorBoundary.",
  "notFound.",
  "scaffold.",
  "projects.",
  "resolve.",
  "project.",
  "feedbackDialog.",
  // f2fcf747이 en을 채우고 여기 더했다(묶음 표 행 5의 세션 스트림 갈래). 화면 접두 하나
  // (`sessionStream.`)와 파일 스코프 접두 둘(`interjectLib.`·`transcriptLib.`)이다 —
  // 뒤의 둘은 여러 화면이 같은 사건 데이터를 나눠 써서 화면 접두를 못 붙인다.
  "sessionStream.",
  "interjectLib.",
  "transcriptLib.",
];

test("이미 찬 묶음(설정·마감·셸)의 ko 키는 en에 하나도 안 빠졌다", () => {
  assert.deepStrictEqual(
    Object.keys(ko).filter((k) => FILLED.some((p) => k.startsWith(p)) && !(k in en)),
    [],
  );
});

// 62e0b85e — 우선순위 묶음. 상속 한 줄은 해시·유효값 두 변수 사이에 사전 조각이 끼는 자리라
// 조립 결과를 두 언어 다 고정한다(`ticket-ui.tsx`의 JSX는 줄바꿈 공백을 지우므로, 조각과
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
// 두 언어 다 고정한다. 조립식은 `ticket-ui.tsx`·`layout.tsx`의 JSX 그대로다 — 줄바꿈 공백이
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

test("마감 역전 한 줄 — 해시가 공백 없이 앞에 붙어도 두 언어에서 다 뜬다", () => {
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
  // 1건이어도 문장이 뜬다 — 이 앱에 복수형 장치가 없어 숫자 뒤 명사를 그대로 두면 깨지는 자리다
  assert.strictEqual(blocked("en", "1h", 1), "1h left, but blocked by 1 of its prerequisites");
});

// 셸 둘째 묶음(§0-16 §발행 §묶음 표 2, `dd97c69c`) — 변수를 낀 조립 문구들이 원문과 한 글자도
// 안 갈리는지 고정한다. 조립식은 `layout.tsx`·`project-switcher.tsx`의 JSX 그대로다(줄바꿈만
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

test("4ea7e8d9 — 복귀(⑥) 제목이 건수로 조립된다", () => {
  const resumeTitle = (n: number) =>
    `${t("ko", "bell.resume.titlePrefix")} ${n}${t("ko", "bell.resume.titleSuffix")}`;
  assert.strictEqual(resumeTitle(3), "큐가 멈춰 있던 구간 3건");
});

test("dd97c69c — status bar `% 사용` 뒤에 창 이름이 붙어도 안 붙어도 원문 그대로다", () => {
  const usage = (pct: number, window: string) =>
    `${pct}% ${t("ko", "statusbar.usage.suffix")}${window && ` · ${window}`}`;
  assert.strictEqual(usage(42, ""), "42% 사용");
  assert.strictEqual(usage(42, "5시간"), "42% 사용 · 5시간");
});

// 90be3eeb — 그 조립들의 영어. 어순이 갈리는 자리(숫자를 콜론 뒤로 보낸 제목 · 꼬리가 빈
// 배너 제목 · 공백으로 여는 조각 둘)만 고정한다. 단일 키 치환은 위 전수 대조가 이미 잡는다.
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

  // 검색어가 없으면 꼬리가 혼자 뜬다 — 그래서 이 조각만 대문자로 연다(설정 검색과 갈리는 지점)
  const empty = (q: string) =>
    q
      ? `"${q}"${t("en", "shell.switcher.emptyQueriedGlue")} ${t("en", "shell.switcher.emptySuffix")}`
      : t("en", "shell.switcher.emptySuffix");
  assert.strictEqual(empty("foo"), `"foo": No matching projects`);
  assert.strictEqual(empty(""), "No matching projects");

  const bannerTitle = (name: string) =>
    `${t("en", "shell.error.titlePrefix")} "${name}"${t("en", "shell.error.titleSuffix")}`;
  assert.strictEqual(bannerTitle("myproj"), `Can't read .dira in project "myproj"`);

  const resumeTitle = (n: number) =>
    `${t("en", "bell.resume.titlePrefix")} ${n}${t("en", "bell.resume.titleSuffix")}`;
  assert.strictEqual(resumeTitle(3), "Stretches the queue sat stopped: 3");

  // idle 풀의 `sr-only` 꼬리는 라벨에 공백 없이 붙는다 — 값이 공백으로 열어야 낭독이 뜬다
  assert.strictEqual(
    `${t("en", "status.label.idle")}${t("en", "statusbar.idleSrOnlySuffix")}`,
    "idle workers",
  );
  // status bar 사유 넷은 `<엔진이나 경로>: ` 뒤에 붙는다(`lib/usage.ts`)
  assert.strictEqual(
    `codex: ${t("en", "statusbar.limit.unknownOriginSuffix")}`,
    "codex: no known source for its limit",
  );
  // `% 사용` 자리 — 창 이름이 붙어도 안 붙어도 뜬다(`windowLabel`이 `common.unit.*`를 탄다)
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

// 스쿼드 블록 바이트 검증은 `50fd4b34`로 사전을 떠나 `squadBlockBytes`(`lib/budgets.ts`)의
// 리터럴로 옮겼다 — `budgets.test.ts`에 있다(`persona.squad.block*` 세 키는 이제 사전에 없다).

// 932ae344가 뽑은 자리들이 영어에서도 문장이 되는가. 한국어는 이름 뒤에 다 붙지만 영어는
// 동사가 앞에 서므로, 접두·접미 두 조각을 `wrap`이 붙이고 빈 쪽을 지운다.
test("6914f1d1 — 어순이 뒤집히는 조합 문구가 두 언어에서 다 뜬다", () => {
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
// 같은지 고정한다(en은 아직 없으므로 ko만 — 7a86fd5c가 en을 채운 뒤 그쪽에서 두 언어를 본다).
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

// 7a86fd5c — 같은 자리의 영어. 어순이 뒤집혀 조각의 몫이 갈린 자리(경로 힌트 · 기본값 안내 ·
// 코어 산문 · 바이트 수 꼬리)가 영어에서도 한 문장이 되는지 본다. 조립식은 `93c106b3` 테스트와
// 글자 하나까지 같다 — 갈리는 것은 사전 값뿐이다.
test("7a86fd5c — 프로토콜 화면의 조립 문구가 영어에서도 문장이 된다(en)", () => {
  const l = "en" as const;

  assert.strictEqual(
    `${t(l, "protocols.new.descPrefix")} /${t(l, "protocols.new.descSuffix")}`,
    "A path relative to the protocols directory. / creates any subdirectories along the way. The file starts empty and the editor opens on it right away.",
  );
  assert.strictEqual(
    `${t(l, "protocols.new.pathHintPrefix")}../ ${t(l, "protocols.new.pathHintSuffix")}`,
    "The server rejects paths that leave the directory (../ · absolute).",
  );
  assert.strictEqual(
    `${t(l, "protocols.editor.inlinedHintPrefix")} tick.sh${t(l, "protocols.editor.inlinedHintSuffix")}`,
    "This file goes into every session prompt in full — tick.sh pastes it at the top. Length is what every session costs. Move the detailed rules into another file in the same directory and point at it here, and a session reads them only when it needs them.",
  );
  assert.strictEqual(
    `${t(l, "protocols.rename.dialogTitlePrefix")} handoff.md`,
    "Rename — handoff.md",
  );
  assert.strictEqual(
    `${t(l, "protocols.rename.agentsWarnPrefix")} AGENTS.md${t(l, "protocols.rename.agentsWarnSuffix")}`,
    "tick.sh reads only the name AGENTS.md. Under any other name a session starts with no collaboration protocol — no error, no warning.",
  );
  assert.strictEqual(
    `handoff.md${t(l, "protocols.delete.descSuffix")}`,
    "handoff.md will be deleted. This can't be undone.",
  );
  assert.strictEqual(
    `${t(l, "protocols.default.hintPrefix")} TICKET_PROTOCOLS${t(l, "protocols.default.hintMiddle")}${t(l, "protocols.default.rootPath")}${t(l, "protocols.default.hintSuffix")}`,
    "Couldn't read TICKET_PROTOCOLS from the worker file, so this screen assumes the engine default (<root>/protocols). Point the worker at another path and this screen follows it.",
  );
  assert.strictEqual(
    `${t(l, "protocols.empty.bodyPrefix")} tick.sh${t(l, "protocols.empty.bodyMiddle")} AGENTS.md${t(l, "protocols.empty.bodySuffix")}`,
    "This project runs even with no protocols — tick.sh just moves on when there's no AGENTS.md. A session only starts without knowing the collaboration rules — how each ticket kind is handled, how to hand off, how to report.",
  );
  assert.strictEqual(
    `${t(l, "protocols.core.vendoredPrefix")} tick.sh${t(l, "protocols.core.inlinedMiddle")} ${t(l, "protocols.core.inlinedAllProjects")}${t(l, "protocols.core.inlinedSuffix")} ${t(l, "protocols.core.readOnlyNote")}`,
    "This file is the core copy vendored into this queue — tick.sh pastes it in full at the top of every session prompt in every project. Read-only here (this screen edits the project layer).",
  );
  assert.strictEqual(
    `${t(l, "protocols.core.notVendoredPrefix")} CORE-FOO.md${t(l, "protocols.core.notInlinedSuffix")} ${t(l, "protocols.core.readOnlyNote")}`,
    "This file lives in the engine repo, not in the queue — CORE-FOO.md points at it and a session reads it when it needs it (it isn't inlined into the prompt). Read-only here (this screen edits the project layer).",
  );
  assert.strictEqual(wrap("CORE.md", t(l, "protocols.core.rawLabelSuffix"), ""), "CORE.md source");
  assert.strictEqual(
    `${t(l, "protocols.core.notFoundPrefix")} missing.md`,
    "Not a file in the core protocol: missing.md",
  );

  // 글자 수 꼬리 — 한국어는 공백이 없고(`1,234자`) 영어는 하나 있다.
  assert.strictEqual(`${(1234).toLocaleString("en-US")}${t(l, "protocols.charSuffix")}`, "1,234 chars");
  // 배지 — 뒤에 `budgetLabel(...)`이 공백 하나를 두고 붙는다.
  assert.strictEqual(
    `${t(l, "protocols.inline.badge")} 6,700 / 6,500 B`,
    "Inlined in every prompt · 6,700 / 6,500 B",
  );

  // lib/protocols.ts가 짓는 fs 검증 사유.
  assert.strictEqual(
    `${t(l, "protocols.lib.coreReadFailPrefix")} /q/protocols (ENOENT)`,
    "Couldn't read the core protocol — /q/protocols (ENOENT)",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.coreEmptyPrefix")} /q/protocols`,
    "No core protocol — /q/protocols",
  );
  assert.strictEqual(
    `${2000000}${t(l, "protocols.lib.tooLargeSuffix")}`,
    "2000000 bytes — over 1MB, so the editor won't open it.",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.missingPrefix")} handoff.md`,
    "No such file (it may have been deleted): handoff.md",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.notRegularPrefix")} handoff.md`,
    "Not a regular file: handoff.md",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.dirNoDeletePrefix")} sub`,
    "This screen doesn't delete directories: sub",
  );
  assert.strictEqual(
    `${t(l, "protocols.lib.dirNoMovePrefix")} sub`,
    "This screen doesn't move directories: sub",
  );
  assert.strictEqual(
    `${t(l, "protocols.action.unknownProjectPrefix")} myproj`,
    "Not a registered project: myproj",
  );
});

// 화면 이행 셋째 묶음 - 페르소나 갈래(§0-16 §발행 §묶음 표 행 7, `204be4da`). 변수를 낀 조립
// 문구가 원문(이행 전 하드코딩 한국어)과 한 글자도 안 갈리는지 고정한다. 조립식은
// `personas-ui.tsx`·`personas/actions.ts`·`lib/skills.ts`·`[[...persona]]/page.tsx`의 JSX ·
// 템플릿 리터럴 그대로다(줄바꿈만 있는 공백은 지워지고, 같은 줄의 공백 하나는 남는다).
// 스쿼드 블록 자체는 `50fd4b34`로 사전을 떠나 `squadBlockBytes`(`lib/budgets.ts`)의
// 리터럴로 옮겼다 — 그 조립 검증은 `budgets.test.ts`에 있다.

test("204be4da — 사이드바 참조 줄(열린 · 진행중 · 완료 · 티켓 접두)이 원문 그대로다", () => {
  assert.strictEqual(wrap(t("ko", "persona.refs.openPrefix"), "2", ""), "열린 2");
  assert.strictEqual(wrap(t("ko", "status.label.wip"), "1", ""), "진행중 1");
  assert.strictEqual(wrap(t("ko", "status.label.done"), "3", ""), "완료 3");
  assert.strictEqual(
    wrap(t("ko", "persona.refs.ticketPrefix"), "열린 2 · 진행중 1", ""),
    "티켓 열린 2 · 진행중 1",
  );
});

test("204be4da — 색 sr-only 라벨과 스쿼드 역할 aria-label이 원문 그대로다", () => {
  assert.strictEqual(wrap(t("ko", "persona.color.labelPrefix"), "blue", ""), "색: blue");
  assert.strictEqual(`alice${t("ko", "persona.squad.roleAriaSuffix")}`, "alice의 역할");
});

test("204be4da — 스쿼드 멤버·규칙 배지(바이트 수 · 초과 꼬리)가 원문 그대로다", () => {
  const members = `${t("ko", "persona.squad.membersBadgePrefix")} 1,600 / 1,500 B${` ${t("ko", "persona.squad.overBudgetSuffix")}`}`;
  assert.strictEqual(members, "멤버 전원 프롬프트에 인라인 · 1,600 / 1,500 B 초과");
  assert.strictEqual(`${t("ko", "persona.squad.rulesBadgePrefix")} 120 B`, "리더 프롬프트에 인라인 · 120 B");
});

test("204be4da — 엔진 예고 줄(없는 기능 나열)이 원문 그대로다", () => {
  const missing = ["참견", "웹훅"];
  const line = `claude ${t("ko", "persona.engine.missingMiddle")} ${missing.join(t("ko", "persona.engine.missingJoiner"))}${t("ko", "persona.engine.missingSuffix")}`;
  assert.strictEqual(line, "claude 워커는 참견과 웹훅이 없습니다 — 티켓 수행은 같습니다.");
});

test("204be4da — 스쿼드 삭제 확인 다이얼로그(제목 · 본문)가 원문 그대로다", () => {
  assert.strictEqual(`${t("ko", "persona.squadDelete.titlePrefix")} myteam`, "스쿼드 삭제 — myteam");
  const body = `squads/myteam ${t("ko", "persona.squadDelete.bodyMiddle")} squad: ${t("ko", "persona.squadDelete.bodyAfter")}`;
  assert.strictEqual(
    body,
    "squads/myteam 디렉터리를 지웁니다. 되돌릴 수 없습니다. 이 스쿼드를 참조하는 티켓의 squad: 값은 그대로 남습니다.",
  );
});

test("204be4da — 커스텀 엔진 덮어쓰기 확인 다이얼로그가 원문 그대로다", () => {
  assert.strictEqual(`${t("ko", "persona.engine.overwriteTitlePrefix")} dev`, "커스텀 엔진 값을 덮어씁니다 — dev");
  const body = `${t("ko", "persona.engine.overwriteBodyPrefix")} --foo ${t("ko", "persona.engine.overwriteBodySuffix")}`;
  assert.strictEqual(
    body,
    "지금 engine 파일에 카탈로그 밖 인자가 있습니다: --foo 여기서 저장하면 이 인자는 사라지고 고른 값으로 바뀝니다.",
  );
});

test("204be4da — 메모리 삭제 확인 다이얼로그(제목 · 본문)가 원문 그대로다", () => {
  assert.strictEqual(`${t("ko", "persona.memory.deleteTitlePrefix")} note1`, "메모리 삭제 — note1");
  const body = `path/memory/note1.md ${t("ko", "persona.memory.deleteBodyAfterPath")}`;
  assert.strictEqual(
    body,
    "path/memory/note1.md 파일을 지웁니다. 되돌릴 수 없습니다 — 이 화면에 편집도 추가도 없습니다. 다음 디스패치부터 세션이 이 개념을 못 찾습니다.",
  );
});

test("204be4da — 페르소나 삭제 확인 다이얼로그(제목 · 본문 · 참조 경고)가 원문 그대로다", () => {
  assert.strictEqual(`${t("ko", "persona.delete.titlePrefix")} dev`, "페르소나 삭제 — dev");
  assert.strictEqual(
    `personas/dev ${t("ko", "persona.delete.bodyAfterPath")}`,
    "personas/dev 디렉터리를 안의 파일까지 지웁니다. 되돌릴 수 없습니다.",
  );
  const refsTitle = `${t("ko", "persona.delete.refsWarnPrefix")} 3${t("ko", "persona.delete.refsWarnSuffix")}${` ${t("ko", "persona.delete.refsWipPrefix")} 1${t("ko", "persona.delete.refsWipSuffix")}`}`;
  assert.strictEqual(refsTitle, "이 페르소나를 참조하는 티켓이 3건 있습니다 (진행중 1건)");
  const desc = `${t("ko", "persona.delete.refsBody")} WARN${t("ko", "persona.warn.engineSuffix")} ${t("ko", "persona.wording.withoutPersona")} ${t("ko", "persona.delete.dispatchDetail")}`;
  assert.strictEqual(
    desc,
    "티켓은 지워지지 않습니다. 프로필이 없어지면 엔진은 WARN만 남기고 페르소나 없이 디스패치합니다 — 세션이 역할·권한을 모르는 채로 시작합니다.",
  );
});

test("204be4da — 생성 다이얼로그(설명 · 이름 힌트)가 원문 그대로다", () => {
  const personaDesc = `${t("ko", "persona.create.personaDescPrefix")} persona: ${t("ko", "persona.create.personaDescSuffix")}`;
  assert.strictEqual(
    personaDesc,
    "티켓의 persona: 값이 곧 디렉터리 이름입니다. 프로필 본문은 세션 프롬프트 머리에 인라인됩니다.",
  );
  const squadDesc = `${t("ko", "persona.create.squadDescPrefix")} squad: ${t("ko", "persona.create.squadDescSuffix")}`;
  assert.strictEqual(
    squadDesc,
    "프로필이 있는 페르소나를 후보 풀로 묶습니다 — 티켓의 squad: 값이 되고, 디스패치가 그중 진행중이 가장 적은 하나를 고릅니다. 리더도 위임도 아닙니다.",
  );
  const nameHint = `${t("ko", "persona.create.nameHintPrefix")} ${t("ko", "persona.create.nameHintPersonaFile")}${t("ko", "persona.create.nameHintSuffix")}`;
  assert.strictEqual(
    nameHint,
    "영문·숫자·_·-. 파일은 <personas>/<이름>/PROFILE.md 가 됩니다. 페르소나와 스쿼드는 이름을 공유합니다 — 겹치면 거부됩니다",
  );
});

test("204be4da — 스킬 검색 0건 · 다중 드롭 거절 개수가 원문 그대로다", () => {
  assert.strictEqual(`"foo"${t("ko", "persona.skill.searchEmptySuffix")}`, `"foo"와 일치하는 스킬 0건`);
  assert.strictEqual(`3${t("ko", "persona.skill.countSuffix")}`, "3개");
});

test("204be4da — 페르소나 화면(page.tsx) 프로필 없음 · 스쿼드 경고 경고문이 원문 그대로다", () => {
  const missingBody = `${t("ko", "persona.missing.enginePrefix")} WARN${t("ko", "persona.warn.engineSuffix")} ${t("ko", "persona.wording.withoutPersona")} ${t("ko", "persona.missing.dispatchDetail")}`;
  assert.strictEqual(
    missingBody,
    "엔진은 이 이름을 만나면 WARN만 남기고 페르소나 없이 디스패치합니다 — 디스패치가 실패하는 게 아니라, 세션이 역할·권한을 모르는 채로 시작합니다. 그 이름을 왼쪽에서 고르고 오른쪽의 빈 본문을 채워 저장하면 파일이 만들어집니다.",
  );
  const squadWarnBody = `${t("ko", "persona.squadWarn.enginePrefix")} WARN${t("ko", "persona.warn.engineSuffix")} ${t("ko", "persona.squadWarn.strongLabel")}${t("ko", "persona.squadWarn.parenPrefix")} ${t("ko", "persona.wording.withoutPersona")}${t("ko", "persona.squadWarn.parenSuffix")}`;
  assert.strictEqual(
    squadWarnBody,
    "엔진은 이 값을 만나면 WARN만 남기고 종전 경로(persona:가 있으면 그 값, 없으면 페르소나 없이)로 디스패치합니다.",
  );
  const refsLine = `dev ${t("ko", "persona.missing.refsMiddle")} 3${t("ko", "persona.missing.refsSuffix")} PROFILE.md`;
  assert.strictEqual(refsLine, "dev — 티켓 3건이 참조 · PROFILE.md");
});

// b5d9735d - 같은 자리의 영어. 어순이 뒤집혀 조각의 몫이 갈린 자리(참조 줄 · 삭제 확인 · 경고
// 세 갈래 · 생성 설명)가 영어에서도 한 문장이 되는지 본다. 조립식은 위 `204be4da` 테스트와
// 글자 하나까지 같다 - 갈리는 것은 사전 값뿐이다.
test("b5d9735d - 사이드바 참조 줄 · 색 라벨 · 역할 aria가 영어에서도 뜬다", () => {
  const l = "en" as const;
  assert.strictEqual(wrap(t(l, "persona.refs.openPrefix"), "2", ""), "Open 2");
  assert.strictEqual(wrap(t(l, "status.label.wip"), "1", ""), "In progress 1");
  assert.strictEqual(wrap(t(l, "status.label.done"), "3", ""), "Done 3");
  assert.strictEqual(
    wrap(t(l, "persona.refs.ticketPrefix"), "Open 2 · In progress 1", ""),
    "Tickets: Open 2 · In progress 1",
  );
  assert.strictEqual(wrap(t(l, "persona.color.labelPrefix"), "blue", ""), "Color: blue");
  // 이름에 공백 없이 붙는다 - 한국어 `의 역할`이 지던 몫을 소유격이 진다
  assert.strictEqual(`alice${t(l, "persona.squad.roleAriaSuffix")}`, "alice's role");
});

test("b5d9735d - 스쿼드 멤버 · 규칙 배지가 영어에서도 뜬다", () => {
  const l = "en" as const;
  const members = `${t(l, "persona.squad.membersBadgePrefix")} 1,600 / 1,500 B${` ${t(l, "persona.squad.overBudgetSuffix")}`}`;
  assert.strictEqual(members, "Inlined in every member's prompt · 1,600 / 1,500 B over");
  assert.strictEqual(
    `${t(l, "persona.squad.rulesBadgePrefix")} 120 B`,
    "Inlined in the leader prompt · 120 B",
  );
});

test("b5d9735d - 엔진 예고 줄이 영어에서도 뜬다(하나일 때도 이음말이 안 샌다)", () => {
  const l = "en" as const;
  const line = (missing: string[]) =>
    `claude ${t(l, "persona.engine.missingMiddle")} ${missing.join(t(l, "persona.engine.missingJoiner"))}${t(l, "persona.engine.missingSuffix")}`;
  // 실제 값(`engineMissing`의 라벨)은 아직 사전 밖 한국어다 - 이 자리는 값이라 안 건드린다.
  // 그 라벨은 묶음 표 행 10(재유입 회수) 몫이다 - `50fd4b34`이 그 사실을 pm에 올렸다.
  assert.strictEqual(
    line(["interject", "session stream"]),
    "claude workers have no interject and session stream — running tickets is the same.",
  );
  assert.strictEqual(line(["interject"]), "claude workers have no interject — running tickets is the same.");
});

test("b5d9735d - 스쿼드 삭제 · 엔진 덮어쓰기 확인 다이얼로그가 영어에서도 뜬다", () => {
  const l = "en" as const;
  assert.strictEqual(`${t(l, "persona.squadDelete.titlePrefix")} myteam`, "Delete squad — myteam");
  assert.strictEqual(
    `squads/myteam ${t(l, "persona.squadDelete.bodyMiddle")} squad: ${t(l, "persona.squadDelete.bodyAfter")}`,
    "squads/myteam will be deleted, directory and all. This can't be undone. On tickets that point at this squad, the squad: value stays as it is.",
  );
  assert.strictEqual(
    `${t(l, "persona.engine.overwriteTitlePrefix")} dev`,
    "This overwrites a custom engine value — dev",
  );
  assert.strictEqual(
    `${t(l, "persona.engine.overwriteBodyPrefix")} --foo ${t(l, "persona.engine.overwriteBodySuffix")}`,
    "The engine file currently holds arguments outside the catalog: --foo Save here and they go away, replaced by what you picked.",
  );
});

test("b5d9735d - 메모리 · 페르소나 삭제 확인 다이얼로그가 영어에서도 뜬다", () => {
  const l = "en" as const;
  assert.strictEqual(`${t(l, "persona.memory.deleteTitlePrefix")} note1`, "Delete memory — note1");
  assert.strictEqual(
    `path/memory/note1.md ${t(l, "persona.memory.deleteBodyAfterPath")}`,
    "path/memory/note1.md will be deleted. This can't be undone — this screen has no edit and no add. From the next dispatch on, a session can't find this concept.",
  );
  assert.strictEqual(`${t(l, "persona.delete.titlePrefix")} dev`, "Delete persona — dev");
  assert.strictEqual(
    `personas/dev ${t(l, "persona.delete.bodyAfterPath")}`,
    "personas/dev will be deleted, files and all. This can't be undone.",
  );
  // 한국어는 수가 앞에 뜨고(`티켓이 3건 있습니다`) 영어는 뒤에 뜬다 - 조각 넷의 자리는 같다
  const refsTitle = `${t(l, "persona.delete.refsWarnPrefix")} 3${t(l, "persona.delete.refsWarnSuffix")}${` ${t(l, "persona.delete.refsWipPrefix")} 1${t(l, "persona.delete.refsWipSuffix")}`}`;
  assert.strictEqual(refsTitle, "This persona is referenced by 3 tickets (in progress: 1)");
  const desc = `${t(l, "persona.delete.refsBody")} WARN${t(l, "persona.warn.engineSuffix")} ${t(l, "persona.wording.withoutPersona")} ${t(l, "persona.delete.dispatchDetail")}`;
  assert.strictEqual(
    desc,
    "Tickets aren't deleted. With the profile gone the engine leaves a WARN and nothing else, then dispatches without a persona — the session starts without knowing its role or permissions.",
  );
});

test("b5d9735d - 생성 다이얼로그 · 스킬 검색 0건이 영어에서도 뜬다", () => {
  const l = "en" as const;
  assert.strictEqual(
    `${t(l, "persona.create.personaDescPrefix")} persona: ${t(l, "persona.create.personaDescSuffix")}`,
    "A ticket's persona: value is the directory name. The profile body is inlined at the top of the session prompt.",
  );
  assert.strictEqual(
    `${t(l, "persona.create.squadDescPrefix")} squad: ${t(l, "persona.create.squadDescSuffix")}`,
    "Groups personas that have a profile into a candidate pool — it becomes a ticket's squad: value, and dispatch picks whichever member has the fewest tickets in progress. It isn't a leader and it isn't delegation.",
  );
  assert.strictEqual(
    `${t(l, "persona.create.nameHintPrefix")} ${t(l, "persona.create.nameHintPersonaFile")}${t(l, "persona.create.nameHintSuffix")}`,
    "Letters, digits, _ and -. The file becomes <personas>/<name>/PROFILE.md. Personas and squads share one namespace — a collision is rejected",
  );
  assert.strictEqual(`"foo"${t(l, "persona.skill.searchEmptySuffix")}`, `"foo": no matching skills`);
  assert.strictEqual(`3${t(l, "persona.skill.countSuffix")}`, "3 items");
});

test("b5d9735d - page.tsx 경고 두 갈래가 영어에서도 뜬다(`WARN` 뒤 조각 하나를 셋이 나눠 쓴다)", () => {
  const l = "en" as const;
  const missingBody = `${t(l, "persona.missing.enginePrefix")} WARN${t(l, "persona.warn.engineSuffix")} ${t(l, "persona.wording.withoutPersona")} ${t(l, "persona.missing.dispatchDetail")}`;
  assert.strictEqual(
    missingBody,
    "When the engine meets this name it leaves a WARN and nothing else, then dispatches without a persona — dispatch doesn't fail, the session just starts without knowing its role or permissions. Pick that name on the left, fill the empty body on the right, save, and the file gets created.",
  );
  const squadWarnBody = `${t(l, "persona.squadWarn.enginePrefix")} WARN${t(l, "persona.warn.engineSuffix")} ${t(l, "persona.squadWarn.strongLabel")}${t(l, "persona.squadWarn.parenPrefix")} ${t(l, "persona.wording.withoutPersona")}${t(l, "persona.squadWarn.parenSuffix")}`;
  assert.strictEqual(
    squadWarnBody,
    "When the engine meets this value it leaves a WARN and nothing else, then dispatches down the old path (the persona: value if the ticket has one, otherwise without a persona).",
  );
  const refsLine = `dev ${t(l, "persona.missing.refsMiddle")} 3${t(l, "persona.missing.refsSuffix")} PROFILE.md`;
  assert.strictEqual(refsLine, "dev — referenced by 3 tickets · PROFILE.md");
});

// 묶음 11(`90db2822`) — 수를 가운데 끼운 자리가 넷이라(예산 꼬리 · 1건 상한 · 스킬 상한 둘)
// 조립을 순수 함수째로 부른다. 조각만 맞대면 `Over the 200-file install limit`처럼 하이픈이
// 수에 붙는 자리가 안 잡힌다.
test("90db2822 — 수를 낀 조합 문구가 두 언어에서 다 뜬다", async () => {
  const { budgetLabel } = await import("./budgets.ts");
  const { oversizeError } = await import("./attachment-limit.ts");
  const { skillUploadError } = await import("./skill-upload-limit.ts");

  assert.strictEqual(budgetLabel(6_700, 6_500, "ko"), "6,700 / 6,500 B 초과");
  assert.strictEqual(budgetLabel(6_700, 6_500, "en"), "6,700 / 6,500 B over");
  // 상한 안이면 두 언어가 같은 글자다 — 갈리는 것은 넘은 꼬리뿐이다.
  assert.strictEqual(budgetLabel(1_200, 6_500, "en"), "1,200 / 6,500 B");

  assert.strictEqual(
    oversizeError(25 * 1024 * 1024, "en"),
    "Over 20MB (25.0MB) — upload just the part you need.",
  );

  assert.deepStrictEqual(skillUploadError(412, 10, "en"), {
    title: "Over the 200-file install limit",
    message: "412 files",
  });
  assert.deepStrictEqual(skillUploadError(3, 30 * 1024 * 1024, "en"), {
    title: "Over the 20MB install limit",
    message: "30.0MB",
  });

  // 진행률은 `%` 앞에 공백 하나(update-toast.tsx의 JSX 그대로).
  assert.strictEqual(
    `${t("en", "updateToast.progress.prefix")} 42%`,
    "Downloading the update… 42%",
  );
  // sr-only 접두는 이름에 공백 없이 붙는다 — 값이 공백으로 닫아야 낭독이 뜬다.
  assert.strictEqual(`${t("en", "workerMark.srPrefix")}w3`, "Worker w3");
  // 같은 거절을 두 액션 파일이 각자 알려 준다 — 문장이 갈리면 안 된다.
  assert.strictEqual(
    t("en", "projectActions.unknownProjectPrefix"),
    t("en", "protocols.action.unknownProjectPrefix"),
  );
});

// f3a8794e — 보드 화면(묶음 3). 변수가 낀 조각 조립이 이행 전 원문과 바이트 단위로 같은지
// 못박는다(en은 아직 없으므로 ko만 — `6d818d48`가 en을 채운 뒤 그쪽에서 두 언어를 본다).
test("f3a8794e — 보드 화면의 조립 문구가 원문과 바이트 단위로 같다(ko)", () => {
  const l = "ko" as const;

  // page.tsx `noMatch`
  assert.strictEqual(
    `"검색어"${t(l, "boardPage.noMatch.querySuffix")}`,
    '"검색어"와 일치하는 티켓 0건',
  );
  assert.strictEqual(t(l, "boardPage.noMatch.generic"), "조건에 맞는 티켓 0건");

  // page.tsx 건수 줄
  assert.strictEqual(
    `${t(l, "boardPage.count.label")} ${5}${t(l, "boardPage.unit.count")}`,
    "티켓 5건",
  );
  assert.strictEqual(
    `${t(l, "boardPage.count.label")} ${3} / ${5}${t(l, "boardPage.unit.count")}`,
    "티켓 3 / 5건",
  );
  assert.strictEqual(
    `${t(l, "boardPage.count.hiddenPrefix")} ${12}${t(l, "boardPage.unit.count")} ${t(l, "boardPage.count.hiddenSuffix")}`,
    "완료 12건 숨김",
  );
  assert.strictEqual(
    `(${t(l, "boardPage.undispatched.prefix")} ${3}${t(l, "boardPage.undispatched.suffix")})`,
    "(디스패치되지 않는 3건은 상단 알림)",
  );
  assert.strictEqual(`${t(l, "boardPage.column.status")} ${t(l, "boardPage.sort.ariaSuffix")}`, "상태 정렬");

  // board-ui.tsx BoardFilter · CommandEmpty
  assert.strictEqual(`${t(l, "boardPage.column.owner")} ${t(l, "boardPage.filter.searchSuffix")}`, "담당 검색");
  assert.strictEqual(
    `${t(l, "boardPage.filter.noMatchPrefix")} ${t(l, "boardPage.column.owner")} ${t(l, "boardPage.count.zero")}`,
    "일치하는 담당 0건",
  );

  // (board)/actions.ts
  assert.strictEqual(
    `${t(l, "boardPage.column.title")}${t(l, "boardPage.action.noNewlineSuffix")}`,
    "제목에 줄바꿈을 넣을 수 없습니다.",
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.kindPrefix")} work · request · feedback ${t(l, "boardPage.action.kindMiddle")} bogus`,
    "kind는 work · request · feedback 중 하나입니다: bogus",
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.unknownDepsPrefix")} abc123`,
    "큐에 없는 deps 해시입니다: abc123",
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.unknownProjectPrefix")} myproj`,
    "등록되지 않은 프로젝트입니다: myproj",
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.epicAcceptedPrefix")} ${t(l, "board.epic.noTitle")} (P123) ${t(l, "boardPage.action.epicAcceptedSuffix")}`,
    "요구사항이 제목 없음 (P123) 에픽으로 접수되었습니다.",
  );
});

// 6d818d48 — 위 ko 테스트의 짝. **조립식은 한 글자도 안 갈린다** — 갈리는 것은 조각의 몫뿐이라,
// 같은 식에 `en`을 넣어 문장이 되는지만 본다. 숫자를 뒤로 보내고 콜론으로 받는 자리 셋
// (건수 · 숨김 · 각주)과 라벨이 가운데 박혀 어순을 못 뒤집는 자리 셋(정렬 · 필터 검색 ·
// 필터 0건)이 여기서 갈린다.
test("6d818d48 — 보드 화면의 조립 문구가 영어에서도 문장이 된다(en)", () => {
  const l = "en" as const;

  // page.tsx `noMatch` — 쌍따옴표를 콜론이 받는다.
  assert.strictEqual(`"query"${t(l, "boardPage.noMatch.querySuffix")}`, '"query": no matching tickets');
  assert.strictEqual(t(l, "boardPage.noMatch.generic"), "No tickets match these filters");

  // page.tsx 건수 줄 — 단위가 비어 숫자가 그대로 끝난다.
  assert.strictEqual(
    `${t(l, "boardPage.count.label")} ${5}${t(l, "boardPage.unit.count")}`,
    "Tickets: 5",
  );
  assert.strictEqual(
    `${t(l, "boardPage.count.label")} ${3} / ${5}${t(l, "boardPage.unit.count")}`,
    "Tickets: 3 / 5",
  );
  assert.strictEqual(
    `${t(l, "boardPage.count.hiddenPrefix")} ${12}${t(l, "boardPage.unit.count")} ${t(l, "boardPage.count.hiddenSuffix")}`,
    "Hiding 12 done",
  );
  assert.strictEqual(
    `(${t(l, "boardPage.undispatched.prefix")} ${3}${t(l, "boardPage.undispatched.suffix")})`,
    "(Not dispatched: 3 — see notifications)",
  );

  // 라벨이 앞에 오는 셋 — 변수가 접두라 어순을 못 뒤집는다.
  assert.strictEqual(`${t(l, "boardPage.column.status")} ${t(l, "boardPage.sort.ariaSuffix")}`, "Status sort");
  assert.strictEqual(`${t(l, "boardPage.column.owner")} ${t(l, "boardPage.filter.searchSuffix")}`, "Owner search");
  assert.strictEqual(
    `${t(l, "boardPage.filter.noMatchPrefix")} ${t(l, "boardPage.column.owner")} ${t(l, "boardPage.count.zero")}`,
    "No matching Owner 0",
  );

  // actions.ts — 필드 이름이 문장을 열므로 조각이 공백으로 연다.
  assert.strictEqual(
    `${t(l, "boardPage.column.title")}${t(l, "boardPage.action.noNewlineSuffix")}`,
    "Title can't contain a line break.",
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.kindPrefix")} work · request · feedback ${t(l, "boardPage.action.kindMiddle")} bogus`,
    "kind must be one of work · request · feedback — got: bogus",
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.unknownDepsPrefix")} abc123`,
    "No such deps hash in the queue: abc123",
  );
  // 두 액션 파일이 같은 거절을 말하는 자리 — 글자가 갈리면 여기서 깨진다.
  assert.strictEqual(
    t(l, "boardPage.action.unknownProjectPrefix"),
    t(l, "projectActions.unknownProjectPrefix"),
  );
  assert.strictEqual(
    `${t(l, "boardPage.action.epicAcceptedPrefix")} ${t(l, "board.epic.noTitle")} (P123) ${t(l, "boardPage.action.epicAcceptedSuffix")}`,
    "Request received in the No title (P123) epic.",
  );
});

// c357313f — 홈 화면 갈래(§묶음 표 행 6). 조각 사이에 값이 끼는 자리가 다섯이고 영어는 어순이
// 갈린다(이름이 조사를 안 받는다 · 시각이 주어가 된다) — 조립 결과를 여기서 문장으로 고정한다.
test("c357313f — 홈 화면의 조립 문구가 영어에서도 문장이 된다(en)", () => {
  const l = "en" as const;

  // home/page.tsx 온보딩 예시 둘 — 워커 이름이 공백 없이 앞에 붙는다.
  assert.strictEqual(
    `w1${t(l, "home.example.workerActivitySuffix")}`,
    "w1 — what is this worker working on right now?",
  );
  assert.strictEqual(
    `w2${t(l, "home.example.workerEngineSuffix")}`,
    "w2 — which engine does this worker run on?",
  );

  // home-ui.tsx 회차 0건 판정 문장 — 시각이 공백 없이 앞에 붙어 그 문장의 주어가 된다.
  assert.strictEqual(
    `8/30 09:00${t(l, "home.schedule.dueAtSuffix")} ${t(l, "home.schedule.liveNote")}`,
    "8/30 09:00 is when the first run happens. Schedules only run while this app is open — tickets in the queue keep getting dispatched even when it is closed",
  );
  // 새 스케줄 다이얼로그 설명 — 가운데 조각이 위 판정 문장과 한 글자까지 같다.
  assert.strictEqual(
    `${t(l, "home.schedule.desc1")} ${t(l, "home.schedule.liveNote")}. ${t(l, "home.schedule.desc3")}`,
    "At the time you set, the home agent carries out this prompt. Schedules only run while this app is open — tickets in the queue keep getting dispatched even when it is closed. Runs missed while the app was closed happen once, late, when you open it.",
  );

  // <WorkerNote>와 home-agent.ts의 busy 거절이 같은 접미를 나눠 쓴다 — 앞 조각만 갈린다.
  assert.strictEqual(
    `${t(l, "home.workerNote.running")}high0002${t(l, "home.workerNote.runningSuffix")}`,
    "A running session takes no questions here · interrupt it from the high0002 detail page",
  );
  assert.strictEqual(
    `${t(l, "home.errors.workerRunningPrefix")}high0002${t(l, "home.workerNote.runningSuffix")}`,
    "A running worker session takes no questions here · interrupt it from the high0002 detail page",
  );
  assert.strictEqual(`${t(l, "home.workerNote.done")}high0002`, "Asks on in this session without worker permissions · high0002");

  // home-agent.ts ask()의 이른 실패 — 괄호를 이 값이 열고 코드가 닫는다.
  assert.strictEqual(
    `${t(l, "home.errors.claudeNotFoundPrefix")}/usr/bin)`,
    "Couldn't find claude on PATH. (PATH=/usr/bin)",
  );

  // home/actions.ts의 거절 — 같은 거절을 액션 파일들이 각자 든다.
  assert.strictEqual(
    t(l, "home.action.unknownProjectPrefix"),
    t(l, "projectActions.unknownProjectPrefix"),
  );
});

// 024ec871 — 온톨로지 화면(묶음 표 행 12 갈래). 값이 끼는 자리가 아홉이고, 그중 셋은
// **변수가 접두라** 어순을 못 뒤집는다(글자 수 · 삭제할 경로 · 지표의 수). 조립식은 화면 파일과
// `lib/ontology.ts` 그대로 두고 결과만 여기서 고정한다.
test("024ec871 — 온톨로지 화면의 조립 문구가 영어에서도 문장이 된다(en)", () => {
  const l = "en" as const;

  // ontology-ui.tsx 새 파일 다이얼로그 — `/`와 `../`가 각각 가운데에 낀다.
  assert.strictEqual(
    `${t(l, "ontology.new.descPrefix")} /${t(l, "ontology.new.descSuffix")}`,
    "A path relative to the ontology directory. / creates any subdirectories along the way. The file starts empty and the editor opens on it right away.",
  );
  assert.strictEqual(
    `${t(l, "ontology.new.pathHintPrefix")}../ ${t(l, "ontology.new.pathHintSuffix")}`,
    "The server rejects paths that leave the directory (../ · absolute).",
  );

  // 편집기 꼬리와 삭제 다이얼로그 — 앞에 수와 경로가 공백 없이 붙는다.
  assert.strictEqual(`1,024${t(l, "ontology.charSuffix")}`, "1,024 chars");
  assert.strictEqual(
    `SCHEMA.md${t(l, "ontology.delete.descSuffix")}`,
    "SCHEMA.md will be deleted. This can't be undone.",
  );
  // 이름변경 다이얼로그 제목 — em dash는 JSX가 찍는다.
  assert.strictEqual(`${t(l, "ontology.rename.trigger")} — SCHEMA.md`, "Rename — SCHEMA.md");

  // 설문 제출 뒤 대기 문장 — 가운데 `Board`가 셸의 키를 그대로 재사용한다.
  assert.strictEqual(
    `${t(l, "ontology.survey.pendingPrefix")} ${t(l, "shell.nav.board")}${t(l, "ontology.survey.pendingSuffix")}`,
    "Building from your answers… the first pass runs as one ticket on the Board.",
  );

  // page.tsx 빈 트리 안내 — `tick.sh`와 `ontology/`가 차례로 낀다.
  assert.strictEqual(
    `${t(l, "ontology.empty.bodyPrefix")} tick.sh${t(l, "ontology.empty.bodyMiddle")} ontology/${t(l, "ontology.empty.bodySuffix")}`,
    "This project runs even if you skip this — tick.sh just moves on when ontology/ is empty.",
  );

  // 지표 판 — 꼬리 하나(`ontology.unit.count`)를 열두 칸과 위반 카드 둘이 같이 문다.
  const count = t(l, "ontology.unit.count");
  assert.strictEqual(`3${count} (12%)`, "3 found (12%)");
  assert.strictEqual(`1${count}`, "1 found"); // 1이 실제로 뜨는 자리다 — 복수형 명사를 못 쓴다
  assert.strictEqual(`${t(l, "ontology.metrics.violationsPrefix")} 12${count}`, "Schema violations — 12 found");
  assert.strictEqual(`${t(l, "ontology.metrics.moreCountPrefix")} 2${count}`, "Another 2 found");
  assert.strictEqual(
    `${t(l, "ontology.metrics.fixTicketPrefix")} 1a2b3c4d.wip`,
    "Cleanup ticket 1a2b3c4d.wip",
  );

  // lib/ontology.ts 위반 문장 — `ofQuote`를 미정의 관계와 정의역·치역 위반이 같이 쓴다.
  assert.strictEqual(
    `${t(l, "ontology.violation.unknownTypePrefix")} objects/a.md ${t(l, "ontology.violation.unknownTypeMiddle")}Customer${t(l, "ontology.violation.unknownTypeSuffix")}`,
    "Undefined type: objects/a.md (type 'Customer' is not in SCHEMA.md)",
  );
  assert.strictEqual(
    `${t(l, "ontology.violation.unknownRelationPrefix")} objects/a.md ${t(l, "ontology.violation.ofQuote")}owns${t(l, "ontology.violation.unknownRelationSuffix")}`,
    "Undefined relation: objects/a.md — 'owns' (not in the SCHEMA.md relation table)",
  );
  assert.strictEqual(
    `${t(l, "ontology.violation.domainRangePrefix")} objects/a.md ${t(l, "ontology.violation.ofQuote")}owns${t(l, "ontology.violation.domainRangeMid")}Customer -> Doc${t(l, "ontology.violation.domainRangeSuffix")}Customer -> Order]`,
    "Domain/range violation: objects/a.md — 'owns' (Customer -> Doc) but the schema says [Customer -> Order]",
  );
  assert.strictEqual(
    `${t(l, "ontology.violation.danglingPrefix")} objects/a.md -> [[Foo]]`,
    "Dangling link: objects/a.md -> [[Foo]]",
  );

  // 세 화면이 같은 거절을 말하는 자리라 글자가 갈리면 여기서 깨진다.
  assert.strictEqual(
    t(l, "ontology.action.unknownProjectPrefix"),
    t(l, "boardPage.action.unknownProjectPrefix"),
  );
  assert.strictEqual(
    t(l, "ontology.action.hashExhausted"),
    t(l, "boardPage.action.hashExhausted"),
  );
});

test("readLanguage — 파일 없으면 기본값 ko, set 뒤에는 그 값을 읽는다", async () => {
  rmSync(languagePath(), { force: true });
  assert.strictEqual(await readLanguage(), "ko");

  await setLanguage("en");
  assert.strictEqual(await readLanguage(), "en");
});
