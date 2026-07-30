"use client";

/** 워커 화면(`/t/<tenant>/workers`)의 클라이언트 조각 — 생성 · 중단 · 삭제 · reap.
 *
 *  **crontab은 GUI가 만지지 않는다**(제약 4). 등록·해제는 서버가 만들어 준 명령어를
 *  `<CopyCommand>`로 복사시키고 사람이 셸에서 실행한다. 여기서 fs를 만지는 건 서버 액션뿐이다.
 *  파일 하나에 모은 이유는 tenants-ui.tsx와 같다 — 세 다이얼로그가 같은 문구·같은 명령어를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import {
  createWorkerAction,
  deleteWorkerAction,
  reapWorkerAction,
  type WorkerActionResult,
} from "@/app/t/[tenant]/workers/actions";
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
  tenantId,
  canTemplate,
  firstCmd,
  variant,
}: {
  tenantId: string;
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
              onClick={() => start(async () => setResult(await createWorkerAction(tenantId, name)))}
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

export function WorkerRowActions({ tenantId, row }: { tenantId: string; row: WorkerRow }) {
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
        onClick={() => start(async () => setReap(await reapWorkerAction(tenantId, row.name)))}
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
                    const r = await deleteWorkerAction(tenantId, row.name);
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
