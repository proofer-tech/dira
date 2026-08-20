/** §프롬프트 층 결정 11 — 인라인 예산을 재는 표시는 전부 바이트다. 상한 넷(코어 `CORE.md` ·
 *  큐 `AGENTS.md` · 페르소나 프로필+스킬 · 페르소나 메모리)을 호출부마다 적으면 사본이 넷이
 *  되고 다음 개정이 넷을 찾는다 — `attachment-limit.ts`와 같은 존재 이유다. `budgetLabel`의
 *  로케일 배선은 `lib/protocols.ts`가 세운 벌(`locale: Locale = DEFAULT_LOCALE`)을 그대로
 *  탄다 — `import`가 느는 것은 그 벌의 결과지, 이 파일이 지키던 못이 깨진 것이 아니다. */
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

export const CORE_MAX_BYTES = 3_500;
export const QUEUE_AGENTS_MAX_BYTES = 6_500;
export const PERSONA_MAX_BYTES = 5_000;
export const MEMORY_MAX_BYTES = 150_000;

/** UTF-8 바이트 수 — `wc -c`와 같은 값(결정 11 (1)). `Buffer`는 클라이언트 번들에 없어
 *  `TextEncoder`를 쓴다(양쪽 다 있다 — `squadBlockBytes`의 선례 그대로). */
export const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** 결정 11 (2)(3) 문구 — 상한이 있으면 `{n} / {상한} B`(넘으면 뒤에 꼬리), 없으면 `{n} B`
 *  하나뿐이다. 새 서식 0 - 새 색 0(§비주얼 §61 (13) 그대로, 넘어도 색은 안 갈린다).
 *  숫자 서식(`toLocaleString`)은 로케일과 안 갈린다 — 갈리는 건 꼬리 문구뿐이다. */
export function budgetLabel(bytes: number, max?: number, locale: Locale = DEFAULT_LOCALE): string {
  if (max === undefined) return `${bytes.toLocaleString()} B`;
  const over = bytes > max ? t(locale, "budgets.overSuffix") : "";
  return `${bytes.toLocaleString()} / ${max.toLocaleString()} B${over}`;
}

export const SQUAD_BLOCK_MAX_BYTES = 1_500;

/** 스쿼드 블록(§5-5 §개정 §스쿼드 블록 - §블록의 틀)의 바이트 수. tick.sh:736-788이 실제로
 *  조립하는 문구와 문자 그대로 맞춘다 - 머리/꼬리 `=====` 줄 + 멤버 줄 `<이름>[ (리더)] - <역할>`,
 *  잰 범위는 머리 `=====`의 첫 글자부터 꼬리 `=====`의 마지막 글자까지(감싼 개행은 안 센다).
 *  엔진(tick.sh)에 로케일이 없어 이 블록은 어느 화면에서나 한국어다 — 사전을 안 타고
 *  리터럴을 직접 쓴다(`persona.squad.block*` 세 키를 없앤 자리). */
export function squadBlockBytes(name: string, members: { name: string; role: string }[]): number {
  const lines = [
    `===== 스쿼드 ${name} =====`,
    ...members.map((m, i) => `${m.name}${i === 0 ? " (리더)" : ""} - ${m.role}`),
    `===== 스쿼드 끝 =====`,
  ];
  return byteLength(lines.join("\n"));
}
