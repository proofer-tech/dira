/** 워커 `/p/<project>/workers` — 현황 + 생성·중단·삭제 + reap (DESIGN.md §4).
 *
 *  **crontab은 읽기만 한다**(제약 4). 등록·해제 명령어는 만들어서 복사시키고 사람이 실행한다.
 *  락은 프로젝트의 **워커 파일 목록에서 시작해** 찾는다 — 락 디렉터리는 머신 전역이라 모든
 *  프로젝트의 락이 섞여 있고 락 이름에서 프로젝트를 역추적할 수 없다(§워커 상태 판정). */
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { CopyCommand } from "@/components/copy-command";
import {
  CommonContextCard,
  CreateWorkerButton,
  WorkerContextCard,
  WorkerRowActions,
  type WorkerRow,
} from "@/components/workers-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTickets } from "@/lib/queue";
import { getProject, resolveConfig, usingDefault } from "@/lib/projects";
import {
  cronUnregisterCmd,
  cronRegisterCmd,
  firstWorkerCmd,
  listWorkers,
  readCommonContext,
} from "@/lib/workers";

// 워커는 GUI 밖에서(cron이) 상태를 바꾼다 — 프리렌더하면 빌드 시점 현황이 굳는다.
export const dynamic = "force-dynamic";

/** 설정 키 라벨. 경고와 표가 같은 단어를 쓰게 한 자리에 둔다. */
const LABEL: Record<string, string> = {
  personas: "페르소나 (TICKET_PERSONAS)",
  protocols: "프로토콜 (TICKET_PROTOCOLS)",
  inProgress: "진행중 접미사 (TICKET_INPROGRESS)",
  done: "완료 접미사 (TICKET_DONE)",
};

/** 배지 옆 보조 문구 (DESIGN.md §비주얼 디렉션 §2 워커 4상태). */
const NOTE: Record<WorkerRow["status"], string> = {
  running: "",
  idle: "",
  stopped: "crontab 미등록",
  stale: "다음 tick이 회수한다",
};

/** §4 표의 결함 이름 + "실제로 무슨 일이 일어나나". LABEL·NOTE와 같은 자리에 둔다 —
 *  판정은 `lib/workers.ts`가 하고 그 워커의 실제 경로는 `detail`로 온다. */
const DEFECT: Record<WorkerRow["defects"][number]["kind"], { title: string; why: string }> = {
  "missing-cwd": {
    title: "작업 디렉터리 없음",
    why: "tick.sh가 ERROR cwd 없음을 남기고 락을 풀어 티켓을 되돌립니다 — 물었다 놓기만 합니다.",
  },
  "missing-link": {
    title: "큐 심링크 없음",
    why: "세션이 미끼 큐를 보고 자기 티켓을 못 찾습니다 — 완료 신고도 못 하고 reap이 attempts만 올립니다.",
  },
  "shared-cwd": {
    title: "작업 디렉터리 공유",
    why: "두 세션이 한 트리에서 한 브랜치를 밟습니다 — dispatch-gate.sh가 디스패치를 막습니다.",
  },
};

