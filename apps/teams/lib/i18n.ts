/** 화면 문구 사전 — 한국어/영어 두 벌 + 조회 하나 (DESIGN.md §0-16 §장치).
 *
 *  **의존성 0.** `next-intl` 같은 라이브러리가 주는 로케일 라우팅·복수형·날짜 포맷은 이 앱에
 *  없다 — 단일 사용자 로컬 앱이라 `Record<string, string>` 두 벌이면 충분하다.
 *
 *  **`node:*`가 없다.** 이 파일은 화면(클라이언트 컴포넌트)이 직접 import해서 번들로 간다 —
 *  `lib/keymap.ts`와 같은 이유다. 파일 읽기/쓰기(`languagePath`·`readLanguage`·`setLanguage`)는
 *  `lib/projects.ts`에 있다.
 *
 *  화면 이행은 묶음으로 나간다(§0-16 §발행). 지금 든 것은 **설정 다이얼로그 한 벌**이다
 *  (`ko`는 30a8f5c3, `en`은 621c7a97). 다음 티켓들이 여기 키를 늘린다 — `ko`를 먼저 넣고 `en`이
 *  비어 있어도 화면은 안 깨진다(맨 아래 `t`의 폴백). */

export type Locale = "ko" | "en";

/** §0-16 §설정 노드 — "안 고른 사람의 화면이 갈리면 회귀다." */
export const DEFAULT_LOCALE: Locale = "ko";

/** 키 이름 규약(30a8f5c3 첫 묶음) — `<화면>.<노드나 영역>.<요소>`. 트리 노드 5개와 같은 이름을
 *  공유하는 문구는 `settings.tree.<node>`로 한 번만 두고 여러 자리가 재사용한다(중복 값 0).
 *  화면·노드를 안 가리는 낱말(저장·저장 중…·추가 등)은 `common.*`.
 *
 *  `export`는 테스트가 폴백을 검증하려고 쓴다(`i18n.test.ts`) — 화면은 `t()`로만 읽는다. */
