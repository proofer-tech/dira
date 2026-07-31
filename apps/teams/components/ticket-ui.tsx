"use client";

/** 티켓 화면의 클라이언트 조각 — 상세(편집 폼 · 할당 해제 · 삭제)와 보드의 발행 · 요구 접수
 *  다이얼로그(§3 — 발행은 라우트가 아니라 보드에서 하는 한 동작이다).
 *
 *  한 파일에 있는 이유는 `projects-ui.tsx`와 같다: 같은 도메인(티켓 파일)의 액션이고 전부 서버
 *  액션 뒤에 있다(fs 접근은 여기 없다). 결과를 **토스트에 담지 않는다** — 워커 스크립트 출력과
 *  검증 사유는 읽어야 하는 정보고, 3초 뒤 사라지는 자리에 두면 못 본다(DESIGN.md §8이 해석 결과
 *  표에 쓴 같은 근거다). */
import { useActionState, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  Check,
  Copy,
  Lock,
  MessageSquareReply,
  Trash2,
  TriangleAlert,
  Unlink,
  X,
} from "lucide-react";
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
import { useHotkey } from "@/components/keymap-provider";
import { Markdown } from "@/components/markdown";
import { PersonaDot } from "@/components/persona-badge";
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
import { Bubble, BubbleContent } from "@/components/ui/bubble";
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
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
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

/** 발행 다이얼로그의 `n-kind`와 **같은 셋**이다(§2 편집 항). 보드 필터의 kind 목록(큐에서 뽑는다)과
 *  다른 값인 게 맞다 — 저기는 있는 값을 거르는 자리고 여기는 값을 정하는 자리다. */
const KINDS = ["work", "request", "feedback"];

/** frontmatter의 title·kind·persona + 본문 원문. `.wip`이면 이 폼은 렌더되지 않고
 *  서버 액션도 다시 거부한다(렌더 시점 판정은 저장 시점엔 이미 낡았다).
 *
 *  `kind`·`persona`는 발행과 **같은 방식으로** 고른다(select. §2 편집 항) — 자유 입력이면 오타 친
 *  `kind`는 어느 화면에서도 안 걸리고 `persona`는 저장 눌러야 `NAME_RE`로 거부당한다. */
