"use client";

/** 워커 화면(`/p/<project>/workers`)의 클라이언트 조각 — 생성 · 중단 · 삭제 · reap.
 *
 *  **crontab의 그 워커 줄은 GUI가 쓴다**(제약 4, `44f876aa`로 뒤집힘). 생성·중단·삭제 세 자리가
 *  다 한 동작이고, 서버가 만들어 준 명령어를 `<CopyCommand>`로 복사시키는 건 **실패했을 때**다.
 *  fs를 만지는 건 서버 액션뿐이다.
 *  파일 하나에 모은 이유는 projects-ui.tsx와 같다 — 세 다이얼로그가 같은 문구·같은 명령어를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, CircleQuestionMark, TriangleAlert, X } from "lucide-react";
import {
  applyCommonSourceAction,
  copyContextAction,
  createWorkerAction,
  deleteWorkerAction,
  reapWorkerAction,
  saveCommonContextAction,
  saveContextAction,
  stopWorkerAction,
  type ContextResult,
  type WorkerActionResult,
} from "@/app/p/[project]/workers/actions";
import { CopyCommand } from "@/components/copy-command";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** 서버가 읽어 넘긴 컨텍스트 한 항목. `path`는 워커 파일에 든 셸 문자열이라 `$TICKET_CWD`가
 *  살아 있고, `resolved`·`exists`는 그걸 편 결과다(파일에는 안 들어간다). */
export type ContextRow = {
  path: string;
  desc: string;
  resolved?: string;
  /** true 있음 · false 없음(엔진이 건너뛴다) · null 변수를 못 펴 확인 불가 · undefined 저장 전 */
  exists?: boolean | null;
};

/** 서버가 읽어 넘긴 한 줄. cron 명령어는 서버에서 만든다 — 인용 규칙이 `lib/workers.ts`에 있다. */
export type WorkerRow = {
  name: string;
  path: string;
  status: "running" | "idle" | "stopped" | "stale";
  cron: boolean;
  lockPid: number | null;
  holding: string | null;
  engine: string;
  lastLog: string | null;
  registerCmd: string;
  unregisterCmd: string;
  /** TICKET_CONTEXT 항목 또는 GUI가 못 고치는 사유 */
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string };
  /** 공통 컨텍스트 `source` 줄이 있는가. false면 이 워커는 공통을 못 받는다 (§4-1) */
  commonSource: boolean;
};

/** §6 에러 3요소 중 1·2번. 3번(다음 행동)은 부르는 쪽이 다이얼로그 안에 붙인다. */
function Failure({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="font-mono text-xs break-all">{message}</span>
      </AlertDescription>
    </Alert>
  );
}

// ── 생성 ────────────────────────────────────────────────────────────────────

/** 워커 생성. **한 동작으로 끝난다** — 파일을 만들고 crontab 한 줄까지 서버가 등록한다(제약 4).
 *  등록이 실패했을 때만 성공 화면이 종전의 등록 명령어로 되돌아간다. */
