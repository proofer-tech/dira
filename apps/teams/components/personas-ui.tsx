"use client";

/** 페르소나 화면(`/p/<project>/personas`)의 클라이언트 조각 — 생성 · 편집 · 삭제.
 *
 *  fs를 만지는 건 서버 액션뿐이다(`app/p/[project]/personas/actions.ts`). 파일 하나에 모은 이유는
 *  `workers-ui.tsx`와 같다 — 같은 화면의 세 액션이 같은 문구(엔진이 WARN만 남긴다 · 이름 규칙)를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import { ChevronRight, Trash2, TriangleAlert } from "lucide-react";
import {
  createPersonaAction,
  deletePersonaAction,
  savePersonaAction,
  setPersonaColorAction,
  type PersonaResult,
} from "@/app/p/[project]/personas/actions";
// 접힌 줄의 점도 보드·칸반·필터와 **같은 컴포넌트**다(§5) — 색 조회의 출처는 하나다
import { PersonaDot } from "@/components/persona-badge";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { PERSONA_COLORS, personaDotClass } from "@/lib/urls";
import { cn } from "@/lib/utils";

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

// ── 색 (DESIGN.md §5 · §비주얼 §12) ─────────────────────────────────────────

/** 접힌 줄의 점이 곧 트리거다(§12). `<summary>` 안이라 클릭이 곧 펼침 토글인데 — 삭제 버튼과
 *  같은 처방으로 `preventDefault`다(호출부에서 감싼다. `stopPropagation`은 안 통한다).
 *  `command`도 `select`도 아니다: 9개는 검색할 양이 아니고 항목의 내용이 글자가 아니라 색이다. */
function ColorPicker({
  projectId,
  name,
  color,
  onError,
}: {
  projectId: string;
  name: string;
  color?: string;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(color);
  const [, start] = useTransition();

  const pick = (next: string | null) =>
    start(async () => {
      setCurrent(next ?? undefined);
      setOpen(false);
      const r = await setPersonaColorAction(projectId, name, next);
      onError(r.ok ? null : (r.message ?? "색을 저장하지 못했습니다."));
      if (!r.ok) setCurrent(color);
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center rounded-full p-1 hover:bg-accent"
          />
        }
      >
        <PersonaDot color={current} />
        {/* 색만으로 뜻을 전하지 않는다(§0) — 점은 aria-hidden이고 값은 여기서 말한다 */}
        <span className="sr-only">{current ? `색: ${current}` : "색 없음"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-3 gap-2">
          {PERSONA_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => pick(c)}
              className={cn(
                "size-6 cursor-pointer rounded-full",
                personaDotClass(c),
                c === current && "ring-2 ring-ring ring-offset-2",
              )}
            />
          ))}
          {/* 9번째 칸이 `색 없음`이다 — 3×3이 정확히 차서 빈 칸이 없다(§12) */}
          <button
            type="button"
            aria-label="색 없음"
            onClick={() => pick(null)}
            className={cn(
              "size-6 cursor-pointer rounded-full border border-muted-foreground",
              !current && "ring-2 ring-ring ring-offset-2",
            )}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
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
export function PersonaCard({
  projectId,
  row,
  color,
}: {
  projectId: string;
  row: PersonaRow;
  /** 레지스트리의 팔레트 키. 없거나 팔레트 밖이면 빈 점이다(§12) */
  color?: string;
}) {
  // 저장된 원문을 state로 들고 있는다 — 서버가 다시 렌더해 주기를 기다리지 않고 저장 직후에
  // `프로필 없음` 배지와 삭제 버튼이 바로 맞는다(workers-ui의 컨텍스트 카드와 같은 이유).
  const [saved, setSaved] = useState(row.body);
  const [body, setBody] = useState(row.body ?? "");
  const [result, setResult] = useState<PersonaResult | null>(null);
  // 삭제·색은 둘 다 접힌 줄에서 누르므로 사유도 접힌 채 보여야 한다 — 자리가 하나다.
  const [rowError, setRowError] = useState<{ title: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const refs = refsLabel(row.refs);
  const dirty = body !== (saved ?? "");

  return (
    // 네이티브 `<details>`다 — shadcn accordion을 설치하지 않는다(§비주얼 컴포넌트 인벤토리).
    // 접힘은 표시 상태일 뿐이라 본문이 언마운트되지 않는다 = 편집 중인 textarea가 살아 있다.
    // ponytail: 펼침 상태를 URL에 담지 않는다. 딥링크(`?open=<이름>`)가 실제로 생기면 그때.
    // 바깥 div는 삭제 실패 사유 때문이다 — 삭제를 접힌 줄에서 누르므로 사유도 접힌 채 보여야 한다.
    <div className="rounded-md border">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
          {/* 색을 고르는 자리는 이 화면 하나뿐이다(§5). 삭제와 같은 이유로 preventDefault다 */}
          <span onClick={(e) => e.preventDefault()}>
            <ColorPicker
              projectId={projectId}
              name={row.name}
              color={color}
              onError={(message) =>
                setRowError(message ? { title: "색을 저장하지 못했습니다", message } : null)
              }
            />
          </span>
          <span className="font-mono text-sm">{row.name}</span>
          {saved === null && <Badge variant="outline">프로필 없음</Badge>}
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={row.file}>
            {refs ? `티켓 ${refs}` : "참조하는 티켓 없음"}
          </span>
          {/* 프로필 본문은 **모든 디스패치 프롬프트에 인라인된다** — 길이가 곧 비용이다(§5).
              접힌 줄에 둬야 "누가 프롬프트를 얼마나 먹는가"를 목록에서 비교할 수 있다 */}
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
            {body.length}자
          </span>
          {/* 저장 버튼은 펼쳐야 보인다 — 접은 채 잊으면 이게 유일한 표시다(§5) */}
          {dirty && <Badge variant="outline">저장 안 됨</Badge>}
          {saved !== null && (
            // 삭제는 접힌 줄에 있고 펼침을 토글하지 않는다. summary의 활성화 동작을 막는 건
            // preventDefault다 — stopPropagation은 activationTarget이 이미 정해져 안 통한다.
            <span className="ml-auto" onClick={(e) => e.preventDefault()}>
              <DeleteButton
                projectId={projectId}
                row={row}
                onError={(message) => setRowError({ title: "삭제하지 못했습니다", message })}
              />
            </span>
          )}
        </summary>

        <div className="space-y-3 border-t p-3">
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
          {/* 오른쪽 정렬, 1차 액션이 가장 오른쪽 — 결과 문구는 버튼 왼쪽이다(§비주얼 §4-3) */}
          <div className="flex items-center justify-end gap-4">
            {result?.ok && !dirty && (
              <span className="text-sm text-muted-foreground">저장됐습니다.</span>
            )}
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
          </div>
        </div>
      </details>

      {rowError && (
        <div className="p-3 pt-0">
          <Failure title={rowError.title} message={rowError.message} />
        </div>
      )}
    </div>
  );
}

/** 삭제 확인. `PersonaCard`에서 뽑은 이유는 재사용이 아니라 자리다 — 60줄짜리 다이얼로그가
 *  `<summary>` 안에 들어가면 접힌 줄이 뭘 담는지가 안 보인다. 호출부는 하나다. */
function DeleteButton({
  projectId,
  row,
  onError,
}: {
  projectId: string;
  row: PersonaRow;
  onError: (message: string) => void;
}) {
  const [pending, start] = useTransition();

  return (
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
                if (!r.ok) onError(r.message ?? "삭제하지 못했습니다.");
              })
            }
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
