import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolvePublicLocale } from "@/lib/site-locale";

/** 요청 쿠키·헤더를 실제로 꺼내는 자리 하나 — 순수 판정(`resolvePublicLocale`)은
 *  `lib/site-locale.ts`에 있다. 그 파일이 `next/headers`를 못 무는 이유(`node --test`가 그
 *  패키지를 못 읽는다)로 여기가 갈렸다. 이 파일은 `lib/**` 밖이라 테스트 글롭이 안 걸린다 —
 *  `app/(site)/meta.ts`가 `next.config.ts`에서만 더 불리는 것과 같은 자리다.
 *
 *  레이아웃과 라우트(`docs`·`terms`·`privacy`)가 같은 요청 안에서 이 함수를 각자 부른다 —
 *  `resolvePublicLocale` 쪽의 `cache()`가 중복 계산을 지운다. */
export async function siteLocale() {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return resolvePublicLocale(
    jar.get(LOCALE_COOKIE)?.value,
    h.get("accept-language"),
    h.get("x-vercel-ip-country"),
  );
}
