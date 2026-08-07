/** 404. 이 앱에서 404가 나는 경우는 사실상 하나다 — 등록 안 된 프로젝트 조각(`/p/<없는id>`).
 *  그래서 문구가 레지스트리를 가리키고 목록으로 가는 링크를 둔다(DESIGN.md §스펙 도입부).
 *
 *  **세그먼트가 아니라 여기 있는 이유**: `notFound()`를 부른 게 `p/[project]/layout.tsx`이고,
 *  레이아웃이 던진 것은 자기 세그먼트의 not-found로 못 잡는다(경계가 위에 있어야 한다).
 *  `app/p/[project]/not-found.tsx`를 두면 Next 기본 404가 뜬다 — 실제로 확인했다. */
import Link from "next/link";

export default function NotFound() {
  return (
    // 스크롤러는 `main`이다(§비주얼 §4 · app/layout.tsx) — 문서는 스크롤하지 않는다
    <main className="min-h-0 w-full max-w-3xl flex-1 space-y-2 overflow-y-auto px-6 py-6">
      <h1 className="text-lg font-semibold">찾을 수 없습니다</h1>
      <p className="text-sm text-muted-foreground">
        이 URL에 해당하는 화면이 없습니다. <span className="font-mono text-xs">/p/&lt;프로젝트&gt;</span>
        였다면 그 URL 조각이 레지스트리에 없습니다.
      </p>
      <Link href="/" className="text-sm underline">
        프로젝트 목록
      </Link>
    </main>
  );
}
