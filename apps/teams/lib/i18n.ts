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
  "settings.search.multitokenToggle": "다중계정 허용",
  "settings.search.multiplayToggle": "다중계정 동시사용",

  "settings.tree.authGroup": "인증",
  "settings.tree.keymap": "키설정",
  "settings.tree.stats": "사용 통계",
  // 사이드바 트리에는 안 선다(§0-18) — 검색으로만 닿는다. 그래도 이름은 다른 노드와 같은
  // 키 규약(`settings.tree.<node>`)을 쓴다 — 화면 자리가 하나 늘 뿐 이름 짓는 법은 안 갈린다.
  "settings.tree.multiplay": "멀티플레잉",
  // 둘째 사이드바 그룹의 aria-label — 그룹 자신은 머리글이 없다(§45 ③), 접근가능 이름만 필요하다
  "settings.tree.categoryGroup": "설정 분류",
  // 여섯째 노드 — §0-10이 정한 글자, `언어` 다음(§비주얼 §45 §개정 `475d3385`)
  "settings.tree.webhook": "웹훅",

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

  "settings.multiplay.description":
    "다중계정 허용은 계정을 여러 장 등록할 수 있게 하고, 다중계정 동시사용은 그 계정들을 워커마다 나눠 동시에 씁니다.",
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

  "common.save": "저장",
  "common.saving": "저장 중…",
  "common.add": "추가",
  "common.close": "닫기",
  "common.cancel": "취소",
  "common.create": "만들기",
  "common.creating": "만드는 중…",

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
  // 같은 자리이고 둘 다 서면 한 줄에 이어 붙는다(§1-3의 그 자리 그대로).
  "ticket.duedate.derivedPrefix": "마감까지",
  "ticket.duedate.derivedMiddle": "— 우선순위",
  "ticket.duedate.derivedAfter": "로 뜹니다",
  // 1시간 미만 남은 파생 한 줄의 <남은> 자리(§1-4 §화면). 지난 마감은 이 자리에 안 온다 —
  // 호출부가 `bell.due.overdue`로 따로 그린다(`마감까지 지남`류 비문을 막는다, `4f7def31`).
  "ticket.duedate.underHour": "1시간 미만",
  // 역전 거부 — 입력 아래 한 줄 + 저장 버튼 비활성(§1-4 §화면). 해시 하나만 변수라 접미 하나.
  "ticket.duedate.reversalSuffix": "와 마감 순서가 어긋납니다 — 선행이 후행보다 늦게 끝날 수 없습니다",

  // 되돌아온 횟수 한 줄(§2-14 (2) · §비주얼 §11 §개정). `{prefix} {n}{suffix}` —
  // `bell.assigned.title*`와 같은 짝이다. 2회 이상일 때만 서고 1회 이하면 줄 자체가 없다.
  "ticket.retries.linePrefix": "다시 할당",
  "ticket.retries.lineSuffix": "회",

  // 남은 시간 표기(종 ⑦ 나열 · 상세 파생 한 줄)의 낱말 — 숫자에 공백 없이 바로 붙는다
  // (`3시간 30분`·`3h 30m`). en은 복수형 장치가 없는 이 앱 사정(§0-16) 그대로 약어로 피한다.
  "common.unit.hour": "시간",
  "common.unit.minute": "분",
  "common.unit.day": "일",

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
  // 업데이트 토스트 그릇의 낭독 이름(§비주얼 §55 (10)) — `<Toaster containerAriaLabel>`.
  "shell.update.ariaLabel": "알림",

  // 알림 종(§0-10 문구 표 · §비주얼 §28). `bell.due.*`(⑦)는 `a50c8304`가 먼저 옮겼다 — 아래는
  // 나머지 여섯(⑤①②③④⑥, §0-14 순서) + 트리거 자신의 배지 라벨.
  "bell.trigger.countPrefix": "알림",
  "bell.trigger.countSuffix": "건",
  "bell.trigger.empty": "알림 없음",
  // ②⑥ 둘 다 쓰는 `읽음으로 표시`(`project-switcher.tsx`의 두 버튼) — 한 낱말이라 키 하나.
  "bell.markRead": "읽음으로 표시",
  "bell.offline.title": "네트워크가 끊겨 있습니다",
  "bell.offline.body":
    "세션이 열리지 못하고 티켓은 그때마다 대기로 돌아갑니다. 연결이 돌아오면 저절로 재개됩니다.",
  "bell.offline.hint": "Wi-Fi 또는 유선 연결을 확인하세요.",
  "bell.resume.titleSlept": "잠자기에서 복귀했습니다",
  "bell.resume.titleWake": "꺼져 있다가 켜졌습니다",
  // `<from>부터 <to>까지 …` — 변수 둘이라 가운데·꼬리로 쪼갠다(`ticket.priority.inherited*`와 같은 조립).
  "bell.resume.middle": "부터",
  "bell.resume.after": "까지 큐가 멈춰 있었습니다. 잃은 것은 없습니다 — 이미 다시 돌고 있습니다.",
  "bell.resume.noAction": "고칠 일은 없습니다.",
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
  // 화면(`EngineCell`)이 `title`에 싣는다. claude의 실패도 §0-8 §재개정으로 이제 이 사유가 선다.
  "statusbar.limit.unknownOriginSuffix": "한도를 주는 원본을 모릅니다",
  "statusbar.limit.noRolloutSuffix": "rollout 파일이 없습니다",
  "statusbar.limit.rateLimitsNullSuffix": "rate_limits.primary·secondary가 모두 null입니다",
  "statusbar.limit.noRateLimitsSuffix": "최근 rollout에 rate_limits가 없습니다",
  "statusbar.limit.noUnifiedHeaderSuffix": "unified-5h·7d의 utilization이 없습니다",

  // 상태 배지(§비주얼 §2 · §4-1) — 보드·상세·워커 화면이 `status-badge.tsx` 하나를 공유하므로
  // 여기 한 벌만 옮기면 그 화면들도 같이 선다(그 화면들 자신의 이행은 각자의 묶음 몫이다).
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

  // 진행 기록 안 계획 아코디언(§비주얼 §59 ⑩) — 왼쪽 칸 상태 글리프의 `sr-only` 낱말 넷.
  // `기록 n건`은 §9 묶음 줄과 같은 문자열이라 여기 안 올린다(그 절의 범위 판정).
  "progress.plan.pending": "미착수",
  "progress.plan.cancelled": "취소",
  "progress.plan.doing": "진행중",
  "progress.plan.done": "완료",

  // 오류인 결과 줄 표식(§비주얼 §60 ⑧) — `결과`·`서브`·`n줄`은 무수정이라 키로 안 올린다.
  "progress.stream.error": "오류",

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
  "epics.empty": "에픽 없음",
  "epics.viewInBoard": "보드에서 보기",
  "epics.readme.missingBadge": "README 없음",
  "epics.readme.hint": "첫 줄 뒤에 적으면 여기 뜹니다.",
  "epics.readme.edit": "편집",
  "epics.readme.editDesc": "제목은 README.md 첫 줄, 내용은 그 뒤 본문입니다. 저장하면 파일을 덮어씁니다.",
  "epics.readme.bodyLabel": "내용",
  "epics.readme.saveFailed": "저장하지 못했습니다",
  "status.hint.awaiting": "PM이 되물었다 — 요구사항 상세에서 답을 쓰면 다시 큐에 뜬다. 자동 만료는 없다",
  "status.hint.assigned": "session_id가 박힌 열린 티켓 — 큐에서 영구 제외된다. 할당 해제로 되돌린다",

  // deps 배지(§2 deps 배지) — `DepBadge`가 쓴다.
  "dep.hint.met": "충족 — 완료된 티켓",
  "dep.hint.unmet": "미충족 — 아직 완료되지 않았다",
  "dep.hint.missing": "큐에 없는 해시 — 영구 대기",
  "dep.hint.answer": "답변 기록 — 이 요구사항의 답변",

  // 표 컬럼(§에픽 결정 7 §표뷰) — 띠 머리 라벨은 `board.epic.noTitle`을 그대로 재사용한다
  // (사이드바와 같은 글자여야 한다, §1 - 한 사실을 두 모양으로 그리지 않는다).
  "board.column.epic": "에픽",

  // 워커 결함 넷째(§0-21 결정 2, 티켓 b60520ea) — §4 표 넷째 줄과 같은 낱말. 앞의 셋은 아직
  // 이 사전으로 안 옮겨졌다(`workers/page.tsx`의 `DEFECT` 그대로) — 이 티켓의 몫은 이 하나뿐이다.
  "worker.defect.noExec.title": "실행 비트 없음",
  "worker.defect.noExec.why":
    "cron이 Permission denied로 워커를 못 띄웁니다 — tick.sh가 아예 안 돌아 runner.log가 한 줄도 늘지 않고, 열린 티켓이 그대로 섭니다.",
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
  "settings.search.multitokenToggle": "Allow multi-account",
  "settings.search.multiplayToggle": "Simultaneous multi-account use",

  "settings.tree.authGroup": "Authentication",
  "settings.tree.keymap": "Keyboard shortcuts",
  "settings.tree.stats": "Usage stats",
  "settings.tree.categoryGroup": "Setting categories",
  "settings.tree.multiplay": "Multiplaying",
  "settings.tree.webhook": "Webhook",

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

  "settings.multiplay.description":
    "Allow multi-account lets you register more than one account; simultaneous multi-account use splits them across workers to run at the same time.",
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

  "common.save": "Save",
  "common.saving": "Saving…",
  "common.add": "Add",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.create": "Create",
  "common.creating": "Creating…",

  "ticket.priority.label": "Priority",
  // 상속 한 줄. **`inheritedMiddle`이 공백으로 시작하는 것은 의도다** — 앞에 해시가 공백 없이
  // 바로 붙는다(한국어는 `<해시>가`로 조사가 붙어 공백이 없어야 하고, 영어는 낱말이 갈린다).
  // 꼬리는 비었다: 영어는 숫자가 문장 끝이라 뒤에 붙을 것이 없다. `t`는 `""`를 그대로 돌려주고
  // `ko` 폴백으로 안 샌다. 조립 결과는 `i18n.test.ts`가 두 언어 다 못박는다.
  "ticket.priority.inheritedMiddle": " is waiting on this, so it comes up as",
  "ticket.priority.inheritedAfter": "",
  // 다섯 항목의 꼬리. `Later`·`Sooner`는 짝으로 읽힌다 — 목록을 열면 다섯이 한 화면에 선다.
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
  // 바로 붙는 자리다). `2 of its prerequisites`로 적어 **1건일 때도 문장이 선다** — 이 앱에 복수형
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
  // 혼자 서서 문장 전체가 된다.
  "shell.switcher.emptyQueriedGlue": ":",
  "shell.switcher.emptySuffix": "No matching projects",
  "shell.switcher.openLabel": "open",
  "shell.update.ariaLabel": "Notifications",

  // 알림 종(§0-10 문구 표 · §비주얼 §28). 개수 제목 넷은 전부 `bell.due.titlePrefix`가 연 수를
  // 따른다 — **숫자를 뒤로 보내고 콜론으로 받는다.** 영어에서 `3 tickets …` 어순을 살리려면
  // 접두가 비어야 하고, 그러면 문장이 공백으로 시작한다.
  "bell.trigger.countPrefix": "Notifications:",
  "bell.trigger.countSuffix": "",
  "bell.trigger.empty": "No notifications",
  "bell.markRead": "Mark as read",
  "bell.offline.title": "The network is down",
  "bell.offline.body":
    "Sessions can't open, and every ticket goes back to Open as it happens. It all picks up again on its own once the connection returns.",
  "bell.offline.hint": "Check Wi-Fi or the wired connection.",
  "bell.resume.titleSlept": "Back from sleep",
  "bell.resume.titleWake": "The machine was off and came back",
  // `<from><중간> <to><꼬리>`. **중간이 공백으로 여는 것은 의도다** — 앞에 시각이 공백 없이
  // 바로 붙는다(`ticket.priority.inheritedMiddle`과 같은 사정).
  "bell.resume.middle": " to",
  "bell.resume.after": ": the queue sat stopped. Nothing was lost — it's already running again.",
  "bell.resume.noAction": "Nothing to fix.",
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

  "progress.plan.pending": "Not started",
  "progress.plan.cancelled": "Cancelled",
  "progress.plan.doing": "In progress",
  "progress.plan.done": "Done",

  "progress.stream.error": "Error",

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
  "epics.empty": "No epics",
  "epics.viewInBoard": "View in board",
  "epics.readme.missingBadge": "No README",
  "epics.readme.hint": "Add text after the first line to show it here.",
  "epics.readme.edit": "Edit",
  "epics.readme.editDesc": "The title is the first line of README.md and the body is what follows; saving overwrites the file.",
  "epics.readme.bodyLabel": "Body",
  "epics.readme.saveFailed": "Could not save",
  // 배지의 `title`이라 마침표로 안 닫는다(`ko`도 같다).
  "status.hint.awaiting":
    "The PM asked something back — write an answer on the request page and it returns to the queue. It never expires on its own",
  "status.hint.assigned":
    "An open ticket with a session_id in it — the queue skips it for good. Unassign puts it back",

  // deps 배지(§2 deps 배지).
  "dep.hint.met": "Met — that ticket is done",
  "dep.hint.unmet": "Unmet — not done yet",
  "dep.hint.missing": "No such hash in the queue — waits forever",
  "dep.hint.answer": "Answer on record — the answer to this request",

  "board.column.epic": "Epic",

  // Worker defect #4 (§0-21 decision 2, ticket b60520ea).
  "worker.defect.noExec.title": "No exec bit",
  "worker.defect.noExec.why":
    "cron can't start it — Permission denied. tick.sh never runs, so runner.log never gains a line and open tickets just sit there.",
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
