"use client";

/** 티켓 화면의 클라이언트 조각 — 상세(편집 폼 · 할당 해제 · 삭제)와 보드의 발행 · 요구 접수
 *  다이얼로그(§3 — 발행은 라우트가 아니라 보드에서 하는 한 동작이다).
 *
 *  한 파일에 있는 이유는 `projects-ui.tsx`와 같다: 같은 도메인(티켓 파일)의 액션이고 전부 서버
 *  액션 뒤에 있다(fs 접근은 여기 없다). 결과를 **토스트에 담지 않는다** — 워커 스크립트 출력과
 *  검증 사유는 읽어야 하는 정보고, 3초 뒤 사라지는 자리에 두면 못 본다(DESIGN.md §8이 해석 결과
 *  표에 쓴 같은 근거다). */
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, TriangleAlert, Unlink, X } from "lucide-react";
import {
  answerRequirement,
  deleteTicket,
  saveTicket,
  unassignTicket,
  type SaveState,
} from "@/app/p/[project]/tickets/[hash]/actions";
import { createTicket, type NewTicketState } from "@/app/p/[project]/(board)/actions";
import type { UnassignRun } from "@/lib/engine";
// 스레드를 엮는 쪽은 서버(`lib/queue.ts threadOf`)다 — 여기 오는 건 타입뿐이라 `node:*`를 안 끈다
import type { ThreadItem } from "@/lib/queue";
import { Markdown } from "@/components/markdown";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
    // 폭은 페이지 루트가 문다(§비주얼 §11) — 2단의 왼쪽 단 안에서 다시 걸면 이중 제한이다
    <form action={action} className="space-y-4">
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

// ── 요구사항 왕복 ───────────────────────────────────────────────────────────

/** 스레드 + 답변 폼. **상세의 카드와 보드의 다이얼로그가 같은 것을 그린다** — 그릇만 다르고
 *  스레드·폼·서버 액션은 하나다(§1 보드 요구사항 항). 엮는 쪽은 `lib/queue.ts threadOf`다. */
