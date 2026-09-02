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

/** 공개 사이트 언어 토글(§0-24 §토글)이 쓰는 쿠키 이름. `lib/site-locale.ts`가 아니라 여기
 *  두는 이유는 클라이언트 토글(`components/language-toggle.tsx`)이 `node:fs`를 문 그 파일을
 *  못 물어서다 — 이 파일은 `node:*`가 없다(위 머리 주석). */
export const LOCALE_COOKIE = "dira-locale";

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
  "settings.search.multitokenToggle": "다중계정 허용",
  "settings.search.multiplayToggle": "다중계정 동시사용",

  // 첫 그룹 — 프로젝트를 받은 자리에서만 뜬다(§설정이 프로젝트와 공통으로 갈린다 결정 1-2)
  "settings.tree.projectGroup": "프로젝트",
  "settings.tree.authGroup": "인증",
  "settings.tree.keymap": "키설정",
  "settings.tree.stats": "사용 통계",
  // 사이드바 트리에는 안 뜬다(§0-18) — 검색으로만 닿는다. 그래도 이름은 다른 노드와 같은
  // 키 규약(`settings.tree.<node>`)을 쓴다 — 화면 자리가 하나 늘 뿐 이름 짓는 법은 안 갈린다.
  "settings.tree.multiplay": "멀티플레잉",
  // 둘째 사이드바 그룹의 aria-label — 그룹 자신은 머리글이 없다(§45 ③), 접근가능 이름만 필요하다
  "settings.tree.categoryGroup": "설정 분류",
  // 여섯째 노드 — §0-10이 정한 글자, `언어` 다음(§비주얼 §45 §개정 `475d3385`)
  "settings.tree.webhook": "웹훅",
  // 열째 노드(§4-16 결정 5) — `설정 분류` 그룹의 마지막, `웹훅` 다음
  "settings.tree.workers": "워커",

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
    '이미 발급받은 토큰이 있으면 여기에 붙여 넣습니다. 목록에 추가만 되고 지금 쓰는 토큰은 그대로입니다 — 바꾸려면 목록에서 "사용"으로 고릅니다.',
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

  // §0-23 §화면 — agy 줄은 못 하는 이유까지 알려 준다. 키체인 항목이 `svce=gemini` 하나뿐이고
  // 갈아 끼우는 레버가 `HOME`밖에 없어 이번 회차에 목록도 버튼도 안 세웠다(그 절 §agy).
  "settings.other.agyCred":
    "인증이 macOS 로그인 키체인에 있습니다 — 항목이 하나뿐이라 계정을 여러 장 못 씁니다. 갈아 끼우려면 워커의 HOME을 통째로 옮겨야 합니다.",
  "settings.other.codexMissing": "발견 못 함 — OPENAI_API_KEY로 도는 워커는 이 판정 밖입니다",
  "settings.other.grokMissing": "발견 못 함 — 터미널에서 grok 로그인이 필요합니다",
  "settings.other.notInstalled": "설치되지 않았습니다",

  // §0-23 §화면 — codex · grok 패널이 얻는 목록과 버튼 하나. 넷 다 두 엔진 공용이다(엔진
  // 이름은 바로 위 패널 머리가 이미 알려 준다). 담는 것이 토큰 문자열이 아니라 터미널의 지금
  // 로그인 상태(`~/.codex` · `~/.grok` 사본)라 claude 쪽 `추가`와 낱말이 갈린다.
  "settings.other.accounts": "계정",
  "settings.other.capture": "지금 로그인된 계정 담기",
  "settings.other.captureHint":
    "터미널에서 쓰려는 계정으로 먼저 로그인하세요. 그 상태를 통째로 복사해 목록에 넣습니다.",
  // 버튼이 비활성일 때 그 밑에 뜨는 한 줄. 판정은 위 `자격증명` 줄이 이미 잰 그 사실 하나다.
  "settings.other.captureBlocked": "터미널에 로그인 상태가 없습니다 — 담을 것이 없어 누르지 못합니다.",

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
  // 한국어는 이름 뒤가 전부라 접두가 빈다. 영어는 동사가 앞에 떠서 둘로 갈린다(`wrap` 참고).
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

  // §0-23 §화면 — 스위치가 이제 세 엔진을 가른다. 종전 문장은 claude 계정을 전제했다.
  "settings.multiplay.description":
    "다중계정 허용은 계정을 여러 장 등록할 수 있게 하고, 다중계정 동시사용은 그 계정들을 워커마다 나눠 동시에 씁니다. claude · codex · grok 세 엔진에 각각 적용됩니다 — agy는 계정이 하나뿐이라 빠집니다.",
  "settings.multitoken.enabled": "허용되어 있습니다",
  "settings.multitoken.disabled": "허용되지 않았습니다",
  "settings.multitoken.turnOff": "끄기",
  "settings.multitoken.turnOn": "켜기",
  "settings.multiplay.enabled": "허용되어 있습니다",
  "settings.multiplay.disabled": "허용되지 않았습니다",
  "settings.multiplay.turnOff": "끄기",
  "settings.multiplay.turnOn": "켜기",

  "settings.language.ko": "한국어",
  "settings.language.en": "English",

  // §비주얼 §45 ⑪ (5) — 노드 이름·`테스트 보내기`·성공/실패 문장은 §0-10이 정한 글자다(새 문구
  // 아님). placeholder·`보내는 중...`·`보내지 않습니다`·거절 문장 넷은 이 절이 새로 고른 값이다.
  "settings.webhook.urlLabel": "주소",
  "settings.webhook.urlPlaceholder": "https://",
  "settings.webhook.test": "테스트 보내기",
  "settings.webhook.testing": "보내는 중...",
  "settings.webhook.testOk": "보냈습니다",
  "settings.webhook.testFailPrefix": "보내지 못했습니다",
  "settings.webhook.off": "보내지 않습니다",
  "settings.webhook.rejectHttps": "https 주소만 받습니다",

  // 설정 `워커` 패널(§4-16 §롤백 · §비주얼 §68). 이 패널은 t()로만 문구를 그리므로 키가
  // 새로 난다 — 값은 워커 표(`workers-ui.tsx`)와 같다.
  "settings.workers.allHeading": "전체 워커",
  "settings.workers.filterCrumb": "필터",
  "settings.workers.filterProject": "프로젝트",
  "settings.workers.filterStatus": "상태",
  "settings.workers.filterReset": "필터 초기화",
  "settings.workers.filteredEmpty": "조건에 맞는 워커 0건",
  "settings.workers.projectsEmpty": "등록된 프로젝트가 없습니다.",

  // 머신 전체 세션 상한(§세션이 120초 안에 못 뜬다 §개정 결정 2-3).
  "sessionCap.limit.invalidPrefix": "정수(0 이상)만 됩니다:",
  "settings.workers.sessionCapHeading": "머신 전체 세션 상한",
  "settings.workers.sessionCapLimitLabel": "상한",
  "settings.workers.sessionCapLimitNone": "없음",
  "settings.workers.sessionCapPopoverLabel": "동시 세션 상한",
  "settings.workers.sessionCapPopoverHint": "비우면 상한이 없어집니다 — 이 컴퓨터에서 한꺼번에 도는 claude 세션 수를 막는 값입니다.",
  "settings.workers.sessionCapSaveFailedTitle": "상한을 저장하지 못했습니다",
  "settings.workers.sessionCapWarnUnreadable": "session-limit을 읽지 못했습니다 — 상한 없음으로 읽습니다.",
  "settings.workers.sessionCapTotalPrefix": "머신 전체 ",
  "settings.workers.sessionCapTotalSep": "/",
  "settings.workers.sessionCapAtCap": "지금 상한에 차 있어 새 세션이 안 뜹니다.",

  "common.save": "저장",
  "common.saving": "저장 중…",
  "common.add": "추가",
  "common.close": "닫기",
  "common.cancel": "취소",
  "common.back": "뒤로",
  "common.create": "만들기",
  "common.creating": "만드는 중…",

  // 공개 사이트 언어 토글(`components/language-toggle.tsx`, §0-24 §토글)의 버튼 글자 — 지금
  // 안 고른, 눌러서 건너갈 언어의 짧은 이름이다(`settings.language.ko`/`.en`은 풀 자리라 이
  // 36×36 버튼엔 길다). `common.*`이 아닌 것은 그 접두가 이미 en이 다 찬 묶음이라서다
  // (`i18n.test.ts`의 `FILLED`) — 이 토글은 새 컴포넌트라 en을 아직 안 채운다.
  "languageToggle.shortKo": "한",
  "languageToggle.shortEn": "EN",

  // 파일을 OS 기본 앱으로 여는 아이콘 버튼(DESIGN.md §10) — 자리 다섯(온톨로지·프로토콜·
  // 페르소나·에픽·티켓 상세)이 이 두 키를 그대로 같이 쓴다.
  "common.openInApp": "기본 앱으로 열기",
  "common.openInApp.failed": "파일을 열지 못했습니다",

  // 발행 다이얼로그(§3)·티켓 상세 편집 폼(§2) select 라벨 — 같은 자리 같은 낱말이라 한 키를
  // 공유한다(§1-3 §값을 넣는 자리 셋. `62e0b85e`가 en을 채운다).
  "ticket.priority.label": "우선순위",
  // 상세의 상속 한 줄 `<해시>가 기다려 <유효>로 뜹니다` — 해시·유효값 두 변수라 `wrap`(변수 하나
  // 전용)이 아니라 앞뒤 두 조각으로 쪼갠다. 조립: `<해시>` + middle + ` ` + `<유효>` + after.
  "ticket.priority.inheritedMiddle": "가 기다려",
  "ticket.priority.inheritedAfter": "로 뜹니다",
  // select 다섯 항목의 꼬리 문구(`62e0b85e`). 숫자만 있으면 큐를 처음 여는 사람은 1과 5 중
  // 어느 쪽이 급한 건지도 모른다 — 각 값이 **엔진에서 무슨 일을 하는지**를 적는다.
  // 1은 §1-3 §1 게이트(진행중 0건일 때만 후보), 5는 §1-3 §선점(도는 세션 하나를 끊는다).
  // 2·4는 순서만 바꾼다 — 없는 동작을 지어내지 않고 그 사실 그대로 적는다.
  "ticket.priority.level.1": "아무것도 안 돌 때만",
  "ticket.priority.level.2": "나중에",
  "ticket.priority.level.3": "기본",
  "ticket.priority.level.4": "먼저",
  "ticket.priority.level.5": "당장 — 도는 세션을 끊는다",
  // 미터 옆 `sr-only` 문구(§비주얼 §49)의 앞조각 — `wrap(prefix, String(priority), "")`로 붙인다.
  // 문구는 종전 그대로다(§49 값 표 "새 문구 0") — 하드코딩이던 것을 사전으로 옮긴 것뿐이다.
  "ticket.priority.srOnly": "우선순위",

  // 셸 알림 종 ⑦(마감 경고, §1-4 · §0-10 문구 표 ⑦). ①~⑥은 아직 이 사전으로 안 옮겨졌다 —
  // 이 티켓(`a50c8304`)의 몫은 ⑦뿐이다. en은 `5debff0e`가 채운다.
  "bell.due.titlePrefix": "마감을 못 지킬 티켓",
  "bell.due.titleSuffix": "건",
  "bell.due.body": "마감이 지났거나, 선행 티켓이 안 풀린 채로 마감이 가까워졌습니다.",
  "bell.due.overdue": "마감이 지났습니다",
  // 남은 시간(`remainingLabel`) 뒤에 붙는 조각 둘 — "<남은> 남았는데 선행 <n>건이 안 끝났습니다".
  // count는 숫자에 바로 붙어야(`2건`) 하므로 이 둘 사이엔 공백을 안 넣는다.
  "bell.due.blockedMiddle": "남았는데 선행",
  "bell.due.blockedSuffix": "건이 안 끝났습니다",
  "bell.due.openTicket": "티켓 열기",

  // 마감(§1-4 §화면). 상세(§2)·발행 다이얼로그(§3)가 같은 입력 라벨·지우기 버튼을 쓴다
  // (en은 `5debff0e`가 채운다).
  "ticket.duedate.label": "마감",
  "ticket.duedate.clear": "지우기",
  // 파생 한 줄 `마감까지 <남은> — 우선순위 <파생>으로 뜹니다`. 변수 둘(남은·파생)이라
  // `ticket.priority.inherited*`와 같은 앞·중간·뒤 세 조각 조립이다. 우선순위의 상속 한 줄과
  // 같은 자리이고 둘 다 뜨면 한 줄에 이어 붙는다(§1-3의 그 자리 그대로).
  "ticket.duedate.derivedPrefix": "마감까지",
  "ticket.duedate.derivedMiddle": "— 우선순위",
  "ticket.duedate.derivedAfter": "로 뜹니다",
  // 1시간 미만 남은 파생 한 줄의 <남은> 자리(§1-4 §화면). 지난 마감은 이 자리에 안 온다 —
  // 호출부가 `bell.due.overdue`로 따로 그린다(`마감까지 지남`류 비문을 막는다, `4f7def31`).
  "ticket.duedate.underHour": "1시간 미만",
  // 역전 거부 — 입력 아래 한 줄 + 저장 버튼 비활성(§1-4 §화면). 해시 하나만 변수라 접미 하나.
  "ticket.duedate.reversalSuffix": "와 마감 순서가 어긋납니다 — 선행이 후행보다 늦게 끝날 수 없습니다",

  // 되돌아온 횟수 한 줄(§2-14 (2) · §비주얼 §11 §개정). `{prefix} {n}{suffix}` —
  // `bell.assigned.title*`와 같은 짝이다. 2회 이상일 때만 뜨고 1회 이하면 줄 자체가 없다.
  "ticket.retries.linePrefix": "다시 할당",
  "ticket.retries.lineSuffix": "회",

  // 남은 시간 표기(종 ⑦ 나열 · 상세 파생 한 줄)의 낱말 — 숫자에 공백 없이 바로 붙는다
  // (`3시간 30분`·`3h 30m`). en은 복수형 장치가 없는 이 앱 사정(§0-16) 그대로 약어로 피한다.
  "common.unit.hour": "시간",
  "common.unit.minute": "분",
  "common.unit.day": "일",
  // 폴링 대기 절(§폴링 대기 결정 4·9) 주기 표기 — `300초`처럼 숫자에 바로 붙는다.
  "common.unit.second": "초",
  // 페르소나 상세 머리 2행 "마지막 활동"(§비주얼 §66 ③) — `<n><단위> <ago>`가 두 로케일에서
  // 같은 어순으로 뜬다(`12분 전` · `12m ago`).
  "common.suffix.ago": "전",
  // 폴링 대기 배지·상세 절의 남은 시간(§폴링 대기 결정 9) — `agoLabel`의 `common.suffix.ago`와
  // 같은 자리, 반대 방향(지난 게 아니라 남은 것)이다.
  "common.suffix.remaining": "남음",
  // 홈 좌측 패널 스케줄 줄의 이미 돈 단발(`scheduleRows`, §비주얼 §62 (3)) — `<시각> 지남`.
  "common.suffix.overdue": "지남",

  // 셸 둘째 묶음(§0-16 §발행 §묶음 표 2, `dd97c69c`) — 헤더 · 알림 종 일곱 · status bar ·
  // 배너 · 전환기 · `status-badge.tsx`(상태 배지 · deps 배지 — 보드·상세도 이 벌을 공유한다).

  "shell.header.manual": "매뉴얼",
  // 연결 안 됨 배너 제목 `프로젝트 "<이름>"의 .dira를 읽을 수 없습니다` — 이름은 변수라 앞뒤로 쪼갠다.
  "shell.error.titlePrefix": "프로젝트",
  "shell.error.titleSuffix": "의 .dira를 읽을 수 없습니다",
  // 연결 안 됨 화면의 재확인 버튼(`project-switcher.tsx`).
  "shell.error.refresh": "다시 확인",
  // `/`로 가는 링크 — 배너 CTA와 전환기 하단 항목(값·문구 둘 다)이 같은 낱말을 쓴다.
  "shell.nav.projects": "프로젝트 관리",
  "shell.nav.board": "보드",
  "shell.nav.personas": "페르소나",
  "shell.nav.protocols": "프로토콜",
  "shell.nav.ontology": "온톨로지",
  "shell.nav.workers": "워커",
  "shell.switcher.ariaLabel": "프로젝트 전환",
  "shell.switcher.searchPlaceholder": "프로젝트 검색 — 이름 또는 경로",
  // 0건 문구 — 검색어가 있으면 `"<q>"와 일치하는 프로젝트 0건`, 없으면 접두 없이 꼬리만.
  "shell.switcher.emptyQueriedGlue": "와",
  "shell.switcher.emptySuffix": "일치하는 프로젝트 0건",
  "shell.switcher.openLabel": "열림",
  // §0-22 - §비주얼 §65 ④ — 전환기 `프로젝트 관리` 항목이 `/`로 나가는 동안 든다(300ms 지연).
  "shell.switcher.opening": "여는 중",
  // §0-22 - §비주얼 §65 ⑤ — 셸 표식(`<RoutePending/>`)의 `role="status"` 안 `sr-only` 낱말.
  "shell.pending.srLabel": "이동 중",
  // 업데이트 토스트 그릇의 낭독 이름(§비주얼 §55 (10)) — `<Toaster containerAriaLabel>`.
  "shell.update.ariaLabel": "알림",

  // 알림 종(§0-10 문구 표 · §비주얼 §28). `bell.due.*`(⑦)는 `a50c8304`가 먼저 옮겼다 — 아래는
  // 나머지 여섯(⑤①②③④⑥, §0-14 순서) + 트리거 자신의 배지 라벨.
  "bell.trigger.countPrefix": "알림",
  "bell.trigger.countSuffix": "건",
  "bell.trigger.empty": "알림 없음",
  // ②⑥ 둘 다 쓰는 `보관`(`project-switcher.tsx`의 두 버튼) — 한 낱말이라 키 하나
  // (§0-10 §받은 편지함 §보관 = 읽음이다 — 개정 `38337fa2`로 `읽음으로 표시`에서 갈렸다).
  "bell.markRead": "보관",
  // 팝오버 머리의 `보관함` 토글 + 빈 보관함(§0-10 §받은 편지함 §보관한 것을 다시 본다 —
  // 개정 `38337fa2`).
  "bell.archive.toggle": "보관함",
  "bell.archive.empty": "보관한 알림 없음",
  // 보관함 행(⑥) 종류 낱말 — 팝오버 ⑥ 항목의 나열 행도 이 키를 그대로 쓴다(개정 `4ea7e8d9`로
  // ⑥의 제목이 건수가 되면서 `kind`가 나열로 내려갔다 — `f2f80429`가 따로 뗀 근거였던
  // *문장형 제목과 톤이 갈린다*는 이제 없다).
  "bell.archive.kindSlept": "잠자기",
  "bell.archive.kindWake": "꺼짐",
  "bell.offline.title": "네트워크가 끊겨 있습니다",
  "bell.offline.body":
    "세션이 열리지 못하고 티켓은 그때마다 대기로 돌아갑니다. 연결이 돌아오면 저절로 재개됩니다.",
  "bell.offline.hint": "Wi-Fi 또는 유선 연결을 확인하세요.",
  // 제목이 건수다(③④⑦의 `<주어> <n>건` 그 벌 — 개정 `4ea7e8d9`로 `titleSlept`/`titleWake`/
  // `middle`/`after` 넷에서 갈렸다. `kind`는 나열 행으로 내려갔다).
  "bell.resume.titlePrefix": "큐가 멈춰 있던 구간",
  "bell.resume.titleSuffix": "건",
  "bell.resume.body": "잃은 것은 없습니다 — 이미 다시 돌고 있습니다.",
  "bell.resume.noAction": "고칠 일은 없습니다.",
  // 종 ⑧(§4-14 §표식 파일 · §0-10 ⑧). 본문은 게이트가 표식 첫 줄에 적은 받는 트리 절대경로
  // 앞에 붙는 꼬리다(`<tree>가 …` — `bell.assigned.titlePrefix`와 같은 앞·뒤 조립 방식, 요구 `90b7d019`).
  "bell.gate.title": "커밋 안 된 변경이 디스패치를 막고 있습니다",
  "bell.gate.bodySuffix":
    "가 깨끗해질 때까지 워커가 티켓을 아예 안 집습니다. 고장난 것은 없습니다 - 커밋하거나 되돌리면 다음 tick부터 저절로 재개됩니다.",
  "bell.gate.action": "그 트리에서 커밋하거나, 지울 것이면 지우세요.",
  // §0-10 §전부 잔해일 때만 버튼 하나가 뜬다 결정 5-6 (요구 `cd1673fd`). 나열이 전부 `잔해`일
  // 때만 뜨는 갈래 — `bell.gate.action`을 대체한다(결정 3).
  "bell.gate.actionAllDebris": "이 변경은 전부 경쟁 push가 남긴 잔해입니다 - 버려도 잃는 것이 없습니다.",
  "bell.gate.discardButton": "잔해 버리기",
  "bell.gate.discardDoneBody": "버렸습니다. 다음 tick에 게이트가 확인하면 이 항목이 사라집니다.",
  "bell.gate.discardFailedTitle": "잔해를 못 버렸습니다",
  "bell.gate.verdictDebris": "잔해",
  "bell.gate.verdictHandEdited": "사람편집",
  "bell.auth.title": "Claude 토큰이 없습니다",
  "bell.auth.body": "워커가 티켓을 집어도 세션을 못 열고 그대로 끝냅니다.",
  // §0-10 ①의 두 번째 갈래(요구 `6455b43a`) — 등록은 있는데 eligible이 0일 때다.
  // `없습니다`가 아니다 — 지운 것은 파생 파일 하나뿐이고 등록 항목은 그대로다.
  "bell.auth.titleExhausted": "지금 쓸 수 있는 Claude 계정이 없습니다",
  "bell.auth.bodyExhausted":
    "등록한 계정은 그대로 있습니다 - 다시 인증하지 않아도 됩니다. 전부 소진이거나 비활성입니다.",
  "bell.failures.titlePrefix": "세션이 열리자마자 죽는 워커",
  "bell.failures.titleSuffix": "개",
  "bell.failures.body": "티켓은 그때마다 대기로 정확히 돌아옵니다. 잃는 것은 없습니다.",
  "bell.failures.footer": "사유에 적힌 시각이 지나면 저절로 다시 집습니다 — 고칠 일은 없습니다.",
  "bell.assigned.titlePrefix": "아무도 집지 않는 티켓",
  "bell.assigned.titleSuffix": "건",
  "bell.assigned.body": "워커가 잡아 둔 채 놓지 않아서, 이 티켓들은 순서가 와도 넘어갑니다.",
  "bell.awaiting.titlePrefix": "답변을 기다리는 티켓",
  "bell.awaiting.titleSuffix": "건",
  "bell.awaiting.body": "사람이 답을 써야 이 티켓들이 다시 큐에 뜹니다. 고장난 것은 없습니다.",
  "bell.awaiting.answerLink": "답변 쓰기",

  // 웹훅(§0-10 §답변 대기가 앱 밖으로 나간다) — 본문 `text` 칸 하나. 담는 값은 세 자리뿐이라
  // `wrap`(하나짜리 자리표시자)로 안 맞고, 여기서만 쓰는 일회성 조립이라 범용 치환기를 새로
  // 안 만든다(`webhook.ts`의 `webhookText`가 이 셋을 갈아 끼운다).
  "webhook.text": "답변 대기: {title} - {project} ({hash})",

  // status bar (§0-8 · §비주얼 §26 §38).
  "statusbar.idle.allRunning": "없음 — 전원 running",
  "statusbar.idle.none": "없음",
  // idle 워커 풀의 `sr-only` 접두어 — 앞에 공백 없이 라벨이 바로 붙으므로 **값 자체에 공백을 넣는다**
  // (원문 `<span className="sr-only"> 워커</span>`와 같은 바이트).
  "statusbar.idleSrOnlySuffix": " 워커",
  "statusbar.rate.title": "최근 10분 · 이 프로젝트의 워커 세션",
  "statusbar.rate.suffix": "토큰/분",
  "statusbar.usage.suffix": "사용",
  "statusbar.reset.suffix": "리셋",
  "statusbar.tokens.suffix": "토큰",
  "statusbar.limit.unreadable": "한도를 읽을 수 없습니다",
  // 아래 다섯은 `lib/usage.ts`가 만드는 `EngineLimit.error`의 꼬리(엔진 이름·경로가 접두로 붙는다) —
  // 화면(`EngineCell`)이 `title`에 싣는다. claude의 실패도 §0-8 §재개정으로 이제 이 사유가 뜬다.
  "statusbar.limit.unknownOriginSuffix": "한도를 주는 원본을 모릅니다",
  "statusbar.limit.noRolloutSuffix": "rollout 파일이 없습니다",
  "statusbar.limit.rateLimitsNullSuffix": "rate_limits.primary·secondary가 모두 null입니다",
  "statusbar.limit.noRateLimitsSuffix": "최근 rollout에 rate_limits가 없습니다",
  "statusbar.limit.noUnifiedHeaderSuffix": "unified-5h·7d의 utilization이 없습니다",

  // 상태 배지(§비주얼 §2 · §4-1) — 보드·상세·워커 화면이 `status-badge.tsx` 하나를 공유하므로
  // 여기 한 벌만 옮기면 그 화면들도 같이 뜬다(그 화면들 자신의 이행은 각자의 묶음 몫이다).
  // `running`·`idle`·`stopped`·`stale`은 한글이 없어 그대로 두되, 조회를 한 벌로 맞추려고 키를 준다.
  "status.label.open": "대기",
  "status.label.blocked": "deps 대기",
  "status.label.awaiting": "답변 대기",
  "status.label.assigned": "할당됨",
  "status.label.wip": "진행중",
  "status.label.done": "완료",
  // §P294 §미완으로 끝나는 세션 결정 3 — `continued:`를 든 완료 티켓만 이 라벨로 갈린다.
  "status.label.doneContinued": "완료(이어짐)",
  "status.label.running": "running",
  "status.label.idle": "idle",
  "status.label.stopped": "stopped",
  "status.label.stale": "stale",
  "status.label.connected": "연결됨",
  "status.label.disconnected": "연결 안 됨",
  // 폴링 대기(§폴링 대기 결정 9) — `blocked`의 하위 종류가 아니다(`isPolling`이 별도 판정),
  // 그래도 배지 표 한 자리를 같이 쓴다(`isAwaiting`과 같은 자리 — 5상태를 안 늘린다).
  "status.label.polling": "폴링 대기",
  "status.label.pollingOverdue": "상한 지남",

  // `kind:` 넉 자(§0-16 §장치, `status-badge.tsx`의 `KIND_LABELS`) — 보드 분류 칸과 페르소나
  // 상세 활동 탭이 같은 표를 쓴다. 표에 없는 값은 호출부가 원문 그대로 그린다.
  "kind.label.work": "작업",
  "kind.label.request": "요구사항",
  "kind.label.feedback": "피드백",
  "kind.label.answer": "답변",

  // 진행 기록 안 계획 아코디언(§비주얼 §59 ⑩) — 왼쪽 칸 상태 글리프의 `sr-only` 낱말 넷.
  // `기록 n건`은 §9 묶음 줄과 같은 문자열이라 여기 안 올린다(그 절의 범위 판정).
  "progress.plan.pending": "미착수",
  "progress.plan.cancelled": "취소",
  "progress.plan.doing": "진행중",
  "progress.plan.done": "완료",

  // 진행 기록 머리 줄 진행도 덩이(§비주얼 §71 ⑫) — `계획 <완료>/<분모>`의 라벨 한 낱말.
  "progress.plan.ratioLabel": "계획",

  // 배치 개정(§비주얼 §59 ⑦-1) — 계획 목록을 앞뒤로 감싸는 칸 둘의 제목 줄 낱말.
  "progress.segment.assign": "배정",
  "progress.segment.wrapup": "마무리",

  // 오류인 결과 줄 표식(§비주얼 §60 ⑧) — `결과`·`서브`·`n줄`은 무수정이라 키로 안 올린다.
  "progress.stream.error": "오류",

  // 워커 스트림 다이얼로그(§2-15 ⑩) — 머리 상태 낱말 · 소요 라벨 · 칩 줄 라벨 · 툴바 · 2단 상세.
  // `기록 n건` · `서브` · `오류` · `생각` · `결과` · `프롬프트` · `배정`은 이미 있는 문자열이라
  // 키를 새로 안 만든다(§2-15 ⑩ 각주).
  "progress.stream.stateLive": "진행중",
  "progress.stream.stateDone": "완료",
  "progress.stream.elapsed": "소요",
  "progress.stream.tools": "도구",
  "progress.stream.searchPlaceholder": "이 기록 검색",
  "progress.stream.filter": "필터",
  "progress.stream.filterTalk": "대화",
  "progress.stream.filterTool": "도구",
  "progress.stream.filterThinking": "생각",
  "progress.stream.filterPrompt": "프롬프트",
  "progress.stream.noMatch": "맞는 기록이 없습니다",
  "progress.stream.pickRow": "줄을 고르면 여기에 입력과 결과가 뜹니다",
  "progress.stream.input": "입력",
  "progress.stream.result": "결과",
  "progress.stream.copy": "복사",
  "progress.stream.closeDetail": "상세 닫기",
  "progress.stream.markdown": "마크다운",

  // 티켓 상세 진행 기록 절에서 워커 갈래 다이얼로그를 여는 문(§2-15 ⑮).
  "progress.stream.expand": "자세히 보기",

  // §0-16 §발행 §묶음 표 행 8(프로젝트 관리 루트 셸, 티켓 95749c14) — 오류·부재 경계 넷
  // (`(app)/not-found.tsx` · `(app)/error.tsx` · `global-error.tsx` · `not-found.tsx`).
  // en은 P338-12가 채운다. `errorBoundary.*`는 두 error 경계가 같은 문구라 하나로 공유한다.
  "errorBoundary.title": "화면을 표시하지 못했습니다",
  "errorBoundary.noReason": "원인 정보 없음",
  "errorBoundary.retry": "다시 시도",
  "notFound.project.title": "찾을 수 없습니다",
  "notFound.project.bodyPrefix": "이 URL에 해당하는 화면이 없습니다.",
  "notFound.project.urlExample": "/p/<프로젝트>",
  "notFound.project.bodySuffix": "였다면 그 URL 조각이 레지스트리에 없습니다.",
  "notFound.project.link": "프로젝트 목록",
  "notFound.root.title": "404",
  "notFound.root.body": "이 주소에는 페이지가 없습니다.",
  "notFound.root.homeLink": "홈으로",

  // `lib/scaffold.ts` — 새 프로젝트 스캐폴딩 실패 사유(§0-16 §발행 §묶음 표 행 8, 티켓 95749c14).
  // 파일에 쓰는 템플릿 본문(TEMPLATE_FILES)은 사전에 안 든다(§0-16 §장치 §사전의 범위).
  "scaffold.engineNotFoundPrefix": "엔진 레포를 찾지 못했습니다 —",
  "scaffold.engineNotFoundMid": "에 tick.sh가 없습니다.",
  "scaffold.engineNotFoundEnvHint": "DIRA_ENGINE이 가리키는 자리입니다.",
  "scaffold.engineNotFoundDefaultHint": "GUI는 <엔진 레포>/apps/teams/에서 돌아야 합니다.",
  "scaffold.notAbsolutePrefix": "절대경로여야 합니다:",
  "scaffold.emptyPlaceholder": "(비어 있음)",
  "scaffold.alreadyQueueSuffix": "는 이미 dira 프로젝트입니다. 만들지 않고 등록하세요.",
  "scaffold.notQueueSuffix":
    "가 이미 있지만 dira 프로젝트가 아닙니다. 안에 tickets/ 와 workers/ 를 만들거나, 지우고 다시 만드세요.",

  // `lib/projects.ts` — 레지스트리·설정 해석·페르소나/스쿼드 검증 실패 사유(같은 티켓, 파일
  // 스코프 접두 — `paths.ts`의 선례와 같다). en은 P338-12가 채운다.
  "projects.keymapNotObject": "최상위가 객체가 아닙니다",
  "projects.registryShapePrefix": "레지스트리 형식이 이상하다(projects 배열 없음):",
  "projects.nameRequired": "이름을 입력하세요.",
  "projects.notAbsolutePrefix": "절대경로여야 합니다:",
  "projects.emptyPlaceholder": "(비어 있음)",
  "projects.mountNotFoundSuffix": "가 없습니다. 절대경로가 맞는지, 마운트가 연결돼 있는지 확인하세요.",
  "projects.notDirectorySuffix": "는 디렉터리가 아닙니다.",
  "projects.notAQueueBody":
    "이 디렉터리에 tickets/도 workers/도 없습니다 — dira 프로젝트가 아닙니다. 안에 tickets/ 와 workers/ 를 만들거나, 지우고 [새로 만들기]로 다시 만드세요.",
  "projects.alreadyRegisteredPrefix": "이미",
  "projects.alreadyRegisteredSuffix": "으로 등록돼 있습니다.",
  "projects.badIdFormatPrefix": "URL 조각 형식이 틀렸습니다 — 영문 소문자·숫자·하이픈 1~40자:",
  "projects.needIdMessage": "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈).",
  "projects.dupIdPrefix": "URL 조각",
  "projects.dupIdSuffix": "가 이미 쓰이고 있습니다. 다른 이름을 쓰거나 조각을 직접 정하세요.",
  "projects.unknownProjectIdPrefix": "없는 프로젝트:",
  "projects.notAPersonaNamePrefix": "페르소나 이름이 아닙니다:",
  "projects.notInPalettePrefix": "팔레트에 없는 색입니다:",
  "projects.personaNameRulePrefix": "페르소나 이름은 영문·숫자·_·- 만 됩니다:",
  "projects.personaNameRuleMiddle": "— 엔진이 이 이름으로 <personas>/<이름>/",
  "projects.personaNameRuleSuffix": "경로를 만듭니다.",
  "projects.squadNameRulePrefix": "스쿼드 이름은 영문·숫자·_·- 만 됩니다:",
  "projects.squadNameRuleSuffix": "— 엔진이 이 이름으로 <squads>/<이름>/members 경로를 만듭니다.",

  // `app/actions.ts` §7 해석 결과 표(같은 티켓) — `ConfigRow.badges`는 내부 코드로 바뀌고
  // 이 라벨·힌트가 화면 값이다. `projects-ui.tsx`의 `ConfigTable`이 같은 세 키를 쓴다.
  "resolve.badge.assumedDefault": "기본값 가정",
  "resolve.badge.resolveFailed": "해석 실패",
  "resolve.badge.outsideRoot": "루트 밖",
  "resolve.badgeHint.assumedDefault": "워커 파일에서 이 값을 찾지 못해 기본값을 씁니다",
  "resolve.badgeHint.resolveFailed": "$HOME 외 변수가 남아 값을 읽지 못했습니다 — 화면은 기본값을 씁니다",
  "resolve.badgeHint.outsideRoot": "프로젝트 루트 밖을 가리킵니다",
  "resolve.conflictBadge": "워커마다 다름",
  "resolve.conflictAlert.title": "워커 간 설정이 다릅니다",
  "resolve.conflictAlert.body": "티켓이 어느 워커에 물리느냐에 따라 결과가 달라집니다.",
  "resolve.key.inProgress": "진행중 접미사",
  "resolve.key.done": "완료 접미사",
  "resolve.key.personas": "페르소나",
  "resolve.key.protocols": "프로토콜",
  "resolve.key.cwd": "작업 디렉터리",
  "resolve.key.workers": "워커",
  "resolve.workers.countSuffix": "개",
  // `projects-ui.tsx`의 목록 표 자원 줄(워커 0개)도 같은 문구를 쓴다(코드 주석 — 같은 사실을
  // 두 자리에서 다른 말로 하지 않는다).
  "resolve.workers.empty": "없음 — 이 프로젝트는 돌지 않습니다",
  "resolve.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",

  "project.branchRequired": "통합 브랜치를 입력하세요.",
  "project.createdRegisterFailedPrefix": "— .dira는",
  "project.createdRegisterFailedSuffix": "에 만들어졌습니다. 등록 카드에서 그 경로를 등록하세요.",
  "project.moveNoRoom": "더 옮길 자리가 없습니다.",

  // `components/projects-ui.tsx` — 생성 폼·다이얼로그(§7 생성). en은 P338-12가 채운다.
  "project.create.blurb": ".dira를 만들고 워커 하나를 crontab에 올립니다 — 30초 뒤부터 티켓을 물어갑니다.",
  "project.create.submitPending": "만드는 중…",
  "project.create.submit": "프로젝트 만들기",
  "project.create.nameLabel": "이름",
  "project.create.namePlaceholder": "dira 자체",
  "project.create.idLabel": "URL 조각",
  "project.create.idHint": "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈).",
  "project.create.dirLabel": "프로젝트 폴더",
  "project.create.dirHelp": "여기에 .dira를 만듭니다. ~는 확장됩니다",
  "project.create.branchLabel": "통합 브랜치",
  "project.create.specLabel": "스펙 문서",
  "project.create.specHelp": "선택. 비우면 그 줄(AGENTS.md 지도 표 한 행)을 자리표시자 그대로 둡니다",
  "project.create.ontologyLabel": "온톨로지 자리",
  "project.create.ontologyPlaceholder": "<프로젝트 폴더>/.dira/ontology",
  "project.create.ontologyHelp": "선택. 비우면 기본값(<프로젝트 폴더>/.dira/ontology)을 씁니다",
  "project.create.existsTitle": "만들지 않았습니다",
  "project.create.existsRegisterButton": "등록으로",
  "project.create.failedTitle": "만들지 못했습니다",
  "project.create.permissionHint": "권한 창이 뜨면 [허용]을 누르세요 — crontab 등록이 그 대답을 기다립니다.",
  "project.create.cancel": "취소",
  "project.create.dialogTitle": "새 프로젝트",

  // `components/projects-ui.tsx` — 목록 표(§비주얼 §7).
  "project.list.nameHeader": "이름",
  "project.list.pathHeader": "경로",
  "project.list.openHeaderTitle": "파일이 열려 있는 티켓 — 대기·deps 대기·할당됨을 포함합니다",
  "project.list.openHeader": "열림",
  "project.list.inProgressHeader": "진행중",
  "project.list.doneHeader": "완료",
  "project.list.connectedHeader": "연결",
  "project.list.actionsHeader": "액션",
  "project.list.personasLabel": "페르소나",
  "project.list.personasEmpty": "없음",
  "project.list.workersLabel": "워커",

  // `components/projects-ui.tsx` — 행 액션(순서 변경·설정).
  "project.row.up": "위로",
  "project.row.down": "아래로",
  "project.row.settings": "설정",

  // `components/projects-ui.tsx` — 설정 다이얼로그(이름 변경·등록 해제·해석 결과).
  "project.settings.confirmTitle": "프로젝트 등록 해제",
  "project.settings.confirmDescSuffix":
    "을 목록에서 제거합니다. 이 프로젝트의 티켓은 삭제되지 않습니다 — 레지스트리에서만 빠집니다.",
  "project.settings.confirmNote": "같은 경로로 다시 등록하면 그대로 돌아옵니다.",
  "project.settings.cancel": "취소",
  "project.settings.unregisterFailed": "등록 해제에 실패했습니다.",
  "project.settings.unregisterButton": "등록 해제",
  "project.settings.readFailedTitle": "설정을 읽지 못했습니다",
  "project.settings.resolveResultsHeading": "해석 결과",
  "project.settings.loading": "읽는 중…",
  "project.settings.reload": "다시 읽기",
  "project.settings.renameLabel": "이름",
  "project.settings.save": "저장",
  "project.settings.renameFailed": "이름을 바꾸지 못했습니다.",
  "project.settings.slugNotePrefix": "URL 조각",
  "project.settings.slugNoteSuffix": "는 바뀌지 않습니다 — 열어 둔 링크와 북마크가 깨집니다.",
  "project.settings.branchChangedPrefix": "다시 쓴 파일: ",

  // `components/projects-ui.tsx` — 온톨로지 마이그레이션 섹션.
  "project.ontologyMigration.title": "온톨로지 마이그레이션",
  "project.ontologyMigration.description":
    "없으면 새로 세우고, 있으면 최신 규약으로 다시 올립니다. 다시 돌려도 안전합니다.",
  "project.ontologyMigration.linkPrefix": "마이그레이션",
  "project.ontologyMigration.startPending": "발행하는 중…",
  "project.ontologyMigration.start": "마이그레이션 시작",
  "project.ontologyMigration.failedTitle": "마이그레이션 티켓을 만들지 못했습니다",
  "board.epic.label": "에픽",
  "board.epic.all": "전체",
  "board.epic.none": "(에픽 없음)",
  "board.epic.noTitle": "제목 없음",
  "board.epic.memory": "메모리",
  // 카드를 에픽에 끌어다 놓는 동안(§비주얼 §52 ⑤) — 사이드바 그룹 머리 · 겨눈 줄의 2행
  "board.epic.dropPrompt": "놓을 에픽을 고릅니다",
  "board.epic.dropOnEpic": "놓으면 이 에픽으로",
  "board.epic.dropRemove": "놓으면 에픽에서 뺍니다",
  "board.epic.collapse": "에픽 목록 접기",
  "board.epic.expand": "에픽 목록 펴기",
  // 사이드바 그룹 머리의 만들기 입구(§에픽 결정 17 · §비주얼 §52 ⑩) — 입구의 `sr-only` 낱말과
  // 다이얼로그 제목이 같은 키다(트리거와 그릇이 같은 낱말인 것이 참조 구현의 관용구).
  "board.epic.create": "에픽 만들기",
  "board.epic.createDesc": "제목은 README.md 첫 줄, 키는 티켓 epic: 값입니다.",
  "board.epic.createTitleLabel": "제목",
  "board.epic.createKeyLabel": "키",
  "board.epic.createFailed": "에픽을 만들지 못했습니다",
  // 레인 드래그(§1-5 · §비주얼 §70) — 후보 층의 문장 둘(②)과 선점 확인 다이얼로그(④)다.
  // 산 세션 끊기 다이얼로그는 새 문자열이 없다 — `ticketDetail.forceStop*`를 그대로 쓴다.
  "board.lane.dropToStart": "놓으면 지금 시작합니다",
  "board.lane.dropToUnassign": "놓으면 할당을 풉니다",
  "board.lane.preemptTitle": "도는 세션 하나를 끊고 시작합니다",
  "board.lane.preemptDesc":
    "그 티켓은 답변 대기로 잠기지 않고 열림으로 돌아가 다시 디스패치됩니다. 워크트리에 커밋하지 않은 변경은 지워지지 않고 그대로 남습니다. 비워진 워커가 방금 놓은 티켓을 집습니다.",
  "board.lane.preemptConfirm": "끊고 시작",
  // 피해자 없음 — 도는 `.wip`이 0건이거나 전부 유효 우선순위 5라 `--dryrun`이 빈 출력을 낸다.
  // 두 사유를 한 문장이 다 담는다(화면이 둘을 못 가른다).
  "board.lane.noVictim": "지금 시작할 수 없습니다 — 도는 티켓이 없거나 전부 유효 우선순위 5라 끊을 것이 없습니다.",
  "epics.empty": "에픽 없음",
  "epics.viewInBoard": "보드에서 보기",
  "epics.readme.missingBadge": "README 없음",
  "epics.readme.hint": "첫 줄 뒤에 적으면 여기 뜹니다.",
  "epics.readme.edit": "편집",
  "epics.readme.editDesc": "제목은 README.md 첫 줄, 내용은 그 뒤 본문입니다. 저장하면 파일을 덮어씁니다.",
  "epics.readme.bodyLabel": "내용",
  "epics.readme.saveFailed": "저장하지 못했습니다",
  // 에픽 화면(§에픽 §결정 6, `c6b995d6`) — 잘못된 P번호로 들어온 자리(페르소나 화면과 같은
  // Alert, `persona.route.notFound`와 같은 문장이지만 화면마다 자기 키를 든다).
  "epics.route.notFound": "이 경로는 열 수 없습니다",
  "epics.readme.missing": "README.md가 없습니다.",
  "epics.memory.heading": "메모리",
  "epics.memory.emptyHint": "메모리가 없습니다 — 세션이 회고에서 남기면 여기에 쌓입니다.",
  "epics.memory.deleteFailedTitle": "메모리를 지우지 못했습니다",
  "epics.memory.deleteFailedFallback": "메모리를 지우지 못했습니다.",
  "epics.memory.deleting": "삭제 중…",
  "epics.memory.delete": "삭제",
  "epics.memory.deleteDialogTitlePrefix": "메모리 삭제 —",
  "epics.memory.deleteDialogBodySuffix":
    "파일을 지웁니다. 되돌릴 수 없습니다 — 이 화면에 편집도 추가도 없습니다. 다음 디스패치부터 세션이 이 개념을 못 찾습니다.",
  // `components/epic-sidebar.tsx`는 보드·에픽 화면이 같이 쓰는 부품이라(§머리말) `board.epic.`
  // 접두가 아니라 자기 파일 접두를 든다(`ontology.unit.count`·`boardPage.unit.count`와 같은 값,
  // `board.`는 FILLED라 새 키를 못 넣는다).
  "epicSidebar.unit.count": "건",
  "status.hint.awaiting": "PM이 되물었다 — 요구사항 상세에서 답을 쓰면 다시 큐에 뜬다. 자동 만료는 없다",
  "status.hint.assigned": "session_id가 적힌 열린 티켓 — 큐에서 영구 제외된다. 할당 해제로 되돌린다",
  "status.hint.pollingOverdue": "폴링 상한을 지났다 — 다음 tick에 답변 대기로 잠긴다",

  // deps 배지(§2 deps 배지) — `DepBadge`가 쓴다.
  "dep.hint.met": "충족 — 완료된 티켓",
  "dep.hint.unmet": "미충족 — 아직 완료되지 않았다",
  "dep.hint.missing": "큐에 없는 해시 — 영구 대기",
  "dep.hint.answer": "답변 기록 — 이 요구사항의 답변",

  // 티켓 상세 "폴링 대기" 절(§폴링 대기 결정 9 표 §티켓 상세) — 스크립트 파일명·본문·주기·
  // 상한과 남은 시간·마지막 폴링 시각·마지막 출력 꼬리.
  "polling.section.title": "폴링 대기",
  "polling.field.reason": "사유",
  "polling.field.script": "스크립트",
  "polling.field.scriptBody": "스크립트 본문",
  "polling.field.interval": "주기",
  "polling.interval.everyTick": "매 tick",
  "polling.field.until": "상한",
  "polling.field.polledAt": "마지막 폴링",
  "polling.polledAt.never": "아직 안 돌림",
  "polling.field.logTail": "마지막 출력",
  "polling.scriptBody.missing": "스크립트 파일 없음",
  "polling.logTail.missing": "출력 기록 없음",
  // 상한 전에도 끊는 손잡이 둘(§폴링 대기 §개정 3) — 확인 다이얼로그는 없다.
  "polling.action.dispatchNow": "지금 디스패치",
  "polling.action.dispatching": "디스패치하는 중…",
  "polling.action.extendUntil": "상한 늘리기",
  "polling.action.extending": "늘리는 중…",
  "polling.until.saved": "적용됐습니다.",
  "polling.control.notPolling": "이 티켓은 지금 폴링 대기 상태가 아닙니다.",
  "polling.control.badUntil": "상한 값을 읽을 수 없습니다.",
  "polling.control.pastUntil": "상한은 지금보다 뒤여야 합니다.",

  // 표 컬럼(§에픽 결정 7 §표뷰) — 띠 머리 라벨은 `board.epic.noTitle`을 그대로 재사용한다
  // (사이드바와 같은 글자여야 한다, §1 - 한 사실을 두 모양으로 그리지 않는다).
  "board.column.epic": "에픽",

  // 워커 결함 넷째(§0-21 결정 2, 티켓 b60520ea) — §4 표 넷째 줄과 같은 낱말. 앞의 셋은 아직
  // 이 사전으로 안 옮겨졌다(`workers/page.tsx`의 `DEFECT` 그대로) — 이 티켓의 몫은 이 하나뿐이다.
  "worker.defect.noExec.title": "실행 비트 없음",
  "worker.defect.noExec.why":
    "cron이 Permission denied로 워커를 못 띄웁니다 — tick.sh가 아예 안 돌아 runner.log가 한 줄도 늘지 않고, 열린 티켓이 그대로 뜹니다.",
  // `cwdDefects`의 `detail`(티켓 c7c284f6) — 위 title·why와 같은 kind인데 접두가 단수인 것은
  // 티켓 b60520ea가 먼저 붙인 그대로다.
  "worker.defect.noExec.detailSuffix": "에 실행 비트가 없습니다.",

  // 프로토콜 화면(§0-16 §발행 §묶음 표 7, `93c106b3`) — protocols-ui.tsx · protocols/page.tsx ·
  // protocols/actions.ts · lib/protocols.ts. en은 `7a86fd5c`가 채운다.
  "protocols.inline.tooltip": "tick.sh가 이 파일 전문을 모든 세션 프롬프트 머리에 붙입니다",
  // 배지 글자 — 뒤에 `{budgetLabel(...)}`가 공백 하나를 사이에 두고 붙는다. 표현식과 섞여
  // 실측 스크립트가 못 센다(`## Done when` 여섯째 줄, 아래 같은 사정 셋도 마찬가지).
  "protocols.inline.badge": "전원 프롬프트에 인라인 ·",

  "protocols.new.title": "새 파일",
  "protocols.new.descPrefix": "프로토콜 디렉터리 기준 상대경로입니다.",
  "protocols.new.descSuffix":
    "를 넣으면 하위 디렉터리도 같이 만듭니다. 빈 파일로 만들고 바로 편집기가 열립니다.",
  "protocols.new.pathLabel": "경로",
  "protocols.new.pathHintPrefix": "디렉터리 밖으로 나가는 경로(",
  "protocols.new.pathHintSuffix": "· 절대경로)는 서버가 거부합니다.",
  "protocols.new.failTitle": "파일을 만들지 못했습니다",

  // 편집기 · 코어 보기(page.tsx `CoreView`)가 공유하는 문구.
  "protocols.readWhenNeeded": "세션이 필요할 때 읽음",
  // 글자 수 뒤에 공백 없이 붙는 단위(`123자`).
  "protocols.charSuffix": "자",
  "protocols.editor.inlinedHintPrefix": "이 파일은",
  "protocols.editor.inlinedHintSuffix":
    "가 전문을 모든 세션 프롬프트 머리에 붙입니다 — 길이가 곧 매 세션의 비용입니다. 세부 규약은 같은 디렉터리의 다른 문서로 빼고 여기서 가리키면, 세션이 필요할 때만 읽습니다.",
  "protocols.editor.saveFailTitle": "저장하지 못했습니다",
  "protocols.editor.revert": "되돌리기",
  "protocols.editor.saved": "저장됐습니다.",

  "protocols.rename.trigger": "이름변경",
  "protocols.rename.dialogTitlePrefix": "이름변경 —",
  "protocols.rename.desc":
    "상대경로를 바꾸면 하위 디렉터리로 옮기는 것도 됩니다. 같은 이름의 파일이 이미 있으면 거부합니다 — 조용히 덮어쓰지 않습니다.",
  "protocols.rename.pathLabel": "새 경로",
  "protocols.rename.agentsWarnTitle": "이름을 바꾸면 프롬프트에서 빠집니다",
  "protocols.rename.agentsWarnPrefix": "tick.sh는",
  "protocols.rename.agentsWarnSuffix":
    "라는 이름만 읽습니다. 다른 이름이 되면 세션은 협업 프로토콜 없이 시작합니다(에러 없이 조용히).",
  "protocols.rename.failTitle": "이름을 바꾸지 못했습니다",
  "protocols.rename.working": "바꾸는 중…",

  "protocols.delete.trigger": "삭제",
  "protocols.delete.dialogTitle": "파일 삭제",
  "protocols.delete.descSuffix": "를 지웁니다. 되돌릴 수 없습니다.",
  "protocols.delete.agentsWarnTitle": "모든 세션이 협업 프로토콜 없이 시작합니다",
  "protocols.delete.agentsWarnBody":
    "tick.sh는 이 파일이 없으면 그냥 넘어갑니다 — 에러도 경고도 없습니다. 이 프로젝트는 계속 돌고, 세션만 규약을 모릅니다.",
  "protocols.delete.failTitle": "지우지 못했습니다",
  "protocols.delete.working": "삭제 중…",

  "protocols.sidebar.collapse": "파일 목록 접기",
  "protocols.sidebar.expand": "파일 목록 펴기",
  "protocols.sidebar.ariaLabel": "프로토콜 파일",
  "protocols.usingDefault": "기본값 가정",
  "protocols.default.hintPrefix": "워커 파일에서",
  "protocols.default.hintMiddle": "를 읽지 못해 엔진 기본값 (",
  "protocols.default.rootPath": "<루트>/protocols",
  "protocols.default.hintSuffix":
    ")으로 봅니다. 워커에서 다른 경로로 재정의하면 이 화면도 그 경로를 따라갑니다.",
  "protocols.empty.title": "파일 없음",
  "protocols.empty.bodyPrefix": "프로토콜이 없어도 이 프로젝트는 돕니다 —",
  // "tick.sh는" 사이 조사 한 글자 — `{" "}` 다음에 `AGENTS.md` span이 이어져 실측 스크립트가 못 센다.
  "protocols.empty.bodyMiddle": "는",
  "protocols.empty.bodySuffix":
    "가 없으면 그냥 넘어갑니다. 세션이 협업 규약(티켓 분류별 처리·핸드오프·보고)을 모른 채 시작할 뿐입니다.",
  "protocols.rejected.title": "이 경로는 열 수 없습니다",
  "protocols.core.notFoundPrefix": "코어 프로토콜에 없는 파일입니다:",
  "protocols.picker.expanded": "파일을 고르세요.",
  "protocols.picker.collapsed": "파일 목록을 펴서 고르세요.",
  "protocols.core.vendoredPrefix": "이 파일은 이 큐에 vendored된 코어 사본입니다 —",
  "protocols.core.notVendoredPrefix": "이 파일은 큐가 아니라 엔진 레포에 있습니다 —",
  // `{" "}` 앞뒤로 갈려 실측 스크립트가 못 센다.
  "protocols.core.inlinedMiddle": "가 전문을",
  "protocols.core.inlinedAllProjects": "모든 프로젝트",
  "protocols.core.inlinedSuffix": "의 모든 세션 프롬프트 맨 앞에 붙입니다.",
  "protocols.core.notInlinedSuffix":
    "가 가리키면 세션이 필요할 때 직접 읽습니다(프롬프트에 인라인되지는 않습니다).",
  // 표현식(`{" "}`) 바로 뒤라 실측 스크립트가 못 센다.
  "protocols.core.readOnlyNote": "여기서는 읽기만 합니다(이 화면이 고치는 것은 프로젝트 층입니다).",
  // textarea aria-label — `wrap(file.name, ..., "")`로 붙인다(`${file.name} 원문`과 같은 바이트).
  "protocols.core.rawLabelSuffix": "원문",

  "protocols.action.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",

  // lib/protocols.ts — fs 검증 사유. 서버 액션 결과(`message`)·읽기 실패(`reason`)로 화면에
  // 뜬다. 파일 이름·경로·바이트 수 등 값 자체는 그대로 두고 문장만 옮긴다(엔진이 준 값이 아니라
  // 이 파일이 직접 짓는 문장이지만, 값 부분은 번역·가공하지 않는다).
  "protocols.lib.coreReadFailPrefix": "코어 프로토콜을 읽지 못했습니다 —",
  "protocols.lib.coreEmptyPrefix": "코어 프로토콜이 없습니다 —",
  "protocols.lib.isDirectory": "디렉터리입니다.",
  "protocols.lib.tooLargeSuffix": "바이트 — 1MB가 넘어 편집기로 열지 않습니다.",
  "protocols.lib.notText": "텍스트 파일이 아닙니다(NUL 바이트) — 편집할 수 없습니다.",
  "protocols.lib.missingPrefix": "파일이 없습니다(지워졌을 수 있습니다):",
  "protocols.lib.notRegularPrefix": "일반 파일이 아닙니다:",
  "protocols.lib.staleConflict": "다른 곳에서 그 사이 이 파일을 고쳤습니다 — 새로고침으로 다시 읽은 뒤 저장하세요.",
  "protocols.lib.nameRequired": "파일 이름을 입력하세요.",
  "protocols.lib.dirNoDeletePrefix": "디렉터리는 이 화면에서 지우지 않습니다:",
  "protocols.lib.newNameRequired": "새 이름을 입력하세요.",
  "protocols.lib.dirNoMovePrefix": "디렉터리는 이 화면에서 옮기지 않습니다:",

  // 화면 이행 셋째 묶음 - 페르소나 갈래(§0-16 §발행 §묶음 표 행 7, `204be4da`). `lib/skills.ts` ·
  // `personas/actions.ts`는 서버 액션-모듈 함수라 로케일이 안 닿는 벽이다(§0-16 §장치, developer
  // memory `i18n 서버 문자열은 로케일이 없다`) - `t("ko", ...)`로 고정해 부른다.
  "persona.error.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",
  "persona.error.squadNameTakenPrefix": "이미 있는 스쿼드 이름입니다:",
  "persona.error.personaNameTakenPrefix": "이미 있는 페르소나 이름입니다:",
  "persona.skill.fileCountMismatchPrefix": "파일과 경로의 수가 안 맞습니다:",
  "persona.skill.installFailedTitle": "스킬을 설치하지 못했습니다",
  "persona.limit.invalidPrefix": "상한은 0 이상의 정수여야 합니다:",
  "persona.skill.installMissingSkillMd": "고른 폴더 바로 아래에 SKILL.md가 없습니다",
  "persona.skill.installBadPathPrefix": "올바르지 않은 경로입니다:",
  "persona.skill.installNoName": "고른 파일의 frontmatter에 name이 없습니다 — 설치될 디렉터리 이름이 name입니다",
  "persona.skill.installBadName":
    "name을 디렉터리 이름으로 쓸 수 없습니다 — 영숫자로 시작하고 영숫자 · . _ - 만, 64자까지입니다",
  "persona.skill.installNameConflict":
    "이 이름의 스킬이 이 머신에 이미 있습니다 — 덮지 않습니다. 지우거나 name을 바꾼 뒤 다시 고릅니다",
  "persona.skill.unzipFailed": "이 파일을 풀지 못했습니다 — .skill은 zip이어야 합니다",
  "persona.skill.subtreeNotFound": "주소가 가리키는 폴더가 그 레포에 없습니다 — 브랜치나 경로가 맞는지 확인합니다",
  "persona.skill.skillMdNotFound":
    ".skill 안에서 SKILL.md를 찾지 못했습니다 — 최상위에 있거나 폴더 하나 바로 아래에 있어야 합니다",
  // `9a835efe`(§5-1 실측 - skills.sh는 zip을 안 낸다)가 호스트 목록을 넷에서 셋으로 줄이며
  // 문구도 고쳤다 - 그 스펙 문장과 한 글자도 안 다르게 맞춘다(ASCII `-` 그대로).
  "persona.skill.badAddress": "이 주소로는 받을 수 없습니다 - GitHub 레포나 그 안의 폴더 주소를 붙입니다",
  "persona.skill.tooLarge": "받는 크기가 상한을 넘어 끊었습니다 — 레포 전체를 받으므로 큰 레포는 내려받아 파일로 깝니다",
  "persona.skill.fetchFailed": "주소에서 받지 못했습니다 — 주소가 맞는지, 공개된 레포인지 확인합니다",
  "persona.skill.badNamePrefix": "스킬 이름에 쓸 수 없는 문자:",
  "persona.engine.customPrefix": "커스텀 인자가 있는 engine 파일입니다:",
  "persona.engine.writeVerifyFailed": "쓴 블록을 다시 읽으면 값이 달라집니다. 쓰지 않았습니다.",
  "persona.memory.notInListPrefix": "메모리 파일이 목록에 없습니다:",

  // 페르소나 화면 - `[[...persona]]/page.tsx`(서버 컴포넌트, `readLanguage()`로 진짜 로케일을 받는다).
  "persona.dir.label": "디렉터리",
  "persona.dir.defaultTitle": "워커 파일에서 TICKET_PERSONAS를 찾지 못해 기본값을 씁니다",
  "persona.dir.defaultBadge": "기본값 가정",
  "persona.missing.title": "프로필 파일이 없는 페르소나가 있습니다",
  "persona.missing.enginePrefix": "엔진은 이 이름을 만나면",
  // 두 경고 Alert가 같이 쓰는 조각(`만 남기고` — WARN 배지 뒤).
  "persona.warn.engineSuffix": "만 남기고",
  // <strong>과 괄호 안 평문 두 자리가 같이 쓰는 낱말(§0-16 §키 규약 - 중복 값 0).
  "persona.wording.withoutPersona": "페르소나 없이",
  "persona.missing.dispatchDetail":
    "디스패치합니다 — 디스패치가 실패하는 게 아니라, 세션이 역할·권한을 모르는 채로 시작합니다. 그 이름을 왼쪽에서 고르고 오른쪽의 빈 본문을 채워 저장하면 파일이 만들어집니다.",
  "persona.missing.noSkillsMemory":
    "프로필이 없으면 스킬·메모리도 실리지 않습니다 — 두 블록 다 페르소나 프롬프트 안에 있습니다.",
  // 프로필 없는 페르소나 목록 줄 `<이름> — 티켓 <n>건이 참조 · <파일>` — 변수 셋이라
  // `wrap`(변수 하나 전용)이 아니라 조각 둘로 쪼갠다.
  "persona.missing.refsMiddle": "— 티켓",
  "persona.missing.refsSuffix": "건이 참조 ·",
  "persona.squadWarn.title": "없는 스쿼드를 참조하는 티켓이 있습니다",
  "persona.squadWarn.enginePrefix": "엔진은 이 값을 만나면",
  "persona.squadWarn.strongLabel": "종전 경로",
  "persona.squadWarn.parenPrefix": "(persona:가 있으면 그 값, 없으면",
  "persona.squadWarn.parenSuffix": ")로 디스패치합니다.",
  "persona.empty.title": "페르소나 없음",

  // 페르소나 화면 - `personas-ui.tsx`(클라이언트 컴포넌트, `useT()`로 읽는다). 재사용 낱말은
  // `persona.word.*` - 여러 자리가 같은 낱말을 그대로 쓴다(§0-16 §키 규약 - 중복 값 0).
  "persona.word.squad": "스쿼드",
  "persona.squad.collapseToggle": "모아보기",
  "persona.word.skills": "스킬",
  "persona.word.memory": "메모리",
  "persona.word.limit": "상한",
  "persona.word.members": "멤버",
  // 좌측 목록의 축이 스쿼드로 갈리며 는 둘(§비주얼 §61 (17), 티켓 c1e94f73) — 버튼 라벨
  // 급의 짧은 문구라 `en`도 여기서 같이 채운다(화면 프로즈가 아니라 developer 몫).
  "persona.squad.unassignedGroup": "스쿼드 없음",
  "persona.squad.toggleMembersSuffix": "멤버 목록",
  // `common.delete`를 새로 만들지 않는다 — `common.*`는 이미 en이 다 찬 묶음이라
  // (`i18n.test.ts` FILLED) 여기서 키를 늘리면 그 테스트가 깨진다. en은 다음 티켓(P307-4) 몫이다.
  "persona.action.delete": "삭제",
  "persona.refs.openPrefix": "열린",
  "persona.refs.ticketPrefix": "티켓",
  "persona.refs.none": "참조하는 티켓 없음",
  "persona.color.saveFailedMessage": "색을 저장하지 못했습니다.",
  "persona.color.saveFailedTitle": "색을 저장하지 못했습니다",
  "persona.color.labelPrefix": "색:",
  "persona.color.none": "색 없음",
  "persona.create.personaTitle": "페르소나 생성",
  "persona.create.squadTitle": "스쿼드 생성",
  "persona.create.personaDescPrefix": "티켓의",
  "persona.create.personaDescSuffix":
    "값이 곧 디렉터리 이름입니다. 프로필 본문은 세션 프롬프트 머리에 인라인됩니다.",
  "persona.create.squadDescPrefix":
    "프로필이 있는 페르소나를 묶습니다. 스쿼드를 문 티켓은 members 파일의 첫 줄 한 사람에게만 가는데, 그 사람은 일을 직접 하지 않고 누가 할지 정해서 멤버 앞으로 새 티켓을 냅니다. 이 이름이 티켓의",
  "persona.create.squadDescSuffix": "값이 됩니다.",
  "persona.create.kindLabel": "종류",
  "persona.create.nameLabel": "이름",
  "persona.create.nameHintPrefix": "영문·숫자·_·-.",
  "persona.create.nameHintPersonaFile": "파일은 <personas>/<이름>/PROFILE.md 가 됩니다",
  "persona.create.nameHintSquadFile": "파일은 <squads>/<이름>/members 가 됩니다",
  "persona.create.nameHintSuffix": ". 페르소나와 스쿼드는 이름을 공유합니다 — 겹치면 거부됩니다",
  "persona.create.personaFailTitle": "페르소나를 만들지 못했습니다",
  "persona.create.squadFailTitle": "스쿼드를 만들지 못했습니다",
  "persona.badge.noProfile": "프로필 없음",
  "persona.badge.unsaved": "저장 안 됨",
  "persona.badge.squadNoProfile": "멤버 프로필 없음",
  "persona.tab.activity": "활동",
  "persona.tab.profile": "프로필",
  "persona.head.runningSessionsPrefix": "도는 세션",
  "persona.head.closedSuffix": "닫음",
  "persona.head.squadPrefix": "스쿼드",
  // 활동 탭 절 넷(§비주얼 §66 - 티켓 `46d7ef1e`). 값은 `personaActivity`(4ea1147a)가 이미
  // 센다 - 여기는 절 제목 · 빈 절 한 줄 · 30일 라벨뿐이다.
  "persona.activity.nowHeading": "지금",
  "persona.activity.waitingHeading": "기다리는 것",
  "persona.activity.recentHeading": "최근",
  "persona.activity.recentBoardLink": "보드에서 보기",
  "persona.activity.thirtyDayHeading": "30일",
  "persona.activity.nowEmpty": "지금 도는 티켓 없음",
  "persona.activity.recentEmpty": "닫은 티켓 없음",
  // `## 블록`이 붙어 열린 채 멈춘 `.wip` 줄에만 뜨는 낱말(§비주얼 §66 ⑧) - 색·아이콘 없이 이 한
  // 낱말뿐이다.
  "persona.activity.blocked": "막힘",
  "persona.activity.closedLabel": "닫은 티켓",
  "persona.activity.closedUnit": "장",
  "persona.activity.durationLabel": "소요 중앙값",
  // "되돌아옴"은 티켓 상세의 "다시 할당"(ticket.retries.*)과 같은 값(reassignCount)이지만
  // 낱말을 새로 고른다(§5-6 - 성적이 아니라 직렬화 비용이라는 이 화면의 어휘).
  "persona.activity.reassignLabel": "되돌아옴",
  "persona.activity.reassignUnit": "회",
  "persona.activity.issuedLabel": "낸 티켓",
  "persona.route.notFound": "이 경로는 열 수 없습니다",
  // 여러 절(프로필-스쿼드-스킬-메모리-정책값)이 같은 저장-삭제 결과 문구를 그대로 재사용한다
  // (§0-16 §키 규약 - 중복 값 0).
  "persona.action.saveFailedTitle": "저장하지 못했습니다",
  "persona.action.savedNotice": "저장됐습니다.",
  "persona.action.deleteFailedTitle": "삭제하지 못했습니다",
  "persona.action.deleteFailedMessage": "삭제하지 못했습니다.",
  "persona.action.remove": "제거",
  "persona.squad.rulesHeading": "규칙",
  "persona.squad.rulesBadgeTitle": "리더로 뜬 세션의 프롬프트에만 이 파일 전문이 붙습니다",
  "persona.squad.rulesBadgePrefix": "리더 프롬프트에 인라인 ·",
  "persona.squad.rulesHint":
    "리더 세션의 프롬프트에만 실립니다. 비우면 리더는 멤버 이름과 각자의 역할만 봅니다.",
  "persona.squad.membersHeading": "멤버",
  "persona.squad.membersBadgeTitle":
    "이 스쿼드의 멤버는 티켓이 스쿼드를 안 들어도 이 블록을 프롬프트로 받습니다",
  "persona.squad.membersBadgePrefix": "멤버 전원 프롬프트에 인라인 ·",
  "persona.squad.overBudgetSuffix": "초과",
  "persona.squad.noEligible": "프로필이 있는 페르소나가 없습니다 — 먼저 페르소나를 만듭니다.",
  "persona.squad.roleAriaSuffix": "의 역할",
  "persona.squad.openPersonaAriaSuffix": "엽니다",
  // §비주얼 §61 (21) §리더 묶음 — 낱말 `리더`가 묶음 머리로 뜨고 카드의 배지는 죽는다. 자리만
  // 갈리고 문구는 무수정이라 새 키가 아니다.
  "persona.squad.leaderBadge": "리더",
  "persona.squad.roleHint": "역할을 비우면 그 페르소나의 프로필 첫 줄이 역할이 됩니다.",
  // §5-5 §개정("리더 자리에서 내려온 이름은 스쿼드에서 빠진다") — 카드의 리더 지정/해제가
  // 리더 절의 `추가`로 옮겨가며 죽는 문구(DESIGN.md §비주얼 §61 (21) §두 언어). 버튼
  // 라벨·짧은 문구라 `en`도 여기서 같이 채운다(developer 몫).
  "persona.squad.emptyRoster": "아직 멤버가 없습니다 - 추가를 누릅니다",
  "persona.squad.addSearchPlaceholder": "이름 검색",
  "persona.squad.addSearchEmpty": "고를 이름이 없습니다",
  "persona.squad.addSearchZeroMatch": "일치하는 이름 0건",
  "persona.squad.notInSquadHeading": "이 스쿼드에 없음",
  "persona.squad.noLeader": "리더 없음",
  "persona.squad.leaderRemoveConfirmTitlePrefix": "리더 제거 —",
  // §5-5 §개정(2026-08-23) — confirm 문장 셋. 문장 1은 항상, 2(이 키)는 앞 리더의 역할 칸에
  // 글자가 있을 때만, 3은 항상 뜬다(§비주얼 §61 (22) §값). 한 단락에 공백으로 이어 붙인다.
  "persona.squad.leaderRemoveConfirmBody": "그 이름이 이 스쿼드에서 빠집니다.",
  "persona.squad.leaderRemoveConfirmBodyRole": "역할 칸에 적은 글자도 같이 없어집니다.",
  "persona.squad.leaderRemoveConfirmBodyUndo": "저장을 안 하면 되돌아옵니다.",
  "persona.squad.announceAdded": "멤버에 넣었습니다",
  "persona.squad.announceRemoved": "스쿼드에서 뺐습니다",
  "persona.squad.announceLeader": "리더입니다",
  "persona.squadDelete.titlePrefix": "스쿼드 삭제 —",
  "persona.squadDelete.bodyMiddle":
    "디렉터리를 지웁니다. 되돌릴 수 없습니다. 이 스쿼드를 참조하는 티켓의",
  "persona.squadDelete.bodyAfter": "값은 그대로 남습니다.",
  "persona.policy.heading": "디스패치 정책",
  "persona.policy.nextTicketHint": "다음 티켓 선정부터 적용됩니다.",
  "persona.limit.saveFailed": "상한을 저장하지 못했습니다.",
  "persona.limit.saveFailedTitle": "상한을 저장하지 못했습니다",
  "persona.limit.none": "없음",
  "persona.limit.popoverLabel": "동시 워커 상한",
  "persona.limit.popoverHint": "비우면 상한 없음 · 0이면 디스패치 정지",
  "persona.engine.label": "엔진",
  "persona.engine.unset": "지정 없음",
  "persona.engine.modelLabel": "모델",
  "persona.engine.noModel": "모델 지정 안 함",
  "persona.engine.customOption": "직접 입력…",
  "persona.engine.customModelAriaLabel": "모델 이름 직접 입력",
  "persona.engine.modelNamePlaceholder": "모델 이름",
  "persona.engine.modelBadHint": "공백·따옴표는 쓸 수 없습니다 — 모델 이름 한 토큰만",
  "persona.engine.modelPassthroughHint": "엔진에 그대로 넘어갑니다 — 공백·따옴표 없는 한 토큰",
  "persona.engine.missingJoiner": "과 ",
  "persona.engine.missingMiddle": "워커는",
  "persona.engine.missingSuffix": "이 없습니다 — 티켓 수행은 같습니다.",
  "persona.engine.saveFailed": "엔진을 저장하지 못했습니다.",
  "persona.engine.saveFailedTitle": "엔진을 저장하지 못했습니다",
  "persona.engine.unsetAction": "지정 해제",
  "persona.engine.overwriteTitlePrefix": "커스텀 엔진 값을 덮어씁니다 —",
  "persona.engine.overwriteBodyPrefix": "지금 engine 파일에 카탈로그 밖 인자가 있습니다:",
  "persona.engine.overwriteBodySuffix": "여기서 저장하면 이 인자는 사라지고 고른 값으로 바뀝니다.",
  "persona.engine.overwriteConfirm": "그래도 저장",
  "persona.skill.saveFailed": "스킬을 저장하지 못했습니다.",
  "persona.skill.saveFailedTitle": "스킬을 저장하지 못했습니다",
  "persona.skill.removingAction": "제거 중…",
  "persona.skill.emptyNone": "고른 스킬이 없습니다 — 디스패치 프롬프트에 스킬 절이 실리지 않습니다.",
  "persona.skill.emptyAllOff": "켜 둔 스킬이 없습니다 — 디스패치 프롬프트에 스킬 절이 실리지 않습니다.",
  "persona.skill.claudeOnlyHint":
    "스킬은 claude 엔진에서만 실립니다 — codex 워커가 물면 이 절은 프롬프트에 안 갑니다.",
  "persona.skill.turningOff": "끄는 중…",
  "persona.skill.turnOff": "끄기",
  "persona.skill.offHeading": "비활성",
  "persona.skill.turningOn": "켜는 중…",
  "persona.skill.turnOn": "켜기",
  "persona.memory.empty": "메모리가 없습니다 — 세션이 회고에서 남기면 여기에 쌓입니다.",
  "persona.memory.deleteFailedTitle": "메모리를 지우지 못했습니다",
  "persona.memory.deleteFailedMessage": "메모리를 지우지 못했습니다.",
  "persona.memory.deletingAction": "삭제 중…",
  "persona.memory.deleteTitlePrefix": "메모리 삭제 —",
  "persona.memory.deleteBodyAfterPath":
    "파일을 지웁니다. 되돌릴 수 없습니다 — 이 화면에 편집도 추가도 없습니다. 다음 디스패치부터 세션이 이 개념을 못 찾습니다.",
  "persona.skill.multiDropRejected":
    "한 번에 스킬 하나만 설치합니다 — 놓은 최상위 항목이 둘 이상입니다. 하나만 다시 놓습니다",
  "persona.skill.countSuffix": "개",
  "persona.skill.addHeading": "스킬 추가",
  "persona.skill.addDialogDesc": "이 머신에 설치된 스킬입니다. 고른 것이 이 페르소나의 디스패치 프롬프트에 실립니다.",
  "persona.skill.searchPlaceholder": "스킬 검색 — 이름 또는 설명",
  "persona.skill.searchEmptySuffix": "와 일치하는 스킬 0건",
  "persona.skill.notOnMachineHeading": "이 머신에 없음",
  "persona.skill.orphanNote": "설치된 스킬 목록에 없습니다 — 다른 머신에서 고른 것일 수 있습니다",
  "persona.skill.installedHeading": "설치된 스킬",
  "persona.skill.noneOnMachine": "이 머신에서 스킬을 찾지 못했습니다",
  "persona.skill.configDirHint": "CLAUDE_CONFIG_DIR이 없으면 <config>는 ~/.claude입니다",
  "persona.skill.installFromBelow": "아래에서 파일을 골라 지금 설치할 수 있습니다",
  "persona.skill.dropToInstall": "놓으면 설치합니다",
  "persona.skill.fetchingAddress": "주소에서 받는 중입니다 — 최대 30초",
  "persona.skill.dropHint": "목록에 없으면 폴더를 이 창에 끌어다 놓거나 파일을 골라 설치합니다",
  "persona.skill.installing": "설치 중…",
  "persona.skill.browse": "찾아보기",
  "persona.skill.addressAriaLabel": "스킬 주소",
  "persona.skill.installAction": "설치",
  "persona.delete.titlePrefix": "페르소나 삭제 —",
  "persona.delete.bodyAfterPath": "디렉터리를 안의 파일까지 지웁니다. 되돌릴 수 없습니다.",
  "persona.delete.refsWarnPrefix": "이 페르소나를 참조하는 티켓이",
  "persona.delete.refsWarnSuffix": "건 있습니다",
  "persona.delete.refsWipPrefix": "(진행중",
  "persona.delete.refsWipSuffix": "건)",
  "persona.delete.refsBody": "티켓은 지워지지 않습니다. 프로필이 없어지면 엔진은",
  "persona.delete.dispatchDetail": "디스패치합니다 — 세션이 역할·권한을 모르는 채로 시작합니다.",

  // 공용 컴포넌트·순수 유틸 묶음(§0-16 §발행 §묶음 표 행 11, `c9f2eec5`) — 화면이 둘 이상 무는
  // 파일이라 화면 접두 대신 파일 스코프 접두를 쓴다. en 나머지는 `90db2822`가 채운다 — 이 한
  // 줄만 `50fd4b34`가 먼저 채웠다(en 화면에서 `budgetLabel`이 한글 `초과`를 그대로 흘리는
  // 회귀가 있어서다 - 아래 `urls.`·`workers.` 두 자리와 같은 증상).
  "budgets.overSuffix": " 초과",

  "markdownEditor.toggle.toRaw": "원문으로",
  "markdownEditor.toggle.toWysiwyg": "위지윅으로",

  // §비주얼 §50 §프론트매터 행 편집기 — 머리 줄 손잡이(§접근명, 화면 글자와 같은 문장)
  "frontmatterRows.toggle.toRows": "행으로",
  "frontmatterRows.toggle.toPlain": "평문으로",
  "frontmatterRows.empty": "프론트매터 행이 0개입니다.",
  "frontmatterRows.addRow": "행 추가",
  "frontmatterRows.keyLabel": "키",
  "frontmatterRows.valueLabel": "값",
  "frontmatterRows.addAfterKeyPrefix": "",
  "frontmatterRows.addAfterKeySuffix": " 아래에 행 추가",
  "frontmatterRows.removeKeyPrefix": "",
  "frontmatterRows.removeKeySuffix": " 행 삭제",
  "frontmatterRows.addAfterItemPrefix": "",
  "frontmatterRows.addAfterItemSuffix": "번째 항목 아래에 행 추가",
  "frontmatterRows.removeItemPrefix": "",
  "frontmatterRows.removeItemSuffix": "번째 항목 행 삭제",

  // 티켓 `7e02b1ac` — 목록형 값의 콤마 항목 UI + 키 추천/값 검색 콤보박스(결정 5·6·7)
  "frontmatterRows.addListItem": "항목 추가",
  "frontmatterRows.removeListItemPrefix": "",
  "frontmatterRows.removeListItemSuffix": " 항목 삭제",
  "frontmatterRows.pickKeyLabel": "키 후보에서 고르기",
  "frontmatterRows.pickValueLabel": "값 후보에서 고르기",
  "frontmatterRows.searchPlaceholder": "검색",
  "frontmatterRows.searchEmpty": "일치하는 항목 0건",

  "ticketFrontmatter.saveFailedTitle": "저장하지 못했습니다",
  "ticketFrontmatter.saved": "저장됐습니다.",

  // 티켓 상세·발행 화면(묶음 표 행 4) — ticket-ui.tsx · tickets/[hash]/{page,actions}.ts*가 같이 쓴다.
  "ticketDetail.file": "파일",
  "ticketDetail.collapse": "접기",
  "ticketDetail.expand": "펼치기",
  "ticketDetail.none": "없음",
  "ticketDetail.squadWord": "스쿼드",
  "ticketDetail.personaWord": "페르소나",
  "ticketDetail.currentValue": "현재 값",
  "ticketDetail.originalValue": "원본 값",
  "ticketDetail.bodyLabel": "본문",
  "ticketDetail.thisTicket": "이 티켓",
  "ticketDetail.noTitle": "(제목 없음)",
  "ticketDetail.met": "완료",
  "ticketDetail.progressHeading": "진행 기록",
  "ticketDetail.relationsHeading": "관계",
  "ticketDetail.emptyBody": "본문 없음",
  "ticketDetail.noTranscript": "트랜스크립트 없음",

  "ticketDetail.unassign": "할당 해제",
  "ticketDetail.unassigning": "할당 해제 중…",
  "ticketDetail.forceStopTitle": "도는 세션을 끊습니다",
  "ticketDetail.forceStopDescSuffix":
    "를 물고 있는 세션이 아직 살아 있습니다. 강제로 중단하면 그 세션이 죽고, 티켓은 답변 대기로 잠깁니다 — 답변칸에 답을 쓰기 전에는 아무 워커도 다시 가져가지 않습니다. 워크트리에 커밋하지 않은 변경은 지워지지 않고 그대로 남습니다.",
  "ticketDetail.forceStop": "강제 중단",
  "ticketDetail.unassignCallSuffix": "를 호출합니다",
  "ticketDetail.noWorkerScript": "이 프로젝트에 워커가 없습니다 — 할당 해제를 호출할 스크립트가 없습니다.",
  "ticketDetail.unassignDoneTitle": "할당 해제 완료",
  "ticketDetail.unassignFailedTitle": "할당 해제 실패",
  "ticketDetail.wipLockTitle": "세션에 할당된 티켓입니다 — 편집·삭제 잠금",
  "ticketDetail.wipLockDescPrefix": "진행중 티켓은 읽기만 합니다. 세션이 죽었다면",
  "ticketDetail.wipLockDescSuffix": "로 큐에 되돌린 뒤 편집하세요.",
  "ticketDetail.ghostPrefix": "열린 티켓에",
  "ticketDetail.ghostAfterSessionId": "가 적혀 있습니다 —",
  "ticketDetail.ghostAfterSelect": "가 영구 제외하고",
  "ticketDetail.ghostAfterReap": "은",
  "ticketDetail.ghostSuffix": "만 보므로, 할당 해제만이 이 티켓을 큐로 되돌립니다.",

  "ticketDetail.answerThreadAriaLabel": "답변 스레드",
  "ticketDetail.question": "질문",
  "ticketDetail.answer": "답변",
  "ticketDetail.scrollToBottom": "맨 아래로",
  "ticketDetail.addendum": "덧붙일 말",
  "ticketDetail.answerPlaceholder": "질문에 답 쓰기",
  "ticketDetail.answerFailedTitle": "답변을 달지 못했습니다",
  "ticketDetail.createsFileSuffix": "를 만듭니다",
  "ticketDetail.answering": "답변 다는 중…",
  "ticketDetail.answerSubmit": "답변 달기",
  "ticketDetail.answerDialogTitlePrefix": "답변 —",
  "ticketDetail.answerDialogDesc": "답변을 달면 이 티켓이 다시 큐에 뜨고 담당 세션이 이어서 봅니다.",

  "ticketDetail.delete": "삭제",
  "ticketDetail.deleteConfirmTitle": "티켓 삭제",
  "ticketDetail.deleteConfirmDescSuffix": "의 파일을 지웁니다. 되돌릴 수 없습니다.",
  "ticketDetail.deleteFailedFallback": "삭제하지 못했습니다.",
  "ticketDetail.deleteFailedTitle": "삭제하지 못했습니다",
  "ticketDetail.deleteLockedWipTooltip": "진행중 티켓은 삭제할 수 없습니다 — 세션에 할당된 티켓입니다",
  "ticketDetail.deleteLockedDoneTooltip": "완료 티켓은 삭제할 수 없습니다 — 불변 기록입니다",
  "ticketDetail.deleteLockedWipMessage": "진행중 티켓은 삭제할 수 없습니다 — 세션에 할당된 티켓입니다.",
  "ticketDetail.deleteLockedDoneMessage":
    "완료 티켓은 삭제할 수 없습니다 — 이 해시를 deps로 둔 티켓이 영구 대기합니다.",

  "ticketDetail.discardTitle": "쓰던 내용이 있습니다",
  "ticketDetail.discardDesc": "닫으면 지금 쓴 내용이 사라집니다.",
  "ticketDetail.keepWriting": "계속 쓰기",
  "ticketDetail.discardAndClose": "버리고 닫기",

  "ticketDetail.depsRemoveSuffix": "제거",
  "ticketDetail.pickTicket": "티켓 선택",
  "ticketDetail.searchPlaceholder": "티켓 검색 — 해시 또는 제목",
  "ticketDetail.noMatch": "일치하는 티켓 0건",
  "ticketDetail.depsHint":
    "전부 완료돼야 큐에 뜹니다. 없으면 착수가 불가능한 것만 고릅니다 — 남발하면 큐가 직렬화됩니다.",

  "ticketDetail.requestAccept": "요구 접수",
  "ticketDetail.requestDescPrefix": "필요한 것을 자연어로 쓰면",
  "ticketDetail.requestDescSuffix": "티켓이 되고 해석합니다. 첫 줄이 제목이 됩니다.",
  "ticketDetail.requestBodyAriaLabel": "요구 내용",
  "ticketDetail.requestBodyPlaceholder": "무엇이 필요한지 그냥 쓰세요.\n첫 줄이 제목이 됩니다.",
  "ticketDetail.requestFailedTitle": "접수하지 못했습니다",
  "ticketDetail.requesting": "접수 중…",
  "ticketDetail.viewSubmittedRequest": "접수한 요구 보기",

  "ticketDetail.duplicate": "복제",
  "ticketDetail.publish": "티켓 발행",
  "ticketDetail.duplicateTicketTitle": "티켓 복제",
  "ticketDetail.duplicateDescSuffix":
    "의 title·kind·persona·본문을 그대로 채웠습니다. deps는 복제되지 않습니다 — 필요하면 직접 고르세요.",
  "ticketDetail.publishDesc": "선택지는 전부 이 프로젝트의 실제 값입니다 — 손으로 치는 건 title과 본문뿐입니다.",
  "ticketDetail.titlePlaceholder": "한 줄 제목 — 무엇을 하는지",
  "ticketDetail.publishFailedTitle": "발행하지 못했습니다",
  "ticketDetail.publishing": "발행 중…",
  "ticketDetail.publishSubmit": "발행",
  "ticketDetail.noPersonaDirSuffix": "에 페르소나 디렉터리가 없습니다.",

  "ticketDetail.notScannedTitle": "이 파일은 큐에 뜨지 않습니다 — frontmatter가 없습니다",
  "ticketDetail.notScannedFirstLine": "첫 줄이",
  "ticketDetail.notScannedClosing": "이고 닫는",
  "ticketDetail.notScannedSuffix": "이 있어야 엔진이 티켓으로 봅니다. 손으로 열어 고치세요.",
  "ticketDetail.hashMismatchTitlePrefix": "표시값",
  "ticketDetail.hashMismatchTitleSuffix": "로는 엔진이 이 티켓을 찾지 못합니다",
  "ticketDetail.hashMismatchBody1": "이 파일명과 다릅니다. 엔진은 파일명으로만 찾으므로",
  "ticketDetail.hashMismatchBody2": "에는",
  "ticketDetail.hashMismatchBody3": "을 적어야 합니다 — 표시값을 적으면 이 티켓이",
  "ticketDetail.hashMismatchBody4": "이 돼도 후행이 영구 대기입니다.",
  "ticketDetail.hashMismatchFixPrefix": "고치려면",
  "ticketDetail.hashMismatchFixMid": "을",
  "ticketDetail.hashMismatchFixSuffix": "으로 맞추거나 파일 이름을 바꾸세요.",
  "ticketDetail.unlockedAwaitingTitle": "잠금 없는 답변 대기 — 이 티켓은 답변 전에 디스패치된다",
  "ticketDetail.unlockedAwaitingBody1": "가 있는데",
  "ticketDetail.unlockedAwaitingBody2": "에 그 해시가 없습니다. 엔진은",
  "ticketDetail.unlockedAwaitingBody3": "만 보므로 답변 없이도 이 티켓이 큐에 뜹니다 — 요구사항의",
  "ticketDetail.unlockedAwaitingBody4": "에",
  "ticketDetail.unlockedAwaitingBody5": "를 넣으세요.",
  "ticketDetail.doneLockedTitle": "완료 티켓은 읽기 전용입니다",
  "ticketDetail.doneLockedBody1": "완료는 이 큐의 불변 기록입니다 — 후행의",
  "ticketDetail.doneLockedBody2": "해소와",
  "ticketDetail.doneLockedBody3":
    "역참조가 이 파일의 존재에 걸려 있어 편집·삭제·할당 해제를 막습니다. 담당 세션 기록(",
  "ticketDetail.doneLockedBody4":
    ")은 누가 한 일인지를 남기려고 그대로 둡니다. 이어서 할 일이 있으면 새 티켓을 만드세요.",
  "ticketDetail.requirementLabel": "요구사항",
  "ticketDetail.missingReqHint": "큐에 없는 요구사항 stem — 출처를 따라갈 수 없다",
  "ticketDetail.derivedTicketsLabel": "이 요구사항에서 나온 티켓",
  "ticketDetail.noDerivedTickets": "아직 쪼갠 티켓 없음",
  "ticketDetail.archiveTargetLabel": "아카이브 대상",
  "ticketDetail.missingArchiveHint": "큐에 없는 아카이브 대상 stem — 대상을 따라갈 수 없다",
  "ticketDetail.archiveLabel": "아카이브",

  "ticketDetail.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",
  "ticketDetail.ticketNotFoundPrefix": "큐에 없는 티켓입니다:",
  "ticketDetail.unassignLockedDone":
    "완료 티켓은 할당 해제할 수 없습니다 — 담당 세션 기록(session_id·owner)은 누가 한 일인지를 남기려고 그대로 둡니다.",
  "ticketDetail.noNewlineSuffix": "에 줄바꿈을 넣을 수 없습니다.",
  "ticketDetail.titleFieldName": "제목",
  "ticketDetail.titleRequired": "제목을 입력하세요.",
  "ticketDetail.notAssigned": "할당된 티켓이 아닙니다(session_id가 비어 있습니다).",
  "ticketDetail.notAwaitingAnymore":
    "지금 이 티켓은 답변 대기가 아닙니다 — 이미 답변이 달렸거나 세션이 잡았습니다. 화면을 새로고침해 상태를 확인하세요.",
  "ticketDetail.badAwaitingStemPrefix": "awaiting 값을 파일 이름으로 쓸 수 없습니다:",
  "ticketDetail.badAwaitingStemSuffix":
    ". 경로 구분자·제어문자가 없는 이름이어야 합니다 — 요구사항의 frontmatter를 고치세요.",
  "ticketDetail.stemClashMiddle": "이름의 티켓이 이미 큐에 있습니다:",
  "ticketDetail.stemClashSuffix":
    ". 그 파일이 있는 한 답변 파일을 만들어도 엔진이 그쪽을 먼저 집어 요구사항이 영구 대기합니다. 그 파일을 확인해 정리하거나, PM에게 다른 awaiting 해시를 받으세요.",
  "ticketDetail.answerRequired": "답변 내용을 입력하세요.",
  "ticketDetail.answerFileExistsPrefix": "답변 파일이 이미 있습니다:",
  "ticketDetail.answerFileExistsSuffix":
    ". 다른 창에서 방금 답했을 수 있습니다 — 새로고침해 스레드를 확인하세요.",

  // `lib/followup.ts` — 이어받기(§2-2), 세션 스트림(session-stream.tsx)도 타입만 물어 화면 접두는
  // 안 쓴다. `state.*`는 mono 원문(§비주얼 §21 `상태: 진행중`)이지 `status.label.*` 배지 값이 아니다.
  "followupLib.state.open": "열림",
  "followupLib.state.wip": "진행중",
  "followupLib.state.done": "완료",
  "followupLib.emptyBody": "보낼 내용을 입력하세요.",
  "followupLib.ticketNotFoundPrefix": "큐에 없는 티켓입니다:",
  "followupLib.notDoneReason": "완료 티켓이 아닙니다 — 이어받을 일이 아직 끝나지 않았습니다.",
  "followupLib.stateDetailPrefix": "상태:",
  "followupLib.malformedFrontmatterPrefix": "frontmatter가 없거나 닫는 `---`이 없습니다:",
  "followupLib.hashExhausted": "해시를 10번 뽑았는데 전부 이미 쓰이고 있습니다 — 큐 디렉터리를 확인하세요.",

  // `lib/attachments.ts` — 발행·요구 접수·참견·이어받기·홈 질의 다섯 자리가 같이 쓴다(§8).
  "attachmentsLib.noFileName": "파일 이름이 없습니다 — 이름이 있는 파일로 다시 고르세요.",
  "attachmentsLib.nameExhausted": "이름을 10번 뽑았는데 전부 이미 쓰이고 있습니다.",
  "attachmentsLib.saveFailedPrefix": "저장하지 못했습니다:",
  "attachmentsLib.outsidePathPrefix": "첨부 경로가 attachments/ 밖입니다 — 붙인 파일을 지우고 다시 고르세요:",

  // `components/attachment-field.tsx` — 첨부 손잡이·칩(§27). home-ui·session-stream·personas-ui도 쓴다.
  "attachmentField.uploadFailedPrefix": "올리지 못했습니다:",
  "attachmentField.dropLimitPrefix": "한 번에",
  "attachmentField.dropLimitMiddle": "개까지 붙일 수 있습니다 —",
  "attachmentField.dropLimitSuffix": "개는 붙이지 않았습니다.",
  "attachmentField.attachWord": "첨부",
  "attachmentField.countSuffix": "개",
  "attachmentField.uploading": "올리는 중…",
  "attachmentField.removeSuffix": "첨부 제거",

  "updateToast.progress.prefix": "업데이트를 받는 중",
  "updateToast.confirm.message": "지금 도는 일이 있습니다. 그래도 재시작할까요?",
  "updateToast.confirm.cancel": "취소",
  "updateToast.confirm.restart": "재시작",
  "updateToast.downloaded.title": "업데이트를 받았습니다",
  "updateToast.downloaded.notesToggle": "무엇이 바뀌었나",
  "updateToast.downloaded.later": "다음 시작에 적용",
  "updateToast.downloaded.restartNow": "지금 재시작",

  // sr-only 접두 — 칩 안에 넣으면 이름마다 반복돼 "워커 w3 워커 w4"가 된다(worker-mark.tsx).
  "workerMark.srPrefix": "워커 ",

  "pathPicker.browse": "찾아보기",

  "markdown.empty": "(내용 없음)",
  "markdownWikilinks.noTarget": "대상 없음",

  "copyCommand.ariaLabel": "명령어 복사",

  // 뒤에 바이트 수(소수 1자리)가 공백 없이 붙는다(`20MB를 넘습니다 (23.4MB) — ...`).
  "attachmentLimit.oversizePrefix": "20MB를 넘습니다 (",
  "attachmentLimit.oversizeSuffix": "MB) — 필요한 부분만 잘라서 올리세요.",

  "skillUpload.tooManyFilesPrefix": "설치할 파일이 상한 ",
  "skillUpload.tooManyFilesSuffix": "개를 넘습니다",
  "skillUpload.fileCountSuffix": "개",
  "skillUpload.tooManyBytesPrefix": "설치할 파일의 합계가 상한 ",
  "skillUpload.tooManyBytesSuffix": "MB를 넘습니다",

  // 신뢰 경계 검증 사유(lib/paths.ts) — 값(이름·경로) 자체는 안 건드리고 둘러싼 문장만 옮긴다.
  "paths.invalidAssignmentPrefix": "persona 값이 올바르지 않습니다(persona:<이름> 또는 squad:<이름>):",
  // 뒤에 `${target} -> ${real}`이 공백 하나씩 사이에 두고 붙는다.
  "paths.outsideBasePrefix": "경로가 기준 디렉터리 밖이다:",
  // 뒤에 `${base})`가 공백 하나를 사이에 두고 붙는다(`(기준 <경로>)`).
  "paths.outsideBaseSuffix": "(기준",

  // 뒤에 의견 첫 줄(최대 40자)이 공백 없이 붙는다.
  "feedback.titlePrefix": "의견 — ",
  "feedback.versionLabel": "버전",
  "feedback.sessionLabel": "세션",

  // `feedback-dialog.tsx` 화면 자체(§0-16 §발행 §묶음 표 행 8, 티켓 95749c14). en은 P338-12가
  // 채운다. `versionLabel`·`sessionLabel`은 위 GitHub 이슈 본문 조립과 같은 낱말이라 재사용한다.
  "feedbackDialog.title": "의견 보내기",
  "feedbackDialog.description":
    "GitHub 이슈로 열립니다. 내용이 채워진 채 열리고 마지막 등록은 직접 누르시면 됩니다.",
  "feedbackDialog.textareaLabel": "의견",
  "feedbackDialog.placeholder": "무엇이 불편했는지, 무엇이 필요한지 그냥 쓰세요.\n첫 줄이 이슈 제목이 됩니다.",
  "feedbackDialog.metaNote": "이슈에 아래 두 줄이 함께 실립니다.",
  "feedbackDialog.truncated":
    "내용이 길어 뒷부분은 이슈에 실리지 않습니다. URL로 보내는 방식의 한계입니다 — 나눠 보내시거나, 열린 이슈에 나머지를 붙여 넣으신 뒤 등록하세요.",
  "feedbackDialog.submit": "GitHub 이슈로 보내기",
  "projectActions.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",
  "projectActions.fileMissing": "파일이 오지 않았습니다 — 다시 고르세요.",

  "appLayout.description": "파일시스템 티켓 큐 관제",

  // 페르소나·프로토콜 두 화면이 공유하는 공용 lib 셋(§4-3 표 · §비주얼 §23 ⑤, `50fd4b34`) —
  // 화면 파일이 아니라 `lib/urls.ts`·`lib/workers.ts`에 있어 §0-16 §발행 이행이 안 닿았던 자리다.
  // `persona.squad.block*`(위 삭제한 세 키)는 반대로 옮긴다 - tick.sh가 실제로 쓰는 블록은
  // 엔진에 로케일이 없어 늘 한국어라, `squadBlockBytes`(`lib/budgets.ts`)가 리터럴로 직접 센다.
  "urls.feature.interject": "참견",
  "urls.feature.stream": "세션 스트림",
  "workers.engineHint.prefix": "미지정 — 티켓을 집는 워커의 엔진을 씁니다",
  "workers.engineHint.allPrefix": "지금 전부 ",
  "workers.engineHint.nowPrefix": "지금 ",

  // lib/workers.ts — 화면 접두가 아니라 파일 스코프 접두다(§묶음 표 행 9, 티켓 daf72662).
  // 이 파일을 무는 화면(워커 목록·설정 다이얼로그)이 서버 함수의 reason·에러 메시지를 그대로
  // 옮겨 보여준다. en은 이 티켓에서 채우지 않는다(선례 93c106b3).
  "workers.context.blockMissingSuffix": "=( … ) 블록이 없습니다",
  "workers.context.multiAssignMid": "할당이 ",
  "workers.context.multiAssignSuffix": "개입니다 — 어느 쪽이 실효인지 GUI가 정하지 않습니다",
  "workers.context.appendAssign": "`+=` 추가 할당입니다",
  "workers.context.noClosingParen": "닫는 `)`가 없습니다",
  "workers.context.commentInBlock": "블록 안에 주석이 있습니다",
  "workers.context.unreadableEntryPrefix": "항목으로 읽을 수 없는 부분이 있습니다:",
  "workers.context.commandSubInEntryPrefix": "항목에 명령 치환 $( ) 가 있습니다:",
  "workers.context.dollarInSingleQuotePrefix": "작은따옴표 안에 $ 가 있습니다:",
  "workers.context.emptyPath": "경로가 비어 있는 항목이 있습니다.",
  "workers.context.pipeInPathPrefix": "경로에 | 는 쓸 수 없습니다(엔진이 첫 | 를 설명 구분자로 씁니다):",
  "workers.context.pathLabel": "경로",
  "workers.context.descLabel": "설명",
  "workers.context.forbiddenCharsSuffix": '에 " ` \\ 개행은 쓸 수 없습니다:',
  "workers.context.commandSubFieldSuffix": "에 명령 치환 $( ) 는 쓸 수 없습니다:",
  "workers.context.sameWorker": "같은 워커입니다.",
  "workers.context.copyReadFailMid": "의 TICKET_CONTEXT 블록을 읽을 수 없습니다:",
  "workers.context.rewriteMismatchPrefix": "쓴 블록을 다시 읽었을 때 항목이 달라집니다(",
  "workers.context.rewriteMismatchContentDiff": "내용 불일치",
  "workers.context.rewriteMismatchSuffix": "). 쓰지 않았습니다.",
  "workers.context.cantSafelyEditMid": "의 TICKET_CONTEXT 블록을 GUI가 안전하게 고칠 수 없습니다:",
  "workers.context.editByHandSuffix": ". 파일을 손으로 편집하세요.",
  "workers.context.commonReadFailMid": "를 읽을 수 없습니다:",
  "workers.context.commonEditMid1": "의 ",
  "workers.context.commonEditMid2": " 블록을 GUI가 안전하게 고칠 수 없습니다:",
  "workers.context.sourceLineCantPlaceMid": "에 source 줄을 넣을 자리를 GUI가 짚을 수 없습니다:",
  "workers.context.lineChangedAfterInsert": "줄을 넣은 뒤 파일이 예상과 달라집니다. 쓰지 않았습니다.",

  "workers.engine.unknownEnginePrefix": "모르는 엔진입니다:",
  "workers.engine.invalidModelCharsPrefix": "모델 이름에 쓸 수 없는 문자가 있습니다(영문·숫자·. _ : / - 만):",
  "workers.engine.noWorkerFileLine": "`. <레포>/tick.sh` 줄이 없습니다 — 이 파일은 워커가 아닙니다.",

  "workers.crontab.readTimedOut": "crontab -l이 10초 안에 응답하지 않아 중단했습니다. 셸에서 직접 실행해 보세요.",
  "workers.crontab.writeTimedOut":
    "crontab -가 3분 안에 응답하지 않아 중단했습니다. macOS의 권한 창이 답을 기다리는 중일 수 있습니다 — 화면에 '…에서 사용자의 컴퓨터를 관리하려고 합니다' 창이 떠 있으면 [허용]을 누르고 다시 시도하세요. 시스템 설정 > 개인정보 보호 및 보안 > 앱 관리에서 미리 켜 둘 수도 있습니다.",
  "workers.crontab.readFailPrefix": "crontab -l 실패:",
  "workers.crontab.permissionDenied":
    "'앱 관리' 권한이 없어 crontab에 쓰지 못했습니다 — 승인 창에서 [허용 안 함]을 눌렀거나 이전에 거부한 상태입니다. 시스템 설정 > 개인정보 보호 및 보안 > 앱 관리에서 이 앱(dira, 또는 GUI를 띄운 터미널)을 켜고 다시 시도하세요.",
  "workers.crontab.otherFailPrefix": "crontab - 실패:",
  "workers.crontab.registerMismatch":
    "crontab에 썼는데 다시 읽으니 그 줄이 없습니다(쓰기가 조용히 막힌 환경일 수 있습니다).",
  "workers.crontab.unregisterMismatch": "crontab에서 뺐는데 다시 읽으니 그 줄이 남아 있습니다.",

  "workers.dispatchGate.branchUnreadable":
    "이 프로젝트의 통합 브랜치를 protocols/AGENTS.md에서 읽을 수 없습니다 — 파일을 손으로 편집하세요.",
  "workers.integrationBranch.invalidPrefix": "통합 브랜치 이름은 영문·숫자·. _ / - 만 됩니다:",
  "workers.dispatchGate.noSourceLineMid":
    "에 `. <레포>/tick.sh` 줄이 없습니다 — 통합 게이트를 넣을 자리를 GUI가 짚을 수 없습니다. 파일을 손으로 편집하세요.",

  "workers.selfHeal.noSourceLineMid":
    "에 `. <레포>/tick.sh` 줄이 없습니다 — 자가 정리를 넣을 자리를 GUI가 짚을 수 없습니다. 파일을 손으로 편집하세요.",
  "workers.selfHeal.enginePathMid": "의 엔진 경로를 셸 없이 펼 수 없습니다:",

  "workers.worktree.notGitRepoSuffix": "는 git 레포가 아닙니다. 워크트리를 쓰지 않는 배치라면 정상입니다.",
  "workers.worktree.addFailedPrefix": "git worktree add 실패:",
  "workers.worktree.symlinkExistsSuffix": "가 이미 있습니다. 지우지 않았습니다 — 그 안에 사람의 작업이 있을 수 있습니다.",
  "workers.worktree.symlinkFailedPrefix": "심링크를 만들지 못했습니다:",
  "workers.worktree.wrongResolveMid1": "가 큐 루트(",
  "workers.worktree.wrongResolveMid2": ")가 아니라",
  "workers.worktree.wrongResolveSuffix": "로 풀립니다.",
  "workers.worktree.unresolved": "(못 풀림)",

  "workers.create.invalidNamePrefix": "워커 이름은 영문·숫자·_·- 만 됩니다:",
  "workers.create.emptyName": "(비어 있음)",

  "workers.ontology.mismatchMid": "에 쓴 뒤 값을 다시 읽으면 달라집니다. 어느 파일도 쓰지 않았습니다.",

  "workers.manage.noSuchWorkerPrefix": "없는 워커입니다:",
  "workers.manage.busyMid1": "이(가) 지금 티켓을 물고 있습니다(pid ",
  "workers.manage.busySuffix": "). 끝난 뒤 삭제하세요.",
  "workers.manage.cronRemoveFailPrefix": "crontab에서",
  "workers.manage.cronRemoveFailMid": "줄을 빼지 못했습니다:",
  "workers.manage.cronRemoveFailSuffix": "파일은 지우지 않았습니다.",

  // lib/auth.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 daf72662). settings 다이얼로그의
  // claude 인증 섹션(붙여넣기·브라우저 인증 둘 다)이 이 파일의 에러를 그대로 보여준다.
  "auth.token.empty": "토큰이 비어 있습니다.",
  "auth.token.hasWhitespace": "토큰 안에 공백·줄바꿈이 있습니다. 한 줄만 붙여 넣어 주세요.",
  "auth.verify.notAuthenticated": "CLI 화면에서 집은 값이 인증되지 않습니다. 다시 시도해 주세요.",
  "auth.setup.pathNotFoundPrefix": "PATH에서 claude를 찾지 못했습니다. (PATH=",
  "auth.setup.pathNotFoundSuffix": ")",
  "auth.setup.timeoutSuffix": "초 안에 토큰을 받지 못했습니다.",
  "auth.setup.endedWithCodeMid": "토큰을 받지 못한 채 끝났습니다 (종료 코드 ",
  "auth.setup.endedWithCodeSuffix": ").",
  "auth.setup.saveFailedPrefix": "토큰을 잡았지만 저장하지 못했습니다:",
  "auth.setup.execFailedPrefix": "실행하지 못했습니다:",
  "auth.setup.endedNoToken": "토큰을 받지 못한 채 끝났습니다.",

  // lib/queue.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 daf72662). 티켓 상세 편집 폼·에픽
  // 드래그 등 여러 화면이 이 파일의 판정과 에러 메시지를 그대로 쓴다.
  "queue.locked.wip": "진행중 티켓은 편집할 수 없습니다 — 세션이 그 파일로 일하고 있습니다.",
  "queue.locked.done": "완료 티켓은 편집할 수 없습니다 — 완료는 이 큐의 불변 기록입니다.",
  "queue.frontmatter.uneditableKeyPrefix": "프론트매터 칸에서 고칠 수 없는 키입니다:",
  "queue.frontmatter.missingPrefix": "frontmatter 없음:",

  // lib/engine.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 daf72662). `unassign.*`(화면 스코프,
  // 아직 병합 전인 다른 갈래)와 이름이 겹쳐도 이 접두는 새로 잡는다 — 그 갈래를 앞서 발명하지
  // 않는다.
  "engine.invalidWorkerNamePrefix": "워커 이름 형식이 아닙니다:",
  "engine.invalidHashPrefix": "해시 형식이 아닙니다:",
  "engine.noWorkerToUnassign": "이 프로젝트에 워커가 없습니다 — 할당 해제를 호출할 스크립트가 없습니다.",
  "engine.noWorkerToPreempt": "이 프로젝트에 워커가 없습니다 — 선점을 호출할 스크립트가 없습니다.",
  // 워커 설정 다이얼로그 트리거(§4-15 결정 2 - §비주얼 §35 개정 ①, 티켓 ec2791db). 다이얼로그
  // 제목이 같은 낱말을 재사용해 새 문구는 이 하나로 끝난다.
  "workers.settingsDialog.trigger": "워커 설정",
  // 다이얼로그 셋째(마지막) 섹션 — 스테일 수거(§4-17 결정 1, 티켓 642dd26f). 행의 `reap`
  // 버튼이 이 섹션 머리 하나로 옮겨온다 — 새로 짓지 않고 §4가 이미 쓰는 이름을 그대로 쓴다.
  "workers.reap.sectionTitle": "스테일 수거",
  // 공통 컨텍스트 행이 다는 `공통` 배지(§데스크톱 앱 N3). 걷힌 공유 워커 배지와 낱말은
  // 같되 가리키는 개념이 다르다 — §4-16 §롤백으로 그 배지가 빠지면서 이 이름으로 옮겨온다.
  "workers.context.badge": "공통",

  // §0-16 §발행 §묶음 표 행 5 갈래(워커 화면, 티켓 610dc0c0) — `components/workers-ui.tsx` ·
  // `workers/page.tsx` · `workers/actions.ts`. `en`은 P338-6(`e3d3b255`)이 채웠다.
  // `workers.settingsDialog.trigger` · `workers.reap.sectionTitle` · `worker.defect.noExec.*`는
  // 이 화면이 이미 쓰던 키라 그대로 둔다(중복 안 만든다).
  "workers.crontabApprovalHint": "권한 창이 뜨면 [허용]을 누르세요 — crontab 등록이 그 대답을 기다립니다.",
  "workers.notRunningYetHint": "아직 돌지 않습니다 — 이 명령을 셸에서 실행하세요",
  "workers.cronRegisterFailedTitle": "crontab에 등록하지 못했습니다",

  // `no-exec` 복구 버튼(`ExecBitFix`, §0-21 결정 3).
  "workers.execFix.failedDefaultMessage": "실행 비트를 켜지 못했습니다.",
  "workers.execFix.successSentence": "실행 비트를 켰습니다",
  "workers.execFix.pending": "켜는 중…",
  "workers.execFix.button": "실행 비트 켜기",
  "workers.execFix.failedTitle": "실행 비트를 켜지 못했습니다",

  // 생성 다이얼로그(`CreateWorkerButton`, §4 생성).
  "workers.create.worktreeStep0": "워크트리를 만들지 못했습니다",
  "workers.create.worktreeStep1": ".dira 심링크를 만들지 못했습니다",
  "workers.create.worktreeStep2": ".dira 심링크가 이 프로젝트를 가리키지 않습니다",
  "workers.create.trigger": "워커 생성",
  "workers.create.dialogTitle": "워커 생성",
  "workers.create.dialogDescription":
    "워커 하나가 크론잡 하나고, 한 번 실행에 티켓 1건을 끝냅니다. 동시성 = 워커 개수입니다.",
  "workers.create.templateCopiedMiddle": "을 복사해",
  "workers.create.templateCopiedSuffix": "를 만들고 755로 두었습니다. 내용을 확인하고 필요하면 손으로 고치세요.",
  "workers.create.cronRegisteredMessage": "crontab에 등록했습니다 — 30초 뒤부터 티켓을 물어갑니다.",
  "workers.create.worktreeSkippedPrefix": "워크트리는 만들지 않았습니다 —",
  "workers.create.worktreeSkippedSuffix": "워커 파일과 crontab 등록은 그대로입니다.",
  "workers.create.worktreeDoneLabel": "작업 디렉터리",
  "workers.create.worktreeDoneMiddle": "를 만들고, 그 안의",
  "workers.create.worktreeDoneSuffix": "가 이 프로젝트를 가리키는 것까지 확인했습니다.",
  "workers.create.worktreeFailedHint":
    "작업 디렉터리가 없으면 이 워커는 티켓을 물었다 되돌립니다 — 남은 명령을 셸에서 실행하세요",
  "workers.create.nameLabel": "이름",
  "workers.create.nameHint": "영문·숫자·_·-. 파일은 workers/<이름>.sh 가 됩니다",
  "workers.create.sessionCapNoLimit": "머신 전체 상한 없음",
  "workers.create.sessionCapHint":
    "세션을 한꺼번에 여러 벌 띄우면 이 컴퓨터의 성능에 영향을 주기 때문에, 동시에 뜨는 세션 수에 상한을 둡니다.",
  "workers.create.failedTitle": "워커를 만들지 못했습니다",

  // 행 액션 셋(스트림 · 중단/재등록 · 삭제, `WorkerRowActions`, §4).
  "workers.row.streamButton": "스트림",
  "workers.row.stopButton": "중단",
  "workers.row.registerButton": "재등록",
  "workers.row.deleteButton": "삭제",
  "workers.row.streamDialogTitlePrefix": "세션 스트림 —",
  "workers.row.stopDialogTitlePrefix": "워커 중단 —",
  "workers.row.stopDialogDescription":
    "crontab에서 이 워커 줄을 뺍니다. 파일은 지우지 않습니다 — 다시 등록하면 그대로 돌아옵니다.",
  "workers.row.stopFailedTitle": "crontab에서 빼지 못했습니다",
  "workers.row.runInShellHint": "이 명령을 셸에서 실행하세요",
  "workers.row.stopRunningAlertTitle": "지금 티켓을 물고 있습니다",
  "workers.row.stopRunningAlertBody":
    "진행중인 세션은 죽이지 않습니다. crontab에서 빼도 지금 물고 있는 티켓이 끝난 뒤에 멈춥니다.",
  "workers.row.stoppingPending": "중단하는 중…",
  "workers.row.registerDialogTitlePrefix": "워커 재등록 —",
  "workers.row.registerDialogDescription":
    "crontab에 이 워커 줄을 다시 넣습니다. 파일은 이미 있으니 바뀌는 것은 그 한 줄뿐입니다.",
  "workers.row.registeringPending": "등록하는 중…",
  "workers.row.deleteDialogTitlePrefix": "워커 삭제 —",
  "workers.row.deleteBlockedTitle": "지금은 삭제할 수 없습니다",
  "workers.row.deleteBlockedPidPrefix": "이 워커가 티켓을 물고 있습니다(pid",
  "workers.row.deleteBlockedPidSuffix":
    "). 지금 지우면 락과 돌고 있는 세션이 붕 뜹니다. 먼저 중단하고, 물고 있는 티켓이 끝난 뒤 지우세요.",
  "workers.row.deleteBodyText": "파일을 지웁니다. 이 프로젝트의 티켓은 삭제되지 않습니다.",
  "workers.row.deleteCronPrefix": "crontab 줄도 같이 뺍니다 —",
  "workers.row.deleteCronBold": "crontab 먼저, 파일 나중",
  "workers.row.deleteCronSuffix": "입니다. 남겨 두면 cron이 1분마다 없는 파일을 실행하고 cron.log에 에러가 쌓입니다.",
  "workers.row.deleteFailedTitlePrefix": "워커",
  "workers.row.deleteFailedTitleSuffix": "삭제 실패",
  "workers.row.deleteCronFailedHint": "파일은 그대로입니다 — 이 명령으로 crontab 줄을 뺀 뒤 다시 시도하세요",
  "workers.row.deleteFailedDefaultMessage": "삭제하지 못했습니다.",
  "workers.row.deletingPending": "삭제 중…",

  // 컨텍스트 편집기 공유 부분(`ExistsMark` · `ContextRejection` · `ContextEditor`).
  "workers.context.existsYes": "있음",
  "workers.context.existsNo": "없음 — 엔진이 건너뛰고 WARN만 남깁니다",
  "workers.context.existsAmbiguous": "경로를 한 값으로 확정하지 못했습니다",
  "workers.context.existsUnsaved": "저장하면 확인합니다",
  "workers.context.rejectionTitleMiddle": "의",
  "workers.context.rejectionTitleSuffix": "블록을 GUI가 고칠 수 없습니다",
  "workers.context.rejectionBodyPrefix":
    "추측해서 쓰지 않습니다 — 엉뚱한 라인을 밟으면 워커가 죽고 cron이 조용히 실패합니다.",
  "workers.context.rejectionBodySuffix": "를 손으로 편집한 뒤 이 화면을 새로고침하세요.",
  "workers.context.missingLinePrefix": "넣을 줄은 이것 하나입니다 — 필수",
  "workers.context.missingLineMiddle": "줄",
  "workers.context.missingLineBold": "위",
  "workers.context.missingLineSuffix":
    "아무 곳에 붙이면 열립니다. GUI가 대신 넣지는 않습니다(삽입 자리를 짚을 앵커가 없습니다).",
  "workers.context.pathAriaLabel": "경로",
  "workers.context.descAriaLabel": "설명",
  "workers.context.descPlaceholder": "설명(선택) — 세션이 읽을 이유",
  "workers.context.pickPathLabelSuffix": "번째 경로",
  "workers.context.moveUp": "위로",
  "workers.context.moveDown": "아래로",
  "workers.context.removeRow": "삭제",
  "workers.context.saveFailedTitleSuffix": "를 저장하지 못했습니다",
  "workers.context.overwriteHintPrefix": "저장하면",
  "workers.context.overwriteHintMiddle": "의",
  "workers.context.overwriteHintSuffix": "블록을 통째로 바꿉니다",
  "workers.context.revertButton": "되돌리기",
  "workers.context.countSuffix": "개",
  "workers.context.commonReadFailed": "읽지 못했습니다",

  // 공통 컨텍스트 카드(`CommonContextCard`, §4-1).
  "workers.commonCard.emptyText": "공통 항목이 없습니다 — 워커는 각자 자기 항목만 읽습니다.",
  "workers.commonCard.addLabel": "공통 항목 추가",

  // 워커 설정 다이얼로그 나머지(`WorkerSettingsDialog`, §4-15).
  "workers.settingsDialog.commonContextHeading": "공통 컨텍스트",
  "workers.settingsDialog.commonContextIntro1": "워커 전원이",
  "workers.settingsDialog.commonContextIntro2": "하는 파일 하나입니다 —",
  "workers.settingsDialog.commonContextIntro3": ". 여기 항목은 각 워커 컨텍스트 목록의",
  "workers.settingsDialog.commonContextIntro4":
    "에 들어가고, 워커별 목록에서는 지울 수 없습니다. 한 줄을 고치면 전원에게 반영됩니다.",
  "workers.settingsDialog.commonContextIntro5": "는 워커마다 갈리므로 존재 여부는",
  "workers.settingsDialog.commonContextIntro6":
    "있음입니다 — 워커에 따라 갈리면 단정하지 않습니다(확인 못 했습니다).",
  "workers.settingsDialog.commonContextTopLabel": "최상단",
  "workers.settingsDialog.commonContextEveryoneLabel": "전원에게 있을 때만",
  "workers.settingsDialog.readonlyHeading": "나머지 워커 설정 (표시만)",
  "workers.settingsDialog.readonlyDescription": "이 값들은 이 화면에서 고치지 않습니다 — 워커 파일을 손으로 편집합니다.",
  "workers.settingsDialog.divergentTitle": "워커 간 값이 갈렸습니다",
  "workers.settingsDialog.divergentBody":
    "엔진은 티켓을 디스패치한 워커의 값을 씁니다 — 같은 티켓이 어느 워커에 물리느냐로 결과가 달라집니다.",
  "workers.settingsDialog.reapDescription": "세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌립니다.",
  "workers.settingsDialog.reapFailedTitleSuffix": ".sh reap 실패",

  // 워커 행의 둘째 행 경고 다섯(`WorkerContextRow`, §비주얼 §35).
  "workers.contextRow.fileSuffixPrefix": ".sh에",
  "workers.contextRow.fileSuffixGlue": "를",
  "workers.contextRow.lineNotAddedDefault": "줄을 넣지 못했습니다.",
  "workers.contextRow.applyingPending": "적용 중…",
  "workers.contextRow.noCommonSourceTitle": "이 워커는 공통 컨텍스트를 받지 않습니다",
  "workers.contextRow.noCommonSourceBodyMiddle": "하는 줄이 없습니다 — 위 공통 항목",
  "workers.contextRow.noCommonSourceBodySuffix": "개가 이 워커의 세션에는 붙지 않습니다.",
  "workers.contextRow.applyCommonButton": "공통 적용",
  "workers.contextRow.commonAppliedSentence": "공통을 적용했습니다",
  "workers.contextRow.applyCommonFailedTitle": "공통을 적용하지 못했습니다",
  "workers.contextRow.noSelfHealTitle": "이 워커는 지워도 cron 줄이 남습니다",
  "workers.contextRow.selfHealMissingMiddle":
    "하는 줄이 없습니다 — dira를 지우면 이 워커의 crontab 2줄을 뺄 코드가 돌지 않고, cron이 1분마다 없는 파일을 부릅니다. 적용하면",
  "workers.contextRow.selfHealMissingSuffix": "바로 위에 한 줄이 들어갑니다(엔진 경로는 이 파일의 그 줄에서 읽습니다).",
  "workers.contextRow.applySelfHealButton": "자가 정리 적용",
  "workers.contextRow.selfHealAppliedSentence": "자가 정리를 적용했습니다",
  "workers.contextRow.applySelfHealFailedTitle": "자가 정리를 적용하지 못했습니다",
  "workers.contextRow.gateStaleTitle": "이 워커의 통합 게이트가 낡았습니다",
  "workers.contextRow.gateMissingTitle": "이 워커는 받는 트리가 더러워도 그냥 디스패치됩니다",
  "workers.contextRow.gateStaleBody":
    "의 내용이 지금 판과 다릅니다 — 이 워커는 옛 통합 게이트를 그대로 돕니다. 적용하면 파일을 지금 판으로 덮어씁니다.",
  "workers.contextRow.gateMissingMiddle":
    "하는 줄이 없습니다 — 받는 트리가 더러운 채로 디스패치되면 세션이 일을 다 끝낸 뒤 push에서만 거부됩니다. 적용하면",
  "workers.contextRow.gateMissingSuffix": "바로 위에 한 줄이 들어갑니다(통합 브랜치는 protocols/AGENTS.md에서 읽습니다).",
  "workers.contextRow.applyGateButton": "통합 게이트 적용",
  "workers.contextRow.gateAppliedSentence": "통합 게이트를 적용했습니다",
  "workers.contextRow.applyGateFailedTitle": "통합 게이트를 적용하지 못했습니다",
  "workers.contextRow.expandedIntroPrefix": "워커별",
  "workers.contextRow.expandedIntroMid1": "— 세션 프롬프트 꼬리에 항목의 경로와 설명이 붙습니다.",
  "workers.contextRow.expandedIntroBold": "없는 항목은 에러가 아닙니다",
  "workers.contextRow.expandedIntroMid2": "— 엔진이 건너뛰고 runner.log에",
  "workers.contextRow.expandedIntroMid3":
    "만 남깁니다 (클라우드 마운트가 안 붙은 상태에서 세션이 헛짚지 않게). 목록 최상단의",
  "workers.contextRow.expandedIntroSuffix":
    "배지 행은 아래 공통 컨텍스트이고 여기서는 고칠 수 없습니다 — 그 항목은 워커 파일에 없습니다.",
  "workers.contextRow.copyThisLabel": "이 설정을 복사:",
  "workers.contextRow.emptyWithCommon": "이 워커의 자기 항목은 없습니다 — 위 공통 항목만 받습니다.",
  "workers.contextRow.emptyNoCommon": "항목이 없습니다 — 이 워커의 세션은 참조 컨텍스트 없이 시작합니다.",
  "workers.contextRow.addItemLabel": "항목 추가",
  "workers.contextRow.copyDialogTitlePrefix": "컨텍스트 복사 —",
  "workers.contextRow.copyDescMid1": ".sh의 TICKET_CONTEXT 블록을",
  "workers.contextRow.copyDescMid2": "의 항목",
  "workers.contextRow.copyDescMid3": "개로 바꿉니다.",
  "workers.contextRow.copyDescSuffix": "의 기존 항목은 남지 않습니다.",
  "workers.contextRow.copyBodySuffix":
    "는 펴지 않고 문자열째로 옮깁니다 — 받는 워커는 자기 작업 디렉터리를 가리킵니다. 컨텍스트가 워커마다 갈라져 있으면 같은 티켓이 어느 워커에 물리느냐로 결과가 달라집니다.",
  "workers.contextRow.copyFailedTitle": "복사하지 못했습니다",
  "workers.contextRow.copyingPending": "복사 중…",
  "workers.contextRow.copyButton": "복사",
  "workers.contextRow.copyFailedDefaultMessage": "복사하지 못했습니다.",

  // `workers/page.tsx` — 표시 전용 설정 라벨 · 결함 사전 · 표 머리 · 빈 상태 · 배지.
  "workers.status.stoppedNote": "crontab 미등록",
  "workers.status.staleNote": "다음 tick이 회수한다",
  "workers.defect.missingCwd.title": "작업 디렉터리 없음",
  "workers.defect.missingCwd.why": "tick.sh가 ERROR cwd 없음을 남기고 락을 풀어 티켓을 되돌립니다 — 물었다 놓기만 합니다.",
  "workers.defect.missingLink.title": ".dira 심링크 없음",
  "workers.defect.missingLink.why":
    "세션이 미끼 .dira를 보고 자기 티켓을 못 찾습니다 — 완료 신고도 못 하고 reap이 attempts만 올립니다.",
  "workers.defect.sharedCwd.title": "작업 디렉터리 공유",
  "workers.defect.sharedCwd.why": "두 세션이 한 트리에서 한 브랜치를 밟습니다 — dispatch-gate.sh가 디스패치를 막습니다.",
  "workers.defect.noTicketCwd.title": "TICKET_CWD 없음",
  "workers.defect.noTicketCwd.why":
    "받는 트리에서 그대로 커밋합니다 — 미커밋 흔적이 남으면 통합 게이트가 큐의 워커 전부를 보류시킵니다.",
  // §4-19 결정 3 · §비주얼 §69 — 결함이 아니라 표기다. 경고 색·아이콘·조작이 없다.
  "workers.defect.cwdPending": "첫 디스패치에 통합 게이트가 만듭니다",
  // 이 넷은 `cwdDefects`의 `WorkerDefect.detail`(§0-16 §묶음 표 행 9의 잔여, 티켓 c7c284f6) —
  // 판정이 조립하는 문장의 고정 조각이고 가운데는 실제 경로다. `en`은 후속 티켓이 채운다.
  "workers.defect.noTicketCwd.detailPrefix": "TICKET_CWD 줄이 없어",
  "workers.defect.noTicketCwd.detailSuffix": "에서 일합니다.",
  "workers.defect.missingCwd.detailSuffix": "가 없거나 디렉터리가 아닙니다.",
  "workers.defect.missingLink.detailMissingSuffix": "가 없습니다.",
  "workers.defect.missingLink.detailWrongMid": "가 큐 루트가 아니라",
  "workers.defect.missingLink.detailWrongSuffix": "로 풀립니다.",
  "workers.defect.sharedCwd.detailMid": "와 같은 경로입니다:",
  "workers.tokenSummary.label": "최근 5시간 토큰",
  "workers.tokenSummary.unaccountedPrefix": "· 이 합계에 없는 세션",
  "workers.tokenSummary.unaccountedSuffix": "개",
  "workers.empty.text": "워커 없음",
  "workers.empty.noWorkerBodyPrefix": "워커가 없으면 티켓이 디스패치되지 않을 뿐 아니라",
  "workers.empty.noWorkerBodyMid": "(스테일 수거)과",
  "workers.empty.noWorkerBodySuffix":
    "(할당 해제)도 할 수 없습니다 — 둘 다 워커 스크립트를 통해 엔진이 하는 일입니다(제약 2).",
  // `firstWorkerCmd`의 자리표시자·`worktreeCmds`의 준비 명령 꼬리 주석(티켓 c7c284f6, §0-16
  // §묶음 표 행 9의 잔여). `en`은 후속 티켓이 채운다.
  "workers.firstWorkerCmd.repoPlaceholder": "dira 레포",
  "workers.worktreeCmds.lsHintSuffix": "로 시작해야 한다",
  "workers.table.holdingHeader": "물고 있는 티켓",
  "workers.table.contextHeader": "컨텍스트",
  "workers.table.activityHeader": "마지막 활동",
  "workers.table.tokensHeader": "토큰(5시간)",
  "workers.limitBadge.title": "지금 쓸 수 있는 Claude 계정이 0개입니다 — 이 시각이 지나면 다음 tick이 세션을 띄웁니다",
  "workers.limitBadge.labelPrefix": "리밋 대기 ·",
  "workers.defectAlert.worktreeHintPrefix": "준비 명령은 이 프로젝트의 배치인",
  "workers.defectAlert.worktreeHintMid": "를 만듭니다(§4-2) —",
  "workers.defectAlert.worktreeHintSuffix": "가 그 경로가 아니면 그 줄도 손으로 고치세요. 체크아웃은 GUI가 실행하지 않습니다.",
  "workers.defectAlert.cwdFixPrefix": "이 명령은 워커 파일에",
  "workers.defectAlert.cwdFixSuffix": "한 줄만 더합니다 — 트리는 다음 tick에 게이트가 만듭니다.",
  "workers.lastFailure.title": "세션이 즉시 실패했습니다",

  // `workers/actions.ts` — 서버 액션 결과 메시지(§4 · §4-16 · §4-17). rootOf의 거절은
  // `resolve.unknownProjectPrefix`를 그대로 재사용한다(같은 거절을 액션 파일마다 각자 말한다).
  "workers.stop.removedMessage": "crontab에서 뺐습니다 — 이 워커는 더 이상 새 티켓을 물지 않습니다.",
  "workers.stop.noopMessage": "이미 crontab에 없었습니다 — 바꾼 것이 없습니다.",
  "workers.register.addedMessage": "crontab에 넣었습니다 — 30초 뒤부터 티켓을 물어갑니다.",
  "workers.register.noopMessage": "이미 crontab에 있었습니다 — 바꾼 것이 없습니다.",
  "workers.reap.noStaleOutput": "수거할 스테일 티켓이 없습니다.",

  // §5-3 §편집 표면이 있는 화면 §결정 2 — 사람이 워커 `.sh`를 손으로 고쳐 경계를
  // 어긴 경우다(엔진은 검사하지 않는다). 온톨로지 화면의 경로 줄 + 워커 화면의 읽기 전용
  // 행 둘 다 붙는다(티켓 c5d51522 — 편집 표면은 온톨로지 화면으로, 이 키는 그 네임스페이스로).
  "ontology.location.inWorktree": "이 프로젝트의 git 작업 트리 안입니다",
  // §5-3 §편집 표면이 있는 화면 §결정 3 — `_ontology/SCHEMA.md`도 `objects/`도
  // 없는 폴더를 가리켰을 때. 지표-검사 표 대신 이 한 장이 뜬다.
  "ontology.notDira.title": "dira 형식이 아닙니다",
  "ontology.notDira.body":
    "_ontology/SCHEMA.md도 objects/도 없습니다 — 아직 이 폴더를 dira 형식으로 옮기지 않은 것뿐입니다. 아래 가져오기로 옮겨오세요.",
  // 티켓 cd662a73이 만들고 c5d51522가 온톨로지 화면으로 옮긴 폼 — 화면에서 TICKET_ONTOLOGY를
  // 편집한다(§결정 1 (b)). 거절 사유 둘은 여기서 prefix로 쓰고 값이 뒤에 붙는다
  // (`projectActions.unknownProjectPrefix`와 같은 관용구) — 셋째 거절(워크트리 안)은 위
  // `ontology.location.inWorktree`를 그대로 재사용한다(새 문구를 안 만든다).
  "ontology.location.edit": "온톨로지 자리 편집",
  // 티켓 71eac784 — 이 화면에 `찾아보기` 피커가 둘이라(§데스크톱 앱 N3 §온톨로지 자리)
  // `PickPath`의 `label` prop으로 아래 import 카드의 `가져올 폴더`와 구분한다.
  "ontology.location.browse": "온톨로지 자리",
  "ontology.location.placeholder": "이 프로젝트의 git 작업 트리 밖 절대경로",
  "ontology.location.save": "저장",
  "ontology.location.saveFailed": "저장하지 못했습니다",
  "ontology.location.notAbsolute": "절대경로여야 합니다:",
  "ontology.location.notDirectory": "실재하는 디렉터리가 아닙니다:",

  // 온톨로지 화면 나머지(§0-16 §발행 §묶음 표 행 12 갈래, `2ef7a4e9`) — ontology-seed.ts ·
  // ontology-ui.tsx · ontology/page.tsx · ontology/actions.ts · lib/ontology.ts.
  // `protocols-ui.tsx`의 판박이 자리(새 파일 · 편집기 · 삭제)는 `protocols.*`와 같은 문구지만
  // 화면이 갈리므로 키는 따로 연다(`boardPage.*`가 `board.*`와 갈린 것과 같은 판단) — 공통 동작
  // (저장 · 취소 · 만들기)만 `common.*`을 그대로 쓴다.
  "ontology.import.folderLabel": "가져올 폴더",
  "ontology.publishing": "발행하는 중…",
  "ontology.import.title": "가져오기",
  "ontology.import.hint": "폴더를 골라야 누를 수 있습니다 — 폴더 이름이 출처가 됩니다",
  "ontology.import.failTitle": "가져오기 티켓을 만들지 못했습니다",

  "ontology.new.trigger": "새 파일",
  "ontology.new.descPrefix": "온톨로지 디렉터리 기준 상대경로입니다.",
  "ontology.new.descSuffix": "를 넣으면 하위 디렉터리도 같이 만듭니다. 빈 파일로 만들고 바로 편집기가 열립니다.",
  "ontology.new.pathLabel": "경로",
  "ontology.new.pathHintPrefix": "디렉터리 밖으로 나가는 경로(",
  "ontology.new.pathHintSuffix": "· 절대경로)는 서버가 거부합니다.",
  "ontology.new.failTitle": "파일을 만들지 못했습니다",

  "ontology.fix.failTitle": "정리 티켓을 만들지 못했습니다",
  "ontology.fix.trigger": "문제해결",

  "ontology.editor.saveFailTitle": "저장하지 못했습니다",
  "ontology.charSuffix": "자",
  "ontology.editor.revert": "되돌리기",
  "ontology.editor.saved": "저장됐습니다.",

  "ontology.rename.trigger": "이름변경",
  "ontology.rename.desc":
    "상대경로를 바꾸면 하위 디렉터리로 옮기는 것도 됩니다. 같은 이름의 파일이 이미 있으면 거부합니다 — 조용히 덮어쓰지 않습니다.",
  "ontology.rename.newPathLabel": "새 경로",
  "ontology.rename.failTitle": "이름을 바꾸지 못했습니다",
  "ontology.rename.working": "바꾸는 중…",

  "ontology.delete.trigger": "삭제",
  "ontology.delete.dialogTitle": "파일 삭제",
  "ontology.delete.descSuffix": "를 지웁니다. 되돌릴 수 없습니다.",
  "ontology.delete.failTitle": "지우지 못했습니다",
  "ontology.delete.working": "삭제 중…",

  // 생성 설문 4문항(§5-3 §생성) — 실제 문구는 `lib/ontology-seed.ts`의 `QUESTIONS`·
  // `Q1_OPTIONS` 등이 이 키를 가리킨다(`labelKey`). 응답 원문(`value`)은 산출물에 박히므로
  // 로케일 무관 한국어 고정이고, 이 키들은 화면 표시에만 쓰인다.
  "ontology.survey.q1.question": "이 프로젝트는 주로 무엇을 다루나요?",
  "ontology.survey.q1.option.product": "제품이나 코드를 만듭니다",
  "ontology.survey.q1.option.content": "글이나 콘텐츠를 만듭니다",
  "ontology.survey.q1.option.people": "사람을 상대합니다 (고객·파트너·팀)",
  "ontology.survey.q1.option.data": "자료를 모으고 정리합니다",
  "ontology.survey.q2.question": "일하다 보면 자주 이름을 불러 부르게 될 대상은 무엇인가요?",
  "ontology.survey.q2.chip.customer": "고객",
  "ontology.survey.q2.chip.project": "프로젝트",
  "ontology.survey.q2.chip.doc": "문서",
  "ontology.survey.q2.chip.task": "작업",
  "ontology.survey.q2.chip.product": "제품",
  "ontology.survey.q2.customPlaceholder": "직접 입력 (쉼표로 여러 개)",
  "ontology.survey.q3.question": "나중에 이런 걸 물어보게 될 것 같나요?",
  "ontology.survey.q3.option.connect": "이게 무엇과 연결되나요?",
  "ontology.survey.q3.option.owner": "누가 관여했나요?",
  "ontology.survey.q3.option.cause": "무엇 때문에 이렇게 됐나요?",
  "ontology.survey.q3.option.next": "다음에 무엇으로 이어지나요?",
  "ontology.survey.q4.question": "다음 중 프로젝트 자체가 아니라 작업 흔적이라 정리 대상이 아닌 것을 골라주세요",
  "ontology.survey.q4.option.tool": "이 프로젝트를 굴리는 관리 도구 자체(예: 지금 쓰는 이 화면)",
  "ontology.survey.q4.option.memo": "임시 메모나 낙서",
  "ontology.survey.q4.option.chatlog": "지나간 대화 로그",
  "ontology.survey.q4.option.testfile": "테스트로 남긴 파일",
  // 제출 뒤 대기 문장 — `보드`는 `shell.nav.board`를 그대로 재사용한다(같은 낱말, 새 문구
  // 0). prefix/suffix 사이에 그 링크가 낀다: `${prefix} <Link>보드</Link>${suffix}`.
  "ontology.survey.pendingPrefix": "답을 바탕으로 만드는 중입니다… 이어지는 첫 채움은",
  "ontology.survey.pendingSuffix": "의 티켓 한 장으로 돕니다.",
  "ontology.survey.failTitle": "만들지 못했습니다",

  // `lib/ontology.ts`의 `schemaViolations` — 화면에 전문이 뜨는 유일한 진단 배열이다
  // (`OntologyMetricsPanel`). 나머지 지표(`hiddenEdges` 등)의 `.items`는 화면에 카운트만
  // 뜨고 문자열 자체는 `ontology.test.ts`만 읽어서 사전에 안 옮긴다(`## 결과`에 판정 근거).
  "ontology.violation.unknownTypePrefix": "미정의 타입:",
  "ontology.violation.unknownTypeMiddle": "(타입 '",
  "ontology.violation.unknownTypeSuffix": "' 이 SCHEMA.md 에 없음)",
  "ontology.violation.sectionUsed": "## 절 사용:",
  "ontology.violation.unknownRelationPrefix": "미정의 관계:",
  "ontology.violation.ofQuote": "의 '",
  "ontology.violation.unknownRelationSuffix": "' (SCHEMA.md 관계 표에 없음)",
  "ontology.violation.domainRangePrefix": "정의역·치역 위반:",
  "ontology.violation.domainRangeMid": "' (",
  "ontology.violation.domainRangeSuffix": ") 인데 스키마는 [",
  "ontology.violation.danglingPrefix": "댕글링:",
  "ontology.violation.missingRequiredPrefix": "필수 속성 누락:",

  // ontology/page.tsx 나머지(사이드바 · 위반 판 라벨 · 빈 트리 설문 안내).
  "ontology.sidebar.collapse": "파일 목록 접기",
  "ontology.sidebar.expand": "파일 목록 펴기",
  "ontology.usingDefault": "기본값 가정",
  "ontology.sidebar.ariaLabel": "온톨로지 파일",
  "ontology.rejected.title": "이 경로는 열 수 없습니다",
  "ontology.picker.expanded": "파일을 고르세요.",
  "ontology.picker.collapsed": "파일 목록을 펴서 고르세요.",
  "ontology.metrics.objectRelation": "객체 · 관계",
  "ontology.metrics.hiddenEdges": "숨은 간선",
  "ontology.metrics.normativeSentences": "규범 문장",
  "ontology.metrics.singleSentenceProse": "서술 한 문장",
  "ontology.metrics.shells": "껍데기",
  "ontology.metrics.isolated": "고립",
  "ontology.metrics.hierarchyCycles": "계층 순환",
  "ontology.metrics.polysemousElements": "다의적 요소",
  "ontology.metrics.redundantClasses": "잉여 클래스",
  "ontology.metrics.emptyHandedRatio": "빈손 비율",
  "ontology.metrics.schemaStability": "스키마 개정(누적)",
  "ontology.metrics.lastUpdated": "마지막 반영",
  "ontology.metrics.noRecord": "기록 없음",
  "ontology.unit.count": "건",
  "ontology.metrics.violationsPrefix": "스키마 위반",
  "ontology.metrics.moreCountPrefix": "외",
  "ontology.metrics.fixTicketPrefix": "정리 티켓",
  "ontology.empty.heading": "몇 가지만 답하면 시작할 자료를 만들어 드립니다",
  "ontology.empty.bodyPrefix": "건너뛰어도 이 프로젝트는 그대로 돕니다 —",
  "ontology.empty.bodyMiddle": "는",
  "ontology.empty.bodySuffix": "가 비어 있으면 그냥 넘어갑니다.",
  "ontology.empty.skipHint": "답할 게 마땅치 않다면 건너뛰고 빈 파일부터 시작해도 됩니다.",

  // ontology/actions.ts — 발행 서버 액션. `등록되지 않은 프로젝트입니다:`는
  // `boardPage.action.unknownProjectPrefix`·`protocols.action.unknownProjectPrefix`와 같은
  // 문장이지만 화면마다 각자 키를 든다(§0-16, `f3a8794e`와 같은 판단). 디렉터리 거절은 이미 있는
  // `ontology.location.notDirectory`를 그대로 재사용한다(같은 화면 안이라 새 키를 안 연다).
  "ontology.action.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",
  "ontology.action.hashExhausted": "해시를 10번 뽑았는데 전부 이미 쓰이고 있습니다 — 큐 디렉터리를 확인하세요.",

  // 보드 화면(§0-16 §발행 §묶음 표 행 3, `f3a8794e`) — page.tsx · board-ui.tsx · actions.ts.
  // `board.*`는 §에픽 묶음이 이미 en을 채워 잠갔다(`FILLED`, i18n.test.ts) — 그 접두에 새 키를
  // 못 넣으므로 이 갈래는 `boardPage.*`로 새로 연다. en은 `6d818d48`가 채운다.
  "boardPage.view.table": "테이블",
  "boardPage.view.kanban": "칸반",
  // 표 컬럼 라벨 8개 — 스윔레인·표뷰의 필터 라벨과 같은 글자라(§에픽 결정 7 §표뷰) 그 자리도
  // 이 키를 그대로 재사용한다(중복 값 0). 9번째(에픽)는 `board.column.epic`을 그대로 쓴다.
  "boardPage.column.status": "상태",
  "boardPage.column.hash": "해시",
  "boardPage.column.title": "제목",
  "boardPage.column.kind": "분류",
  "boardPage.column.persona": "페르소나",
  "boardPage.column.deps": "의존성",
  "boardPage.column.created": "생성일",
  "boardPage.column.owner": "담당",
  // 완료 카드 하단 아카이브 한 줄(§5-3 §표시 규약 ③).
  "boardPage.archive.awaitingAnswer": "아카이빙 답변 대기",
  "boardPage.archive.inProgress": "아카이빙중",
  "boardPage.archive.pending": "아카이빙 대기",
  // 필터 0건(§6) — 검색어가 있을 때/없을 때 문구가 갈린다.
  // 뒤에 `"${query.q}"`가 공백 없이 붙는다.
  "boardPage.noMatch.querySuffix": "와 일치하는 티켓 0건",
  "boardPage.noMatch.generic": "조건에 맞는 티켓 0건",
  "boardPage.filter.reset": "필터 초기화",
  "boardPage.filter.hideDone": "완료 숨기기",
  // BoardFilter 팝오버의 커맨드 검색 placeholder — 앞에 필터 라벨이 공백 하나로 붙는다.
  "boardPage.filter.searchSuffix": "검색",
  // BoardFilter 팝오버의 0건(board-ui.tsx `CommandEmpty`) — 앞에 필터 라벨이 공백 하나로 붙는다.
  "boardPage.filter.noMatchPrefix": "일치하는",
  "boardPage.title.empty": "(제목 없음)",
  "boardPage.empty.noTickets": "열린 티켓 없음",
  // 건수 줄(§1 보드) — `티켓 N건` · `티켓 N / M건`. `unit.count`는 숫자 뒤에 공백 없이 붙는다.
  "boardPage.count.label": "티켓",
  "boardPage.unit.count": "건",
  "boardPage.count.zero": "0건",
  // `완료 N건 숨김` 링크 — prefix·unit·N·suffix가 이 순서로 공백 하나씩 사이에 붙는다.
  "boardPage.count.hiddenPrefix": "완료",
  "boardPage.count.hiddenSuffix": "숨김",
  // `(디스패치되지 않는 N건은 상단 알림)` 각주 — 괄호는 코드가 직접 그린다.
  "boardPage.undispatched.prefix": "디스패치되지 않는",
  "boardPage.undispatched.suffix": "건은 상단 알림",
  // 정렬 헤더의 aria-label — 앞에 컬럼 라벨이 공백 하나로 붙는다.
  "boardPage.sort.ariaSuffix": "정렬",
  "boardPage.search.placeholder": "title · 본문 · frontmatter 검색",
  "boardPage.search.ariaLabel": "티켓 검색",
  "boardPage.epicDrag.missingTitle": "티켓 파일을 찾지 못했습니다 — 큐에서 사라졌거나 상태가 갈렸습니다",
  "boardPage.epicDrag.failTitle": "에픽을 옮기지 못했습니다",

  // 발행 서버 액션(`(board)/actions.ts`) — `readLanguage()`를 직접 읽는다(§0-16 §장치). 이
  // 액션을 부르는 `NewTicketDialog`가 `ticket-ui.tsx`(P338-3 갈래)라 locale을 그리로 못
  // 넘긴다 — 파라미터를 넓히지 않고 파일 읽기로 푼다(선례 `93c106b3`과 다른 이유가 그것이다).
  // 뒤에 필드 이름이 공백 없이 붙는다(`${name}에 줄바꿈을...`).
  "boardPage.action.noNewlineSuffix": "에 줄바꿈을 넣을 수 없습니다.",
  "boardPage.action.acceptedDefault": "요구사항이 접수되었습니다. 곧 PM이 검토할 예정입니다.",
  // `projectActions.unknownProjectPrefix`와 같은 문장이다 — 같은 거절을 두 액션 파일이 각자
  // 말하는 자리라 낱말이 갈리면 안 된다(선례 `c9f2eec5`와 같은 이유).
  "boardPage.action.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",
  "boardPage.action.reqBodyRequired": "요구 내용을 입력하세요.",
  "boardPage.action.titleRequired": "제목을 입력하세요.",
  // `kind는 ${KINDS.join(" · ")} 중 하나입니다: ${kind}` — `kind`는 frontmatter 키 이름이라
  // 번역하지 않는다(다른 lib 실패 사유의 `kind:`·`persona:`와 같은 판단).
  "boardPage.action.kindPrefix": "kind는",
  "boardPage.action.kindMiddle": "중 하나입니다:",
  "boardPage.action.unknownDepsPrefix": "큐에 없는 deps 해시입니다:",
  "boardPage.action.hashExhausted": "해시를 10번 뽑았는데 전부 이미 쓰이고 있습니다 — 큐 디렉터리를 확인하세요.",
  // `요구사항이 ${label} (${epic}) 에픽으로 접수되었습니다.` — 라벨이 없으면 `board.epic.noTitle`을
  // 그대로 재사용한다(사이드바·이 문장이 같은 글자여야 한다).
  "boardPage.action.epicAcceptedPrefix": "요구사항이",
  "boardPage.action.epicAcceptedSuffix": "에픽으로 접수되었습니다.",
  // 레인 드롭(§1-5) — `ticketDetail.ticketNotFoundPrefix`와 같은 문장이다(보드 카드도 같은 조회를 쓴다).
  "boardPage.action.ticketNotFoundPrefix": "티켓을 찾을 수 없습니다:",
  "boardPage.action.notOpen": "이미 다른 상태로 옮겨진 티켓입니다.",

  // 찾기 바(`find-bar.tsx`, `f3a8794e`) — 보드 화면 전용이 아니라 여러 화면이 무는 공용
  // 컴포넌트라(레이아웃·홈·업데이트 토스트·경로 피커) 화면 접두가 아니라 파일 접두다
  // (묶음 11과 같은 판단). en은 `6d818d48`가 채운다.
  "findBar.placeholder": "찾기",
  "findBar.prev": "이전",
  "findBar.next": "다음",
  "findBar.close": "닫기",

  // 홈 화면(§0-16 §발행 §묶음 표 행 6, `f40e29e7`) — home-ui.tsx · lib/home-agent.ts(화면
  // 문구뿐 — 프롬프트 조립 문자열은 사전 밖이다, 판정은 티켓 `## 결과`) · home/page.tsx ·
  // home/actions.ts. en은 `c357313f`가 채운다.
  "home.title": "홈",
  "home.conversationsLabel": "대화",
  "home.questionLabel": "질문",
  "home.answerLabel": "답",
  "home.newConversation": "새 대화",
  "home.newConversationLocked": "지금 대화가 이미 비어 있습니다 — 여기에 물어보세요",
  "home.showMore": "더보기",
  "home.schedulesLabel": "스케줄",
  "home.workerSessionsLabel": "워커 세션",
  "home.stop": "중지",
  "home.stopped": "중지됨",
  "home.answering": "답하는 중",
  "home.activity.thinking": "생각 중",
  "home.scrollToLatest": "최신으로",
  "home.askPlaceholder": "이 프로젝트에 대해 묻기",
  "home.sending": "보내는 중…",
  "home.send": "보내기",
  "home.answer.retry": "다시 답하기",
  "home.answer.copy": "복사",

  "home.onboarding.title": "이 프로젝트에 대해 묻는다",
  "home.onboarding.body":
    "티켓과 프로젝트 자원(페르소나 · 프로토콜 · 워커)들을 읽고 답합니다. 프로젝트 자원을 수정하도록 할 수도 있습니다.",
  "home.example.ticketsWhy": "답변 대기 티켓이 왜 안 도나",
  "home.example.summarizeProtocols": "이 프로젝트의 프로토콜을 요약해 달라",
  // page.tsx §온보딩 예시 앞의 둘 — 이름 뒤에 공백 없이 붙는 접미(`${워커이름}${이 키}`).
  "home.example.workerActivitySuffix": " 워커는 지금 무슨 일을 하고 있나",
  "home.example.workerEngineSuffix": " 워커는 어떤 엔진으로 도나",

  "home.fail.spawn.title": "답을 받지 못했습니다 — 세션을 띄우지 못했습니다",
  "home.fail.spawn.next": "엔진 CLI가 PATH에 있는지 확인하세요",
  "home.fail.auth.title": "답을 받지 못했습니다 — claude 인증이 없습니다",
  "home.fail.auth.next": "헤더 오른쪽 설정에서 장기 토큰을 넣고 다시 물어보세요.",
  "home.fail.timeout.title": "답을 받지 못했습니다 — 세션이 답 없이 끝났습니다",
  "home.fail.timeout.next": "다시 보내 보세요. 쓴 글은 그대로 남아 있습니다.",
  "home.fail.busy.title": "보내지 못했습니다 — 답이 아직 도는 중입니다",
  "home.fail.busy.next": "끝나면 이 칸이 다시 열립니다. 새로고침하지 않아도 됩니다.",
  "home.fail.noTranscript.title": "답을 찾지 못했습니다 — 트랜스크립트가 없습니다",
  "home.fail.noTranscript.next": "새 대화로 다시 물어보세요.",
  "home.fail.other.title": "답을 받지 못했습니다",

  // `lib/home-agent.ts`가 짓는 `Answer.output`(§24 §실패 5종) — CLI 원문·프롬프트 조립과
  // 다르다: 이 문장은 화면 Failure 카드에 그대로 뜬다.
  "home.errors.emptyQuestion": "질문이 비어 있습니다.",
  "home.errors.claudeNotFoundPrefix": "PATH에서 claude를 찾지 못했습니다. (PATH=",
  "home.errors.emptyAnswer": "엔진이 빈 답을 냈습니다.",
  "home.errors.workerRunningPrefix": "도는 워커 세션에는 여기서 말을 걸 수 없습니다 · 참견은 ",

  "home.workerNote.running": "도는 세션에는 여기서 말을 걸 수 없습니다 · 참견은 ",
  "home.workerNote.done": "워커 권한 없이 이 세션에 이어 묻습니다 · ",
  // 위 `home.errors.workerRunningPrefix`와 이 파일의 `<WorkerNote>` 둘이 같이 쓰는 접미.
  "home.workerNote.runningSuffix": " 상세에서",

  "home.schedule.new": "새 스케줄",
  "home.schedule.emptyTitle": "회차 없음",
  "home.schedule.overdueNote": "예정 시각이 지나 이 스케줄은 돌지 않습니다 — 지우고 다시 만듭니다",
  // 다이얼로그 설명 둘째 문장과 **한 글자까지 같다**(회차 0건 판정 문장, 위 overdueNote 옆자리) —
  // 마침표는 이 값에 안 넣는다: 회차 0건 자리는 뒤에 붙는 문장이 없어 마침표가 없다.
  "home.schedule.liveNote":
    "스케줄은 이 앱이 떠 있는 동안에만 돕니다 — 앱을 꺼도 큐의 티켓은 계속 디스패치됩니다",
  "home.schedule.dueAtSuffix": "에 첫 회차가 돕니다.",
  "home.schedule.locked": "첫 회차가 돌기 전에는 이 스케줄에 말을 걸 수 없습니다",
  "home.schedule.kind.once": "한 번만",
  "home.schedule.kind.daily": "매일",
  "home.schedule.kind.weekly": "매주",
  "home.schedule.kind.monthly": "매월",
  "home.schedule.kindLabel": "반복",
  "home.schedule.timeLabel": "시각",
  "home.schedule.promptLabel": "문장",
  "home.schedule.promptPlaceholder": "답변 대기 티켓을 훑고 사람이 답할 것이 있으면 요구사항으로 올려라.",
  "home.schedule.dayLimitNote": "29일부터 31일까지는 없는 달이 있어서 고를 수 없습니다.",
  "home.schedule.createFailTitle": "스케줄을 만들지 못했습니다",
  "home.schedule.invalidWhenOrPrompt": "시각 또는 문장을 확인하세요.",
  "home.schedule.desc1": "정한 시각에 홈 에이전트가 이 문장을 수행합니다.",
  "home.schedule.desc3": "꺼져 있던 사이의 회차는 앱을 켤 때 한 번만 늦게 돕니다.",
  "home.schedule.deleteTrigger": "스케줄 삭제",
  "home.schedule.deleteTitle": "스케줄을 지웁니다",
  "home.schedule.deleteNote": "지난 회차의 대화를 화면에서 다시 열 수 없습니다.",
  "home.schedule.deleteConfirm": "삭제",

  "home.weekday.mon": "월",
  "home.weekday.tue": "화",
  "home.weekday.wed": "수",
  "home.weekday.thu": "목",
  "home.weekday.fri": "금",
  "home.weekday.sat": "토",
  "home.weekday.sun": "일",

  "home.action.unknownProjectPrefix": "등록되지 않은 프로젝트입니다:",

  // 세션 스트림(§0-16 §묶음 표 행 5 갈래, `33563f49`) — `components/session-stream.tsx` ·
  // `lib/interject.ts`. `lib/transcript.ts`는 화면 껍데기가 아니라 사건 데이터를 만드는 자리라
  // `transcriptLib.*`로 접두를 가른다(daf72662의 파일 접두 판단과 같다). en은 후속 티켓이 채운다.
  "sessionStream.recordCount.label": "기록",
  "sessionStream.recordCount.unit": "건",
  "sessionStream.closedNoUpdate": "끝난 세션 · 갱신 없음",
  "sessionStream.scrollToBottom": "맨 아래로",
  "sessionStream.heading": "진행 기록",
  // `이 워커의 엔진은 ${engine}입니다` · `${engine}는 트랜스크립트를 남기지 않습니다` ·
  // `이 워커의 엔진은 ${engine}입니다 — 참견은 claude 엔진에서만 됩니다` — 엔진 이름이 중간에
  // 공백 없이 낀다.
  "sessionStream.engineIsPrefix": "이 워커의 엔진은",
  "sessionStream.engineIsSuffix": "입니다",
  "sessionStream.noTranscriptSuffix": "는 트랜스크립트를 남기지 않습니다",
  "sessionStream.claudeOnlySuffix": "입니다 — 참견은 claude 엔진에서만 됩니다",
  "sessionStream.noInboxStatic": "이 세션은 참견을 받지 못합니다 — 티켓에 inbox가 없습니다",
  "sessionStream.question": "질문",
  "sessionStream.answer": "답변",
  // §비주얼 §21 실패 4종(`FAIL`) — `error` 문장을 되짚어 갈리면 문구 한 자를 고치는 날 화면이
  // 조용히 뭉친다(`lib/interject.ts`의 같은 경고와 짝).
  "sessionStream.fail.enxio.title": "보내지 못했습니다 — 세션이 끝났습니다",
  "sessionStream.fail.enxio.next": "이 티켓엔 더 이상 도는 세션이 없습니다. 위 글을 복사해 새 티켓으로 지시하세요.",
  "sessionStream.fail.enoent.title": "보내지 못했습니다 — 입구가 없습니다",
  "sessionStream.fail.enoent.next":
    "세션이 방금 끝났거나 엔진이 입구를 못 만들었습니다. 한 번 더 보내 보고, 그래도 안 되면 새 티켓으로 지시하세요.",
  "sessionStream.fail.notWip.title": "보내지 못했습니다 — 진행중이 아닙니다",
  "sessionStream.fail.notWip.next": "참견은 도는 세션에만 닿습니다. 새 티켓으로 지시하세요.",
  "sessionStream.fail.noInbox.title": "보내지 못했습니다 — 참견을 받지 못하는 세션입니다",
  "sessionStream.fail.noInbox.next": "옛 세션이거나 입구를 만들지 않는 엔진입니다. 새 티켓으로 지시하세요.",
  "sessionStream.fail.other.title": "보내지 못했습니다",
  // 완료 모드(이어받기) 실패 2종(`FAIL_DONE`) — `보내지 못했습니다`로 시작하지 않는다(§21).
  "sessionStream.failDone.notDone.title": "발행하지 못했습니다 — 완료 티켓이 아닙니다",
  "sessionStream.failDone.notDone.next":
    "이어받기는 완료 티켓의 것입니다. 새로고침하고 다시 보세요 — 도는 세션이면 이 칸이 참견으로 바뀝니다.",
  "sessionStream.failDone.other.title": "발행하지 못했습니다",
  "sessionStream.failDone.other.next": "위 글을 복사해 보드에서 발행하세요.",
  "sessionStream.answerHint": "답변을 달면 이 티켓이 다시 큐에 뜨고 담당 세션이 이어서 봅니다.",
  "sessionStream.followupAria": "이어받기",
  "sessionStream.interjectAria": "참견",
  "sessionStream.followupPlaceholder": "이어서 무엇을 할지 쓰기",
  "sessionStream.interjectPlaceholder": "도는 세션에 말 걸기",
  "sessionStream.followupHint": "새 열린 티켓 1장이 생깁니다",
  "sessionStream.sentHint": "보냈습니다 · 아래 스트림에 뜹니다",
  "sessionStream.publishing": "발행 중…",
  "sessionStream.publishAction": "이어서 발행",
  "sessionStream.sending": "보내는 중…",
  "sessionStream.sendAction": "보내기",
  "sessionStream.sub": "서브",
  "sessionStream.matchAllSuffix": "일치하는 곳 전부",
  "sessionStream.session": "세션",
  "sessionStream.person": "사람",

  // `lib/interject.ts`(§2-2) — 화면이 §비주얼 §21의 문구 넷(제목·다음 행동)을 가르는 근거가
  // 이 사유들이다. en은 후속 티켓이 채운다.
  "interjectLib.state.open": "열림",
  "interjectLib.state.wip": "진행중",
  "interjectLib.state.done": "완료",
  "interjectLib.emptyContent": "보낼 내용을 입력하세요.",
  "interjectLib.unknownTicketPrefix": "큐에 없는 티켓입니다:",
  "interjectLib.notWipError": "진행중 티켓이 아닙니다 — 도는 세션이 없어 참견이 닿을 곳이 없습니다.",
  "interjectLib.statePrefix": "상태:",
  "interjectLib.noInboxError":
    "이 세션에는 참견 입구가 없습니다(frontmatter `inbox` 없음) — 스트리밍 입력으로 띄운 세션에만 말을 걸 수 있습니다.",
  "interjectLib.noInboxDetail": "frontmatter에 inbox 없음",
  "interjectLib.relativeInboxPrefix": "참견 입구 경로가 절대경로가 아닙니다:",
  "interjectLib.enxioError": "세션이 이미 끝났습니다 — 입구는 남아 있는데 읽는 쪽이 없습니다.",
  "interjectLib.enoentError": "참견 입구가 없습니다 — 세션이 끝나면서 지워졌습니다.",
  "interjectLib.openFailedPrefix": "참견 입구를 열 수 없습니다(",
  "interjectLib.openFailedMid": "):",
  "interjectLib.notFifoPrefix": "참견 입구가 FIFO가 아닙니다:",
  "interjectLib.eagainError": "참견 입구가 가득 찼습니다 — 세션이 읽어갈 때까지 기다렸다 다시 보내세요.",
  "interjectLib.epipeError": "세션이 이미 끝났습니다 — 쓰는 중에 입구가 닫혔습니다.",
  "interjectLib.writeFailedPrefix": "참견을 쓰지 못했습니다(",
  "interjectLib.writeFailedMid": "):",

  // `lib/transcript.ts`(§2-1) — 사건 라벨·단위. 여러 화면(§2-1 §home §board)이 `StreamEvent`를
  // 공유해 쓰므로 화면 접두가 아니라 파일 접두다(daf72662와 같은 판단).
  "transcriptLib.assigned": "배정",
  "transcriptLib.charsUnit": "자",
  "transcriptLib.sessionPromptFirst": "세션 프롬프트",
  "transcriptLib.prompt": "프롬프트",
  "transcriptLib.thinking": "생각",
  "transcriptLib.tool": "도구",
  "transcriptLib.result": "결과",
  "transcriptLib.linesUnit": "줄",

  // 에픽 갈래(§0-16 §묶음 표 행 12, `c6b995d6`) — `lib/epics.ts`. en은 후속 티켓이 채운다.
  "epicsLib.keyRequired": "키를 입력하세요.",
  "epicsLib.titleRequired": "제목을 입력하세요.",
  "epicsLib.keyNoNewline": "키에 줄바꿈을 넣을 수 없습니다.",
  "epicsLib.keyOutsideQueuePrefix": "키가 큐 밖을 가리킵니다:",
  "epicsLib.keyExistsPrefix": "이미 있는 키입니다:",
  "epicsLib.createFailedPrefix": "만들지 못했습니다:",
  "epicsLib.bodyRequired": "내용을 입력하세요.",
  "epicsLib.saveFailedPrefix": "저장하지 못했습니다:",
  "epicsLib.memoryFileNotFoundPrefix": "메모리 파일이 목록에 없습니다:",

  // `lib/epic.ts` — 카드를 에픽에 끌어다 놓는 쓰기의 실패 문구.
  "epicLib.noNewline": "epic에 줄바꿈을 넣을 수 없습니다.",
  "epicLib.notFoundPrefix": "큐에 없는 티켓입니다:",
  "epicLib.noFrontmatterPrefix": "frontmatter 없음:",

  // `lib/usage.ts` §2-13 토큰량 덩이(7ede7fc3) — 티켓·에픽 화면 머리에 서버가 조립해 내려주는
  // 문구. `statusbar.tokens.suffix`(단위 `토큰`) · `ticketDetail.thisTicket`(라벨 `이 티켓`) ·
  // `workers.tokenSummary.unaccounted*`(합계 밖 세션)는 이미 찬 사전을 그대로 재사용한다.
  "usageLib.unknown": "모름",
  "usageLib.thisEpic": "이 에픽",
  "usageLib.sessionCount.label": "세션",
  "usageLib.sessionCount.unit": "개",
  "usageLib.epic.knownPrefix": "· 토큰량을 아는 티켓 ",
  "usageLib.epic.knownMid": " / ",
  "usageLib.epic.knownSuffix": "",
  "usageLib.title.noExitRecordPrefix": "이 해시의 로그 ",
  "usageLib.title.noExitRecordSuffix": "개에 종료 기록이 없습니다",
  "usageLib.title.noLogsSuffix": "가 이 머신에 0개입니다",

  // ── 공개 사이트(§0-24, 티켓 76b659fd·P340-3) ──────────────────────────
  // 랜딩(`app/(site)/landing.tsx`) — en은 이 티켓이 안 채운다(writer가 채운다, §0-24 §원고).
  "landing.register.nameLabel": "이름",
  "landing.register.namePlaceholder": "dira 자체",
  "landing.register.idLabel": "URL 조각",
  "landing.register.idHint": "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈).",
  "landing.register.rootLabel": "경로",
  "landing.register.rootPickerLabel": "큐 경로",
  "landing.register.rootHint": "절대경로. ~는 확장됩니다",
  "landing.register.errorTitle": "등록하지 못했습니다",
  // 이미 등록된 프로젝트로 가는 링크 — 한국어는 이름 뒤에 다 붙어 접두가 비고, 영어는
  // 동사가 앞에 서서 접미가 빈다. 조립은 `wrap`이 한다(파일 맨 아래 주석).
  "landing.register.dupOpenPrefix": "",
  "landing.register.dupOpenSuffix": "열기",
  "landing.register.pendingLabel": "등록 확인 중…",
  "landing.register.title": "프로젝트 등록",

  "landing.result.createdLabel": "만들었습니다",
  "landing.result.registeredLabel": "등록됨",
  "landing.result.openBoardLabel": "보드 열기",
  "landing.result.filesWrittenPrefix": "파일",
  "landing.result.filesWrittenSuffix": "개를 만들었습니다.",
  "landing.result.skippedPrefix": "이미 있어 건너뜀:",
  "landing.result.engineRepoLabel": "엔진 레포",
  "landing.result.cronRegistered": "crontab에 등록됨 — 30초 뒤부터 티켓을 물어갑니다",
  "landing.result.cronFailedTitle": "crontab에 등록하지 못했습니다",
  "landing.result.ontologyFailedTitle": "온톨로지 자리를 정하지 못했습니다",
  "landing.result.ontologyFailedLink": "온톨로지 화면에서 다시 정하세요",
  "landing.result.denyCurrentBranchNotePrefix": "받는 트리의 receive.denyCurrentBranch가 이미 다른 값입니다 — 그대로 두었습니다:",

  // `{count}`는 실제 JS 보간이 아니라 검사기가 읽는 자리표시자 문자열이다 — `landing.tsx`가
  // `.replace("{count}", version)`으로 값을 채운다(§0-16 §장치가 정한 `wrap`은 앞뒤에 공백을
  // 끼워 넣어서 "v1.2.3)의"처럼 붙어야 하는 이 자리엔 못 쓴다).
  "landing.banner.text": "자동 업데이트를 켜고 최신 버전(v{count})의 dira를 써보세요!",
  "landing.banner.releasesLink": "릴리스 보기",

  "landing.nav.manualLink": "매뉴얼",
  "landing.nav.createLabel": "새로 만들기",
  "landing.nav.downloadAppLabel": "앱 다운로드",
  "landing.nav.installGuide": "설치 가이드",

  "landing.projects.registryErrorTitle": "프로젝트 레지스트리를 읽지 못했습니다",
  "landing.projects.emptyHint": "등록된 프로젝트가 없습니다. 하나 만들면 시작합니다.",
  "landing.projects.registerHint": "이미 만들어 둔 .dira가 있다면 등록합니다.",
  "landing.projects.newProjectTitle": "새 프로젝트",

  "landing.hero.eyebrow": "로컬 멀티 에이전트 매니지먼트 시스템",
  "landing.hero.title": "나만의 AI 팀을 만들어보세요",
  "landing.hero.body":
    "요구사항을 정말 아무렇게나 던져도 찰떡같이 알아듣습니다. 티켓을 나누고 에이전트끼리 협업해 끝내는 과정은 jira처럼 실시간으로 지켜볼 수 있습니다. PC에 나만의 멀티 에이전트 시스템을 아주 쉽게 만들어보세요.",
  "landing.hero.downloadCta": "macOS 앱 다운로드",
  "landing.hero.shotAlt":
    "dira 보드 화면. 대기·진행중·완료 세 레인에 티켓 카드가 놓여 있고, 그중 한 장이 다음 레인으로 건너갑니다.",
  "landing.hero.shotCaption": "놀라운 사실: dira 앱 또한 dira로 만들어졌습니다.",

  "landing.steps.title": "말하면 이루어집니다",
  "landing.steps.step1Title": "① 요구사항을 접수하세요",
  "landing.steps.step1Body": "대화하듯 자연스럽게 무엇을 원하는지 적어주시면 끝입니다. 귀찮고 복잡한 나머지 일은 에이전트가 알아서 합니다.",
  "landing.steps.step2Title": "② 일사불란하게 움직입니다",
  "landing.steps.step2Body":
    "요구사항을 받은 에이전트가 그걸 구체화해 작업 단위 티켓으로 나눕니다. 티켓마다 맞는 페르소나의 워커가 알아서 붙고 서로 협업해 주신 요구사항을 끝냅니다.",
  "landing.steps.step3Title": "③ 끝이에요. 쉽죠?",
  "landing.steps.step3Body":
    "워커들이 뭘 읽고 어떻게 고치는지 실시간으로 보입니다. 진행 중에 막히면 사용자에게 물어도 봅니다. 그저 사람과 일하듯 자연스럽게 요구하고 대답하다 보면 원하던 기능이 완성됩니다!",

  "landing.archiving.title": "끝난 일은 기록으로 남습니다",
  "landing.archiving.item1BoldPrefix": "티켓이",
  "landing.archiving.item1BoldSuffix": "이 되면 아카이빙 티켓이 한 장 따라 붙습니다.",
  "landing.archiving.item1Prefix": "완료 카드 아래에",
  "landing.archiving.item1Suffix": "한 줄이 뜨고 이것도 워커가 받아서 하는 일이라 어디까지 갔는지 그대로 보입니다",
  "landing.archiving.item2Bold": "남는 것은 마크다운 한 장과 티켓 맨 아래 한 절입니다.",
  "landing.archiving.item2Prefix": "아카이빙을 맡은 워커가 방금 끝난 일에서 사실을 추려 프로젝트 폴더의",
  "landing.archiving.item2Mid": "에 적고 그 티켓 본문에는",
  "landing.archiving.item2Suffix": "절을 붙입니다",
  "landing.archiving.item3Bold": "다음 세션은 그 자리를 알고 시작합니다.",
  "landing.archiving.item3Body": "온톨로지가 어디에 있고 어떻게 찾는지가 워커에게 나가는 프롬프트마다 실립니다",
  "landing.archiving.item4Bold": "파일은 그냥 마크다운입니다.",
  "landing.archiving.item4Wikilink": "[[링크]]",
  "landing.archiving.item4Body": "로 서로 이어져 있어 Obsidian 같은 도구로 폴더째 열립니다. 프로젝트를 옮기면 기록도 같이 따라갑니다",
  "landing.archiving.promiseBody":
    "일을 시킬수록 워커는 이 프로젝트에 능숙해집니다. 어제 누가 무엇을 정했는지 읽고 시작하니, 같은 이야기를 두 번 하지 않아도 됩니다.",
  "landing.archiving.shotAlt":
    "dira 보드의 진행중·완료 두 레인. 완료 레인 둘째 카드 a732ce19의 아래 칸에 서류함 아이콘과 «아카이빙중» 한 줄이 붙어 있고, 그 위 카드에는 그 줄이 없습니다.",
  "landing.archiving.shotCaption": "이 한 줄은 링크입니다. 누르면 아카이빙을 맡은 티켓으로 건너가, 그 워커가 지금 어디까지 갔는지가 보입니다.",
  "landing.archiving.arrowLink": "아카이빙과 온톨로지",

  "landing.gallery.openOriginal": "원본 크기로 열기",
  "landing.gallery.bargeAlt":
    "세션 스트림이 도구 호출을 한 줄씩 늘려 가는 동안, 아래 입력창에 문장을 넣고 보내기를 누르자 그 문장이 참견 줄로 스트림에 나타나고 세션이 이어서 방향을 바꿉니다.",
  "landing.gallery.bargeCaption":
    '"그럴 수 있죠 이해해요, 어떻게 사람이 완벽할까요?" 반드시 완벽한 요구사항을 줄 필요가 없습니다. 가볍게 요구하고 작업 중에도 참견할 수 있습니다.',
  "landing.gallery.bargeArrowLink": "도는 세션에 말 걸기",
  "landing.gallery.qaAlt": "요구 티켓의 질문·답변 스레드. 질문 아래에 답변 말풍선이 오른쪽으로 붙어 있고, frontmatter에 awaiting 해시가 있습니다.",
  "landing.gallery.qaCaption": "어련히 모르면 물어보지 않겠어요? 에이전트들도 일하다 모르는 게 생기면 물어봅니다. 질문에 대답해주세요. 그럼 또 알아서 하러 갑니다.",
  "landing.gallery.qaArrowLink": "문의 · 답변",
  "landing.gallery.runningAlt": "진행중 티켓 상세. 왼쪽에 본문과 Done when 체크리스트, 오른쪽에 frontmatter 표와 관계.",
  "landing.gallery.runningCaption":
    "일이 어떻게 흘러가는지 티켓 단위로 들여다볼 수 있습니다. 생각과 다른 방향으로 가고 있으면 티켓을 할당 해제해 중단시킵니다. 아직 시작하지 않은 티켓은 본문을 고쳐 원하는 방향을 자세히 적어 둘 수도 있습니다.",
  "landing.gallery.runningArrowLink": "업무 투명성",
  "landing.gallery.ontologyAlt":
    "온톨로지 화면. 제목 아래에 카드가 든 폴더 경로가 있고, 그 밑 지표 판에 객체 · 관계 96 · 184를 비롯한 칸이 열두 개 있습니다. 아래는 왼쪽이 카드 파일트리, 오른쪽이 고른 파일 _ontology/SCHEMA.md를 위지윅으로 연 편집기입니다.",
  "landing.gallery.ontologyCaption": "티켓이 끝날 때마다 그 일에서 추린 사실이 한 장씩 여기 쌓입니다. 프로젝트 폴더 안에 마크다운으로 남아서 다음 세션도 사람도 같은 자리를 열어 봅니다.",

  "landing.noAccount.title": "계정을 만들 필요가 없습니다",
  "landing.noAccount.item1Bold": "dira에는 서버가 없습니다.",
  "landing.noAccount.item1Body": "가입도 로그인도 없습니다. 내려받아 열면 그게 전부이고 만든 프로젝트가 어딘가로 올라가지 않습니다",
  "landing.noAccount.item2Bold": "티켓도 기록도 프로젝트 폴더 안에 있습니다.",
  "landing.noAccount.item2Prefix": "큐는",
  "landing.noAccount.projectPlaceholder": "프로젝트",
  "landing.noAccount.item2Suffix": "디렉터리 하나이고 담긴 것은 마크다운 파일입니다. 따로 권한을 설정하는 자리가 없어서 그 폴더를 열 수 있으면 그것이 곧 권한입니다",
  "landing.noAccount.item3Bold": "모델에는 일감이 나갑니다.",
  "landing.noAccount.item3Body": "워커가 세션을 띄울 때 티켓 본문과 필요한 코드가 고르신 엔진을 거쳐 모델로 갑니다. 그 통로 밖으로 작업한 내용을 dira가 따로 가져가지는 않습니다",
  "landing.noAccount.item4Bold": "사용 통계는 끄면 그만입니다.",
  "landing.noAccount.item4Prefix":
    "화면에서 무엇을 눌렀는지 여덟 가지만 셉니다. 티켓 제목·본문·파일 경로·프롬프트는 실리지 않습니다. 설정에서 끄면 그때부터 아무것도 나가지 않고 남은 것까지 지우시려면",
  "landing.noAccount.item4Suffix": "한 개를 지우면 됩니다",
  "landing.noAccount.shotAlt":
    "프로젝트가 0건일 때의 첫 화면. 등록된 프로젝트가 없다는 한 줄 아래에 새 프로젝트 카드가 펼쳐져 있고, 이름·프로젝트 폴더·통합 브랜치·스펙 문서 칸과 프로젝트 만들기 버튼이 있습니다.",
  "landing.noAccount.shotCaption": "설치하고 처음 열면 이 화면입니다. 적는 것은 이름과 프로젝트 폴더뿐이고 계정을 넣는 칸이 없습니다.",
  "landing.noAccount.arrowLink": "사용 통계와 끄는 법",

  "landing.stats.dependenciesLabel": "엔진 의존성",
  "landing.stats.dependenciesValue": "bash + python3 표준 라이브러리",
  "landing.stats.concurrentWorkersLabel": "이 레포에서 동시에 도는 워커",
  "landing.stats.ticketsLabel": "자기 큐가 받은 티켓",
  "landing.stats.ticketsValue": "완료 1762",
  "landing.stats.hoursBig": "62시간",
  "landing.stats.hoursLabel": "첫 커밋에서 첫 릴리스까지",
  "landing.stats.hoursCommitsValue": "커밋 351",
  "landing.stats.note": "2026-08-12 기준",

  "landing.install.eyebrow": "설치",
  "landing.install.title": "다운로드해서 설치하면 끝",
  "landing.install.body": "받아서 열기만 하면 되고 터미널을 켤 일이 없습니다.",
  "landing.install.step1BoldSuffix": "를 열고 끌어다 놓습니다.",
  "landing.install.step1AppSuffix": "을",
  "landing.install.applicationsFolder": "응용 프로그램",
  "landing.install.step1Body": "으로 옮기면 그것으로 설치가 끝납니다. 서명·공증된 빌드라 처음 열 때 맥이 낯선 앱이라며 막지 않습니다",
  "landing.install.step2Bold": "② 앱을 처음 열면 폼이 펼쳐져 있습니다.",
  "landing.install.step2Prefix": "이름과 프로젝트 폴더를 넣고",
  "landing.install.step2Suffix": "를 누릅니다",
  "landing.install.step3Bold": "③ 30초 뒤부터 워커가 큐를 훑습니다.",
  "landing.install.step3Body": "티켓을 써 두면 그때부터 물어 갑니다",
  "landing.install.item1BoldPrefix": "엔진은",
  "landing.install.item1BoldMid": "와",
  "landing.install.item1BoldSuffix": ", grok과 agy 넷 중에 고릅니다.",
  "landing.install.item1Prefix": "워커를 만들 때 모델까지 같이 정하고 목록에 없는 이름은 직접 적어 넣습니다. 만든 뒤에도 워커 화면의",
  "landing.install.item1Mid": "열을 눌러 바꿉니다. 참견은",
  "landing.install.item1Suffix": "에만 있고 세션 스트림은 claude와 grok에 있습니다. 앱은 Apple Silicon 맥에서만 돕니다",
  "landing.install.item2Bold": "화면 없이 엔진만 돌릴 수도 있습니다.",
  "landing.install.item2Prefix": "Linux에서 굴리거나 화면이 필요 없으면 레포를 직접 받는",
  "landing.install.item2LinkText": "그 갈래",
  "landing.install.item2Suffix": "로 가세요",
  "landing.install.fullGuideLink": "전체 설치 가이드",
  "landing.install.firstTicketLink": "첫 프로젝트 만들기",
  "landing.install.cronOnlyLink": "엔진만으로 돌리기",

  "landing.plan.eyebrow": "플랜",
  "landing.plan.cycleResumeAriaLabel": "플랜 카드 순환 다시 돌리기",
  "landing.plan.cyclePauseAriaLabel": "플랜 카드 순환 멈추기",
  "landing.plan.title": "내 PC에서 무료로 시작해보세요",
  "landing.plan.freeItem1": "로컬 앱과 엔진을 직접 설치해 쓰기",
  "landing.plan.freeItem2": "동료들과 P2P 협업",
  "landing.plan.freeItem3": "엔진 MCP",
  "landing.plan.soon": "준비중",
  "landing.plan.freeBody": "로컬 엔진과 앱은 영원히 무료로 제공합니다. dira는 빌더들의 멀티 에이전트 생태계를 응원합니다.",
  "landing.plan.proItem1": "클라우드 프로젝트",
  "landing.plan.proItem2": "dira 자체 클라우드 LLM 사용",
  "landing.plan.proItem3": "결과물 웹 호스팅",
  "landing.plan.proItem4": "클라우드 워커",
  "landing.plan.enterpriseItem1": "엔터프라이즈 전용 커스텀",
  "landing.plan.enterpriseItem2": "사내툴과 연동",
  "landing.plan.personaMarket": "페르소나 마켓",
  "landing.plan.personaMarketItem": "생태계도 같이 만듭니다",
  "landing.plan.ctaBody": "가입도 결제도 없습니다. 안 맞으면 지우면 그만이니 일단 깔아보세요.",

  "landing.footer.productHeading": "제품",
  "landing.footer.downloadLink": "다운로드",
  "landing.footer.releasesLink": "릴리스",
  "landing.footer.engineLink": "엔진",
  "landing.footer.docsHeading": "문서",
  "landing.footer.templatesLink": "템플릿",
  "landing.footer.repoHeading": "레포",
  "landing.footer.issuesLink": "이슈",
  "landing.footer.licenseLink": "MIT 라이선스",
  "landing.footer.copyright": "© 2026 프루퍼 주식회사. MIT.",
  "landing.footer.termsLink": "이용약관",
  "landing.footer.privacyLink": "개인정보처리방침",

  "landing.registerDialog.description": "이미 있는 .dira를 목록에 올립니다. 파일은 만들지 않습니다.",

  // 매뉴얼 사이드바(`app/(site)/docs/[[...slug]]/page.tsx`의 `SIDEBAR`) — 그룹 6 + 링크 26.
  // 순서·링크는 `sidebar.test.ts`가 지킨다. en은 이 티켓이 안 채운다.
  "manualSidebar.group.gettingStarted": "시작하기",
  "manualSidebar.group.watching": "지켜보기",
  "manualSidebar.group.writing": "직접 쓰기",
  "manualSidebar.group.extending": "늘리기",
  "manualSidebar.group.operating": "운영",
  "manualSidebar.group.appendix": "부록",
  "manualSidebar.item.whatIsDira": "dira에 대하여",
  "manualSidebar.item.install": "설치",
  "manualSidebar.item.firstTicket": "첫 프로젝트 만들기",
  "manualSidebar.item.requirements": "요구사항 접수하기",
  "manualSidebar.item.screens": "화면 소개",
  "manualSidebar.item.bargeIn": "도는 세션에 말 걸기",
  "manualSidebar.item.ticketWriting": "티켓 직접 발행하기",
  "manualSidebar.item.states": "티켓이 지나는 상태",
  "manualSidebar.item.worker": "워커",
  "manualSidebar.item.concurrency": "동시에 몇 개 돌릴까",
  "manualSidebar.item.personas": "페르소나",
  "manualSidebar.item.squads": "스쿼드",
  "manualSidebar.item.protocols": "프로토콜",
  "manualSidebar.item.ontology": "아카이빙과 온톨로지",
  "manualSidebar.item.epics": "에픽",
  "manualSidebar.item.auth": "인증",
  "manualSidebar.item.troubleshooting": "트러블슈팅",
  "manualSidebar.item.logs": "로그 읽는 법",
  "manualSidebar.item.analytics": "사용 통계와 끄는 법",
  "manualSidebar.item.schedules": "스케줄",
  "manualSidebar.item.webhook": "답변 대기를 밖으로 보내기",
  "manualSidebar.item.closing": "마치면서",
  "manualSidebar.item.cron": "엔진만으로 돌리기",
  "manualSidebar.item.refEnv": "워커 환경변수",
  "manualSidebar.item.refCli": "CLI",
  "manualSidebar.item.refFrontmatter": "frontmatter 필드",

  // 매뉴얼 셸(`app/(site)/shell.tsx`·`doc.tsx`) — 루트 산문 2장(`/terms`·`/privacy`)도 같은
  // 셸을 쓴다(§사이트 기반 §루트 산문 2장의 셸). en은 이 티켓이 안 채운다.
  "manualShell.darkToggleAriaLabel": "다크 모드",
  "manualShell.navToggleAriaLabel": "메뉴 열기",
  "manualShell.menuToggleAriaLabel": "사이드바 열기",
  "manualShell.menuLabel": "메뉴",
  "manualShell.copiedLabel": "됨",
  "manualShell.copyLabel": "복사",
  "manualShell.copyCodeAriaLabel": "코드 복사",
  "manualShell.skipLink": "본문으로 건너뛰기",
  "manualShell.projectsLink": "프로젝트 관리",
  "manualShell.sidebarAriaLabel": "매뉴얼 목차",
  "manualShell.editPageLink": "이 페이지 고치기",
  "manualShell.prevNextAriaLabel": "이전 다음 문서",
  "manualShell.prevLabel": "이전",
  "manualShell.nextLabel": "다음",
  "manualShell.onThisPageLabel": "이 페이지",

  // 공개 사이트 오류·부재·메타(§0-24, 티켓 76b659fd) — `error.tsx`·`not-found.tsx`·`meta.ts`.
  // en은 이 티켓이 안 채운다.
  "siteError.title": "화면을 표시하지 못했습니다",
  "siteError.noReason": "원인 정보 없음",
  "siteError.retry": "다시 시도",
  "siteNotFound.body": "이 주소에는 페이지가 없습니다.",
  "siteNotFound.homeLink": "홈으로",
  "siteMeta.description": "티켓을 큐에 넣으면 cron에 물린 워커가 claude 세션에 넘깁니다. 파일시스템이 곧 큐인 티켓 디스패처.",
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
 *  | 우선순위 · 유효 우선순위 | priority · effective priority | 62e0b85e가 더한 줄부터 아래 |
 *  | 선점 | preempt | §1-3의 그 동작. 화면 문구에서는 `stops a running session`으로 풀어 쓴다 — 큐를 처음 여는 사람에게 `preempt`는 아직 낱말이 아니다 |
 *  | 마감 · 유효마감 | due date · effective due date | 5debff0e가 더한 줄부터 아래. 입력 라벨은 `Due date`, 문장 안에서는 `due` |
 *  | 선행 · 후행 | prerequisite · the ticket waiting on it | `dep`은 frontmatter 키 이름이지 사람 말이 아니다(§0-10 §문구가 `reap`을 몰아낸 그 자) |
 *  | 마감이 지났다 | past due | 종 ⑦ 나열의 한 조각. `overdue`도 같은 뜻이지만 두 낱말을 섞지 않는다 |
 *  | 시간 · 분 · 일 | h · m · d | `4f7def31`이 더한 줄. 남은 시간 표기의 낱말 — 복수형 장치가 없어 약어로 자릿수 문제를 피한다 |
 *  | 알림 · 매뉴얼 · 사유 | notification · Manual · reason | `90be3eeb`(셸 묶음)이 더한 줄부터 아래 |
 *  | 프로젝트 관리(루트 화면 `/`) | Manage projects | 전환기 하단 항목과 배너 CTA가 같은 낱말을 쓴다 |
 *  | 티켓을 집다 · 할당 해제 | claim · Unassign | 엔진의 낱말이다(README §claim 락). `take`로 풀지 않는다 |
 *  | 답변 · 답변 기록 | answer · answer on record | `답변 대기` 배지도 이 낱말이다(`Awaiting answer`) |
 *  | deps 대기(배지) | Blocked | `dep`을 안 쓰는 근거는 위 `선행` 줄과 같다 |
 *  | 한도 · 사용률 · 리셋 · 소모 속도 | limit · used · reset · tokens/min | status bar의 넷. 피드백 `fe25d40e`가 *사전 밖에서 지어낸 낱말*로 잡은 그 자리라, 여기가 정본이다 |
 *  | 열림(전환기의 티켓 수) | open | 파일이 열려 있는 티켓 전부라 배지 `Open`보다 넓지만, 엔진이 그 파일 상태를 부르는 이름이 `open` 하나다 — 셋째 낱말을 만들지 않는다 |
 *  | 프로토콜 파일 · 코어 프로토콜 | protocol file · core protocol | `7a86fd5c`(프로토콜 묶음)가 더한 줄부터 아래 |
 *  | 인라인(프롬프트에) | inline(d) | tick.sh가 전문을 프롬프트 머리에 붙이는 그 동작. `embed`로 풀지 않는다 — 스펙·매뉴얼이 쓰는 낱말이 이것 하나다 |
 *  | vendored | vendored | 코어 사본이 큐 안에 있는 상태. 한국어 화면도 이 낱말을 그대로 쓴다(결정 8-d) |
 *  | 되돌리기(편집기) | Revert | 저장 안 한 편집을 버리는 자리다. **`기본값으로 되돌리기`(Reset to default)와 다른 낱말이다** — 돌아가는 곳이 기본값이 아니라 마지막 저장본이다 |
 *  | 이름변경 · 기본값 가정 | Rename · assumed default | 뒤엣것은 경로 옆 꼬리라 소문자다(`settings.tokens.addedSuffix`가 선 그 벌) |
 *  | 원문(읽기 전용 칸의 낭독 이름) | source | 화면에 안 뜨는 접근가능 이름(`CORE.md source`) |
 *  | 자(글자 수) | chars | 복수형 장치가 없어 늘 복수로 둔다 — 이 자리는 1이 거의 안 뜬다 |
 *  | 스쿼드 · 멤버 · 리더 · 규칙 | squad · member · leader · rules | `b5d9735d`(페르소나 묶음)가 더한 줄부터 아래 |
 *  | 스킬 · 메모리 · 프로필 | skill · memory · profile | |
 *  | 상한(동시 워커) | limit | status bar의 `한도`와 같은 낱말이다 — 재는 것이 다를 뿐 사람이 부르는 이름은 하나다 |
 *  | 지정 없음 · 지정 해제 | Not set · Clear | 값과 그 값을 지우는 버튼이라 낱말이 갈린다 |
 *  | 비활성(스킬) | Off | **토큰의 `비활성`(Disabled)과 다른 자리다** — `켜기`/`끄기` 쌍의 반대말이라 `Off` |
 *  | 초과 | over | 예산 배지의 꼬리(`1,600 / 1,500 B over`) |
 *  | 생성(다이얼로그 제목) | New | `티켓 발행 = New ticket`이 선 그 벌 — 여는 것의 이름이지 동사가 아니다 |
 *  | 위지윅 · 원문(편집기 두 면) | rich text · source | `90db2822`(공용 컴포넌트 묶음)가 더한 줄부터 아래. 뒤엣것은 위 `원문` 줄과 같은 낱말이다 |
 *  | 상한(거절 제목) | limit | 예산 꼬리의 `초과`(위 줄)와 같은 낱말이 상한 거절 제목에도 뜬다 |
 *  | 의견(깃허브 이슈 제목) | Feedback | 제품이 그 화면을 부르는 이름이 `의견`이다 — `Report`가 아니다 |
 *  | 업데이트 | update | 데스크톱 앱이 받아 다는 그것. `upgrade`로 안 부른다 |
 *  | 테이블 · 칸반(보드 뷰 둘) | Table · Kanban | `6d818d48`(보드 묶음)가 더한 줄부터 아래 |
 *  | 의존성(표 컬럼) | Prerequisites | 위 `선행` 줄의 낱말 그대로다 — `Deps`는 frontmatter 키 이름이라 컬럼 머리에 안 쓴다 |
 *  | 담당 · 생성일(표 컬럼) | Owner · Created | 둘 다 frontmatter 키 이름과 같은 낱말이라 갈릴 자리가 없다 |
 *  | 아카이빙 | archiving | 완료 티켓이 무는 아카이브 티켓이 도는 동안이다. 카드 한 줄 셋이 `Archiving`을 머리로 나눠 갖는다 |
 *  | 찾기(찾기 바) | Find | 지금 보는 화면 안에서 글자를 짚는 일이다 — 큐를 거르는 `Search`와 다른 동작이라 낱말을 가른다 |
 *  | 객체 · 관계 · 액션 | object · relation · action | `024ec871`(온톨로지 묶음)가 더한 줄부터 아래. 스키마가 정한 개념 이름이라 `entity`·`edge`·`event`로 안 푼다. `액션`은 위 키설정 줄의 `action`과 같은 낱말이다 |
 *  | 객체 타입 · 관계 타입 | object type · relation type | 설문 4문항만 이 낱말을 피한다(`ontology-seed.ts` 머리 주석) — 처음 여는 사람에게 아직 낱말이 아니다 |
 *  | 간선 · 댕글링 · 정의역 · 치역 | edge · dangling · domain · range | 위반 문장과 지표 이름의 낱말이다. `숨은 간선`만 `edge`를 쓰고, 관계 자체는 늘 `relation`이다 |
 *  | 빈손(회차 기록) | empty-handed | 아무것도 안 채운 회차다. 지표 이름은 `Empty-handed rate` |
 *  | 가져오기 · 정리 티켓 · 문제해결 | Import · Cleanup ticket · Fix violations | 끝엣것은 버튼이라 무엇을 고치는지까지 적는다 — 한국어가 카드 안에서 자명하던 자리다 |
 *  | 건(지표 단위) | found | 숫자 뒤 꼬리다(`3 found`). 이 자리는 1도 뜨는데 복수형 장치가 없어, 수를 세는 명사 대신 수가 몇이든 같은 꼴인 낱말을 쓴다 |
 *  | 등록 · 등록 해제 | register · unregister | `4c075aa9`(프로젝트 관리 묶음)가 더한 줄부터 아래. 큐 파일은 안 건드리고 목록에만 올렸다 내리는 그 동작이다 |
 *  | URL 조각 | URL slug | 주소의 `/p/<이것>` 한 칸. `id`는 레지스트리 키 이름이라 화면 낱말로 안 쓴다 |
 *  | 프로젝트 폴더 · 통합 브랜치 · 스펙 문서 · 온톨로지 자리 | project folder · integration branch · spec document · ontology location | 생성 폼 네 칸 |
 *  | 해석 결과 · 작업 디렉터리 | resolved values · working directory | 앞엣것은 워커 파일에서 읽어 낸 값들의 표 제목이다 |
 *  | 진행중 접미사 · 완료 접미사 | in-progress suffix · done suffix | 파일 이름 꼬리(`.wip`·`.done`)를 부르는 이름. 위 티켓 상태 줄의 낱말을 그대로 쓴다 |
 *  | 해석 실패 · 루트 밖 · 워커마다 다름 | resolve failed · outside root · differs per worker | 해석 결과 표의 배지 셋. `기본값 가정` 줄과 같은 이유로 소문자다 |
 *  | 마이그레이션 | migration | 온톨로지를 최신 규약으로 다시 올리는 그것. `upgrade`로 안 부른다 |
 *  | 진행 기록 · 기록(건) | Progress record · Records | `f2fcf747`(세션 스트림 묶음)가 더한 줄부터 아래. 뒤엣것은 단위 낱말이 수 앞으로 못 가서 `Records 12` 꼴이다 |
 *  | 참견 입구 | interject inbox | frontmatter `inbox`가 가리키는 FIFO다. `pipe`로 안 푼다 — 사람이 고칠 때 보는 이름이 `inbox` 하나다 |
 *  | 이어받기 | follow-up | 완료 티켓에서 새 티켓 한 장을 내는 그 동작. 참견과 다른 자리라 낱말을 가른다 |
 *  | 서브(사이드체인) | Sub | 한국어가 이미 줄인 낱말이라 영어도 줄인다 — 줄 안 표식이라 자리가 좁다 |
 *  | 사람(말풍선 머리) | Person | 오른쪽 말풍선의 임자는 이 기계를 쓰는 사람 하나지만, 파싱이 아는 것은 `첫 아닌 사용자 프롬프트`까지라 `You`로 안 좁힌다 |
 *  | 트랜스크립트 | transcript | 엔진이 남기는 그 파일. `log`로 안 부른다 |
 *  | 배정 · 생각 · 도구 · 결과(사건 라벨) | Assignment · Thinking · Tool · Result | `progress.stream.*`·`progress.segment.*`가 이미 쓰는 낱말 그대로다 — 같은 것을 두 이름으로 안 부른다 |
 *  | 에픽 | epic | `96327123`(에픽 묶음)가 더한 줄부터 아래. 소문자다 — 화면 제목 자리에서만 첫 글자를 올린다. frontmatter 키 이름(`epic:`)과 같은 낱말이라 갈릴 자리가 없다 |
 *  | 건(에픽 사이드바의 티켓 수) | tickets | 숫자 뒤 꼬리다(`12 tickets`). 지표의 `건`(`found`)과 다른 자리라 낱말을 가른다 — 여기서 세는 것이 티켓이라고 적어야 무엇의 수인지 안다 |
 *  | 실행 비트 · 자가 정리 | exec bit · self-heal | `e3d3b255`(워커 화면 묶음)가 더한 줄부터 아래 |
 *  | 통합 게이트 | dispatch gate | 파일 이름이 `dispatch-gate.sh`다 — 위 `통합 브랜치`(integration branch)와 다른 낱말이니 `integration gate`로 안 부른다 |
 *  | 공통 컨텍스트 · 공통 항목 | common context · common item | 워커 전원이 `source` 하는 그 파일과 그 안의 항목이다 |
 *  | 중단 · 재등록 | Stop · Re-register | crontab 줄 하나를 빼고 넣는 한 쌍이라 낱말도 쌍으로 둔다 |
 *  | crontab 미등록 · 리밋 대기 | not in the crontab · Waiting on limit | 앞엣것은 배지 옆 꼬리라 소문자다(`기본값 가정` 줄이 선 그 벌) |
 *  | 준비 명령 · 결함 | prep commands · defect | 뒤엣것은 표가 워커 하나를 두고 세는 이름이다 |
 *  | 개(항목 수) | listed | 숫자 뒤 꼬리다(`3 listed`). 위 `건`(found) 줄과 같은 사정 — 1도 뜨는데 복수형 장치가 없다 |
 *  | 번째 경로(피커 접근가능 이름) | path | 수가 앞에 오는 자리라 `path 1`로 못 뒤집는다 — `1 path Browse`로 읽힌다 |
 *  | 첨부 · 개(첨부 수) | Attachments · listed | `c92a3ead`(티켓 상세·발행 묶음)가 더한 줄부터 아래. 낱말 하나가 버튼 라벨과 칩 묶음 낭독 이름을 겸하는데 수가 낱말 뒤로 오는 자리라(`Attachments 3 listed`) 버튼도 `Attach`가 아니다. 뒤엣것은 위 `개(항목 수)` 줄과 같은 낱말이다 |
 *  | 요구사항 · 아카이브 대상 | Requirement · Archive target | 티켓이 `req:`·`archives:`로 가리키는 상대다. 앞엣것은 위 `답변` 줄이 말하는 그 요구사항이다 |
 *  | 복제 · 강제 중단 | Duplicate · Force stop | 뒤엣것은 도는 세션을 끊고 티켓을 답변 대기로 잠그는 버튼이다 — 위 `선점` 줄과 달리 사람이 누른다 |
 *  | 표시값 | the value shown here | frontmatter `ticket:`에 적힌 값이다. 엔진이 안 보는 값이라 `hash`로 안 부른다 — 찾는 이름은 파일 이름 하나다 |
 *  | 답변 스레드 · 덧붙일 말 | Answer thread · Anything to add | 뒤엣것은 선택지 옆 자유 입력칸의 자리표시자다 |
 *
 *  **어순이 뒤집히는 자리는 접두·접미 두 키로 쪼갠다.** 한국어는 이름 뒤에 다 붙지만(`<이름>
 *  삭제`) 영어는 동사가 앞에 뜬다(`Delete <name>`) — 한쪽이 비는 것이 정상이고, 조립은
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
  // 공백으로 시작하지 않는다. 조립 결과는 `i18n.test.ts`가 고정한다.
  "settings.search.emptySuffix": ": no matching settings",
  "settings.search.claudeCli": "CLI path",
  "settings.search.claudeAccounts": "Accounts",
  "settings.search.claudeAdd": "Add account",
  "settings.search.statsStatus": "Sending status",
  "settings.search.statsToggle": "Turn on / off",
  "settings.search.multitokenToggle": "Allow multi-account",
  "settings.search.multiplayToggle": "Simultaneous multi-account use",

  "settings.tree.projectGroup": "Project",
  "settings.tree.authGroup": "Authentication",
  "settings.tree.keymap": "Keyboard shortcuts",
  "settings.tree.stats": "Usage stats",
  "settings.tree.categoryGroup": "Setting categories",
  "settings.tree.multiplay": "Multiplaying",
  "settings.tree.webhook": "Webhook",
  "settings.tree.workers": "Workers",

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
    'Paste a token you already have. It joins the list, but the one in use stays the same — pick "Use" in the list to switch.',
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

  "settings.other.agyCred":
    "Credentials sit in the macOS login keychain — there's exactly one entry, so agy runs on a single account. Swapping it would mean moving a worker's whole HOME.",
  "settings.other.codexMissing": "Not found — workers running on OPENAI_API_KEY are outside this check",
  "settings.other.grokMissing": "Not found — run grok login in a terminal",
  "settings.other.notInstalled": "Not installed",

  "settings.other.accounts": "Accounts",
  "settings.other.capture": "Add the terminal's signed-in account",
  "settings.other.captureHint":
    "Sign in to the account you want in a terminal first. This copies that login as-is into the list.",
  "settings.other.captureBlocked":
    "No terminal login here — there's nothing to copy, so the button stays off.",

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

  "settings.multiplay.description":
    "Allow multi-account lets you register more than one account; simultaneous multi-account use splits them across workers to run at the same time. Both apply to claude, codex, and grok — agy is left out, since it only ever has one account.",
  "settings.multitoken.enabled": "Allowed",
  "settings.multitoken.disabled": "Not allowed",
  "settings.multitoken.turnOff": "Turn off",
  "settings.multitoken.turnOn": "Turn on",
  "settings.multiplay.enabled": "Allowed",
  "settings.multiplay.disabled": "Not allowed",
  "settings.multiplay.turnOff": "Turn off",
  "settings.multiplay.turnOn": "Turn on",

  // 언어 이름은 그 언어로 적는다 — 영어 화면에서도 `한국어`가 `Korean`이 되지 않는다.
  "settings.language.ko": "한국어",
  "settings.language.en": "English",

  "settings.webhook.urlLabel": "Address",
  "settings.webhook.urlPlaceholder": "https://",
  "settings.webhook.test": "Send test",
  "settings.webhook.testing": "Sending...",
  "settings.webhook.testOk": "Sent",
  "settings.webhook.testFailPrefix": "Couldn't send",
  "settings.webhook.off": "Not sending",
  "settings.webhook.rejectHttps": "Only https addresses are accepted",

  "settings.workers.allHeading": "All workers",
  "settings.workers.filterCrumb": "Filter",
  "settings.workers.filterProject": "Project",
  "settings.workers.filterStatus": "Status",
  "settings.workers.filterReset": "Clear filters",
  "settings.workers.filteredEmpty": "0 workers match the filter",
  "settings.workers.projectsEmpty": "No registered projects.",

  "sessionCap.limit.invalidPrefix": "Takes an integer of 0 or more:",
  "settings.workers.sessionCapHeading": "Machine-wide session limit",
  "settings.workers.sessionCapLimitLabel": "Limit",
  "settings.workers.sessionCapLimitNone": "None",
  "settings.workers.sessionCapPopoverLabel": "Concurrent session limit",
  "settings.workers.sessionCapPopoverHint": "Empty removes the limit — caps how many claude sessions run at once on this machine.",
  "settings.workers.sessionCapSaveFailedTitle": "Couldn't save the limit",
  "settings.workers.sessionCapWarnUnreadable": "Couldn't read session-limit — reading it as no limit.",
  "settings.workers.sessionCapTotalPrefix": "Machine-wide ",
  "settings.workers.sessionCapTotalSep": "/",
  "settings.workers.sessionCapAtCap": "At the limit — no new sessions can start right now.",

  "common.save": "Save",
  "common.saving": "Saving…",
  "common.add": "Add",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.create": "Create",
  "common.creating": "Creating…",

  // 공개 사이트 언어 토글 — 눌러서 건너갈 언어의 짧은 이름이다. 영어 화면에서 한국어로
  // 건너가는 버튼이라 글자는 `KO`다(`한`은 이 사전에 한글을 들이고, 36x36 버튼에 `한국어`는
  // 길다). `EN` 쪽은 두 사전이 같은 글자를 쓴다.
  "languageToggle.shortKo": "KO",
  "languageToggle.shortEn": "EN",

  "common.openInApp": "Open with default app",
  "common.openInApp.failed": "Couldn't open the file",

  "ticket.priority.label": "Priority",
  // 상속 한 줄. **`inheritedMiddle`이 공백으로 시작하는 것은 의도다** — 앞에 해시가 공백 없이
  // 바로 붙는다(한국어는 `<해시>가`로 조사가 붙어 공백이 없어야 하고, 영어는 낱말이 갈린다).
  // 꼬리는 비었다: 영어는 숫자가 문장 끝이라 뒤에 붙을 것이 없다. `t`는 `""`를 그대로 돌려주고
  // `ko` 폴백으로 안 샌다. 조립 결과는 `i18n.test.ts`가 두 언어 다 고정한다.
  "ticket.priority.inheritedMiddle": " is waiting on this, so it comes up as",
  "ticket.priority.inheritedAfter": "",
  // 다섯 항목의 꼬리. `Later`·`Sooner`는 짝으로 읽힌다 — 목록을 열면 다섯이 한 화면에 뜬다.
  "ticket.priority.level.1": "Only when nothing is running",
  "ticket.priority.level.2": "Later",
  "ticket.priority.level.3": "Default",
  "ticket.priority.level.4": "Sooner",
  "ticket.priority.level.5": "Now — stops a running session",
  "ticket.priority.srOnly": "Priority",

  // 종 ⑦(§0-10 문구 표 ⑦). 제목은 `<접두> <n><접미>`라 숫자가 가운데 끼는데, 영어에서 자연스러운
  // `3 tickets …`는 접두를 비워 문장을 공백으로 시작시킨다 — 그래서 **숫자를 뒤로 보내고 콜론으로
  // 받는다**(`settings.search.emptySuffix`가 콜론으로 연 것과 같은 수). 꼬리는 빈다.
  "bell.due.titlePrefix": "Tickets that won't make their due date:",
  "bell.due.titleSuffix": "",
  "bell.due.body":
    "The due date has passed, or it's close and a ticket they depend on is still unfinished.",
  "bell.due.overdue": "Past due",
  // 나열의 다른 갈래 — `<남은> <중간> <n><접미>`. **접미가 공백으로 시작하는 것은 의도다**(숫자에
  // 바로 붙는 자리다). `2 of its prerequisites`로 적어 **1건일 때도 문장이 뜬다** — 이 앱에 복수형
  // 장치가 없어서(`next-intl` 0개) 숫자 뒤에 복수 명사를 바로 두면 `1 prerequisites`가 뜬다.
  "bell.due.blockedMiddle": "left, but blocked by",
  "bell.due.blockedSuffix": " of its prerequisites",
  "bell.due.openTicket": "Open ticket",

  "ticket.duedate.label": "Due date",
  "ticket.duedate.clear": "Clear",
  // 파생 한 줄. 우선순위 상속 한 줄과 한 줄에 이어 붙으므로 **같은 동사**로 끝낸다
  // (`comes up as`) — 두 조각이 나란히 설 때 서로 다른 말로 같은 것을 말하지 않는다.
  // 꼬리가 빈 이유도 그 줄과 같다: 영어는 숫자가 문장 끝이다.
  "ticket.duedate.derivedPrefix": "Due in",
  "ticket.duedate.derivedMiddle": "— comes up as priority",
  "ticket.duedate.derivedAfter": "",
  "ticket.duedate.underHour": "Under 1h",
  // 역전 거부. 앞에 해시가 공백 없이 바로 붙는다(`ticket.priority.inheritedMiddle`과 같은 사정) —
  // **공백으로 시작하는 것이 의도다.** 마침표는 없다: 한국어 쪽도 없고, 이 줄은 입력 바로 아래
  // 붙는 한 조각이다.
  "ticket.duedate.reversalSuffix":
    " and this due date are out of order — a prerequisite can't be due after the ticket waiting on it",

  // 되돌아온 횟수 한 줄. 영어는 접미가 빈다(`Reassigned: 3`) — 복수형 장치가 없어 숫자로 끝낸다.
  "ticket.retries.linePrefix": "Reassigned:",
  "ticket.retries.lineSuffix": "",

  // 약어로 복수형 문제를 피한다(`bell.due.blockedSuffix`와 같은 사정) — `3h 30m`·`7d`.
  "common.unit.hour": "h",
  "common.unit.minute": "m",
  "common.unit.day": "d",
  "common.unit.second": "s",
  "common.suffix.ago": "ago",
  "common.suffix.remaining": "left",
  "common.suffix.overdue": "past",

  // 셸 둘째 묶음(§0-16 §발행 §묶음 표 2) — `ko`는 `dd97c69c`, 이 영어가 `90be3eeb`다.
  // 셸은 모든 화면 위에 서므로 **여기서 고른 낱말이 다음 묶음 일곱의 어휘가 된다** — 새 낱말은
  // 위 표에 한 줄씩 올려 뒀다.

  "shell.header.manual": "Manual",
  // 배너 제목 — `<접두> "<이름>"<접미>`. 영어는 이름이 문장 끝이라 **꼬리가 빈다**
  // (`bell.due.titleSuffix`와 같은 사정. `t`는 `""`를 그대로 돌려주고 `ko` 폴백으로 안 샌다).
  "shell.error.titlePrefix": "Can't read .dira in project",
  "shell.error.titleSuffix": "",
  "shell.error.refresh": "Check again",
  "shell.nav.projects": "Manage projects",
  "shell.nav.board": "Board",
  "shell.nav.personas": "Personas",
  "shell.nav.protocols": "Protocols",
  "shell.nav.ontology": "Ontology",
  "shell.nav.workers": "Workers",
  "shell.switcher.ariaLabel": "Switch project",
  "shell.switcher.searchPlaceholder": "Search projects — name or path",
  // 0건 문구. 접착제가 쌍따옴표에 바로 붙어 콜론으로 받는다(`settings.search.emptySuffix`가 연
  // 그 수). **꼬리가 대문자로 여는 것은 그 키와 갈리는 지점이다** — 검색어가 없으면 이 조각이
  // 혼자 떠서 문장 전체가 된다.
  "shell.switcher.emptyQueriedGlue": ":",
  "shell.switcher.emptySuffix": "No matching projects",
  "shell.switcher.openLabel": "open",
  "shell.switcher.opening": "Opening",
  "shell.pending.srLabel": "Loading",
  "shell.update.ariaLabel": "Notifications",

  // 알림 종(§0-10 문구 표 · §비주얼 §28). 개수 제목 넷은 전부 `bell.due.titlePrefix`가 연 수를
  // 따른다 — **숫자를 뒤로 보내고 콜론으로 받는다.** 영어에서 `3 tickets …` 어순을 살리려면
  // 접두가 비어야 하고, 그러면 문장이 공백으로 시작한다.
  "bell.trigger.countPrefix": "Notifications:",
  "bell.trigger.countSuffix": "",
  "bell.trigger.empty": "No notifications",
  "bell.markRead": "Archive",
  "bell.archive.toggle": "Archived",
  "bell.archive.empty": "No archived notifications",
  "bell.archive.kindSlept": "Sleep",
  "bell.archive.kindWake": "Off",
  "bell.offline.title": "The network is down",
  "bell.offline.body":
    "Sessions can't open, and every ticket goes back to Open as it happens. It all picks up again on its own once the connection returns.",
  "bell.offline.hint": "Check Wi-Fi or the wired connection.",
  "bell.resume.titlePrefix": "Stretches the queue sat stopped:",
  "bell.resume.titleSuffix": "",
  "bell.resume.body": "Nothing was lost — it's already running again.",
  "bell.resume.noAction": "Nothing to fix.",
  "bell.gate.title": "Uncommitted changes are blocking dispatch",
  "bell.gate.bodySuffix":
    " must be clean before workers pick up any ticket. Nothing is broken - commit or discard the changes and it resumes automatically on the next tick.",
  "bell.gate.action": "Commit in that tree, or delete the changes if you meant to discard them.",
  "bell.gate.actionAllDebris": "This change is all leftovers from a competing push - discarding it loses nothing.",
  "bell.gate.discardButton": "Discard leftovers",
  "bell.gate.discardDoneBody": "Discarded. This item clears once the gate confirms it on the next tick.",
  "bell.gate.discardFailedTitle": "Couldn't discard the leftovers",
  "bell.gate.verdictDebris": "leftover",
  "bell.gate.verdictHandEdited": "hand-edited",
  "bell.auth.title": "No Claude token",
  "bell.auth.body": "Workers still claim tickets, but they can't open a session and end right there.",
  "bell.auth.titleExhausted": "No Claude account is available right now",
  "bell.auth.bodyExhausted":
    "Your saved accounts are still there. You don't need to re-authenticate — they're all exhausted or disabled.",
  "bell.failures.titlePrefix": "Workers that die the moment a session opens:",
  "bell.failures.titleSuffix": "",
  "bell.failures.body": "Each ticket goes back to Open exactly as it was. Nothing is lost.",
  "bell.failures.footer":
    "Once the time in the reason passes they claim again on their own — nothing to fix.",
  "bell.assigned.titlePrefix": "Tickets no one will claim:",
  "bell.assigned.titleSuffix": "",
  "bell.assigned.body":
    "A worker took them and never let go, so the queue skips these when their turn comes.",
  "bell.awaiting.titlePrefix": "Tickets waiting on an answer:",
  "bell.awaiting.titleSuffix": "",
  "bell.awaiting.body":
    "These come back to the queue once a person writes an answer. Nothing is broken.",
  "bell.awaiting.answerLink": "Write an answer",

  "webhook.text": "Awaiting answer: {title} - {project} ({hash})",

  // status bar (§0-8 · §비주얼 §26 §38).
  "statusbar.idle.allRunning": "None — all running",
  "statusbar.idle.none": "None",
  // `idle` 라벨 뒤에 공백 없이 바로 붙는다 — **값 자체가 공백으로 연다**(`idle workers w3 w9`).
  "statusbar.idleSrOnlySuffix": " workers",
  "statusbar.rate.title": "Last 10 minutes · worker sessions in this project",
  "statusbar.rate.suffix": "tokens/min",
  "statusbar.usage.suffix": "used",
  // 시각 **뒤에** 붙는 꼬리다(`· 14:00 reset`) — `settings.tokens.addedSuffix`가 선 그 어순이고,
  // 이 바에 어순을 뒤집을 자리가 없다(칸 마크업은 이 묶음이 안 건드린다).
  "statusbar.reset.suffix": "reset",
  "statusbar.tokens.suffix": "tokens",
  "statusbar.limit.unreadable": "Can't read the limit",
  // 다섯 다 `<엔진 이름이나 경로>: ` 뒤에 붙는다 — 콜론 뒤라 소문자로 연다.
  "statusbar.limit.unknownOriginSuffix": "no known source for its limit",
  "statusbar.limit.noRolloutSuffix": "no rollout file here",
  "statusbar.limit.rateLimitsNullSuffix": "rate_limits.primary and secondary are both null",
  "statusbar.limit.noRateLimitsSuffix": "the latest rollout has no rate_limits",
  "statusbar.limit.noUnifiedHeaderSuffix": "no unified-5h/7d utilization in the response",

  // 상태 배지(§비주얼 §2 · §4-1). 티켓 셋은 위 표가 이미 정했다(`Open`·`In progress`·`Done`) —
  // 토큰의 `Pending`과 갈리는 그 자리다. 넉 자(`running`·`idle`·`stopped`·`stale`)는 두 언어가
  // 같은 글자라 값도 같다.
  "status.label.open": "Open",
  "status.label.blocked": "Blocked",
  "status.label.awaiting": "Awaiting answer",
  "status.label.assigned": "Assigned",
  "status.label.wip": "In progress",
  "status.label.done": "Done",
  "status.label.doneContinued": "Done (continued)",
  "status.label.running": "running",
  "status.label.idle": "idle",
  "status.label.stopped": "stopped",
  "status.label.stale": "stale",
  "status.label.connected": "Connected",
  "status.label.disconnected": "Disconnected",
  "status.label.polling": "Polling",
  "status.label.pollingOverdue": "Deadline passed",

  // `kind:` 넉 자 — ko와 같은 자리(위 참고).
  "kind.label.work": "Work",
  "kind.label.request": "Request",
  "kind.label.feedback": "Feedback",
  "kind.label.answer": "Answer",

  "progress.plan.pending": "Not started",
  "progress.plan.cancelled": "Cancelled",
  "progress.plan.doing": "In progress",
  "progress.plan.done": "Done",

  "progress.plan.ratioLabel": "Plan",

  "progress.segment.assign": "Assignment",
  "progress.segment.wrapup": "Wrap-up",

  "progress.stream.error": "Error",

  "progress.stream.stateLive": "Running",
  "progress.stream.stateDone": "Done",
  "progress.stream.elapsed": "Elapsed",
  "progress.stream.tools": "Tools",
  "progress.stream.searchPlaceholder": "Search this record",
  "progress.stream.filter": "Filter",
  "progress.stream.filterTalk": "Messages",
  "progress.stream.filterTool": "Tools",
  "progress.stream.filterThinking": "Thinking",
  "progress.stream.filterPrompt": "Prompts",
  "progress.stream.noMatch": "No matching records",
  "progress.stream.pickRow": "Pick a row to see its input and result",
  "progress.stream.input": "Input",
  "progress.stream.result": "Result",
  "progress.stream.copy": "Copy",
  "progress.stream.closeDetail": "Close detail",
  "progress.stream.markdown": "Markdown",

  "progress.stream.expand": "Expand",

  "board.epic.label": "Epics",
  "board.epic.all": "All",
  "board.epic.none": "(No epic)",
  "board.epic.noTitle": "No title",
  "board.epic.memory": "memory",
  "board.epic.dropPrompt": "Drop on an epic",
  "board.epic.dropOnEpic": "Move to this epic",
  "board.epic.dropRemove": "Remove from epic",
  "board.epic.collapse": "Collapse epic list",
  "board.epic.expand": "Expand epic list",
  "board.epic.create": "Create epic",
  "board.epic.createDesc": "Title is the first line of README.md, key is the ticket's epic: value.",
  "board.epic.createTitleLabel": "Title",
  "board.epic.createKeyLabel": "Key",
  "board.epic.createFailed": "Couldn't create the epic",
  "board.lane.dropToStart": "Drop to start now",
  "board.lane.dropToUnassign": "Drop to unassign",
  // 커밋 안 한 변경을 다루는 가운데 문장은 `ticketDetail.forceStopDescSuffix`와 글자까지 같다 —
  // ko가 같은 문장이라 en도 갈리면 안 된다. `awaiting answer`도 그 선례의 낱말 그대로다.
  "board.lane.preemptTitle": "This stops one running session and starts the ticket you dropped",
  "board.lane.preemptDesc":
    "That ticket won't lock as awaiting answer — it goes back to Open and gets dispatched again. Uncommitted changes in the worktree stay where they are. The freed worker then picks up the ticket you just dropped.",
  "board.lane.preemptConfirm": "Stop and start",
  "board.lane.noVictim":
    "Can't start now — there are no running tickets, or all of them are effective priority 5, so there's nothing to interrupt.",
  "epics.empty": "No epics",
  "epics.viewInBoard": "View in board",
  "epics.readme.missingBadge": "No README",
  "epics.readme.hint": "Add text after the first line to show it here.",
  "epics.readme.edit": "Edit",
  "epics.readme.editDesc": "The title is the first line of README.md and the body is what follows; saving overwrites the file.",
  "epics.readme.bodyLabel": "Body",
  "epics.readme.saveFailed": "Couldn't save",
  // 에픽 화면(§에픽 §결정 6) - 잘못된 P번호로 들어온 자리라 페르소나 화면과 같은 Alert고,
  // 문장도 `persona.route.notFound`와 같다(화면마다 자기 키를 들 뿐이다). 메모리 절도 같은
  // 부품의 두 벌이라 `persona.memory.*`의 문장을 그대로 쓴다 - 같은 것을 두 이름으로 안 부른다.
  "epics.route.notFound": "This path can't be opened",
  "epics.readme.missing": "There's no README.md.",
  "epics.memory.heading": "Memory",
  "epics.memory.emptyHint": "No memory yet — it piles up here as sessions leave notes in their retrospectives.",
  "epics.memory.deleteFailedTitle": "Couldn't delete the memory",
  "epics.memory.deleteFailedFallback": "Couldn't delete the memory.",
  "epics.memory.deleting": "Deleting…",
  "epics.memory.delete": "Delete",
  "epics.memory.deleteDialogTitlePrefix": "Delete memory —",
  "epics.memory.deleteDialogBodySuffix":
    "will be deleted. This can't be undone — this screen has no edit and no add. From the next dispatch on, a session can't find this concept.",
  // 수 뒤에 바로 붙는 꼬리라 앞 공백을 값이 든다. 복수형 장치가 없어 늘 복수다
  // (`persona.delete.refsWarnSuffix`가 선 그 벌).
  "epicSidebar.unit.count": " tickets",
  // 배지의 `title`이라 마침표로 안 닫는다(`ko`도 같다).
  "status.hint.awaiting":
    "The PM asked something back — write an answer on the request page and it returns to the queue. It never expires on its own",
  "status.hint.assigned":
    "An open ticket with a session_id in it — the queue skips it for good. Unassign puts it back",
  "status.hint.pollingOverdue": "The polling deadline has passed — the next tick locks it as awaiting answer",

  // deps 배지(§2 deps 배지).
  "dep.hint.met": "Met — that ticket is done",
  "dep.hint.unmet": "Unmet — not done yet",
  "dep.hint.missing": "No such hash in the queue — waits forever",
  "dep.hint.answer": "Answer on record — the answer to this request",

  // Ticket detail "Polling" section (§폴링 대기 결정 9).
  "polling.section.title": "Polling",
  "polling.field.reason": "Reason",
  "polling.field.script": "Script",
  "polling.field.scriptBody": "Script body",
  "polling.field.interval": "Interval",
  "polling.interval.everyTick": "Every tick",
  "polling.field.until": "Deadline",
  "polling.field.polledAt": "Last polled",
  "polling.polledAt.never": "Not run yet",
  "polling.field.logTail": "Last output",
  "polling.scriptBody.missing": "Script file not found",
  "polling.logTail.missing": "No output yet",
  // Handles that break the wait before the deadline (§폴링 대기 §개정 3) — no confirm dialog.
  "polling.action.dispatchNow": "Dispatch now",
  "polling.action.dispatching": "Dispatching…",
  "polling.action.extendUntil": "Extend deadline",
  "polling.action.extending": "Extending…",
  "polling.until.saved": "Applied.",
  "polling.control.notPolling": "This ticket isn't currently polling.",
  "polling.control.badUntil": "Can't read that deadline.",
  "polling.control.pastUntil": "The deadline must be later than now.",

  "board.column.epic": "Epic",

  // Worker defect #4 (§0-21 decision 2, ticket b60520ea).
  "worker.defect.noExec.title": "No exec bit",
  "worker.defect.noExec.why":
    "cron can't start it — Permission denied. tick.sh never runs, so runner.log never gains a line and open tickets just sit there.",
  // `cwdDefects`의 `detail`(티켓 `d64fa06f`) — 조립은 `${file} ${detailSuffix}`라 영어도 파일
  // 경로가 먼저 온다. 조각 하나로 충분한 자리다.
  "worker.defect.noExec.detailSuffix": "has no exec bit.",

  // 프로토콜 화면(§0-16 §발행 §묶음 표 7, `7a86fd5c`) — `ko`는 `93c106b3`이 넣었다. 어순이
  // 뒤집혀 조각의 몫이 갈린 자리는 그 자리마다 주석을 달았고, 조립 결과는 `i18n.test.ts`가
  // 두 언어 다 고정한다.
  "protocols.inline.tooltip": "tick.sh pastes this file in full at the top of every session prompt",
  // 뒤에 `{budgetLabel(...)}`가 공백 하나를 사이에 두고 붙는다(`1,234 / 6,500 B`).
  "protocols.inline.badge": "Inlined in every prompt ·",

  "protocols.new.title": "New file",
  "protocols.new.descPrefix": "A path relative to the protocols directory.",
  "protocols.new.descSuffix":
    " creates any subdirectories along the way. The file starts empty and the editor opens on it right away.",
  "protocols.new.pathLabel": "Path",
  // 한국어는 경로가 문장 끝에 서지만 영어는 동사가 앞이라 조각의 몫이 갈린다 — 접두가
  // 문장을 다 지고 접미는 괄호를 닫는다(`... directory (../ · absolute).`).
  "protocols.new.pathHintPrefix": "The server rejects paths that leave the directory (",
  "protocols.new.pathHintSuffix": "· absolute).",
  "protocols.new.failTitle": "Couldn't create the file",

  "protocols.readWhenNeeded": "Read when a session needs it",
  // 글자 수 뒤에 붙는다 — 한국어는 공백이 없고(`123자`) 영어는 하나 있다(`123 chars`).
  "protocols.charSuffix": " chars",
  "protocols.editor.inlinedHintPrefix": "This file goes into every session prompt in full —",
  "protocols.editor.inlinedHintSuffix":
    " pastes it at the top. Length is what every session costs. Move the detailed rules into another file in the same directory and point at it here, and a session reads them only when it needs them.",
  "protocols.editor.saveFailTitle": "Couldn't save",
  "protocols.editor.revert": "Revert",
  "protocols.editor.saved": "Saved.",

  "protocols.rename.trigger": "Rename",
  "protocols.rename.dialogTitlePrefix": "Rename —",
  "protocols.rename.desc":
    "Change the relative path and the file moves into a subdirectory too. If that name already exists the rename is refused — nothing gets overwritten quietly.",
  "protocols.rename.pathLabel": "New path",
  "protocols.rename.agentsWarnTitle": "Rename it and it drops out of the prompt",
  "protocols.rename.agentsWarnPrefix": "tick.sh reads only the name",
  "protocols.rename.agentsWarnSuffix":
    ". Under any other name a session starts with no collaboration protocol — no error, no warning.",
  "protocols.rename.failTitle": "Couldn't rename",
  "protocols.rename.working": "Renaming…",

  "protocols.delete.trigger": "Delete",
  "protocols.delete.dialogTitle": "Delete file",
  // 파일 이름 뒤에 바로 붙는다 — 한국어는 조사가 붙고(`handoff.md를`) 영어는 공백이 하나 있다.
  "protocols.delete.descSuffix": " will be deleted. This can't be undone.",
  "protocols.delete.agentsWarnTitle": "Every session will start with no collaboration protocol",
  "protocols.delete.agentsWarnBody":
    "tick.sh just moves on when the file isn't there — no error, no warning. The project keeps running; only the sessions won't know the rules.",
  "protocols.delete.failTitle": "Couldn't delete",
  "protocols.delete.working": "Deleting…",

  "protocols.sidebar.collapse": "Collapse the file list",
  "protocols.sidebar.expand": "Expand the file list",
  "protocols.sidebar.ariaLabel": "Protocol files",
  "protocols.usingDefault": "assumed default",
  // 변수(`TICKET_PROTOCOLS`) 앞이 동사라, 한국어가 접미에 둔 `읽지 못해`가 영어에서는 접두로
  // 올라온다. 가운데 조각은 공백으로 연다 — 변수와 바로 맞닿는다.
  "protocols.default.hintPrefix": "Couldn't read",
  "protocols.default.hintMiddle": " from the worker file, so this screen assumes the engine default (",
  "protocols.default.rootPath": "<root>/protocols",
  "protocols.default.hintSuffix": "). Point the worker at another path and this screen follows it.",
  "protocols.empty.title": "No files",
  "protocols.empty.bodyPrefix": "This project runs even with no protocols —",
  "protocols.empty.bodyMiddle": " just moves on when there's no",
  "protocols.empty.bodySuffix":
    ". A session only starts without knowing the collaboration rules — how each ticket kind is handled, how to hand off, how to report.",
  "protocols.rejected.title": "Can't open this path",
  "protocols.core.notFoundPrefix": "Not a file in the core protocol:",
  "protocols.picker.expanded": "Pick a file.",
  "protocols.picker.collapsed": "Expand the file list and pick a file.",
  "protocols.core.vendoredPrefix": "This file is the core copy vendored into this queue —",
  "protocols.core.notVendoredPrefix": "This file lives in the engine repo, not in the queue —",
  // 굵게 뜨는 조각이 `every project`라, 한국어가 접미에 둔 `모든 세션 프롬프트 맨 앞에`가
  // 영어에서는 가운데로 올라오고 접미에는 마침표만 남는다.
  "protocols.core.inlinedMiddle": " pastes it in full at the top of every session prompt in",
  "protocols.core.inlinedAllProjects": "every project",
  "protocols.core.inlinedSuffix": ".",
  "protocols.core.notInlinedSuffix":
    " points at it and a session reads it when it needs it (it isn't inlined into the prompt).",
  "protocols.core.readOnlyNote": "Read-only here (this screen edits the project layer).",
  // textarea aria-label — `wrap(file.name, ..., "")`가 공백 하나로 잇는다(`CORE.md source`).
  "protocols.core.rawLabelSuffix": "source",

  "protocols.action.unknownProjectPrefix": "Not a registered project:",

  // lib/protocols.ts — fs 검증 사유. 뒤에 붙는 이름·경로·바이트 수는 값이라 안 건드린다.
  "protocols.lib.coreReadFailPrefix": "Couldn't read the core protocol —",
  "protocols.lib.coreEmptyPrefix": "No core protocol —",
  "protocols.lib.isDirectory": "This is a directory.",
  // 바이트 수 뒤에 바로 붙는다 — 한국어와 달리 공백이 하나 있다(`2000000 bytes — ...`).
  "protocols.lib.tooLargeSuffix": " bytes — over 1MB, so the editor won't open it.",
  "protocols.lib.notText": "Not a text file (NUL bytes) — can't edit it.",
  "protocols.lib.missingPrefix": "No such file (it may have been deleted):",
  "protocols.lib.notRegularPrefix": "Not a regular file:",
  "protocols.lib.staleConflict": "Something else changed this file in the meantime — reload it, then save again.",
  "protocols.lib.nameRequired": "Enter a file name.",
  "protocols.lib.dirNoDeletePrefix": "This screen doesn't delete directories:",
  "protocols.lib.newNameRequired": "Enter the new name.",
  "protocols.lib.dirNoMovePrefix": "This screen doesn't move directories:",

  // 화면 이행 셋째 묶음 - 페르소나 갈래(§0-16 §발행 §묶음 표 행 7). `204be4da`가 넣은 `ko`의 짝이고
  // 조각을 쪼갠 자리는 그쪽이 정한 그대로다 - 여기서 갈리는 것은 **어느 조각이 무엇을 지느냐**뿐이다
  // (한국어는 이름 뒤에 붙고 영어는 동사가 앞에 뜬다).

  // actions.ts · lib/skills.ts - 서버 액션-모듈 함수라 `t("ko", ...)`로 고정해 부르는 벽이다.
  // 지금은 화면에 한국어로 뜨지만 사전은 타고 있다 - 벽이 걷히는 날 이 줄들이 그대로 뜬다.
  "persona.error.unknownProjectPrefix": "Not a registered project:",
  "persona.error.squadNameTakenPrefix": "That squad name is taken:",
  "persona.error.personaNameTakenPrefix": "That persona name is taken:",
  "persona.skill.fileCountMismatchPrefix": "Files and paths don't match in count:",
  "persona.skill.installFailedTitle": "Couldn't install the skill",
  "persona.limit.invalidPrefix": "The limit has to be an integer of 0 or more:",
  "persona.skill.installMissingSkillMd": "No SKILL.md directly inside the folder you picked",
  "persona.skill.installBadPathPrefix": "Not a valid path:",
  "persona.skill.installNoName":
    "The file you picked has no name in its frontmatter — name is the directory it installs into",
  "persona.skill.installBadName":
    "That name can't be a directory name — it starts with a letter or digit, holds only letters, digits and . _ -, and stops at 64 characters",
  "persona.skill.installNameConflict":
    "A skill by this name is already on this machine — nothing gets overwritten. Delete it or change name, then pick again",
  "persona.skill.unzipFailed": "Couldn't unpack this file — a .skill has to be a zip",
  "persona.skill.subtreeNotFound": "That repo has no folder at this address — check the branch and the path",
  "persona.skill.skillMdNotFound":
    "No SKILL.md inside the .skill — it belongs at the top level, or directly inside one folder",
  "persona.skill.badAddress": "Can't fetch from this address — paste a GitHub repo, or a folder inside one",
  "persona.skill.tooLarge":
    "Stopped — the download went past the size limit. This pulls the whole repo, so grab a big one yourself and install it from a file",
  "persona.skill.fetchFailed": "Couldn't fetch from that address — check the address, and that the repo is public",
  "persona.skill.badNamePrefix": "Characters a skill name can't hold:",
  "persona.engine.customPrefix": "This engine file holds custom arguments:",
  "persona.engine.writeVerifyFailed": "Reading the block back gives a different value. Nothing was written.",
  "persona.memory.notInListPrefix": "No such memory file in the list:",

  // 페르소나 화면 - `[[...persona]]/page.tsx`.
  "persona.dir.label": "Directory",
  "persona.dir.defaultTitle": "Couldn't find TICKET_PERSONAS in the worker file, so this uses the default",
  "persona.dir.defaultBadge": "assumed default",
  "persona.missing.title": "Some personas have no profile file",
  // 세 경고가 `<WARN>` 뒤에서 갈라진다 - 한국어는 `만 남기고`가 조각 하나로 셋을 다 받지만,
  // 영어는 동사(`dispatches`)가 이 조각으로 올라와야 세 문장이 다 뜬다. 그래서 값이 공백으로 연다.
  "persona.missing.enginePrefix": "When the engine meets this name it leaves a",
  "persona.warn.engineSuffix": " and nothing else, then dispatches",
  "persona.wording.withoutPersona": "without a persona",
  "persona.missing.dispatchDetail":
    "— dispatch doesn't fail, the session just starts without knowing its role or permissions. Pick that name on the left, fill the empty body on the right, save, and the file gets created.",
  "persona.missing.noSkillsMemory":
    "No profile means no skills and no memory either — both blocks live inside the persona prompt.",
  "persona.missing.refsMiddle": "— referenced by",
  "persona.missing.refsSuffix": " tickets ·",
  "persona.squadWarn.title": "Some tickets point at a squad that doesn't exist",
  "persona.squadWarn.enginePrefix": "When the engine meets this value it leaves a",
  "persona.squadWarn.strongLabel": "down the old path",
  "persona.squadWarn.parenPrefix": " (the persona: value if the ticket has one, otherwise",
  "persona.squadWarn.parenSuffix": ").",
  "persona.empty.title": "No personas",

  // 페르소나 화면 - `personas-ui.tsx`.
  "persona.word.squad": "Squads",
  // ko 정본은 요구가 부른 낱말 그대로다(§5-5 §개정 - 모아보기 토글) — 이 한 낱말은 버튼
  // 라벨이라 developer가 직접 채운다(writer 산문 경계 밖, PROFILE §권한).
  "persona.squad.collapseToggle": "Group view",
  "persona.word.skills": "Skills",
  "persona.word.memory": "Memory",
  "persona.word.limit": "Limit",
  "persona.word.members": "Members",
  "persona.squad.unassignedGroup": "No squad",
  "persona.squad.toggleMembersSuffix": "member list",
  "persona.action.delete": "Delete",
  // `persona.squad.block*` 세 키는 `50fd4b34`가 사전에서 걷어냈다 - `squadBlockBytes`
  // (`lib/budgets.ts`)가 tick.sh:736-788의 리터럴을 직접 센다(ko 쪽 주석과 같은 이유).
  "persona.refs.openPrefix": "Open",
  // 뒤에 `Open 2 · In progress 1`이 `wrap`으로 붙는다 - 숫자를 콜론 뒤로 보내는 셸 묶음의 그 벌이다.
  "persona.refs.ticketPrefix": "Tickets:",
  "persona.refs.none": "No tickets reference it",
  "persona.color.saveFailedMessage": "Couldn't save the color.",
  "persona.color.saveFailedTitle": "Couldn't save the color",
  "persona.color.labelPrefix": "Color:",
  "persona.color.none": "No color",
  "persona.create.personaTitle": "New persona",
  "persona.create.squadTitle": "New squad",
  "persona.create.personaDescPrefix": "A ticket's",
  "persona.create.personaDescSuffix":
    "value is the directory name. The profile body is inlined at the top of the session prompt.",
  "persona.create.squadDescPrefix":
    "Groups personas that have a profile. A ticket filed against the squad goes only to the first name in the members file — that member doesn't do the work themselves, they decide who will and open a new ticket for that person. That name becomes a ticket's",
  "persona.create.squadDescSuffix": "value.",
  "persona.create.kindLabel": "Kind",
  "persona.create.nameLabel": "Name",
  "persona.create.nameHintPrefix": "Letters, digits, _ and -.",
  "persona.create.nameHintPersonaFile": "The file becomes <personas>/<name>/PROFILE.md",
  "persona.create.nameHintSquadFile": "The file becomes <squads>/<name>/members",
  "persona.create.nameHintSuffix": ". Personas and squads share one namespace — a collision is rejected",
  "persona.create.personaFailTitle": "Couldn't create the persona",
  "persona.create.squadFailTitle": "Couldn't create the squad",
  "persona.badge.noProfile": "No profile",
  "persona.badge.unsaved": "Unsaved",
  "persona.badge.squadNoProfile": "Member has no profile",
  "persona.tab.activity": "Activity",
  "persona.tab.profile": "Profile",
  "persona.head.runningSessionsPrefix": "Running",
  "persona.head.closedSuffix": "closed",
  "persona.head.squadPrefix": "Squad",
  "persona.activity.nowHeading": "Now",
  "persona.activity.waitingHeading": "Waiting on",
  "persona.activity.recentHeading": "Recent",
  "persona.activity.recentBoardLink": "View on board",
  "persona.activity.thirtyDayHeading": "Last 30 days",
  "persona.activity.nowEmpty": "No tickets running now",
  "persona.activity.recentEmpty": "No tickets closed yet",
  "persona.activity.blocked": "Blocked",
  "persona.activity.closedLabel": "Closed:",
  "persona.activity.closedUnit": "",
  "persona.activity.durationLabel": "Median duration:",
  "persona.activity.reassignLabel": "Reassigned:",
  "persona.activity.reassignUnit": "",
  "persona.activity.issuedLabel": "Issued:",
  "persona.route.notFound": "This path can't be opened",
  "persona.action.saveFailedTitle": "Couldn't save",
  "persona.action.savedNotice": "Saved.",
  "persona.action.deleteFailedTitle": "Couldn't delete",
  "persona.action.deleteFailedMessage": "Couldn't delete.",
  "persona.action.remove": "Remove",
  "persona.squad.rulesHeading": "Rules",
  "persona.squad.rulesBadgeTitle": "Only a session running as leader gets this file in full in its prompt",
  "persona.squad.rulesBadgePrefix": "Inlined in the leader prompt ·",
  "persona.squad.rulesHint":
    "This rides only in the leader session's prompt. Leave it empty and the leader sees member names and their roles, nothing more.",
  "persona.squad.membersHeading": "Members",
  "persona.squad.membersBadgeTitle":
    "Members of this squad get this block in their prompt even when the ticket names no squad",
  "persona.squad.membersBadgePrefix": "Inlined in every member's prompt ·",
  "persona.squad.overBudgetSuffix": "over",
  "persona.squad.noEligible": "No persona has a profile yet — create a persona first.",
  // aria-label이 `<이름>`에 공백 없이 붙는다(`alice's role`).
  "persona.squad.roleAriaSuffix": "'s role",
  "persona.squad.openPersonaAriaSuffix": "open",
  "persona.squad.leaderBadge": "Leader",
  "persona.squad.roleHint": "Leave a role empty and the first line of that persona's profile becomes the role.",
  "persona.squad.emptyRoster": "No members yet — press Add",
  "persona.squad.addSearchPlaceholder": "Search names",
  "persona.squad.addSearchEmpty": "No name left to pick",
  "persona.squad.addSearchZeroMatch": "0 names match",
  "persona.squad.notInSquadHeading": "Not in this squad",
  "persona.squad.noLeader": "No leader",
  "persona.squad.leaderRemoveConfirmTitlePrefix": "Remove leader —",
  "persona.squad.leaderRemoveConfirmBody": "That name leaves this squad.",
  "persona.squad.leaderRemoveConfirmBodyRole": "The role text is cleared too.",
  "persona.squad.leaderRemoveConfirmBodyUndo": "Skip saving to undo it.",
  "persona.squad.announceAdded": "added to members",
  "persona.squad.announceRemoved": "removed from squad",
  "persona.squad.announceLeader": "is leader",
  "persona.squadDelete.titlePrefix": "Delete squad —",
  "persona.squadDelete.bodyMiddle":
    "will be deleted, directory and all. This can't be undone. On tickets that point at this squad, the",
  "persona.squadDelete.bodyAfter": "value stays as it is.",
  "persona.policy.heading": "Dispatch policy",
  "persona.policy.nextTicketHint": "This takes effect from the next ticket picked.",
  "persona.limit.saveFailed": "Couldn't save the limit.",
  "persona.limit.saveFailedTitle": "Couldn't save the limit",
  "persona.limit.none": "None",
  "persona.limit.popoverLabel": "Concurrent worker limit",
  "persona.limit.popoverHint": "Empty means no limit · 0 stops dispatch",
  "persona.engine.label": "Engine",
  "persona.engine.unset": "Not set",
  "persona.engine.modelLabel": "Model",
  "persona.engine.noModel": "No model",
  // `MODEL_RE`가 `…`를 안 받아 모델 이름과 겹칠 수 없다 - 한국어가 한글로 얻던 것을 여기서는
  // 말줄임표가 준다(`ko`의 `직접 입력…`과 같은 장치).
  "persona.engine.customOption": "Type one in…",
  "persona.engine.customModelAriaLabel": "Type in a model name",
  "persona.engine.modelNamePlaceholder": "Model name",
  "persona.engine.modelBadHint": "No spaces, no quotes — one token, the model name",
  "persona.engine.modelPassthroughHint": "Passed to the engine as-is — one token, no spaces, no quotes",
  // 없는 기능을 이어 붙이는 자리 - 값이 둘 이상일 때만 사이에 뜬다(`join`).
  "persona.engine.missingJoiner": " and ",
  "persona.engine.missingMiddle": "workers have no",
  "persona.engine.missingSuffix": " — running tickets is the same.",
  "persona.engine.saveFailed": "Couldn't save the engine.",
  "persona.engine.saveFailedTitle": "Couldn't save the engine",
  "persona.engine.unsetAction": "Clear",
  "persona.engine.overwriteTitlePrefix": "This overwrites a custom engine value —",
  "persona.engine.overwriteBodyPrefix": "The engine file currently holds arguments outside the catalog:",
  "persona.engine.overwriteBodySuffix": "Save here and they go away, replaced by what you picked.",
  "persona.engine.overwriteConfirm": "Save anyway",
  "persona.skill.saveFailed": "Couldn't save the skills.",
  "persona.skill.saveFailedTitle": "Couldn't save the skills",
  "persona.skill.removingAction": "Removing…",
  "persona.skill.emptyNone": "No skills picked — the dispatch prompt carries no skills section.",
  "persona.skill.emptyAllOff": "No skills turned on — the dispatch prompt carries no skills section.",
  "persona.skill.claudeOnlyHint":
    "Skills ride on the claude engine only — when a codex worker claims the ticket, this section never reaches the prompt.",
  "persona.skill.turningOff": "Turning off…",
  "persona.skill.turnOff": "Turn off",
  "persona.skill.offHeading": "Off",
  "persona.skill.turningOn": "Turning on…",
  "persona.skill.turnOn": "Turn on",
  "persona.memory.empty": "No memory yet — it piles up here as sessions leave notes in their retrospectives.",
  "persona.memory.deleteFailedTitle": "Couldn't delete the memory",
  "persona.memory.deleteFailedMessage": "Couldn't delete the memory.",
  "persona.memory.deletingAction": "Deleting…",
  "persona.memory.deleteTitlePrefix": "Delete memory —",
  "persona.memory.deleteBodyAfterPath":
    "will be deleted. This can't be undone — this screen has no edit and no add. From the next dispatch on, a session can't find this concept.",
  "persona.skill.multiDropRejected":
    "One skill installs at a time — you dropped more than one top-level item. Drop just one",
  "persona.skill.countSuffix": " items",
  "persona.skill.addHeading": "Add skills",
  "persona.skill.addDialogDesc":
    "Skills installed on this machine. What you pick rides in this persona's dispatch prompt.",
  "persona.skill.searchPlaceholder": "Search skills — name or description",
  // 앞에 `"질의"`가 그대로 붙는다 - 설정 검색이 선 그 벌이다.
  "persona.skill.searchEmptySuffix": ": no matching skills",
  "persona.skill.notOnMachineHeading": "Not on this machine",
  "persona.skill.orphanNote": "Not in the installed list — it may have been picked on another machine",
  "persona.skill.installedHeading": "Installed skills",
  "persona.skill.noneOnMachine": "No skills found on this machine",
  "persona.skill.configDirHint": "With no CLAUDE_CONFIG_DIR, <config> is ~/.claude",
  "persona.skill.installFromBelow": "Pick a file below to install one now",
  "persona.skill.dropToInstall": "Drop to install",
  "persona.skill.fetchingAddress": "Fetching from the address — up to 30 seconds",
  "persona.skill.dropHint": "Not in the list? Drag a folder onto this window, or pick a file to install",
  "persona.skill.installing": "Installing…",
  "persona.skill.browse": "Browse",
  "persona.skill.addressAriaLabel": "Skill address",
  "persona.skill.installAction": "Install",
  "persona.delete.titlePrefix": "Delete persona —",
  "persona.delete.bodyAfterPath": "will be deleted, files and all. This can't be undone.",
  // 한국어는 수가 앞에 뜨고(`티켓이 3건`) 영어는 뒤에 뜬다 - 조각의 몫이 갈릴 뿐 자리는 같다.
  "persona.delete.refsWarnPrefix": "This persona is referenced by",
  "persona.delete.refsWarnSuffix": " tickets",
  "persona.delete.refsWipPrefix": "(in progress:",
  "persona.delete.refsWipSuffix": ")",
  "persona.delete.refsBody": "Tickets aren't deleted. With the profile gone the engine leaves a",
  "persona.delete.dispatchDetail": "— the session starts without knowing its role or permissions.",

  // `c9f2eec5` 묶음의 나머지는 `90db2822`가 채운다 — 이 한 줄만 `50fd4b34`가 먼저 채웠다
  // (ko 쪽 주석과 같은 이유, `budgetLabel`의 en 회귀).
  "budgets.overSuffix": " over",

  // 공용 lib 셋(`50fd4b34`) — ko와 같은 자리, 위 주석 참고.
  "urls.feature.interject": "Interject",
  "urls.feature.stream": "Session stream",
  "workers.engineHint.prefix": "Not set — uses the engine of whichever worker claims the ticket",
  "workers.engineHint.allPrefix": "currently all ",
  "workers.engineHint.nowPrefix": "currently ",

  // lib/workers.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 4c195255). 조각 키의 앞뒤 공백과
  // 마침표는 `ko`와 짝이 아니라 **영어 조립 결과**에 맞춘다 — 변수가 앞에 오는 자리(`${arr}`·
  // `${name}.sh`)는 조사가 없는 영어라 이어지는 조각이 서술어로 시작한다.
  "workers.context.blockMissingSuffix": "=( … ) block not found",
  "workers.context.multiAssignMid": "has ",
  "workers.context.multiAssignSuffix": " assignments — the GUI won't decide which one takes effect",
  "workers.context.appendAssign": "`+=` append assignment",
  "workers.context.noClosingParen": "No closing `)`",
  "workers.context.commentInBlock": "There's a comment inside the block",
  "workers.context.unreadableEntryPrefix": "Can't read this as an entry:",
  "workers.context.commandSubInEntryPrefix": "An entry has a command substitution $( ):",
  "workers.context.dollarInSingleQuotePrefix": "A $ sits inside single quotes:",
  "workers.context.emptyPath": "An entry has an empty path.",
  "workers.context.pipeInPathPrefix": "A path can't contain | (the engine reads the first | as the description separator):",
  "workers.context.pathLabel": "Path",
  "workers.context.descLabel": "Description",
  "workers.context.forbiddenCharsSuffix": ' can\'t contain " ` \\ or a newline:',
  "workers.context.commandSubFieldSuffix": " can't contain a command substitution $( ):",
  "workers.context.sameWorker": "Source and target are the same worker.",
  "workers.context.copyReadFailMid": ": couldn't read its TICKET_CONTEXT block:",
  "workers.context.rewriteMismatchPrefix": "Reading the block back after writing gives different entries (",
  "workers.context.rewriteMismatchContentDiff": "content mismatch",
  "workers.context.rewriteMismatchSuffix": "). Nothing was written.",
  "workers.context.cantSafelyEditMid": ": the GUI can't safely edit its TICKET_CONTEXT block:",
  "workers.context.editByHandSuffix": ". Edit the file by hand.",
  "workers.context.commonReadFailMid": ": read failed:",
  "workers.context.commonEditMid1": ": the GUI can't safely edit the ",
  "workers.context.commonEditMid2": " block:",
  "workers.context.sourceLineCantPlaceMid": ": the GUI can't tell where the source line goes:",
  "workers.context.lineChangedAfterInsert": "The file doesn't match what was expected after the line went in. Nothing was written.",

  "workers.engine.unknownEnginePrefix": "Unknown engine:",
  "workers.engine.invalidModelCharsPrefix": "The model name has characters that aren't allowed (letters, digits, . _ : / - only):",
  "workers.engine.noWorkerFileLine": "No `. <repo>/tick.sh` line — this file isn't a worker.",

  "workers.crontab.readTimedOut":
    "crontab -l didn't answer within 10 seconds, so it was stopped. Try running it in a shell yourself.",
  // macOS 권한 창의 문구는 인용하지 않는다 — 시스템 언어에 따라 글자가 갈린다. 사람이 찾을 수
  // 있는 것은 [Allow] 버튼과 설정 경로 둘이고, 그 둘만 적는다.
  "workers.crontab.writeTimedOut":
    "crontab - didn't answer within 3 minutes, so it was stopped. A macOS permission dialog may be waiting for an answer — if a window is asking to let this app administer your computer, click [Allow] and try again. You can also turn it on ahead of time in System Settings > Privacy & Security > App Management.",
  "workers.crontab.readFailPrefix": "crontab -l failed:",
  "workers.crontab.permissionDenied":
    "Writing to crontab failed: this app doesn't have the 'App Management' permission — either [Don't Allow] was clicked in the approval dialog, or it was denied earlier. Turn this app on (dira, or the terminal that launched the GUI) in System Settings > Privacy & Security > App Management, then try again.",
  "workers.crontab.otherFailPrefix": "crontab - failed:",
  "workers.crontab.registerMismatch":
    "The line went into crontab but isn't there when read back (this environment may be blocking the write silently).",
  "workers.crontab.unregisterMismatch": "The line came out of crontab but is still there when read back.",

  "workers.dispatchGate.branchUnreadable":
    "Couldn't read this project's integration branch from protocols/AGENTS.md — edit the file by hand.",
  "workers.integrationBranch.invalidPrefix": "Integration branch names take letters, digits, ., _, / and - only:",
  "workers.dispatchGate.noSourceLineMid":
    " has no `. <repo>/tick.sh` line, so the GUI can't tell where the dispatch gate goes. Edit the file by hand.",

  "workers.selfHeal.noSourceLineMid":
    " has no `. <repo>/tick.sh` line, so the GUI can't tell where the self-heal step goes. Edit the file by hand.",
  "workers.selfHeal.enginePathMid": ": can't expand its engine path without a shell:",

  "workers.worktree.notGitRepoSuffix": "isn't a git repo. That's fine if this setup doesn't use worktrees.",
  "workers.worktree.addFailedPrefix": "git worktree add failed:",
  "workers.worktree.symlinkExistsSuffix": "already exists. It was left alone — someone's work may be inside it.",
  "workers.worktree.symlinkFailedPrefix": "Couldn't create the symlink:",
  "workers.worktree.wrongResolveMid1": "doesn't resolve to the queue root (",
  "workers.worktree.wrongResolveMid2": "); it resolves to",
  "workers.worktree.wrongResolveSuffix": "instead.",
  "workers.worktree.unresolved": "(unresolved)",

  "workers.create.invalidNamePrefix": "Worker names take letters, digits, _ and - only:",
  "workers.create.emptyName": "(empty)",

  "workers.ontology.mismatchMid": ": the value reads back differently after writing. No file was written.",

  "workers.manage.noSuchWorkerPrefix": "No such worker:",
  "workers.manage.busyMid1": " is holding a ticket right now (pid ",
  "workers.manage.busySuffix": "). Delete it once that finishes.",
  "workers.manage.cronRemoveFailPrefix": "Couldn't take the",
  "workers.manage.cronRemoveFailMid": "line out of crontab:",
  // 앞에 `${e.message} `가 붙는다 - 영어는 그 사이에 마침표가 없어 두 문장이 붙어 읽힌다.
  "workers.manage.cronRemoveFailSuffix": "— the file was left in place.",

  // lib/auth.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 4c195255). settings 다이얼로그의 claude
  // 인증 섹션이 이 문구를 그대로 보여준다.
  "auth.token.empty": "The token is empty.",
  "auth.token.hasWhitespace": "The token has spaces or line breaks in it. Paste a single line.",
  "auth.verify.notAuthenticated": "The value picked up from the CLI screen doesn't authenticate. Try again.",
  "auth.setup.pathNotFoundPrefix": "Couldn't find claude on PATH. (PATH=",
  "auth.setup.pathNotFoundSuffix": ")",
  "auth.setup.timeoutSuffix": " seconds passed with no token.",
  "auth.setup.endedWithCodeMid": "It ended without a token (exit code ",
  "auth.setup.endedWithCodeSuffix": ").",
  "auth.setup.saveFailedPrefix": "Caught the token but couldn't save it:",
  "auth.setup.execFailedPrefix": "Couldn't run it:",
  "auth.setup.endedNoToken": "It ended without a token.",

  // lib/queue.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 4c195255). 티켓 상세 편집 폼과 에픽
  // 드래그가 같은 판정을 나눠 쓴다.
  "queue.locked.wip": "A ticket in progress can't be edited — a session is working in that file.",
  "queue.locked.done": "A finished ticket can't be edited — completion is this queue's permanent record.",
  "queue.frontmatter.uneditableKeyPrefix": "The frontmatter field won't change this key:",
  "queue.frontmatter.missingPrefix": "No frontmatter:",

  // lib/engine.ts — 파일 스코프 접두(§묶음 표 행 9, 티켓 4c195255).
  "engine.invalidWorkerNamePrefix": "Not a worker name:",
  "engine.invalidHashPrefix": "Not a hash:",
  "engine.noWorkerToUnassign": "This project has no workers — there's no script to call for unassign.",
  "engine.noWorkerToPreempt": "This project has no workers — there's no script to call for preempt.",
  "workers.settingsDialog.trigger": "Worker settings",
  "workers.reap.sectionTitle": "Stale collection",
  "workers.context.badge": "Common",

  // §0-16 §발행 §묶음 표 행 5 갈래(워커 화면) — `ko`는 610dc0c0, `en`은 e3d3b255.
  // `lib/workers.ts`가 만드는 실패 사유(`workers.crontab.*` · `workers.worktree.*` ·
  // `workers.context.*`의 나머지)는 행 9라 여기 없다.
  "workers.crontabApprovalHint": "Press [Allow] if a permission window opens — registering the crontab line waits on that answer.",
  "workers.notRunningYetHint": "It isn't running yet — run this command in your shell",
  "workers.cronRegisterFailedTitle": "Couldn't register the crontab line",

  // `no-exec` 복구 버튼(`ExecBitFix`, §0-21 결정 3).
  "workers.execFix.failedDefaultMessage": "Couldn't set the exec bit.",
  "workers.execFix.successSentence": "Exec bit set",
  "workers.execFix.pending": "Setting…",
  "workers.execFix.button": "Set the exec bit",
  "workers.execFix.failedTitle": "Couldn't set the exec bit",

  // 생성 다이얼로그(`CreateWorkerButton`, §4 생성).
  "workers.create.worktreeStep0": "Couldn't create the worktree",
  "workers.create.worktreeStep1": "Couldn't create the .dira symlink",
  "workers.create.worktreeStep2": "The .dira symlink doesn't point at this project",
  "workers.create.trigger": "New worker",
  "workers.create.dialogTitle": "New worker",
  "workers.create.dialogDescription":
    "One worker is one cron job, and one run finishes one ticket. Concurrency = how many workers you have.",
  "workers.create.templateCopiedMiddle": " was copied to",
  "workers.create.templateCopiedSuffix": ", left at 755. Look it over and fix it by hand if you need to.",
  "workers.create.cronRegisteredMessage": "Registered in the crontab — it starts claiming tickets in 30 seconds.",
  "workers.create.worktreeSkippedPrefix": "No worktree was made —",
  "workers.create.worktreeSkippedSuffix": "The worker file and the crontab line stay as they are.",
  "workers.create.worktreeDoneLabel": "Working directory",
  "workers.create.worktreeDoneMiddle": " is created, and the",
  "workers.create.worktreeDoneSuffix": " inside it points at this project — checked.",
  "workers.create.worktreeFailedHint":
    "Without a working directory this worker claims a ticket and puts it right back — run the rest of the commands in your shell",
  "workers.create.nameLabel": "Name",
  "workers.create.nameHint": "Letters, digits, _ and -. The file becomes workers/<name>.sh",
  "workers.create.sessionCapNoLimit": "No machine-wide limit",
  "workers.create.sessionCapHint":
    "Running many sessions at once strains this machine, so there's a limit on how many can run concurrently.",
  "workers.create.failedTitle": "Couldn't create the worker",

  // 행 액션 셋(스트림 · 중단/재등록 · 삭제, `WorkerRowActions`, §4).
  "workers.row.streamButton": "Stream",
  "workers.row.stopButton": "Stop",
  "workers.row.registerButton": "Re-register",
  "workers.row.deleteButton": "Delete",
  "workers.row.streamDialogTitlePrefix": "Session stream —",
  "workers.row.stopDialogTitlePrefix": "Stop worker —",
  "workers.row.stopDialogDescription":
    "This takes the worker's line out of the crontab. The file stays — register it again and it comes right back.",
  "workers.row.stopFailedTitle": "Couldn't take it out of the crontab",
  "workers.row.runInShellHint": "Run this command in your shell",
  "workers.row.stopRunningAlertTitle": "It's holding a ticket right now",
  "workers.row.stopRunningAlertBody":
    "The running session isn't killed. Out of the crontab it still stops only after the ticket it holds is finished.",
  "workers.row.stoppingPending": "Stopping…",
  "workers.row.registerDialogTitlePrefix": "Re-register worker —",
  "workers.row.registerDialogDescription":
    "This puts the worker's line back in the crontab. The file is already there, so that one line is all that changes.",
  "workers.row.registeringPending": "Registering…",
  "workers.row.deleteDialogTitlePrefix": "Delete worker —",
  "workers.row.deleteBlockedTitle": "It can't be deleted right now",
  "workers.row.deleteBlockedPidPrefix": "This worker is holding a ticket (pid",
  "workers.row.deleteBlockedPidSuffix":
    "). Delete it now and the lock and the running session are left dangling. Stop it first, then delete once the ticket it holds is finished.",
  "workers.row.deleteBodyText": "This deletes the file. Tickets in this project are not deleted.",
  "workers.row.deleteCronPrefix": "The crontab line goes with it —",
  "workers.row.deleteCronBold": "crontab first, file second",
  "workers.row.deleteCronSuffix":
    ". Leave it and cron runs a file that isn't there every minute, piling errors into cron.log.",
  "workers.row.deleteFailedTitlePrefix": "Worker",
  "workers.row.deleteFailedTitleSuffix": "— delete failed",
  "workers.row.deleteCronFailedHint":
    "The file is untouched — take the crontab line out with this command, then try again",
  "workers.row.deleteFailedDefaultMessage": "Couldn't delete it.",
  "workers.row.deletingPending": "Deleting…",

  // 컨텍스트 편집기 공유 부분(`ExistsMark` · `ContextRejection` · `ContextEditor`).
  "workers.context.existsYes": "Present",
  "workers.context.existsNo": "Missing — the engine skips it and only logs WARN",
  "workers.context.existsAmbiguous": "The path couldn't be pinned to one value",
  "workers.context.existsUnsaved": "Checked once you save",
  "workers.context.rejectionTitleMiddle": ":",
  "workers.context.rejectionTitleSuffix": "block can't be edited from the GUI",
  "workers.context.rejectionBodyPrefix":
    "The GUI doesn't guess — step on the wrong line and the worker dies while cron fails quietly. Edit",
  "workers.context.rejectionBodySuffix": " by hand, then refresh this screen.",
  "workers.context.missingLinePrefix": "Just one line to add — the required",
  "workers.context.missingLineMiddle": "line marks the spot: paste it",
  "workers.context.missingLineBold": "above",
  "workers.context.missingLineSuffix":
    "that line, anywhere, and it opens. The GUI won't add it for you (there's no anchor to place it against).",
  "workers.context.pathAriaLabel": "Path",
  "workers.context.descAriaLabel": "Description",
  "workers.context.descPlaceholder": "Description (optional) — why the session reads it",
  "workers.context.pickPathLabelSuffix": " path",
  "workers.context.moveUp": "Move up",
  "workers.context.moveDown": "Move down",
  "workers.context.removeRow": "Remove",
  "workers.context.saveFailedTitleSuffix": " — couldn't save",
  "workers.context.overwriteHintPrefix": "Saving rewrites",
  "workers.context.overwriteHintMiddle": "'s",
  "workers.context.overwriteHintSuffix": "block in full",
  "workers.context.revertButton": "Revert",
  "workers.context.countSuffix": " listed",
  "workers.context.commonReadFailed": "Couldn't read it",

  // 공통 컨텍스트 카드(`CommonContextCard`, §4-1).
  "workers.commonCard.emptyText": "No common items — each worker reads only its own.",
  "workers.commonCard.addLabel": "Add a common item",

  // 워커 설정 다이얼로그 나머지(`WorkerSettingsDialog`, §4-15).
  "workers.settingsDialog.commonContextHeading": "Common context",
  "workers.settingsDialog.commonContextIntro1": "One file every worker",
  "workers.settingsDialog.commonContextIntro2": "s —",
  "workers.settingsDialog.commonContextIntro3": ". Items here go at the",
  "workers.settingsDialog.commonContextIntro4":
    " of each worker's context list and can't be removed from the per-worker list. Fix one line and every worker gets it. ",
  "workers.settingsDialog.commonContextIntro5": " differs per worker, so it counts as present",
  "workers.settingsDialog.commonContextIntro6":
    "— when workers differ the GUI doesn't decide either way (it couldn't check).",
  "workers.settingsDialog.commonContextTopLabel": "top",
  "workers.settingsDialog.commonContextEveryoneLabel": "only when every worker has it",
  "workers.settingsDialog.readonlyHeading": "The rest of the worker settings (read-only)",
  "workers.settingsDialog.readonlyDescription":
    "These values aren't edited here — edit the worker file by hand.",
  "workers.settingsDialog.divergentTitle": "Workers disagree on this value",
  "workers.settingsDialog.divergentBody":
    "The engine uses the value of the worker that dispatched the ticket — which worker claims the same ticket changes the result.",
  "workers.settingsDialog.reapDescription":
    "Puts a ticket back in the backlog when the session died but the ticket stayed in progress.",
  "workers.settingsDialog.reapFailedTitleSuffix": ".sh reap failed",

  // 워커 행의 둘째 행 경고 다섯(`WorkerContextRow`, §비주얼 §35).
  "workers.contextRow.fileSuffixPrefix": ".sh has no line that sources",
  "workers.contextRow.fileSuffixGlue": " with",
  "workers.contextRow.lineNotAddedDefault": "Couldn't add the line.",
  "workers.contextRow.applyingPending": "Applying…",
  "workers.contextRow.noCommonSourceTitle": "This worker doesn't get the common context",
  "workers.contextRow.noCommonSourceBodyMiddle": "— the",
  "workers.contextRow.noCommonSourceBodySuffix": " common items above never reach this worker's sessions.",
  "workers.contextRow.applyCommonButton": "Apply common",
  "workers.contextRow.commonAppliedSentence": "Common context applied",
  "workers.contextRow.applyCommonFailedTitle": "Couldn't apply the common context",
  "workers.contextRow.noSelfHealTitle": "Deleting this worker leaves its cron lines behind",
  "workers.contextRow.selfHealMissingMiddle":
    "— delete dira and nothing runs to take this worker's two crontab lines out, so cron calls a file that isn't there every minute. Applying adds one line right above",
  "workers.contextRow.selfHealMissingSuffix":
    "(the engine path is read from that line in this file).",
  "workers.contextRow.applySelfHealButton": "Apply self-heal",
  "workers.contextRow.selfHealAppliedSentence": "Self-heal applied",
  "workers.contextRow.applySelfHealFailedTitle": "Couldn't apply self-heal",
  "workers.contextRow.gateStaleTitle": "This worker's dispatch gate is stale",
  "workers.contextRow.gateMissingTitle": "This worker dispatches even when the receiving tree is dirty",
  "workers.contextRow.gateStaleBody":
    " in this worker differs from the current version — it still runs the old dispatch gate. Applying overwrites the file with the current version.",
  "workers.contextRow.gateMissingMiddle":
    "— dispatch a dirty receiving tree and the session finishes all the work, then gets refused at push and nowhere earlier. Applying adds one line right above",
  "workers.contextRow.gateMissingSuffix":
    "(the integration branch is read from protocols/AGENTS.md).",
  "workers.contextRow.applyGateButton": "Apply dispatch gate",
  "workers.contextRow.gateAppliedSentence": "Dispatch gate applied",
  "workers.contextRow.applyGateFailedTitle": "Couldn't apply the dispatch gate",
  "workers.contextRow.expandedIntroPrefix": "This worker's own",
  "workers.contextRow.expandedIntroMid1":
    "— each item's path and description are appended to the end of the session prompt.",
  "workers.contextRow.expandedIntroBold": "A missing item is not an error",
  "workers.contextRow.expandedIntroMid2": "— the engine skips it and leaves only",
  "workers.contextRow.expandedIntroMid3":
    " in runner.log (so a session doesn't flail while a cloud mount isn't attached). The",
  "workers.contextRow.expandedIntroSuffix":
    "badge rows at the top of the list are the common context below and can't be edited here — those items aren't in the worker file.",
  "workers.contextRow.copyThisLabel": "Copy this setup to:",
  "workers.contextRow.emptyWithCommon":
    "This worker has no items of its own — it only gets the common items above.",
  "workers.contextRow.emptyNoCommon": "No items — this worker's sessions start with no reference context.",
  "workers.contextRow.addItemLabel": "Add an item",
  "workers.contextRow.copyDialogTitlePrefix": "Copy context —",
  "workers.contextRow.copyDescMid1": ".sh's TICKET_CONTEXT block is replaced with",
  "workers.contextRow.copyDescMid2": "'s",
  "workers.contextRow.copyDescMid3": " items.",
  "workers.contextRow.copyDescSuffix": "'s own items don't survive.",
  "workers.contextRow.copyBodySuffix":
    " isn't expanded — it moves across as the literal string, so the receiving worker points at its own working directory. When the context differs per worker, which worker claims the same ticket changes the result.",
  "workers.contextRow.copyFailedTitle": "Couldn't copy it",
  "workers.contextRow.copyingPending": "Copying…",
  "workers.contextRow.copyButton": "Copy",
  "workers.contextRow.copyFailedDefaultMessage": "Couldn't copy it.",

  // `workers/page.tsx` — 표시 전용 설정 라벨 · 결함 사전 · 표 머리 · 빈 상태 · 배지.
  "workers.status.stoppedNote": "not in the crontab",
  "workers.status.staleNote": "the next tick collects it",
  "workers.defect.missingCwd.title": "No working directory",
  "workers.defect.missingCwd.why":
    "tick.sh logs an ERROR that the cwd is missing, releases the lock, and puts the ticket back — it claims and drops, nothing more.",
  "workers.defect.missingLink.title": "No .dira symlink",
  "workers.defect.missingLink.why":
    "The session sees a decoy .dira and can't find its own ticket — it can't report done either, and reap only bumps attempts.",
  "workers.defect.sharedCwd.title": "Shared working directory",
  "workers.defect.sharedCwd.why":
    "Two sessions step on one branch in one tree — dispatch-gate.sh blocks the dispatch.",
  "workers.defect.noTicketCwd.title": "No TICKET_CWD",
  "workers.defect.noTicketCwd.why":
    "It commits in the receiving tree as it is — leave an uncommitted trace and the dispatch gate holds every worker in the queue.",
  // `cwdDefects`가 조립하는 `WorkerDefect.detail` 넷(티켓 `d64fa06f`) — 가운데가 실제 경로다.
  // 한국어는 경로 뒤에 조사가 붙고 영어는 경로가 주어로 먼저 서는 자리라 조각의 몫이 갈린다.
  // `sharedCwd.detailMid`가 공백으로 시작하는 것은 워커 이름 목록에 바로 이어 붙기 때문이고
  // (`${others.join("·")}${detailMid} ${cwd}`), 한국어는 조사라 그 공백이 없다.
  "workers.defect.noTicketCwd.detailPrefix": "No TICKET_CWD line, so this worker works in",
  "workers.defect.noTicketCwd.detailSuffix": "instead of a worktree of its own.",
  "workers.defect.missingCwd.detailSuffix": "doesn't exist, or isn't a directory.",
  "workers.defect.missingLink.detailMissingSuffix":
    "is missing. It has to be a symlink to the queue root.",
  "workers.defect.missingLink.detailWrongMid": "resolves to",
  "workers.defect.missingLink.detailWrongSuffix": "instead of the queue root.",
  "workers.defect.sharedCwd.detailMid": " and this worker share one working directory:",
  "workers.defect.cwdPending": "The integration gate creates it on the first dispatch",
  "workers.tokenSummary.label": "Tokens, last 5 hours",
  "workers.tokenSummary.unaccountedPrefix": "· outside this total:",
  "workers.tokenSummary.unaccountedSuffix": " session(s)",
  "workers.empty.text": "No workers",
  "workers.empty.noWorkerBodyPrefix": "With no workers, tickets never get dispatched — and neither",
  "workers.empty.noWorkerBodyMid": " (stale collection) nor",
  "workers.empty.noWorkerBodySuffix":
    " can run: the engine does both through a worker script (constraint 2).",
  "workers.table.holdingHeader": "Holding",
  "workers.table.contextHeader": "Context",
  "workers.table.activityHeader": "Last activity",
  "workers.table.tokensHeader": "Tokens (5h)",
  "workers.limitBadge.title":
    "No Claude account is usable right now — once this time passes, the next tick opens a session",
  "workers.limitBadge.labelPrefix": "Waiting on limit ·",
  // `firstWorkerCmd`의 자리표시자(`cp <...>/worker.sh.example`)와 `worktreeCmds` 셋째 줄의 꼬리
  // 주석(티켓 `d64fa06f`). 뒤엣것은 ``# `l` ``에 바로 이어 붙어 공백으로 시작한다 — 한국어는
  // 조사라 그 공백이 없다.
  "workers.firstWorkerCmd.repoPlaceholder": "path to the dira repo",
  "workers.worktreeCmds.lsHintSuffix": " has to be the first character",
  "workers.defectAlert.worktreeHintPrefix": "The prep commands create",
  "workers.defectAlert.worktreeHintMid": "— this project's layout (§4-2). If",
  "workers.defectAlert.worktreeHintSuffix":
    " isn't that path, fix that line by hand too. The GUI doesn't run the checkout.",
  "workers.defectAlert.cwdFixPrefix": "This command adds just one line —",
  "workers.defectAlert.cwdFixSuffix":
    "— to the worker file. The gate creates the tree on the next tick.",
  "workers.lastFailure.title": "The session failed immediately",

  // `workers/actions.ts` — 서버 액션 결과 메시지(§4 · §4-16 · §4-17).
  "workers.stop.removedMessage": "Taken out of the crontab — this worker claims no new tickets.",
  "workers.stop.noopMessage": "It wasn't in the crontab already — nothing changed.",
  "workers.register.addedMessage": "Put in the crontab — it starts claiming tickets in 30 seconds.",
  "workers.register.noopMessage": "It was already in the crontab — nothing changed.",
  "workers.reap.noStaleOutput": "No stale tickets to collect.",
  "ontology.location.inWorktree": "Inside this project's git working tree",
  // Ticket cd662a73, moved to this namespace by c5d51522 — see the ko block for why the third
  // rejection reuses `ontology.location.inWorktree`.
  "ontology.location.edit": "Edit ontology location",
  "ontology.location.browse": "Ontology location",
  "ontology.location.placeholder": "Absolute path outside this project's git working tree",
  "ontology.location.save": "Save",
  "ontology.location.saveFailed": "Couldn't save",
  "ontology.location.notAbsolute": "Must be an absolute path:",
  "ontology.location.notDirectory": "Not an existing directory:",
  // 공용 컴포넌트·순수 유틸 묶음(§0-16 §발행 §묶음 표 행 11, `90db2822`) — ko는 `c9f2eec5`가
  // 뽑았다. 이 묶음의 문구는 **한 자리가 아니라 여섯 자리에서 같이 읽힌다**(`markdown-editor.tsx`
  // 하나가 화면 여섯을 문다) — 그래서 화면 이름을 안 넣고 동작만 적는다.
  // **꼬리 `budgets.overSuffix`는 이 블록에 없다** — `50fd4b34`가 회귀를 고치면서
  // 위에 먼저 채웠고, 값은 여기서 채웠을 것과 같다(` over`).

  // 아이콘 버튼의 접근명 겸 툴팁 — 지금 면이 아니라 **누르면 가는 면**을 알려 준다.
  "markdownEditor.toggle.toRaw": "Switch to source",
  "markdownEditor.toggle.toWysiwyg": "Switch to rich text",

  "frontmatterRows.toggle.toRows": "Switch to rows",
  "frontmatterRows.toggle.toPlain": "Switch to plain text",
  "frontmatterRows.empty": "No frontmatter rows.",
  "frontmatterRows.addRow": "Add row",
  "frontmatterRows.keyLabel": "Key",
  "frontmatterRows.valueLabel": "Value",
  "frontmatterRows.addAfterKeyPrefix": "Add row after ",
  "frontmatterRows.addAfterKeySuffix": "",
  "frontmatterRows.removeKeyPrefix": "Delete row ",
  "frontmatterRows.removeKeySuffix": "",
  "frontmatterRows.addAfterItemPrefix": "Add row after item ",
  "frontmatterRows.addAfterItemSuffix": "",
  "frontmatterRows.removeItemPrefix": "Delete row for item ",
  "frontmatterRows.removeItemSuffix": "",

  "frontmatterRows.addListItem": "Add item",
  "frontmatterRows.removeListItemPrefix": "Delete item ",
  "frontmatterRows.removeListItemSuffix": "",
  "frontmatterRows.pickKeyLabel": "Pick from key candidates",
  "frontmatterRows.pickValueLabel": "Pick from value candidates",
  "frontmatterRows.searchPlaceholder": "Search",
  "frontmatterRows.searchEmpty": "No matching items",

  "ticketFrontmatter.saveFailedTitle": "Couldn't save",
  "ticketFrontmatter.saved": "Saved.",

  // 티켓 상세·발행 화면(묶음 표 행 4, 티켓 c92a3ead). 조합 문구가 많은데 이 갈래는 `wrap`을 안
  // 쓰고 JSX·템플릿 리터럴이 조각 사이의 mono 스팬을 직접 들고 있다 — 자리 순서를 못 바꾸므로
  // 영어도 그 순서에 맞춰 끊었다. 조각이 붙는 자리에 공백이 없으면 값이 공백으로 시작한다.
  "ticketDetail.file": "File",
  "ticketDetail.collapse": "Collapse",
  "ticketDetail.expand": "Expand",
  "ticketDetail.none": "None",
  "ticketDetail.squadWord": "Squad",
  "ticketDetail.personaWord": "Persona",
  "ticketDetail.currentValue": "current value",
  "ticketDetail.originalValue": "original value",
  "ticketDetail.bodyLabel": "Body",
  "ticketDetail.thisTicket": "This ticket",
  "ticketDetail.noTitle": "(no title)",
  "ticketDetail.met": "Done",
  "ticketDetail.progressHeading": "Progress record",
  "ticketDetail.relationsHeading": "Relations",
  "ticketDetail.emptyBody": "No body",
  "ticketDetail.noTranscript": "No transcript",

  "ticketDetail.unassign": "Unassign",
  "ticketDetail.unassigning": "Unassigning…",
  "ticketDetail.forceStopTitle": "This stops a running session",
  "ticketDetail.forceStopDescSuffix":
    " is still held by a live session. Force-stopping kills that session and locks the ticket as awaiting answer — no worker takes it again until you write one in the answer box. Uncommitted changes in the worktree stay where they are.",
  "ticketDetail.forceStop": "Force stop",
  "ticketDetail.unassignCallSuffix": "runs.",
  "ticketDetail.noWorkerScript": "This project has no worker — there's no script to call unassign on.",
  "ticketDetail.unassignDoneTitle": "Unassigned",
  "ticketDetail.unassignFailedTitle": "Couldn't unassign",
  "ticketDetail.wipLockTitle": "A session holds this ticket — editing and deleting are locked",
  "ticketDetail.wipLockDescPrefix": "A ticket in progress is read-only. If the session died, press",
  "ticketDetail.wipLockDescSuffix": " to put it back in the queue, then edit it.",
  "ticketDetail.ghostPrefix": "This open ticket carries a",
  "ticketDetail.ghostAfterSessionId": " —",
  "ticketDetail.ghostAfterSelect": " skips it for good and",
  "ticketDetail.ghostAfterReap": " only looks at",
  "ticketDetail.ghostSuffix": ", so only Unassign puts this ticket back in the queue.",

  "ticketDetail.answerThreadAriaLabel": "Answer thread",
  "ticketDetail.question": "Question",
  "ticketDetail.answer": "Answer",
  "ticketDetail.scrollToBottom": "Jump to the bottom",
  "ticketDetail.addendum": "Anything to add",
  "ticketDetail.answerPlaceholder": "Write an answer to the question",
  "ticketDetail.answerFailedTitle": "Couldn't post the answer",
  "ticketDetail.createsFileSuffix": " is created",
  "ticketDetail.answering": "Posting the answer…",
  "ticketDetail.answerSubmit": "Post answer",
  "ticketDetail.answerDialogTitlePrefix": "Answer —",
  "ticketDetail.answerDialogDesc":
    "Answer it and this ticket comes back to the queue, and the session that holds it carries on.",

  "ticketDetail.delete": "Delete",
  "ticketDetail.deleteConfirmTitle": "Delete ticket",
  "ticketDetail.deleteConfirmDescSuffix": " is deleted, file and all. This can't be undone.",
  "ticketDetail.deleteFailedFallback": "Couldn't delete it.",
  "ticketDetail.deleteFailedTitle": "Couldn't delete",
  "ticketDetail.deleteLockedWipTooltip": "A ticket in progress can't be deleted — a session holds it",
  "ticketDetail.deleteLockedDoneTooltip": "A finished ticket can't be deleted — it's a permanent record",
  "ticketDetail.deleteLockedWipMessage": "A ticket in progress can't be deleted — a session holds it.",
  "ticketDetail.deleteLockedDoneMessage":
    "A finished ticket can't be deleted — every ticket that lists this hash in deps would wait forever.",

  "ticketDetail.discardTitle": "You have unsaved text",
  "ticketDetail.discardDesc": "Close it and what you typed is gone.",
  "ticketDetail.keepWriting": "Keep writing",
  "ticketDetail.discardAndClose": "Discard and close",

  "ticketDetail.depsRemoveSuffix": "Remove",
  "ticketDetail.pickTicket": "Pick a ticket",
  "ticketDetail.searchPlaceholder": "Search tickets — hash or title",
  "ticketDetail.noMatch": "No matching ticket",
  "ticketDetail.depsHint":
    "This ticket reaches the queue only once all of them are done. Pick only what makes a start impossible — pile them on and the queue runs one at a time.",

  "ticketDetail.requestAccept": "New request",
  "ticketDetail.requestDescPrefix": "Write what you need in plain words and it becomes a",
  "ticketDetail.requestDescSuffix": "ticket for a session to read. The first line becomes the title.",
  "ticketDetail.requestBodyAriaLabel": "Request",
  "ticketDetail.requestBodyPlaceholder": "Just write what you need.\nThe first line becomes the title.",
  "ticketDetail.requestFailedTitle": "Couldn't submit it",
  "ticketDetail.requesting": "Submitting…",
  "ticketDetail.viewSubmittedRequest": "See the request you submitted",

  "ticketDetail.duplicate": "Duplicate",
  "ticketDetail.publish": "New ticket",
  "ticketDetail.duplicateTicketTitle": "Duplicate ticket",
  "ticketDetail.duplicateDescSuffix":
    "'s title, kind, persona and body are filled in below. deps aren't copied — pick them yourself if you need any.",
  "ticketDetail.publishDesc":
    "Every choice here is a real value from this project — you only type the title and the body.",
  "ticketDetail.titlePlaceholder": "One-line title — what it does",
  "ticketDetail.publishFailedTitle": "Couldn't publish it",
  "ticketDetail.publishing": "Publishing…",
  "ticketDetail.publishSubmit": "Publish",
  "ticketDetail.noPersonaDirSuffix": " — no persona directory there.",

  "ticketDetail.notScannedTitle": "This file never reaches the queue — it has no frontmatter",
  "ticketDetail.notScannedFirstLine": "The engine reads a file as a ticket only when the first line is",
  "ticketDetail.notScannedClosing": " and a closing",
  "ticketDetail.notScannedSuffix": " follows. Open it and fix it by hand.",
  "ticketDetail.hashMismatchTitlePrefix": "The engine can't find this ticket by",
  "ticketDetail.hashMismatchTitleSuffix": ", the value shown here",
  "ticketDetail.hashMismatchBody1": " and the file name disagree. The engine looks a ticket up by file name only, so",
  "ticketDetail.hashMismatchBody2": " has to carry",
  "ticketDetail.hashMismatchBody3":
    " — write the value shown here instead and everything waiting on this ticket waits forever, even once it turns",
  "ticketDetail.hashMismatchBody4": ".",
  "ticketDetail.hashMismatchFixPrefix": "To fix it, set",
  "ticketDetail.hashMismatchFixMid": " to",
  "ticketDetail.hashMismatchFixSuffix": ", or rename the file.",
  "ticketDetail.unlockedAwaitingTitle":
    "Awaiting answer with no lock — this ticket gets dispatched before anyone answers",
  "ticketDetail.unlockedAwaitingBody1": " is set, but that hash isn't in",
  "ticketDetail.unlockedAwaitingBody2": ". The engine looks only at",
  "ticketDetail.unlockedAwaitingBody3": ", so this ticket reaches the queue with no answer written — put",
  "ticketDetail.unlockedAwaitingBody4": " on the requirement and list",
  "ticketDetail.unlockedAwaitingBody5": " in it.",
  "ticketDetail.doneLockedTitle": "A finished ticket is read-only",
  "ticketDetail.doneLockedBody1": "Completion is this queue's permanent record — clearing",
  "ticketDetail.doneLockedBody2": "on waiting tickets and back-references through",
  "ticketDetail.doneLockedBody3":
    "both hang on this file existing, so editing, deleting and unassigning are blocked. The session record (",
  "ticketDetail.doneLockedBody4":
    ") stays as it is so the queue keeps who did the work. If there's more to do, make a new ticket.",
  "ticketDetail.requirementLabel": "Requirement",
  "ticketDetail.missingReqHint": "This requirement stem isn't in the queue — there's no source to follow",
  "ticketDetail.derivedTicketsLabel": "Tickets split out of this requirement",
  "ticketDetail.noDerivedTickets": "Nothing split out yet",
  "ticketDetail.archiveTargetLabel": "Archive target",
  "ticketDetail.missingArchiveHint": "This archive target stem isn't in the queue — there's no target to follow",
  "ticketDetail.archiveLabel": "Archive",

  "ticketDetail.unknownProjectPrefix": "Not a registered project:",
  "ticketDetail.ticketNotFoundPrefix": "Not a ticket in the queue:",
  "ticketDetail.unassignLockedDone":
    "A finished ticket can't be unassigned — the session record (session_id, owner) stays as it is so the queue keeps who did the work.",
  "ticketDetail.noNewlineSuffix": " can't hold a line break.",
  "ticketDetail.titleFieldName": "title",
  "ticketDetail.titleRequired": "Type a title.",
  "ticketDetail.notAssigned": "This ticket isn't assigned (session_id is empty).",
  "ticketDetail.notAwaitingAnymore":
    "This ticket isn't awaiting an answer any more — someone already answered, or a session claimed it. Refresh the page to see where it stands.",
  "ticketDetail.badAwaitingStemPrefix": "This awaiting value can't be a file name:",
  "ticketDetail.badAwaitingStemSuffix":
    ". The name takes no path separator and no control character — fix the requirement's frontmatter.",
  "ticketDetail.stemClashMiddle": "already names a ticket in the queue:",
  "ticketDetail.stemClashSuffix":
    ". While that file is there the engine picks it up first even after the answer file lands, and the requirement waits forever. Clear that file, or get a different awaiting hash from the PM.",
  "ticketDetail.answerRequired": "Type an answer.",
  "ticketDetail.answerFileExistsPrefix": "The answer file is already there:",
  "ticketDetail.answerFileExistsSuffix":
    ". Another window may have just answered — refresh and check the thread.",

  // `lib/followup.ts` — `interjectLib.*`가 같은 자리의 형제다(참견). 두 사전이 같은 것을 다르게
  // 부르지 않게 `state.*`·`statePrefix`·`ticketNotFoundPrefix`를 그쪽 낱말에 맞췄다.
  "followupLib.state.open": "Open",
  "followupLib.state.wip": "In progress",
  "followupLib.state.done": "Done",
  "followupLib.emptyBody": "Type something to send.",
  "followupLib.ticketNotFoundPrefix": "Not a ticket in the queue:",
  "followupLib.notDoneReason": "This isn't a finished ticket — the work to follow up on isn't over yet.",
  "followupLib.stateDetailPrefix": "State:",
  "followupLib.malformedFrontmatterPrefix": "No frontmatter, or no closing `---`:",
  "followupLib.hashExhausted":
    "Ten hashes drawn and every one is already taken — check the queue directory.",

  // `lib/attachments.ts`
  "attachmentsLib.noFileName": "This file has no name — pick one that has a name.",
  "attachmentsLib.nameExhausted": "Ten names drawn and every one is already taken.",
  "attachmentsLib.saveFailedPrefix": "Couldn't save it:",
  "attachmentsLib.outsidePathPrefix":
    "The attachment path lands outside attachments/ — drop what you attached and pick again:",

  // `components/attachment-field.tsx` — `attachWord`는 버튼 라벨과 칩 묶음의 낭독 이름 둘을 겸한다.
  // 수가 낱말 뒤로 오는 자리라 `Attachments 3 listed` 꼴이고, 그래서 버튼도 `Attach`가 아니라
  // `Attachments`다(`sessionStream.recordCount`의 `Records 12`가 선 그 벌).
  "attachmentField.uploadFailedPrefix": "Couldn't upload it:",
  "attachmentField.dropLimitPrefix": "Up to",
  "attachmentField.dropLimitMiddle": " files at a time —",
  "attachmentField.dropLimitSuffix": " weren't attached.",
  "attachmentField.attachWord": "Attachments",
  "attachmentField.countSuffix": " listed",
  "attachmentField.uploading": "Uploading…",
  "attachmentField.removeSuffix": "remove attachment",

  // 뒤에 `{percent}%`가 공백 하나를 두고 붙는다(`Downloading the update… 42%`).
  "updateToast.progress.prefix": "Downloading the update…",
  "updateToast.confirm.message": "Something is still running. Restart anyway?",
  "updateToast.confirm.cancel": "Cancel",
  "updateToast.confirm.restart": "Restart",
  "updateToast.downloaded.title": "Update downloaded",
  "updateToast.downloaded.notesToggle": "What changed",
  "updateToast.downloaded.later": "Apply on next start",
  "updateToast.downloaded.restartNow": "Restart now",

  // sr-only 접두 — 뒤에 이름이 공백 없이 붙고(`Worker w3`), 묶음에서는 한 번만 나온다
  // (`Worker w3 w4`). 낭독의 첫 낱말이라 대문자다(`protocols.sidebar.ariaLabel`과 같은 벌).
  "workerMark.srPrefix": "Worker ",

  "pathPicker.browse": "Browse",

  "markdown.empty": "(empty)",
  "markdownWikilinks.noTarget": "No target",

  "copyCommand.ariaLabel": "Copy the command",

  // 뒤에 바이트 수(소수 1자리)가 공백 없이 붙는다(`Over 20MB (23.4MB) — ...`).
  "attachmentLimit.oversizePrefix": "Over 20MB (",
  "attachmentLimit.oversizeSuffix": "MB) — upload just the part you need.",

  // 상한 거절 제목 둘 — 수를 가운데 두고 `Over the 200-file install limit` ·
  // `Over the 20MB install limit`. 한국어가 문장이던 자리를 영어는 명사구로 세운다.
  "skillUpload.tooManyFilesPrefix": "Over the ",
  "skillUpload.tooManyFilesSuffix": "-file install limit",
  // 앞의 수에 공백 하나로 붙는다(`412 files`). 복수형 장치가 없어 늘 복수로 둔다 —
  // 이 문장이 뜨는 것은 상한(200)을 넘긴 뒤라 1이 안 뜬다.
  "skillUpload.fileCountSuffix": " files",
  "skillUpload.tooManyBytesPrefix": "Over the ",
  "skillUpload.tooManyBytesSuffix": "MB install limit",

  // 신뢰 경계 검증 사유(lib/paths.ts) — 뒤에 붙는 값(이름·경로)은 안 건드린다.
  "paths.invalidAssignmentPrefix": "Invalid persona value (persona:<name> or squad:<name>):",
  // 뒤에 `${target} -> ${real}`이 공백 하나씩 사이에 두고 붙는다.
  "paths.outsideBasePrefix": "Path is outside the base directory:",
  // 뒤에 `${base})`가 공백 하나를 사이에 두고 붙는다(`(base <경로>)`).
  "paths.outsideBaseSuffix": "(base",

  // 뒤에 의견 첫 줄(최대 40자)이 공백 없이 붙는다.
  "feedback.titlePrefix": "Feedback — ",
  "feedback.versionLabel": "Version",
  "feedback.sessionLabel": "Session",

  // 앞엣것은 `protocols.action.unknownProjectPrefix`와 **같은 문장이다** — 같은 거절을
  // 두 액션 파일이 각자 말하는 자리라 낱말이 갈리면 안 된다.
  "projectActions.unknownProjectPrefix": "Not a registered project:",
  "projectActions.fileMissing": "No file came through — pick it again.",

  // `<meta name="description">` — 화면에 안 뜨고 제품 한 줄 설명이다(§0-9가 이 값을 그렇게
  // 갈랐다). 명사구라 마침표를 안 찍는다.
  "appLayout.description": "Control room for a filesystem ticket queue",

  "ontology.notDira.title": "Not dira format",
  "ontology.notDira.body":
    "No _ontology/SCHEMA.md or objects/ here — this folder just hasn't been moved into dira format yet. Use import below to bring it in.",

  // 보드 화면(§0-16 §발행 §묶음 표 행 3) — `ko`는 `f3a8794e`, 이 영어가 `6d818d48`다. 이 앱에서
  // 사람이 제일 오래 보는 화면이라 낱말은 셸(`90be3eeb`)에서 그대로 내려받았고, 새 낱말만 위
  // 표에 올렸다. 어순이 뒤집혀 조각의 몫이 갈린 자리는 그 자리마다 주석을 달았다.
  "boardPage.view.table": "Table",
  "boardPage.view.kanban": "Kanban",
  // 표 컬럼 라벨 8개 — 필터 팝오버 라벨 · 필터 칩 · 정렬 헤더가 같은 키를 재사용한다.
  "boardPage.column.status": "Status",
  "boardPage.column.hash": "Hash",
  "boardPage.column.title": "Title",
  "boardPage.column.kind": "Kind",
  "boardPage.column.persona": "Persona",
  // 위 표의 `선행` 줄에서 그대로 내려받는다 — `Deps`는 frontmatter 키 이름이지 사람 말이 아니다.
  "boardPage.column.deps": "Prerequisites",
  "boardPage.column.created": "Created",
  "boardPage.column.owner": "Owner",
  // 완료 카드 하단 아카이브 한 줄 — 셋이 `Archiving`을 머리로 나눠 갖는다. 이 줄은 `truncate`라
  // 좁은 카드에서 꼬리부터 잘리는데, 머리가 같으면 잘려도 무슨 줄인지는 남는다.
  "boardPage.archive.awaitingAnswer": "Archiving — awaiting answer",
  "boardPage.archive.inProgress": "Archiving",
  "boardPage.archive.pending": "Archiving — queued",
  // 앞에 `"질의"`가 공백 없이 붙는다 — 쌍따옴표를 콜론으로 받는다(`settings.search.emptySuffix`가
  // 연 그 수). 조립 결과는 `i18n.test.ts`가 두 언어 다 고정한다.
  "boardPage.noMatch.querySuffix": ": no matching tickets",
  "boardPage.noMatch.generic": "No tickets match these filters",
  "boardPage.filter.reset": "Reset filters",
  "boardPage.filter.hideDone": "Hide done",
  // 앞에 필터 라벨이 공백 하나로 붙는다(`Status search`). 라벨이 **변수**라 영어도 어순을 못
  // 뒤집는다 — 접두·접미로 쪼개는 수가 안 통하는 자리다(위 `wrap` 자리들과 갈리는 지점).
  "boardPage.filter.searchSuffix": "search",
  // `{접두} {라벨} {count.zero}` — `No matching Status 0`. 꼬리의 `0`을 문장 안으로 못 들인다:
  // `count.zero`는 칸반 레인의 빈 자리에서 **혼자** 뜨는 값이라 낱말을 붙이면 그 자리가 깨진다.
  "boardPage.filter.noMatchPrefix": "No matching",
  "boardPage.title.empty": "(No title)",
  "boardPage.empty.noTickets": "No open tickets",
  // 건수 줄 — `Tickets: 12` · `Tickets: 5 / 12`. **숫자를 뒤로 보내고 콜론으로 받는다**
  // (`bell.due.titlePrefix`가 연 수). 영어에는 `건`에 해당하는 조각이 없어 단위는 빈다 —
  // 칸반 레인 머리의 건수도 그래서 숫자만 뜬다(`t`는 `""`를 그대로 돌려준다).
  "boardPage.count.label": "Tickets:",
  "boardPage.unit.count": "",
  "boardPage.count.zero": "0",
  // `Hiding 3 done` — 접두가 동사를 지고 꼬리가 상태 낱말을 든다(위 표의 `완료 = Done`).
  "boardPage.count.hiddenPrefix": "Hiding",
  "boardPage.count.hiddenSuffix": "done",
  // `(Not dispatched: 2 — see notifications)` — 꼬리가 숫자에 **공백 없이** 붙으므로 값이
  // 공백으로 연다. 접두는 위 건수 줄과 같은 콜론 수다.
  "boardPage.undispatched.prefix": "Not dispatched:",
  "boardPage.undispatched.suffix": " — see notifications",
  // 정렬 헤더의 aria-label — 앞에 컬럼 라벨이 공백 하나로 붙는다(`Status sort`).
  "boardPage.sort.ariaSuffix": "sort",
  // `title`·`frontmatter`는 무엇을 뒤지는지 가리키는 필드 이름이라 번역하지 않는다(`ko`도 같다).
  "boardPage.search.placeholder": "Search title · body · frontmatter",
  "boardPage.search.ariaLabel": "Search tickets",
  "boardPage.epicDrag.missingTitle": "Couldn't find the ticket file — it left the queue, or its state changed",
  // 실패한 것은 티켓을 에픽으로 옮기는 일이다 — 드래그 문구(`board.epic.dropOnEpic`)가 `move`로
  // 열었으므로 실패 제목도 그 동사를 든다.
  "boardPage.epicDrag.failTitle": "Couldn't move the ticket",

  // 발행 서버 액션(`(board)/actions.ts`).
  // 앞에 필드 이름이 공백 없이 붙으므로 값이 공백으로 연다(`Title can't…` · `kind can't…`).
  "boardPage.action.noNewlineSuffix": " can't contain a line break.",
  "boardPage.action.acceptedDefault": "Request received. The PM will review it shortly.",
  // `projectActions.unknownProjectPrefix`와 **같은 글자다** — 같은 거절을 두 액션 파일이 각자
  // 말하는 자리라 낱말이 갈리면 안 된다.
  "boardPage.action.unknownProjectPrefix": "Not a registered project:",
  "boardPage.action.reqBodyRequired": "Enter the request.",
  "boardPage.action.titleRequired": "Enter a title.",
  // `kind must be one of work · request · feedback — got: xyz`. `kind`는 frontmatter 키 이름이라
  // 번역하지 않는다(`ko`와 같은 판단).
  "boardPage.action.kindPrefix": "kind must be one of",
  "boardPage.action.kindMiddle": "— got:",
  "boardPage.action.unknownDepsPrefix": "No such deps hash in the queue:",
  "boardPage.action.hashExhausted":
    "Drew 10 hashes and every one is already taken — check the queue directory.",
  // `Request received in the P338 (p338) epic.` — 라벨·해시가 가운데 끼는 자리라 접두가 문장을
  // 열고 접미가 마침표를 찍는다.
  "boardPage.action.epicAcceptedPrefix": "Request received in the",
  "boardPage.action.epicAcceptedSuffix": "epic.",
  // 레인 드롭(§1-5). ko 두 줄이 `ticketDetail.ticketNotFoundPrefix`("큐에 없는 티켓입니다")와
  // 다른 문장이라 en도 그쪽 낱말을 안 빌린다.
  "boardPage.action.ticketNotFoundPrefix": "Ticket not found:",
  "boardPage.action.notOpen": "This ticket has already moved to another state.",

  // 찾기 바(`find-bar.tsx`) — placeholder 하나와 아이콘 버튼 낭독 이름 셋. `Close`는
  // `common.close`와 같은 낱말이다(같은 동작이라 갈리면 안 된다).
  "findBar.placeholder": "Find",
  "findBar.prev": "Previous",
  "findBar.next": "Next",
  "findBar.close": "Close",

  // 홈 화면(§0-16 §발행 §묶음 표 행 6) — `f40e29e7`가 뽑은 `home.*` 74키의 영어다. 자리
  // 설명은 위 `ko` 쪽 주석에 있고, 여기서는 **어순이 갈리는 조립 자리**만 다시 적는다.
  "home.title": "Home",
  "home.conversationsLabel": "Conversations",
  "home.questionLabel": "Question",
  "home.answerLabel": "Answer",
  "home.newConversation": "New conversation",
  "home.newConversationLocked": "This conversation is already empty — ask here",
  "home.showMore": "Show more",
  "home.schedulesLabel": "Schedules",
  "home.workerSessionsLabel": "Worker sessions",
  "home.stop": "Stop",
  "home.stopped": "Stopped",
  "home.answering": "Answering",
  "home.activity.thinking": "Thinking",
  "home.scrollToLatest": "Jump to latest",
  "home.askPlaceholder": "Ask anything about this project",
  "home.sending": "Sending…",
  "home.send": "Send",
  "home.answer.retry": "Answer again",
  "home.answer.copy": "Copy",

  "home.onboarding.title": "Ask about this project",
  "home.onboarding.body":
    "It reads the tickets and the project resources — personas, protocols, workers — and answers. You can also have it change those resources.",
  "home.example.ticketsWhy": "Why aren't the tickets awaiting an answer moving?",
  "home.example.summarizeProtocols": "Summarize the protocols in this project",
  // 워커 이름 뒤에 공백 없이 붙는 접미(`${워커이름}${이 키}`) — 한국어는 이름 뒤에 `워커는`이
  // 조사를 받지만 영어는 이름이 그대로 주어라, 줄표로 끊고 `this worker`로 되받는다.
  "home.example.workerActivitySuffix": " — what is this worker working on right now?",
  "home.example.workerEngineSuffix": " — which engine does this worker run on?",

  "home.fail.spawn.title": "Couldn't get an answer — the session didn't start",
  "home.fail.spawn.next": "Check that the engine CLI is on PATH",
  "home.fail.auth.title": "Couldn't get an answer — claude has no auth",
  "home.fail.auth.next": "Put a long-lived token in Settings, at the right of the header, and ask again.",
  "home.fail.timeout.title": "Couldn't get an answer — the session ended without one",
  "home.fail.timeout.next": "Send it again. What you wrote is still there.",
  "home.fail.busy.title": "Couldn't send — an answer is still running",
  "home.fail.busy.next": "This field opens again when it finishes. No refresh needed.",
  "home.fail.noTranscript.title": "Couldn't find the answer — there is no transcript",
  "home.fail.noTranscript.next": "Ask again in a new conversation.",
  "home.fail.other.title": "Couldn't get an answer",

  "home.errors.emptyQuestion": "The question is empty.",
  "home.errors.claudeNotFoundPrefix": "Couldn't find claude on PATH. (PATH=",
  "home.errors.emptyAnswer": "The engine gave back an empty answer.",
  // 해시가 뒤에 붙고 `home.workerNote.runningSuffix`가 그 뒤를 닫는다 — 세 조각이 한 문장이라
  // 이 값은 `the `까지 열어 두고 끝낸다(`<WorkerNote>`의 짝과 글자를 맞춘다).
  "home.errors.workerRunningPrefix": "A running worker session takes no questions here · interrupt it from the ",

  "home.workerNote.running": "A running session takes no questions here · interrupt it from the ",
  "home.workerNote.done": "Asks on in this session without worker permissions · ",
  "home.workerNote.runningSuffix": " detail page",

  "home.schedule.new": "New schedule",
  "home.schedule.emptyTitle": "No runs yet",
  "home.schedule.overdueNote": "The time has passed, so this schedule won't run — delete it and make a new one",
  // 다이얼로그 설명 둘째 문장과 **한 글자까지 같다** — 마침표는 이 값에 안 넣는다(`ko`와 같다).
  "home.schedule.liveNote":
    "Schedules only run while this app is open — tickets in the queue keep getting dispatched even when it is closed",
  // 앞에 `8/30 09:00` 같은 시각이 공백 없이 붙어 한 문장이 된다.
  "home.schedule.dueAtSuffix": " is when the first run happens.",
  "home.schedule.locked": "You can't talk to this schedule before its first run",
  "home.schedule.kind.once": "Once",
  "home.schedule.kind.daily": "Daily",
  "home.schedule.kind.weekly": "Weekly",
  "home.schedule.kind.monthly": "Monthly",
  "home.schedule.kindLabel": "Repeat",
  "home.schedule.timeLabel": "Time",
  "home.schedule.promptLabel": "Prompt",
  "home.schedule.promptPlaceholder":
    "Sweep the tickets awaiting an answer and file a request for anything a human has to answer.",
  "home.schedule.dayLimitNote": "Some months have no 29th to 31st, so you can't pick those days.",
  "home.schedule.createFailTitle": "Couldn't create the schedule",
  "home.schedule.invalidWhenOrPrompt": "Check the time or the prompt.",
  "home.schedule.desc1": "At the time you set, the home agent carries out this prompt.",
  "home.schedule.desc3": "Runs missed while the app was closed happen once, late, when you open it.",
  "home.schedule.deleteTrigger": "Delete schedule",
  "home.schedule.deleteTitle": "This deletes the schedule",
  "home.schedule.deleteNote": "You won't be able to reopen past runs on this screen.",
  "home.schedule.deleteConfirm": "Delete",

  // 요일 칩 일곱 — 좁은 칸이라 세 글자 약어로 맞춘다(`bell.due`의 약어와 같은 판단).
  "home.weekday.mon": "Mon",
  "home.weekday.tue": "Tue",
  "home.weekday.wed": "Wed",
  "home.weekday.thu": "Thu",
  "home.weekday.fri": "Fri",
  "home.weekday.sat": "Sat",
  "home.weekday.sun": "Sun",

  // `projectActions.unknownProjectPrefix`와 **같은 글자다** — 같은 거절을 액션 파일들이 각자 든다.
  "home.action.unknownProjectPrefix": "Not a registered project:",

  // 온톨로지 화면(§0-16 §발행 §묶음 표 행 12 갈래) — `ko`는 `2ef7a4e9`가 뽑았다.
  // **`protocols-ui.tsx`와 판박이인 자리(새 파일 · 편집기 · 이름변경 · 삭제 · 사이드바)는
  // `protocols.*`의 영어를 글자 그대로 가져다 쓴다** — 화면이 갈려 키가 둘일 뿐 같은 동작이라,
  // 여기서 낱말을 새로 고르면 두 화면이 다른 말을 하게 된다.
  "ontology.import.folderLabel": "Folder to import",
  "ontology.publishing": "Publishing…",
  "ontology.import.title": "Import",
  // 버튼 아래 도움말. 뒤에 이 문구를 `aria-describedby`로 무는 버튼이 있어 문장으로 끝낸다.
  "ontology.import.hint": "Pick a folder first — its name becomes the source.",
  "ontology.import.failTitle": "Couldn't create the import ticket",

  "ontology.new.trigger": "New file",
  // `/`가 가운데 끼고 접미가 공백 없이 그 뒤를 잇는다(`… directory. / creates any …`).
  "ontology.new.descPrefix": "A path relative to the ontology directory.",
  "ontology.new.descSuffix":
    " creates any subdirectories along the way. The file starts empty and the editor opens on it right away.",
  "ontology.new.pathLabel": "Path",
  // 가운데에 `../`가 낀다(`… directory (../ · absolute).`).
  "ontology.new.pathHintPrefix": "The server rejects paths that leave the directory (",
  "ontology.new.pathHintSuffix": "· absolute).",
  "ontology.new.failTitle": "Couldn't create the file",

  // 위반 카드 안의 버튼이라 무엇을 고치는지까지 적는다 — 한국어 `문제해결`이 카드 안에서
  // 자명하던 자리다. 누르는 동안은 위 `ontology.publishing`이 뜬다.
  "ontology.fix.failTitle": "Couldn't create the cleanup ticket",
  "ontology.fix.trigger": "Fix violations",

  "ontology.editor.saveFailTitle": "Couldn't save",
  // 글자 수 뒤에 붙는다 — 한국어는 공백이 없고(`123자`) 영어는 하나 있다(`123 chars`).
  "ontology.charSuffix": " chars",
  "ontology.editor.revert": "Revert",
  "ontology.editor.saved": "Saved.",

  // 다이얼로그 제목이 `Rename — <경로>`로 조립된다(`protocols.rename.dialogTitlePrefix`가
  // 세운 그 벌인데, 이 화면은 em dash를 JSX가 찍어 접두 키가 따로 없다).
  "ontology.rename.trigger": "Rename",
  "ontology.rename.desc":
    "Change the relative path and the file moves into a subdirectory too. If that name already exists the rename is refused — nothing gets overwritten quietly.",
  "ontology.rename.newPathLabel": "New path",
  "ontology.rename.failTitle": "Couldn't rename",
  "ontology.rename.working": "Renaming…",

  "ontology.delete.trigger": "Delete",
  "ontology.delete.dialogTitle": "Delete file",
  // 앞에 경로가 붙는다(`SCHEMA.md will be deleted. …`) — 한국어는 조사가, 영어는 동사가 온다.
  "ontology.delete.descSuffix": " will be deleted. This can't be undone.",
  "ontology.delete.failTitle": "Couldn't delete",
  "ontology.delete.working": "Deleting…",

  // 생성 설문 4문항 — **«object» · «type» · «relation» · «ontology»를 안 쓴다**. 한국어 문항이
  // «객체»·«타입»·«관계»·«온톨로지»를 피한 것과 같은 이유다(`ontology-seed.ts` 머리 주석):
  // 처음 여는 사람에게 아직 낱말이 아니다. 산출물(`SCHEMA.md`)은 그 용어를 그대로 쓴다.
  "ontology.survey.q1.question": "What does this project mostly deal with?",
  "ontology.survey.q1.option.product": "We build a product or write code",
  "ontology.survey.q1.option.content": "We produce writing and content",
  "ontology.survey.q1.option.people": "We deal with people (customers, partners, teams)",
  "ontology.survey.q1.option.data": "We collect material and keep it in order",
  "ontology.survey.q2.question": "What will you end up naming over and over as you work?",
  "ontology.survey.q2.chip.customer": "Customer",
  "ontology.survey.q2.chip.project": "Project",
  "ontology.survey.q2.chip.doc": "Document",
  "ontology.survey.q2.chip.task": "Task",
  "ontology.survey.q2.chip.product": "Product",
  "ontology.survey.q2.customPlaceholder": "Type your own (comma-separated)",
  "ontology.survey.q3.question": "Will you want to ask things like these later?",
  "ontology.survey.q3.option.connect": "What is this connected to?",
  "ontology.survey.q3.option.owner": "Who was involved?",
  "ontology.survey.q3.option.cause": "What made this turn out this way?",
  "ontology.survey.q3.option.next": "What does this lead to next?",
  "ontology.survey.q4.question":
    "Pick anything that is a trace of the work rather than the project itself — those stay out",
  "ontology.survey.q4.option.tool": "The tool that runs this project (this screen, for one)",
  "ontology.survey.q4.option.memo": "Scratch notes and doodles",
  "ontology.survey.q4.option.chatlog": "Old chat logs",
  "ontology.survey.q4.option.testfile": "Files left over from testing",
  // 제출 뒤 대기 문장 — 가운데에 `shell.nav.board`(`Board`) 링크가 낀다. 접미는 마침표뿐이다.
  "ontology.survey.pendingPrefix":
    "Building from your answers… the first pass runs as one ticket on the",
  "ontology.survey.pendingSuffix": ".",
  "ontology.survey.failTitle": "Couldn't create it",

  // 스키마 위반 문장(`lib/ontology.ts`) — 조각 사이에 파일 경로 · 타입 이름 · 관계 이름이
  // 낀다. `ontology.violation.ofQuote`는 미정의 관계와 정의역·치역 위반 **둘이 같이 쓴다**.
  "ontology.violation.unknownTypePrefix": "Undefined type:",
  "ontology.violation.unknownTypeMiddle": "(type '",
  "ontology.violation.unknownTypeSuffix": "' is not in SCHEMA.md)",
  "ontology.violation.sectionUsed": "## section used:",
  "ontology.violation.unknownRelationPrefix": "Undefined relation:",
  "ontology.violation.ofQuote": "— '",
  "ontology.violation.unknownRelationSuffix": "' (not in the SCHEMA.md relation table)",
  "ontology.violation.domainRangePrefix": "Domain/range violation:",
  "ontology.violation.domainRangeMid": "' (",
  "ontology.violation.domainRangeSuffix": ") but the schema says [",
  "ontology.violation.danglingPrefix": "Dangling link:",
  "ontology.violation.missingRequiredPrefix": "Missing required property:",

  "ontology.sidebar.collapse": "Collapse the file list",
  "ontology.sidebar.expand": "Expand the file list",
  "ontology.usingDefault": "assumed default",
  "ontology.sidebar.ariaLabel": "Ontology files",
  "ontology.rejected.title": "Can't open this path",
  "ontology.picker.expanded": "Pick a file.",
  "ontology.picker.collapsed": "Expand the file list and pick a file.",
  "ontology.metrics.objectRelation": "Objects · relations",
  "ontology.metrics.hiddenEdges": "Hidden edges",
  "ontology.metrics.normativeSentences": "Normative sentences",
  "ontology.metrics.singleSentenceProse": "One-sentence prose",
  "ontology.metrics.shells": "Shells",
  "ontology.metrics.isolated": "Isolated",
  "ontology.metrics.hierarchyCycles": "Hierarchy cycles",
  "ontology.metrics.polysemousElements": "Polysemous elements",
  "ontology.metrics.redundantClasses": "Redundant classes",
  "ontology.metrics.emptyHandedRatio": "Empty-handed rate",
  "ontology.metrics.schemaStability": "Schema revisions (cumulative)",
  "ontology.metrics.lastUpdated": "Last update",
  "ontology.metrics.noRecord": "No record",
  // 수 뒤에 공백 없이 붙는다(`3 found`) — 한국어 `건`이 선 자리다. 복수형 장치가 없는데
  // **이 자리는 1이 실제로 뜬다**(`잉여 클래스 1건`을 화면에서 봤다) — 그래서 `items`처럼
  // 수를 세는 명사를 안 쓰고 수가 몇이든 같은 꼴인 낱말을 골랐다. 아래 두 접두는 그 꼬리를
  // 물고 문장이 되게 맞췄다.
  "ontology.unit.count": " found",
  "ontology.metrics.violationsPrefix": "Schema violations —",
  "ontology.metrics.moreCountPrefix": "Another",
  "ontology.metrics.fixTicketPrefix": "Cleanup ticket",
  "ontology.empty.heading": "Answer a few questions and you get files to start from",
  // 가운데에 `tick.sh`와 `ontology/`가 차례로 낀다(`… — tick.sh just moves on when
  // ontology/ is empty.`) — `protocols.empty.*`가 선 그 벌이다.
  "ontology.empty.bodyPrefix": "This project runs even if you skip this —",
  "ontology.empty.bodyMiddle": " just moves on when",
  "ontology.empty.bodySuffix": " is empty.",
  "ontology.empty.skipHint": "Nothing worth answering? Skip it and start from an empty file.",

  // `boardPage.action.*`와 **같은 문장 둘이다** — 같은 거절을 화면마다 각자 말하는 자리라
  // 낱말이 갈리면 안 된다(`f3a8794e`가 선 그 벌).
  "ontology.action.unknownProjectPrefix": "Not a registered project:",
  "ontology.action.hashExhausted":
    "Drew 10 hashes and every one is already taken — check the queue directory.",

  // §0-16 §발행 §묶음 표 행 8(프로젝트 관리 루트 셸) — P338-11(`95749c14`)이 뽑은 ko 키 126개의
  // 영어(티켓 `4c075aa9`). 등록되지 않은 프로젝트 한 줄은 `protocols.action.*`·`home.action.*`과
  // 글자 그대로 같게 뒀다 — 같은 거절을 화면마다 다른 말로 하지 않는다.
  "errorBoundary.title": "Couldn't render this screen",
  "errorBoundary.noReason": "No reason given",
  "errorBoundary.retry": "Try again",
  // 가운데에 `/p/<project>`가 낀다(`… If it looked like /p/<project>, that slug isn't in the
  // registry.`) — 한국어는 조각 뒤에 조사가 붙고 영어는 콤마가 붙는다.
  "notFound.project.title": "Not found",
  "notFound.project.bodyPrefix": "No screen matches this URL. If it looked like",
  "notFound.project.urlExample": "/p/<project>",
  "notFound.project.bodySuffix": ", that slug isn't in the registry.",
  "notFound.project.link": "Project list",
  "notFound.root.title": "404",
  "notFound.root.body": "There's no page at this address.",
  "notFound.root.homeLink": "Go home",

  // `lib/scaffold.ts` — 엔진 미발견 한 줄은 `<prefix> <repo><mid> <hint>`로 조립된다. 한국어
  // `mid`는 조사로 붙지만 영어는 앞에 공백 하나가 필요하다(`<repo> has no tick.sh.`).
  "scaffold.engineNotFoundPrefix": "Couldn't find the engine repo —",
  "scaffold.engineNotFoundMid": " has no tick.sh.",
  "scaffold.engineNotFoundEnvHint": "That's where DIRA_ENGINE points.",
  "scaffold.engineNotFoundDefaultHint": "The GUI has to run from <engine repo>/apps/teams/.",
  "scaffold.notAbsolutePrefix": "Needs an absolute path:",
  "scaffold.emptyPlaceholder": "(empty)",
  "scaffold.alreadyQueueSuffix": " is already a dira project. Register it instead of creating it.",
  "scaffold.notQueueSuffix":
    " already exists but isn't a dira project. Create tickets/ and workers/ inside it, or delete it and create it again.",

  // `lib/projects.ts` — 경로 뒤에 붙는 넷(`mountNotFound`·`notDirectory`·`alreadyRegistered`·
  // `dupId`)은 값과 공백 없이 이어지므로 영어 쪽에 앞 공백을 둔다.
  "projects.keymapNotObject": "Top level isn't an object",
  "projects.registryShapePrefix": "The registry has an odd shape (no projects array):",
  "projects.nameRequired": "Enter a name.",
  "projects.notAbsolutePrefix": "Needs an absolute path:",
  "projects.emptyPlaceholder": "(empty)",
  "projects.mountNotFoundSuffix": " doesn't exist. Check the absolute path, and check that the mount is connected.",
  "projects.notDirectorySuffix": " isn't a directory.",
  "projects.notAQueueBody":
    "This directory has neither tickets/ nor workers/ — it isn't a dira project. Create tickets/ and workers/ inside it, or delete it and start again from [New project].",
  "projects.alreadyRegisteredPrefix": "Already registered as",
  "projects.alreadyRegisteredSuffix": ".",
  "projects.badIdFormatPrefix": "Bad URL slug — lowercase letters, digits and hyphens, 1-40 characters:",
  "projects.needIdMessage":
    "Couldn't build a URL slug from that name. Set one yourself (lowercase letters, digits, hyphens).",
  "projects.dupIdPrefix": "The URL slug",
  "projects.dupIdSuffix": " is already taken. Use a different name, or set the slug yourself.",
  "projects.unknownProjectIdPrefix": "Unknown project:",
  "projects.notAPersonaNamePrefix": "Not a persona name:",
  "projects.notInPalettePrefix": "Not a palette color:",
  // 이름 규칙 한 줄은 `<prefix> <name> <middle><file> <suffix>`로 조립된다 —
  // `… — the engine builds <personas>/<name>/PROFILE.md from this name.`
  "projects.personaNameRulePrefix": "Persona names take letters, digits, _ and - only:",
  "projects.personaNameRuleMiddle": "— the engine builds <personas>/<name>/",
  "projects.personaNameRuleSuffix": "from this name.",
  "projects.squadNameRulePrefix": "Squad names take letters, digits, _ and - only:",
  "projects.squadNameRuleSuffix": "— the engine builds <squads>/<name>/members from this name.",

  // `app/actions.ts` §7 해석 결과 표 — 배지 넷은 값 옆 꼬리라 소문자다(`protocols.usingDefault`·
  // `ontology.usingDefault`가 선 그 벌, 아래 낱말 표의 `기본값 가정` 줄).
  "resolve.badge.assumedDefault": "assumed default",
  "resolve.badge.resolveFailed": "resolve failed",
  "resolve.badge.outsideRoot": "outside root",
  "resolve.badgeHint.assumedDefault": "The worker file doesn't set this, so the default is used",
  "resolve.badgeHint.resolveFailed":
    "A variable other than $HOME is still in the value, so it couldn't be read — the screen uses the default",
  "resolve.badgeHint.outsideRoot": "Points outside the project root",
  "resolve.conflictBadge": "differs per worker",
  "resolve.conflictAlert.title": "Workers disagree on this setting",
  "resolve.conflictAlert.body": "The result changes with whichever worker picks the ticket up.",
  "resolve.key.inProgress": "In-progress suffix",
  "resolve.key.done": "Done suffix",
  "resolve.key.personas": "Personas",
  "resolve.key.protocols": "Protocols",
  "resolve.key.cwd": "Working directory",
  "resolve.key.workers": "Workers",
  // 개수 뒤에 공백 없이 붙는다 — `w1 w2 w3 (3 total)`.
  "resolve.workers.countSuffix": " total",
  "resolve.workers.empty": "None — this project doesn't run",
  "resolve.unknownProjectPrefix": "Not a registered project:",

  "project.branchRequired": "Enter an integration branch.",
  "project.createdRegisterFailedPrefix": "— .dira was created at",
  "project.createdRegisterFailedSuffix": ". Register that path from the register card.",
  "project.moveNoRoom": "No room left to move it.",

  // `components/projects-ui.tsx` — 생성 폼·다이얼로그(§비주얼 §7 생성).
  "project.create.blurb":
    "Creates .dira and puts one worker in crontab — it starts picking up tickets 30 seconds later.",
  "project.create.submitPending": "Creating…",
  "project.create.submit": "Create project",
  "project.create.nameLabel": "Name",
  "project.create.namePlaceholder": "dira itself",
  "project.create.idLabel": "URL slug",
  "project.create.idHint":
    "Couldn't build a URL slug from that name. Set one yourself (lowercase letters, digits, hyphens).",
  "project.create.dirLabel": "Project folder",
  "project.create.dirHelp": ".dira goes in here. ~ is expanded",
  "project.create.branchLabel": "Integration branch",
  "project.create.specLabel": "Spec document",
  "project.create.specHelp": "Optional. Leave it empty and that line (one row of the AGENTS.md map table) stays a placeholder",
  "project.create.ontologyLabel": "Ontology location",
  "project.create.ontologyPlaceholder": "<project folder>/.dira/ontology",
  "project.create.ontologyHelp": "Optional. Leave it empty and the default (<project folder>/.dira/ontology) is used",
  "project.create.existsTitle": "Nothing was created",
  "project.create.existsRegisterButton": "Go to register",
  "project.create.failedTitle": "Couldn't create it",
  "project.create.permissionHint": "Press [Allow] if a permission window opens — registering the crontab line waits on that answer.",
  "project.create.cancel": "Cancel",
  "project.create.dialogTitle": "New project",

  // `components/projects-ui.tsx` — 목록 표(§비주얼 §7).
  "project.list.nameHeader": "Name",
  "project.list.pathHeader": "Path",
  "project.list.openHeaderTitle": "Tickets whose file is open — waiting, waiting on deps, and assigned",
  "project.list.openHeader": "Open",
  "project.list.inProgressHeader": "In progress",
  "project.list.doneHeader": "Done",
  "project.list.connectedHeader": "Connected",
  "project.list.actionsHeader": "Actions",
  "project.list.personasLabel": "Personas",
  "project.list.personasEmpty": "None",
  "project.list.workersLabel": "Workers",

  // 행 액션 — 손잡이 이름 앞에 프로젝트 이름이 붙는다(`dira Move up`).
  "project.row.up": "Move up",
  "project.row.down": "Move down",
  "project.row.settings": "Settings",

  // `components/projects-ui.tsx` — 설정 다이얼로그(이름 변경·등록 해제·해석 결과).
  "project.settings.confirmTitle": "Unregister project",
  "project.settings.confirmDescSuffix":
    " comes off the list. This project's tickets aren't deleted — only the registry entry goes.",
  "project.settings.confirmNote": "Register the same path again and it comes back as it was.",
  "project.settings.cancel": "Cancel",
  "project.settings.unregisterFailed": "Couldn't unregister it.",
  "project.settings.unregisterButton": "Unregister",
  "project.settings.readFailedTitle": "Couldn't read the settings",
  "project.settings.resolveResultsHeading": "Resolved values",
  "project.settings.loading": "Reading…",
  "project.settings.reload": "Read again",
  "project.settings.renameLabel": "Name",
  "project.settings.save": "Save",
  "project.settings.renameFailed": "Couldn't rename it.",
  "project.settings.slugNotePrefix": "The URL slug",
  "project.settings.slugNoteSuffix": " doesn't change — open links and bookmarks would break.",
  "project.settings.branchChangedPrefix": "Rewrote: ",

  // `components/projects-ui.tsx` — 온톨로지 마이그레이션 섹션. `linkPrefix` 뒤에 해시와 상태가
  // 차례로 붙는다(`Migration 4c075aa9 done`).
  "project.ontologyMigration.title": "Ontology migration",
  "project.ontologyMigration.description":
    "Sets one up if there's none, and re-applies the latest conventions if there is. Safe to run again.",
  "project.ontologyMigration.linkPrefix": "Migration",
  "project.ontologyMigration.startPending": "Publishing…",
  "project.ontologyMigration.start": "Start migration",
  "project.ontologyMigration.failedTitle": "Couldn't create the migration ticket",

  // `components/feedback-dialog.tsx` — `feedback.versionLabel`·`feedback.sessionLabel`은 이미
  // 찬 키를 그대로 쓴다(P338-11이 그렇게 갈랐다).
  "feedbackDialog.title": "Send feedback",
  "feedbackDialog.description":
    "It opens as a GitHub issue with the text already filled in — you press submit there yourself.",
  "feedbackDialog.textareaLabel": "Feedback",
  "feedbackDialog.placeholder":
    "Just write what got in your way, or what you need.\nThe first line becomes the issue title.",
  "feedbackDialog.metaNote": "These two lines go into the issue with it.",
  "feedbackDialog.truncated":
    "The text is long, so the tail won't reach the issue — that's the limit of sending through a URL. Send it in parts, or paste the rest into the issue before you submit it.",
  "feedbackDialog.submit": "Open a GitHub issue",

  // 세션 스트림(§0-16 §묶음 표 행 5 갈래, `f2fcf747`) — `components/session-stream.tsx` ·
  // `lib/interject.ts` · `lib/transcript.ts`. ko는 `33563f49`가 넣었다.
  //
  // 묶음 줄의 수 세기는 `기록 n건` -> `Records n`이다. 영어는 단위 낱말이 수 앞으로 못 가서
  // 꼬리가 빈다 — `persona.refs.openPrefix`가 `Open 2`로 이미 선 그 벌이고, `t`는 `""`를
  // 그대로 돌려주므로 한국어로 안 샌다.
  "sessionStream.recordCount.label": "Records",
  "sessionStream.recordCount.unit": "",
  "sessionStream.closedNoUpdate": "Session ended · no more updates",
  "sessionStream.scrollToBottom": "Jump to the bottom",
  "sessionStream.heading": "Progress record",
  // 엔진 이름이 접두와 접미 사이에 낀다. 한국어는 `<엔진>입니다`로 끝나지만 영어는 이름이
  // 명사구 가운데로 들어가서, 접미가 `engine`을 들고 문장을 닫는다
  // (`This worker runs the codex engine`). 이름 앞 공백은 JSX가 주고 뒤 공백은 접미가 든다.
  "sessionStream.engineIsPrefix": "This worker runs the",
  "sessionStream.engineIsSuffix": " engine",
  "sessionStream.noTranscriptSuffix": " leaves no transcript",
  "sessionStream.claudeOnlySuffix": " engine — interject only works on the claude engine",
  "sessionStream.noInboxStatic": "This session can't take an interject — the ticket has no inbox",
  "sessionStream.question": "Question",
  "sessionStream.answer": "Answer",
  // §비주얼 §21 실패 4종. 제목은 무엇이 안 됐는지, `next`는 지금 무엇을 다시 하는지다 — 사람이
  // 급할 때 읽는 자리라 원인만 적고 끝내지 않는다.
  "sessionStream.fail.enxio.title": "Couldn't send it — the session has ended",
  "sessionStream.fail.enxio.next":
    "No session is running on this ticket any more. Copy the text above into a new ticket and give the instruction there.",
  "sessionStream.fail.enoent.title": "Couldn't send it — there's no inbox",
  "sessionStream.fail.enoent.next":
    "The session just ended, or the engine never made the inbox. Send it once more, and if it still fails, give the instruction in a new ticket.",
  "sessionStream.fail.notWip.title": "Couldn't send it — the ticket isn't in progress",
  "sessionStream.fail.notWip.next": "An interject only reaches a running session. Give the instruction in a new ticket.",
  "sessionStream.fail.noInbox.title": "Couldn't send it — this session can't take an interject",
  "sessionStream.fail.noInbox.next":
    "It's an older session, or an engine that doesn't make an inbox. Give the instruction in a new ticket.",
  "sessionStream.fail.other.title": "Couldn't send it",
  // 완료 모드(이어받기) 실패 2종 — `Couldn't send it`로 시작하지 않는다(§21). 여기서 생기는 것은
  // FIFO로 가는 한 줄이 아니라 티켓 한 장이라, 동사가 `publish`다.
  "sessionStream.failDone.notDone.title": "Couldn't publish it — this isn't a done ticket",
  "sessionStream.failDone.notDone.next":
    "A follow-up belongs to a done ticket. Refresh and look again — if a session is running, this box turns into an interject.",
  "sessionStream.failDone.other.title": "Couldn't publish it",
  "sessionStream.failDone.other.next": "Copy the text above and publish it from the board.",
  "sessionStream.answerHint": "Answer it and this ticket comes back to the queue, and the session that holds it carries on.",
  "sessionStream.followupAria": "Follow-up",
  "sessionStream.interjectAria": "Interject",
  "sessionStream.followupPlaceholder": "Write what to do next",
  "sessionStream.interjectPlaceholder": "Say something to the running session",
  "sessionStream.followupHint": "One new open ticket comes out of this",
  "sessionStream.sentHint": "Sent · it shows in the stream below",
  "sessionStream.publishing": "Publishing…",
  "sessionStream.publishAction": "Publish follow-up",
  "sessionStream.sending": "Sending…",
  "sessionStream.sendAction": "Send",
  "sessionStream.sub": "Sub",
  "sessionStream.matchAllSuffix": "every match",
  "sessionStream.session": "Session",
  "sessionStream.person": "Person",

  // `lib/interject.ts`(§2-2) — 화면이 §21의 문구 넷을 가르는 근거가 이 사유들이다. 괄호가
  // 붙는 두 자리는 접두가 여는 괄호까지, `Mid`가 닫는 괄호와 콜론을 든다.
  "interjectLib.state.open": "Open",
  "interjectLib.state.wip": "In progress",
  "interjectLib.state.done": "Done",
  "interjectLib.emptyContent": "Type something to send.",
  "interjectLib.unknownTicketPrefix": "Not a ticket in the queue:",
  "interjectLib.notWipError": "This ticket isn't in progress — no session is running, so an interject has nowhere to land.",
  "interjectLib.statePrefix": "State:",
  "interjectLib.noInboxError":
    "This session has no interject inbox (no `inbox` in the frontmatter) — you can only talk to a session opened with streaming input.",
  "interjectLib.noInboxDetail": "no inbox in the frontmatter",
  "interjectLib.relativeInboxPrefix": "The interject inbox path isn't absolute:",
  "interjectLib.enxioError": "The session has already ended — the inbox is still there, but nothing is reading it.",
  "interjectLib.enoentError": "The interject inbox is gone — it went away when the session ended.",
  "interjectLib.openFailedPrefix": "Couldn't open the interject inbox (",
  "interjectLib.openFailedMid": "):",
  "interjectLib.notFifoPrefix": "The interject inbox isn't a FIFO:",
  "interjectLib.eagainError": "The interject inbox is full — wait for the session to read it, then send again.",
  "interjectLib.epipeError": "The session has already ended — the inbox closed while we were writing.",
  "interjectLib.writeFailedPrefix": "Couldn't write the interject (",
  "interjectLib.writeFailedMid": "):",

  // `lib/transcript.ts`(§2-1) — 사건 라벨과 단위 둘. 라벨은 `progress.stream.*`가 이미 세운
  // 대문자 한 낱말 꼴이고, 단위는 수 뒤에 바로 붙어서 앞 공백을 값이 든다.
  // 복수형 장치가 없어 늘 복수다.
  "transcriptLib.assigned": "Assignment",
  "transcriptLib.charsUnit": " chars",
  "transcriptLib.sessionPromptFirst": "Session prompt",
  "transcriptLib.prompt": "Prompt",
  "transcriptLib.thinking": "Thinking",
  "transcriptLib.tool": "Tool",
  "transcriptLib.result": "Result",
  "transcriptLib.linesUnit": " line(s)",

  // 에픽 갈래(§0-16 §묶음 표 행 12) - `lib/epics.ts`. 뒤에 값이 붙는 넷은 콜론까지가 접두다.
  "epicsLib.keyRequired": "Enter a key.",
  "epicsLib.titleRequired": "Enter a title.",
  "epicsLib.keyNoNewline": "A key can't contain a line break.",
  "epicsLib.keyOutsideQueuePrefix": "That key points outside the queue:",
  "epicsLib.keyExistsPrefix": "That key already exists:",
  "epicsLib.createFailedPrefix": "Couldn't create it:",
  "epicsLib.bodyRequired": "Enter a body.",
  "epicsLib.saveFailedPrefix": "Couldn't save:",
  "epicsLib.memoryFileNotFoundPrefix": "No such memory file in the list:",

  // `lib/epic.ts` - 카드를 에픽에 끌어다 놓는 쓰기의 실패 문구. 첫 줄의 임자는 frontmatter
  // 키 이름이라 소문자 그대로다(`boardPage.action.noNewlineSuffix`가 선 그 벌).
  "epicLib.noNewline": "epic can't contain a line break.",
  "epicLib.notFoundPrefix": "Not a ticket in the queue:",
  "epicLib.noFrontmatterPrefix": "No frontmatter:",

  "usageLib.unknown": "Unknown",
  "usageLib.thisEpic": "This epic",
  "usageLib.sessionCount.label": "Sessions",
  "usageLib.sessionCount.unit": "",
  "usageLib.epic.knownPrefix": "· known token count for ",
  "usageLib.epic.knownMid": " of ",
  "usageLib.epic.knownSuffix": " tickets",
  "usageLib.title.noExitRecordPrefix": "No exit record in ",
  "usageLib.title.noExitRecordSuffix": " log(s) for this hash",
  "usageLib.title.noLogsSuffix": ": no matches on this machine",

  // ── 공개 사이트(§0-24, 티켓 00ba786b·P340-4) ──────────────────────────
  // 랜딩(`app/(site)/landing.tsx`) — 제품을 처음 만나는 사람이 읽는 마케팅 카피다. 절도
  // 절 순서도 한국어 원문 그대로 두고 문장만 영어로 옮겼다. 등록 폼 다섯 칸은 이미 찬
  // `project.create.*`와 같은 자리·같은 낱말이라 그 값을 글자 그대로 재사용한다.
  "landing.register.nameLabel": "Name",
  "landing.register.namePlaceholder": "dira itself",
  "landing.register.idLabel": "URL slug",
  "landing.register.idHint": "Couldn't build a URL slug from that name. Set one yourself (lowercase letters, digits, hyphens).",
  "landing.register.rootLabel": "Path",
  "landing.register.rootPickerLabel": "Queue path",
  "landing.register.rootHint": "Absolute path. ~ is expanded",
  "landing.register.errorTitle": "Couldn't register it",
  // 이미 등록된 프로젝트로 가는 링크 — 한국어는 이름 뒤에 `열기`가 붙고 영어는 동사가 앞에
  // 선다. `wrap`이 붙이고 빈 쪽을 지운다(§0-16 §장치 · `wrap` 주석).
  "landing.register.dupOpenPrefix": "Open",
  "landing.register.dupOpenSuffix": "",
  "landing.register.pendingLabel": "Checking the registration…",
  "landing.register.title": "Register project",

  "landing.result.createdLabel": "Created",
  "landing.result.registeredLabel": "Registered",
  "landing.result.openBoardLabel": "Open the board",
  // `{prefix} {n}{suffix}` — 숫자에 접미가 공백 없이 붙으므로 값이 공백으로 연다.
  "landing.result.filesWrittenPrefix": "Wrote",
  "landing.result.filesWrittenSuffix": " files.",
  "landing.result.skippedPrefix": "Already there, skipped:",
  "landing.result.engineRepoLabel": "Engine repo",
  "landing.result.cronRegistered": "In crontab — it starts picking up tickets 30 seconds from now",
  "landing.result.cronFailedTitle": "Couldn't register the crontab line",
  "landing.result.ontologyFailedTitle": "Couldn't set the ontology location",
  "landing.result.ontologyFailedLink": "Set it again from the ontology screen",
  "landing.result.denyCurrentBranchNotePrefix": "receive.denyCurrentBranch on the receiving tree is already a different value — left it alone:",

  // `{count}`는 `landing.tsx`가 `.replace()`로 채우는 자리표시자다(ko 쪽 주석 참고).
  "landing.banner.text": "Turn on auto-update and run the newest dira (v{count})!",
  "landing.banner.releasesLink": "See the releases",

  "landing.nav.manualLink": "Manual",
  "landing.nav.createLabel": "New project",
  "landing.nav.downloadAppLabel": "Download the app",
  "landing.nav.installGuide": "Install guide",

  "landing.projects.registryErrorTitle": "Couldn't read the project registry",
  "landing.projects.emptyHint": "No projects registered yet. Make one and you're started.",
  "landing.projects.registerHint": "Already have a .dira? Register it.",
  "landing.projects.newProjectTitle": "New project",

  "landing.hero.eyebrow": "Local multi-agent management system",
  "landing.hero.title": "Build your own AI team",
  "landing.hero.body":
    "Throw a request in however you like and it still lands. Watch the whole thing live, the way you would in jira: the tickets being split up, the agents working together to finish them. Your own multi-agent system, on your own machine, and it's easy to set up.",
  "landing.hero.downloadCta": "Download the macOS app",
  "landing.hero.shotAlt":
    "The dira board. Ticket cards sit in the three lanes Open, In progress and Done, and one of them crosses into the next lane.",
  "landing.hero.shotCaption": "Fun fact: the dira app was built with dira.",

  "landing.steps.title": "Say it and it gets done",
  "landing.steps.step1Title": "① Submit a request",
  "landing.steps.step1Body": "Write down what you want the way you would say it out loud. That's the whole job. The agents take the tedious, complicated rest.",
  "landing.steps.step2Title": "② Everything moves at once",
  "landing.steps.step2Body":
    "The agent that takes your request works it out and splits it into tickets, one per piece of work. A worker with the right persona picks up each ticket, and together they finish what you asked for.",
  "landing.steps.step3Title": "③ That's it. Easy, right?",
  "landing.steps.step3Body":
    "You see what the workers read and how they change it, live. When one gets stuck mid-job, it asks you. Ask and answer the way you would with a person, and the feature you wanted is finished!",

  "landing.archiving.title": "Finished work stays on the record",
  // `<b>{boldPrefix} <code>.done</code>{boldSuffix}</b> {prefix} <code>Archiving</code> {suffix}` —
  // 코드 조각 둘이 문장 안에 박혀 있어 조각 넷의 자리가 고정이다(`wrap` 자리가 아니다).
  "landing.archiving.item1BoldPrefix": "Once a ticket turns",
  "landing.archiving.item1BoldSuffix": ", one archive ticket follows it.",
  "landing.archiving.item1Prefix": "An",
  "landing.archiving.item1Suffix": "line shows up under the done card, and because a worker takes that one too you can watch how far it has got",
  "landing.archiving.item2Bold": "What's left is one markdown file and one section at the foot of the ticket.",
  "landing.archiving.item2Prefix": "The worker that took the archiving picks the facts out of the job just finished, writes them into",
  "landing.archiving.item2Mid": " in the project folder, and adds a",
  "landing.archiving.item2Suffix": "section to that ticket's body",
  "landing.archiving.item3Bold": "The next session starts out knowing where that is.",
  "landing.archiving.item3Body": "Where the ontology sits and how to search it goes out in every prompt a worker gets",
  "landing.archiving.item4Bold": "The files are plain markdown.",
  "landing.archiving.item4Wikilink": "[[link]]",
  "landing.archiving.item4Body": " ties them to each other, so a tool like Obsidian opens the folder whole. Move the project and the record moves with it",
  "landing.archiving.promiseBody":
    "The more you hand over, the better the workers know this project. They start by reading who decided what yesterday, so you never say the same thing twice.",
  "landing.archiving.shotAlt":
    "The In progress and Done lanes of the dira board. The second card in Done, a732ce19, carries a filing-cabinet icon and an «Archiving» line in its bottom row, and the card above it has no such line.",
  "landing.archiving.shotCaption": "That line is a link. Press it and you land on the archive ticket, where you can see how far its worker has got.",
  "landing.archiving.arrowLink": "Archiving and the ontology",

  "landing.gallery.openOriginal": "Open at full size",
  "landing.gallery.bargeAlt":
    "While the session stream adds one tool call after another, a sentence typed into the box below and sent shows up in the stream as an interject line, and the session changes course from there.",
  "landing.gallery.bargeCaption":
    "\"Fair enough, nobody's perfect.\" Your request doesn't have to be perfect. Ask loosely, and interject while the work is running.",
  "landing.gallery.bargeArrowLink": "Talking to a running session",
  "landing.gallery.qaAlt": "The question and answer thread on a request ticket. An answer bubble sits to the right under the question, and the frontmatter carries an awaiting hash.",
  "landing.gallery.qaCaption": "Of course they ask when they don't know. Agents run into things they can't decide, and then they ask. Answer the question and they go straight back to work.",
  "landing.gallery.qaArrowLink": "Asking back and answering",
  "landing.gallery.runningAlt": "An in-progress ticket page. The body and the Done when checklist on the left, the frontmatter table and relations on the right.",
  "landing.gallery.runningCaption":
    "You can look into the work one ticket at a time. If it's heading somewhere you didn't mean, unassign the ticket and it stops. On a ticket that hasn't started yet, edit the body and spell out the direction you want.",
  "landing.gallery.runningArrowLink": "Work you can see",
  "landing.gallery.ontologyAlt":
    "The ontology screen. Under the title sits the path of the folder holding the cards, and below it a metrics panel of twelve cells, object · relation 96 · 184 among them. Beneath that the card file tree is on the left, and on the right an editor has the selected file _ontology/SCHEMA.md open in rich text.",
  "landing.gallery.ontologyCaption": "Every time a ticket ends, the facts picked out of that job pile up here, one card at a time. They stay as markdown inside the project folder, so the next session and you open the same place.",

  "landing.noAccount.title": "You don't need an account",
  "landing.noAccount.item1Bold": "dira has no server.",
  "landing.noAccount.item1Body": "No sign-up, no login. Download it and open it, that is all, and nothing you make gets uploaded anywhere",
  "landing.noAccount.item2Bold": "Tickets and records are both inside the project folder.",
  "landing.noAccount.item2Prefix": "The queue is the single directory",
  "landing.noAccount.projectPlaceholder": "project",
  "landing.noAccount.item2Suffix": "and what it holds is markdown files. There is nowhere to set permissions, so being able to open that folder is the permission",
  "landing.noAccount.item3Bold": "The work does go out to the model.",
  "landing.noAccount.item3Body": "When a worker starts a session, the ticket body and the code it needs travel through the engine you picked and reach the model. Outside that one channel, dira takes nothing away",
  "landing.noAccount.item4Bold": "Turning usage analytics off is all it takes.",
  "landing.noAccount.item4Prefix":
    "We count eight things about what you press on screen. Ticket titles, ticket bodies, file paths and prompts are not carried. Turn it off in settings and nothing goes out from that moment on, and to wipe what is left, delete the one file",
  "landing.noAccount.item4Suffix": "and you are done",
  "landing.noAccount.shotAlt":
    "The first screen when no project is registered. Under the line saying there are none, the New project card is open, with the Name, Project folder, Integration branch and Spec document fields and a Create project button.",
  "landing.noAccount.shotCaption": "This is the screen the first time you open it after installing. You fill in a name and a project folder, and there is no field for an account.",
  "landing.noAccount.arrowLink": "Usage analytics, and how to turn them off",

  "landing.stats.dependenciesLabel": "Engine dependencies",
  "landing.stats.dependenciesValue": "bash + the python3 standard library",
  "landing.stats.concurrentWorkersLabel": "Workers running at once in this repo",
  "landing.stats.ticketsLabel": "Tickets its own queue took",
  "landing.stats.ticketsValue": "1762 done",
  "landing.stats.hoursBig": "62 hours",
  "landing.stats.hoursLabel": "From first commit to first release",
  "landing.stats.hoursCommitsValue": "351 commits",
  "landing.stats.note": "As of 2026-08-12",

  "landing.install.eyebrow": "Install",
  "landing.install.title": "Download it, install it, done",
  "landing.install.body": "Get it and open it. You never have to open a terminal.",
  // `<b>① <code>.dmg</code>{step1BoldSuffix}</b> <code>dira.app</code>{step1AppSuffix}
  //  <code>Applications</code>{step1Body}` — 번호와 코드 조각 셋의 자리가 고정이다.
  "landing.install.step1BoldSuffix": " — open it and drag.",
  "landing.install.step1AppSuffix": " goes into",
  "landing.install.applicationsFolder": "Applications",
  "landing.install.step1Body": " and the install is over. The build is signed and notarized, so the Mac won't stop you on first open with a warning about an app it doesn't know",
  "landing.install.step2Bold": "② Open the app for the first time and the form is already unfolded.",
  "landing.install.step2Prefix": "Put in a name and a project folder, then press",
  "landing.install.step2Suffix": ".",
  "landing.install.step3Bold": "③ Thirty seconds later a worker starts sweeping the queue.",
  "landing.install.step3Body": "Leave a ticket there and it gets picked up from then on",
  "landing.install.item1BoldPrefix": "The engine is one of four —",
  "landing.install.item1BoldMid": ",",
  "landing.install.item1BoldSuffix": ", grok and agy.",
  "landing.install.item1Prefix": "You pick the model along with the worker, and a name that isn't in the list you type in yourself. After that, press the",
  "landing.install.item1Mid": "column on the workers screen to change it. Interject is on",
  "landing.install.item1Suffix": " only, and the session stream is on claude and grok. The app runs on Apple Silicon Macs only",
  "landing.install.item2Bold": "You can also run the engine alone, with no screen.",
  "landing.install.item2Prefix": "On Linux, or when you don't need a screen, follow",
  "landing.install.item2LinkText": "the route that gets the repo directly",
  "landing.install.item2Suffix": ".",
  "landing.install.fullGuideLink": "Full install guide",
  "landing.install.firstTicketLink": "Create your first project",
  "landing.install.cronOnlyLink": "Running the engine alone",

  "landing.plan.eyebrow": "Plans",
  "landing.plan.cycleResumeAriaLabel": "Resume the plan card cycle",
  "landing.plan.cyclePauseAriaLabel": "Stop the plan card cycle",
  "landing.plan.title": "Start free on your own machine",
  "landing.plan.freeItem1": "Install and run the local app and engine yourself",
  "landing.plan.freeItem2": "P2P collaboration with your teammates",
  "landing.plan.freeItem3": "Engine MCP",
  "landing.plan.soon": "Soon",
  "landing.plan.freeBody": "The local engine and app are free forever. dira is rooting for a multi-agent ecosystem that builders make.",
  "landing.plan.proItem1": "Cloud projects",
  "landing.plan.proItem2": "dira's own cloud LLM",
  "landing.plan.proItem3": "Web hosting for what you build",
  "landing.plan.proItem4": "Cloud workers",
  "landing.plan.enterpriseItem1": "Enterprise-only customization",
  "landing.plan.enterpriseItem2": "Hooks into your internal tools",
  "landing.plan.personaMarket": "Persona market",
  "landing.plan.personaMarketItem": "We build the ecosystem together too",
  "landing.plan.ctaBody": "No sign-up, no payment. Delete it if it doesn't suit you, so install it and see.",

  "landing.footer.productHeading": "Product",
  "landing.footer.downloadLink": "Download",
  "landing.footer.releasesLink": "Releases",
  "landing.footer.engineLink": "Engine",
  "landing.footer.docsHeading": "Docs",
  "landing.footer.templatesLink": "Templates",
  "landing.footer.repoHeading": "Repo",
  "landing.footer.issuesLink": "Issues",
  "landing.footer.licenseLink": "MIT license",
  "landing.footer.copyright": "© 2026 Proofer Inc. MIT.",
  "landing.footer.termsLink": "Terms of service",
  "landing.footer.privacyLink": "Privacy policy",

  "landing.registerDialog.description": "Puts an existing .dira on the list. It creates no files.",

  // 매뉴얼 사이드바 — 그룹 6 + 링크 26. 낱말은 `en/glossary.md` §Chapter titles와
  // §Section groups 표에서 글자 그대로 가져온다(그 표가 각 장 `# ` 제목의 정본이다).
  "manualSidebar.group.gettingStarted": "Getting started",
  "manualSidebar.group.watching": "Watching",
  "manualSidebar.group.writing": "Writing your own",
  "manualSidebar.group.extending": "Scaling up",
  "manualSidebar.group.operating": "Operating",
  "manualSidebar.group.appendix": "Appendix",
  "manualSidebar.item.whatIsDira": "About dira",
  "manualSidebar.item.install": "Install",
  "manualSidebar.item.firstTicket": "Create your first project",
  "manualSidebar.item.requirements": "Submitting a request",
  "manualSidebar.item.screens": "The screens",
  "manualSidebar.item.bargeIn": "Talking to a running session",
  "manualSidebar.item.ticketWriting": "Writing a ticket yourself",
  "manualSidebar.item.states": "The states a ticket passes through",
  "manualSidebar.item.worker": "Workers",
  "manualSidebar.item.concurrency": "How many to run at once",
  "manualSidebar.item.personas": "Personas",
  "manualSidebar.item.squads": "Squads",
  "manualSidebar.item.protocols": "Protocols",
  "manualSidebar.item.ontology": "Archiving and the ontology",
  "manualSidebar.item.epics": "Epics",
  "manualSidebar.item.auth": "Authentication",
  "manualSidebar.item.troubleshooting": "Troubleshooting",
  "manualSidebar.item.logs": "Reading the logs",
  "manualSidebar.item.analytics": "Usage analytics, and how to turn them off",
  "manualSidebar.item.schedules": "Schedules",
  "manualSidebar.item.webhook": "Sending Awaiting answer somewhere else",
  "manualSidebar.item.closing": "Closing",
  "manualSidebar.item.cron": "Running the engine alone",
  "manualSidebar.item.refEnv": "Worker environment variables",
  "manualSidebar.item.refCli": "CLI",
  "manualSidebar.item.refFrontmatter": "frontmatter fields",

  // 매뉴얼 셸 — 27장을 오가는 길잡이라 라벨은 짧게 둔다. `프로젝트 관리`는 앱 셸이 이미 쓰는
  // `shell.nav.projects`와 같은 낱말로 맞춘다(같은 곳으로 가는 같은 링크다).
  "manualShell.darkToggleAriaLabel": "Dark mode",
  "manualShell.navToggleAriaLabel": "Open the menu",
  "manualShell.menuToggleAriaLabel": "Open the sidebar",
  "manualShell.menuLabel": "Menu",
  "manualShell.copiedLabel": "Copied",
  "manualShell.copyLabel": "Copy",
  "manualShell.copyCodeAriaLabel": "Copy the code",
  "manualShell.skipLink": "Skip to the content",
  "manualShell.projectsLink": "Manage projects",
  "manualShell.sidebarAriaLabel": "Manual contents",
  "manualShell.editPageLink": "Edit this page",
  "manualShell.prevNextAriaLabel": "Previous and next pages",
  "manualShell.prevLabel": "Previous",
  "manualShell.nextLabel": "Next",
  "manualShell.onThisPageLabel": "On this page",

  // 공개 사이트 오류·부재·메타. 앞의 둘은 앱 화면의 `errorBoundary.*`·`notFound.root.*`와
  // 한국어가 같은 자리라 그 벌의 낱말을 따라간다(그쪽은 화면, 이쪽은 페이지다).
  "siteError.title": "Couldn't render this page",
  "siteError.noReason": "No reason given",
  "siteError.retry": "Try again",
  "siteNotFound.body": "There's no page at this address.",
  "siteNotFound.homeLink": "Go home",
  "siteMeta.description": "Drop a ticket in the queue and a cron-driven worker hands it to a claude session. A ticket dispatcher whose queue is the filesystem.",
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
