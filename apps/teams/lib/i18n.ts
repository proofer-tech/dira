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

  // 설정 `워커` 패널(§4-16 결정 5 · §비주얼 §68). 재사용 낱말(생성·중단·재등록·삭제·공통 배지)도
  // 이 패널은 t()로만 문구를 그리므로 키가 새로 난다 — 값은 워커 표(`workers-ui.tsx`)와 같다.
  "settings.workers.poolHeading": "공통 워커 풀",
  "settings.workers.allHeading": "전체 워커",
  "settings.workers.filterCrumb": "필터",
  "settings.workers.create": "워커 생성",
  "settings.workers.stop": "중단",
  "settings.workers.register": "재등록",
  "settings.workers.delete": "삭제",
  "settings.workers.commonBadge": "공통",
  "settings.workers.commonBadgeTitle":
    "이 워커는 공통 워커 풀의 슬롯입니다 — cron 줄은 풀에 있고 이 파일에는 없습니다",
  // "<n>곳" — 숫자 뒤에 바로 붙는다(`settings.search.emptySuffix`와 같은 접미 관용구, 공백 없음)
  "settings.workers.borrowedBySuffix": "곳",
  "settings.workers.filterProject": "프로젝트",
  "settings.workers.filterKind": "종류",
  "settings.workers.filterStatus": "상태",
  "settings.workers.filterReset": "필터 초기화",
  "settings.workers.filteredEmpty": "조건에 맞는 워커 0건",
  "settings.workers.poolEmpty": "공통 워커가 없습니다 — 만들면 빌리기를 켠 프로젝트마다 들어갑니다.",
  "settings.workers.projectsEmpty": "등록된 프로젝트가 없습니다.",

  "common.save": "저장",
  "common.saving": "저장 중…",
  "common.add": "추가",
  "common.close": "닫기",
  "common.cancel": "취소",
  "common.create": "만들기",
  "common.creating": "만드는 중…",

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
  "status.label.polling": "대기중",
  "status.label.pollingOverdue": "상한 지남",

  // 진행 기록 안 계획 아코디언(§비주얼 §59 ⑩) — 왼쪽 칸 상태 글리프의 `sr-only` 낱말 넷.
  // `기록 n건`은 §9 묶음 줄과 같은 문자열이라 여기 안 올린다(그 절의 범위 판정).
  "progress.plan.pending": "미착수",
  "progress.plan.cancelled": "취소",
  "progress.plan.doing": "진행중",
  "progress.plan.done": "완료",

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

  // 표 컬럼(§에픽 결정 7 §표뷰) — 띠 머리 라벨은 `board.epic.noTitle`을 그대로 재사용한다
  // (사이드바와 같은 글자여야 한다, §1 - 한 사실을 두 모양으로 그리지 않는다).
  "board.column.epic": "에픽",

  // 워커 결함 넷째(§0-21 결정 2, 티켓 b60520ea) — §4 표 넷째 줄과 같은 낱말. 앞의 셋은 아직
  // 이 사전으로 안 옮겨졌다(`workers/page.tsx`의 `DEFECT` 그대로) — 이 티켓의 몫은 이 하나뿐이다.
  "worker.defect.noExec.title": "실행 비트 없음",
  "worker.defect.noExec.why":
    "cron이 Permission denied로 워커를 못 띄웁니다 — tick.sh가 아예 안 돌아 runner.log가 한 줄도 늘지 않고, 열린 티켓이 그대로 뜹니다.",

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
  "persona.create.squadDescPrefix": "프로필이 있는 페르소나를 후보 풀로 묶습니다 — 티켓의",
  "persona.create.squadDescSuffix":
    "값이 되고, 디스패치가 그중 진행중이 가장 적은 하나를 고릅니다. 리더도 위임도 아닙니다.",
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
  // 워커 설정 다이얼로그 트리거(§4-15 결정 2 - §비주얼 §35 개정 ①, 티켓 ec2791db). 다이얼로그
  // 제목이 같은 낱말을 재사용해 새 문구는 이 하나로 끝난다.
  "workers.settingsDialog.trigger": "워커 설정",
  // 다이얼로그 셋째 섹션 — 공통 워커 빌리기(§4-16 결정 6 - §비주얼 §68 ④, 티켓 28c4d25f).
  "workers.pool.sectionTitle": "공통 워커 빌리기",
  "workers.pool.limitLabel": "상한",
  "workers.pool.limitNone": "없음",
  "workers.pool.limitPopoverLabel": "동시 빌리기 상한",
  "workers.pool.limitPopoverHint": "0이거나 비우면 안 빌립니다 — 상한은 동시에 도는 수이고 예약이 아닙니다.",
  "workers.pool.saveFailed": "상한을 저장하지 못했습니다.",
  "workers.pool.saveFailedTitle": "상한을 저장하지 못했습니다",
  "workers.pool.countPrefix": "공통 워커 ",
  "workers.pool.countSuffix": "명이 이 프로젝트에 들어와 있습니다",
  "workers.pool.countZero": "들어와 있는 공통 워커가 없습니다",
  "workers.pool.warnUnreadable": "pool-limit을 읽지 못했습니다 — 안 빌리는 것으로 읽습니다.",
  "workers.pool.blockedPrefix": "티켓을 물고 있어 못 뺀 공통 워커: ",
  // 다이얼로그 넷째(마지막) 섹션 — 스테일 수거(§4-17 결정 1, 티켓 642dd26f). 행의 `reap`
  // 버튼이 이 섹션 머리 하나로 옮겨온다 — 새로 짓지 않고 §4가 이미 쓰는 이름을 그대로 쓴다.
  "workers.reap.sectionTitle": "스테일 수거",
  // 프로젝트 워커 표 · 설정 워커 패널이 공유하는 배지(§4-16 결정 6 §68 ⑤ — 낱말은 §4-1의
  // `공통` 배지와 같다). 이 화면의 새 배지가 처음 i18n을 타는 자리다.
  "workers.pool.badge": "공통",
  "workers.pool.badgeTitle": "이 워커는 공통 워커 풀의 슬롯입니다 — cron 줄은 풀에 있고 이 파일에는 없습니다",
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

  // 찾기 바(`find-bar.tsx`, `f3a8794e`) — 보드 화면 전용이 아니라 여러 화면이 무는 공용
  // 컴포넌트라(레이아웃·홈·업데이트 토스트·경로 피커) 화면 접두가 아니라 파일 접두다
  // (묶음 11과 같은 판단). en은 `6d818d48`가 채운다.
  "findBar.placeholder": "찾기",
  "findBar.prev": "이전",
  "findBar.next": "다음",
  "findBar.close": "닫기",
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

  "settings.workers.poolHeading": "Common worker pool",
  "settings.workers.allHeading": "All workers",
  "settings.workers.filterCrumb": "Filter",
  "settings.workers.create": "Create worker",
  "settings.workers.stop": "Stop",
  "settings.workers.register": "Register",
  "settings.workers.delete": "Delete",
  "settings.workers.commonBadge": "Common",
  "settings.workers.commonBadgeTitle":
    "This worker is a slot in the common worker pool — the cron line lives in the pool, not this file",
  // "<n> projects" — a space precedes it (English reads naturally with one, unlike the Korean suffix)
  "settings.workers.borrowedBySuffix": " projects",
  "settings.workers.filterProject": "Project",
  "settings.workers.filterKind": "Kind",
  "settings.workers.filterStatus": "Status",
  "settings.workers.filterReset": "Clear filters",
  "settings.workers.filteredEmpty": "0 workers match the filter",
  "settings.workers.poolEmpty": "No common workers — creating one adds it to every project that borrows.",
  "settings.workers.projectsEmpty": "No registered projects.",

  "common.save": "Save",
  "common.saving": "Saving…",
  "common.add": "Add",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.create": "Create",
  "common.creating": "Creating…",

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

  "progress.plan.pending": "Not started",
  "progress.plan.cancelled": "Cancelled",
  "progress.plan.doing": "In progress",
  "progress.plan.done": "Done",

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
  "status.hint.pollingOverdue": "The polling deadline has passed — the next tick locks it as awaiting answer",

  // deps 배지(§2 deps 배지).
  "dep.hint.met": "Met — that ticket is done",
  "dep.hint.unmet": "Unmet — not done yet",
  "dep.hint.missing": "No such hash in the queue — waits forever",
  "dep.hint.answer": "Answer on record — the answer to this request",

  // Ticket detail "Polling" section (§폴링 대기 결정 9).
  "polling.section.title": "Polling",
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

  "board.column.epic": "Epic",

  // Worker defect #4 (§0-21 decision 2, ticket b60520ea).
  "worker.defect.noExec.title": "No exec bit",
  "worker.defect.noExec.why":
    "cron can't start it — Permission denied. tick.sh never runs, so runner.log never gains a line and open tickets just sit there.",

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
    "Groups personas that have a profile into a candidate pool — it becomes a ticket's",
  "persona.create.squadDescSuffix":
    "value, and dispatch picks whichever member has the fewest tickets in progress. It isn't a leader and it isn't delegation.",
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
  "workers.settingsDialog.trigger": "Worker settings",
  "workers.pool.sectionTitle": "Borrow shared workers",
  "workers.pool.limitLabel": "Limit",
  "workers.pool.limitNone": "None",
  "workers.pool.limitPopoverLabel": "Concurrent borrow limit",
  "workers.pool.limitPopoverHint": "0 or empty means no borrowing — the limit is how many run at once, not a reservation.",
  "workers.pool.saveFailed": "Couldn't save the limit.",
  "workers.pool.saveFailedTitle": "Couldn't save the limit",
  "workers.pool.countPrefix": "",
  "workers.pool.countSuffix": " shared worker(s) are in this project",
  "workers.pool.countZero": "No shared workers are in this project",
  "workers.pool.warnUnreadable": "Couldn't read pool-limit — reading it as not borrowing.",
  "workers.pool.blockedPrefix": "Still holding a ticket, couldn't remove: ",
  "workers.reap.sectionTitle": "Stale collection",
  "workers.pool.badge": "Shared",
  "workers.pool.badgeTitle": "This worker is a slot in the shared worker pool — the cron line lives in the pool, not this file",
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