export const ko: Record<string, string> = {
  "settings.language.label": "언어",

  "settings.dialog.title": "설정",
  "settings.dialog.description": "이 컴퓨터의 dira 설정입니다. 등록된 프로젝트 전부에 적용됩니다.",
  "settings.dialog.triggerLink": "토큰 저장",
  "settings.dialog.needsAuth": "인증 필요",

  "settings.search.placeholder": "설정 검색",
  "settings.search.emptySuffix": "와 일치하는 설정 0건",
  "settings.search.claudeCli": "CLI 경로",
  "settings.search.claudeAccounts": "계정 목록",
  "settings.search.claudeAdd": "계정 추가",
  "settings.search.statsStatus": "보내는 상태",
  "settings.search.statsToggle": "끄기/켜기",

  "settings.tree.authGroup": "인증",
  "settings.tree.claude": "Claude 계정",
  "settings.tree.other": "기타 엔진",
  "settings.tree.keymap": "키설정",
  "settings.tree.stats": "사용 통계",
  // 둘째 사이드바 그룹의 aria-label — 그룹 자신은 머리글이 없다(§45 ③), 접근가능 이름만 필요하다
  "settings.tree.categoryGroup": "설정 분류",

  "settings.claude.heading": "Claude 인증",
  "settings.claude.descriptionMulti":
    "워커가 Claude에 붙을 때 쓰는 장기 토큰 목록입니다. 이 컴퓨터에 하나뿐이고, 계정 여러 개를 두면 리밋을 만난 쪽 대신 다음 계정으로 돌아갑니다.",
  "settings.claude.descriptionSingle": "워커가 Claude에 붙을 때 쓰는 장기 토큰입니다. 이 컴퓨터에 하나뿐입니다.",
  "settings.claude.cliMissing": "claude CLI를 찾지 못했습니다 — 워커가 세션을 띄우지 못합니다",
  "settings.claude.authBrowserLabel": "브라우저로 인증",
  "settings.claude.authBrowserRunning": "진행 중…",
  "settings.claude.authBrowserRetry": "다시 시도",
  "settings.claude.authBrowserStart": "브라우저로 인증하기",
  "settings.claude.authBrowserDesc":
    "claude setup-token을 대신 실행합니다. 새 탭에서 승인한 뒤 받은 코드를 여기에 붙여 넣으면 토큰이 제자리에 저장됩니다.",
  "settings.claude.codePlaceholder": "브라우저에서 받은 코드",
  "settings.claude.codeSubmit": "코드 보내기",
  "settings.claude.authErrorTitle": "토큰을 받지 못했습니다",
  "settings.claude.authErrorFallback": '"직접 넣기"에 이미 발급받은 토큰을 붙여 넣어도 됩니다.',
  "settings.claude.authSaved": "토큰을 받아 저장했습니다.",
  "settings.claude.tokenLabel": "토큰",
  "settings.claude.tokenLabelOptional": "라벨(선택)",
  "settings.claude.tokenHintMulti":
    '이미 발급받은 토큰이 있으면 여기에 붙여 넣습니다. 목록에 대기로 추가됩니다 — 지금 쓸 토큰은 목록에서 "사용"으로 고릅니다.',
  "settings.claude.tokenHintSingle": "이미 발급받은 토큰이 있으면 여기에 붙여 넣습니다. 지금 쓰는 토큰이 이 토큰으로 바뀝니다.",
  "settings.claude.tokenSaved": "저장했습니다. 유효한지는 다음 디스패치에서 드러납니다.",
  // 잠김에서 계정이 이미 있으면 트리거는 `추가`가 아니라 이 낱말이다(§0-13 §트리거 문구,
  // 요구 `1681a5d9`) — `추가`는 도달 불가한 결과를 가리킨다. 팝오버 안·행 꼬리는 무수정.
  "settings.claude.changeTrigger": "변경",

  "settings.tokens.empty": "등록된 토큰이 없습니다.",
  "settings.tokens.labelPlaceholder": "이메일 등 알아볼 이름",
  "settings.tokens.use": "사용",
  "settings.tokens.enable": "활성화",
  "settings.tokens.disable": "비활성화",
  "settings.tokens.active": "활성",
  "settings.tokens.pending": "대기",
  "settings.tokens.disabledBadge": "비활성",
  "settings.tokens.exhausted": "소진",
  // 행의 시각 뒤에 붙는 꼬리(`· 2026-08-07 14:23 추가`). 한국어는 `common.add`와 같은 낱말이지만
  // 영어는 버튼(`Add`)과 갈린다 — 그래서 키가 둘이다.
  "settings.tokens.addedSuffix": "추가",
  // 라벨 없는 토큰의 표시 이름 접두(`lib/auth.ts`의 `readTokenRows` — "계정 " + 순번).
  // 서버가 만드는 값이라 로케일을 못 받는다(§0-16 §장치 — 아래 `keymap.ts`와 같은 사정).
  "settings.tokens.accountFallbackPrefix": "계정",
  // 행 버튼 둘의 aria-label(`<라벨> 라벨 편집` · `<라벨> 삭제`). 위 되돌리기와 같은 사정으로
  // 접두가 비어 있다 — 영어에서 채운다.
  "settings.tokens.editLabelPrefix": "",
  "settings.tokens.editLabelSuffix": "라벨 편집",
  "settings.tokens.deletePrefix": "",
  "settings.tokens.deleteSuffix": "삭제",

  "settings.other.agyCred": "인증은 macOS 로그인 키체인에 있습니다 — 이 화면이 읽지 않습니다",
  "settings.other.codexMissing": "발견 못 함 — OPENAI_API_KEY로 도는 워커는 이 판정 밖입니다",
  "settings.other.grokMissing": "발견 못 함 — 터미널에서 grok 로그인이 필요합니다",
  "settings.other.notInstalled": "설치되지 않았습니다",

  "settings.keymap.description": "단축키입니다. 이 컴퓨터에 하나뿐이고 등록된 프로젝트 전부에 적용됩니다.",
  "settings.keymap.brokenTitle": "keymap.json을 읽지 못해 전부 기본값으로 떴습니다",
  "settings.keymap.brokenHint": "여기서 키를 바꾸면 파일을 다시 씁니다.",
  "settings.keymap.capturePrompt": "키를 누르세요",
  "settings.keymap.captureRejectedSuffix": "다른 키를 누르세요 ·",
  "settings.keymap.captureCancelSuffix": "취소",
  "settings.keymap.captureHint": "누른 조합이 그대로 지정됩니다 · 다른 단축키는 그동안 듣지 않습니다 ·",
  "settings.keymap.resetTooltipPrefix": "기본값",
  "settings.keymap.resetTooltipSuffix": "(으)로 되돌립니다",
  // 되돌리기 버튼의 aria-label(`<이름> 기본값으로 되돌리기`) — 위 툴팁 문구와는 다른 문장이다.
  // 한국어는 이름 뒤가 전부라 접두가 빈다. 영어는 동사가 앞에 서서 둘로 갈린다(`wrap` 참고).
  "settings.keymap.resetActionPrefix": "",
  "settings.keymap.resetActionSuffix": "기본값으로 되돌리기",
  "settings.keymap.change": "바꾸기",
  "settings.keymap.resetAll": "전부 기본값으로",

  // §0-6 액션 표 8줄의 이름(`lib/keymap.ts`의 `DEFAULT_KEYMAP`). 목록 · 검색 인덱스 · 충돌 사유가
  // 전부 이 여덟 키를 통해 그 이름을 얻는다 — `keymap.ts`가 리터럴을 안 들고 여기서 가져온다.
  "settings.keymap.action.project.search": "프로젝트 검색",
  "settings.keymap.action.settings.open": "설정 열기",
  "settings.keymap.action.board.search": "검색",
  "settings.keymap.action.board.new": "티켓 발행",
  "settings.keymap.action.board.request": "요구 접수",
  "settings.keymap.action.nav.board": "보드로 이동",
  "settings.keymap.action.nav.workers": "워커로 이동",
  "settings.keymap.action.interject.send": "보내기",

  // 키 캡처 거절 사유(`validateBinding`) — 서버 액션이 그대로 돌려주는 문자열이다
  "settings.keymap.reject.modifierOnly": "조합키만으로는 지정할 수 없습니다.",
  "settings.keymap.reject.escape": "`Esc`는 닫기·취소에 쓰입니다.",
  "settings.keymap.reject.tab": "`Tab`은 초점 이동에 쓰입니다.",
  "settings.keymap.reject.needsMod": "`↵`·`Space`는 `⌘`과 같이 눌러야 합니다. 버튼을 누르는 키입니다.",
  "settings.keymap.reject.conflictSuffix": "겹칩니다.",
  "settings.keymap.reject.unknownAction": "모르는 액션입니다:",

  "settings.stats.description":
    "몇 벌이 도는지와 어떤 화면 동작이 있었는지만 익명으로 보냅니다. 경로·프로젝트 이름·티켓 내용은 보내지 않습니다.",
  "settings.stats.notConfigured": "보내지 않습니다 — 이 빌드에 설정이 없습니다",
  "settings.stats.sending": "보내는 중입니다",
  "settings.stats.disabled": "보내지 않습니다 — 껐습니다",
  "settings.stats.turnOff": "끄기",
  "settings.stats.turnOn": "켜기",

  "settings.language.ko": "한국어",
  "settings.language.en": "English",

  "common.save": "저장",
  "common.saving": "저장 중…",
  "common.add": "추가",
  "common.close": "닫기",

  // 발행 다이얼로그(§3)·티켓 상세 편집 폼(§2) select 라벨 — 같은 자리 같은 낱말이라 한 키를
  // 공유한다(§1-3 §값을 넣는 자리 셋. `62e0b85e`가 en을 채운다).
  "ticket.priority.label": "우선순위",
  // 상세의 상속 한 줄 `<해시>가 기다려 <유효>로 뜹니다` — 해시·유효값 두 변수라 `wrap`(변수 하나
  // 전용)이 아니라 앞뒤 두 조각으로 쪼갠다. 조립: `<해시>` + middle + ` ` + `<유효>` + after.
  "ticket.priority.inheritedMiddle": "가 기다려",
  "ticket.priority.inheritedAfter": "로 뜹니다",
};

