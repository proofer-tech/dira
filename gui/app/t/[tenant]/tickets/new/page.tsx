/** 티켓 발행 `/t/<tenant>/tickets/new` (DESIGN.md §3).
 *
 *  선택지는 전부 **이 테넌트의 실제 값**이다: persona는 해석된 `TICKET_PERSONAS` 아래 디렉터리,
 *  deps는 큐에 실제로 있는 티켓. 손으로 칠 수 있는 건 title과 본문뿐이다 — 나머지는 오타가 곧
 *  조용한 유실이라 자유 입력을 주지 않는다(`protocols/tickets.md` §함정). */
import { stat } from "node:fs/promises";
import { notFound } from "next/navigation";
import { NewTicketForm } from "@/components/ticket-ui";
import { listTickets, stemOf } from "@/lib/queue";
import { getTenant, listPersonas, resolveConfig } from "@/lib/tenants";

// 큐는 GUI 밖에서(cron·세션이) 바뀐다. 프리렌더하면 deps 목록이 빌드 시점에 굳는다.
export const dynamic = "force-dynamic";

export default async function NewTicket({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  // 연결 안 됨은 셸이 사유 블록으로 받는다(§4-1). 여기서 404를 던지면 그 사유가 404로 덮인다.
  if (!(await stat(tenant.root).catch(() => null))) return null;

  const config = await resolveConfig(tenant);
  // 티켓을 넘기지 않는다 — 프로필이 없는 이름(엔진의 WARN)은 새 티켓의 선택지가 아니다.
  const [profiles, tickets] = await Promise.all([
    listPersonas(config.personas),
    listTickets(tenant.root, config),
  ]);
  const personas = profiles.map((p) => p.name);

  // deps가 가리키는 이름은 frontmatter의 `ticket:`이 아니라 **상태 접미사를 뗀 파일명**이다
  // (tickets.py `_find_stem`). 큐 순서(오래된 것부터)를 뒤집는다 — 방금 만든 티켓에 엮는
  // 경우가 대부분이고, 뒤집으면 그게 목록 맨 위다.
  const deps = tickets
    .map((t) => ({ hash: stemOf(t.path, config), title: t.title, met: t.state === "done" }))
    .reverse();

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">티켓 발행</h1>
      <NewTicketForm tenant={id} personas={personas} deps={deps} personaDir={config.personas} />
    </div>
  );
}
