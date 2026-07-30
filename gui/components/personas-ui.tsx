"use client";

/** 페르소나 화면(`/p/<project>/personas`)의 클라이언트 조각 — 생성 · 편집 · 삭제.
 *
 *  fs를 만지는 건 서버 액션뿐이다(`app/p/[project]/personas/actions.ts`). 파일 하나에 모은 이유는
 *  `workers-ui.tsx`와 같다 — 같은 화면의 세 액션이 같은 문구(엔진이 WARN만 남긴다 · 이름 규칙)를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import {
  createPersonaAction,
  deletePersonaAction,
  savePersonaAction,
  type PersonaResult,
} from "@/app/p/[project]/personas/actions";
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
import { Textarea } from "@/components/ui/textarea";

/** 서버가 읽어 넘긴 한 항목. `body: null` = PROFILE.md가 없다(엔진의 WARN 케이스). */
export type PersonaRow = {
  name: string;
  file: string;
  body: string | null;
  refs: { open: number; wip: number; total: number };
};

/** §6 에러 3요소 중 1·2번. 사유는 원문 그대로 — 삼키지 않는다. */
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

/** `열린 2 · 진행중 1` — 0인 종류는 뺀다. 참조가 없으면 null(호출자가 자리를 비운다). */
function refsLabel(refs: PersonaRow["refs"]): string | null {
  const parts = [
    refs.open > 0 && `열린 ${refs.open}`,
    refs.wip > 0 && `진행중 ${refs.wip}`,
    refs.total - refs.open - refs.wip > 0 && `완료 ${refs.total - refs.open - refs.wip}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// ── 생성 ────────────────────────────────────────────────────────────────────

/** 이름 규칙은 **서버가** 판정한다(`tickets.py PERSONA_RE`와 같은 규칙). 여기서 미리 막지 않는
 *  이유: 클라이언트 검증은 검증이 아니고, 규칙이 두 군데 있으면 갈린다. 대신 사유를 그 자리에 띄운다. */
export function CreatePersonaButton({
  projectId,
  variant,
}: {
  projectId: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [result, setResult] = useState<PersonaResult | null>(null);
  const [pending, start] = useTransition();

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
      <DialogTrigger render={<Button size="sm" variant={variant} />}>페르소나 생성</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>페르소나 생성</DialogTitle>
          <DialogDescription>
            티켓의 <span className="font-mono text-xs">persona:</span> 값이 곧 디렉터리 이름입니다.
            프로필 본문은 세션 프롬프트 머리에 인라인됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="persona-name">이름</Label>
          <Input
            id="persona-name"
            className="font-mono"
            placeholder="developer"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            영문·숫자·_·-. 파일은 &lt;personas&gt;/&lt;이름&gt;/PROFILE.md 가 됩니다
          </p>
          {result?.message && (
            <Failure title="페르소나를 만들지 못했습니다" message={result.message} />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const r = await createPersonaAction(projectId, name);
                setResult(r);
                if (r.ok) setOpen(false);
              })
            }
          >
            {pending ? "만드는 중…" : "만들기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 편집 · 삭제 ─────────────────────────────────────────────────────────────

/** 페르소나 하나. `body: null`(프로필 없음)이면 빈 textarea가 열리고 **저장이 곧 생성**이다 —
 *  티켓이 부르는데 프로필이 없는 이름을 그 자리에서 채우게 하려고 경로를 하나로 둔다. */
export function PersonaCard({ projectId, row }: { projectId: string; row: PersonaRow }) {
  // 저장된 원문을 state로 들고 있는다 — 서버가 다시 렌더해 주기를 기다리지 않고 저장 직후에
  // `프로필 없음` 배지와 삭제 버튼이 바로 맞는다(workers-ui의 컨텍스트 카드와 같은 이유).
  const [saved, setSaved] = useState(row.body);
  const [body, setBody] = useState(row.body ?? "");
  const [result, setResult] = useState<PersonaResult | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const refs = refsLabel(row.refs);
  const dirty = body !== (saved ?? "");

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-sm">{row.name}</span>
          {saved === null && <Badge variant="outline">프로필 없음</Badge>}
          <span className="truncate text-xs text-muted-foreground" title={row.file}>
            {refs ? `티켓 ${refs}` : "참조하는 티켓 없음"}
          </span>
        </div>
        {saved !== null && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="ghost" size="sm">
                  <Trash2 aria-hidden />
                  삭제
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>페르소나 삭제 — {row.name}</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="font-mono text-xs break-all">
                    {row.file.replace(/\/PROFILE\.md$/, "")}
                  </span>{" "}
                  디렉터리를 안의 파일까지 지웁니다. 되돌릴 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {/* 티켓은 지우지 않는다 — 남은 티켓은 페르소나 없이 디스패치된다(tick.sh 188행) */}
              {row.refs.open + row.refs.wip > 0 && (
                <Alert>
                  <TriangleAlert aria-hidden className="text-status-stale" />
                  <AlertTitle>
                    이 페르소나를 참조하는 티켓이 {row.refs.open + row.refs.wip}건 있습니다
                    {row.refs.wip > 0 && ` (진행중 ${row.refs.wip}건)`}
                  </AlertTitle>
                  <AlertDescription>
                    티켓은 지워지지 않습니다. 프로필이 없어지면 엔진은{" "}
                    <span className="font-mono text-xs">WARN</span>만 남기고{" "}
                    <strong className="font-medium">페르소나 없이</strong> 디스패치합니다 — 세션이
                    역할·권한을 모르는 채로 시작합니다.
                  </AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deletePersonaAction(projectId, row.name);
                      if (!r.ok) setDeleteError(r.message ?? "삭제하지 못했습니다.");
                    })
                  }
                >
                  삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {deleteError && <Failure title="삭제하지 못했습니다" message={deleteError} />}

      {/* 원문 편집이다 — 마크다운 렌더는 넣지 않는다(§6 프로토콜 에디터와 같은 결정) */}
      <Textarea
        aria-label={`${row.name} PROFILE.md`}
        className="font-mono"
        rows={16}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {result && !result.ok && (
        <Failure title="저장하지 못했습니다" message={result.message ?? ""} />
      )}
      <div className="flex items-center gap-4">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await savePersonaAction(projectId, row.name, body);
              setResult(r);
              if (r.ok) setSaved(body);
            })
          }
        >
          {pending ? "저장 중…" : "저장"}
        </Button>
        {result?.ok && !dirty && (
          <span className="text-sm text-muted-foreground">저장됐습니다.</span>
        )}
        {/* 프로필 본문은 **모든 디스패치 프롬프트에 인라인된다** — 길이가 곧 비용이다(§6) */}
        <span className="font-mono text-xs text-muted-foreground">{body.length}자</span>
      </div>
    </div>
  );
}
