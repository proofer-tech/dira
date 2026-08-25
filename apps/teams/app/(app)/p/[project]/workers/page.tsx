/** 워커 `/p/<project>/workers` — 현황 + 생성·중단·삭제 + reap (DESIGN.md §4).
 *
 *  **crontab은 읽기만 한다**(제약 4). 등록·해제 명령어는 만들어서 복사시키고 사람이 실행한다.
 *  락은 프로젝트의 **워커 파일 목록에서 시작해** 찾는다 — 락 디렉터리는 머신 전역이라 모든
 *  프로젝트의 락이 섞여 있고 락 이름에서 프로젝트를 역추적할 수 없다(§워커 상태 판정). */
import { Fragment } from "react";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CloudOff, Hourglass, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { CopyCommand } from "@/components/copy-command";
import { Badge } from "@/components/ui/badge";
import {
  CreateWorkerButton,
  ExecBitFix,
  ExpandScope,
  WorkerContextCell,
  WorkerActivityCell,
  WorkerContextRow,
  WorkerNameCell,
  WorkerRowActions,
  WorkerSettingsDialog,
  type WorkerRow,
} from "@/components/workers-ui";
import { t } from "@/lib/i18n";
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
import { formatTokens, listUsage } from "@/lib/usage";
import { dateTimeLabel } from "@/lib/urls";
import { getProject, readLanguage, resolveConfig, usingDefault } from "@/lib/projects";
import {
  cronUnregisterCmd,
  cronRegisterCmd,
  engineName,
  firstWorkerCmd,
  limitWaitUntil,
  listWorkers,
  nextWorkerName,
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
  ontology: "온톨로지 (TICKET_ONTOLOGY)",
};

/** 배지 옆 보조 문구 (DESIGN.md §비주얼 디렉션 §2 워커 4상태). */
const NOTE: Record<WorkerRow["status"], string> = {
  running: "",
  idle: "",
  stopped: "crontab 미등록",
  stale: "다음 tick이 회수한다",
};

/** §4 표의 결함 이름 + "실제로 무슨 일이 일어나나". LABEL·NOTE와 같은 자리에 둔다 —
 *  판정은 `lib/workers.ts`가 하고 그 워커의 실제 경로는 `detail`로 온다.
 *
 *  넷째(`no-exec`)만 `lib/i18n.ts`에서 온다(§0-21 결정 2, 티켓 b60520ea) — 앞의 셋은 아직 이
 *  사전으로 안 옮겨졌다. 두 벌을 한 레코드에 섞어도 값은 둘 다 문자열이라 화면은 안 갈린다. */
