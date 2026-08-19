/** §프롬프트 층 결정 11 — 인라인 예산을 재는 표시는 전부 바이트다. **이 파일에 import가 없는
 *  것이 요점이다.** 상한 넷(코어 `CORE.md` · 큐 `AGENTS.md` · 페르소나 프로필+스킬 · 페르소나
 *  메모리)을 호출부마다 적으면 사본이 넷이 되고 다음 개정이 넷을 찾는다 — `attachment-limit.ts`와
 *  같은 존재 이유다. */

export const CORE_MAX_BYTES = 3_500;
export const QUEUE_AGENTS_MAX_BYTES = 6_500;
export const PERSONA_MAX_BYTES = 5_000;
export const MEMORY_MAX_BYTES = 150_000;

/** UTF-8 바이트 수 — `wc -c`와 같은 값(결정 11 (1)). `Buffer`는 클라이언트 번들에 없어
 *  `TextEncoder`를 쓴다(양쪽 다 있다 — `squadBlockBytes`의 선례 그대로). */
export const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** 결정 11 (2)(3) 문구 — 상한이 있으면 `{n} / {상한} B`(넘으면 뒤에 ` 초과`), 없으면 `{n} B`
 *  하나뿐이다. 새 서식 0 - 새 색 0(§비주얼 §61 (13) 그대로, 넘어도 색은 안 갈린다). */
export function budgetLabel(bytes: number, max?: number): string {
  if (max === undefined) return `${bytes.toLocaleString()} B`;
  return `${bytes.toLocaleString()} / ${max.toLocaleString()} B${bytes > max ? " 초과" : ""}`;
}
