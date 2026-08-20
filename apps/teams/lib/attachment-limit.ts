/** §8 1건 상한 — 수 하나와 문장 하나. 상한을 아는 곳이 셋이다: 저장하는 서버(`attachments.ts`) ·
 *  보내기 전의 화면(`attachment-field.tsx`) · 그리고 Next의 본문 한도(`next.config.ts`).
 *  `attachments.ts`는 `node:fs`를 쓰므로 클라이언트 번들에 못 들어가고, 그래서 수가 갈렸다 —
 *  `bodySizeLimit`이 `MAX_BYTES`와 **같은 값**이라 정확히 20 MiB짜리가 서버 액션에 닿기도 전에
 *  잘렸다(`6dab7cc8`). 세 곳이 같은 것을 보게 하는 것이 이 파일의 존재 이유다.
 *
 *  `oversizeError`의 로케일 배선은 `lib/budgets.ts`(P308-1)와 같은 벌 —
 *  `locale: Locale = DEFAULT_LOCALE`. */
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

/** §8 상한. 1건 20MB. */
export const MAX_BYTES = 20 * 1024 * 1024;

/** 넘으면 §6 3요소 문장, 아니면 `null`. 화면과 서버가 **같은 이 함수**를 부른다.
 *
 *  화면이 먼저 부르는 것은 UX가 아니라 정확성이다: 상한을 넘긴 요청은 Next가 서버 액션에
 *  닿기 전에 끊고, 그때 화면에 남는 사유는 이 문장이 아니라 Next의 영어 마스킹 문구다.
 *  **그래도 서버가 다시 판정한다** — 신뢰 경계는 서버다(화면 검증은 검증이 아니다). */
export function oversizeError(size: number, locale: Locale = DEFAULT_LOCALE): string | null {
  if (size <= MAX_BYTES) return null;
  const mb = (size / 1024 / 1024).toFixed(1);
  return `${t(locale, "attachmentLimit.oversizePrefix")}${mb}${t(locale, "attachmentLimit.oversizeSuffix")}`;
}

/** `next.config.ts`의 `experimental.serverActions.bodySizeLimit`. **상한보다 커야 한다** —
 *  멀티파트 본문은 파일보다 항상 크다(경계 문자열 · 헤더 · 같은 폼의 다른 필드). 같게 두면
 *  정확히 상한인 파일이 거절되고 사유가 §6 문장이 아니게 된다. 여유 1MB는 헤더보다 훨씬 크다.
 *  `attachments.test.ts`가 이 부등호를 민다(주석은 안 민다). */
export const BODY_SIZE_LIMIT = `${MAX_BYTES / 1024 / 1024 + 1}mb`;
