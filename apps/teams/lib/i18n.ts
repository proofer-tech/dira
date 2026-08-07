/** 화면 문구 사전 — 한국어/영어 두 벌 + 조회 하나 (DESIGN.md §0-16 §장치).
 *
 *  **의존성 0.** `next-intl` 같은 라이브러리가 주는 로케일 라우팅·복수형·날짜 포맷은 이 앱에
 *  없다 — 단일 사용자 로컬 앱이라 `Record<string, string>` 두 벌이면 충분하다.
 *
 *  **`node:*`가 없다.** 이 파일은 화면(클라이언트 컴포넌트)이 직접 import해서 번들로 간다 —
 *  `lib/keymap.ts`와 같은 이유다. 파일 읽기/쓰기(`languagePath`·`readLanguage`·`setLanguage`)는
 *  `lib/projects.ts`에 있다.
 *
 *  화면 이행은 이 티켓의 범위 밖이다(§0-16 — "장치만 세운다"). 사전은 지금 §0-16 자신이 쓰는
 *  설정 노드 라벨 하나만 담는다. 다음 티켓들이 여기 키를 늘린다. */

export type Locale = "ko" | "en";

/** §0-16 §설정 노드 — "안 고른 사람의 화면이 갈리면 회귀다." */
export const DEFAULT_LOCALE: Locale = "ko";

/** 키 이름 규약(30a8f5c3 첫 묶음) — `<화면>.<노드나 영역>.<요소>`. 트리 노드 5개와 같은 이름을
 *  공유하는 문구는 `settings.tree.<node>`로 한 번만 두고 여러 자리가 재사용한다(중복 값 0).
 *  화면·노드를 안 가리는 낱말(저장·저장 중…·추가 등)은 `common.*`. */
const ko: Record<string, string> = {
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

  "settings.tokens.empty": "등록된 토큰이 없습니다.",
  "settings.tokens.labelPlaceholder": "이메일 등 알아볼 이름",
  "settings.tokens.use": "사용",
  "settings.tokens.enable": "활성화",
  "settings.tokens.disable": "비활성화",
  "settings.tokens.active": "활성",
  "settings.tokens.pending": "대기",
  "settings.tokens.disabledBadge": "비활성",
  "settings.tokens.exhausted": "소진",

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
  "settings.keymap.change": "바꾸기",
  "settings.keymap.resetAll": "전부 기본값으로",

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
};

/** 아직 옮긴 문구가 없다 — 없는 키는 전부 `ko`로 떨어진다(아래 `t`). */
const en: Record<string, string> = {};

const DICTS: Record<Locale, Record<string, string>> = { ko, en };

/** 없는 키는 `ko`로 떨어진다. `ko`에도 없으면 개발 실수다 — 조용히 키 이름을 보여주지 않고
 *  던진다(§0-16 §장치 "없는 키" 못). */
export function t(locale: Locale, key: string): string {
  const value = DICTS[locale][key] ?? ko[key];
  if (value === undefined) throw new Error(`i18n: 사전에 없는 키 "${key}" (ko에도 없음)`);
  return value;
}
