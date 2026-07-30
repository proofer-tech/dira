"use client";

/** 티켓 화면의 클라이언트 조각 — 상세(편집 폼 · 할당 해제 · 삭제)와 발행 폼.
 *
 *  한 파일에 있는 이유는 `projects-ui.tsx`와 같다: 같은 도메인(티켓 파일)의 액션이고 전부 서버
 *  액션 뒤에 있다(fs 접근은 여기 없다). 결과를 **토스트에 담지 않는다** — 워커 스크립트 출력과
 *  검증 사유는 읽어야 하는 정보고, 3초 뒤 사라지는 자리에 두면 못 본다(DESIGN.md §8이 해석 결과
 *  표에 쓴 같은 근거다). */
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, TriangleAlert, Unlink, X } from "lucide-react";
import { deleteTicket, saveTicket, unassignTicket, type SaveState } from "@/app/p/[project]/tickets/[hash]/actions";
import { createTicket, type NewTicketState } from "@/app/p/[project]/tickets/new/actions";
import type { UnassignRun } from "@/lib/engine";
import { DepBadge } from "@/components/status-badge";
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
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  project,
  hash,
  title,
  kind,
  persona,
  body,
}: {
  project: string;
  hash: string;
  title: string;
  kind: string;
  persona: string;
  body: string;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveTicket, {});
  return (
    <form action={action} className="max-w-3xl space-y-4">
      <input type="hidden" name="project" value={project} />
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
  project,
  hash,
  worker,
  assigned,
  ghost,
}: {
  project: string;
  hash: string;
  /** 호출될 워커 이름. 0개면 null */
  worker: string | null;
  assigned: boolean;
  /** 열린 티켓 + `session_id` = 엔진이 만들지 않는 조합. 여기선 이 버튼이 유일한 복구 수단이다.
   *  `.wip`의 죽은 세션과는 **다른 사건**이라 문구를 갈라 쓴다(DESIGN.md §2 · §비주얼 §2). */
  ghost: boolean;
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
            onClick={() => start(async () => setRun(await unassignTicket(project, hash)))}
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
              "이 프로젝트에 워커가 없습니다 — 할당 해제를 호출할 스크립트가 없습니다."
            )}
          </span>
        </div>
      )}
      {assigned && ghost && (
        <p className="text-xs text-muted-foreground">
          열린 티켓에 <span className="font-mono">session_id</span>가 박혀 있습니다 —{" "}
          <span className="font-mono">select</span>가 영구 제외하고{" "}
          <span className="font-mono">reap</span>은 <span className="font-mono">.wip</span>만 보므로,
          할당 해제만이 이 티켓을 큐로 되돌립니다.
        </p>
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
  project,
  hash,
  title,
  locked,
}: {
  project: string;
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
                  const r = await deleteTicket(project, hash);
                  if (r.ok) router.push(`/p/${project}`);
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

// ── 발행 폼 ─────────────────────────────────────────────────────────────────

/** 본문 기본값 (DESIGN.md §3). `## Goal`/`## Done when`이 티켓의 계약이다 — 빈 textarea를 주면
 *  계약 없는 티켓이 생기고, 그걸 받은 세션이 무엇이 완료인지 스스로 정하게 된다. */
const BODY_SKELETON = `## Goal


## Done when
- [ ]
- [ ]
`;

/** deps 후보 한 건. `hash`는 상태 접미사를 뗀 **파일명 stem**이다 — deps가 가리키는 이름이 그것이다. */
export type DepOption = { hash: string; title: string; met: boolean };

/** deps 멀티셀렉트 — **자유 입력이 없다**(DESIGN.md §3 · §결정 기록).
 *
 *  오타 해시는 그 티켓을 못 찾아 보수적으로 미충족 판정이 되고, 티켓은 아무 사유도 남기지 않은 채
 *  영원히 대기한다. 선택지는 큐에 실제로 있는 티켓뿐이고 서버가 발행 직전에 한 번 더 확인한다. */
function DepsPicker({
  options,
  picked,
  setPicked,
}: {
  options: DepOption[];
  picked: string[];
  setPicked: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const byHash = new Map(options.map((o) => [o.hash, o]));

  return (
    <div className="space-y-2">
      <Label>deps</Label>
      <div className="flex flex-wrap items-center gap-2">
        {/* 선택된 것은 배지로 남는다 — 팝오버를 닫아도 무엇을 골랐는지 보여야 한다 */}
        {picked.map((h) => (
          <span key={h} className="flex items-center gap-1">
            <DepBadge hash={h} kind={byHash.get(h)?.met ? "met" : "unmet"} />
            <button
              type="button"
              aria-label={`deps ${h} 제거`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setPicked(picked.filter((x) => x !== h))}
            >
              <X aria-hidden className="size-3.5" />
            </button>
            {/* 폼 제출 값. 서버가 이 값을 다시 큐에서 찾아본다 */}
            <input type="hidden" name="deps" value={h} />
          </span>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button type="button" variant="outline" size="sm" role="combobox" aria-expanded={open}>
                티켓 선택
              </Button>
            }
          />
          <PopoverContent align="start" className="w-[28rem] p-0">
            <Command>
              <CommandInput placeholder="티켓 검색 — 해시 또는 제목" />
              <CommandList className="max-h-80">
                <CommandEmpty>일치하는 티켓 0건</CommandEmpty>
                {options.map((o) => (
                  <CommandItem
                    key={o.hash}
                    value={`${o.hash} ${o.title}`}
                    className="items-start gap-2 px-2 py-2"
                    onSelect={() =>
                      setPicked(
                        picked.includes(o.hash)
                          ? picked.filter((x) => x !== o.hash)
                          : [...picked, o.hash],
                      )
                    }
                  >
                    {/* 안 고른 항목도 같은 폭을 차지한다 — 정렬이 흔들리면 스캔이 깨진다 */}
                    <span className="w-4 shrink-0 pt-0.5">
                      {picked.includes(o.hash) && <Check aria-hidden className="size-4" />}
                    </span>
                    <span className="flex min-w-0 grow items-center gap-2">
                      <span className="shrink-0 font-mono text-xs">{o.hash}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {o.title || "(제목 없음)"}
                      </span>
                      {o.met && <span className="shrink-0 text-xs text-muted-foreground">완료</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs text-muted-foreground">
        전부 완료돼야 큐에 뜹니다. 없으면 착수가 불가능한 것만 고릅니다 — 남발하면 큐가 직렬화됩니다.
      </p>
    </div>
  );
}

/** 발행 폼. 성공하면 서버 액션이 상세로 보낸다(여기서 성공 상태를 그리지 않는다).
 *
 *  `kind`·`persona`·`deps`는 전부 선택이다. 사람이 칠 수 있는 자리는 title과 본문뿐이고,
 *  그 둘은 틀려도 티켓이 사라지지 않는다 — 나머지는 틀리면 조용히 사라진다. */
export function NewTicketForm({
  project,
  personas,
  deps,
  personaDir,
}: {
  project: string;
  /** 해석된 `TICKET_PERSONAS` 아래 실제 디렉터리 목록 */
  personas: string[];
  deps: DepOption[];
  /** 페르소나가 0개일 때 어디를 봐야 하는지 적는다(§6 에러 3요소의 3번) */
  personaDir: string;
}) {
  const [state, action, pending] = useActionState<NewTicketState, FormData>(createTicket, {});
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="project" value={project} />
      <div className="space-y-2">
        <Label htmlFor="n-title">title</Label>
        <Input id="n-title" name="title" required placeholder="한 줄 제목 — 무엇을 하는지" />
      </div>

      <div className="flex gap-4">
        <div className="space-y-2">
          <Label htmlFor="n-kind">kind</Label>
          <Select name="kind" defaultValue="work">
            <SelectTrigger id="n-kind" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="work">work</SelectItem>
              <SelectItem value="request">request</SelectItem>
              <SelectItem value="feedback">feedback</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="n-persona">persona</Label>
          <Select name="persona" defaultValue={null}>
            <SelectTrigger id="n-persona" className="w-40" disabled={personas.length === 0}>
              {/* 비우는 게 정상이다 — 페르소나 없이도 디스패치된다(protocols/tickets.md) */}
              <SelectValue placeholder="없음" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>없음</SelectItem>
              {personas.map((p) => (
                <SelectItem key={p} value={p} className="font-mono">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {personas.length === 0 && (
          <p className="self-end pb-2 text-xs text-muted-foreground">
            <span className="font-mono break-all">{personaDir}</span>에 페르소나 디렉터리가 없습니다.
          </p>
        )}
      </div>

      <DepsPicker options={deps} picked={picked} setPicked={setPicked} />

      <div className="space-y-2">
        <Label htmlFor="n-body">본문</Label>
        <Textarea
          id="n-body"
          name="body"
          defaultValue={BODY_SKELETON}
          rows={16}
          className="font-mono"
        />
      </div>

      {state.error && <Failure title="발행하지 못했습니다" message={state.error} />}
      <Button type="submit" disabled={pending}>
        {pending ? "발행 중…" : "발행"}
      </Button>
    </form>
  );
}