/** 제품 낱말의 영어 대응 — **여기가 한자리다**(621c7a97). 다음 묶음이 같은 것을 다르게 부르지
 *  않게 하는 표다. 여기 없는 낱말을 처음 영어로 옮기는 사람이 한 줄을 더한다.
 *
 *  | 한국어 | English | 비고 |
 *  |---|---|---|
 *  | 티켓 · 워커 · 페르소나 · 큐 · 보드 | ticket · worker · persona · queue · board | 소문자. 화면 제목 자리에서만 첫 글자를 올린다 |
 *  | 프로젝트 · 세션 · 엔진 · 토큰 | project · session · engine · token | |
 *  | 디스패치(하다) | dispatch | 명사·동사 같은 낱말 |
 *  | 참견 | interject | §2-1의 그 동작. `interrupt`가 아니다 — 세션은 안 끊긴다 |
 *  | 설정(화면) · 설정(항목 하나) | Settings · setting | |
 *  | 인증 | authentication | 배지·버튼처럼 좁은 자리에서만 `auth` |
 *  | 키설정 | Keyboard shortcuts | `keymap`은 파일 이름이지 사람 말이 아니다 |
 *  | 사용 통계 | Usage stats | |
 *  | 티켓 상태 대기 · 진행중 · 완료 | Open · In progress · Done | |
 *  | 토큰 상태 대기 · 활성 · 비활성 · 소진 | Pending · Active · Disabled · Exhausted | **티켓의 `대기`와 다른 낱말이다** |
 *  | 액션(키설정 한 줄) · 조합키 | action · modifier | 6914f1d1이 더한 줄부터 아래 |
 *  | 라벨 · 계정 | label · account | 라벨 없는 토큰의 표시 이름이 `Account 1`이다 |
 *  | 티켓 발행 · 요구 접수 | New ticket · New request | 다이얼로그를 여는 줄이라 동사가 아니라 여는 것의 이름이다 |
 *  | 기본값으로 되돌리기 | Reset to default | 툴팁은 관사가 붙는다(`Reset to the default ⌘K`) |
 *  | 설정 분류 | Setting categories | 화면에 안 뜨는 접근가능 이름 |
 *
 *  **어순이 뒤집히는 자리는 접두·접미 두 키로 쪼갠다.** 한국어는 이름 뒤에 다 붙지만(`<이름>
 *  삭제`) 영어는 동사가 앞에 선다(`Delete <name>`) — 한쪽이 비는 것이 정상이고, 조립은
 *  `wrap`이 한다.
 *
 *  문장의 결: 개발자 도구다. 짧게 쓰고, 동사로 쓰고, 문장부호 하나로 끝낼 수 있으면 거기서
 *  끝낸다. 버튼·라벨은 문장부호 없음(`Save`), 설명문은 마침표 있음.
 *
 *  **없는 키는 `ko`로 떨어진다**(아래 `t`) — 이 사전이 완성 전이어도 화면은 안 깨진다.
 *
 *  `export`는 `ko`와 같은 이유다 — 테스트가 두 사전의 키를 맞대 본다(`i18n.test.ts`). */
