"use client";

/** 티켓 화면의 클라이언트 조각 — 상세(편집 폼 · 할당 해제 · 삭제)와 보드의 발행 · 요구 접수
 *  다이얼로그(§3 — 발행은 라우트가 아니라 보드에서 하는 한 동작이다).
 *
 *  한 파일에 있는 이유는 `projects-ui.tsx`와 같다: 같은 도메인(티켓 파일)의 액션이고 전부 서버
 *  액션 뒤에 있다(fs 접근은 여기 없다). 결과를 **토스트에 담지 않는다** — 워커 스크립트 출력과
 *  검증 사유는 읽어야 하는 정보고, 3초 뒤 사라지는 자리에 두면 못 본다(DESIGN.md §8이 해석 결과
 *  표에 쓴 같은 근거다). */
import {
  Fragment,
  useActionState,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "@/components/link";
import { useTrackedRouter } from "@/lib/route-pending";
import {
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
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
  openTicketFileAction,
  saveTicket,
  saveTicketFrontmatter,
  unassignTicket,
  type SaveState,
} from "@/app/(app)/p/[project]/tickets/[hash]/actions";
import { createTicket, type NewTicketState } from "@/app/(app)/p/[project]/(board)/actions";
import type { UnassignRun } from "@/lib/engine";
import { matchCombo } from "@/lib/keymap";
// `composeAnswer`(§비주얼 §29 방향 — 체크박스마다 다시 돈다)는 여기 있다: node:*가 없는
// 클라이언트·서버 공용 순수 함수 자리다(AGENTS.md). `lib/queue.ts`는 `node:fs`를 타서 못 부른다.
import {
  activeEpicFrom,
  composeAnswer,
  defaultPicks,
  formatRemaining,
  NO_QUESTION_SECTION_NOTICE,
  type AnswerPick,
} from "@/lib/urls";
// 스레드를 엮는 쪽은 서버(`lib/queue.ts threadOf`)다 — 여기 오는 건 타입뿐이라 `node:*`를 안 끈다
import type { Option, OptionGroup, QuoteSection, ThreadItem } from "@/lib/queue";
import { AttachmentField, useAttachments } from "@/components/attachment-field";
import { useHotkey, useKeymap } from "@/components/keymap-provider";
import { useLocale, useT } from "@/components/language-provider";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { FrontmatterRowsEditor } from "@/components/markdown-frontmatter-rows-editor";
import type { FrontmatterCandidates } from "@/lib/markdown-frontmatter-rows";
import type { RefIndex } from "@/lib/markdown-refs";
import type { Vault } from "@/lib/markdown-wikilinks";
import { PersonaDot } from "@/components/persona-badge";
import { PriorityMeter } from "@/components/priority-meter";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

// ── 되돌아온 횟수 줄 ─────────────────────────────────────────────────────────

/** 오른쪽 단 맨 위, frontmatter 표 **위**의 사실 한 줄(§2-14 · §비주얼 §11 §개정). `count`는
 *  서버가 `runner.log`에서 이미 센 값(`reassignCount`, `lib/workers.ts`)이고 여기는 문구 조립만
 *  한다 — 로케일이 필요해서 클라이언트다(page.tsx 주석 "이 컴포넌트는 서버라 로케일을 안 읽는다").
 *
 *  **1회 이하면 호출하지 않는다** — `0회`도 `-`도 안 그린다(§2-14 (5)). heading이 아니라 `<p>`
 *  하나다 — 절이 아니라 사실 한 줄이라 보조기술 heading 목록에 본문 없는 항을 안 늘린다. */
export function ReassignLine({ count }: { count: number }) {
  const t = useT();
  return (
    <p className="text-xs text-muted-foreground">
      {t("ticket.retries.linePrefix")} {count}
      {t("ticket.retries.lineSuffix")}
    </p>
  );
}

// ── frontmatter 표 ───────────────────────────────────────────────────────────

/** 오른쪽 단의 frontmatter 표(§43 ①). 기본 노출은 `assigned_at` 키까지 + 항상 붙는 `파일` 행 —
 *  `pid`·`owner`·`inbox` 등 그 뒤 키는 "펼치기"를 눌러야 보인다. 클라이언트 로컬 상태(새로고침하면
 *  다시 접힘)라 여기서 관리한다 — 서버에 저장할 값이 아니다.
 *
 *  자르는 지점은 `assigned_at` 키의 인덱스다. 그 키가 없으면(한 번도 claim 안 된 백로그 티켓)
 *  자를 지점이 없으므로 토글 자체를 그리지 않고 전 필드를 그대로 보여준다. */
export function FrontmatterTable({ fm, file }: { fm: Record<string, string>; file: string }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(fm);
  const cutIdx = entries.findIndex(([k]) => k === "assigned_at");
  const visible = cutIdx === -1 ? entries : entries.slice(0, cutIdx + 1);
  const collapsed = cutIdx === -1 ? [] : entries.slice(cutIdx + 1);

  const row = ([k, v]: [string, string]) => (
    <TableRow key={k} className="h-9">
      {/* 최장 키 `assigned_at` 11자 ≈ 84 + `px-3` 24 = 108 ≤ 112. `w-28`은 352px 안에서
          키 열이 값 열보다 넓어진다(page.tsx §비주얼 §11과 같은 값) */}
      <TableCell className="w-28 px-3 py-0 text-sm text-muted-foreground">{k}</TableCell>
      <TableCell className="px-3 py-0 whitespace-normal">
        <span className={k === "title" ? "text-sm" : "font-mono text-xs break-words"}>
          {v || "—"}
        </span>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <Table className="table-fixed">
        <TableBody>
          {visible.map(row)}
          {open && collapsed.map(row)}
          <TableRow className="h-9">
            <TableCell className="w-28 px-3 py-0 text-sm text-muted-foreground">파일</TableCell>
            <TableCell className="px-3 py-0 font-mono text-xs break-words whitespace-normal">
              {file}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {cutIdx !== -1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "접기" : "펼치기"}
        </Button>
      )}
    </>
  );
}

/** 열린 티켓의 frontmatter 행 편집기(DESIGN.md §프론트매터 행 편집기 결정 9, 티켓 `dc6364a4`) -
 *  다섯 폼 필드·엔진 실행 키를 뺀 나머지 키(`deps`-`req`-`epic`-`awaiting`-`continued`-
 *  `archives` 등)를 이 칸에서 고친다. `head`는 page.tsx가 그 나머지 키만으로 짠 합성
 *  frontmatter 원문이다(`lib/queue.ts`의 `TICKET_FORM_FIELD_KEYS`-`isTicketEngineKey`가 가르는
 *  기준과 같다). `.wip`-`.done`은 이 컴포넌트를 안 쓴다(page.tsx가 그대로 `FrontmatterTable`을
 *  쓴다) - 같은 잠금 문구를 두 벌 짓지 않는다(Done when 항목 2). */
export function TicketFrontmatterPanel({
  project,
  hash,
  head,
  candidates,
}: {
  project: string;
  hash: string;
  head: string;
  candidates: FrontmatterCandidates;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveTicketFrontmatter, {});
  const [value, setValue] = useState(head);
  const t = useT();
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="hash" value={hash} />
      {/* 값은 아래 행 편집기가 갈고, 여기는 그 state를 그대로 실어 제출한다 - 사람이 직접 치는
          칸이 아니라 `readOnly`로 controlled 경고만 끈다. */}
      <input type="hidden" name="head" value={value} readOnly />
      <FrontmatterRowsEditor head={value} onHeadChange={setValue} candidates={candidates} />
      {state.error && <Failure title={t("ticketFrontmatter.saveFailedTitle")} message={state.error} />}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {state.ok && <span className="text-sm text-muted-foreground">{t("ticketFrontmatter.saved")}</span>}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}

// ── 편집 폼 ─────────────────────────────────────────────────────────────────

/** 발행 다이얼로그의 `n-kind`와 **같은 셋**이다(§2 편집 항). 보드 필터의 kind 목록(큐에서 뽑는다)과
 *  다른 값인 게 맞다 — 저기는 있는 값을 거르는 자리고 여기는 값을 정하는 자리다. */
const KINDS = ["work", "request", "feedback"];

/** 우선순위 select의 선택지 — `lib/queue.ts PRIORITY_MIN/MAX`와 같은 값이다(§1-3 §값).
 *  값으로 import하지 않는다 — 이 파일은 클라이언트 컴포넌트라 `node:fs/promises`를 끄는
 *  `lib/queue.ts`를 값으로 물면 번들이 깨진다(`ThreadItem`처럼 타입만 문다). 5도 빼지 않는다:
 *  GUI 앞에 놓인 것이 사람이다. */
