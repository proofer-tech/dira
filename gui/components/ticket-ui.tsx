"use client";

/** 티켓 상세(`/t/<tenant>/tickets/<hash>`)의 클라이언트 조각 — 편집 폼 · 할당 해제 · 삭제.
 *
 *  셋이 한 파일에 있는 이유는 `tenants-ui.tsx`와 같다: 한 화면의 액션이고 전부 서버 액션 뒤에
 *  있다(fs 접근은 여기 없다). 결과를 **토스트에 담지 않는다** — 워커 스크립트 출력과 검증 사유는
 *  읽어야 하는 정보고, 3초 뒤 사라지는 자리에 두면 못 본다(DESIGN.md §8이 해석 결과 표에 쓴
 *  같은 근거다). */
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert, Unlink } from "lucide-react";
import { deleteTicket, saveTicket, unassignTicket, type SaveState } from "@/app/t/[tenant]/tickets/[hash]/actions";
import type { UnassignRun } from "@/lib/engine";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** 실패 사유는 원문 그대로. 삼키지 않는다(§6 에러 3요소). */
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

// ── 편집 폼 ─────────────────────────────────────────────────────────────────

/** frontmatter의 title·kind·persona + 본문 원문. `.wip`이면 이 폼은 렌더되지 않고
 *  서버 액션도 다시 거부한다(렌더 시점 판정은 저장 시점엔 이미 낡았다). */
export function TicketEditForm({
  tenant,
  hash,
  title,
  kind,
  persona,
  body,
}: {
  tenant: string;
  hash: string;
  title: string;
  kind: string;
  persona: string;
  body: string;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveTicket, {});
  return (
    <form action={action} className="max-w-3xl space-y-4">
      <input type="hidden" name="tenant" value={tenant} />
      <input type="hidden" name="hash" value={hash} />
      <div className="space-y-2">
        <Label htmlFor="t-title">title</Label>
        <Input id="t-title" name="title" defaultValue={title} />
      </div>
      <div className="flex gap-4">
        <div className="grow space-y-2">
          <Label htmlFor="t-kind">kind</Label>
          <Input id="t-kind" name="kind" defaultValue={kind} placeholder="work · request · feedback" />
        </div>
        <div className="grow space-y-2">
          <Label htmlFor="t-persona">persona</Label>
          <Input id="t-persona" name="persona" className="font-mono" defaultValue={persona} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="t-body">본문</Label>
        {/* 원문 편집이다 — 마크다운 렌더는 넣지 않는다(§6 프로토콜 에디터와 같은 결정) */}
        <Textarea id="t-body" name="body" defaultValue={body} rows={24} className="font-mono" />
      </div>
      {state.error && <Failure title="저장하지 못했습니다" message={state.error} />}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
        {state.ok && <span className="text-sm text-muted-foreground">저장됐습니다.</span>}
      </div>
    </form>
  );
}

// ── 할당 해제 ───────────────────────────────────────────────────────────────

/** `workers/<w>.sh unassign <해시>` 호출 버튼. claim/release를 TS로 다시 구현하지 않는다(제약 2).
 *  워커가 0개면 부를 스크립트가 없다 — 비활성화하고 이유를 그 자리에 적는다.
 *
 *  `assigned` 판정을 **이 안에서** 한다: 성공하면 티켓이 미할당으로 바뀌므로, 서버 쪽에서
 *  조건부로 렌더하면 이 컴포넌트가 통째로 사라져 스크립트 출력도 같이 사라진다(실측). */
export function UnassignButton({
  tenant,
  hash,
  worker,
  assigned,
}: {
  tenant: string;
  hash: string;
  /** 호출될 워커 이름. 0개면 null */
  worker: string | null;
  assigned: boolean;
}) {
  const [pending, start] = useTransition();
  const [run, setRun] = useState<UnassignRun | null>(null);
  if (!assigned && !run) return null; // 할당 안 된 티켓엔 이 액션이 없다

  return (
    <div className="space-y-2">
      {assigned && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !worker}
            onClick={() => start(async () => setRun(await unassignTicket(tenant, hash)))}
          >
            <Unlink aria-hidden />
            {pending ? "할당 해제 중…" : "할당 해제"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {worker ? (
              <>
                <span className="font-mono">
                  {worker}.sh unassign {hash}
                </span>{" "}
                를 호출합니다
              </>
            ) : (
              "이 테넌트에 워커가 없습니다 — 할당 해제를 호출할 스크립트가 없습니다."
            )}
          </span>
        </div>
      )}
      {/* 스크립트 출력은 그대로 보여준다: 백로그 복귀 여부가 여기 적혀 온다 */}
      {run &&
        (run.ok ? (
          <Alert>
            <Unlink aria-hidden />
            <AlertTitle>할당 해제 완료{run.worker && ` — ${run.worker}`}</AlertTitle>
            <AlertDescription>
              <pre className="font-mono text-xs whitespace-pre-wrap">{run.output}</pre>
            </AlertDescription>
          </Alert>
        ) : (
          <Failure title="할당 해제 실패" message={run.output} />
        ))}
    </div>
  );
}

// ── 삭제 ────────────────────────────────────────────────────────────────────

/** 확인 다이얼로그. `.wip`이면 트리거 자체가 비활성이고 서버 액션도 다시 거부한다. */
export function DeleteTicketButton({
  tenant,
  hash,
  title,
  locked,
}: {
  tenant: string;
  hash: string;
  title: string;
  /** `.wip` — 세션이 물고 있어서 지울 수 없다 */
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (locked) {
    return (
      <Button variant="outline" size="sm" disabled title="진행중 티켓은 삭제할 수 없습니다">
        <Trash2 aria-hidden />
        삭제
      </Button>
    );
  }

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="outline" size="sm">
              <Trash2 aria-hidden />
              삭제
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>티켓 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{hash}</span> &quot;{title}&quot;의 파일을 지웁니다. 되돌릴
              수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteTicket(tenant, hash);
                  if (r.ok) router.push(`/t/${tenant}`);
                  else setError(r.message ?? "삭제하지 못했습니다.");
                })
              }
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && <Failure title="삭제하지 못했습니다" message={error} />}
    </>
  );
}
