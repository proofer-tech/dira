import type { Metadata } from "next";

// 기본 테마의 `404.html`이 여기로 왔다(§사이트 기반 §갈아 끼우는 것). 그 화면은 정적 HTML에
// 본문이 **0자**였고(테마가 404에서 SSR을 건너뛴다) 클라이언트에서 그렸다 — 여기서는 빌드가
// 굽는다. 셸(네브·사이드바)은 안 두른다: 없는 경로라 사이드바가 짚을 항목이 없다.
//
// **canonical·og·twitter를 안 얹는다.** 색인 대상이 아니라 그게 맞다 — 종전 `404.html`도
// `transformPageData` 훅을 안 지나서 그 열한 줄이 0이었다(§SEO ② 태그).
export const metadata: Metadata = { title: "404 | dira" };

export default function NotFound() {
  return (
    <main>
      <h1>404</h1>
      <p>이 주소에는 페이지가 없습니다.</p>
      <a href="/">홈으로</a>
    </main>
  );
}