const DEFECT: Record<Exclude<WorkerRow["defects"][number]["kind"], "no-exec">, { title: string; why: string }> = {
  "missing-cwd": {
    title: "작업 디렉터리 없음",
    why: "tick.sh가 ERROR cwd 없음을 남기고 락을 풀어 티켓을 되돌립니다 — 물었다 놓기만 합니다.",
  },
  "missing-link": {
    title: ".dira 심링크 없음",
    why: "세션이 미끼 .dira를 보고 자기 티켓을 못 찾습니다 — 완료 신고도 못 하고 reap이 attempts만 올립니다.",
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

  const locale = await readLanguage();
  const defect: Record<WorkerRow["defects"][number]["kind"], { title: string; why: string }> = {
    ...DEFECT,
    "no-exec": {
      title: t(locale, "worker.defect.noExec.title"),
      why: t(locale, "worker.defect.noExec.why"),
    },
  };

  const config = await resolveConfig(project);
  // 물고 있는 티켓은 `.wip` 티켓의 `owner:`로 역추적한다 — 큐를 한 번만 읽고 넘긴다.
  const tickets = await listTickets(project.root, config);
  const workers = await listWorkers(project.root, tickets);
  // 파일이 없으면 항목 0개다 — 오류가 아니다(§4-1). 카드는 빈 상태 + `공통 항목 추가`로 뜬다.
  const common = await readCommonContext(project.root);
  const commonItems = common.ok ? common.items : [];
  // 창 안(기본 5시간)에 끝난 세션들의 워커별 토큰 (§0-8 판정 1). 창 밖 로그는 열지도 않는다.
  const usage = await listUsage(project.root);
  // `tokens.json` 파일 읽기 1회, 워커 수와 무관하다(§비주얼 §57 §로딩). `null`이면 `리밋 대기`가
  // 행 전체에 안 선다 — eligible이 1장이라도 있거나 tokens.json이 없다.
  const limitUntil = await limitWaitUntil();
  // 소비의 키는 로그 파일명에서 온 **실효 `TICKET_NAME`**이고 표의 행은 파일 stem이다 — 그 둘이
  // 갈린 워커만 조용히 `0`으로 뜨지 않게 여기서 한 번 옮긴다. NFC로 맞추는 것은 `parseLogName`이
  // readdir이 준 NFD를 정규화하기 때문이다(같은 이유로 `queue.ts`도 정규화한다).
  const tokens: Record<string, number> = Object.fromEntries(
    workers.map((w) => [w.name, usage.byWorker[w.effName.normalize("NFC")] ?? 0]),
  );

  const rows: WorkerRow[] = workers.map((w) => ({
    ...w,
    // 세션 스트림·참견이 이 값 하나로 갈린다(§4-3). 클라이언트가 `engineName`을 못 부르므로
    // (그 파일이 `node:fs`를 탄다) 서버가 여기서 한 번 적용한다 — 판정식은 여전히 하나다.
    engineName: engineName(w.engine),
    registerCmd: cronRegisterCmd(w),
    unregisterCmd: cronUnregisterCmd(w),
  }));

  // 표시만 하는 값들(편집은 범위 밖 — 4e2850eb). 해석은 resolveConfig 하나가 한다.
  const settings = [
    { key: LABEL.personas, value: config.personas, assumed: usingDefault(config, "personas") },
    { key: LABEL.protocols, value: config.protocols, assumed: usingDefault(config, "protocols") },
    { key: LABEL.inProgress, value: config.inProgress, assumed: usingDefault(config, "inProgress") },
    { key: LABEL.done, value: config.done, assumed: usingDefault(config, "done") },
    // 온톨로지도 이제 나머지 넷과 같은 표시 전용 행이다 — 편집 표면과 워크트리 경고 캡션은
    // 온톨로지 화면으로 옮겼다(§5-3 §편집 표면이 사는 화면, 티켓 c5d51522).
    { key: LABEL.ontology, value: config.ontology, assumed: usingDefault(config, "ontology") },
  ];
  // cwd는 resolveConfig가 애초에 conflicts에 넣지 않는다(갈리는 게 정상 — edc5e1a7).
  const divergent = config.conflicts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-lg font-semibold">워커</h1>
          {/* 상단 합계 = 아래 열의 합(§0-8 그릇). 새 컴포넌트를 만들지 않는다 — 한 줄이다.
              뒤에 붙는 수는 이 판정의 천장을 말한다: 토큰은 세션이 끝날 때 한 번 쓰이고
              신호로 죽은 세션은 아예 안 쓰므로 그만큼 합계가 실제보다 적다. 침묵하면 사람이
              "덜 썼다"로 읽는다(§0-8). **`끝난 뒤 반영됩니다`라고 약속하지 않는다** — 실측
              13건 중 8건이 rc 143/137로 죽어 토큰이 영영 안 온다(`4a884d8d`). */}
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              최근 5시간 토큰{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatTokens(usage.total)}
              </span>
              {usage.unaccounted > 0 && ` · 이 합계에 없는 세션 ${usage.unaccounted}개`}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <WorkerSettingsDialog
              projectId={id}
              filePath={`${project.root}/context.sh`}
              context={common}
              cwds={rows.map((w) => w.cwd).filter((c): c is string => !!c)}
              settings={settings}
              divergent={divergent.map((c) => ({
                key: LABEL[c.key] ?? c.key,
                text: Object.entries(c.byWorker)
                  .map(([w, v]) => `${w}=${v}`)
                  .join(" · "),
              }))}
            />
            <CreateWorkerButton
              projectId={id}
              canTemplate
              firstCmd={firstWorkerCmd(project.root)}
              defaultName={nextWorkerName(workers.map((w) => w.name))}
            />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="max-w-3xl space-y-4">
          <EmptyState
            text="워커 없음"
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
              <TableHead className="h-9 px-3 text-xs">컨텍스트</TableHead>
              <TableHead className="h-9 px-3 text-xs">마지막 활동</TableHead>
              <TableHead className="h-9 px-3 text-right text-xs">pid</TableHead>
              {/* pid 옆이다 — 둘 다 오른쪽 정렬 숫자라 눈이 한 번에 훑는다 */}
              <TableHead className="h-9 px-3 text-right text-xs">토큰(5시간)</TableHead>
              <TableHead className="h-9 px-3 text-right text-xs">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* 펼침 상태 하나를 이 본문 전체가 나눠 쓴다 — **한 번에 한 행만** 펼친다(§35 #2).
                DOM을 안 그리는 컴포넌트라 `tbody`의 자식 규칙을 깨지 않는다 */}
            <ExpandScope>
            {rows.map((w) => (
              <Fragment key={w.name}>
              <TableRow className="h-9">
                {/* §비주얼 §58 — 복구 버튼 넷의 성공이 이 셀로 초점을 옮기고 sr-only 문장 하나를
                    낭독한다. `tabIndex={-1}`이라 Tab 순서에는 새 정거장이 없다. */}
                <WorkerNameCell row={w} />
                <TableCell className="px-3 py-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={w.status} />
                    {/* `status` 배지를 대체하지 않고 나란히 선다(§비주얼 §57 §2) — claude가
                        eligible 0장이고 이 워커가 실제로 `idle`(락 없음)일 때만 선다. */}
                    {w.status === "idle" && w.engineName === "claude" && limitUntil != null && (
                      <Badge
                        variant="outline"
                        className="text-status-blocked bg-status-blocked/10 border-status-blocked/30"
                        title="지금 쓸 수 있는 Claude 계정이 0개입니다 — 이 시각이 지나면 다음 tick이 세션을 띄웁니다"
                      >
                        <Hourglass aria-hidden />
                        리밋 대기 · {dateTimeLabel(limitUntil * 1000)}
                      </Badge>
                    )}
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
                {/* **이 표의 첫 컨트롤 셀**(§비주얼 §35 #3) — 값이 곧 토글이고 그 아래 둘째
                    행이 이 워커의 컨텍스트 편집이다(§9, `text-foreground` 대비 처방) */}
                <TableCell className="w-px px-3 py-0">
                  <WorkerContextCell row={w} />
                </TableCell>
                {/* **이 표의 셋째 컨트롤 셀**(§4-7) — 값(마지막 한 줄)이 곧 토글이고 펼치면 같은
                    둘째 행이 이 워커의 최근 20줄을 잘림 없이 받는다. 셀에 뜨는 값은 무수정이다 */}
                <TableCell className="w-px px-3 py-0">
                  <WorkerActivityCell row={w} />
                </TableCell>
                <TableCell className="px-3 py-0 text-right font-mono text-xs tabular-nums">
                  {w.lockPid ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                {/* `stopped`·`idle`도 창 안에 쓴 것이 있으면 값이 뜬다 — 소비는 지금 상태가
                    아니라 과거의 사실이다(§0-8 그릇). **없으면 `—`가 아니라 `0`이다**: 이 창에
                    안 썼다는 것은 확인된 사실이고, `—`는 모른다는 뜻으로 읽힌다 */}
                <TableCell className="px-3 py-0 text-right font-mono text-xs tabular-nums">
                  {formatTokens(tokens[w.name] ?? 0)}
                </TableCell>
                <TableCell className="px-3 py-0">
                  <WorkerRowActions projectId={id} row={w} />
                </TableCell>
              </TableRow>
              {/* 이 워커의 둘째 행 — 경고 다섯과 펼친 컨텍스트가 한 셀에 산다(§비주얼 §35 #4).
                  경고가 하나도 없고 접혀 있으면 행 자체가 없다 — 정상 상태에 켜져 있는 경고를
                  만들지 않는다. 여기서 넘기는 둘은 서버가 그린다:

                  결함은 락을 만들지 않으므로 위 배지로는 안 보인다(§4) — 이 워커는 화면에 정상으로
                  뜨면서 티켓을 처리하지 못한다. 모양은 §4-1 `source` 줄 경고와 같은 Alert다.
                  외부 요인 실패(§0-5)도 **같은 행 같은 셀**이다(§4-4) — `TableRow`를 하나 더
                  만들면 행 경계선이 둘 사이에 그어져 같은 워커 것으로 안 읽힌다. 순서는
                  결함이 위·실패가 아래다: 사람이 할 일이 있는 쪽이 위고, 신선도 10분 창이라
                  자주 켜졌다 꺼지는 쪽을 아래 두어야 위 블록의 `CopyCommand`가 자리를 안 옮긴다. */}
              <WorkerContextRow
                projectId={id}
                row={w}
                others={rows.filter((o) => o.name !== w.name).map((o) => o.name)}
                common={commonItems}
                warnings={
                  w.defects.length > 0 || w.lastFailure ? (
                    <>
                      {w.defects.length > 0 && (
                        // role은 status다 — 5초 폴링이 이 표를 다시 그리므로 alert면 재낭독 위험이다(§4-4)
                        <Alert role="status">
                          <TriangleAlert aria-hidden className="text-status-stale" />
                          <AlertTitle>
                            {w.name} — {w.defects.map((d) => defect[d.kind].title).join(" · ")}
                          </AlertTitle>
                          <AlertDescription>
                            <div className="space-y-2">
                              {w.defects.map((d) => (
                                <p key={d.kind}>
                                  <span className="font-mono text-xs break-all">{d.detail}</span>{" "}
                                  {defect[d.kind].why}
                                </p>
                              ))}
                              {/* `w.worktree`는 `missing-cwd`·`missing-link`·`shared-cwd` 중 하나라도
                                  있을 때만 온다 — `no-exec`뿐인 워커에는 워크트리와 무관한 이 문단이
                                  안 뜬다(§0-21 결정 2·3, 두 축은 함께 있어도 서로 안 가린다). */}
                              {w.worktree && (
                                <p>
                                  준비 명령은 이 프로젝트의 배치인{" "}
                                  <span className="font-mono text-xs break-all">
                                    {project.root}/worktrees/{w.name}
                                  </span>
                                  를 만듭니다(§4-2) —{" "}
                                  <span className="font-mono text-xs">TICKET_CWD</span>가 그 경로가
                                  아니면 그 줄도 손으로 고치세요. 체크아웃은 GUI가 실행하지 않습니다.
                                </p>
                              )}
                              {w.worktree?.map((cmd) => (
                                <CopyCommand key={cmd} cmd={cmd} />
                              ))}
                              {/* `no-exec` 복구 버튼(§0-21 결정 3, §비주얼 §57 §1) — 사실은 위
                                  (defects map) · 조작은 아래(이 버튼)가 같은 순서다. 성공하면
                                  결함이 0개가 돼 이 `Alert` 자체가 사라진다. 나머지 결함 셋은
                                  버튼이 없다 — 판정 대상이 워커 파일 자신이라 추측이 0인 이
                                  결함 하나만의 예외다(§0-21 결정 3). */}
                              {w.execFix && (
                                <ExecBitFix projectId={id} name={w.name} cmd={w.execFix} />
                              )}
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
                      {w.lastFailure && (
                        // 위 결함과 아이콘·색 둘 다로 갈린다(CloudOff/blocked ↔ TriangleAlert/stale).
                        // `<CopyCommand>`를 붙이지 않는다 — 파일명은 원본을 찾을 단서지 실행할
                        // 명령이 아니고, 조작 0개가 §0-5의 결정이다(`Q2=(a)`).
                        <Alert role="status">
                          <CloudOff aria-hidden className="text-status-blocked" />
                          <AlertTitle>{w.name} — 세션이 즉시 실패했습니다</AlertTitle>
                          <AlertDescription>
                            {/* `<p>`가 아니라 `<div>`인 이유: `AlertDescription`이 마지막이 아닌
                                `<p>`에 `mb-4`를 건다. 이 둘은 같은 사실의 세 좌표라 붙어 있어야
                                위계가 순서·서체로 읽힌다(§4-4) */}
                            <div className="space-y-1">
                              {/* 엔진이 준 문자열 그대로. 배너와 같은 문자열·같은 서체다 */}
                              <div className="font-mono text-xs break-words">
                                {w.lastFailure.reason}
                              </div>
                              {/* 시각이 먼저인 것은 사유 안의 `resets 7:40pm`과 비교할 값이라서고,
                                  파일명이 나중인 것은 `ls`에 칠 값이라서다. 날짜는 안 붙인다 —
                                  신선도 창이 10분이라 항상 오늘이고 파일명 앞 8자가 날짜다(§4-4) */}
                              <div className="font-mono text-xs tabular-nums">
                                {w.lastFailure.at.slice(11)} · {w.lastFailure.log}
                              </div>
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  ) : null
                }
              />
              </Fragment>
            ))}
            </ExpandScope>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