export default async function Workers({ params }: { params: Promise<{ project: string }> }) {
  const { project: id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  // 물고 있는 티켓은 `.wip` 티켓의 `owner:`로 역추적한다 — 큐를 한 번만 읽고 넘긴다.
  const tickets = await listTickets(project.root, config);
  const workers = await listWorkers(project.root, tickets);
  // 파일이 없으면 항목 0개다 — 오류가 아니다(§4-1). 카드는 빈 상태 + `공통 항목 추가`로 뜬다.
  const common = await readCommonContext(project.root);
  const commonItems = common.ok ? common.items : [];

  const rows: WorkerRow[] = workers.map((w) => ({
    ...w,
    registerCmd: cronRegisterCmd(w),
    unregisterCmd: cronUnregisterCmd(w),
  }));

  // 표시만 하는 값들(편집은 범위 밖 — 4e2850eb). 해석은 resolveConfig 하나가 한다.
  const settings = [
    { key: LABEL.personas, value: config.personas, assumed: usingDefault(config, "personas") },
    { key: LABEL.protocols, value: config.protocols, assumed: usingDefault(config, "protocols") },
    { key: LABEL.inProgress, value: config.inProgress, assumed: usingDefault(config, "inProgress") },
    { key: LABEL.done, value: config.done, assumed: usingDefault(config, "done") },
  ];
  // cwd는 resolveConfig가 애초에 conflicts에 넣지 않는다(갈리는 게 정상 — edc5e1a7).
  const divergent = config.conflicts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">워커</h1>
        {rows.length > 0 && (
          <CreateWorkerButton projectId={id} canTemplate firstCmd={firstWorkerCmd(project.root)} />
        )}
      </div>

      {/* 공통 컨텍스트 — 워커 전원이 보는 항목의 사본 하나(§4-1). 최상단이다: 워커별 목록보다
          먼저 읽어야 무엇이 겹치는지 알 수 있다. 새 화면도 새 내비 항목도 만들지 않는다. */}
      {rows.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">공통 컨텍스트</h2>
            <p className="text-sm text-muted-foreground">
              워커 전원이 <span className="font-mono text-xs">source</span>하는 파일 하나입니다 —
              <span className="font-mono text-xs break-all"> {project.root}/context.sh</span>. 여기
              항목은 각 워커 컨텍스트 목록의 <strong className="font-medium">최상단</strong>에
              들어가고, 워커별 목록에서는 지울 수 없습니다. 한 줄을 고치면 전원에게 반영됩니다.
            </p>
          </div>
          <CommonContextCard
            projectId={id}
            filePath={`${project.root}/context.sh`}
            context={common}
          />
        </section>
      )}

      {rows.length === 0 ? (
        <div className="max-w-3xl space-y-4">
          <EmptyState
            text="워커 없음 — 큐가 돌지 않는다"
            action={
              <CreateWorkerButton
                projectId={id}
                canTemplate={false}
                firstCmd={firstWorkerCmd(project.root)}
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
            <CopyCommand cmd={firstWorkerCmd(project.root)} />
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
              <Fragment key={w.name}>
              <TableRow className="h-9">
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
                    // 해시가 파일명에서 올 수 있어 한글·공백이 섞인다 — 보드와 같이 인코딩한다
                    <Link
                      href={`/p/${id}/tickets/${encodeURIComponent(w.holding)}`}
                      className="hover:underline"
                    >
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
                  <WorkerRowActions projectId={id} row={w} />
                </TableCell>
              </TableRow>
              {/* 결함은 락을 만들지 않으므로 위 배지로는 안 보인다(§4) — 이 워커는 화면에 정상으로
                  뜨면서 티켓을 처리하지 못한다. 모양은 §4-1 `source` 줄 경고와 같은 Alert다.
                  결함 0개면 이 행 자체가 없다 — 정상 상태에 켜져 있는 경고를 만들지 않는다. */}
              {w.defects.length > 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="px-3 py-2">
                    <Alert>
                      <TriangleAlert aria-hidden className="text-status-stale" />
                      <AlertTitle>
                        {w.name} — {w.defects.map((d) => DEFECT[d.kind].title).join(" · ")}
                      </AlertTitle>
                      <AlertDescription>
                        <div className="space-y-2">
                          {w.defects.map((d) => (
                            <p key={d.kind}>
                              <span className="font-mono text-xs break-all">{d.detail}</span>{" "}
                              {DEFECT[d.kind].why}
                            </p>
                          ))}
                          <p>
                            준비 명령은 이 큐의 배치인{" "}
                            <span className="font-mono text-xs break-all">
                              {project.root}/worktrees/{w.name}
                            </span>
                            를 만듭니다(§4-2) —{" "}
                            <span className="font-mono text-xs">TICKET_CWD</span>가 그 경로가 아니면 그
                            줄도 손으로 고치세요. 체크아웃은 GUI가 실행하지 않습니다.
                          </p>
                          {w.worktree?.reason && (
                            <p className="text-muted-foreground">
                              {w.worktree.reason} 첫 줄의 레포 경로를 직접 채우세요.
                            </p>
                          )}
                          {w.worktree?.cmds.map((cmd) => (
                            <CopyCommand key={cmd} cmd={cmd} />
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {rows.length > 0 && (
        <section className="space-y-3 pt-4">
          <div>
            <h2 className="text-sm font-semibold">컨텍스트</h2>
            <p className="text-sm text-muted-foreground">
              워커별 <span className="font-mono text-xs">TICKET_CONTEXT</span> — 세션 프롬프트 꼬리에
              항목의 경로와 설명이 붙습니다. <strong className="font-medium">없는 항목은 에러가 아닙니다</strong>{" "}
              — 엔진이 건너뛰고 runner.log에 <span className="font-mono text-xs">WARN</span>만 남깁니다
              (클라우드 마운트가 안 붙은 상태에서 세션이 헛짚지 않게). 목록 최상단의{" "}
              <span className="font-mono text-xs">공통</span> 배지 행은 위 공통 컨텍스트이고 여기서는
              고칠 수 없습니다 — 그 항목은 워커 파일에 없습니다.
            </p>
          </div>
          {rows.map((w) => (
            <WorkerContextCard
              key={w.name}
              projectId={id}
              row={w}
              others={rows.filter((o) => o.name !== w.name).map((o) => o.name)}
              common={commonItems}
            />
          ))}
        </section>
      )}

      {rows.length > 0 && (
        <section className="space-y-2 pt-4">
          <div>
            <h2 className="text-sm font-semibold">나머지 워커 설정 (표시만)</h2>
            <p className="text-sm text-muted-foreground">
              이 값들은 이 화면에서 고치지 않습니다 — 워커 파일을 손으로 편집합니다.
            </p>
          </div>
          <Table>
            <TableBody>
              {settings.map((s) => (
                <TableRow key={s.key} className="h-9">
                  <TableCell className="w-48 px-3 py-0 text-xs text-muted-foreground">{s.key}</TableCell>
                  <TableCell className="px-3 py-0 font-mono text-xs break-all">
                    {s.value}
                    {s.assumed && (
                      <span className="ml-2 font-sans text-muted-foreground">기본값 가정</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* TICKET_CWD는 워커마다 다른 게 정상이라 여기 없다(워크트리 하나면 두 세션이 서로를
              밟는다). 갈렸다고 경고하면 사람이 경고를 안 읽게 된다 — DESIGN.md §설정 해석. */}
          {divergent.length > 0 && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>워커 간 값이 갈렸습니다</AlertTitle>
              <AlertDescription>
                <div className="space-y-1">
                  <p>
                    엔진은 티켓을 디스패치한 워커의 값을 씁니다 — 같은 티켓이 어느 워커에 물리느냐로
                    결과가 달라집니다.
                  </p>
                  {divergent.map((c) => (
                    <p key={c.key} className="font-mono text-xs break-all">
                      {LABEL[c.key] ?? c.key}:{" "}
                      {Object.entries(c.byWorker)
                        .map(([w, v]) => `${w}=${v}`)
                        .join(" · ")}
                    </p>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </section>
      )}
    </div>
  );
}
