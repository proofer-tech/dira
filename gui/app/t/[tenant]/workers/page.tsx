/** 워커 `/t/<tenant>/workers` — 현황 + 생성·중단·삭제 + reap (DESIGN.md §4).
 *
 *  **crontab은 읽기만 한다**(제약 4). 등록·해제 명령어는 만들어서 복사시키고 사람이 실행한다.
 *  락은 테넌트의 **워커 파일 목록에서 시작해** 찾는다 — 락 디렉터리는 머신 전역이라 모든
 *  테넌트의 락이 섞여 있고 락 이름에서 테넌트를 역추적할 수 없다(§워커 상태 판정). */
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { CopyCommand } from "@/components/copy-command";
import { CreateWorkerButton, WorkerRowActions, type WorkerRow } from "@/components/workers-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTickets } from "@/lib/queue";
import { getTenant, resolveConfig } from "@/lib/tenants";
import { cronUnregisterCmd, cronRegisterCmd, firstWorkerCmd, listWorkers } from "@/lib/workers";

// 워커는 GUI 밖에서(cron이) 상태를 바꾼다 — 프리렌더하면 빌드 시점 현황이 굳는다.
export const dynamic = "force-dynamic";

/** 배지 옆 보조 문구 (DESIGN.md §비주얼 디렉션 §2 워커 4상태). */
const NOTE: Record<WorkerRow["status"], string> = {
  running: "",
  idle: "",
  stopped: "crontab 미등록",
  stale: "다음 tick이 회수한다",
};

export default async function Workers({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const config = await resolveConfig(tenant);
  // 물고 있는 티켓은 `.wip` 티켓의 `owner:`로 역추적한다 — 큐를 한 번만 읽고 넘긴다.
  const tickets = await listTickets(tenant.root, config);
  const workers = await listWorkers(tenant.root, tickets);

  const rows: WorkerRow[] = workers.map((w) => ({
    ...w,
    registerCmd: cronRegisterCmd(w),
    unregisterCmd: cronUnregisterCmd(w),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">워커</h1>
        {rows.length > 0 && (
          <CreateWorkerButton tenantId={id} canTemplate firstCmd={firstWorkerCmd(tenant.root)} />
        )}
      </div>

      {rows.length === 0 ? (
        <div className="max-w-3xl space-y-4">
          <EmptyState
            text="워커 없음 — 큐가 돌지 않는다"
            action={
              <CreateWorkerButton
                tenantId={id}
                canTemplate={false}
                firstCmd={firstWorkerCmd(tenant.root)}
              />
            }
          />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              워커가 없으면 티켓이 디스패치되지 않을 뿐 아니라{" "}
              <span className="font-mono text-xs">reap</span>(스테일 수거)과{" "}
              <span className="font-mono text-xs">unassign</span>(할당 해제)도 할 수 없습니다 —
              둘 다 워커 스크립트를 통해 엔진이 하는 일입니다(제약 2).
            </p>
            <CopyCommand cmd={firstWorkerCmd(tenant.root)} />
            <p className="text-xs text-muted-foreground">
              엔진 레포 경로는 채워지지 않습니다 — 워커 파일에만 적혀 있어서 GUI가 알 수 없습니다.
            </p>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="h-9">
              <TableHead className="h-9 px-3 text-xs">이름</TableHead>
              <TableHead className="h-9 px-3 text-xs">상태</TableHead>
              <TableHead className="h-9 px-3 text-xs">물고 있는 티켓</TableHead>
              <TableHead className="h-9 px-3 text-right text-xs">pid</TableHead>
              <TableHead className="h-9 px-3 text-xs">엔진</TableHead>
              <TableHead className="h-9 px-3 text-xs">마지막 활동</TableHead>
              <TableHead className="h-9 px-3 text-right text-xs">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.name} className="h-9">
                <TableCell className="px-3 py-0 font-mono text-xs" title={w.path}>
                  {w.name}
                </TableCell>
                <TableCell className="px-3 py-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={w.status} />
                    {NOTE[w.status] && (
                      <span className="text-xs text-muted-foreground">{NOTE[w.status]}</span>
                    )}
                  </div>
                </TableCell>
                {/* 해시는 자르지 않는다(§6 텍스트 잘림) */}
                <TableCell className="px-3 py-0 font-mono text-xs">
                  {w.holding ? (
                    <Link href={`/t/${id}/tickets/${w.holding}`} className="hover:underline">
                      {w.holding}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-0 text-right font-mono text-xs tabular-nums">
                  {w.lockPid ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell
                  className="max-w-[14rem] truncate px-3 py-0 font-mono text-xs text-muted-foreground"
                  title={w.engine}
                >
                  {w.engine}
                </TableCell>
                <TableCell
                  className="max-w-[20rem] truncate px-3 py-0 font-mono text-xs text-muted-foreground"
                  title={w.lastLog ?? ""}
                >
                  {w.lastLog ?? "—"}
                </TableCell>
                <TableCell className="px-3 py-0">
                  <WorkerRowActions tenantId={id} row={w} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
