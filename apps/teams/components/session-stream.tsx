"use client";

/** 진행 기록 (DESIGN.md §2-3 · §비주얼 §29 · §2-6) — 종전 세션 스트림(§2-1 · §9)이 **한 상자**로 넓어졌다.
 *
 *  상자 안에 문법이 둘이다. 세션이 흘린 **스트림 줄**(§9 — 접힌 `<Marker>` 한 줄. 색 토큰은 하나도
 *  안 쓴다)과 대화 넷이 뜨는 **말풍선**(§13 · §2-6 — 테두리 네 변 + 좌우 정렬이 역할을 가른다).
 *  **§2-6이 그 둘의 경계를 다시 그었다** — assistant `text`와 사람이 친 말(참견 · 첫 아닌 사용자
 *  프롬프트)만 말풍선이고, 나머지 사건(`tool_use`·`thinking`·`tool_result`·세션 프롬프트, `서브`
 *  포함)은 말풍선 사이에서 접힌 묶음 한 항목(`기록 n건`)이 된다 — 펼치면 그 안의 사건 줄들이
 *  §9 그대로 나온다. 넷째 축은 **그릇**이다(§29 ①): 줄·묶음 줄에는 테두리가 없고 말풍선에는 있다.
 *  순서는 `mergeProgress`가 정하고(시간순 한 줄기), `groupProgress`(둘 다 `lib/urls.ts`)가 그 줄기를
 *  말풍선·묶음으로 가른다.
 *
 *  읽기·파싱은 전부 `lib/transcript.ts`고 여기는 그리기만 한다. 접기는 네이티브 `<details>`,
 *  툴팁은 네이티브 `title`, 스크롤도 네이티브 — `message-scroller`는 이 상자에 안 들어간다
 *  (§29 ③ — `맨 아래로`가 머리 줄로 나갔다. 보드 답변 다이얼로그는 그대로 쓴다).
 *
 *  **입력칸은 하나고 모드가 셋이다**(§2-3 ③ · 아래 `ProgressForm`): 참견 / 답변 / 이어받기.
 *
 *  **엔진마다 기능 집합이 갈린다**(§4-3 · §비주얼 §23 ⑤). 입력은 `engine` prop 하나지만
 *  (서버가 `engineName`을 적용해 넘긴다) 판정은 **둘**이다 — `engineCan("stream", …)`과
 *  `engineCan("interject", …)`(`lib/urls.ts`. codex는 둘 다 안 되고 grok은 앞만 된다).
 *  없는 쪽은 상자 자리에 `<EmptyState>`, 폼 자리에 비활성 + 사유 한 줄이다.
 *  **진입점을 지우지 않는다** — 조용히 사라지면 사람은 고장으로 읽는다. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTrackedRouter } from "@/lib/route-pending";
import {
  ArrowDown,
  ChevronRight,
  CircleCheck,
  CirclePlay,
  Copy,
  FilePlus2,
  Send,
  Square,
  SquareCheck,
  SquareMinus,
  SquareX,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  refreshRefs,
  sendFollowup,
  sendInterject,
  tailSession,
} from "@/app/(app)/p/[project]/tickets/[hash]/actions";
import {
  AttachmentButton,
  AttachmentChips,
  AttachmentProblems,
  useAttachments,
} from "@/components/attachment-field";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import type { RefIndex } from "@/lib/markdown-refs";
import type { Vault } from "@/lib/markdown-wikilinks";
import { AnswerForm } from "@/components/ticket-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { useKeymap } from "@/components/keymap-provider";
import { useLocale, useT } from "@/components/language-provider";
import { t as translate } from "@/lib/i18n";
import { formatCombo, matchCombo } from "@/lib/keymap";
import type { FollowupReason } from "@/lib/followup";
import type { InterjectReason } from "@/lib/interject";
// 스레드를 엮는 쪽은 서버(`lib/queue.ts threadOf`)다 — 여기 오는 건 타입뿐이라 `node:*`를 안 끈다
import type { OptionGroup, PlanItem, PlanProgress, ThreadItem } from "@/lib/queue";
import type { StreamEvent } from "@/lib/transcript";
import {
  engineCan,
  expandable,
  formatElapsed,
  type GroupedItem,
  groupProgress,
  interjectMode,
  isPlanEdgeSegment,
  matchesStreamFilter,
  mergeProgress,
  NO_QUESTION_SECTION_NOTICE,
  pairTool,
  planBlocks,
  type ProgressFilterKind,
  progressMarkerText,
  relativeElapsed,
  toolChipCounts,
  type InterjectMode,
} from "@/lib/urls";
import { cn } from "@/lib/utils";

/** 워커 스트림 다이얼로그 툴바의 필터 넷(§2-15 ⑥ 표) — 순서 · i18n 키가 이 배열 하나에 있다. */
const STREAM_FILTERS: { kind: ProgressFilterKind; labelKey: string }[] = [
  { kind: "talk", labelKey: "progress.stream.filterTalk" },
  { kind: "tool", labelKey: "progress.stream.filterTool" },
  { kind: "thinking", labelKey: "progress.stream.filterThinking" },
  { kind: "prompt", labelKey: "progress.stream.filterPrompt" },
];

const STREAM_FILTER_DEFAULT: Record<ProgressFilterKind, boolean> = {
  talk: true,
  tool: true,
  thinking: true,
  prompt: true,
};

/** 레코드의 `timestamp`는 UTC다 — **로컬 시간으로 렌더한다**(§2-1: `13:55:10Z` = KST `22:55:10`).
 *  `toLocaleTimeString`을 쓰지 않는 이유: 로케일에 따라 `오후 10:55:10`이 나온다. 8자 고정이라
 *  열 정렬을 버린 뒤에도 시각만은 줄마다 세로로 맞는다(§9). */
function localTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 바닥에 붙어 있나. 줄 1.5개(32px) 안이면 붙은 것으로 본다(§9 자동 스크롤). */
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 32;

/** 워커 다이얼로그에서만 도는 줄 컨텍스트(§2-15 ⑦⑧, 티켓 `268943e7`) — `Row`·`Bundle`·
 *  `ProgressItems`가 받아 그대로 흘려보낸다. `undefined`면 종전 티켓 상세 화면과 클래스 0
 *  차이다(그 화면은 이 prop 자체를 안 넘긴다). `allEvents`는 **거르지 않은** 누적 배열이다 —
 *  검색·필터로 짝이 숨어도 소요·결과 절은 그대로 떠야 한다(§2-15 ③). */
type WorkerRowCtx = {
  baseTs: string;
  allEvents: StreamEvent[];
  selectedKey: string | null;
  onSelect: (e: StreamEvent) => void;
};