const PRIORITIES = [1, 2, 3, 4, 5];

/** `duedate:` 문자열 → ms, 못 읽으면 null(§1-4 §값과 같은 관용 — 새 파서를 안 만든다).
 *  `duedateOf`(`lib/queue.ts`)를 값으로 못 무는 이유는 위 `PRIORITIES`와 같다. 여기서는 엄밀한
 *  ISO 검증이 필요 없다 — 틀린 값은 어차피 저장 시점에 엔진이 WARN + 마감 없음으로 받는다(§1-4
 *  §역전 "실효 피해가 없다"). 이 판정은 그 전에 사람을 돕는 안내일 뿐이다. */
function parseDue(raw: string): number | null {
  if (!raw.trim()) return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** §1-4 §역전 — 선행 own duedate가 후행 own duedate보다 늦으면 모순이다. direct 관계만 본다
 *  (엔진 `_warn_duedate_reversals`와 같은 범위 — 전이는 안 탄다). 어긋난 쪽의 해시를 돌려주고,
 *  없으면 null. **엔진은 이 판정을 안 한다**(WARN 한 줄만 찍고 그대로 돈다) — 여기 클라이언트
 *  판정만 저장을 막는다, 새 서버 검증을 안 만드는 이유가 그것이다. */
function duedateConflict(
  own: string,
  precedents: { hash: string; duedate: string }[],
  followers: { hash: string; duedate: string }[],
): string | null {
  const ownMs = parseDue(own);
  if (ownMs === null) return null;
  for (const p of precedents) {
    const dueMs = parseDue(p.duedate);
    if (dueMs !== null && dueMs > ownMs) return p.hash;
  }
  for (const f of followers) {
    const dueMs = parseDue(f.duedate);
    if (dueMs !== null && ownMs > dueMs) return f.hash;
  }
  return null;
}

/** §5-5 §할당 입구 둘 — persona/squad select 값. `squad:`가 이기는 정책(§5-5 §티켓이 드는 것)과
 *  같은 순서로 보여준다: 스쿼드가 있으면 그 값, 아니면 페르소나 값, 둘 다 없으면 `없음`. */
function assignmentValue(persona: string, squad: string): string | null {
  return squad ? `squad:${squad}` : persona ? `persona:${persona}` : null;
}

/** 발행 다이얼로그의 기본 선택 — 복제는 원본이 이긴다(둘 다 비어도 `없음`, 기본값이 덮지
 *  않는다). 새 발행은 `default`라는 스쿼드가 있으면 그것, 없으면 `없음`이다
 *  (§5-5 §기본 스쿼드 `default` §기본 선택). */
function newTicketAssignmentDefault(
  copy: { persona?: string; squad?: string } | undefined,
  squads: string[],
): string | null {
  if (copy) return assignmentValue(copy.persona ?? "", copy.squad ?? "");
  return squads.includes("default") ? "squad:default" : null;
}

/** 트리거에 그리는 값 — `SelectValue`는 `items` 없는 Root에서 **값 문자열 그대로**를 그리므로
 *  (priority select의 `min-w-64` 주석과 같은 결함), 이 함수 없이는 트리거에 `persona:developer`가
 *  그대로 뜬다. §비주얼 §61 (5) — 스쿼드면 `스쿼드 <이름>`(낱말이 유일한 채널), 페르소나면
 *  이름만(비대칭이 뜻이다 — 기본은 페르소나고 스쿼드가 예외다). */
function assignmentLabel(value: string | null): string {
  if (!value) return "없음";
  const i = value.indexOf(":");
  const name = value.slice(i + 1);
  return value.slice(0, i) === "squad" ? `스쿼드 ${name}` : name;
}

/** §5-5 §할당 입구 둘의 두 select(발행·편집)가 같이 쓰는 옵션 그룹 — 페르소나/스쿼드. 값에
 *  접두사가 붙는다(`lib/paths.ts parseAssignment`와 짝). 스쿼드 항목엔 점을 안 그린다(§비주얼
 *  §12 — 색은 페르소나의 신원 표식이고 스쿼드에 주면 표식이 두 벌이 된다, §5-5 §화면). */
function AssignmentOptions({
  personas,
  squads,
  colors,
  current,
  outOfListLabel,
}: {
  personas: string[];
  squads: string[];
  colors?: Record<string, string>;
  /** 지금 값 — `{persona:"x"}` 또는 `{squad:"x"}` 또는 `{}`(없음) */
  current: { persona?: string; squad?: string };
  outOfListLabel: string;
}) {
  const personaOutOfList = current.persona && !personas.includes(current.persona);
  const squadOutOfList = current.squad && !squads.includes(current.squad);
  return (
    <>
      <SelectItem value={null}>없음</SelectItem>
      {(personas.length > 0 || personaOutOfList) && (
        <SelectGroup>
          <SelectLabel>페르소나</SelectLabel>
          {personas.map((p) => (
            // **점만**이다 — 껍데기(배지) 안에 배지를 또 넣지 않는다(§5). `font-mono`는 값 목록이라 무수정
            <SelectItem key={p} value={`persona:${p}`} className="font-mono">
              <PersonaDot color={colors?.[p]} />
              {p}
            </SelectItem>
          ))}
          {personaOutOfList && (
            <SelectItem value={`persona:${current.persona}`} className="font-mono">
              <PersonaDot color={colors?.[current.persona!]} />
              {current.persona}
              <span className="text-xs text-muted-foreground">{outOfListLabel}</span>
            </SelectItem>
          )}
        </SelectGroup>
      )}
      {(squads.length > 0 || squadOutOfList) && (
        <SelectGroup>
          <SelectLabel>스쿼드</SelectLabel>
          {squads.map((s) => (
            <SelectItem key={s} value={`squad:${s}`} className="font-mono">
              {s}
            </SelectItem>
          ))}
          {squadOutOfList && (
            <SelectItem value={`squad:${current.squad}`} className="font-mono">
              {current.squad}
              <span className="text-xs text-muted-foreground">{outOfListLabel}</span>
            </SelectItem>
          )}
        </SelectGroup>
      )}
    </>
  );
}

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
  squad,
  priority,
  effective,
  inheritedFrom,
  duedate,
  duedateBaseline,
  remainingMs,
  precedentDuedates,
  followerDuedates,
  personas,
  squads,
  colors,
  body,
  vault,
}: {
  project: string;
  hash: string;
  title: string;
  kind: string;
  persona: string;
  /** 원값(`ticket.fm.squad`) — `persona`와 한 select를 쓴다(§5-5 §할당 입구 둘). 둘 다 값이 있으면
   *  `squad:`가 이긴다(§5-5 §티켓이 드는 것) — 저장 시점엔 서버가 정확히 하나만 남긴다 */
  squad: string;
  /** 원값(`ticket.priority`) — 없거나 잘못되면 3이다(`lib/queue.ts priorityOf`) */
  priority: number;
  /** 유효 우선순위(`ticket.effective`) — 파일에 안 쓴다. `priority`와 다르면 상속 한 줄을 그린다 */
  effective: number;
  /** 유효값을 물려준 후행 티켓의 해시 — `effective !== priority`일 때만 온다(§1-3 §값을 넣는 자리 셋) */
  inheritedFrom?: string;
  /** 원값(`ticket.fm.duedate`) — 없으면 빈 문자열(§1-4 §값) */
  duedate: string;
  /** §1-4 기준값(`ticket.baseline`) — `priority`와 다르면 파생이 명시값을 덮은 것이라 파생 한 줄을 그린다 */
  duedateBaseline: number;
  /** "마감까지 <남은>"의 재료 — 서버가 `ticket.effectiveDue`로 이미 잰 ms다. `duedateBaseline`이
   *  `priority`와 같으면(파생 없음) null이다. 문구 조립(로케일 포함)은 이 컴포넌트가 한다 —
   *  서버 컴포넌트는 로케일을 안 읽는다(§0-16, `4f7def31`) */
  remainingMs: number | null;
  /** 직계 선행(deps)의 own duedate — 역전 판정 재료(§1-4 §역전, direct만). `hit`이 없는 deps는 빠진다 */
  precedentDuedates: { hash: string; duedate: string }[];
  /** 직계 후행(referrers)의 own duedate — 역전 판정 재료 */
  followerDuedates: { hash: string; duedate: string }[];
  /** 발행 다이얼로그와 같은 목록 — `listPersonas` 결과 중 `PROFILE.md`가 있는 이름. 상세 페이지가
   *  이미 읽은 것을 넘긴다(§3 "선택지 데이터는 이미 읽은 것을 넘긴다") */
  personas: string[];
  /** `squadNames` 결과 — 상세 페이지가 이미 읽은 것을 넘긴다(§5-5 §할당 입구 둘, 같은 이유) */
  squads: string[];
  /** 이름 → 팔레트 키(레지스트리 `personaColors`). 없는 이름은 빈 점이다(§비주얼 §12) */
  colors?: Record<string, string>;
  body: string;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 위지윅 면에 그대로 흘려보낸다 */
  vault?: Vault;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveTicket, {});
  const t = useT();
  const locale = useLocale();
  // 지난 마감은 `formatRemaining`에 안 보낸다 — "마감까지" 접두와 이어 붙이면 비문이 된다
  // (`마감까지 지남`·`Due in Past due`). 이 갈래는 `bell.due.overdue` 한 문장으로 따로 그린다
  // (§1-4 §화면, `4f7def31`).
  const overdue = remainingMs !== null && remainingMs <= 0;
  const remainingText = remainingMs !== null && !overdue ? formatRemaining(remainingMs, locale) : null;
  // 역전 판정은 입력이 바뀔 때마다 다시 잰다(§1-4 §역전 "다이얼로그를 새로 안 띄운다" —
  // 저장을 누르기 전에 여기서 막는다). uncontrolled로 두면 리렌더 없이 값이 바뀌어 못 잰다.
  const [duedateInput, setDuedateInput] = useState(duedate);
  const conflict = duedateConflict(duedateInput, precedentDuedates, followerDuedates);
  // 본문 편집기의 `breaks`(규칙 ⑤)가 이 값을 따라간다 — 발행 다이얼로그(§P236-4)와 같은 판정,
  // "폼에서 고른 kind"이지 저장된 kind가 아니다.
  const [kindValue, setKindValue] = useState(kind || "");
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
          {/* 값을 들고 있는 이유는 하나 — 아래 본문 편집기의 `breaks`가 이 값을 따라간다
              (request면 §10 표 셋째 줄 `untilHeading`). 저장 자체는 여전히 폼 제출(name="kind")이 한다 */}
          <Select name="kind" value={kindValue || null} onValueChange={(v) => setKindValue(v ?? "")}>
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
          {/* §5-5 §할당 입구 둘 — 칸은 하나, 그 안에서 그룹이 갈린다. 값 접두사(`persona:`/
              `squad:`)는 서버 `parseAssignment`가 첫 `:`에서 가른다 */}
          <Select name="persona" defaultValue={assignmentValue(persona, squad)}>
            <SelectTrigger id="t-persona" className="w-40 font-mono">
              <SelectValue placeholder="없음">{assignmentLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <AssignmentOptions
                personas={personas}
                squads={squads}
                colors={colors}
                current={squad ? { squad } : { persona }}
                outOfListLabel="현재 값"
              />
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {/* 미터는 select 라벨 왼쪽, 같은 gap-1(§비주얼 §49 §자리) — 자기 `priority`를 그린다,
              유효 우선순위가 아니다(상속은 아래 한 줄이 알려 준다) */}
          <span className="inline-flex items-center gap-1">
            <PriorityMeter priority={priority} locale={locale} />
            <Label htmlFor="t-priority">{t("ticket.priority.label")}</Label>
          </span>
          <Select name="priority" defaultValue={String(priority)}>
            <SelectTrigger id="t-priority" className="w-20">
              <SelectValue />
            </SelectTrigger>
            {/* 팝업만 넓힌다 — 트리거(`w-20`)와 폼의 줄 배치는 안 갈린다. `SelectValue`는
                `items`를 안 준 Root에서 **값 문자열만** 그리므로 꼬리 문구가 트리거에 안 온다 */}
            <SelectContent className="min-w-64">
              {PRIORITIES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                  <span className="text-xs text-muted-foreground">
                    {t(`ticket.priority.level.${n}`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* 유효 ≠ 원값 또는 마감 파생이 명시값을 덮었을 때 — 같은 자리·같은 모양이고 둘 다면
              한 줄에 이어 붙는다(§1-4 §화면. 미터는 자기 priority만 그린다, §1-3 §값을 넣는 자리 셋). */}
          {(inheritedFrom || overdue || remainingText) && (
            <p className="text-xs text-muted-foreground">
              {inheritedFrom && (
                <>
                  <span className="font-mono">{inheritedFrom}</span>
                  {t("ticket.priority.inheritedMiddle")} {effective}
                  {t("ticket.priority.inheritedAfter")}
                </>
              )}
              {inheritedFrom && (overdue || remainingText) && " "}
              {overdue && (
                <>
                  {t("bell.due.overdue")} {t("ticket.duedate.derivedMiddle")} {duedateBaseline}
                  {t("ticket.duedate.derivedAfter")}
                </>
              )}
              {remainingText && (
                <>
                  {t("ticket.duedate.derivedPrefix")} {remainingText}{" "}
                  {t("ticket.duedate.derivedMiddle")} {duedateBaseline}
                  {t("ticket.duedate.derivedAfter")}
                </>
              )}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="t-duedate">{t("ticket.duedate.label")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="t-duedate"
              name="duedate"
              type="datetime-local"
              className="w-56"
              value={duedateInput}
              onChange={(e) => setDuedateInput(e.target.value)}
            />
            {duedateInput && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDuedateInput("")}>
                {t("ticket.duedate.clear")}
              </Button>
            )}
          </div>
          {/* 역전 — 다이얼로그를 새로 안 띄운다. 입력 아래 문구 한 줄 + 저장 버튼 비활성뿐이다
              (§1-4 §역전, 엔진은 WARN만 찍고 그대로 돈다 — "실효 피해가 없다"가 이 비대칭의 근거). */}
          {conflict && (
            <p className="text-xs text-destructive">
              <span className="font-mono">{conflict}</span>
              {t("ticket.duedate.reversalSuffix")}
            </p>
          )}
        </div>
      </div>
      {/* 위지윅·원문 두 면(DESIGN.md §비주얼 §50 · 로드맵 §P236-3). breaks는 이 본문이 렌더되는
          자리(상세 §10)의 값 그대로다 — kind가 request면 첫 heading 앞까지만 켜진다. 폼에서 고른
          값을 쓴다(위 `kindValue` — 발행 다이얼로그 §P236-4와 같은 판정), 저장 안 한 kind 변경도
          미리보기에 바로 걸린다. */}
      <MarkdownEditor
        name="body"
        defaultValue={body}
        label={<Label>본문</Label>}
        rows={24}
        className="font-mono"
        breaks={kindValue === "request" ? "untilHeading" : undefined}
        vault={vault}
      />
      {state.error && <Failure title="저장하지 못했습니다" message={state.error} />}
      {/* 액션 행은 오른쪽 정렬이고 1차 액션이 가장 오른쪽이다(§비주얼 §4-3). 결과 문구는 버튼
          **왼쪽**이다 — 오른쪽에 두면 문구가 떴다 사라질 때마다 `저장`이 옆으로 움직인다 */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {state.ok && <span className="text-sm text-muted-foreground">저장됐습니다.</span>}
        <Button type="submit" disabled={pending || !!conflict}>
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
  // `.wip`은 할당 여부와 무관하게 잠금 카드가 떠야 한다 — 버튼만 그 안에서 빠진다
  if (!wip && !assigned && !run) return null; // 할당 안 된 티켓엔 이 액션이 없다

  const call = (force: boolean) =>
    start(async () => setRun(await unassignTicket(project, hash, force)));

  // 코드 `3` = 산 세션이라 엔진이 거부했다 — `--force`면 풀 수 있다(§2-5 §종료 코드).
  // **거부 문구를 읽지 않는다**: 문구를 고치는 순간 확인이 조용히 사라진다. 생존 판정은
  // 엔진 한 벌이고(제약 3) 화면은 그 답을 받아 묻기만 한다 — 첫 클릭은 실패가 아니라
  // **질문을 받아 오는 왕복**이다. 그래서 이때 실패 `Alert`는 뜨지 않는다(아래 `output`).
  const asking = run?.code === 3;

  const button = (
    <Button variant="outline" size="sm" disabled={pending || !worker} onClick={() => call(false)}>
      <Unlink aria-hidden />
      {pending ? "할당 해제 중…" : "할당 해제"}
    </Button>
  );

  /* 여섯 번째 `AlertDialog`이고 앞 다섯과 성격이 다르다(§5 · §2-5 §확인) — 지우는 것이 아니라
     **끊는 것**이고, 버튼이 여는 것이 아니라 엔진이 거부한 뒤에 열린다. 그래서 `AlertDialogTrigger`가
     없고 `open`을 상태가 쥔다(`DiscardConfirm`과 같은 모양이다).
     본문은 사실 셋을 다 알려 준다: 세션이 죽는다 · 커밋 안 된 변경은 남는다 · 티켓은 돌아가되
     답을 쓰기 전에는 아무 워커도 안 가져간다. 둘째 줄이 없으면 사람이 파일이 날아간 줄 알고
     안 누르거나, 눌러 놓고 지워졌다고 믿는다(요구 본문의 `진행한 작업을 삭제`가 화면이 보는
     사실과 다르다). 셋째 줄은 개정(§2-5 §개정)이 갈았다 — 엔진이 죽이기 직전에 답변 대기로
     잠그므로 `다시 디스패치됩니다`가 이제 거짓이다. */
  const confirm = (
    <AlertDialog open={asking} onOpenChange={(next) => !next && setRun(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>도는 세션을 끊습니다</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono">{hash}</span>를 물고 있는 세션이 아직 살아 있습니다. 강제로
            중단하면 그 세션이 죽고, 티켓은 답변 대기로 잠깁니다 — 답변칸에 답을 쓰기 전에는 아무
            워커도 다시 가져가지 않습니다. 워크트리에 커밋하지 않은 변경은 지워지지 않고 그대로
            남습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => call(true)}>
            강제 중단
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  // 코드 `3`은 실패가 아니라 질문이다 — 그 자리를 다이얼로그가 받는다(§2-5 §확인).
  const output =
    run &&
    !asking &&
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
     자물쇠가 움직이는 이유는 §18 ③: 이 문장이 떠 있는 **이유**가 지금 누가 일하고 있다는
     사실이라, 정지한 자물쇠는 그것을 과거형으로 읽는다. `.done` 자물쇠는 정지다(page.tsx) —
     영영 안 풀리는 잠금이라 기다릴 것이 없다.
     `Alert`는 열이 하나 는 것뿐이다: 손잡이가 오른쪽 끝에서 제목·설명 두 줄에 걸쳐 뜬다. */
  if (wip)
    return (
      <div className="space-y-2">
        <Alert className="has-[>svg]:grid-cols-[auto_1fr_auto]">
          <Lock
            aria-hidden
            className="animate-wip-pulse text-status-active motion-reduce:animate-none"
          />
          {/* 꼬리의 마크가 **누구인지**를 알려 준다(§비주얼 §19 ③ · 사람 요구 `47678a71`).
              `AlertDescription`이 아니라 여기인 이유: 할당 해제를 누를지 기다릴지가
              제목 한 줄에서 갈려야 한다(§2). 문구·`Lock`·`.done` `Alert`는 무수정 */}
          <AlertTitle>세션에 할당된 티켓입니다 — 편집·삭제 잠금 {mark}</AlertTitle>
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
        {confirm}
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
          열린 티켓에 <span className="font-mono">session_id</span>가 적혀 있습니다 —{" "}
          <span className="font-mono">select</span>가 영구 제외하고{" "}
          <span className="font-mono">reap</span>은 <span className="font-mono">.wip</span>만 보므로,
          할당 해제만이 이 티켓을 큐로 되돌립니다.
        </p>
      )}
      {output}
      {confirm}
    </div>
  );
}

// ── 요구사항 왕복 ───────────────────────────────────────────────────────────

/** 질문·답변 스레드만 — **보드 카드의 답변 다이얼로그 전용이다**(§1 · §2-3 ⑤).
 *
 *  티켓 상세에는 이제 이 스크롤러가 없다: 같은 스레드가 `진행 기록` 한 상자 안에서 세션 사건과
 *  시간순으로 섞인다(§2-3 · §비주얼 §29 — 그 상자는 `message-scroller`를 안 쓴다).
 *  여기 값은 §13 그대로다. **바뀐 것은 버튼 글자 하나뿐이다**(§29 ③ — 같은 아이콘·같은 동작인
 *  버튼이 두 화면에서 다른 이름이면 §0-9가 깨진다). */
export function AnswerThread({
  thread,
  vault,
  refs,
}: {
  thread: ThreadItem[];
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 질문·답변 둘 다 티켓 본문에서 왔다 */
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — 질문·답변·인용 넷 다 받는다 */
  refs?: RefIndex;
}) {
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
                  // 질문(PM)은 산문, 답변(사람)은 말풍선(§비주얼 §9 §산문과 말풍선 · §13
                  // §질문 쪽은 산문이다 — §2-7 ①). 종전엔 **정렬**이 역할을 갈랐지만 질문 쪽이
                  // 그릇을 잃은 뒤로는 **그릇**이 앞에 뜨고 정렬은 그 결과다(§13 §값).
                  // 아바타는 없다 — 참여자가 둘이고 그릇·정렬이 이미 가른다.
                  if (item.role === "question") {
                    return (
                      <MessageScrollerItem key={i} messageId={String(i)}>
                        {/* 말풍선이 아니다 — 전폭 산문. `Message`·`MessageContent`·`Bubble` 셋
                            다 안 쓴다(§13 §값). `px-0`은 헤더가 산문 첫 글자와 같은 x에 서게
                            하는 한 클래스다(§9) */}
                        <div>
                          <MessageHeader className="px-0">
                            {item.heading || "질문"}
                            {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
                          </MessageHeader>
                          {/* PM이 손으로 감은 절이라 줄바꿈을 안 그린다(§10 면제) */}
                          <Markdown text={item.text} vault={vault} refs={refs} />
                          {/* 결정 12 (5) — 인용 3종을 접어서 낸다. 상한은 안 내린다: 펼치면
                              `item.text`에서 뗀 그 전문이 그대로 나온다(`queue.ts` `threadOf`의
                              `foldQuotes`). 네이티브 `<details>`다(session-stream.tsx와 같은
                              값) — 아코디언 라이브러리를 안 쓴다.
                              결정 15 (1) — 문항이 한 벌뿐이면 `item.quotesOpen`이 `true`라 처음부터
                              펼쳐 낸다(클릭 0회로 결정할 내용이 화면에 있다). 두 벌 이상이면 종전대로
                              접는다. */}
                          {item.quotes?.map((q: QuoteSection, qi: number) => (
                            <details key={qi} className="group/quote mt-2" open={item.quotesOpen}>
                              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                                <ChevronRight
                                  aria-hidden
                                  className="size-3.5 shrink-0 transition-transform group-open/quote:rotate-90"
                                />
                                {q.heading}
                              </summary>
                              <div className="ml-[1.125rem]">
                                <Markdown text={q.text} vault={vault} refs={refs} />
                              </div>
                            </details>
                          ))}
                        </div>
                      </MessageScrollerItem>
                    );
                  }
                  return (
                    <MessageScrollerItem key={i} messageId={String(i)}>
                      <Message align="end">
                        <MessageContent>
                          {/* 헤더는 말풍선 **밖 · 위**다(§13) — 안에 넣으면 본문의 소유자가
                              `<Markdown>` 하나가 아니게 되고 §10 루트의 `[&>:first-child]:mt-0`이
                              거짓이 된다. 밖이면 놓이는 면이 `--card`고 거기서 `--muted-foreground`는
                              4.73 / 6.91이다. 오른쪽 정렬은 `MessageContent`가 `data-align=end`에서
                              자식을 `self-end`로 밀어 같이 준다 */}
                          <MessageHeader>
                            {item.heading || "답변"}
                            {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
                          </MessageHeader>
                          {/* 읽기만 하는 자리라 렌더된 마크다운이다(§비주얼 §10) — 말풍선 안에서도
                              그대로다. 본문에 `text-muted-foreground`를 걸지 않는다: 렌더된 본문의
                              `bg-muted` 블록 안에서 4.34가 되고 그건 §1이 실측으로 금지한 조합이다.
                              종전의 `border-l-2 border-border pl-3`은 지웠다 — 말풍선과 겹치면
                              답변 쪽만 세로선 + 상자 두 겹이 된다(§13) */}
                          <Bubble variant="outline" align="end">
                            <BubbleContent>
                              {/* 답변 본문은 **사람이 입력칸에 친 글**이라 줄바꿈을 그린다(§10 면제) */}
                              <Markdown text={item.text} breaks="all" vault={vault} refs={refs} />
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
                variant·size·자리는 컴포넌트 기본값이 이미 §13 값이다.
                **문구는 `맨 아래로`다**(§29 ③ — 상세의 병합 상자와 같은 말을 쓴다. 그릇·자리·모양은
                §13 그대로다: 여기는 스크롤 위에 뜨는 층이라 그림자 근거가 그대로다) */}
            <MessageScrollerButton>
              <ArrowDown aria-hidden />
              맨 아래로
            </MessageScrollerButton>
          </MessageScroller>
        </MessageScrollerProvider>
      )}
      {/* 결정 11 ⑩ — 이 컴포넌트는 `isAwaiting(t)`일 때만 열린다(호출부 `AnswerDialog`), 그래서
          `thread.length === 0`은 곧 "답변 대기인데 `## 질문 n` 절이 없다"이다(실측 8건). 스크롤러
          없이 이 줄 하나만 뜨고 폼은 안 감춘다 — 산문으로 답할 길은 아래에 그대로 있다. 상세
          (`session-stream.tsx`)와 문구를 `lib/urls.ts` 값 하나로 공유한다. */}
      {thread.length === 0 && <p className="text-xs text-muted-foreground">{NO_QUESTION_SECTION_NOTICE}</p>}
    </>
  );
}

/** 카드 세로 순서 = 조립된 글의 줄 순서(§비주얼 §29 §두 단 ①) — 문항을 앞줄 먼저 도는 순서로
 *  편다. `picks[i]`가 이 순서와 1:1이라 `optionsOf`가 준 트리 모양을 벗어나지 않는다. */
function flattenGroups(groups: OptionGroup[]): OptionGroup[] {
  const out: OptionGroup[] = [];
  const walk = (gs: OptionGroup[]) => {
    for (const g of gs) {
      out.push(g);
      walk(g.sub);
    }
  };
  walk(groups);
  return out;
}

/** 답변 폼 **한 벌** — 두 자리가 쓴다(§2-3 ③ · ⑤): 보드의 답변 다이얼로그(`AnswerFields` 안)와
 *  티켓 상세 `진행 기록` 절의 답변 모드 입력칸(`session-stream.tsx`).
 *
 *  **여기서 갈리는 것이 하나도 없는 것이 계약이다** — 같은 서버 액션 · 같은 문구 · 같은 실패.
 *  `hash`는 stem이고(§식별자) 두 호출자가 같은 값을 넘긴다. 종전 답변 카드 머리의 한 줄
 *  (`답변을 달면 …`)은 이 폼에 없다: 다이얼로그는 `DialogDescription`이, 상세는 절의 폼 위 한 줄이
 *  같은 말을 한다 — 여기 넣으면 다이얼로그에서 두 번 뜬다. */
export function AnswerForm({
  project,
  hash,
  answerFile,
  options,
  defaultAnswer = "",
  body: ticketBody,
  vault,
  refs,
}: {
  project: string;
  hash: string;
  answerFile: string;
  /** 마지막 질문 라운드의 선택 카드(§결정 10 §자리② · §비주얼 §29 ⑤) — 서버가
   *  `lastQuestionOptions(thread)`로 미리 재 내려보낸다. 0개면 그 라운드에 선택지가 없다
   *  (58/100, 결정 10 ⑨) — 카드를 안 그리고 종전 화면 그대로다. */
  options: OptionGroup[];
  /** frontmatter `default_answer:`(결정 12 (4)) — 미리 골라 둔 답. 서버가 `defaultAnswerOf(ticket)`로
   *  내려보낸다. 없으면(PM이 손으로 쓴 질문) 체크 0개, 종전 화면 그대로다. */
  defaultAnswer?: string;
  /** 질문 절 밖의 본문(결정 14 ①, 요구 `c37fe0d3`) — 서버가 `bodyWithoutQuestions(ticket.body)`로
   *  내려보낸다. `## 질문 n`·`## 진행 계획`은 그 함수가 이미 뺐다. 카드 아래 접힌 `<details>`
   *  하나로 그린다 — 빈 문자열이면 그 접힘 자체가 없다(③). 이름을 `body`가 아니라
   *  `ticketBody`로 받는 이유: 이 폼 안에 이미 같은 이름의 상태(조립되는 답변 글)가 있다. */
  body: string;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 위지윅 면에 그대로 흘려보낸다 */
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — 아래 접힌 본문 `<Markdown>`만 받는다. 위지윅
   *  `<MarkdownEditor>`에는 안 준다(§9 축 1-1 — 편집 면은 표식이 0개다). */
  refs?: RefIndex;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(answerRequirement, {});
  // 문항마다 하나(§결정 11 ⑨) — 하위 문항(`1-1.`)도 자기 칸을 가지므로 picks는 그룹 트리를
  // 평평하게 편 순서와 1:1이다(§비주얼 §29 §두 단 ①). 트리 모양은 렌더 중 안 변하므로 이 순서는
  // 세션 동안 고정이다.
  const flatGroups = flattenGroups(options);
  const groupIndex = new Map(flatGroups.map((g, i) => [g, i] as const));
  // 카드별 고른 것 + 덧붙임(§비주얼 §29 ⑤ 조립된 글이 보이는 자리) — 방향은 카드 -> 칸 한
  // 쪽뿐이다. 카드를 만질 때마다 `composeAnswer`가 입력칸을 통째로 다시 쓴다. 초기값은
  // `default_answer`(결정 12 §자리 (5)) — `defaultPicks`가 그 값을 못 알아들으면 빈 채다.
  const [picks, setPicks] = useState<AnswerPick[]>(() => defaultPicks(flatGroups, defaultAnswer));
  // 제어값 — `⌘↵`·제출 버튼이 빈 본문에서 required를 대신 막으려면 지금 글을 봐야 한다
  // (위지윅 면의 제출값은 hidden input이라 네이티브 `required`가 안 걷힌다, §P236-4). 초기값은
  // 위 `picks`의 조립 결과라 체크를 끄면(§Done when 2) `composeAnswer`가 그대로 비운다.
  const [body, setBody] = useState(() => composeAnswer(picks));
  const applyPicks = (next: AnswerPick[]) => {
    setPicks(next);
    setBody(composeAnswer(next));
  };
  // 상위를 끄면 하위 선택지도 같이 꺼지고 그 고른 것도 버려진다(§결정 11 ⑥ · §비주얼 §29 §두 단
  // ⑨) — 글자가 `a` `a-1` `a-1-1`로 하이픈이 계층을 그대로 나르므로 접두사 하나로 하위 전부가
  // 걸린다. 트리를 따로 안 걸어도 된다.
  const toggleLetter = (groupIdx: number, letter: string, checked: boolean) => {
    applyPicks(
      picks.map((p, idx) =>
        idx !== groupIdx
          ? p
          : {
              ...p,
              letters: checked
                ? [...p.letters, letter]
                : p.letters.filter((l) => l !== letter && !l.startsWith(`${letter}-`)),
            },
      ),
    );
  };
  // 들여쓰기 상한 3단(§비주얼 §29 §두 단 ⑫) — 문항·선택지 두 축이 각자 `min(depth,2)`에서 멈춘다.
  // 정규식은 4단도 통과시키므로(§결정 11 ③) 화면이 스스로 멈춰야 한다.
  const subWrapClass = (depth: number) => (depth < 2 ? "ml-6 space-y-2" : "space-y-2");
  const renderOptions = (opts: Option[], groupIdx: number, depth: number): ReactNode =>
    opts.map((opt) => {
      const checked = picks[groupIdx].letters.includes(opt.letter);
      return (
        <Fragment key={opt.letter}>
          <label className="flex min-h-6 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0"
              checked={checked}
              aria-expanded={opt.options.length > 0 ? checked : undefined}
              onChange={(e) => toggleLetter(groupIdx, opt.letter, e.target.checked)}
            />
            {/* `truncate` + `title` — 전문은 카드 바로 위 질문 산문에 이미 있다(§2 스레드가
                질문의 유일한 출처) */}
            <span className="truncate" title={opt.label}>
              {opt.label}
            </span>
          </label>
          {/* `(a-1)`은 `(a)`를 고르면 열리는 하위 선택지다(§결정 11 ⑤) — 전환 0, 조건부 렌더 하나 */}
          {checked && opt.options.length > 0 && (
            <div role="group" aria-label={opt.label} className={subWrapClass(depth)}>
              {renderOptions(opt.options, groupIdx, depth + 1)}
            </div>
          )}
        </Fragment>
      );
    });
  // 문항 블록 하나(제목 · 선택지 · 덧붙임 칸) + 그 문항의 하위 문항들(§결정 11 ④). 카드는 여전히
  // 문항 하나에 한 장이라 하위 문항은 새 카드가 아니라 이 안에서 겹친다(§비주얼 §29 §두 단 ①).
  const renderGroupBody = (g: OptionGroup, depth: number): ReactNode => {
    const idx = groupIndex.get(g)!;
    return (
      <>
        <p className="text-sm font-medium">{g.heading}</p>
        {renderOptions(g.options, idx, 0)}
        <Input
          placeholder="덧붙일 말"
          value={picks[idx].note}
          onChange={(e) =>
            applyPicks(picks.map((p, i) => (i === idx ? { ...p, note: e.target.value } : p)))
          }
        />
        {g.sub.length > 0 && (
          <div role="group" aria-label={g.heading} className={subWrapClass(depth)}>
            {g.sub.map((sg) => (
              <Fragment key={sg.number}>{renderGroupBody(sg, depth + 1)}</Fragment>
            ))}
          </div>
        )}
      </>
    );
  };
  const sendCombo = useKeymap().bindings["interject.send"];
  const empty = body.trim() === "";
  return (
    /* 입력칸과 `답변 달기`는 상자 **밖 · 밑**이다 — 다이얼로그를 화면 높이로 늘리는 안은 버렸다(§2) */
    <form action={action} className="space-y-3">
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="hash" value={hash} />
      {/* 그룹마다 카드 한 장(§비주얼 §29 ⑤) — 폼의 첫 시각 자식이다. 카드 0개(58/100)면 블록
          자체를 안 그린다 — 종전 화면과 한 픽셀도 안 갈린다(⑨). */}
      {options.length > 0 && (
        <div className="space-y-2">
          {options.map((g) => (
            <div
              key={g.number}
              role="group"
              aria-label={g.heading}
              className="space-y-2 rounded-lg border p-3"
            >
              {renderGroupBody(g, 0)}
            </div>
          ))}
        </div>
      )}
      {/* 결정 14 ① — 질문 절 밖의 본문. 카드 아래 접힌 채로 데려온다(③ 빈 문자열이면 접힘
          자체가 없다). 네이티브 `<details>`다(`AnswerThread`의 인용 접힘과 같은 관용구) —
          아코디언 라이브러리를 안 쓴다. */}
      {ticketBody.trim() !== "" && (
        <details className="group/body">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 transition-transform group-open/body:rotate-90"
            />
            본문
          </summary>
          <div className="ml-[1.125rem]">
            <Markdown text={ticketBody} vault={vault} refs={refs} />
          </div>
        </details>
      )}
      {/* 보이는 `<Label>`도 `a-body` id도 없다(§29 ②) — 이름을 이미 가리키는 것이 두 자리 다 있다:
          상세는 절 제목 `진행 기록`, 다이얼로그는 `DialogTitle`(`답변 — <제목>`). placeholder는
          라벨이 아니라서 `aria-label`이 접근 가능한 이름을 받는다. 문구는 참견·이어받기와 같은
          문법(`[대상]에 [행위]기`)이다 — 한 칸이 모드를 말하는 방식이 셋 다 같아진다.
          답변은 사람이 입력칸에 친 글이라 줄바꿈을 그대로 그린다(§10 면제 · `AnswerThread`의
          `breaks="all"`과 같은 값). */}
      <MarkdownEditor
        name="body"
        value={body}
        onValueChange={setBody}
        ariaLabel="답변"
        placeholder="질문에 답 쓰기"
        rows={8}
        className="font-mono"
        required
        breaks="all"
        vault={vault}
        // `⌘↵`로도 단다(§2 답변 항, 요구 `54f40caa`) — §3 요구 접수 칸과 같은 규칙 그대로다.
        onKeyDown={(e) => {
          if (!matchCombo(e.nativeEvent, sendCombo)) return;
          e.preventDefault();
          if (!pending && !empty) e.currentTarget.closest("form")?.requestSubmit();
        }}
      />
      {state.error && <Failure title="답변을 달지 못했습니다" message={state.error} />}
      {/* 보조 텍스트는 버튼 왼쪽이다(§비주얼 §4-3) */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          <span className="font-mono">tickets/{answerFile}</span>를 만듭니다
        </span>
        {/* 아이콘이 `답변 대기` 배지와 이 CTA를 잇는다 — 색은 안 쓴다(§비주얼 §15).
            보드 카드의 트리거와 같은 글자꼴이다 */}
        <Button type="submit" disabled={pending || empty}>
          <MessageSquareReply aria-hidden />
          {pending ? "답변 다는 중…" : "답변 달기"}
        </Button>
      </div>
    </form>
  );
}

/** 스레드 + 답변 폼 — **보드의 답변 다이얼로그가 그리는 것**이다(§1 보드 요구사항 항).
 *  엮는 쪽은 `lib/queue.ts threadOf`고 폼은 `AnswerForm` 한 벌이다. 상세는 이 조합을 안 쓴다:
 *  거기서는 스레드가 `진행 기록` 상자 안으로 들어가고 폼만 그 아래에 뜬다(§2-3 ①). */
function AnswerFields({
  thread,
  vault,
  refs,
  ...props
}: {
  project: string;
  hash: string;
  answerFile: string;
  thread: ThreadItem[];
  options: OptionGroup[];
  defaultAnswer?: string;
  /** 질문 절 밖의 본문(결정 14 ①) — `AnswerForm`에 그대로 흘려보낸다(`...props` 스프레드) */
  body: string;
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — `AnswerThread`·`AnswerForm`에 그대로 흘려보낸다 */
  refs?: RefIndex;
}) {
  return (
    <>
      <AnswerThread thread={thread} vault={vault} refs={refs} />
      <AnswerForm {...props} vault={vault} refs={refs} />
    </>
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
  options: OptionGroup[];
  defaultAnswer?: string;
  /** 질문 절 밖의 본문(결정 14 ①) — `AnswerFields`에 그대로 흘려보낸다(`...props` 스프레드) */
  body: string;
  /** 다이얼로그 머리에 요구사항 제목을 적는다 — 보드에서는 어느 카드를 열었는지가 안 보인다 */
  title: string;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — `AnswerFields`에 그대로 흘려보낸다 */
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — `AnswerFields`에 그대로 흘려보낸다 */
  refs?: RefIndex;
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
        {/* `min-w-0` — `DialogContent`가 `grid`라 아이템의 `min-width: auto`가 min-content로
            굳는다(실측 890 / 팝업 672). 안쪽 표·펜스의 `overflow-x-auto`가 그것에 무력화돼
            팝업이 가로로 넓어졌다(§비주얼 §3 간격 관용구 · §로드맵 §P167). 고치는 자리는
            여기 하나다 — `dialog.tsx`는 안 고친다(선례 둘: §10 렌더러 루트 · P71 `ee0aa308`) */}
        <div className="min-w-0 space-y-4">
          <AnswerFields {...props} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 해시 줄의 "OS 기본 앱으로 열기" 아이콘 버튼(§10 §자리 다섯) — 이미 쓰는 아이콘 버튼 관용에
 *  툴팁 한 줄이다. `openTicketFileAction`이 서버에서 다시 찾은 경로로만 `open`을 부른다. */
export function OpenTicketFileButton({ project, hash }: { project: string; hash: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.openInApp")}
              disabled={pending}
              onClick={() => {
                if (pending) return;
                start(async () => {
                  setError(null);
                  const r = await openTicketFileAction(project, hash);
                  if (!r.ok) setError(r.message || t("common.openInApp.failed"));
                });
              }}
            >
              <ExternalLink aria-hidden />
            </Button>
          }
        />
        <TooltipContent>{t("common.openInApp")}</TooltipContent>
      </Tooltip>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
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
  const router = useTrackedRouter();
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

/** deps 후보 한 건. `hash`는 상태 접미사를 뗀 **파일명 stem**이다 — deps가 가리키는 이름이 그것이다.
 *  `duedate`는 그 티켓의 own duedate 원문(§1-4 §역전 판정 재료) — 없으면 빈 문자열. */
export type DepOption = { hash: string; title: string; met: boolean; duedate: string };

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

/** 닫기 확인 — 문구·기본 초점은 §3이 정해 둔 값이다. 삭제 확인(`DeleteTicketButton`)과 같은
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
                      <span className="truncate text-sm text-muted-foreground group-data-selected/command-item:text-foreground">
                        {o.title || "(제목 없음)"}
                      </span>
                      {o.met && (
                        <span className="shrink-0 text-xs text-muted-foreground group-data-selected/command-item:text-foreground">
                          완료
                        </span>
                      )}
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
 *  고정하는 경로고, **성공이 `redirect`가 아니라 `{ ok, hash }`로 돌아오는 경로**이기도 하다.
 *
 *  **인스턴스는 둘이다**(§3 `키(r)는 프로젝트 셸 어디서나 듣는다`): 보드 우상단의 `button`과
 *  프로젝트 셸의 `hotkey`. 트리거가 곧 그 인스턴스의 정체라 `SettingsDialog`(§0-4)와 같은
 *  모양이고, 전역 상태도 URL 파라미터도 만들지 않는다 — 동시에 열릴 수 없다. */
export function RequestDialog({
  project,
  trigger = "button",
  vault,
}: {
  project: string;
  /** `button` = 보드 우상단. `hotkey` = 프로젝트 셸에 한 번 마운트되는 **트리거 없는** 것 —
   *  버튼을 안 그리고 `r`을 듣는 유일한 인스턴스다(§3). */
  trigger?: "button" | "hotkey";
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 위지윅 면에 그대로 흘려보낸다 */
  vault?: Vault;
}) {
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
  const att = useAttachments(project);
  // `⌘↵`(§3 · §0-6). 참견·홈 질의 칸과 **같은 바인딩**이다 — 액션을 새로 만들면 §0-6 충돌
  // 검증이 기본 키맵을 거절한다. 조합 문자열은 여기 안 적는다: 사람이 키를 바꾸면 이 칸도 따라간다.
  const sendCombo = useKeymap().bindings["interject.send"];
  // 활성 에픽(§에픽 §결정 10) — 값은 제출 순간에만 필요하다. `useSearchParams()`는 이 컴포넌트가
  // 셸(레이아웃)에도 마운트되어(`trigger="hotkey"`) `pnpm build`가 그 자리에 Suspense 경계를
  // 요구할 수 있어 제출 시점에 `location`을 직접 읽는 쪽이 더 싸다 — hidden input을 uncontrolled로
  // 두고 `onSubmit`에서 그 값을 채운다.
  const epicRef = useRef<HTMLInputElement>(null);

  // 닫히면 빈 칸으로 돌아간다 — 접수한 본문이 남아 있으면 같은 요구가 두 번 접수된다(§3).
  // 접수 확인 화면(`done`)은 **묻지 않는다**: 이미 접수돼서 잃을 것이 없다.
  // **첨부도 `dirty`에 든다**(§8 §거동) — 본문보다 되돌리기 어려운 것이 이쪽이다.
  // 칩은 비지만 올라간 파일은 안 지운다(§8 수명).
  const guard = useCloseGuard(!done && (body !== "" || att.dirty), () => {
    setBody("");
    att.reset();
    setDismissed(state);
  });

  // `⌘/`(§0-6 `board.request`). **셸 인스턴스 하나만 듣는다** — 보드에는 이 컴포넌트가 둘이고
  // 둘 다 들으면 키 한 번에 다이얼로그가 둘 열린다(§3 · `SettingsDialog`이 `icon`만 듣는 그 모양).
  // 여는 것도 닫는 경로 넷과 같은 `guard.close`다 — 상태를 새로 만들지 않는다.
  useHotkey("board.request", (e) => {
    if (trigger !== "hotkey") return;
    e.preventDefault();
    guard.close(true);
  });

  return (
    <Dialog open={guard.open} onOpenChange={guard.close}>
      {/* 셸 것은 버튼을 안 그린다 — 헤더에 여섯 번째 것이 붙지 않고 보드 우상단 쌍도 무수정이다(§3) */}
      {trigger === "button" && <DialogTrigger render={<Button size="sm" />}>요구 접수</DialogTrigger>}
      {/* 천장은 발행 다이얼로그와 같은 한 줄이다 — 이 폼의 `<Textarea>`는 `field-sizing-content`라
          본문만큼 자라는데 여기엔 `max-h`도 `overflow`도 없어 900 화면에서 본문 34줄이면 스크롤도
          없이 잘렸다. 칩 줄이 그 지점을 26줄로 당긴다(§비주얼 §27 높이 항 — 첨부가 만든 결함이
          아니라 148px 앞당기는 결함이다). `dialog.tsx`는 안 고친다 */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>요구 접수</DialogTitle>
          {!done && (
            <DialogDescription>
              필요한 것을 자연어로 쓰면 <span className="font-mono text-xs">kind: request</span>{" "}
              티켓이 되고 해석합니다. 첫 줄이 제목이 됩니다.
            </DialogDescription>
          )}
        </DialogHeader>
        {done ? (
          // 접수 확인은 **이 자리**다 — 상세로 튀면 "당신이 티켓을 만들었다"가 되고, 실제로 일어난
          // 일은 큐가 요구를 접수했다는 것뿐이다(사람 지적 `fb0d309c`). 해시·kind·persona는
          // 말하지 않는다: 사람이 고르지 않은 값이고 여기서 할 일도 없다. 상세는 링크로 남는다.
          <div className="space-y-4">
            {/* 문장은 서버가 만든다(§에픽 §결정 10) — `epicTitle()`·`제목 없음` 갈래를 여기서
                두 번째로 짜지 않는다. */}
            <p className="text-sm">{state.message}</p>
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
          // `min-w-0` — 위 답변 다이얼로그와 **같은 결함 · 같은 처방**이다(§비주얼 §3 간격 관용구).
          // 이 폼의 `<Textarea>`는 `field-sizing-content`라 안 쪼개지는 긴 토큰 한 줄이 그대로
          // min-content가 된다(실측: 100자 토큰에서 그릇 544 → 707.2 · 팝업 576에 가로 스크롤바)
          <form
            action={action}
            className="min-w-0 space-y-4"
            // 화면이 이미 아는 활성 에픽을 제출 순간에 채운다(§에픽 §결정 10) — 값이 없으면
            // 빈 문자열이고, 서버는 빈 값을 `epic:` 줄을 안 쓰는 것과 같게 본다.
            onSubmit={() => {
              if (epicRef.current) epicRef.current.value = activeEpicFrom(location.pathname, location.search);
            }}
          >
            <input type="hidden" name="project" value={project} />
            <input type="hidden" name="mode" value="req" />
            <input type="hidden" name="epic" ref={epicRef} />
            {/* 요구 본문은 상세에서 `<Markdown breaks="untilHeading">`로 렌더된다(§10 표 — 이
                다이얼로그가 만드는 티켓은 항상 `kind: request`다). 위지윅 면의 `Enter`가 그
                렌더와 같아지려면 값이 여기서도 `untilHeading`이어야 한다(규칙 ⑤). */}
            <MarkdownEditor
              name="body"
              value={body}
              onValueChange={setBody}
              rows={12}
              required
              autoFocus
              ariaLabel="요구 내용"
              placeholder={"무엇이 필요한지 그냥 쓰세요.\n첫 줄이 제목이 됩니다."}
              breaks="untilHeading"
              vault={vault}
              onPaste={att.onPaste}
              // `⌘↵`로 접수한다. `Enter`는 줄바꿈 그대로고, 한글 조합 중의 `Enter`는
              // `matchCombo`의 `isComposing` 가드가 막는다(§3 · §21과 같은 규칙, 세 번째 칸이다).
              //
              // **폼을 제출한다 — 서버 액션을 직접 부르지 않는다**(§3). `requestSubmit()`을
              // `<form action>` 경로로 돌린다 — 위지윅 면의 제출값은 hidden input이라 네이티브
              // `required` 검사가 안 걷혀서(barred) 빈 본문은 여기서 직접 막는다(`body.trim()`).
              // `pending`은 버튼의 `disabled`가 하는 일을 여기서 한 번 더 한다 — 키에는
              // `disabled`가 없다.
              onKeyDown={(e) => {
                if (!matchCombo(e.nativeEvent, sendCombo)) return;
                e.preventDefault();
                if (!pending && body.trim()) e.currentTarget.closest("form")?.requestSubmit();
              }}
            />
            {/* 실패는 이 자리에 남는다 — 닫으면 본문과 함께 사라진다(§3) */}
            {live && state.error && <Failure title="접수하지 못했습니다" message={state.error} />}
            {/* 칩 줄 · 실패 사유 줄 · 액션 행(§27). 제출 버튼은 사람이 지목한 자리 그대로
                행의 오른쪽 끝이고(요구 `027d8e96` · §비주얼 §4-3) 손잡이가 그 왼쪽에 놓인다 */}
            <AttachmentField att={att}>
              <Button type="submit" disabled={pending || !body.trim()}>
                {pending ? "접수 중…" : "요구 접수"}
              </Button>
            </AttachmentField>
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
  squads,
  colors,
  deps,
  personaDir,
  variant,
  copy,
  hotkey,
  vault,
}: {
  project: string;
  /** 프로필(`PROFILE.md`)이 있는 이름만. 보드의 **필터 목록을 넘기면 안 된다** — 그쪽은
   *  티켓이 참조하는 프로필 없는 이름까지 포함한다(§3) */
  personas: string[];
  /** `squadNames` 결과 — 보드가 이미 읽은 것을 넘긴다(§5-5 §할당 입구 둘) */
  squads: string[];
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
   *  사람이 조건만 바꿔 다시 시키려는 것이지 이름을 바꾸려는 게 아니다.
   *  `squad`도 원본 값 그대로 따라간다(§5-5 §화면 「복제」) — 엔진 키(session_id 등)는 안 넘어간다. */
  copy?: { stem: string; title: string; kind: string; persona: string; squad: string; body: string };
  /** `board.new`(`n`)를 듣는다. **보드의 두 자리만 켠다** — 티켓 상세의 복제 버튼도 이 컴포넌트라
   *  켜면 상세에서 `n`이 복제 다이얼로그를 연다(§0-6 `어디서 듣나`는 보드다) */
  hotkey?: boolean;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 위지윅 면에 그대로 흘려보낸다 */
  vault?: Vault;
}) {
  const [state, action, pending] = useActionState<NewTicketState, FormData>(createTicket, {});
  const [picked, setPicked] = useState<string[]>([]);
  const t = useT();
  // 열었을 때의 값 — dirty 판정과 리셋이 둘 다 이걸 기준으로 한다(§3)
  const blankTitle = copy?.title ?? "";
  const blankBody = copy?.body ?? BODY_SKELETON;
  // title·본문이 **controlled**인 이유는 `RequestDialog`와 같다 — React 19가 action 후 폼을
  // 리셋해서 uncontrolled면 발행 실패가 곧 입력 유실이다. deps는 이미 `picked`가 들고 있고,
  // persona·priority는 base-ui Select가 자기 상태로 들고 있다(리셋에 안 밟힌다. 실측).
  const [title, setTitle] = useState(blankTitle);
  const [body, setBody] = useState(blankBody);
  // kind만 예외로 든다 — 저장 자체는 여전히 select의 폼 제출(name="kind")이 하지만, 본문
  // 편집기의 `breaks`(규칙 ⑤)가 "폼에서 고른 kind"를 따라가야 한다(`TicketEditForm`의 `kindValue`와
  // 같은 판정, §P236-4).
  const [kindValue, setKindValue] = useState(copy ? copy.kind || "" : "work");
  // 발행은 항상 비어서 연다(§1-4 §화면 "기본은 비어 있다" — priority와 같은 이유로 복제도 안
  // 물려받는다). title·body와 같은 이유로 controlled다(React 19 액션 후 폼 리셋).
  const [duedateInput, setDuedateInput] = useState("");
  // 마지막으로 닫은 결과. `RequestDialog`와 같은 이유 — 실패 사유가 본문 없이 살아남지 않게 한다(§3)
  const [dismissed, setDismissed] = useState<NewTicketState>({});
  const att = useAttachments(project);

  // **kind·persona·priority select는 세지 않는다**: base-ui가 자기 상태로 들고 있어 읽을 수 없고,
  // 사람이 "쓰던 내용"이라 부르는 것도 아니다(§3). **첨부는 센다**(§8 §거동 — 칩이 하나라도
  // 있으면 묻는다). 성공에는 확인이 끼지 않는다 — 그 경로는 서버 액션의 `redirect`가
  // 컴포넌트째 언마운트한다.
  const guard = useCloseGuard(
    title !== blankTitle || body !== blankBody || picked.length > 0 || duedateInput !== "" || att.dirty,
    () => {
      setTitle(blankTitle);
      setBody(blankBody);
      setPicked([]);
      setDuedateInput("");
      att.reset();
      setDismissed(state);
    },
  );

  // 역전(§1-4 §역전) — 새 티켓은 아직 없어 후행이 있을 수 없다. 직접 고른 선행(`picked`)만 본다.
  const precedentDuedates = deps
    .filter((d) => picked.includes(d.hash))
    .map((d) => ({ hash: d.hash, duedate: d.duedate }));
  const duedateConflictHash = duedateConflict(duedateInput, precedentDuedates, []);

  // `⌘I`(§0-6 `board.new`). **이 컴포넌트만 보드 밖에도 있다**(티켓 상세의 복제) — 그래서
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
        {/* `min-w-0` — 답변 다이얼로그와 같은 결함이다(§비주얼 §3 간격 관용구). 본문 `<Textarea>`가
            `field-sizing-content`라 안 쪼개지는 긴 토큰 한 줄이 min-content로 올라간다
            (실측: 100자 토큰에서 그릇 640 → 727.6 · 팝업 672에 가로 스크롤바) */}
        <form action={action} className="min-w-0 space-y-4">
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
              <Select name="kind" value={kindValue || null} onValueChange={(v) => setKindValue(v ?? "")}>
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
              {/* §5-5 §할당 입구 둘 — 편집 폼과 같은 칸 하나, 같은 그룹 둘. 기본 선택은
                  §5-5 §기본 스쿼드 `default` §기본 선택 — 복제가 아니면 `default` 스쿼드가
                  있을 때 그것을 기본으로 문다 */}
              <Select name="persona" defaultValue={newTicketAssignmentDefault(copy, squads)}>
                <SelectTrigger
                  id="n-persona"
                  className="w-40"
                  // 복제는 원본 값이 이미 들어 있다 — 선택지 0개라고 잠그면 그 값을 못 지운다
                  disabled={personas.length === 0 && squads.length === 0 && !copy?.persona && !copy?.squad}
                >
                  {/* 비우는 게 정상이다 — 페르소나 없이도 디스패치된다(protocols/tickets.md) */}
                  <SelectValue placeholder="없음">{assignmentLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <AssignmentOptions
                    personas={personas}
                    squads={squads}
                    colors={colors}
                    current={copy?.squad ? { squad: copy.squad } : { persona: copy?.persona }}
                    outOfListLabel="원본 값"
                  />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-priority">{t("ticket.priority.label")}</Label>
              {/* 요구 접수 모드에는 안 붙는다(§3 §값을 넣는 자리 셋) — 그 폼은 `RequestDialog`로
                  따로 있고 이 select를 안 쓴다. 서버가 `priority: 3`으로 고정한다. */}
              <Select name="priority" defaultValue="3">
                <SelectTrigger id="n-priority" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                {/* 편집 폼과 같다 — 팝업만 넓히고 트리거는 숫자 하나다 */}
                <SelectContent className="min-w-64">
                  {PRIORITIES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                      <span className="text-xs text-muted-foreground">
                        {t(`ticket.priority.level.${n}`)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-duedate">{t("ticket.duedate.label")}</Label>
              {/* 요구 접수 모드에는 안 붙는다(§1-4 §화면) — priority와 같은 이유다. 기본은 비어
                  있다(복제도 안 물려받는다). */}
              <div className="flex items-center gap-2">
                <Input
                  id="n-duedate"
                  name="duedate"
                  type="datetime-local"
                  className="w-56"
                  value={duedateInput}
                  onChange={(e) => setDuedateInput(e.target.value)}
                />
                {duedateInput && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDuedateInput("")}
                  >
                    {t("ticket.duedate.clear")}
                  </Button>
                )}
              </div>
              {/* 역전 — 새 티켓은 후행이 없으니 고른 선행(deps)만 본다. 다이얼로그를 새로 안
                  띄운다: 입력 아래 문구 한 줄 + 발행 버튼 비활성뿐이다(§1-4 §역전). */}
              {duedateConflictHash && (
                <p className="text-xs text-destructive">
                  <span className="font-mono">{duedateConflictHash}</span>
                  {t("ticket.duedate.reversalSuffix")}
                </p>
              )}
            </div>
            {personas.length === 0 && (
              <p className="self-end pb-2 text-xs text-muted-foreground">
                <span className="font-mono break-all">{personaDir}</span>에 페르소나 디렉터리가
                없습니다.
              </p>
            )}
          </div>

          <DepsPicker options={deps} picked={picked} setPicked={setPicked} />

          {/* 페이지였을 때는 16줄이었다 — 다이얼로그는 세로 예산이 창이라 12줄이다(§3 크기).
              `breaks`는 위 kind select가 지금 고른 값을 따라간다(규칙 ⑤ — `TicketEditForm`과
              같은 판정) — 저장 안 한 kind 변경도 이 미리보기에 바로 걸린다. */}
          <MarkdownEditor
            name="body"
            value={body}
            onValueChange={setBody}
            label={<Label>본문</Label>}
            rows={12}
            className="font-mono"
            breaks={kindValue === "request" ? "untilHeading" : undefined}
            vault={vault}
            onPaste={att.onPaste}
          />

          {/* 실패는 이 자리에 남는다 — 닫으면 본문과 함께 사라진다(§3) */}
          {state !== dismissed && state.error && (
            <Failure title="발행하지 못했습니다" message={state.error} />
          )}
          {/* 칩 줄 · 실패 사유 줄 · 액션 행(§27). 1차 액션은 여전히 가장 오른쪽이다 */}
          <AttachmentField att={att}>
            <Button type="submit" disabled={pending || !!duedateConflictHash}>
              {pending ? "발행 중…" : "발행"}
            </Button>
          </AttachmentField>
        </form>
        <DiscardConfirm guard={guard} />
      </DialogContent>
    </Dialog>
  );
}
