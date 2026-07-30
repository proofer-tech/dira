"use client";

/** 워커 화면(`/p/<project>/workers`)의 클라이언트 조각 — 생성 · 중단 · 삭제 · reap.
 *
 *  **crontab은 GUI가 만지지 않는다**(제약 4). 등록·해제는 서버가 만들어 준 명령어를
 *  `<CopyCommand>`로 복사시키고 사람이 셸에서 실행한다. 여기서 fs를 만지는 건 서버 액션뿐이다.
 *  파일 하나에 모은 이유는 projects-ui.tsx와 같다 — 세 다이얼로그가 같은 문구·같은 명령어를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, CircleQuestionMark, TriangleAlert, X } from "lucide-react";
import {
  copyContextAction,
  createWorkerAction,
  deleteWorkerAction,
  reapWorkerAction,
  saveContextAction,
  type ContextResult,
  type WorkerActionResult,
} from "@/app/p/[project]/workers/actions";
import { CopyCommand } from "@/components/copy-command";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

/** 워커 생성. 만든 뒤에도 **아직 돌지 않는다** — crontab 한 줄이 있어야 돈다(제약 4).
 *  그래서 성공 화면의 주인공은 파일 경로가 아니라 등록 명령어다. */
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
            <div className="space-y-2">
              <p className="text-sm font-medium">아직 돌지 않습니다 — crontab에 등록하세요</p>
              <CopyCommand cmd={created.registerCmd} />
              <p className="text-xs text-muted-foreground">
                GUI는 crontab을 고치지 않습니다. 이 명령을 셸에서 실행해야 1분 뒤부터 티켓을
                물어갑니다.
              </p>
            </div>
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
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      {/* 중단 — 파일은 남기고 crontab 줄만 뺀다. 그 실행은 사람이 한다 */}
      <Dialog open={stopping} onOpenChange={setStopping}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>워커 중단 — {row.name}</DialogTitle>
            <DialogDescription>
              crontab에서 이 워커 줄을 뺍니다. 파일은 지우지 않습니다 — 다시 등록하면 그대로
              돌아옵니다.
            </DialogDescription>
          </DialogHeader>
          {row.cron ? (
            <CopyCommand cmd={row.unregisterCmd} />
          ) : (
            <p className="text-sm text-muted-foreground">
              이미 crontab에 없습니다. 이 워커는 지금도 돌지 않습니다.
            </p>
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
                <div className="space-y-2">
                  <p className="text-sm font-medium">crontab 줄도 같이 지우세요</p>
                  <CopyCommand cmd={row.unregisterCmd} />
                  <p className="text-xs text-muted-foreground">
                    남겨 두면 cron이 1분마다 없는 파일을 실행하고 cron.log에 에러가 쌓입니다.
                  </p>
                </div>
              )}
              {error && <Failure title={`워커 ${row.name} 삭제 실패`} message={error} />}
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
                    else setError(r.message ?? "삭제하지 못했습니다.");
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

/** 워커 하나의 컨텍스트 편집. 저장은 `TICKET_CONTEXT=( … )` **블록 전체 치환**이고, 블록 모양이
 *  예상과 다르면 서버가 거부한다 — 그때는 편집 UI를 아예 열지 않고 손으로 고치라고 알린다. */
export function WorkerContextCard({
  projectId,
  row,
  others,
}: {
  projectId: string;
  row: WorkerRow;
  /** 복사 대상 후보(자기 자신 제외) */
  others: string[];
}) {
  const saved = row.context.ok ? row.context.items : [];
  const [rows, setRows] = useState<ContextRow[]>(saved);
  const [result, setResult] = useState<ContextResult | null>(null);
  const [copyTo, setCopyTo] = useState<string | null>(null);
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
  const save = () =>
    start(async () => {
      const r = await saveContextAction(projectId, row.name, rows.map(({ path, desc }) => ({ path, desc })));
      setResult(r);
      if (r.ok && r.context?.ok) setRows(r.context.items);
    });

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

      {!row.context.ok ? (
        <>
          <Failure
            title={`${row.name}.sh의 TICKET_CONTEXT 블록을 GUI가 고칠 수 없습니다`}
            message={row.context.reason}
          />
          <p className="text-sm text-muted-foreground">
            추측해서 쓰지 않습니다 — 엉뚱한 라인을 밟으면 워커가 죽고 cron이 조용히 실패합니다.
            <span className="font-mono text-xs break-all"> {row.path}</span>를 손으로 편집한 뒤 이
            화면을 새로고침하세요.
          </p>
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              항목이 없습니다 — 이 워커의 세션은 참조 컨텍스트 없이 시작합니다.
            </p>
          ) : (
            <div className="space-y-1">
              {rows.map((r, i) => (
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
              ))}
            </div>
          )}

          {result && !result.ok && (
            <Failure title={`${row.name}.sh를 저장하지 못했습니다`} message={result.message ?? ""} />
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRows([...rows, { path: "", desc: "" }])}>
              항목 추가
            </Button>
            <Button size="sm" disabled={!dirty || pending} onClick={save}>
              {pending ? "저장 중…" : "저장"}
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRows(saved)}>
                되돌리기
              </Button>
            )}
            {dirty && (
              <span className="text-xs text-muted-foreground">
                저장하면 {row.name}.sh의 블록을 통째로 바꿉니다
              </span>
            )}
          </div>
        </>
      )}

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
          {result && !result.ok && <Failure title="복사하지 못했습니다" message={result.message ?? ""} />}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await copyContextAction(projectId, row.name, copyTo!);
                  setResult(r);
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