export function SessionStream({
  project,
  stem,
  live: initialLive,
  engine,
  thread = [],
  plans = [],
  planProgress = null,
  answerOptions = [],
  defaultAnswer = "",
  body = "",
  stream = true,
  awaiting = false,
  answerFile,
  vault,
  refs: initialRefs,
  costChunk,
  variant,
  rev,
  startOffset = 0,
}: {
  project: string;
  stem: string;
  live: boolean; // 티켓이 `.wip`인가 — 서버가 매 폴링마다 다시 판정해 갱신한다
  /** 이 티켓을 물고 있는 워커의 **엔진 이름**(§4-3 · §비주얼 §23 ⑤). `engineName`을 **서버가**
   *  적용해 넘긴다 — `lib/workers.ts`는 `node:fs`를 타서 이 파일이 못 import한다.
   *  `null`/`undefined`는 모른다는 뜻이고(완료 티켓 리플레이) 그때는 종전 그대로 그린다. */
  engine?: string | null;
  /** 요구사항 왕복 스레드(§2-3 ②) — 서버가 `threadOf`로 엮어 넘긴다. 보드 답변 다이얼로그와
   *  **같은 함수**의 출력이다(§2-3 ⑤). 비면 상자에 스트림 줄만 있다 = 종전 §9 그대로다. */
  thread?: ThreadItem[];
  /** 진행 계획(§2-11① · §비주얼 §59) — 서버가 `planOf(ticket.body)`로 파싱해 내려준다. 빈
   *  배열(계획 절이 없는 티켓 · 워커 다이얼로그처럼 body를 안 읽는 자리)이면 이 상자는 개정
   *  전과 한 클래스도 안 갈린다(§2-11④ 계약 그대로). */
  plans?: PlanItem[];
  /** 계획 진행도(§2-11⑩ 판정 1 · §비주얼 §71 ⑥⑦) — 서버가 `planProgress(plans)`로 미리 구해
   *  내려준다(`lib/queue.ts`가 `node:fs`를 타서 이 클라이언트 컴포넌트가 직접 못 부른다).
   *  `null`이면 진행도가 없다는 뜻이라 머리 줄에 그 덩이가 안 뜬다. */
  planProgress?: PlanProgress | null;
  /** 마지막 질문 라운드의 선택 카드(결정 10) — 서버가 `lastQuestionOptions(thread)`로 미리 재
   *  `AnswerForm`에 그대로 내린다. 0개면 그 라운드에 선택지가 없다(58/100) — 카드 0장, 종전 화면. */
  answerOptions?: OptionGroup[];
  /** frontmatter `default_answer:`(결정 12 (4)) — 서버가 `defaultAnswerOf(ticket)`로 내려보낸다.
   *  `AnswerForm`의 초기 체크·입력칸으로만 쓰인다. 없으면(PM이 손으로 쓴 질문) 종전 화면 그대로다. */
  defaultAnswer?: string;
  /** 질문 절 밖의 본문(결정 14 ①, 요구 `c37fe0d3`) — 서버가 `bodyWithoutQuestions(ticket.body)`로
   *  내려보낸다. 답변 모드의 `AnswerForm`에 그대로 흘려보낸다. 없으면(계획 절이 없는 티켓처럼
   *  body를 안 읽는 자리) 그 접힘 자체가 없다. */
  body?: string;
  /** 이 상자에 **스트림 줄이 흐르는가**(§29 ② 갈림길). 서버가 트랜스크립트 파일 하나로 판정한다.
   *  참이면 `h-[32rem]` 고정 + 머리 줄(버튼이 떴다 사라질 때 안 튄다), 거짓이면 `max-h-[32rem]` +
   *  머리 줄 없음 — 흐르는 것이 없으면 고정 높이의 근거도 머리 줄의 근거도 없다.
   *  기본값이 참인 이유: 워커 다이얼로그(§4)는 병합 대상이 아니고 §9 그대로여야 한다. */
  stream?: boolean;
  /** 답변 대기인가 — 입력칸의 **답변 모드**(§2-3 ③). `.wip`에서는 절대 참이 아니다
   *  (`isAwaiting`이 `state === "open"`을 본다 — 제약 5를 구조가 지킨다). */
  awaiting?: boolean;
  /** 답변 모드가 만들 파일 이름 — `tickets/<awaiting>.done.md`. 사람이 무엇이 생기는지 보고 누른다 */
  answerFile?: string;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 서버가 한 번 읽어 내려준다. 이 컴포넌트는 폴링
   *  중에도 이 값을 다시 안 읽는다(못 — 렌더러가 이름 집합을 안 읽는다). */
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — 서버가 초기 본문·스레드를 훑어 내려준다. **폴링 중에는
   *  이 값이 갱신된다**(vault와 갈리는 자리): `tailSession`의 새 사건에 그 모양이 있으면 응답이
   *  자기 해석 결과를 같이 싣고(아래 poll effect), 이 컴포넌트가 그것을 누적해 둔다. */
  refs?: RefIndex;
  /** 토큰량 덩이(§비주얼 §63 ①④) — 서버가 `ticketCostChunk`로 미리 지어 내려준다(이 파일은
   *  `node:fs`를 못 타서 로그를 직접 못 연다). `undefined`면 그 자리에 아무것도 안 뜬다 —
   *  절이 뜨는 조건이 h2가 뜨는 조건과 같아 호출부가 이미 그 조건으로 걸러 넘긴다. */
  costChunk?: { text: string; title?: string };
  /** 갈래(§2-15 ①) — `"worker"`면 워커 스트림 다이얼로그의 모양(머리 상태 배지·소요, 도구 칩 줄,
   *  검색·필터·건수 툴바)을 입는다. `undefined`(티켓 상세)는 종전 화면과 클래스 0 차이다 —
   *  아래 검색·필터 상태도 선언은 하되 이 갈래에서만 읽는다. */
  variant?: "worker";
  /** 서버가 그린 시점의 보드 회차(`boardRevision`) — 아래 "이미 그려진 표식의 회차 갱신" 폴의
   *  기준선이다(`EarlyRefreshPolling`의 `rev` prop과 같은 값·같은 이유, 버그 `34dc2975`).
   *  없으면(워커 다이얼로그처럼 진입 시점에 이미 그려진 표식이 없는 자리) 첫 응답이 기준선이
   *  된다 — 그 창에서 갈리는 변경을 놓쳐도 애초에 갱신할 "이미 그려진" 표식이 없다. */
  rev?: number;
  /** 재활용 세션(§4-11)의 구간 시작 바이트 오프셋(§2-3 개정, 요구 `22fd4fda`) — 서버가
   *  `dispatchRound`·`nthInitOffset`으로 미리 계산해 내려준다. 기본값 0은 종전 그대로다
   *  (회차 1 · 세션이 안 붙은 자리 · 이 prop을 안 넘기는 워커 다이얼로그). */
  startOffset?: number;
}) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  // 폴링이 실어 오는 새 표식 값을 누적한다(§9 §클라이언트가 폴링하는 자리) — vault와 달리
  // 이 값은 마운트 뒤에도 자란다. 키가 같으면 최신 응답이 이긴다(상태·제목이 바뀔 수 있다).
  const [liveRefs, setLiveRefs] = useState<RefIndex>(initialRefs ?? { tickets: {}, epics: {} });
  const [live, setLive] = useState(initialLive);
  const [inbox, setInbox] = useState<boolean | null>(null); // null = 첫 폴링이 아직 안 왔다
  const [done, setDone] = useState(false); // 티켓이 `.done`인가 — 폼의 모드다(§21)
  const [detached, setDetached] = useState(false); // 바닥에서 떨어졌다 = 자동 스크롤 안 한다
  // 워커 다이얼로그 툴바(§2-15 ⑥) — 티켓 상세에서는 안 읽는 값이라 그 화면 렌더는 안 갈린다.
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState(STREAM_FILTER_DEFAULT);
  // 2단 상세(§2-15 ⑧) — 고른 사건의 key 하나가 상태다. `<details>`가 아니다: 같은 것을 두
  // 자리에 안 그린다. 티켓 상세에서는 안 읽는다(아래 `workerCtx`가 그 화면에서 `undefined`다).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // `자세히 보기`가 여는 워커 갈래 다이얼로그(§2-15 ⑮) — 티켓 상세 갈래에서만 읽는다. 워커
  // 다이얼로그(`variant === "worker"`)는 이 문을 다시 안 그린다(아래 렌더 갈래가 막는다).
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  // 진행중 계획의 창 끝(`planBlocks`의 `now`) — 렌더 본문은 `Date.now()`를 직접 못 부른다
  // (`react-hooks/purity`). 초기값은 마운트 시 한 번, 이후는 poll effect가 매 왕복마다 갱신한다.
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(startOffset);
  const box = useRef<HTMLDivElement>(null);

  // 이 워커에 이 화면이 **없을 수 있다**(§4-3 · §비주얼 §23 ⑤). 고장이 아니라 기능 집합의
  // 차이라 진입점은 그대로 두고 그 자리에서 왜 없는지를 알려 준다. 판정은 엔진 이름 하나고 모델은
  // 안 본다. **둘은 한 값이 아니다** — grok은 스트림이 되고 참견은 안 된다(§4-3 표 · §grok).
  // `=== false`인 것이 규약이다: `null`(엔진을 모르는 완료 티켓)은 종전 그대로 그린다.
  const noStream = engineCan("stream", engine ?? null) === false;
  const noInterject = engineCan("interject", engine ?? null) === false;

  // 진행중이면 2초 폴링, 완료면 1회 읽고 멈춘다(§2-1). `live`가 false로 바뀌는 순간(세션이 끝났다)
  // 그 응답을 마지막으로 폴링을 끊는다 — 완료 티켓에서 요청이 반복되지 않는 근거가 이 줄이다.
  //
  // **앞 왕복이 끝난 뒤에 다음을 예약한다**(`bcfcdda4` — 홈과 같은 고장을 같은 방법으로 막는다).
  // `setInterval`이면 왕복이 주기보다 길어지는 순간 두 `poll`이 같은 `offset.current`를 읽고
  // 서버가 같은 바이트 구간을 두 벌 주고 둘 다 `[...prev, ...r.events]`로 이어붙는다 —
  // 사건 줄이 두 벌 뜨고 key가 같아 React가 경고를 찍는다. 여기가 홈보다 조용한 이유는 주기가
  // 2초라서일 뿐이다(왕복 하나가 트랜스크립트 tail이라 큰 세션·느린 디스크면 넘길 수 있다).
  useEffect(() => {
    // 있을 수 없는 파일을 2초마다 묻지 않는다 — codex는 트랜스크립트를 아예 안 남긴다(§4-3 표).
    if (noStream) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await tailSession(project, stem, offset.current);
        if (stop) return;
        offset.current = r.offset;
        setNow(Date.now()); // 진행중 계획 창 끝을 이 왕복 시각으로 갱신한다(§now 정의부)
        if (r.events.length) setEvents((prev) => [...prev, ...r.events]);
        if (Object.keys(r.refs.tickets).length || Object.keys(r.refs.epics).length) {
          setLiveRefs((prev) => ({
            tickets: { ...prev.tickets, ...r.refs.tickets },
            epics: { ...prev.epics, ...r.refs.epics },
          }));
        }
        setInbox(r.inbox); // 참견 폼의 활성 판정(§2-2) — 서버가 매 폴링마다 fm에서 다시 읽는다
        setDone(r.done); // 폼의 모드(§21) — `.wip`이 `.done`이 되는 그 폴링에서 칸이 이어받기가 된다
        if (!r.live) {
          setLive(false);
          return; // 다음을 예약하지 않는다 = 폴링이 끊기는 자리다
        }
      } catch {
        // 이 왕복 하나만 버린다 — `setInterval`이 한 틱 실패에 안 멈추던 것과 같은 자리다.
      }
      if (!stop && initialLive) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [project, stem, initialLive, noStream]);

  // 이미 그려진 표식의 회차 갱신(DESIGN.md §아키텍처 §이른 갱신이 붙는 화면 §개정 4,
  // 요구 `de0b759d`) — 위 폴과 갈래가 다르다: 저 폴은 `noStream`(codex)이거나 세션이 끝나면
  // 멎지만, 표식의 판정 근거는 트랜스크립트가 아니라 큐라 계속 따라가야 한다(`ticketMtime`이
  // `tailSession`과 갈라진 것과 같은 이유). 보드가 이미 쓰는 `/api/revision`을 2초마다 묻고
  // **갈린 회차에만** 알고 있는 stem·P번호를 `refreshRefs`로 다시 받는다 — 안 갈리면 정수
  // 비교 하나로 끝난다(큐를 다시 안 읽는다).
  //
  // ponytail: `board-ui.tsx BoardPolling`의 회차 비교 열 몇 줄과 모양이 같지만 공유 훅으로
  // 안 뗐다 — 그 추출은 별도 티켓(`dfebf1e8`)이 `.wip`으로 이미 잡고 있는 자리라 여기서 손대면
  // 충돌한다. 화면이 여럿에서 이 값을 되풀이해 필요로 하게 되면 그때 합친다.
  const knownRefs = useRef({ tickets: [] as string[], epics: [] as string[] });
  useEffect(() => {
    knownRefs.current = { tickets: Object.keys(liveRefs.tickets), epics: Object.keys(liveRefs.epics) };
  });
  useEffect(() => {
    let stop = false;
    // 기준선은 서버가 그린 시점의 `rev`다(`rev` prop) — `EarlyRefreshPolling`과 같은 자리.
    // 없으면(위 JSDoc) 첫 응답을 기준선으로 삼는다 — 그때도 마운트~첫 왕복 사이 창이 있지만
    // 그 자리엔 애초에 "이미 그려진" 표식이 없어 놓쳐도 갱신할 것이 없다.
    let since: number | null = rev ?? null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r: { rev: number } = await fetch(
          `/api/revision?project=${encodeURIComponent(project)}`,
        ).then((res) => res.json());
        if (stop) return;
        if (since === null) {
          since = r.rev; // 기준선이 없던 자리 — 첫 응답을 기준선으로 삼는다
        } else if (r.rev !== since) {
          since = r.rev;
          const known = knownRefs.current;
          if (known.tickets.length || known.epics.length) {
            const fresh = await refreshRefs(project, known);
            if (!stop && (Object.keys(fresh.tickets).length || Object.keys(fresh.epics).length)) {
              setLiveRefs((prev) => ({
                tickets: { ...prev.tickets, ...fresh.tickets },
                epics: { ...prev.epics, ...fresh.epics },
              }));
            }
          }
        }
      } catch {
        // 이 왕복 하나만 버린다 — 위 폴들과 같은 자리.
      }
      if (!stop) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [project, rev]);

  // 붙어 있을 때만 따라간다. 첫 렌더가 맨 아래에서 시작하는 것도 이 효과다(§9) — 그 자리가
  // **병합이 노린 자리다**: 답 없는 마지막 질문이 맨 끝이라(§2-3 ②) 첫 화면이 곧 "지금 무엇을
  // 묻고 있나"이고 그 밑이 답 쓰는 칸이다.
  // `thread`도 본다 — 답이 달리면 서버가 다시 그리는데(`revalidatePath`) 말풍선이 늘 때도
  // 사건 줄이 붙을 때와 **같은 한 줄의 판정**이 받는다(§29 ③. 두 번째 자동 스크롤 구현이 없다).
  useEffect(() => {
    if (detached) return;
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events, thread, detached]);

  // `<details>`를 여는 순간 자동 스크롤을 뗀다(바닥 판정과 무관하게) — 안 떼면 방금 연 블록이
  // 뒤에 온 사건에 밀려 화면 밖으로 나간다. 닫으면 다시 바닥 판정으로 돌아간다.
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) setDetached(true);
    else if (box.current) setDetached(!atBottom(box.current));
  };

  // 워커 다이얼로그의 검색·필터(§2-15 ⑥) — **맞는 사건만 남는다**, 티켓 상세는 안 거른다
  // (`variant`가 `undefined`면 이 필터가 늘 참이라 `events`와 한 배열이다).
  const searching = variant === "worker" && query.trim() !== "";
  const visibleEvents =
    variant === "worker" ? events.filter((e) => matchesStreamFilter(e, kindFilter, query)) : events;

  // 시간순 한 줄기(§2-3 ②) — 순서 규칙은 `lib/urls.ts`의 순수 함수가 들고 있고 테스트가 고정한다.
  const merged = mergeProgress(visibleEvents, thread);
  // 말풍선인가는 `label === ""` 하나로 판정한다(assistant `text` · 참견 · 첫 아닌 사용자 프롬프트가
  // 전부 빈 label). `groupProgress`가 그 줄기를 말풍선(경계)과 그 사이 묶음으로 가른다(§2-6 ②).
  const isBubble = (e: StreamEvent) => e.label === "";
  // 말풍선의 key는 **스레드 안의 자리**다. 병합 배열의 index로 잡으면 사건이 붙을 때마다 맨 끝
  // 질문(답 없는 꼬리 · §2-3 ②)의 key가 밀려 매 폴링에 `<Markdown>`이 다시 마운트된다.
  const threadKey = new Map(thread.map((t, i) => [t, `t${i}`]));
  // 진행 표식 문구(§2-6 ③) — **파싱된 마지막 스트림 레코드** 하나가 판정한다(병합·묶음과 무관).
  const markerText = progressMarkerText(events.at(-1)?.kind);

  // 워커 다이얼로그 머리의 소요(§2-15 ④)와 칩 줄(§2-15 ⑤) — 항상 **거르지 않은 `events`**를
  // 본다(도구 칩은 묶음이 접혀 있어도 세고, 소요는 필터·검색과 무관하게 이 세션 전체를 잰다).
  const elapsedMs = events.length
    ? (live ? now : Date.parse(events[events.length - 1].ts)) - Date.parse(events[0].ts)
    : null;
  const toolChips = variant === "worker" ? toolChipCounts(events) : [];

  // 2단 상세(§2-15 ⑦⑧) — `allEvents`는 거르지 않은 `events`다(짝을 잇는 것이 검색·필터와
  // 무관해야 한다, 위 ④⑤ 주석과 같은 이유). 고른 사건은 **보이는 목록**(`visibleEvents`)에서
  // 찾는다 — 검색·필터가 그 줄을 가리면 선택이 저절로 풀린다(§2-15 ⑨ 필터 0건 — 상태를 따로
  // 안 지운다, 다시 보이면 그대로 되살아난다).
  const workerCtx: WorkerRowCtx | undefined =
    variant === "worker"
      ? {
          baseTs: events[0]?.ts ?? "",
          allEvents: events,
          selectedKey,
          onSelect: (e) => setSelectedKey(e.key),
        }
      : undefined;
  const selectedEvent = workerCtx ? (visibleEvents.find((e) => e.key === selectedKey) ?? null) : null;

  // `windowEvents`·`planBlocks`(`lib/urls.ts`)는 `{ ts? }`를 직접 든 배열을 받는다 —
  // `mergeProgress`의 출력은 `{event}`/`{thread}` 래퍼라 그 자리에 `ts`를 얹어 통과시킨다.
  // 스레드 항목은 `ts`가 없으므로 `windowEvents`가 **앞 사건의 시각을 물려받는** 그 규칙
  // (§2-3 ②)을 그대로 타고 계획 창에 든다 — 여기서 새로 시각을 지어내지 않는다.
  const timedMerged = merged.map((it) => ({ it, ts: it.event?.ts }));
  // §비주얼 §59 ⑦ — 계획이 있으면 상자 안이 계획 블록 단위로 갈린다. 계획이 없으면(§2-11④
  // "계획 절이 없는 티켓") 상자 하나가 곧 "계획 밖" 블록 하나다 — 그 갈래에서 아래가 그리는 것은
  // `groupProgress(merged, isBubble)`을 그대로 도는 개정 전 화면과 클래스 0 차이다.
  const blocks = plans.length
    ? planBlocks(plans, timedMerged, now)
    : [{ kind: "outside" as const, events: timedMerged }];
  // 진행중 모양이 둘 이상이면 파일 순서상 마지막 하나만 진짜다(§2-11④) — 앞의 것들은 완료처럼
  // 그린다(닫힌 아코디언, `기록 n건`). 안 그러면 열린 아코디언이 둘 이상이 되어 "열린 것이
  // 진행중 하나뿐"이라는 계약(§비주얼 §59 ⑧ 수용조건 6)이 깨진다. `windowEvents`(안에서
  // `planBlocks`가 부른다)가 창을 배분할 때 쓰는 판정과 같은 한 줄이다.
  const lastDoing = plans.reduce((last, p, i) => (p.state === "doing" ? i : last), -1);
  const effectivePlans = plans.map((p, i) =>
    p.state === "doing" && i !== lastDoing ? { ...p, state: "done" as const } : p,
  );

  const form = (
    <ProgressForm
      project={project}
      stem={stem}
      live={live}
      inbox={inbox}
      done={done}
      noStream={noStream}
      noInterject={noInterject}
      engine={engine}
      awaiting={awaiting}
      answerFile={answerFile}
      answerOptions={answerOptions}
      defaultAnswer={defaultAnswer}
      body={body}
      vault={vault}
      refs={liveRefs}
    />
  );

  return (
    // `min-w-0`은 워커 다이얼로그가 가로로 새는 것을 막는다(§비주얼 §21 · 요구 `fff27e81`).
    // `DialogContent`가 `grid`라 이 절은 그리드 아이템이고 `min-width: auto` = 내용의 min-content다.
    // 펼친 `<pre>`의 `break-words`는 min-content를 안 줄여서(줄이는 건 `break-all`) 긴 한 줄이
    // 그대로 열 폭이 된다 — 실측 768px 다이얼로그의 `scrollWidth`가 13125px이었다.
    <div
      className={cn(
        "min-w-0 space-y-2",
        // §비주얼 §64 ② — `min-h-0`이 사슬 전체에 걸린다: `DialogContent`(호출부가 `flex
        // flex-col overflow-hidden`으로 간다) -> 이 래퍼 -> 2단 행 -> 두 단. 한 고리라도
        // 빠지면 flex 자식이 안 줄고 참견 폼이 자랄 때 다이얼로그가 스크롤한다.
        variant === "worker" && "flex min-h-0 flex-col",
      )}
    >
      {/* 머리 줄 — `진행 기록` h2와 `맨 아래로`가 같은 행에 뜬다(§비주얼 §29 ③ P173).
          h2는 이 절이 뜨는 다섯 상태 전부에서 무조건 렌더된다(종전엔 `page.tsx`가 이 h2를
          따로 그렸다 — `<SessionStream>`이 안 뜨는 "둘 다 0" 빈 상태만 거기 남는다) — 그래서
          이 줄도 이제 조건부가 아니다(종전엔 `stream`일 때만 줄 자체가 떴다). 오른쪽 무리
          (`!live` 문구 + 버튼)만 `stream`일 때 뜬다 — 흐르는 스트림이 없으면 "지금 스트림
          상태"를 말할 것이 없다(§29 ②). `h-8` 고정은 그 무리가 떴다 사라질 때 줄이 안
          튀게 하는 것이 근거다(§18 ④ · §21). h2와 토큰량 덩이는 **왼쪽 무리**로 baseline
          묶인다(§비주얼 §63 ④ — 오른쪽 무리와 조건이 다르다: 토큰량은 `workers/logs/`가 출처라
          `stream` 여부와 무관하게 h2가 뜨면 뜬다). */}
      {variant === "worker" ? (
        // 워커 스트림 다이얼로그(§2-15 ①·④·⑤·⑥, 값 §비주얼 §64) — 종전 `flex h-8` 머리 줄을
        // 상태 배지 + 소요로, 그 아래 도구 칩 줄과 검색·필터·건수 툴바가 잇는다. **`noStream`이면
        // 이 겹이 전부 안 뜬다**(§2-15 ⑨ 에러 행) — 아래 `<EmptyState>` 하나가 그 자리를 대신한다.
        !noStream && (
          <div className="space-y-2">
            <div className="flex h-8 items-center gap-2">
              <Badge variant="outline">
                {live ? (
                  <CirclePlay aria-hidden className="size-3.5" />
                ) : (
                  <CircleCheck aria-hidden className="size-3.5" />
                )}
                {t(live ? "progress.stream.stateLive" : "progress.stream.stateDone")}
              </Badge>
              {elapsedMs !== null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("progress.stream.elapsed")} {formatElapsed(elapsedMs)}
                </span>
              )}
            </div>
            {toolChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("progress.stream.tools")}</span>
                {toolChips.map(([label, n]) => (
                  <Badge key={label} variant="secondary">
                    <span className="font-mono">{label}</span>
                    <span className="tabular-nums">{n}</span>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex h-8 flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("progress.stream.searchPlaceholder")}
                className="w-64"
              />
              <span className="text-xs text-muted-foreground">{t("progress.stream.filter")}</span>
              {STREAM_FILTERS.map((f) => {
                const on = kindFilter[f.kind];
                return (
                  <button
                    key={f.kind}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setKindFilter((prev) => ({ ...prev, [f.kind]: !prev[f.kind] }))}
                  >
                    <Badge variant={on ? "secondary" : "outline"} className={on ? undefined : "text-muted-foreground"}>
                      {t(f.labelKey)}
                    </Badge>
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {t("sessionStream.recordCount.label")} {merged.length}
                {t("sessionStream.recordCount.unit")}
              </span>
              {!live && <p className="text-xs text-muted-foreground">{t("sessionStream.closedNoUpdate")}</p>}
              {detached && (
                <Button variant="ghost" size="sm" onClick={() => setDetached(false)}>
                  <ArrowDown aria-hidden className="size-3.5" />
                  {t("sessionStream.scrollToBottom")}
                </Button>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="flex h-8 items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-medium">{t("sessionStream.heading")}</h2>
            {planProgress && (
              <span className="text-xs text-muted-foreground">
                {t("progress.plan.ratioLabel")}{" "}
                <span className="font-mono">
                  {planProgress.done}/{planProgress.total}
                </span>
              </span>
            )}
            {costChunk && (
              <span className="text-xs text-muted-foreground" title={costChunk.title}>
                {costChunk.text}
              </span>
            )}
          </div>
          {/* 오른쪽 무리 — `stream`일 때만 뜨던 종전 두 항목(끝난 세션 문구 · 맨 아래로)은
              한 클래스도 안 갈린다. `자세히 보기`(§2-15 ⑮)만 조건이 넓다 — 아래 인라인 스크롤
              상자가 뜨는 조건과 같다(`stream || merged.length > 0`, 자리는 `맨 아래로` 다음). */}
          {(stream || merged.length > 0) && (
            <div className="flex items-center gap-2">
              {stream && !live && (
                <p className="text-xs text-muted-foreground">{t("sessionStream.closedNoUpdate")}</p>
              )}
              {stream && detached && (
                <Button variant="ghost" size="sm" onClick={() => setDetached(false)}>
                  <ArrowDown aria-hidden className="size-3.5" />
                  {t("sessionStream.scrollToBottom")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
                {t("progress.stream.expand")}
              </Button>
            </div>
          )}
        </div>
      )}
      {noStream && (
        /* §비주얼 §23 ⑤ 사후 — §9가 이미 세워 둔 `<EmptyState>`에 문구만 갈아 끼운다.
           `Alert`가 아니다: 사람이 할 일이 없고(원문도 다음 행동도 없다), §9가 스트림 부재를
           이미 `부재이지 고장이 아니다`로 판정했고, codex 워커에겐 이게 상시 상태라 정상
           상태에 켜진 경고가 된다(§0-2). 폴링도 안 돈다 — 빈 스트림을 돌리지 않는다.
           **문구가 엔진 이름을 알려 준다**: 이 자리에 뜨는 엔진이 codex 하나가 아니게 됐다
           (집합 밖 = 손으로 쓴 `TICKET_ENGINE`도 여기로 온다 — §4-3 개정). **"claude 엔진에서만
           됩니다"라고 세지 않는다** — `FEATURE_ENGINES.stream.engines`가 이미 claude·grok
           둘이라 그 문장이 틀렸다(신고 `3d0a5585`). 이 자리가 답할 것은 "왜 비었나"뿐이라
           집합을 세지 않는 문장으로 족하다. */
        <EmptyState
          text={`${t("sessionStream.engineIsPrefix")} ${engine}${t("sessionStream.engineIsSuffix")}`}
          action={
            <span className="text-xs text-muted-foreground">
              {engine}
              {t("sessionStream.noTranscriptSuffix")}
            </span>
          }
        />
      )}
      {/* 상자는 **그릴 것이 있을 때만** 뜬다. codex이고 스레드도 없으면 위 `<EmptyState>` 하나가
          이 자리의 전부다(종전 그대로) — 빈 상자를 하나 더 그리는 것은 소음이다(§29 ④). */}
      {(stream || merged.length > 0) &&
        (() => {
          const listContent = (
            <>
              {variant === "worker" && merged.length === 0 && events.length > 0 ? (
                // 검색·필터가 전부 걸러냈다(§2-15 ⑥·⑨) — 칩 줄·머리는 위에서 이미 그렸고 안 갈린다.
                <p className={cn(LINE, "text-xs text-muted-foreground")}>{t("progress.stream.noMatch")}</p>
              ) : (
                blocks.map((block, bi) =>
                block.kind === "outside" ? (
                  // §2-11⑨ 결정2 — 계획 목록이 있는 상자에서 맨 앞·맨 뒤 `outside`만 `배정`·
                  // `마무리` 칸이다. 사이 틈(§59 ⑦)은 표식 없이 종전대로 흐른다.
                  isPlanEdgeSegment(bi, blocks.length, plans.length > 0) ? (
                    <SegmentBlock
                      key={`o${bi}`}
                      label={t(bi === 0 ? "progress.segment.assign" : "progress.segment.wrapup")}
                      items={groupProgress(
                        block.events.map((w) => w.it),
                        isBubble,
                      )}
                      onToggle={onToggle}
                      threadKey={threadKey}
                      vault={vault}
                      refs={liveRefs}
                      forceOpen={searching}
                      ctx={workerCtx}
                    />
                  ) : (
                    <ProgressItems
                      key={`o${bi}`}
                      items={groupProgress(
                        block.events.map((w) => w.it),
                        isBubble,
                      )}
                      threadKey={threadKey}
                      onToggle={onToggle}
                      vault={vault}
                      refs={liveRefs}
                      forceOpen={searching}
                      ctx={workerCtx}
                    />
                  )
                ) : (
                  <PlanBlock
                    key={`p${block.index}`}
                    plan={effectivePlans[block.index]}
                    items={groupProgress(
                      block.events.map((w) => w.it),
                      isBubble,
                    )}
                    onToggle={onToggle}
                    threadKey={threadKey}
                    vault={vault}
                    refs={liveRefs}
                    forceOpen={searching}
                    ctx={workerCtx}
                  />
                ),
              ))}
              {/* 진행 표식(§18 ④) — **자리가 한 갈래다**(개정 요구 `c1312f3d`): 계획이 있든 없든
                  상자 안 맨 아래다. 진행중 계획 아코디언을 접어도 안 숨는다 — `<details>` 밖에
                  뜬다. 마지막 사건 다음 줄이 올 자리를 지킨다. **말풍선 아래로 안 내려간다**:
                  `.wip`인 동안 상자의 맨 끝은 항상 스트림 사건이고(답 없는 질문은 열린 티켓에만
                  있다 — §29 ③) 옛 답변은 `birth`가 지금 세션 첫 사건보다 앞이다. `<Marker>`도
                  `<details>`도 아니다: §9가 Marker 기본값을 하나도 안 덮기로 했는데 여기는
                  `text-xs`여야 한다(폴링 상태 3종이 한 종류인 채로 자리만 옮겼다). 눌러 볼 것이
                  없으니 hover도 없다. `mx-1`이 8px 점을 16px 칸(= MarkerIcon 폭) 가운데 세워
                  문구를 다른 두 줄과 같은 x=36px에 맞춘다. // ponytail: 정렬용 래퍼 대신 마진
                  4px. 점이 커지면 그때 래퍼. 문구를 같이 드는 이유는 `prefers-reduced-motion`이다
                  — 모션만으로 말하지 않는다. **문구는 마지막 레코드가 `thinking`이면 갈린다**
                  (§2-6 ③, 요구 `cbdc2cb4`) — 판정은 `progressMarkerText`(`lib/urls.ts`) 하나다. */}
              {live && (
                <div className="flex items-center gap-2 px-3 text-xs leading-6 text-muted-foreground">
                  <span
                    aria-hidden
                    className="mx-1 size-2 shrink-0 animate-wip-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                  />
                  {markerText}
                </div>
              )}
            </>
          );

          // 배경에 틴트를 깔지 않는다 — `--muted`를 깔면 접힌 줄의 `--muted-foreground`가 4.34로
          // AA 미달이고(§9 함정 1) 말풍선 실측표 7종도 이 면 위에서 잰 값이다(§29 ①).
          if (workerCtx) {
            // 워커 다이얼로그 2단(§2-15 ⑧, 값 §비주얼 §64 ①②③⑦) — 목록 단은 §9의 그 상자
            // 그대로고(`h-[32rem]`이 행으로 올라갔다), 상세 단이 오른쪽에 뜬다. `lg` 미만은
            // 세로로 접혀 상세가 목록 아래다(§64 ⑩) — 두 단이 각자 스크롤하고 이 행 자체는
            // 안 스크롤한다(§2-15 ⑧ 규칙 2 — 검색 상자가 위로 사라지지 않는다).
            return (
              <div className="flex min-h-0 flex-col space-y-2 lg:h-[32rem] lg:flex-row lg:space-y-0 lg:gap-4">
                <div
                  ref={box}
                  onScroll={(e) => setDetached(!atBottom(e.currentTarget))}
                  className="min-h-0 overflow-y-auto rounded-md border bg-background py-2 lg:h-full lg:min-w-[32rem] lg:basis-[40rem]"
                >
                  {listContent}
                </div>
                <DetailPanel
                  event={selectedEvent}
                  baseTs={workerCtx.baseTs}
                  allEvents={workerCtx.allEvents}
                  onClose={() => setSelectedKey(null)}
                />
              </div>
            );
          }
          // 512px인 이유는 머리와 바닥이 한 화면에 같이 들어와서다 — 참견 최악 840에 852까지
          // 여유가 12px이라 한 단계도 못 키운다(§29 ②). 흐르는 것이 없으면 `max-`다:
          // 답변 대기 한 건짜리 요구사항에 470px짜리 빈 상자를 그리지 않는다.
          return (
            <div
              ref={box}
              onScroll={(e) => setDetached(!atBottom(e.currentTarget))}
              className={cn(
                "overflow-y-auto rounded-md border bg-background py-2",
                stream ? "h-[32rem]" : "max-h-[32rem]",
              )}
            >
              {listContent}
            </div>
          );
        })()}

      {/* 결정 11 ⑩ — `awaiting`인데 본문에 `## 질문 n` 절이 없으면(실측 8건) 스레드 자리가
          통째로 비고 화면이 "답변 대기"라고만 적혀 무엇을 묻는지가 안 보였다. 폼은 안 감춘다 —
          아래 `ProgressForm`이 그대로 뜨고 사람은 산문으로 답을 쓸 수 있다. `<EmptyState>`를
          안 쓴다 — 1차 콘텐츠가 아니고(§9), 그 자리는 `AnswerThread`(보드 다이얼로그)와 값 하나를
          공유한다(`lib/urls.ts`). 새 색 0 — 에러가 아니라 §9 관용구 그대로 `muted-foreground`. */}
      {awaiting && thread.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">{NO_QUESTION_SECTION_NOTICE}</p>
      )}

      {/* 입력칸 — **자리가 한 갈래다**(개정 요구 `c1312f3d`): 상자 밖 · 밑, 계획이 있든 없든
          같다. 여기 한 곳에 다니까 티켓 상세와 워커 다이얼로그가 같은 폼을 그린다
          (§2-1 Q2=(a)). 항상 마운트해 두고 그릴지 말지는 컴포넌트가 스스로 판정한다 — 조건을
          밖에 두면 `live`가 내려가는 순간(2초 폴링) 실패 사유와 사람이 쓴 글이 언마운트로 같이
          증발한다(§21 예외 항). **codex에서도 자리를 지운다는 뜻이 아니다**(§비주얼 §23 ⑤):
          비활성 + 사유 한 줄로 뜬다 — 진입점을 지우면 화면은 "왜 없는지"를 말할 자리를 잃는다. */}
      {form}

      {/* `자세히 보기`가 여는 워커 갈래 다이얼로그(§2-15 ⑮) — 그릇 · 제목 · 문구가 `workers-ui.tsx`의
          그 다이얼로그와 짝이다(§비주얼 §64 흡수 표). 이 절이 받은 값 전부를 그대로 물려주고
          갈래만 `"worker"`로 얹는다 — `costChunk`는 안 넘긴다(워커 갈래의 머리가 안 그린다).
          `variant === "worker"`일 때는 안 그린다 — 이 문은 티켓 상세 갈래에만 있다. */}
      {variant !== "worker" && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-[75rem]">
            <DialogHeader>
              <DialogTitle>{t("sessionStream.heading")}</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">{stem}</DialogDescription>
            </DialogHeader>
            <SessionStream
              project={project}
              stem={stem}
              live={live}
              engine={engine}
              thread={thread}
              plans={plans}
              answerOptions={answerOptions}
              defaultAnswer={defaultAnswer}
              body={body}
              stream={stream}
              awaiting={awaiting}
              answerFile={answerFile}
              vault={vault}
              refs={liveRefs}
              variant="worker"
              rev={rev}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** 진행 기록 한 줄기(§2-3 ②)를 그리는 자리 — 계획 밖이든(§비주얼 §59 ⑦) 계획 안이든 같은
 *  세 문법(사건 · 스레드 항목 · 묶음)이다. `SessionStream`의 종전 인라인 `.map`을 그대로
 *  옮긴 것뿐이라 클래스 0줄 차이다 — 계획 아코디언 안에서도 재사용하려고 뺐다. */
function ProgressItems({
  items,
  threadKey,
  onToggle,
  vault,
  refs,
  forceOpen,
  ctx,
  flat,
}: {
  items: GroupedItem<StreamEvent, ThreadItem>[];
  threadKey: Map<ThreadItem, string>;
  onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => void;
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — `StreamBubble`·`ThreadRow` 둘 다 받는다 */
  refs?: RefIndex;
  /** 워커 다이얼로그 검색이 켜져 있는 동안 묶음을 강제로 연다(§2-15 ②) — 기본은 안 건드린다
   *  (`undefined` = 종전 그대로 손으로 펼친 것만 열린다). 티켓 상세는 이 prop을 안 넘긴다. */
  forceOpen?: boolean;
  /** 워커 다이얼로그 줄 컨텍스트(§2-15 ⑦⑧) — `Bundle`을 거쳐 `Row`까지 그대로 흘려보낸다. */
  ctx?: WorkerRowCtx;
  /** 접는 그릇(계획 · `배정` · `마무리`) 안인가(§비주얼 §59 ③-2, 안쪽 겹 개정 요구 `7b87494f`) —
   *  참이면 묶음이 겹을 한 번 더 안 접고 그 사건 줄들이 이 그릇의 직계 자식으로 그대로 흐른다.
   *  계획 밖(§59 ⑦)에서는 `undefined`로 종전(묶음 `<Bundle>`) 그대로다. */
  flat?: boolean;
}) {
  return (
    <>
      {items.map((g) => {
        if (g.kind === "event") return <StreamBubble key={g.event.key} e={g.event} refs={refs} />;
        if (g.kind === "thread")
          return <ThreadRow key={threadKey.get(g.thread)} item={g.thread} vault={vault} refs={refs} />;
        if (flat) return g.events.map((e) => <Row key={e.key} e={e} onToggle={onToggle} ctx={ctx} />);
        return (
          <Bundle
            key={g.events[0].key}
            events={g.events}
            onToggle={onToggle}
            forceOpen={forceOpen}
            ctx={ctx}
          />
        );
      })}
    </>
  );
}

/** 계획 아코디언 한 줄(DESIGN.md §비주얼 §59) — 네 상태(§2-11①)가 손잡이 유무 · 기본 열림으로
 *  여섯 갈래로 갈린다(§59 ③). 꼬리 문구 `기록 n건`은 안쪽 묶음 줄과 같은 수를 두 번 세어
 *  겹침 개정으로 죽었다(§59 ③-1) — 남는 것은 글리프 · 제목 · 손잡이 셋이다. **안쪽 겹 개정으로
 *  안쪽 묶음 `<details>`도 죽는다**(§59 ③-2, 요구 `7b87494f`) — 펼치면 그 창의 사건 줄이
 *  `<ProgressItems flat>`을 거쳐 그릇의 직계 자식으로 바로 흐른다. `<Marker>`가
 *  아니다(§59 ②) — 그 기본값 `text-sm text-muted-foreground`가 계획 제목의 밝기 · 크기를
 *  둘 다 덮는다. `group`을 안 붙인다(§59 ④ 컴파일 실측) — 붙이면 안쪽 겹(펼친 원문)의 닫힌
 *  chevron이 이 계획을 여는 순간 같이 돈다. 손잡이가 오른쪽 끝으로 가서 회전
 *  셀렉터는 자식 결합자의 마지막 자식(`svg:last-child`)을 짚는다 — 왼쪽 첫 자리는 상태
 *  글리프가 쓴다(§59 ④). */
function PlanBlock({
  plan,
  items,
  onToggle,
  threadKey,
  vault,
  refs,
  forceOpen,
  ctx,
}: {
  plan: PlanItem;
  items: GroupedItem<StreamEvent, ThreadItem>[];
  onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => void;
  threadKey: Map<ThreadItem, string>;
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — `ProgressItems`에 그대로 흘려보낸다 */
  refs?: RefIndex;
  /** 워커 다이얼로그 검색이 켜져 있는 동안 완료·취소 계획도 강제로 연다(§2-15 ⑮) —
   *  `ProgressItems`에도 그대로 흘려보내고, 이 계획 자체의 `<details open>` 판정에도 더한다. */
  forceOpen?: boolean;
  /** 워커 다이얼로그 줄 컨텍스트(§2-15 ⑦⑧) — `ProgressItems`에 그대로 흘려보낸다. */
  ctx?: WorkerRowCtx;
}) {
  const t = useT();
  const cancelled = plan.state === "cancelled";
  // 왼쪽 16px 칸이 상태를 든다(§59 ③) — 넷이 `rect 18x18 @3,3 rx=2`를 공유해 칸 전체가
  // *상태 넷인 컨트롤 하나*로 읽힌다. 잉크 사다리는 양을 그린다: 지난 것(완료·취소)은
  // `--muted-foreground`로 물러나고 남은 것(미착수)·지금 것(진행중)은 `--foreground`로 뜬다.
  const Icon = plan.state === "todo" ? Square : plan.state === "doing" ? SquareMinus : cancelled ? SquareX : SquareCheck;
  const ink = plan.state === "done" || cancelled ? "text-muted-foreground" : "text-foreground";
  const stateLabel = t(`progress.plan.${plan.state === "todo" ? "pending" : plan.state}`);
  const glyph = (
    <Icon aria-hidden className={cn("size-4 shrink-0", plan.state === "doing" ? "text-status-active" : ink)} />
  );
  // 재개정(§59 ②·⑬) — 제목 잉크·무게가 네 상태에서 한 값이다. 사다리는 위 16px 글리프가
  // 혼자 든다 — 완료·취소 제목이 기록 줄과 같은 잉크(4.73)로 처지던 것이 그 이유였다.
  const title = (
    <span className={cn("truncate text-sm font-medium text-foreground", cancelled && "line-through")} title={plan.text}>
      {plan.text}
    </span>
  );
  // 진행중은 늘 손잡이가 있다(기록 0건이어도 — §59 ③). 완료 · 취소는 기록이 있을 때만이다.
  const hasHandle = plan.state === "doing" || items.length > 0;
  if (!hasHandle) {
    // 미착수 · 완료(0건) · 취소(0건) — 그릇이 `<div>`다. 상태 글리프가 왼쪽 칸을 채워
    // 제목을 다른 갈래와 같은 x=36에 맞춘다(§9 접힌 줄이 펼칠 것 없을 때 쓰는 같은 수).
    return (
      <div className={cn(PLAN_BLOCK, LINE, "flex items-center gap-2")}>
        {glyph}
        <span className="sr-only">{stateLabel}</span>
        {title}
      </div>
    );
  }

  return (
    <details
      open={plan.state === "doing" || forceOpen || undefined}
      onToggle={onToggle}
      className={cn(PLAN_BLOCK, "open:[&>summary>svg:last-child]:rotate-90")}
    >
      {/* 제목 줄이 상자 안에서 붙는다(§59 ⑥-1, 답 `2.(a)`) — `-top-2`가 상자 `py-2`의 틈을
          지운다. hover 밑면은 `background-image`로 얹어 `bg-background` 위에 쌓이게 한다
          (아래로 흐르는 기록 줄이 안 비친다). `group`은 안 붙인다 — 붙이면 안쪽 두 겹의 닫힌
          chevron이 같이 돈다(§59 ④). */}
      <summary
        className={cn(
          LINE,
          // `z-20` — 말풍선 동작 단추(`bubble.tsx` `BubbleReactions` `absolute z-10`)보다
          // 위여야 붙은 제목 줄 위로 기록 줄의 글자·말풍선이 겹쳐 그려지지 않는다(신고 `f5203ee0`).
          "sticky -top-2 z-20 flex items-center gap-2 cursor-pointer list-none bg-background card-tint [&::-webkit-details-marker]:hidden",
        )}
      >
        {glyph}
        <span className="sr-only">{stateLabel}</span>
        {title}
        <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </summary>
      <ProgressItems
        items={items}
        threadKey={threadKey}
        onToggle={onToggle}
        vault={vault}
        refs={refs}
        forceOpen={forceOpen}
        ctx={ctx}
        flat
      />
    </details>
  );
}

/** `배정`·`마무리` — 계획 목록을 앞뒤로 감싸는 칸 둘(§비주얼 §59 ⑦-1, §2-11⑨ 결정2). 계획
 *  `<details>`와 그릇·손잡이·간격 문자열이 같다 — 갈리는 것은 왼쪽 16px 칸 하나뿐이다: 상태
 *  글리프 대신 빈 칸(계획 항목이 아니라 그 밖 구간이라 켤 상태가 없다). `sr-only`가 없다 —
 *  낱말 자신이 화면에도 낭독에도 뜨는 유일한 글자다. */
function SegmentBlock({
  label,
  items,
  onToggle,
  threadKey,
  vault,
  refs,
  forceOpen,
  ctx,
}: {
  label: string;
  items: GroupedItem<StreamEvent, ThreadItem>[];
  onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => void;
  threadKey: Map<ThreadItem, string>;
  vault?: Vault;
  refs?: RefIndex;
  forceOpen?: boolean;
  ctx?: WorkerRowCtx;
}) {
  return (
    <details open={forceOpen || undefined} onToggle={onToggle} className={cn(PLAN_BLOCK, "open:[&>summary>svg:last-child]:rotate-90")}>
      <summary
        className={cn(
          LINE,
          "sticky -top-2 z-20 flex items-center gap-2 cursor-pointer list-none bg-background card-tint [&::-webkit-details-marker]:hidden",
        )}
      >
        <span aria-hidden className="size-4 shrink-0" />
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
        <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </summary>
      <ProgressItems items={items} threadKey={threadKey} onToggle={onToggle} vault={vault} refs={refs} forceOpen={forceOpen} ctx={ctx} flat />
    </details>
  );
}

/** 질문은 산문, 답변은 말풍선(§비주얼 §9 §산문과 말풍선 · §13 §질문 쪽은 산문이다 — §2-7 ①).
 *  질문(PM)은 그릇이 없다 — `Message`·`MessageContent`·`Bubble` 셋 다 안 쓰고 헤더 + `<Markdown>`
 *  뿐이다. 답변(사람)은 §13 말풍선 계약 그대로 무수정이다.
 *
 *  `px-3`은 스트림 줄과 **같은 거터다**(§29 ① x=12 — 산문 헤더 `px-0`이 그 위에 얹혀 항목 첫
 *  글자와 나란히 뜬다). `py-2`가 §13 `gap-4`를 그대로 낸다(말풍선끼리 8+8=16 · 줄과는 8).
 *  **시각을 안 붙인다**: 질문은 자기 파일이 없어 시각이 없고, 지어내지 않기로 한 것이 §2-3 ②다 —
 *  답변에만 붙이면 한 쌍의 헤더가 서로 다른 모양이 된다. 순서는 자리가 알려 준다.
 *  hover도 펼침도 없다 — 산문·말풍선 둘 다 펼칠 것이 없다(스트림 줄의 `hover:bg-muted/50`은
 *  어포던스다). */
function ThreadRow({
  item,
  vault,
  refs,
}: {
  item: ThreadItem;
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) */
  refs?: RefIndex;
}) {
  const t = useT();
  if (item.role === "question") {
    return (
      <div className="px-3 py-2">
        {/* 헤더가 자기 본문 첫 글자와 같은 x(12)에 뜬다(§9) — `px-0`은 항목 껍데기의 `px-3`과
            겹치지 않게 하는 한 클래스다. */}
        <MessageHeader className="px-0">
          {item.heading || t("sessionStream.question")}
          {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
        </MessageHeader>
        {/* 질문은 PM이 감은 절이라 줄바꿈을 안 그린다(§10 면제 — §9와 같은 판정) */}
        <Markdown text={item.text} vault={vault} refs={refs} />
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <Message align="end">
        <MessageContent>
          {/* 헤더는 말풍선 **밖 · 위**다(§13) — 안에 넣으면 본문의 소유자가 `<Markdown>` 하나가
              아니게 되고 §10 루트의 `[&>:first-child]:mt-0`이 거짓이 된다. 놓이는 면이 `--card`가
              아니라 `--background`라 `--muted-foreground`가 4.73 / 7.63이다(§29 ① — 병합으로
              한 칸 좋아지는 유일한 자리고, 새로 잰 것이 아니라 §9 표의 1행이다) */}
          <MessageHeader>
            {item.heading || t("sessionStream.answer")}
            {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
          </MessageHeader>
          <Bubble variant="outline" align="end">
            <BubbleContent>
              {/* 답변은 사람이 친 글이라 줄바꿈을 그린다(§10 면제) */}
              <Markdown text={item.text} breaks="all" vault={vault} refs={refs} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
}

/** §비주얼 §21 실패 4종. **`reason` 코드로 갈린다** — `error` 문장을 되짚으면 문구를 한 자
 *  고치는 날 화면이 조용히 뭉친다. `other`는 §21에 항이 없는 나머지고 제목 한 줄 + 원문이다. */
const FAIL = (t: (key: string) => string): Record<InterjectReason, { title: string; next?: string }> => ({
  ENXIO: {
    title: t("sessionStream.fail.enxio.title"),
    next: t("sessionStream.fail.enxio.next"),
  },
  ENOENT: {
    title: t("sessionStream.fail.enoent.title"),
    next: t("sessionStream.fail.enoent.next"),
  },
  "not-wip": {
    title: t("sessionStream.fail.notWip.title"),
    next: t("sessionStream.fail.notWip.next"),
  },
  "no-inbox": {
    title: t("sessionStream.fail.noInbox.title"),
    next: t("sessionStream.fail.noInbox.next"),
  },
  other: { title: t("sessionStream.fail.other.title") },
});

/** 완료 모드(이어받기)의 실패 2종 — §비주얼 §21 `완료 모드` 실패 표.
 *  **`보내지 못했습니다`로 시작하지 않는다**: 두 모드의 Alert가 같은 문장이면 스크린샷 한 장으로
 *  어느 칸에서 난 실패인지 가리지 못한다. 모드 어긋남에 `새로고침`을 적는 이유는 완료 티켓의
 *  폴링이 1회에 멈춰서다(§2-1) — 화면이 스스로 모드를 고쳐 잡지 않는다. */
const FAIL_DONE = (t: (key: string) => string): Record<FollowupReason, { title: string; next?: string }> => ({
  "not-done": {
    title: t("sessionStream.failDone.notDone.title"),
    next: t("sessionStream.failDone.notDone.next"),
  },
  other: {
    title: t("sessionStream.failDone.other.title"),
    next: t("sessionStream.failDone.other.next"),
  },
});

/** 진행 기록의 입력칸 — **하나고 모드가 셋이다**(DESIGN.md §2-3 ③ · §2-2 · §비주얼 §21).
 *
 *  `.wip`이면 **참견**(도는 세션의 FIFO로 간다) · **답변 대기면 답변**(`tickets/<awaiting>.done.md`
 *  한 장이 생겨 이 티켓이 다시 큐에 뜬다) · `.done`이면 **이어받기**(새 열린 티켓 1장 + 그 상세로
 *  이동). 셋이 배타인 것은 이 병합이 발견한 사실이 아니라 이미 참이던 사실이다 — `awaiting`은
 *  열린 티켓에만 걸리고(제약 5) `.wip`과 `.done`은 서로 배타다. 종전 화면은 그 사실을 모르고
 *  못 쓰는 칸을 하나 더 그리고 있었다.
 *
 *  참견·이어받기가 갈리는 것은 이름 셋(라벨·placeholder·버튼)과 보낸 뒤뿐이고, 그릇·키(`⌘↵`)·절
 *  높이는 하나다(§21 완료 모드). **답변 모드만 그릇이 다르다** — `AnswerForm` 한 벌을 보드
 *  다이얼로그와 같이 쓴다(§2-3 ③ "답변 폼은 두 자리가 쓰는 한 벌이다").
 *
 *  **낙관적 에코를 그리지 않는다.** 보낸 문장은 다음 폴링(2초)의 `queue-operation` `enqueue` 줄로
 *  위 상자에 돌아온다(§2-2 "도착 확인은 스트림이 한다"). 여기서 말풍선을 먼저 그리면 엔진이 못
 *  받았을 때 화면이 거짓말을 한다 — 그래서 이 컴포넌트는 `events`를 만들지 않는다.
 *  완료 모드에는 그 자리가 아예 없다: 끝난 트랜스크립트는 더 자라지 않고 **확인은 내비게이션**이다.
 *
 *  상태도 `inbox`도 **서버가 매번 다시 판정한다**(`lib/interject.ts` · `lib/followup.ts`).
 *  여기 있는 `live`·`inbox`·`done`은 **그릴 것을 고르는 데만** 쓰고 보내도 되는지의 근거로 쓰지
 *  않는다 — 2초 사이에 세션이 끝난다. 모드가 어긋나면 서버가 조용히 바꾸지 않고 실패 + 사유다. */
function ProgressForm({
  project,
  stem,
  live,
  inbox,
  done,
  noStream,
  noInterject,
  engine,
  awaiting,
  answerFile,
  answerOptions,
  defaultAnswer,
  body = "",
  vault,
  refs,
}: {
  project: string;
  stem: string;
  live: boolean;
  inbox: boolean | null;
  done: boolean;
  /** 물고 있는 워커에 세션 스트림이 없다 = **폴링이 안 돈다**(§4-3 표 2행). 아래 `polled`가
   *  이 값을 보는 이유가 그것이고, 참견 판정과는 다른 값이다 — grok에서 둘이 갈린다 */
  noStream: boolean;
  /** 물고 있는 워커에 참견이 없다 — 입구가 생길 일이 없는 워커다(§4-3 · §비주얼 §23 ⑤) */
  noInterject: boolean;
  /** 비활성 사유가 부르는 엔진 이름. `noInterject`가 참일 때만 쓴다 */
  engine?: string | null;
  awaiting: boolean;
  /** 마지막 질문 라운드의 선택 카드(결정 10) — `answerFile`처럼 답변 모드에서만 쓰인다 */
  answerOptions: OptionGroup[];
  /** frontmatter `default_answer:`(결정 12 (4)) — `answerOptions`처럼 답변 모드에서만 쓰인다 */
  defaultAnswer?: string;
  answerFile?: string;
  /** 질문 절 밖의 본문(결정 14 ①) — `answerOptions`처럼 답변 모드에서만 쓰인다 */
  body?: string;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 답변 모드의 `AnswerForm`에 그대로 흘려보낸다 */
  vault?: Vault;
  /** 산문 속 해시-P번호 표식의 값(§9) — 답변 모드의 `AnswerForm`에 그대로 흘려보낸다 */
  refs?: RefIndex;
}) {
  const t = useT();
  const router = useTrackedRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // 사유 코드가 아니라 **고른 문구 + 그때의 모드**를 든다: 두 모드의 표가 다르고
  // (`InterjectReason` / `FollowupReason`), 실패는 그것이 난 모드의 것이다.
  const [fail, setFail] = useState<{
    mode: InterjectMode;
    title: string;
    next?: string;
    detail: string;
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // 첨부(§8) — **두 모드가 한 벌을 쓴다.** 나가는 곳만 갈린다(FIFO 한 줄 / 새 티켓 본문)이고
  // 조립은 서버의 `withAttachments` 하나다(§8 §표기는 하나다).
  const att = useAttachments(project);
  // 티켓 stem을 id로 쓰지 않는다 — 파일명에서 온 값이라 공백이 섞이면 `aria-describedby`가 끊긴다.
  const offId = useId();
  // 보내는 키와 손잡이의 `<kbd>`가 **같은 값 하나**에서 나온다(§0-6: 표기를 하드코딩하지 않는다).
  const sendCombo = useKeymap().bindings["interject.send"];

  // 어느 폼을 그리나 — 판정은 `lib/urls.ts` 하나다(§21 표 4행 + 예외 둘. 그 파일에 검증이 있다).
  // **스트림이 없는 워커는 `polled`가 이미 참이다**: 폴링을 아예 안 도는데(위 효과) `inbox`가
  // `null`인 채로 두면 `첫 폴링 전`으로 읽혀 폼이 통째로 사라진다 — §23이 지우지 말라고 한 그
  // 자리다. 서버에 물을 것이 없는 것이지 아직 안 물어본 것이 아니다. **참견 판정이 아니라
  // 스트림 판정을 보는 자리다**: grok은 폴링이 돌아 `inbox`가 제때 차므로 claude와 같은 길이다.
  const mode = interjectMode({
    polled: noStream || inbox !== null,
    live,
    done,
    failed: !!fail,
    awaiting,
  });
  if (!mode) return null;

  // 답변 모드 — 그릇이 갈리는 유일한 모드다(§2-3 ③). `answerFile`이 없으면 그릴 것이 없다
  // (워커 다이얼로그가 그 값을 안 넘긴다. 거기엔 답변 대기 티켓이 애초에 없다 — `.wip`만 물린다).
  // **문구 한 줄이 폼 위에 남는다**: 종전 답변 카드 머리(`Card`)가 없어졌고, 그 문장은 이 버튼이
  // 무엇을 하는지를 알려 준다(§2-3 ③). 보드 다이얼로그에서는 `DialogDescription`이 같은 말을 하므로
  // 폼 안에 넣지 않는다 — 넣으면 거기서 두 번 뜬다.
  if (mode === "answer") {
    return answerFile ? (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("sessionStream.answerHint")}
        </p>
        <AnswerForm
          project={project}
          hash={stem}
          answerFile={answerFile}
          options={answerOptions}
          defaultAnswer={defaultAnswer}
          body={body}
          vault={vault}
          refs={refs}
        />
      </div>
    ) : null;
  }

  // **모드가 갈리면 쓴 글은 남기고 실패 Alert만 지운다**(§21). `ENXIO`의 다음 행동이 `위 글을
  // 복사해 새 티켓으로 지시하세요`인데 그 순간 같은 칸이 바로 그 일을 하는 칸이 된다 — 글을
  // 지우면 사람이 방금 읽은 안내를 따를 수단을 화면이 빼앗는다. Alert는 사유가 더 이상 참이
  // 아니라 사라진다(세션이 끝난 것이 이제 실패가 아니다). 지우는 효과를 걸지 않고 **실패에
  // 모드를 달아** 그리는 자리에서 거른다 — 상태를 고치는 효과는 렌더를 한 번 더 돌린다.
  const shown = fail?.mode === mode ? fail : null;

  const followup = mode === "followup";
  const closed = !followup && !live; // 세션이 끝났고 실패가 남아 있다 = 읽기 전용 잔해
  // 완료 모드는 `inbox`를 아예 안 본다 — 보내는 곳이 FIFO가 아니라 새 파일이다(§21).
  // **`live`인 동안만이다.** `!inbox`만 보면 회수된 티켓에서도 켜진다 — 엔진의 `clear`가
  // `session_id`와 함께 `inbox`도 비우므로(`tickets.py`) `closed`와 같은 폴링에 동시에 뜨고,
  // 남은 폼의 입력칸이 `disabled`가 돼 §21이 `readOnly`로 지키려던 선택·복사를 잃는다. §21이
  // 그릇의 흐림을 의도한 자리는 하나뿐이고, 그 화면의 사유는 실패 Alert가 알려 준다(사유 한 줄도
  // 같이 안 뜬다).
  // 입구가 없다 = 그릇 통째로 비활성(§21). 참견이 없는 엔진은 **입구가 생길 일이 없는** 워커라
  // 같은 자리다(`tick.sh:263-270`이 `--input-format stream-json` 인접에서만 FIFO를 판다 — §4-3).
  // `inbox`를 안 보고 따로 적는 이유: 사유 문구가 갈리고, 그 판정이 폴링에 안 걸려야 한다.
  const off = !followup && live && (noInterject || !inbox);
  const empty = !text.trim();

  const send = async () => {
    if (sending || empty || off || closed) return;
    setSending(true);
    setSent(false);
    setFail(null);
    if (followup) {
      const r = await sendFollowup(project, stem, text, att.paths);
      if (r.ok) {
        // 성공에는 확인이 끼지 않는다 — **내비게이션이 확인이다**(§21 · §3 발행과 같은 길).
        // `sending`을 안 내리는 것이 이동 전 두 번째 클릭을 막는 유일한 관문이다(티켓 2장).
        // 포커스도 되돌리지 않는다 — 이 폼은 곧 언마운트된다(새 티켓은 열림이라 스트림 절이 없다).
        router.push(`/p/${project}/tickets/${encodeURIComponent(r.stem)}`);
        return;
      }
      setSending(false);
      setFail({ mode, ...FAIL_DONE(t)[r.reason], detail: r.detail });
    } else {
      const r = await sendInterject(project, stem, text, att.paths);
      setSending(false);
      if (r.ok) {
        setText("");
        att.reset(); // 칩은 글과 **같은 타이밍**에 빈다. 올라간 파일은 안 지운다(§8 수명)
        setSent(true);
      } else {
        setFail({ mode, ...FAIL(t)[r.reason], detail: r.detail });
      }
    }
    input.current?.focus(); // 참견은 연달아 하게 되고, 실패는 두 모드 다 이 칸으로 돌아온다(§21)
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          ref={input}
          // 이름 셋이 보내기 **전에** 두 모드를 가른다(§21 완료 모드) — `참견`·`보내기`만으로는
          // 파일 한 장이 생긴다는 것을 감춘다.
          aria-label={followup ? t("sessionStream.followupAria") : t("sessionStream.interjectAria")}
          aria-describedby={off ? offId : undefined}
          placeholder={
            followup ? t("sessionStream.followupPlaceholder") : t("sessionStream.interjectPlaceholder")
          }
          className="max-h-32"
          value={text}
          // 세션이 끝난 뒤 남은 폼은 `readOnly`다. `disabled`면 사람이 쓴 글을 선택·복사할 수 없다
          // — 그 글을 새 티켓에 옮기는 것이 실패 4종의 `다음 행동`이다(§21).
          readOnly={closed}
          disabled={off}
          // 붙여넣기도 **못 보내는 칸에서는 안 먹는다**(§8) — 손잡이와 같은 판정 하나다.
          onPaste={off || closed ? undefined : att.onPaste}
          onChange={(e) => {
            setText(e.target.value);
            setSent(false); // `보냈습니다`는 다음 타이핑에 사라진다(§21)
          }}
          // `⌘↵`로 보낸다. `Enter`는 줄바꿈이다 — 여러 줄 입력칸의 기본을 뺏지 않는다(§21).
          // 맥이 아닌 데서도 되게 `ctrlKey`를 같이 받는 것은 이제 `matchCombo`의 `Mod`가 한다.
          //
          // **글 쓰는 중 가드(`useHotkey`)를 안 받는다.** 이건 window가 아니라 이 textarea의
          // 핸들러고, 애초에 입력칸 안에서 쓰라고 있는 키다(§0-6 배선). 대신 `matchCombo`가
          // `isComposing`을 막아 준다 — 받침을 확정하는 `Enter`에 글이 날아가지 않는다.
          onKeyDown={(e) => {
            if (matchCombo(e.nativeEvent, sendCombo)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {/* 칩 줄 — 손잡이 addon **위**다(§27 세로 순서 `입력칸 → 칩 줄 → 손잡이 줄`).
            끝난 세션(`closed`)에도 남긴다: 무엇을 붙였는지가 사라지면 §21이 남긴 글로
            새 티켓을 쓸 때 그 목록을 다시 못 본다. */}
        <AttachmentChips att={att} />
        {!closed && (
          <InputGroupAddon align="block-end">
            {/* 손잡이는 줄의 맨 왼쪽 — `ml-auto` 앞이 2차 액션의 자리다(§27 · §4-3).
                **`inbox`가 없으면 같이 잠근다**: 못 보내는 칸에 파일만 올라가면 그 파일은
                아무 데도 안 간다. */}
            <AttachmentButton att={att} locked={off} />
            {/* 같은 슬롯을 두 모드가 나눠 쓴다(§21): `live`는 성공 뒤 한 번, 완료 모드는 **상시**
                무엇이 몇 장 생기는지. 완료 모드에는 성공 문구가 없어서(페이지가 이동한다)
                비어 있는 자리를 쓰는 것이고 요소가 늘지 않는다 — 절 높이 692가 그대로다. */}
            {followup ? (
              <span className="min-w-0 truncate text-xs">{t("sessionStream.followupHint")}</span>
            ) : (
              sent && <span className="min-w-0 truncate text-xs">{t("sessionStream.sentHint")}</span>
            )}
            {/* `bg-muted`를 깔지 않는다 — `--muted-foreground`가 라이트 4.34로 AA 미달이다(§21 · §1
                함정). 반경은 addon이 이미 준다(`[&>kbd]:rounded-…`). `ml-auto`가 여기 걸려서
                1차 버튼이 줄의 가장 오른쪽이다(§4-3). */}
            <kbd className="ml-auto border px-1 font-mono text-xs text-muted-foreground">
              {formatCombo(sendCombo)}
            </kbd>
            {/* **`disabled`가 아니라 `aria-disabled`다.** `InputGroup`의 흐림은 `:has(:disabled)`라
                (빌드된 CSS 실측) 버튼 하나만 잠가도 **그릇이 통째로** 흐려진다 — 빈 입력이 기본
                상태이므로 placeholder가 §21이 금지한 1.85 대비로 상시 떨어진다. 그릇을 흐리는 것은
                입구가 없을 때(입력칸 `disabled`)로 남기고, 못 누른다는 사실은 이 버튼만 알려 준다.
                누를 수 없음의 실효는 `send()`의 첫 줄이 지킨다(클릭·⌘↵ 양쪽). */}
            <InputGroupButton
              type="submit"
              variant="default"
              size="xs"
              aria-disabled={off || sending || empty}
              className="aria-disabled:opacity-50"
            >
              {/* `FilePlus2`는 프로토콜의 `새 파일`이 이미 쓰는 것이라 이 앱에서 "파일 한 장이
                  생긴다"를 이미 뜻한다(§21 — 셋째 아이콘을 고르면 뜻을 처음부터 가르쳐야 한다).
                  `발행`도 새 동사가 아니다: 보드의 `티켓 발행`(§3)이 그 낱말의 임자다. */}
              {followup ? <FilePlus2 aria-hidden /> : <Send aria-hidden />}
              {followup
                ? sending
                  ? t("sessionStream.publishing")
                  : t("sessionStream.publishAction")
                : sending
                  ? t("sessionStream.sending")
                  : t("sessionStream.sendAction")}
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      {/* 첨부 실패 사유(§27) — 그룹 **밖**이고 `<Failure>` Alert가 아니다. 아래 제출 실패
          Alert와 한 폼에 겹쳐 설 수 있어서 한 줄이다(겹쳐도 76+16이 아니라 16이다). */}
      <AttachmentProblems att={att} />

      {/* 비활성 사유는 그룹 **밖**이다 — 안에 넣으면 `has-disabled:opacity-50`이 겹쳐 대비 1.85다
          (§21 실측). 비활성 컨트롤은 WCAG 예외지만 **왜 못 쓰는지 설명하는 문장은 예외가 아니다**. */}
      {off && (
        <p id={offId} className="text-xs text-muted-foreground">
          {/* 참견이 없는 엔진은 사유가 티켓이 아니라 **엔진**이다(§4-3 · §비주얼 §23 ⑤).
              `inbox가 없습니다`도 참이지만 그건 결과고, 사람이 고칠 수 있는 것으로 읽힌다 —
              이 워커는 그런 워커다. **엔진 이름을 알려 준다**: 이 자리에 뜨는 엔진이 codex
              하나가 아니게 됐고(grok도 온다), 이름이 없으면 사람이 어느 쪽인지 모른다. */}
          {noInterject
            ? `${t("sessionStream.engineIsPrefix")} ${engine}${t("sessionStream.claudeOnlySuffix")}`
            : t("sessionStream.noInboxStatic")}
        </p>
      )}

      {/* 실패는 사유를 삼키지 않는다(§6 2번). 제목·mono 원문·**다음 행동** 3요소이고, 다음 행동이
          `한 번 더 보내기`(ENOENT)와 `새 티켓으로 지시`(나머지)로 갈리는 것이 넷을 안 뭉치는 이유다.
          완료 모드도 같은 그릇·같은 자리이고 문구만 `FAIL_DONE`에서 온다(§21 완료 모드 실패 표). */}
      {shown && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{shown.title}</AlertTitle>
          <AlertDescription>
            <span className="block font-mono text-xs break-all">{shown.detail}</span>
            {shown.next && <span className="block text-xs">{shown.next}</span>}
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}

/** 접힌 줄·묶음 줄이 같이 쓰는 거터(§9 · §2-6 ②) — `Row`·`Bundle` 공용. */
const LINE = "px-3 leading-6 scroll-mt-6";

/** 계획 묶음 그릇 — 8은 묶음 **밖**에만 뜬다(DESIGN.md §비주얼 §59 ⑤, 재개정). 형제끼리 병합돼
 *  계획 <-> 계획도 8이고, `first`/`last`가 상자 `py-2`와 겹치는 것을 막는다. */
const PLAN_BLOCK = "my-2 first:mt-0 last:mb-0";

/** Edit diff 렌더 — `Row`(펼친 원문)와 `DetailPanel`(입력 절)이 공유한다(§9 §펼친 Edit — 그릇만
 *  갈린다, 값은 §2-15 ⑧ "diff가 있으면 §9 계약 그대로"). 색 0 — 갈리는 것은 머리 2칸 `- `/`+ `/`
 *  `  ` 하나다. 줄당 `<div>` + 걸이 들여쓰기(`pl-[2ch] -indent-[2ch]`)라 줄바꿈된 이음줄이 부호
 *  열을 안 밟는다 — 색이 없어서 그 열의 무결성이 이 블록의 전부다. */
function diffOrBody(e: StreamEvent) {
  return e.diff
    ? e.diff.map((l, i) => (
        <div key={i} className="pl-[2ch] -indent-[2ch]">
          {l.kind + " " + l.text}
        </div>
      ))
    : e.body;
}

/** 접힌 줄 — `<Marker>` 한 줄. `tool_use`·`thinking`·`tool_result`·세션 프롬프트가 전부 이 모양이다.
 *  고정폭 4열은 (a)가 버렸다(요구 `e3020347`) — 시각(mono 8자)만 세로로 맞고 도구명부터 줄마다
 *  어긋난다. 도구명에 `max-w-[7rem]`만 남은 것이 종전 고정폭이 묶던 흔들림 범위를 대신한다.
 *  Marker 기본값(`flex gap-2 items-center text-sm text-muted-foreground w-full`)은 하나도 안 덮는다. */
function Row({
  e,
  onToggle,
  ctx,
}: {
  e: StreamEvent;
  onToggle: (ev: React.SyntheticEvent<HTMLDetailsElement>) => void;
  /** 워커 다이얼로그(§2-15 ⑦⑧, 티켓 `268943e7`)에서만 뜬다 — 상대 시각·소요 칸·선택 상태를
   *  준다. `undefined`면 아래가 전부 종전 티켓 상세 화면(`<details>` 인라인 펼침)이다. */
  ctx?: WorkerRowCtx;
}) {
  const t = useT();
  // 오류 표식(§비주얼 §60) — `MarkerContent` 첫머리 텍스트 마커. `서브`가 출처, `오류`가 성질이라
  // 순서가 `서브 · 오류 · <요약>`이다(§60 ⑤). 표식 낱말만 `text-foreground`, 나머지는 Marker
  // 기본값 `text-muted-foreground` 그대로 — 색이 아니라 밝기로 갈린다(§60 ②).
  const errorLabel = e.error ? t("progress.stream.error") : null;
  const summary = [e.sidechain ? t("sessionStream.sub") : null, errorLabel, e.summary]
    .filter((s) => s !== null)
    .join(" · ");
  // 워커 다이얼로그의 소요 칸(§2-15 ⑦) — `tool_use` 줄에만, 짝이 없으면 칸이 빈다.
  const elapsedMs = ctx && e.kind === "tool_use" ? pairTool(e, ctx.allEvents).elapsedMs : null;
  // 시각·도구명·소요는 `shrink-0`이라, 줄이 넘칠 때 줄어드는 칸은 `MarkerContent` 하나다
  // (그 `min-w-0`이 종전 `minmax(0,1fr)`가 하던 일이다).
  const cells = (
    <>
      {ctx ? (
        // 상대 시각(§2-15 ⑦) — 절대 시각은 잃지 않는다: `title`이 종전 `HH:MM:SS`를 든다.
        <span className="shrink-0 font-mono tabular-nums" title={localTime(e.ts)}>
          {relativeElapsed(e.ts, ctx.baseTs)}
        </span>
      ) : (
        <span className="shrink-0 font-mono tabular-nums">{localTime(e.ts)}</span>
      )}
      {/* mono면 엔진이 실제로 부른 이름이고, sans면 우리가 붙인 이름이다(§9).
          판정은 `kind` 하나다 — 화면이 도구 목록을 다시 갖지 않는다. */}
      <span
        className={cn("max-w-[7rem] shrink-0 truncate", e.kind === "tool_use" && "font-mono")}
        title={e.label}
      >
        {e.label}
      </span>
      <MarkerContent className={cn("truncate", e.summaryMono && "font-mono")} title={summary}>
        {errorLabel ? (
          <>
            {e.sidechain ? `${t("sessionStream.sub")} · ` : null}
            <span className="text-foreground">{errorLabel}</span>
            {` · ${e.summary}`}
          </>
        ) : (
          summary
        )}
      </MarkerContent>
      {ctx && e.kind === "tool_use" && (
        <span className="ml-auto shrink-0 font-mono tabular-nums">
          {elapsedMs !== null ? formatElapsed(elapsedMs) : null}
        </span>
      )}
    </>
  );

  if (ctx) {
    // 워커 다이얼로그 — 인라인 펼침이 없다(§2-15 ⑧: "왼쪽 목록의 그 자리 아래 펼침이
    // 없어진다"). 줄 하나가 그대로 고를 수 있는 `<button>`이고, `MarkerIcon`은 늘 비어
    // 있다(펼칠 것이 없으니 회전할 chevron도 없다 — 열의 정렬만 지킨다).
    return (
      <Marker
        render={<button type="button" />}
        aria-current={ctx.selectedKey === e.key ? "true" : undefined}
        onClick={() => ctx.onSelect(e)}
        className={cn(
          LINE,
          "cursor-pointer outline-none hover:bg-muted/50 hover:text-foreground aria-current:bg-muted aria-current:font-medium aria-current:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        )}
      >
        <MarkerIcon />
        {cells}
      </Marker>
    );
  }

  // 펼칠 것이 없으면 어포던스도 없다(`expandable` — 판정은 `lib/urls.ts` 하나다).
  // 여기 오는 건 `display: "omitted"`라 본문이 빈 `thinking`이다(실측 75/75, 플래그 없는 세션).
  // 줄 자체는 그대로 흘리고 — 빼면 생각하는 동안 화면이 조용해진다 — `MarkerIcon` 칸만 §9대로
  // **비워서 유지**한다.
  if (!expandable(e)) {
    return (
      <Marker className={LINE}>
        <MarkerIcon />
        {cells}
      </Marker>
    );
  }

  return (
    <details
      className="open:[&>summary>span>svg:first-child]:rotate-90"
      onToggle={onToggle}
    >
      {/* hover에서 글자를 같이 올리는 건 대비 때문이다 — `--muted-foreground`가 `bg-muted/50`
          위에서 라이트 4.54로 바닥에 붙는다(§9 함정 2). `text-foreground`면 18.97이다.
          색이 이제 Marker 루트의 기본 클래스라 hover도 같은 요소에 붙는다(변종이 이긴다). */}
      <Marker
        render={<summary />}
        className={cn(
          LINE,
          "cursor-pointer list-none hover:bg-muted/50 hover:text-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        {/* `MarkerIcon`은 `aria-hidden`이라 의미를 나르는 그림을 넣지 않는다 — 순수 어포던스뿐이다.
            `size-4`는 Marker 기본 규칙이 준다(§9: 덮지 않는다). 회전은 `<details>`의
            `open:[&>summary>span>svg:first-child]`가 든다 — `group`류 클래스를 후손 전체(`*`)에
            물리면 이 줄을 묶은 `<Bundle>`을 열 때 닫힌 이 chevron까지 같이 돈다(자식 결합자
            셋은 `summary`의 첫 `span`(`MarkerIcon`) 안 svg에만 닿는다). §54와 홉이 하나 더
            도는 것은 여기 `MarkerIcon`이 svg를 span으로 한 겹 싸서다. */}
        <MarkerIcon>
          <ChevronRight />
        </MarkerIcon>
        {cells}
      </Marker>
      {/* 펼친 원문. `text-foreground`가 아니면 `--muted` 위에서 4.34로 미달한다(§9에서 가장
          밟기 쉬운 함정). `max-h-96`은 `tool_result` 실측 38173바이트가 컨테이너를 삼키는 걸 막는다.
          그릇(`<pre>` 클래스)은 Edit diff에서도 한 줄도 안 바뀐다(§9) — 폴백이 같은 상자에
          착지해야 사고로 안 보인다. */}
      <div className="px-3">
        {/* `replace_all` 한 줄 — `<pre>` **밖**, 그릇 바로 위(§9). 안에 넣으면 `--muted` 위에서
            `text-muted-foreground`가 4.34로 미달해 `text-foreground`가 돼야 하고, 그러면 diff
            줄과 같은 잉크라 내용으로 읽힌다. */}
        {e.replaceAll && (
          <p className="ml-6 text-xs text-muted-foreground">
            <span className="font-mono">replace_all</span> · {t("sessionStream.matchAllSuffix")}
          </p>
        )}
        <pre className="mt-1 mb-2 ml-6 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
          {diffOrBody(e)}
        </pre>
      </div>
    </details>
  );
}

/** 묶음 접힌 줄 — 말풍선 사이 연속 사건은 한 항목이다(§2-6 ② · §비주얼 §9 §묶음 접힌 줄).
 *  접힌 줄과 **같은 그릇**(`<details>` + `<Marker render={<summary />}>`)이라 이 겹은 그릇을 안
 *  늘린다. 시각·도구명 슬롯은 없다 — 묶음 안에 도구가 여럿이라 하나를 골라 세우면 거짓말이다.
 *  `기록 n건`이 그 자리에 뜬다(sans + `tabular-nums`, `truncate`도 `title`도 없다 — 고정 문구라
 *  안 잘린다). 펼치면 이 절의 사건 줄들이 **그대로** 나온다 — 들여쓰기를 안 늘린다.
 *
 *  **상자의 최상위 자식으로 흐르는 구간에만 선다**(§59 ③-2, 안쪽 겹 개정) — 접는 그릇(계획 ·
 *  `배정` · `마무리`) 안에서는 `ProgressItems`가 `flat`을 받아 이 겹을 안 부르고 `Row`를 바로
 *  흘린다. 부르는 자리는 계획 사이의 틈(§59 ⑦) · 계획 절이 없는 티켓 · 홈 대화 스레드 셋이다.
 *
 *  **`export`인 이유 — 줄 렌더러는 한 벌이다**(§7 §스레드가 트랜스크립트 전부를 그린다). 홈
 *  대화 스레드(`home-ui.tsx`)도 같은 사건 종을 접힌 줄로 그려야 하는데, `<SessionStream>` 통째를
 *  가져오면 티켓 `stem`에 묶인 참견·이어받기 폼까지 따라온다(§7이 거절한 그 길). 그래서 재사용
 *  단위를 이 함수 하나로 좁힌다 — `Row`는 그대로 비공개다(`Bundle` 밖에서 부를 자리가 없다). */
export function Bundle({
  events,
  onToggle,
  forceOpen,
  ctx,
}: {
  events: StreamEvent[];
  onToggle: (ev: React.SyntheticEvent<HTMLDetailsElement>) => void;
  /** 워커 다이얼로그 검색 중에 강제로 연다(§2-15 ②) — `undefined`/`false`는 종전 그대로
   *  `<details>`가 안 통제된다(홈 스레드 호출부는 이 prop을 안 넘긴다). */
  forceOpen?: boolean;
  /** 워커 다이얼로그 줄 컨텍스트(§2-15 ⑦⑧) — 안의 `Row`들에 그대로 흘려보낸다. 이 묶음 접힌
   *  줄 자체는 여전히 `<details>`다(§2-15 ② — 얹는 것은 펼친 뒤의 줄과 상자 바깥뿐이다). */
  ctx?: WorkerRowCtx;
}) {
  const t = useT();
  return (
    <details
      className="open:[&>summary>span>svg:first-child]:rotate-90"
      open={forceOpen || undefined}
      onToggle={onToggle}
    >
      <Marker
        render={<summary />}
        className={cn(
          LINE,
          "cursor-pointer list-none hover:bg-muted/50 hover:text-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        <MarkerIcon>
          <ChevronRight />
        </MarkerIcon>
        <MarkerContent className="tabular-nums">
          {t("sessionStream.recordCount.label")} {events.length}
          {t("sessionStream.recordCount.unit")}
        </MarkerContent>
      </Marker>
      {events.map((e) => (
        <Row key={e.key} e={e} onToggle={onToggle} ctx={ctx} />
      ))}
    </details>
  );
}

/** 상세 단의 `<pre>`(§비주얼 §64 ⑦) — §9의 그 클래스에서 둘을 뺀다: `ml-6`(줄의 `MarkerIcon` 열에
 *  맞추던 값 — 이 단에는 그 열이 없다) · `max-h-96`(이 단은 상세 몸(`overflow-y-auto`)이 이미
 *  자기 스크롤을 든다). 나머지는 §9 그대로다. */
const PANEL_PRE =
  "mt-1 mb-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground";

/** 상세 단의 절 하나 — `입력`·`결과` 공용(§2-15 ⑧). 머리는 라벨 + `ml-auto` 복사 버튼이고,
 *  누르면 **그 절의 원문**이 클립보드로 간다(다른 절과 절 사이에는 안 걸린다).
 *
 *  `toggle`은 `결과` 절만 준다(§2-15 ⑭ 2 · §비주얼 §64 개정) — `입력` 절은 이 프롭이 없어
 *  헤더 클래스가 종전 `flex h-6 items-center` 그대로다(`gap-2`는 토글이 있을 때만 는다). */
function DetailSection({
  label,
  copyText,
  toggle,
  children,
}: {
  label: string;
  copyText: string;
  toggle?: { pressed: boolean; onToggle: () => void };
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="mt-2 first:mt-0">
      <div className={cn("flex h-6 items-center", toggle && "gap-2")}>
        <span className="text-xs text-muted-foreground">{label}</span>
        {toggle && (
          <button type="button" aria-pressed={toggle.pressed} className="ml-auto" onClick={toggle.onToggle}>
            <Badge
              variant={toggle.pressed ? "secondary" : "outline"}
              className={toggle.pressed ? undefined : "text-muted-foreground"}
            >
              {t("progress.stream.markdown")}
            </Badge>
          </button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className={toggle ? undefined : "ml-auto"}
          onClick={() => void navigator.clipboard.writeText(copyText)}
        >
          <Copy aria-hidden />
          {t("progress.stream.copy")}
        </Button>
      </div>
      {children}
    </section>
  );
}

/** 마크다운 밀도 겹 — §비주얼 §10 넷째 자리, 값은 §비주얼 §64 개정 2. 루트의 `text-base
 *  leading-7`을 `cn`(twMerge)이 덮고, 다섯 요소 선택자는 특정도로 §10 표의 값을 이긴다. */
const RESULT_MARKDOWN_CLASS =
  "text-sm leading-6 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_table]:text-xs";

/** `결과` 절의 두 면(§2-15 ⑭) — 상태는 이 컴포넌트가 들고, `DetailPanel`이 `key={event.key}`로
 *  달아 다른 줄을 고르면 새로 마운트돼 **다시 마크다운**이 된다(저장하는 자리 0개).
 *
 *  마크다운 파싱은 `useMemo`가 **본문 문자열을 키**로 막는다(§2-15 ⑭ 3) — 2초 폴링마다
 *  `results` 배열은 새로 생겨도(`pairTool`이 매번 새로 잇는다) 본문이 안 갈리면 파싱이 0회다. */
function ResultSection({ results }: { results: StreamEvent[] }) {
  const t = useT();
  const locale = useLocale();
  const [markdownOn, setMarkdownOn] = useState(true);
  const copyText = results.map((r) => r.body).join("\n\n");

  const markdownView = useMemo(
    () =>
      results.map((r, i) => (
        <div key={r.key} className={i > 0 ? "border-t border-border pt-2" : undefined}>
          {r.error && (
            <p className="text-xs">
              <span className="text-foreground">{translate(locale, "progress.stream.error")}</span>
            </p>
          )}
          {r.body.trim() ? (
            <Markdown text={r.body} breaks="all" className={RESULT_MARKDOWN_CLASS} />
          ) : (
            <pre className={PANEL_PRE} />
          )}
        </div>
      )),
    // 메모 키는 본문 문자열(`copyText`) 하나다 — `results`는 폴링마다 새 배열이라 그대로 걸면
    // 안 바뀐 본문도 매번 다시 파싱한다(§2-15 ⑭ 3). `locale`은 화면이 안 걸 때만 바뀐다(재마운트).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copyText],
  );

  return (
    <DetailSection
      label={t("progress.stream.result")}
      copyText={copyText}
      toggle={{ pressed: markdownOn, onToggle: () => setMarkdownOn((v) => !v) }}
    >
      {markdownOn ? (
        <div className="space-y-2">{markdownView}</div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.key}>
              {r.error && (
                <p className="text-xs">
                  <span className="text-foreground">{t("progress.stream.error")}</span>
                </p>
              )}
              <pre className={PANEL_PRE}>{r.body}</pre>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

/** 2단 상세(§2-15 ⑧, 값 §비주얼 §64 ③⑦⑧) — 오른쪽 단. 고른 줄이 없으면 빈 상태 문구를 든
 *  채로 **단 자체는 남는다**(레이아웃이 안 튄다). 고르면 도구 이름 + 상대 시각 + 소요 + 닫기가
 *  머리, `입력`(본문, `diff`가 있으면 §9 계약 그대로 줄 단위 diff) · `결과`(짝 `tool_result`의
 *  본문 — 짝이 없으면 절 자체가 없다)가 몸이다. */
function DetailPanel({
  event,
  baseTs,
  allEvents,
  onClose,
}: {
  event: StreamEvent | null;
  baseTs: string;
  allEvents: StreamEvent[];
  onClose: () => void;
}) {
  const t = useT();
  const shell = "flex min-h-0 flex-col rounded-md border bg-background lg:h-full lg:min-w-96 lg:flex-1";

  if (!event) {
    return (
      <div className={shell}>
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("progress.stream.pickRow")}</p>
      </div>
    );
  }

  const { results, elapsedMs } = pairTool(event, allEvents);

  return (
    <div className={shell}>
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span
          className={cn("max-w-[7rem] shrink-0 truncate", event.kind === "tool_use" && "font-mono")}
          title={event.label}
        >
          {event.label}
        </span>
        <span className="shrink-0 font-mono tabular-nums" title={localTime(event.ts)}>
          {relativeElapsed(event.ts, baseTs)}
        </span>
        {event.kind === "tool_use" && elapsedMs !== null && (
          <span className="shrink-0 font-mono tabular-nums">{formatElapsed(elapsedMs)}</span>
        )}
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose}>
          <X aria-hidden />
          <span className="sr-only">{t("progress.stream.closeDetail")}</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <DetailSection label={t("progress.stream.input")} copyText={event.body}>
          {event.replaceAll && (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">replace_all</span> · {t("sessionStream.matchAllSuffix")}
            </p>
          )}
          <pre className={PANEL_PRE}>{diffOrBody(event)}</pre>
        </DetailSection>
        {results.length > 0 && <ResultSection key={event.key} results={results} />}
      </div>
    </div>
  );
}

/** 세션은 산문, 사람은 말풍선 — assistant `text`와 사람이 친 말(§2-6 ① · §비주얼 §9
 *  §산문과 말풍선 — §2-7 ①). 세션 쪽은 그릇이 없다: `Message`·`MessageContent`·`Bubble` 셋
 *  다 안 쓰고 헤더 + `<Markdown>` 하나뿐이다. 사람 쪽은 §13 말풍선 계약 그대로 무수정이다
 *  (`outline` · `p-3` · `rounded-xl` · `max-w-[80%]` · 헤더는 말풍선 밖 · 위 · 본문은
 *  `<Markdown>`). **시각을 안 붙인다** — 스레드 질문(§2-3 ②)과 같은 판정이고, 근거만 다르다
 *  (저쪽은 시각이 없어서, 여기는 있는데도 안 붙인다 — §29 ①). hover도 펼침도 없다.
 *
 *  좌 = `세션`(assistant `text`) · 우 = `사람`(첫 아닌 사용자 프롬프트 · 참견) — 파싱이 아는 것이
 *  그것뿐이다. 줄바꿈은 §10 면제와 같은 판정이다: 세션은 파일에 쓰듯 쓴 글이라 `breaks` 없이,
 *  사람은 입력칸에 친 글이라 `breaks="all"`로 친 줄바꿈이 정본이다. */
function StreamBubble({ e, refs }: { e: StreamEvent; refs?: RefIndex }) {
  const t = useT();
  const session = e.kind === "text";
  const who = session ? t("sessionStream.session") : t("sessionStream.person");
  const header = e.sidechain ? `${t("sessionStream.sub")} · ${who}` : who;

  if (session) {
    return (
      <div className="px-3 py-2">
        {/* `px-0` — 항목 껍데기의 `px-3`과 겹치지 않게, 헤더가 산문 첫 글자와 같은 x(12)에
            뜬다(§9) */}
        <MessageHeader className="px-0">{header}</MessageHeader>
        <Markdown text={e.body} refs={refs} />
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <Message align="end">
        <MessageContent>
          <MessageHeader>{header}</MessageHeader>
          <Bubble variant="outline" align="end">
            <BubbleContent>
              <Markdown text={e.body} breaks="all" refs={refs} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
}
