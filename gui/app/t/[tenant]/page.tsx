/** 보드 — 빈 라우트. 테이블·필터·검색은 39beb1d8, 칸반·deps 표현은 2356df56이 채운다. */
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function Board({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">보드</h1>
        <Button size="sm" render={<Link href={`/t/${tenant}/tickets/new`} />}>
          티켓 발행
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        큐 테이블은 다음 티켓에서 붙는다. 셸·전환기는 여기서 이미 동작한다.
      </p>
    </div>
  );
}