export function TicketEditForm({
  project,
  hash,
  title,
  kind,
  persona,
  personas,
  colors,
  body,
}: {
  project: string;
  hash: string;
  title: string;
  kind: string;
  persona: string;
  /** 발행 다이얼로그와 같은 목록 — `listPersonas` 결과 중 `PROFILE.md`가 있는 이름. 상세 페이지가
   *  이미 읽은 것을 넘긴다(§3 "선택지 데이터는 이미 읽은 것을 넘긴다") */
  personas: string[];
  /** 이름 → 팔레트 키(레지스트리 `personaColors`). 없는 이름은 빈 점이다(§비주얼 §12) */
  colors?: Record<string, string>;
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
        {/* 값이 없으면 `null`이다 — base-ui가 `null`을 빈 문자열로 직렬화하므로 `없음`을 고른 저장이
            텍스트칸을 비우고 저장한 것과 같은 결과가 된다(`writeTicket`이 `kind:`로 쓴다).
            **목록 밖 현재 값은 항목으로 남긴다** — 안 그리면 select가 제 값을 못 그리고,
            그대로 저장하면 사람이 적어둔 값이 조용히 사라진다(§2 편집 항). */}
        <div className="space-y-2">
          <Label htmlFor="t-kind">kind</Label>
          <Select name="kind" defaultValue={kind || null}>
            <SelectTrigger id="t-kind" className="w-40">
              <SelectValue placeholder="없음" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>없음</SelectItem>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
              {kind && !KINDS.includes(kind) && (
                <SelectItem value={kind}>
                  {kind}
                  <span className="text-xs text-muted-foreground">현재 값</span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="t-persona">persona</Label>
          <Select name="persona" defaultValue={persona || null}>
            <SelectTrigger id="t-persona" className="w-40 font-mono">
              <SelectValue placeholder="없음" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>없음</SelectItem>
              {personas.map((p) => (
                // 발행 폼과 같다 — **점만**이고 `font-mono`는 무수정이다(§비주얼 §12)
                <SelectItem key={p} value={p} className="font-mono">
                  <PersonaDot color={colors?.[p]} />
                  {p}
                </SelectItem>
              ))}
              {persona && !personas.includes(persona) && (
                // 목록 밖 현재 값. 색은 이름으로 조회하므로 여기도 같은 규칙이다(대개 빈 점)
                <SelectItem value={persona} className="font-mono">
                  <PersonaDot color={colors?.[persona]} />
                  {persona}
                  <span className="text-xs text-muted-foreground">현재 값</span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="t-body">본문</Label>
        {/* 원문 편집이다 — 마크다운 렌더는 넣지 않는다(§6 프로토콜 에디터와 같은 결정) */}
        <Textarea id="t-body" name="body" defaultValue={body} rows={24} className="font-mono" />
      </div>
      {state.error && <Failure title="저장하지 못했습니다" message={state.error} />}
      {/* 액션 행은 오른쪽 정렬이고 1차 액션이 가장 오른쪽이다(§비주얼 §4-3). 결과 문구는 버튼
          **왼쪽**이다 — 오른쪽에 두면 문구가 떴다 사라질 때마다 `저장`이 옆으로 움직인다 */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {state.ok && <span className="text-sm text-muted-foreground">저장됐습니다.</span>}
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </form>
  );
}

// ── 할당 해제 ───────────────────────────────────────────────────────────────

/** `workers/<w>.sh unassign <해시>` 호출 버튼. claim/release를 TS로 다시 구현하지 않는다(제약 2).
 *  워커가 0개면 부를 스크립트가 없다 — 비활성화하고 이유를 그 자리에 적는다.
 *
 *  `assigned` 판정을 **이 안에서** 한다: 성공하면 티켓이 미할당으로 바뀌므로, 서버 쪽에서
 *  조건부로 렌더하면 이 컴포넌트가 통째로 사라져 스크립트 출력도 같이 사라진다(실측).
 *
 *  `.wip`이면 잠금 `Alert`를 **여기서** 그린다(DESIGN.md §2 · 사람 요구 `bfb1374a`) — 버튼이
 *  그 카드 안 오른쪽에 붙어야 하는데 카드를 서버 쪽(page.tsx)에 두면 버튼만 넘길 방법이 없다
 *  (`pending`·`run`이 이 컴포넌트의 상태다). 워커 마크는 `WipWorker`가 `lib/workers.ts`
 *  (`node:fs`)를 쓰므로 여기서 import할 수 없다 — 서버가 그려 `mark`로 넘긴다. */
export function UnassignButton({
  project,
  hash,
  worker,
  assigned,
  ghost,
  wip,
  mark,
}: {
  project: string;
  hash: string;
  /** 호출될 워커 이름. 0개면 null */
  worker: string | null;
  assigned: boolean;
  /** 열린 티켓 + `session_id` = 엔진이 만들지 않는 조합. 여기선 이 버튼이 유일한 복구 수단이다.
   *  `.wip`의 죽은 세션과는 **다른 사건**이라 문구를 갈라 쓴다(DESIGN.md §2 · §비주얼 §2). */
  ghost: boolean;
  /** `.wip`이면 잠금 `Alert`가 이 컴포넌트의 그릇이 된다. 아니면 종전대로 버튼 + 사유 한 줄이다. */
  wip: boolean;
  /** 서버가 그린 `<WipWorker>` (§비주얼 §19 ③). `.wip`이 아니거나 `owner` 형식이 안 맞으면 없다 */
  mark?: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [run, setRun] = useState<UnassignRun | null>(null);
  // `.wip`은 할당 여부와 무관하게 잠금 카드가 서야 한다 — 버튼만 그 안에서 빠진다
  if (!wip && !assigned && !run) return null; // 할당 안 된 티켓엔 이 액션이 없다

  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || !worker}
      onClick={() => start(async () => setRun(await unassignTicket(project, hash)))}
    >
      <Unlink aria-hidden />
      {pending ? "할당 해제 중…" : "할당 해제"}
    </Button>
  );
  // 누를 수 있는지/무엇이 불리는지. 자리가 둘(잠금 카드 설명 · 종전 버튼 옆)이라 한 번만 쓴다
  const why = worker ? (
    <>
      <span className="font-mono">
        {worker}.sh unassign {hash}
      </span>{" "}
      를 호출합니다
    </>
  ) : (
    "이 프로젝트에 워커가 없습니다 — 할당 해제를 호출할 스크립트가 없습니다."
  );

  // 스크립트 출력은 그대로 보여준다: 백로그 복귀 여부가 여기 적혀 온다.
  // **잠금 카드 밖 아래**다 — 해제가 성공하면 티켓이 `.wip`이 아니게 돼 카드가 통째로
  // 사라지고, 안에 있으면 출력도 같이 사라진다(§2 · 위 실측과 같은 사건).
  const output =
    run &&
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
    ));

  /* `.wip`은 지금 세션이 그 파일로 일하고 있다 — 잠금 사유를 그 자리에 적는다(제약 5).
     자물쇠가 움직이는 이유는 §18 ③: 이 문장이 서 있는 **이유**가 지금 누가 일하고 있다는
     사실이라, 정지한 자물쇠는 그것을 과거형으로 읽는다. `.done` 자물쇠는 정지다(page.tsx) —
     영영 안 풀리는 잠금이라 기다릴 것이 없다.
     `Alert`는 열이 하나 는 것뿐이다: 손잡이가 오른쪽 끝에서 제목·설명 두 줄에 걸쳐 선다. */
  if (wip)
    return (
      <div className="space-y-2">
        <Alert className="has-[>svg]:grid-cols-[auto_1fr_auto]">
          <Lock
            aria-hidden
            className="animate-wip-pulse text-status-active motion-reduce:animate-none"
          />
          {/* 꼬리의 마크가 **누구인지**를 말한다(§비주얼 §19 ③ · 사람 요구 `47678a71`).
              `AlertDescription`이 아니라 여기인 이유: 할당 해제를 누를지 기다릴지가
              제목 한 줄에서 갈려야 한다(§2). 문구·`Lock`·`.done` `Alert`는 무수정 */}
          <AlertTitle>세션이 물고 있습니다 — 편집·삭제 잠금 {mark}</AlertTitle>
          <AlertDescription className="grid gap-1">
            {/* 손잡이가 옆으로 왔으므로 `아래`를 뺀다(§2) */}
            <span>
              진행중 티켓은 읽기만 합니다. 세션이 죽었다면 <b>할당 해제</b>로 큐에 되돌린 뒤
              편집하세요.
            </span>
            {assigned && <span className="text-xs">{why}</span>}
          </AlertDescription>
          {assigned && (
            <div className="col-start-3 row-start-1 row-span-2 self-center pl-2">{button}</div>
          )}
        </Alert>
        {output}
      </div>
    );

  return (
    <div className="space-y-2">
      {assigned && (
        <div className="flex items-center gap-3">
          {button}
          <span className="text-xs text-muted-foreground">{why}</span>
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
      {output}
    </div>
  );
}

// ── 요구사항 왕복 ───────────────────────────────────────────────────────────

/** 질문·답변 스레드만. 답변 대기면 폼과 같이(`AnswerFields`), 답이 달린 뒤엔 상세 왼쪽 단의
 *  읽기 전용 `질문·답변` 절로 혼자 뜬다(§2 · 사람 요청 `9feae652`) — 답은 `<A>.done.md`에 따로
 *  살아서 카드가 사라지면 답변 본문이 화면 어디에도 없었다. 그리는 것은 두 자리가 똑같다. */
export function AnswerThread({ thread }: { thread: ThreadItem[] }) {
  return (
    <>
      {/* 스레드는 고정 높이 상자 안에서 스크롤된다(§2 · 사람 요청 `c01a9a11` Q1=(a) · §비주얼 §13).
          `max-h-96`(24rem)은 **Viewport**에 건다 — 부모가 `Card`·`DialogContent`(높이 auto)라
          위쪽에 걸면 `h-full`이 auto로 풀려 아무 일도 안 한다(§13). `max-`인 것이 요건이다:
          스레드가 하나뿐이면 상자도 한 줄이다.
          `autoScroll`은 답변이 달려 스레드가 늘 때 맨 아래를 따라가게 한다(첫 렌더의 위치는
          프리미티브 기본값 `defaultScrollPosition="end"`가 이미 맨 아래다).
          **0건이면 스크롤러를 아예 안 그린다**(§13 빈 상태) — `## 질문 n` 절이 없는 요구사항도
          답변 대기가 될 수 있고, 그때 사람이 할 다음 행동은 아래 폼이 이미 들고 있다. */}
      {thread.length > 0 && (
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport aria-label="답변 스레드" className="max-h-96">
              <MessageScrollerContent>
                {thread.map((item, i) => {
                  // 역할은 **정렬**이 가른다 — 질문(PM)은 왼쪽, 답변(사람)은 오른쪽(§비주얼 §13 ·
                  // 사람 요청 `c01a9a11` Q2=(b)). 변종은 좌우가 같은 `outline` 하나다: §13의
                  // 실측표에서 §10을 안 깎는 말풍선 배경이 `--background` 하나뿐이었다
                  // (채워진 배경 6종은 코드 펜스가 녹거나 표 선·인용이 미달한다).
                  // 아바타는 없다 — 참여자가 둘이고 정렬이 이미 가른다.
                  const align = item.role === "question" ? "start" : "end";
                  return (
                    <MessageScrollerItem key={i} messageId={String(i)}>
                      <Message align={align}>
                        <MessageContent>
                          {/* 헤더는 말풍선 **밖 · 위**다(§13) — 안에 넣으면 본문의 소유자가
                              `<Markdown>` 하나가 아니게 되고 §10 루트의 `[&>:first-child]:mt-0`이
                              거짓이 된다. 밖이면 앉는 면이 `--card`고 거기서 `--muted-foreground`는
                              4.73 / 6.91이다. 오른쪽 정렬은 `MessageContent`가 `data-align=end`에서
                              자식을 `self-end`로 밀어 같이 준다 */}
                          <MessageHeader>
                            {item.heading || (item.role === "question" ? "질문" : "답변")}
                            {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
                          </MessageHeader>
                          {/* 읽기만 하는 자리라 렌더된 마크다운이다(§비주얼 §10) — 말풍선 안에서도
                              그대로다. 본문에 `text-muted-foreground`를 걸지 않는다: 렌더된 본문의
                              `bg-muted` 블록 안에서 4.34가 되고 그건 §1이 실측으로 금지한 조합이다.
                              종전의 `border-l-2 border-border pl-3`은 지웠다 — 말풍선과 겹치면
                              답변 쪽만 세로선 + 상자 두 겹이 된다(§13) */}
                          <Bubble variant="outline" align={align}>
                            <BubbleContent>
                              <Markdown text={item.text} />
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  );
                })}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            {/* 아래가 가려졌을 때만 뜬다(`data-active`) — 안 가려지면 스스로 사라진다.
                라벨을 `sr-only`로 숨기지 않는다(§13 — 아이콘만이면 "한 화면 아래로"와 안 갈린다).
                variant·size·자리는 컴포넌트 기본값이 이미 §13 값이다 */}
            <MessageScrollerButton>
              <ArrowDown aria-hidden />
              최신으로
            </MessageScrollerButton>
          </MessageScroller>
        </MessageScrollerProvider>
      )}
    </>
  );
}

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
      <AnswerThread thread={thread} />
      {/* 입력칸과 `답변 달기`는 상자 **밖 · 밑**이다 — 다이얼로그를 화면 높이로 늘리는 안은 버렸다(§2) */}
      <form action={action} className="space-y-3">
        <input type="hidden" name="project" value={project} />
        <input type="hidden" name="hash" value={hash} />
        <Label htmlFor="a-body">답변</Label>
        <Textarea id="a-body" name="body" rows={8} className="font-mono" required />
        {state.error && <Failure title="답변을 달지 못했습니다" message={state.error} />}
        {/* 보조 텍스트는 버튼 왼쪽이다(§비주얼 §4-3) */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-mono">tickets/{answerFile}</span>를 만듭니다
          </span>
          {/* 아이콘이 `답변 대기` 배지와 이 CTA를 잇는다 — 색은 안 쓴다(§비주얼 §15).
              보드 카드의 트리거와 같은 글자꼴이다 */}
          <Button type="submit" disabled={pending}>
            <MessageSquareReply aria-hidden />
            {pending ? "답변 다는 중…" : "답변 달기"}
          </Button>
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
        <CardDescription>답변을 달면 이 티켓이 다시 큐에 뜨고 담당 세션이 이어서 봅니다.</CardDescription>
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
        // 변종·크기·라벨·아이콘은 다이얼로그 안 submit과 **같은 값**이다(§비주얼 §15) —
        // `--primary` 면이 카드에서 가장 진해서 눈에 들고, `MessageSquareReply`가
        // 오른쪽 위 `답변 대기` 배지와 같은 글자꼴이라 둘이 한 쌍으로 읽힌다.
        // `self-end` — 카드가 flex 컬럼이라 안 주면 버튼이 카드 폭을 다 먹는다(§15 카드 안 자리)
        render={<Button className="relative z-10 self-end" />}
        onClick={(e) => e.stopPropagation()}
      >
        <MessageSquareReply aria-hidden />
        답변 달기
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>답변 — {title || props.hash}</DialogTitle>
          <DialogDescription>
            답변을 달면 이 티켓이 다시 큐에 뜨고 담당 세션이 이어서 봅니다.
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

/** 확인 다이얼로그. 열린 티켓이 아니면 트리거 자체가 비활성이고 서버 액션도 다시 거부한다. */
export function DeleteTicketButton({
  project,
  hash,
  title,
  locked,
}: {
  project: string;
  hash: string;
  title: string;
  /** 잠금 사유 — `.wip`(세션이 물고 있다) · `.done`(불변 기록). 열린 티켓이면 `null`.
   *  불리언이 아니라 문장인 이유: 툴팁이 **왜** 못 지우는지를 말해야 하는데 두 사유가 다르다. */
  locked: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (locked) {
    return (
      <Button variant="outline" size="sm" disabled title={locked}>
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

/** 닫기 확인 + 리셋 (§3). 발행·접수가 같은 규칙을 쓴다 — 훅 하나로 묶는다(새 파일 0개).
 *
 *  `dirty`면 닫기를 한 번 막고, `버리고 닫기`를 받은 뒤에만 `reset`이 돈다. 되돌릴 방법이 없는
 *  삭제라서다. `dirty`가 아니면 묻지 않고 그대로 닫힌다. */
function useCloseGuard(dirty: boolean, reset: () => void) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const discard = () => {
    setAsking(false);
    setOpen(false);
    reset();
  };
  return {
    open,
    asking,
    setAsking,
    discard,
    /** 닫는 경로 넷(Esc · 배경 · 우상단 X · 폼 안 버튼)이 **전부 여기를 지난다**.
     *  `setOpen(false)`는 `onOpenChange`를 안 태우므로(실측) 버튼도 이걸 부른다 — 안 모으면
     *  Esc로 닫을 때와 버튼으로 닫을 때가 갈린다. */
    close: (next: boolean) => {
      if (next) setOpen(true);
      else if (dirty) setAsking(true);
      else discard();
    },
  };
}

/** 닫기 확인 — 문구·기본 초점은 §3이 박아둔 값이다. 삭제 확인(`DeleteTicketButton`)과 같은
 *  `AlertDialog`고 같은 규칙이다: 기본 초점이 취소 쪽이라 Enter 한 번에 글이 날아가지 않는다. */
function DiscardConfirm({ guard }: { guard: ReturnType<typeof useCloseGuard> }) {
  return (
    <AlertDialog open={guard.asking} onOpenChange={guard.setAsking}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>쓰던 내용이 있습니다</AlertDialogTitle>
          <AlertDialogDescription>닫으면 지금 쓴 내용이 사라집니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>계속 쓰기</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={guard.discard}>
            버리고 닫기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
 *  버튼이 곧 `DialogTrigger`다(§3 — 라우트가 없다). `mode=req` hidden input이 서버가 kind·persona를
 *  고정하는 경로고, **성공이 `redirect`가 아니라 `{ ok, hash }`로 돌아오는 경로**이기도 하다. */
export function RequestDialog({ project }: { project: string }) {
  const [state, action, pending] = useActionState<NewTicketState, FormData>(createTicket, {});
  // 본문은 **controlled**여야 한다: React 19는 form action이 끝나면 폼을 리셋하므로, uncontrolled면
  // 발행이 실패한 순간 사람이 쓴 글이 사라진다(실측). 실패 사유만 남고 본문이 비면 사유가 무의미하다.
  const [body, setBody] = useState("");
  // 마지막으로 **닫은** 결과. `useActionState`에는 리셋이 없어서 접수 확인도 실패 사유도 계속
  // 남는다 — 이걸 안 들면 닫았다 다시 열 때 접수 확인이 그대로 떠 있거나(두 번째 요구를 못 쓴다)
  // 본문 없는 실패 사유만 남는다(§6이 요구하는 3요소 중 둘을 잃은 문장이다. §3).
  const [dismissed, setDismissed] = useState<NewTicketState>({});
  const live = state !== dismissed;
  const done = live && state.ok ? state.hash : null;

  // 닫히면 빈 칸으로 돌아간다 — 접수한 본문이 남아 있으면 같은 요구가 두 번 접수된다(§3).
  // 접수 확인 화면(`done`)은 **묻지 않는다**: 이미 접수돼서 잃을 것이 없다.
  const guard = useCloseGuard(!done && body !== "", () => {
    setBody("");
    setDismissed(state);
  });

  // `r`(§0-6 `board.request`). **보드에만 있는 컴포넌트라 범위가 저절로 맞는다.** 여는 것도
  // 닫는 경로 넷과 같은 `guard.close`다 — 상태를 새로 만들지 않는다.
  useHotkey("board.request", (e) => {
    e.preventDefault();
    guard.close(true);
  });

  return (
    <Dialog open={guard.open} onOpenChange={guard.close}>
      <DialogTrigger render={<Button size="sm" />}>요구 접수</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>요구 접수</DialogTitle>
          {!done && (
            <DialogDescription>
              필요한 것을 자연어로 쓰면 <span className="font-mono text-xs">kind: request</span>{" "}
              티켓이 되고 PM이 받아 해석합니다. 첫 줄이 제목이 됩니다.
            </DialogDescription>
          )}
        </DialogHeader>
        {done ? (
          // 접수 확인은 **이 자리**다 — 상세로 튀면 "당신이 티켓을 만들었다"가 되고, 실제로 일어난
          // 일은 큐가 요구를 접수했다는 것뿐이다(사람 지적 `fb0d309c`). 해시·kind·persona는
          // 말하지 않는다: 사람이 고르지 않은 값이고 여기서 할 일도 없다. 상세는 링크로 남는다.
          <div className="space-y-4">
            <p className="text-sm">요구사항이 접수되었습니다. 곧 PM이 검토할 예정입니다.</p>
            {/* 오른쪽 정렬 · 1차 액션(`닫기`)이 가장 오른쪽이다(§비주얼 §4-3) */}
            <div className="flex flex-wrap items-center justify-end gap-4">
              <Link
                href={`/p/${project}/tickets/${done}`}
                className="text-sm underline-offset-4 hover:underline"
              >
                접수한 요구 보기
              </Link>
              <Button variant="outline" size="sm" onClick={() => guard.close(false)}>
                닫기
              </Button>
            </div>
          </div>
        ) : (
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
            {/* 실패는 이 자리에 남는다 — 닫으면 본문과 함께 사라진다(§3) */}
            {live && state.error && <Failure title="접수하지 못했습니다" message={state.error} />}
            {/* 사람이 지목한 자리다(요구 `027d8e96`) — 오른쪽 끝(§비주얼 §4-3) */}
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "접수 중…" : "요구 접수"}
              </Button>
            </div>
          </form>
        )}
        <DiscardConfirm guard={guard} />
      </DialogContent>
    </Dialog>
  );
}

/** 발행 다이얼로그. 성공하면 서버 액션의 `redirect`가 상세로 보내고 그 내비게이션이 다이얼로그를
 *  닫는다(close 상태를 따로 만들지 않는다. §3).
 *
 *  `kind`·`persona`·`deps`는 전부 선택이다. 사람이 칠 수 있는 자리는 title과 본문뿐이고,
 *  그 둘은 틀려도 티켓이 사라지지 않는다 — 나머지는 틀리면 조용히 사라진다.
 *
 *  **복제도 이 컴포넌트다**(§2 복제): `copy`가 오면 같은 폼이 원본 값으로 채워져 열린다.
 *  새 화면도 새 서버 액션도 없다 — `createTicket`이 그대로 받고 해시 생성·`O_EXCL`·발행 후
 *  상세 이동이 전부 따라온다. 원본은 **읽기만** 하므로 `.wip`도 복제할 수 있다. */
export function NewTicketDialog({
  project,
  personas,
  colors,
  deps,
  personaDir,
  variant,
  copy,
  hotkey,
}: {
  project: string;
  /** 프로필(`PROFILE.md`)이 있는 이름만. 보드의 **필터 목록을 넘기면 안 된다** — 그쪽은
   *  티켓이 참조하는 프로필 없는 이름까지 포함한다(§3) */
  personas: string[];
  /** 이름 → 팔레트 키(레지스트리 `personaColors`). 없는 이름은 빈 점이다(§비주얼 §12) */
  colors?: Record<string, string>;
  deps: DepOption[];
  /** 페르소나가 0개일 때 어디를 봐야 하는지 적는다(§6 에러 3요소의 3번) */
  personaDir: string;
  /** 보드 우상단은 `outline`(primary는 `요구 접수`), 빈 상태는 기본 변종이다(§3) */
  variant?: "default" | "outline";
  /** 복제 모드 — 원본 frontmatter **원문**과 본문 전문(`## 결과` 포함)을 채운다.
   *  `deps`는 **넣지 않는다**: 원본의 선행은 원본이 이미 소비한 것이고, 그대로 복제하면 새 티켓이
   *  끝난 선행을 다시 기다리거나(미완이면) 착수 불가로 태어난다. 제목에 `(사본)`도 안 붙인다 —
   *  사람이 조건만 바꿔 다시 시키려는 것이지 이름을 바꾸려는 게 아니다. */
  copy?: { stem: string; title: string; kind: string; persona: string; body: string };
  /** `board.new`(`n`)를 듣는다. **보드의 두 자리만 켠다** — 티켓 상세의 복제 버튼도 이 컴포넌트라
   *  켜면 상세에서 `n`이 복제 다이얼로그를 연다(§0-6 `어디서 듣나`는 보드다) */
  hotkey?: boolean;
}) {
  const [state, action, pending] = useActionState<NewTicketState, FormData>(createTicket, {});
  const [picked, setPicked] = useState<string[]>([]);
  // 열었을 때의 값 — dirty 판정과 리셋이 둘 다 이걸 기준으로 한다(§3)
  const blankTitle = copy?.title ?? "";
  const blankBody = copy?.body ?? BODY_SKELETON;
  // title·본문이 **controlled**인 이유는 `RequestDialog`와 같다 — React 19가 action 후 폼을
  // 리셋해서 uncontrolled면 발행 실패가 곧 입력 유실이다. deps는 이미 `picked`가 들고 있고,
  // kind·persona는 base-ui Select가 자기 상태로 들고 있다(리셋에 안 밟힌다. 실측).
  const [title, setTitle] = useState(blankTitle);
  const [body, setBody] = useState(blankBody);
  // 마지막으로 닫은 결과. `RequestDialog`와 같은 이유 — 실패 사유가 본문 없이 살아남지 않게 한다(§3)
  const [dismissed, setDismissed] = useState<NewTicketState>({});

  // **kind·persona select는 세지 않는다**: base-ui가 자기 상태로 들고 있어 읽을 수 없고,
  // 사람이 "쓰던 내용"이라 부르는 것도 아니다(§3). 성공에는 확인이 끼지 않는다 — 그 경로는
  // 서버 액션의 `redirect`가 컴포넌트째 언마운트한다.
  const guard = useCloseGuard(
    title !== blankTitle || body !== blankBody || picked.length > 0,
    () => {
      setTitle(blankTitle);
      setBody(blankBody);
      setPicked([]);
      setDismissed(state);
    },
  );

  // `n`(§0-6 `board.new`). **이 컴포넌트만 보드 밖에도 산다**(티켓 상세의 복제) — 그래서
  // 범위가 저절로 맞지 않고 부르는 쪽이 켠다. 여는 자리는 `RequestDialog`와 같은 `guard.close`다.
  useHotkey("board.new", (e) => {
    if (!hotkey) return;
    e.preventDefault();
    guard.close(true);
  });

  return (
    <Dialog open={guard.open} onOpenChange={guard.close}>
      <DialogTrigger render={<Button size="sm" variant={variant} />}>
        {copy ? (
          <>
            <Copy aria-hidden />
            복제
          </>
        ) : (
          "티켓 발행"
        )}
      </DialogTrigger>
      {/* 1440×900에서 본문 12줄이 다 들어가지만, 좁은 창·긴 deps 목록에서는 넘친다 — 잘리지
          않게 여기서 스크롤한다(§3 크기) */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy ? "티켓 복제" : "티켓 발행"}</DialogTitle>
          <DialogDescription>
            {copy ? (
              <>
                <span className="font-mono">{copy.stem}</span>의 title·kind·persona·본문을 그대로
                채웠습니다. deps는 복제되지 않습니다 — 필요하면 직접 고르세요.
              </>
            ) : (
              "선택지는 전부 이 프로젝트의 실제 값입니다 — 손으로 치는 건 title과 본문뿐입니다."
            )}
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
              {/* 복제는 원본 값에서 시작한다. 원본에 `kind`가 없거나 목록 밖 값(`answer` 등)이면
                  그 사실을 select가 그려야 한다 — 편집 폼과 같은 이유고 같은 모양이다(§2 편집 항).
                  목록 밖 값은 서버가 발행 시점에 사유를 붙여 거부한다(`createTicket`의 KINDS). */}
              <Select name="kind" defaultValue={copy ? copy.kind || null : "work"}>
                <SelectTrigger id="n-kind" className="w-40">
                  <SelectValue placeholder="없음" />
                </SelectTrigger>
                <SelectContent>
                  {copy && <SelectItem value={null}>없음</SelectItem>}
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                  {copy && copy.kind && !KINDS.includes(copy.kind) && (
                    <SelectItem value={copy.kind}>
                      {copy.kind}
                      <span className="text-xs text-muted-foreground">원본 값</span>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-persona">persona</Label>
              <Select name="persona" defaultValue={copy?.persona || null}>
                <SelectTrigger
                  id="n-persona"
                  className="w-40"
                  // 복제는 원본 값이 이미 들어 있다 — 페르소나 0개라고 잠그면 그 값을 못 지운다
                  disabled={personas.length === 0 && !copy?.persona}
                >
                  {/* 비우는 게 정상이다 — 페르소나 없이도 디스패치된다(protocols/tickets.md) */}
                  <SelectValue placeholder="없음" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>없음</SelectItem>
                  {personas.map((p) => (
                    // 항목은 **점만**이다 — 껍데기(배지) 안에 배지를 또 넣지 않는다(§5).
                    // `font-mono`는 무수정: 이 자리는 배지가 아니라 값 목록이다(§비주얼 §12)
                    <SelectItem key={p} value={p} className="font-mono">
                      <PersonaDot color={colors?.[p]} />
                      {p}
                    </SelectItem>
                  ))}
                  {/* 프로필이 지워진 페르소나로 만든 티켓도 원본 값 그대로 열린다 — 안 그리면
                      select가 제 값을 못 그리고 사본이 조용히 페르소나를 잃는다(§2 편집 항) */}
                  {copy?.persona && !personas.includes(copy.persona) && (
                    <SelectItem value={copy.persona} className="font-mono">
                      {/* 편집 폼의 같은 줄과 같다 — 점을 빼면 이 줄만 이름이 왼쪽으로 튀어나온다(§12 `순서`) */}
                      <PersonaDot color={colors?.[copy.persona]} />
                      {copy.persona}
                      <span className="text-xs text-muted-foreground">원본 값</span>
                    </SelectItem>
                  )}
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

          {/* 실패는 이 자리에 남는다 — 닫으면 본문과 함께 사라진다(§3) */}
          {state !== dismissed && state.error && (
            <Failure title="발행하지 못했습니다" message={state.error} />
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "발행 중…" : "발행"}
            </Button>
          </div>
        </form>
        <DiscardConfirm guard={guard} />
      </DialogContent>
    </Dialog>
  );
}