function AnswerFields({
  project,
  hash,
  answerFile,
  thread,
}: {
  project: string;
  hash: string;
  answerFile: string;
  thread: ThreadItem[];
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(answerRequirement, {});
  // 답변 칸의 id는 한 화면에 하나뿐이다 — 보드에서도 열려 있는 다이얼로그는 하나다.
  return (
    <>
      {thread.map((item, i) => (
        <div key={i} className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {item.heading || (item.role === "question" ? "질문" : "답변")}
            {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
          </p>
          {/* 읽기만 하는 자리라 렌더된 마크다운이다(§비주얼 §10). 답변 쪽 구분은 왼쪽 선
              하나뿐이다 — `text-muted-foreground`를 걸면 렌더된 본문의 `bg-muted` 블록 안에서
              4.34가 되고, 그건 §1이 실측으로 금지한 조합이다. 구조로 가르고 색으로 안 가른다 */}
          <div className={item.role === "answer" ? "border-l-2 border-border pl-3" : ""}>
            <Markdown text={item.text} />
          </div>
        </div>
      ))}
      <form action={action} className="space-y-3">
        <input type="hidden" name="project" value={project} />
        <input type="hidden" name="hash" value={hash} />
        <Label htmlFor="a-body">답변</Label>
        <Textarea id="a-body" name="body" rows={8} className="font-mono" required />
        {state.error && <Failure title="답변을 달지 못했습니다" message={state.error} />}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "답변 다는 중…" : "답변 달기"}
          </Button>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono">tickets/{answerFile}</span>를 만듭니다
          </span>
        </div>
      </form>
    </>
  );
}

/** 답변 카드 — **답변 대기일 때만** 렌더된다(판정은 서버가 `isAwaiting`으로 한다).
 *
 *  버튼이 하는 일은 `tickets/<awaiting>.done.md`를 만드는 것 하나뿐이다. 그 파일이 생기면
 *  요구사항의 unmet이 비어 큐에 다시 뜬다 — `다시 큐에` 버튼을 따로 두지 않는 이유다
 *  (답만 쓰고 안 누른 상태가 생긴다. DESIGN.md §요구사항 레이어 버린 대안). */
export function AnswerCard(props: {
  project: string;
  hash: string;
  /** 만들어질 답변 파일 이름. 사람이 무엇이 생기는지 보고 누른다(접미사는 프로젝트별이다) */
  answerFile: string;
  thread: ThreadItem[];
}) {
  return (
    // 폭은 페이지 루트가 문다(§비주얼 §11) — 왼쪽 단이 이미 정한 폭을 다시 자르지 않는다
    <Card>
      <CardHeader>
        <CardTitle>답변</CardTitle>
        <CardDescription>답변을 달면 이 요구사항이 다시 큐에 뜨고 PM이 이어서 봅니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AnswerFields {...props} />
      </CardContent>
    </Card>
  );
}

/** 보드 칸반 카드의 `답변` 버튼 — 같은 스레드·폼을 다이얼로그로 연다(§1 보드 요구사항 항,
 *  사람 요청 `14c88df4`). 새 라우트도 새 액션도 없다.
 *
 *  카드 전체가 상세로 가는 링크(`after:inset-0`)라 트리거는 `relative z-10`이고, 클릭이 카드
 *  링크로 새어 나가지 않게 `stopPropagation`한다 — 오버레이 링크가 버튼 **위**가 아니라
 *  아래에 깔려 있어서 z만으로 충분하지만, 답을 쓰다 상세로 튀는 사고는 되돌릴 방법이 없다.
 *
 *  닫기 상태를 만들지 않는다: 답이 달리면 `answerRequirement`가 보드를 `revalidatePath`하고
 *  그 카드가 `답변 대기`를 벗으면서 트리거째 사라진다 = 다이얼로그도 같이 언마운트된다. */
export function AnswerDialog({
  title,
  ...props
}: {
  project: string;
  hash: string;
  answerFile: string;
  thread: ThreadItem[];
  /** 다이얼로그 머리에 요구사항 제목을 적는다 — 보드에서는 어느 카드를 열었는지가 안 보인다 */
  title: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        // `self-start` — 카드가 flex 컬럼이라 안 주면 버튼이 카드 폭을 다 먹는다
        render={<Button size="sm" variant="outline" className="relative z-10 self-start" />}
        onClick={(e) => e.stopPropagation()}
      >
        답변
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>답변 — {title || props.hash}</DialogTitle>
          <DialogDescription>
            답변을 달면 이 요구사항이 다시 큐에 뜨고 PM이 이어서 봅니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <AnswerFields {...props} />
        </div>
      </DialogContent>
    </Dialog>
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

/** 요구 접수 — 자연어 한 칸. kind·persona·deps를 **사람에게 묻지 않는다**
 *  (서버가 `kind: request`·`persona: pm`·deps 없음으로 고정한다. DESIGN.md §3).
 *  title 칸도 없다 — 첫 줄에서 만든다.
 *
 *  버튼이 곧 `DialogTrigger`다(§3 — 라우트가 없다). `mode=req` hidden input은 그대로다:
 *  서버가 kind·persona를 고정하는 경로가 그것이고 `createTicket`은 무수정이다. */
export function RequestDialog({ project }: { project: string }) {
  const [state, action, pending] = useActionState<NewTicketState, FormData>(createTicket, {});
  // 본문은 **controlled**여야 한다: React 19는 form action이 끝나면 폼을 리셋하므로, uncontrolled면
  // 발행이 실패한 순간 사람이 쓴 글이 사라진다(실측). 실패 사유만 남고 본문이 비면 사유가 무의미하다.
  const [body, setBody] = useState("");

  return (
    // 닫기는 상태를 지우지 않는다 — 다시 열면 쓰던 본문이 남아 있다(성공 시엔 상세로 떠난다).
    <Dialog>
      <DialogTrigger render={<Button size="sm" />}>요구 접수</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>요구 접수</DialogTitle>
          <DialogDescription>
            필요한 것을 자연어로 쓰면 <span className="font-mono text-xs">kind: request</span> 티켓이
            되고 PM이 받아 해석합니다. 첫 줄이 제목이 됩니다.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="project" value={project} />
          <input type="hidden" name="mode" value="req" />
          <Textarea
            name="body"
            rows={12}
            required
            aria-label="요구 내용"
            placeholder={"무엇이 필요한지 그냥 쓰세요.\n첫 줄이 제목이 됩니다."}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {/* 실패는 이 자리에 남는다 — 닫으면 사람이 쓴 본문이 사라진다(§3) */}
          {state.error && <Failure title="접수하지 못했습니다" message={state.error} />}
          <Button type="submit" disabled={pending}>
            {pending ? "접수 중…" : "요구 접수"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 발행 다이얼로그. 성공하면 서버 액션의 `redirect`가 상세로 보내고 그 내비게이션이 다이얼로그를
 *  닫는다(close 상태를 따로 만들지 않는다. §3).
 *
 *  `kind`·`persona`·`deps`는 전부 선택이다. 사람이 칠 수 있는 자리는 title과 본문뿐이고,
 *  그 둘은 틀려도 티켓이 사라지지 않는다 — 나머지는 틀리면 조용히 사라진다. */
export function NewTicketDialog({
  project,
  personas,
  deps,
  personaDir,
  variant,
}: {
  project: string;
  /** 프로필(`PROFILE.md`)이 있는 이름만. 보드의 **필터 목록을 넘기면 안 된다** — 그쪽은
   *  티켓이 참조하는 프로필 없는 이름까지 포함한다(§3) */
  personas: string[];
  deps: DepOption[];
  /** 페르소나가 0개일 때 어디를 봐야 하는지 적는다(§6 에러 3요소의 3번) */
  personaDir: string;
  /** 보드 우상단은 `outline`(primary는 `요구 접수`), 빈 상태는 기본 변종이다(§3) */
  variant?: "default" | "outline";
}) {
  const [state, action, pending] = useActionState<NewTicketState, FormData>(createTicket, {});
  const [picked, setPicked] = useState<string[]>([]);
  // title·본문이 **controlled**인 이유는 `RequestDialog`와 같다 — React 19가 action 후 폼을
  // 리셋해서 uncontrolled면 발행 실패가 곧 입력 유실이다. deps는 이미 `picked`가 들고 있고,
  // kind·persona는 base-ui Select가 자기 상태로 들고 있다(리셋에 안 밟힌다. 실측).
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(BODY_SKELETON);

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant={variant} />}>티켓 발행</DialogTrigger>
      {/* 1440×900에서 본문 12줄이 다 들어가지만, 좁은 창·긴 deps 목록에서는 넘친다 — 잘리지
          않게 여기서 스크롤한다(§3 크기) */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>티켓 발행</DialogTitle>
          <DialogDescription>
            선택지는 전부 이 프로젝트의 실제 값입니다 — 손으로 치는 건 title과 본문뿐입니다.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="project" value={project} />
          <div className="space-y-2">
            <Label htmlFor="n-title">title</Label>
            <Input
              id="n-title"
              name="title"
              required
              placeholder="한 줄 제목 — 무엇을 하는지"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
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
                <span className="font-mono break-all">{personaDir}</span>에 페르소나 디렉터리가
                없습니다.
              </p>
            )}
          </div>

          <DepsPicker options={deps} picked={picked} setPicked={setPicked} />

          <div className="space-y-2">
            <Label htmlFor="n-body">본문</Label>
            {/* 페이지였을 때는 16줄이었다 — 다이얼로그는 세로 예산이 창이라 12줄이다(§3 크기) */}
            <Textarea
              id="n-body"
              name="body"
              rows={12}
              className="font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {/* 실패는 이 자리에 남는다 — 닫으면 사람이 쓴 본문이 사라진다(§3) */}
          {state.error && <Failure title="발행하지 못했습니다" message={state.error} />}
          <Button type="submit" disabled={pending}>
            {pending ? "발행 중…" : "발행"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