export const en: Record<string, string> = {
  "settings.language.label": "Language",

  "settings.dialog.title": "Settings",
  "settings.dialog.description": "dira settings for this machine. They apply to every registered project.",
  "settings.dialog.triggerLink": "Save a token",
  "settings.dialog.needsAuth": "Needs auth",

  "settings.search.placeholder": "Search settings",
  // 앞에 `"질의"`가 그대로 붙는다(`CommandEmpty`) — 쌍따옴표에 콜론이 바로 붙으므로 값이
  // 공백으로 시작하지 않는다. 조립 결과는 `i18n.test.ts`가 못박는다.
  "settings.search.emptySuffix": ": no matching settings",
  "settings.search.claudeCli": "CLI path",
  "settings.search.claudeAccounts": "Accounts",
  "settings.search.claudeAdd": "Add account",
  "settings.search.statsStatus": "Sending status",
  "settings.search.statsToggle": "Turn on / off",

  "settings.tree.authGroup": "Authentication",
  "settings.tree.claude": "Claude account",
  "settings.tree.other": "Other engines",
  "settings.tree.keymap": "Keyboard shortcuts",
  "settings.tree.stats": "Usage stats",
  "settings.tree.categoryGroup": "Setting categories",

  "settings.claude.heading": "Claude authentication",
  "settings.claude.descriptionMulti":
    "Long-lived tokens that workers use to reach Claude. One list per machine. Keep several accounts and a worker that hits a limit rolls over to the next one.",
  "settings.claude.descriptionSingle":
    "The long-lived token workers use to reach Claude. One per machine.",
  "settings.claude.cliMissing": "No claude CLI here — workers can't start a session",
  "settings.claude.authBrowserLabel": "Browser sign-in",
  "settings.claude.authBrowserRunning": "Working…",
  "settings.claude.authBrowserRetry": "Try again",
  "settings.claude.authBrowserStart": "Start sign-in",
  "settings.claude.authBrowserDesc":
    "This runs claude setup-token for you. Approve it in the new tab, paste the code you get back, and the token lands in place.",
  "settings.claude.codePlaceholder": "Code from the browser",
  "settings.claude.codeSubmit": "Send code",
  "settings.claude.authErrorTitle": "No token came back",
  "settings.claude.authErrorFallback": "If you already have a token, paste it in the field below.",
  "settings.claude.authSaved": "Got the token and saved it.",
  "settings.claude.tokenLabel": "Token",
  "settings.claude.tokenLabelOptional": "Label (optional)",
  "settings.claude.tokenHintMulti":
    'Paste a token you already have. It joins the list as Pending — the "Use" button picks which one runs now.',
  "settings.claude.tokenHintSingle":
    "Paste a token you already have. It replaces the one in use.",
  "settings.claude.tokenSaved": "Saved. Whether it works shows up on the next dispatch.",
  "settings.claude.changeTrigger": "Change",

  "settings.tokens.empty": "No tokens yet.",
  "settings.tokens.labelPlaceholder": "An email, or any name you'll recognize",
  "settings.tokens.use": "Use",
  "settings.tokens.enable": "Enable",
  "settings.tokens.disable": "Disable",
  "settings.tokens.active": "Active",
  "settings.tokens.pending": "Pending",
  "settings.tokens.disabledBadge": "Disabled",
  "settings.tokens.exhausted": "Exhausted",
  "settings.tokens.addedSuffix": "added",
  "settings.tokens.accountFallbackPrefix": "Account",
  // 영어는 동사가 앞이다 — 접미가 비고 접두가 문장을 연다(`Delete Account 1`).
  "settings.tokens.editLabelPrefix": "Edit label for",
  "settings.tokens.editLabelSuffix": "",
  "settings.tokens.deletePrefix": "Delete",
  "settings.tokens.deleteSuffix": "",

  "settings.other.agyCred": "Credentials sit in the macOS login keychain — this screen doesn't read them",
  "settings.other.codexMissing": "Not found — workers running on OPENAI_API_KEY are outside this check",
  "settings.other.grokMissing": "Not found — run grok login in a terminal",
  "settings.other.notInstalled": "Not installed",

  "settings.keymap.description":
    "Keyboard shortcuts. One set per machine, applied to every registered project.",
  "settings.keymap.brokenTitle": "Couldn't read keymap.json — everything came up on defaults",
  "settings.keymap.brokenHint": "Change a key here and dira rewrites the file.",
  "settings.keymap.capturePrompt": "Press a key",
  "settings.keymap.captureRejectedSuffix": "Press another key ·",
  "settings.keymap.captureCancelSuffix": "to cancel",
  "settings.keymap.captureHint":
    "Whatever you press is assigned as-is · other shortcuts stop listening while this is open ·",
  // 뒤에 조합 표기가 바로 붙어 문장이 끝난다(`Reset to the default ⌘K`) — 영어는 꼬리가 없다.
  // 빈 값은 실수가 아니다: `t`는 `""`를 그대로 돌려주고 `ko` 폴백으로 새지 않는다.
  "settings.keymap.resetTooltipPrefix": "Reset to the default",
  "settings.keymap.resetTooltipSuffix": "",
  "settings.keymap.resetActionPrefix": "Reset",
  "settings.keymap.resetActionSuffix": "to default",
  "settings.keymap.change": "Change",
  "settings.keymap.resetAll": "Reset all to defaults",

  // §0-6 액션 표 8줄. 목록 한 줄이 곧 이름이라 짧게 쓴다 — 여는 것은 그 이름으로,
  // 가는 것은 `Go to`로. `board.search`가 `Search projects`와 갈리는 것은 의도다:
  // 이 키는 화면마다 찾는 대상이 달라 목적어를 못 적는다(ko도 같은 이유로 `검색`이다).
  "settings.keymap.action.project.search": "Search projects",
  "settings.keymap.action.settings.open": "Open settings",
  "settings.keymap.action.board.search": "Search",
  "settings.keymap.action.board.new": "New ticket",
  "settings.keymap.action.board.request": "New request",
  "settings.keymap.action.nav.board": "Go to board",
  "settings.keymap.action.nav.workers": "Go to workers",
  "settings.keymap.action.interject.send": "Send",

  // 거절 사유. 뒤에 `Press another key · Esc to cancel`이 이어 붙으므로 마침표로 끝낸다.
  "settings.keymap.reject.modifierOnly": "A modifier on its own isn't a shortcut.",
  "settings.keymap.reject.escape": "`Esc` closes and cancels.",
  "settings.keymap.reject.tab": "`Tab` moves focus.",
  "settings.keymap.reject.needsMod": "`↵` and `Space` need `⌘` with them. On their own they press buttons.",
  // 앞에 상대 액션 이름이 붙어 문장이 된다(`Send already uses this key.`) — 한국어의
  // `<이름>과 겹칩니다.`와 같은 어순이라 접두 조각이 없다.
  "settings.keymap.reject.conflictSuffix": "already uses this key.",
  "settings.keymap.reject.unknownAction": "Unknown action:",

  "settings.stats.description":
    "Sends two things, anonymously: how many copies of dira are running, and which screen actions happened. Paths, project names, and ticket contents stay on this machine.",
  "settings.stats.notConfigured": "Not sending — this build isn't set up for it",
  "settings.stats.sending": "Sending",
  "settings.stats.disabled": "Not sending — you turned it off",
  "settings.stats.turnOff": "Turn off",
  "settings.stats.turnOn": "Turn on",

  // 언어 이름은 그 언어로 적는다 — 영어 화면에서도 `한국어`가 `Korean`이 되지 않는다.
  "settings.language.ko": "한국어",
  "settings.language.en": "English",

  "common.save": "Save",
  "common.saving": "Saving…",
  "common.add": "Add",
  "common.close": "Close",
};

const DICTS: Record<Locale, Record<string, string>> = { ko, en };

/** 없는 키는 `ko`로 떨어진다. `ko`에도 없으면 개발 실수다 — 조용히 키 이름을 보여주지 않고
 *  던진다(§0-16 §장치 "없는 키" 못). */
export function t(locale: Locale, key: string): string {
  const value = DICTS[locale][key] ?? ko[key];
  if (value === undefined) throw new Error(`i18n: 사전에 없는 키 "${key}" (ko에도 없음)`);
  return value;
}

/** 변수를 앞뒤 조각으로 감싼 조합 문구. **빈 조각은 빠지고 공백은 하나만 남는다** —
 *  한국어는 접두가 비고(`<이름> 삭제`) 영어는 접미가 빈다(`Delete <name>`), 같은 자리를
 *  두 어순으로 그리는 것이 이 함수가 있는 이유다(6914f1d1).
 *
 *  ponytail: 자리표시자(`{name}`) 치환기를 만들지 않는다 — 이 앱의 조합 문구는 전부
 *  `앞·변수·뒤` 셋이고, 그 이상이 나오면 그때 만든다. */
export function wrap(prefix: string, mid: string, suffix: string): string {
  return [prefix, mid, suffix].filter(Boolean).join(" ");
}