export function CreateWorkerButton({
  projectId,
  canTemplate,
  firstCmd,
  variant,
}: {
  projectId: string;
  /** 템플릿으로 쓸 기존 워커가 있는가. 없으면 GUI가 만들 수 없다(엔진 코드 위치를 모른다) */
  canTemplate: boolean;
  /** 워커 0개일 때 손으로 첫 워커를 만드는 명령 */
  firstCmd: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [result, setResult] = useState<WorkerActionResult | null>(null);
  const [pending, start] = useTransition();
  const created = result?.created;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setName("");
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={variant} />}>워커 생성</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>워커 생성</DialogTitle>
          <DialogDescription>
            워커 하나가 크론잡 하나고, 한 번 실행에 티켓 1건을 끝냅니다. 동시성 = 워커 개수입니다.
          </DialogDescription>
        </DialogHeader>

        {!canTemplate ? (
          // 마지막 `. <엔진레포>/tick.sh` 한 줄을 GUI가 알 방법이 없다 — 추측해서 만들면
          // 돌지 않는 워커 파일이 생기고, 사람은 왜 안 도는지 모른다.
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              이 큐에는 템플릿으로 쓸 워커가 없습니다. GUI는 기존 워커를 복사해서만 만들 수
              있습니다 — 엔진 코드(tick.sh)가 어디 있는지는 워커 파일에만 적혀 있습니다.
              첫 워커는 손으로 만듭니다.
            </p>
            <CopyCommand cmd={firstCmd} />
            <p className="text-sm text-muted-foreground">
              만든 뒤 <span className="font-mono text-xs">TICKET_CWD</span> 등 값을 확인하고,
              이 화면을 새로고침하면 나머지는 GUI에서 만들 수 있습니다.
            </p>
          </div>
        ) : created ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-mono text-xs">{created.template}</span>을 복사해{" "}
              <span className="font-mono text-xs break-all">{created.path}</span>를 만들고 755로
              두었습니다. 내용을 확인하고 필요하면 손으로 고치세요.
            </p>
            {created.cron ? (
              <p className="text-sm font-medium">
                crontab에 등록했습니다 — 1분 뒤부터 티켓을 물어갑니다.
              </p>
            ) : (
              // 파일은 있고 등록만 실패했다. 되돌리지 않고 사람이 셸에서 마무리하게 한다.
              <div className="space-y-2">
                <Failure title="crontab에 등록하지 못했습니다" message={created.cronError ?? ""} />
                <p className="text-sm font-medium">
                  아직 돌지 않습니다 — 이 명령을 셸에서 실행하세요
                </p>
                <CopyCommand cmd={created.registerCmd} />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="worker-name">이름</Label>
            <Input
              id="worker-name"
              className="font-mono"
              placeholder="w4"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              영문·숫자·_·-. 파일은 workers/&lt;이름&gt;.sh 가 됩니다
            </p>
            {result?.message && <Failure title="워커를 만들지 못했습니다" message={result.message} />}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {created || !canTemplate ? "닫기" : "취소"}
          </DialogClose>
          {canTemplate && !created && (
            <Button
              disabled={pending || !name.trim()}
              onClick={() => start(async () => setResult(await createWorkerAction(projectId, name)))}
            >
              {pending ? "만드는 중…" : "만들기"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 행 액션: reap · 중단 · 삭제 ─────────────────────────────────────────────

export function WorkerRowActions({ projectId, row }: { projectId: string; row: WorkerRow }) {
  const [pending, start] = useTransition();
  const [reap, setReap] = useState<WorkerActionResult | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState<WorkerActionResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<WorkerActionResult | null>(null);

  return (
    <div className="flex items-center justify-end gap-1">
      {/* 판정도 rename도 엔진이 한다 — GUI는 부르고 출력을 보여줄 뿐이다(제약 2) */}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => start(async () => setReap(await reapWorkerAction(projectId, row.name)))}
      >
        {pending ? "reap…" : "reap"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setStopping(true)}>
        중단
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
        삭제
      </Button>

      {/* reap 출력 */}
      <Dialog open={!!reap} onOpenChange={(o) => !o && setReap(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>reap — {row.name}</DialogTitle>
            <DialogDescription>
              세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌립니다.
            </DialogDescription>
          </DialogHeader>
          {reap && !reap.ok && (
            <Failure title={`${row.name}.sh reap 실패`} message={reap.message ?? reap.output ?? ""} />
          )}
          {reap?.output && (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs break-all whitespace-pre-wrap">
              {reap.output}
            </pre>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 중단 — 파일은 남기고 crontab 줄만 GUI가 뺀다. 실패했을 때만 복사 명령으로 돌아간다 */}
      <Dialog
        open={stopping}
        onOpenChange={(o) => {
          setStopping(o);
          if (!o) setStopped(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>워커 중단 — {row.name}</DialogTitle>
            <DialogDescription>
              crontab에서 이 워커 줄을 뺍니다. 파일은 지우지 않습니다 — 다시 등록하면 그대로
              돌아옵니다.
            </DialogDescription>
          </DialogHeader>
          {stopped?.ok ? (
            // 이미 미등록이었으면 no-op이라고 말한다 — 에러가 아니다
            <p className="text-sm font-medium">{stopped.message}</p>
          ) : (
            <>
              {!row.cron && (
                <p className="text-sm text-muted-foreground">
                  이미 crontab에 없습니다. 이 워커는 지금도 돌지 않습니다.
                </p>
              )}
              {stopped && (
                <div className="space-y-2">
                  <Failure title="crontab에서 빼지 못했습니다" message={stopped.message ?? ""} />
                  <p className="text-sm font-medium">이 명령을 셸에서 실행하세요</p>
                  <CopyCommand cmd={row.unregisterCmd} />
                </div>
              )}
            </>
          )}
          {row.status === "running" && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>지금 티켓을 물고 있습니다</AlertTitle>
              <AlertDescription>
                진행중인 세션은 죽이지 않습니다. crontab에서 빼도 지금 물고 있는 티켓이 끝난 뒤에
                멈춥니다.
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
            {!stopped?.ok && (
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => setStopped(await stopWorkerAction(projectId, row.name)))
                }
              >
                {pending ? "중단하는 중…" : "중단"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 — running이면 막는다. 락과 세션이 붕 뜬다 */}
      <Dialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>워커 삭제 — {row.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{row.path}</DialogDescription>
          </DialogHeader>

          {row.status === "running" ? (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>지금은 삭제할 수 없습니다</AlertTitle>
              <AlertDescription>
                이 워커가 티켓을 물고 있습니다(pid {row.lockPid ?? "?"}). 지금 지우면 락과 돌고 있는
                세션이 붕 뜹니다. 먼저 중단하고, 물고 있는 티켓이 끝난 뒤 지우세요.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                파일을 지웁니다. 이 큐의 티켓은 삭제되지 않습니다.
              </p>
              {row.cron && (
                <p className="text-sm">
                  crontab 줄도 같이 뺍니다 — <span className="font-medium">crontab 먼저, 파일
                  나중</span>입니다. 남겨 두면 cron이 1분마다 없는 파일을 실행하고 cron.log에
                  에러가 쌓입니다.
                </p>
              )}
              {error && (
                <div className="space-y-2">
                  <Failure title={`워커 ${row.name} 삭제 실패`} message={error.message ?? ""} />
                  {error.cronFailed && (
                    <>
                      <p className="text-sm font-medium">
                        파일은 그대로입니다 — 이 명령으로 crontab 줄을 뺀 뒤 다시 시도하세요
                      </p>
                      <CopyCommand cmd={row.unregisterCmd} />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
            {row.status !== "running" && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteWorkerAction(projectId, row.name);
                    if (r.ok) setDeleting(false);
                    else setError({ ...r, message: r.message ?? "삭제하지 못했습니다." });
                  })
                }
              >
                {pending ? "삭제 중…" : "삭제"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 컨텍스트 경로 (TICKET_CONTEXT) ──────────────────────────────────────────

/** 존재 여부 표시. **없는 건 에러가 아니다** — 엔진이 건너뛰고 WARN만 남긴다(tick.sh 148행).
 *  그래서 없음은 destructive가 아니라 중립색이고, 문구가 그 사실을 말한다. */
function ExistsMark({ row }: { row: ContextRow }) {
  const [Icon, tint, label] =
    row.exists === true
      ? [Check, "text-status-done", "있음"]
      : row.exists === false
        ? [X, "text-muted-foreground", "없음 — 엔진이 건너뛰고 WARN만 남깁니다"]
        : row.exists === null
          ? [CircleQuestionMark, "text-muted-foreground", `변수를 못 펴서 확인 못 했습니다: ${row.resolved}`]
          : [CircleQuestionMark, "text-muted-foreground", "저장하면 확인합니다"];
  return (
    <span className="flex items-center gap-1" title={row.resolved ? `${row.resolved} — ${label}` : label}>
      <Icon aria-hidden className={cn("size-4 shrink-0", tint)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** 항목 목록 편집 + 저장. **워커 카드와 공통 카드가 같은 이 컴포넌트를 쓴다**(§4-1: "편집기는
 *  워커별 것과 같은 컴포넌트다"). 파일 이름·블록 이름·저장 액션만 갈린다. */
function ContextEditor({
  file,
  arr,
  filePath,
  context,
  common,
  emptyText,
  addLabel,
  save,
}: {
  /** 저장이 바꾸는 파일(표시용) — `w1.sh` · `context.sh` */
  file: string;
  /** 통째로 치환되는 블록 이름 — `TICKET_CONTEXT` · `TICKET_CONTEXT_COMMON` */
  arr: string;
  /** 손으로 고치라고 알릴 때 보여줄 절대경로 */
  filePath: string;
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string };
  /** 목록 **최상단**에 `공통` 배지 + 읽기 전용으로 붙는 항목(워커 카드에서만).
   *  **저장에 들어가지 않는다** — 이 항목은 워커 파일에 실제로 없다(§4-1) */
  common?: ContextRow[];
  emptyText: string;
  addLabel: string;
  save: (items: { path: string; desc: string }[]) => Promise<ContextResult>;
}) {
  const saved = context.ok ? context.items : [];
  const [rows, setRows] = useState<ContextRow[]>(saved);
  const [result, setResult] = useState<ContextResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(rows.map((r) => [r.path, r.desc])) !== JSON.stringify(saved.map((r) => [r.path, r.desc]));

  const edit = (i: number, patch: Partial<ContextRow>) =>
    // 경로가 바뀌면 존재 여부는 더 이상 그 경로의 사실이 아니다 — 저장 후에 다시 받는다.
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch, exists: undefined, resolved: undefined } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRows(next);
  };

  if (!context.ok) {
    return (
      <>
        <Failure title={`${file}의 ${arr} 블록을 GUI가 고칠 수 없습니다`} message={context.reason} />
        <p className="text-sm text-muted-foreground">
          추측해서 쓰지 않습니다 — 엉뚱한 라인을 밟으면 워커가 죽고 cron이 조용히 실패합니다.
          <span className="font-mono text-xs break-all"> {filePath}</span>를 손으로 편집한 뒤 이
          화면을 새로고침하세요.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {/* 공통 항목: 편집 입력·삭제·순서 컨트롤이 **없다.** 이 화면에서 지울 수 없다는 것이
            요청(f3254035)의 핵심이고, 파일에도 실제로 없으므로 UI가 거짓말하지 않는다.
            ponytail: 존재 표시는 공통 카드에서만 한다 — `$TICKET_CWD`가 워커마다 갈려서 여기
            같은 판정을 붙이면 워커에 따라 거짓이 된다. 워커별로 필요해지면 그때 cwd를 넘긴다. */}
        {common?.map((r, i) => (
          // 편집 행과 열이 맞지 않는다(입력·순서·삭제 컨트롤이 없으니 그게 맞다) — 띠로 묶어
          // 편집 행이 아님을 먼저 읽히게 한다.
          <div key={`common-${i}`} className="flex min-h-9 items-center gap-2 rounded-md bg-muted/50 px-2">
            <Badge variant="outline" className="shrink-0">
              공통
            </Badge>
            <span className="flex-[2] truncate font-mono text-xs" title={r.path}>
              {r.path}
            </span>
            <span className="flex-1 truncate text-xs text-muted-foreground" title={r.desc}>
              {r.desc}
            </span>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <ExistsMark row={r} />
              <Input
                aria-label="경로"
                className="flex-[2] font-mono text-xs"
                placeholder="$TICKET_CWD/docs/DESIGN.md"
                value={r.path}
                onChange={(e) => edit(i, { path: e.target.value })}
              />
              <Input
                aria-label="설명"
                className="flex-1 text-xs"
                placeholder="설명(선택) — 세션이 읽을 이유"
                value={r.desc}
                onChange={(e) => edit(i, { desc: e.target.value })}
              />
              <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
                <span className="sr-only">위로</span>
              </Button>
              <Button variant="ghost" size="sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden />
                <span className="sr-only">아래로</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <X aria-hidden />
                <span className="sr-only">삭제</span>
              </Button>
            </div>
          ))
        )}
      </div>

      {/* 저장 거부(블록 모양이 예상과 다름)는 §6 에러 3요소 — 파일은 쓰이지 않았다 */}
      {result && !result.ok && (
        <Failure title={`${file}를 저장하지 못했습니다`} message={result.message ?? ""} />
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { path: "", desc: "" }])}>
          {addLabel}
        </Button>
        <Button
          size="sm"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              // 워커 자기 항목만 보낸다 — 공통은 `common`이고 이 배열에 없다.
              const r = await save(rows.map(({ path, desc }) => ({ path, desc })));
              setResult(r);
              if (r.ok && r.context?.ok) setRows(r.context.items);
            })
          }
        >
          {pending ? "저장 중…" : "저장"}
        </Button>
        {dirty && (
          <>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRows(saved)}>
              되돌리기
            </Button>
            <span className="text-xs text-muted-foreground">
              저장하면 {file}의 {arr} 블록을 통째로 바꿉니다
            </span>
          </>
        )}
      </div>
    </>
  );
}

/** 공통 컨텍스트 카드 — 워커 화면 **최상단**(§4-1). 편집기는 워커별 것과 같은 컴포넌트다.
 *  `context.sh`가 없으면 항목 0개이고 **오류가 아니다** — 빈 상태 + `공통 항목 추가`다. */
export function CommonContextCard({
  projectId,
  filePath,
  context,
}: {
  projectId: string;
  /** `<루트>/context.sh` */
  filePath: string;
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string };
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">공통</Badge>
        <span className="font-mono text-sm">context.sh</span>
        <span className="text-xs text-muted-foreground">
          {context.ok ? `${context.items.length}개` : "읽지 못했습니다"}
        </span>
      </div>
      <ContextEditor
        file="context.sh"
        arr="TICKET_CONTEXT_COMMON"
        filePath={filePath}
        context={context}
        emptyText="공통 항목이 없습니다 — 워커는 각자 자기 항목만 읽습니다."
        addLabel="공통 항목 추가"
        save={(items) => saveCommonContextAction(projectId, items)}
      />
    </div>
  );
}

/** 워커 하나의 컨텍스트 편집. 저장은 `TICKET_CONTEXT=( … )` **블록 전체 치환**이고, 블록 모양이
 *  예상과 다르면 서버가 거부한다 — 그때는 편집 UI를 아예 열지 않고 손으로 고치라고 알린다. */
export function WorkerContextCard({
  projectId,
  row,
  others,
  common,
}: {
  projectId: string;
  row: WorkerRow;
  /** 복사 대상 후보(자기 자신 제외) */
  others: string[];
  /** 공통 항목. `row.commonSource`가 false면 이 워커는 못 받으므로 그리지 않는다 (§4-1) */
  common: ContextRow[];
}) {
  const saved = row.context.ok ? row.context.items : [];
  const [copyTo, setCopyTo] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const gets = row.commonSource ? common : [];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{row.name}</span>
          <span className="text-xs text-muted-foreground">
            {row.context.ok ? `${saved.length}개` : "읽지 못했습니다"}
          </span>
        </div>
        {row.context.ok && others.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">이 설정을 복사:</span>
            {others.map((o) => (
              <Button key={o} variant="ghost" size="sm" className="font-mono" onClick={() => setCopyTo(o)}>
                → {o}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* `source` 줄이 없으면 이 워커만 공통에서 빠진다. 조용히 넘기면 "전원이 본다"는 전제가
          화면에서 거짓이 된다(§4-1) — 사실을 말하고 그 자리에서 줄을 넣게 한다. */}
      {!row.commonSource && (
        <Alert>
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>이 워커는 공통 컨텍스트를 받지 않습니다</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                {row.name}.sh에 <span className="font-mono text-xs">context.sh</span>를{" "}
                <span className="font-mono text-xs">.</span> 하는 줄이 없습니다 — 위 공통 항목{" "}
                {common.length}개가 이 워커의 세션에는 붙지 않습니다.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await applyCommonSourceAction(projectId, row.name);
                    setApplyError(r.ok ? null : (r.message ?? "줄을 넣지 못했습니다."));
                  })
                }
              >
                {pending ? "적용 중…" : "공통 적용"}
              </Button>
              {applyError && <Failure title="공통을 적용하지 못했습니다" message={applyError} />}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <ContextEditor
        file={`${row.name}.sh`}
        arr="TICKET_CONTEXT"
        filePath={row.path}
        context={row.context}
        common={gets}
        emptyText={
          gets.length > 0
            ? "이 워커의 자기 항목은 없습니다 — 위 공통 항목만 받습니다."
            : "항목이 없습니다 — 이 워커의 세션은 참조 컨텍스트 없이 시작합니다."
        }
        addLabel="항목 추가"
        save={(items) => saveContextAction(projectId, row.name, items)}
      />

      {/* 워커 간 복사 — 받는 쪽 블록이 통째로 없어진다. 되돌리기가 없으므로 먼저 알린다 */}
      <Dialog open={!!copyTo} onOpenChange={(o) => !o && setCopyTo(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              컨텍스트 복사 — {row.name} → {copyTo}
            </DialogTitle>
            <DialogDescription>
              {copyTo}.sh의 TICKET_CONTEXT 블록을 {row.name}의 항목 {saved.length}개로 바꿉니다.
              {copyTo}의 기존 항목은 남지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-xs">$TICKET_CWD</span>는 펴지 않고 문자열째로 옮깁니다 —
            받는 워커는 자기 작업 디렉터리를 가리킵니다. 컨텍스트가 워커마다 갈라져 있으면 같은
            티켓이 어느 워커에 물리느냐로 결과가 달라집니다.
          </p>
          {copyError && <Failure title="복사하지 못했습니다" message={copyError} />}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await copyContextAction(projectId, row.name, copyTo!);
                  setCopyError(r.ok ? null : (r.message ?? "복사하지 못했습니다."));
                  if (r.ok) setCopyTo(null);
                })
              }
            >
              {pending ? "복사 중…" : "복사"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
