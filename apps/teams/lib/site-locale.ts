/** 공개 사이트가 언어를 정하는 판정 체인 (DESIGN.md §0-24 §판정 체인 · §원고를 두는 자리).
 *
 *  `next/headers`(`cookies`·`headers`)는 여기서 안 문다 — `route-pending.test.ts` 머리 주석이
 *  적은 그 실측과 같다(node 네이티브 TS 로더가 그 패키지 export를 못 읽는다). 요청 헤더·쿠키를
 *  실제로 꺼내는 자리는 `app/(site)/request-locale.ts`이고, 여기 남는 것은 원시값을 받는
 *  순수 판정뿐이다 — 그래서 `node --test`가 next 런타임 없이도 이 파일을 그대로 부른다. */

import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isLandingOnly } from "./flags.ts";
import { DEFAULT_LOCALE, type Locale } from "./i18n.ts";
import { readLanguage } from "./projects.ts";

/** 토글(P340-3)이 쓸 쿠키 이름. 이 티켓은 판정 체인만 만든다 — 누르는 손잡이는 없다. */
export const LOCALE_COOKIE = "dira-locale";

/** `Accept-Language`에서 `ko`·`en`만 고른다. `ko-KR`처럼 지역이 붙은 값은 앞 두 글자로 본다.
 *  둘 중 어느 것도 없으면 `undefined`다(다음 순위로 떨어진다). */
export function acceptLanguageLocale(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const tag = part.trim().split(";")[0].slice(0, 2).toLowerCase();
    if (tag === "ko" || tag === "en") return tag;
  }
  return undefined;
}

/** `x-vercel-ip-country`가 `KR`이면 `ko`, 다른 값이면 `en`. 헤더 자체가 없으면 `undefined`다
 *  (마지막 폴백 `ko`로 떨어진다 — §0-24 "헤더가 하나도 없는 자리는 접속지를 모르는 자리이지
 *  한국 밖이 아니다"). */
export function countryLocale(country: string | null | undefined): Locale | undefined {
  if (!country) return undefined;
  return country === "KR" ? "ko" : "en";
}

/** §0-24 §판정 체인 넷. 풀 모드와 랜딩-only가 1순위에서 갈린다 — 풀 모드는 머신 설정
 *  (`language.json`)만 보고 쿠키·헤더는 안 본다(설정 다이얼로그와 랜딩 토글이 같은 화면에서
 *  다른 언어를 가리키면 어느 쪽이 정본인지 알 방법이 없다).
 *
 *  레이아웃과 라우트(`docs`·`terms`·`privacy`)가 같은 요청 안에서 이 함수를 각자 부르므로
 *  `cache()`로 한 번만 계산한다(`lib/workers.ts`의 `crontabText`와 같은 자리 — 수명은
 *  요청 하나다). */
export const resolvePublicLocale = cache(
  async (
    cookieLocale: string | undefined,
    acceptLanguage: string | null | undefined,
    country: string | null | undefined,
  ): Promise<Locale> => {
    if (!isLandingOnly()) return readLanguage();
    if (cookieLocale === "ko" || cookieLocale === "en") return cookieLocale;
    return acceptLanguageLocale(acceptLanguage) ?? countryLocale(country) ?? DEFAULT_LOCALE;
  },
);

/** §0-24 §원고를 두는 자리 — `apps/teams/en/` 아래 같은 경로가 있으면 그것을, 없으면 한국어
 *  원본으로 떨어진다(빈 화면도 404도 안 뜬다). `relPath`는 `apps/teams/` 기준이다
 *  (`docs/install.md` · `terms.md` · `privacy.md`) — 디렉터리가 있는 이름도 그대로
 *  미러링된다(`en/docs/install.md`). `baseDir`는 테스트가 `process.cwd()` 대신 임시
 *  디렉터리를 넣으려고 연 인자다. */
export function pickManuscript(
  locale: Locale,
  relPath: string,
  baseDir: string = process.cwd(),
): string {
  if (locale === "en") {
    const enPath = join(baseDir, "en", relPath);
    if (existsSync(enPath)) return readFileSync(enPath, "utf8");
  }
  return readFileSync(join(baseDir, relPath), "utf8");
}
