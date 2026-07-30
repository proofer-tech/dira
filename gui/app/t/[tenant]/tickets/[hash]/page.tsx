/** 티켓 상세 `/t/<tenant>/tickets/[hash]` — frontmatter 표 · 본문 · 관계 · 액션
 *  (DESIGN.md §2 티켓 상세 · 제약 2 상태 전이 위임 · 제약 5 `.wip` 편집 금지).
 *
 *  **해시로 경로를 조립하지 않는다.** 형식 검증을 통과한 해시를 `tickets.py find`에 물어
 *  실제 파일을 받고, 못 찾으면 404다(§경로 방어). */
import { stat } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DepBadge, StatusBadge } from "@/components/status-badge";
import { DeleteTicketButton, TicketEditForm, UnassignButton } from "@/components/ticket-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { findTicket } from "@/lib/engine";
import { listTickets, referrers, resolveDep, statusOf, type Ticket } from "@/lib/queue";
import { getTenant, resolveConfig } from "@/lib/tenants";
import { listWorkers } from "@/lib/workers";

// 큐는 GUI 밖에서(cron·세션이) 바뀐다. 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

export default async function TicketDetail({
  params,
}: {
  params: Promise<{ tenant: string; hash: string }>;
}) {
  const { tenant: id, hash } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound(); // 레이아웃이 이미 404를 세우지만 페이지도 같이 돈다

  // 연결 안 됨은 셸이 사유 블록으로 받는다(§4-1). 여기서 404를 던지면 그 사유가 404로 덮인다.
  if (!(await stat(tenant.root).catch(() => null))) return null;

  const config = await resolveConfig(tenant);
  const file = await findTicket(tenant.root, hash, config);
  if (!file) notFound();

  const tickets = await listTickets(tenant.root, config);
  const nfc = (s: string) => s.normalize("NFC");
  const ticket = tickets.find((t) => nfc(t.path) === nfc(file));

  // 파일은 있는데 엔진 scan이 무시하는 경우(frontmatter 없음·닫는 `---` 없음)다. 404가 아니다 —
  // 없는 티켓이 아니라 **엔진에게 안 보이는 파일**이고, 그 차이가 고칠 방법을 알려준다.
  if (!ticket) {
    return (
      <Alert className="max-w-3xl">
        <TriangleAlert aria-hidden className="text-status-stale" />
        <AlertTitle>이 파일은 큐에 뜨지 않습니다 — frontmatter가 없습니다</AlertTitle>
        <AlertDescription className="grid gap-2">
          <span className="font-mono text-xs break-all">{file}</span>
          <span>
            첫 줄이 <span className="font-mono">---</span>이고 닫는{" "}
            <span className="font-mono">---</span>이 있어야 엔진이 티켓으로 봅니다. 손으로 열어
            고치세요.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  const workers = await listWorkers(tenant.root);
  const blocking = ticket.unmet; // 막고 있는 것 = 이 티켓의 미충족 deps
  const blocked = referrers(tickets, ticket, config); // 이 티켓이 막는 것 = 역참조
  const href = (t: Ticket) => `/t/${id}/tickets/${encodeURIComponent(t.hash)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-lg font-semibold">{ticket.title || "(제목 없음)"}</h1>
          <StatusBadge status={statusOf(ticket)} />
          <span className="font-mono text-xs text-muted-foreground">{ticket.hash}</span>
        </div>
        <div className="flex items-center gap-2">
          <DeleteTicketButton
            tenant={id}
            hash={hash}
            title={ticket.title}
            locked={ticket.state === "wip"}
          />
        </div>
      </div>

      {/* `.wip`은 지금 세션이 그 파일로 일하고 있다 — 잠금 사유를 그 자리에 적는다(제약 5) */}
      {ticket.state === "wip" && (
        <Alert className="max-w-3xl">
          <Lock aria-hidden className="text-status-active" />
          <AlertTitle>세션이 물고 있습니다 — 편집·삭제 잠금</AlertTitle>
          <AlertDescription>
            진행중 티켓은 읽기만 합니다. 세션이 죽었다면 아래 <b>할당 해제</b>로 큐에 되돌린 뒤
            편집하세요.
          </AlertDescription>
        </Alert>
      )}

      {/* 할당됨일 때만 보인다 — 그 판정은 컴포넌트 안에서 한다(해제 후 출력을 남기려면 여기서
          조건부로 렌더하면 안 된다). 상태 전이는 엔진 소관이라 워커 스크립트를 부른다(제약 2) */}
      <UnassignButton
        tenant={id}
        hash={hash}
        worker={workers[0]?.name ?? null}
        assigned={ticket.assigned}
      />

      <section className="max-w-3xl space-y-2">
        <h2 className="text-sm font-medium">frontmatter</h2>
        <Table>
          <TableBody>
            {Object.entries(ticket.fm).map(([k, v]) => (
              <TableRow key={k} className="h-9">
                <TableCell className="w-40 px-3 py-0 text-sm text-muted-foreground">{k}</TableCell>
                {/* 값은 거의 다 식별자·경로·시각이다. 문장인 title만 예외로 읽는 글꼴 */}
                <TableCell className="px-3 py-0">
                  <span className={k === "title" ? "text-sm" : "font-mono text-xs break-all"}>
                    {v || "—"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="h-9">
              <TableCell className="w-40 px-3 py-0 text-sm text-muted-foreground">파일</TableCell>
              <TableCell className="px-3 py-0 font-mono text-xs break-all">
                {path.basename(ticket.path)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section className="max-w-3xl space-y-4">
        <h2 className="text-sm font-medium">관계</h2>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">막고 있는 것</p>
          {blocking.length === 0 ? (
            <EmptyState text="막고 있는 것 없음" />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {blocking.map((d) => {
                const hit = resolveDep(tickets, d, config);
                return (
                  <DepBadge
                    key={d}
                    hash={d}
                    kind={hit ? "unmet" : "missing"}
                    href={hit ? href(hit) : undefined}
                  />
                );
              })}
            </div>
          )}
          {/* 충족된 deps도 관계다 — 미충족만 보여주면 선행이 몇 개였는지 알 수 없다 */}
          {ticket.deps.length > blocking.length && (
            <div className="flex flex-wrap items-center gap-2">
              {ticket.deps
                .filter((d) => !blocking.includes(d))
                .map((d) => {
                  const hit = resolveDep(tickets, d, config);
                  return (
                    <DepBadge key={d} hash={d} kind="met" href={hit ? href(hit) : undefined} />
                  );
                })}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">이 티켓이 막는 것</p>
          {blocked.length === 0 ? (
            <EmptyState text="이 티켓이 막는 것 없음" />
          ) : (
            <div className="space-y-1">
              {blocked.map((t) => (
                <div key={t.path} className="flex items-center gap-2">
                  <StatusBadge status={statusOf(t)} />
                  <Link href={href(t)} className="truncate text-sm hover:underline">
                    <span className="font-mono text-xs">{t.hash}</span> {t.title}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">본문</h2>
        {ticket.state === "wip" ? (
          // 읽기만. 원문 그대로 보여준다(마크다운 렌더는 넣지 않는다 — §6과 같은 결정)
          <pre className="max-w-3xl font-mono text-base whitespace-pre-wrap">{ticket.body}</pre>
        ) : (
          // 폼에는 frontmatter **원문**을 넣는다. `ticket.persona`는 PERSONA_RE를 못 넘긴 값을
          // ''로 만든 것이라, 그대로 저장하면 사람이 적어둔 값을 조용히 지운다.
          <TicketEditForm
            tenant={id}
            hash={hash}
            title={ticket.fm.title ?? ""}
            kind={ticket.fm.kind ?? ""}
            persona={ticket.fm.persona ?? ""}
            body={ticket.body}
          />
        )}
      </section>
    </div>
  );
}
