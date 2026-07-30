/** 티켓 상세 — 빈 라우트. frontmatter 표·본문·관계·할당 해제는 ea5799d1이 채운다.
 *  해시는 아직 경로로 쓰지 않는다(그 티켓이 `tickets.py find`로 실제 경로를 얻는다). */
export default async function TicketDetail({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">티켓 상세</h1>
      <p className="text-sm text-muted-foreground">
        <span className="font-mono text-xs">{hash}</span> 상세 화면은 다음 티켓에서 붙는다.
      </p>
    </div>
  );
}
