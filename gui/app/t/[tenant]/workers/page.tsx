/** 워커 — 빈 라우트. 현황·생성·중단·삭제는 60d49d89, 컨텍스트 경로는 4e2850eb가 채운다.
 *  상태 판정(락·crontab)은 이미 `lib/workers.ts`에 있다 — 그 티켓이 화면을 붙인다. */
export default function Workers() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">워커</h1>
      <p className="text-sm text-muted-foreground">워커 현황 화면은 다음 티켓에서 붙는다.</p>
    </div>
  );
}
