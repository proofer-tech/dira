import type { Metadata } from "next";
import Link from "@/components/link";
import { readLanguage } from "@/lib/projects";
import { t } from "@/lib/i18n";

/** 루트 레이아웃이 둘이라(`(app)` · `(site)`, §한 코드베이스 §부딪히는 것 ①) 이 파일이
 *  **셋째 자리**다 — 어느 그룹의 라우트에도 안 걸리는 진짜 미확인 URL(예: `/asdf`)만 여기로
 *  온다. Next 문서 그대로: 이 파일은 물려받을 레이아웃이 없어 `<html>`·`<body>`를 직접 낸다.
 *
 *  `/p/<없는id>` 같은 **그룹 안에서 난 `notFound()`**는 이 파일이 안 받는다 — 그건 부른
 *  세그먼트 위, 그 그룹의 `not-found.tsx`가 받는다(`(app)/not-found.tsx`). 이 파일은
 *  세그먼트 매칭 자체가 실패한 경로 전용이라, 매뉴얼·랜딩과 같은 문구를 쓴다
 *  (`(site)/not-found.tsx`와 같은 값 — §자리 표 "없는 주소"). 그 파일과 한 파일로 못 합친 건
 *  그쪽은 `(site)` 레이아웃 아래서 렌더돼 `<html>`을 또 낼 수 없어서다. */
export const metadata: Metadata = { title: "404 | dira" };

export default async function NotFound() {
  const locale = await readLanguage();
  return (
    <html lang="ko-KR">
      <body>
        <main>
          <h1>{t(locale, "notFound.root.title")}</h1>
          <p>{t(locale, "notFound.root.body")}</p>
          <Link href="/">{t(locale, "notFound.root.homeLink")}</Link>
        </main>
      </body>
    </html>
  );
}
