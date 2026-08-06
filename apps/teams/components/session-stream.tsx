"use client";

/** 진행 기록 (DESIGN.md §2-3 · §비주얼 §29 · §2-6) — 종전 세션 스트림(§2-1 · §9)이 **한 상자**로 넓어졌다.
 *
 *  상자 안에 문법이 둘이다. 세션이 흘린 **스트림 줄**(§9 — 접힌 `<Marker>` 한 줄. 색 토큰은 하나도
 *  안 쓴다)과 대화 넷이 서는 **말풍선**(§13 · §2-6 — 테두리 네 변 + 좌우 정렬이 역할을 가른다).
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
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ChevronRight, FilePlus2, Send, TriangleAlert } from "lucide-react";
import { sendFollowup, sendInterject, tailSession } from "@/app/p/[project]/tickets/[hash]/actions";
import {
  AttachmentButton,
  AttachmentChips,
  AttachmentProblems,
  useAttachments,
} from "@/components/attachment-field";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { AnswerForm } from "@/components/ticket-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { useKeymap } from "@/components/keymap-provider";
import { formatCombo, matchCombo } from "@/lib/keymap";
import type { FollowupReason } from "@/lib/followup";
import type { InterjectReason } from "@/lib/interject";
// 스레드를 엮는 쪽은 서버(`lib/queue.ts threadOf`)다 — 여기 오는 건 타입뿐이라 `node:*`를 안 끈다
import type { ThreadItem } from "@/lib/queue";
import type { StreamEvent } from "@/lib/transcript";
import {
  engineCan,
  expandable,
  groupProgress,
  interjectMode,
  mergeProgress,
  progressMarkerText,
  type InterjectMode,
} from "@/lib/urls";
import { cn } from "@/lib/utils";

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

export function SessionStream({
  project,
  stem,
  live: initialLive,
  engine,
  thread = [],
  stream = true,
  awaiting = false,
  answerFile,
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
}) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [live, setLive] = useState(initialLive);
  const [inbox, setInbox] = useState<boolean | null>(null); // null = 첫 폴링이 아직 안 왔다
  const [done, setDone] = useState(false); // 티켓이 `.done`인가 — 폼의 모드다(§21)
  const [detached, setDetached] = useState(false); // 바닥에서 떨어졌다 = 자동 스크롤 안 한다
  const offset = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  // 이 워커에 이 화면이 **없을 수 있다**(§4-3 · §비주얼 §23 ⑤). 고장이 아니라 기능 집합의
  // 차이라 진입점은 그대로 두고 그 자리에서 왜 없는지를 말한다. 판정은 엔진 이름 하나고 모델은
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
  // 사건 줄이 두 벌 서고 key가 같아 React가 경고를 찍는다. 여기가 홈보다 조용한 이유는 주기가
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
        if (r.events.length) setEvents((prev) => [...prev, ...r.events]);
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

  // 시간순 한 줄기(§2-3 ②) — 순서 규칙은 `lib/urls.ts`의 순수 함수가 들고 있고 테스트가 못박는다.
  // `groupProgress`가 그 줄기를 말풍선(경계)과 그 사이 묶음으로 가른다(§2-6 ②) — 말풍선인가는
  // `label === ""` 하나로 판정한다(assistant `text` · 참견 · 첫 아닌 사용자 프롬프트가 전부 빈 label).
  const grouped = groupProgress(mergeProgress(events, thread), (e) => e.label === "");
  // 말풍선의 key는 **스레드 안의 자리**다. 병합 배열의 index로 잡으면 사건이 붙을 때마다 맨 끝
  // 질문(답 없는 꼬리 · §2-3 ②)의 key가 밀려 매 폴링에 `<Markdown>`이 다시 마운트된다.
  const threadKey = new Map(thread.map((t, i) => [t, `t${i}`]));
  // 진행 표식 문구(§2-6 ③) — **파싱된 마지막 스트림 레코드** 하나가 판정한다(병합·묶음과 무관).
  const markerText = progressMarkerText(events.at(-1)?.kind);

  return (
    // `min-w-0`은 워커 다이얼로그가 가로로 새는 것을 막는다(§비주얼 §21 · 요구 `fff27e81`).
    // `DialogContent`가 `grid`라 이 절은 그리드 아이템이고 `min-width: auto` = 내용의 min-content다.
    // 펼친 `<pre>`의 `break-words`는 min-content를 안 줄여서(줄이는 건 `break-all`) 긴 한 줄이
    // 그대로 열 폭이 된다 — 실측 768px 다이얼로그의 `scrollWidth`가 13125px이었다.
    <div className="min-w-0 space-y-2">
      {/* 머리 줄 — `진행 기록` h2와 `맨 아래로`가 같은 행에 선다(§비주얼 §29 ③ P173).
          h2는 이 절이 서는 다섯 상태 전부에서 무조건 렌더된다(종전엔 `page.tsx`가 이 h2를
          따로 그렸다 — `<SessionStream>`이 안 서는 "둘 다 0" 빈 상태만 거기 남는다) — 그래서
          이 줄도 이제 조건부가 아니다(종전엔 `stream`일 때만 줄 자체가 섰다). 오른쪽 무리
          (`!live` 문구 + 버튼)만 `stream`일 때 뜬다 — 흐르는 스트림이 없으면 "지금 스트림
          상태"를 말할 것이 없다(§29 ②). `h-8` 고정은 그 무리가 떴다 사라질 때 줄이 안
          튀게 하는 것이 근거다(§18 ④ · §21). */}
      <div className="flex h-8 items-center justify-between gap-2">
        <h2 className="text-sm font-medium">진행 기록</h2>
        {stream && (
          <div className="flex items-center gap-2">
            {!live && <p className="text-xs text-muted-foreground">끝난 세션 · 갱신 없음</p>}
            {detached && (
              <Button variant="ghost" size="sm" onClick={() => setDetached(false)}>
                <ArrowDown aria-hidden className="size-3.5" />
                맨 아래로
              </Button>
            )}
          </div>
        )}
      </div>
      {noStream && (
        /* §비주얼 §23 ⑤ 사후 — §9가 이미 세워 둔 `<EmptyState>`에 문구만 갈아 끼운다.
           `Alert`가 아니다: 사람이 할 일이 없고(원문도 다음 행동도 없다), §9가 스트림 부재를
           이미 `부재이지 고장이 아니다`로 판정했고, codex 워커에겐 이게 상시 상태라 정상
           상태에 켜진 경고가 된다(§0-2). 폴링도 안 돈다 — 빈 스트림을 돌리지 않는다.
           **문구가 엔진 이름을 말한다**: 이 자리에 서는 엔진이 codex 하나가 아니게 됐다
           (집합 밖 = 손으로 쓴 `TICKET_ENGINE`도 여기로 온다 — §4-3 개정). */
        <EmptyState
          text={`이 워커의 엔진은 ${engine}입니다`}
          action={
            <span className="text-xs text-muted-foreground">
              세션 스트림은 claude 엔진에서만 됩니다 — {engine}는 트랜스크립트를 남기지 않습니다
            </span>
          }
        />
      )}
      {/* 상자는 **그릴 것이 있을 때만** 선다. codex이고 스레드도 없으면 위 `<EmptyState>` 하나가
          이 자리의 전부다(종전 그대로) — 빈 상자를 하나 더 그리는 것은 소음이다(§29 ④). */}
      {(stream || grouped.length > 0) && (
        /* 배경에 틴트를 깔지 않는다 — `--muted`를 깔면 접힌 줄의 `--muted-foreground`가 4.34로
            AA 미달이고(§9 함정 1) 말풍선 실측표 7종도 이 면 위에서 잰 값이다(§29 ①).
            512px인 이유는 머리와 바닥이 한 화면에 같이 들어와서다 — 참견 최악 840에 852까지
            여유가 12px이라 한 단계도 못 키운다(§29 ②). 흐르는 것이 없으면 `max-`다:
            답변 대기 한 건짜리 요구사항에 470px짜리 빈 상자를 그리지 않는다. */
        <div
          ref={box}
          onScroll={(e) => setDetached(!atBottom(e.currentTarget))}
          className={cn(
            "overflow-y-auto rounded-md border bg-background py-2",
            stream ? "h-[32rem]" : "max-h-[32rem]",
          )}
        >
          {grouped.map((g) => {
            if (g.kind === "event") return <StreamBubble key={g.event.key} e={g.event} />;
            if (g.kind === "thread") return <ThreadRow key={threadKey.get(g.thread)} item={g.thread} />;
            return <Bundle key={g.events[0].key} events={g.events} onToggle={onToggle} />;
          })}
          {/* 진행 표식(§18 ④) — 마지막 사건 다음 줄이 올 자리를 지킨다. **말풍선 아래로 안
              내려간다**: `.wip`인 동안 상자의 맨 끝은 항상 스트림 사건이고(답 없는 질문은
              열린 티켓에만 있다 — §29 ③) 옛 답변은 `birth`가 지금 세션 첫 사건보다 앞이다.
              `<Marker>`도 `<details>`도 아니다: §9가 Marker 기본값을 하나도 안 덮기로 했는데
              여기는 `text-xs`여야 한다(폴링 상태 3종이 한 종류인 채로 자리만 옮겼다). 눌러 볼
              것이 없으니 hover도 없다. `mx-1`이 8px 점을 16px 칸(= MarkerIcon 폭) 가운데 세워
              문구를 다른 두 줄과 같은 x=36px에 맞춘다. // ponytail: 정렬용 래퍼 대신 마진 4px.
              점이 커지면 그때 래퍼. 문구를 같이 드는 이유는 `prefers-reduced-motion`이다 —
              모션만으로 말하지 않는다. **문구는 마지막 레코드가 `thinking`이면 갈린다**(§2-6 ③,
              요구 `cbdc2cb4`) — 판정은 `progressMarkerText`(`lib/urls.ts`) 하나다. */}
          {live && (
            <div className="flex items-center gap-2 px-3 text-xs leading-6 text-muted-foreground">
              <span
                aria-hidden
                className="mx-1 size-2 shrink-0 animate-wip-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
              />
              {markerText}
            </div>
          )}
        </div>
      )}

      {/* 입력칸 — 상자 **밖 · 밑**이다(§2-2 · §비주얼 §21). 여기 한 곳에 다니까 티켓 상세와
          워커 다이얼로그가 같은 폼을 그린다(§2-1 Q2=(a)). 항상 마운트해 두고 그릴지 말지는
          컴포넌트가 스스로 판정한다 — 조건을 바깥에 두면 `live`가 내려가는 순간(2초 폴링) 실패
          사유와 사람이 쓴 글이 언마운트로 같이 증발한다(§21 예외 항).
          **codex에서도 자리를 지운다는 뜻이 아니다**(§비주얼 §23 ⑤): 비활성 + 사유 한 줄로 뜬다 —
          진입점을 지우면 화면은 "왜 없는지"를 말할 자리를 잃는다. */}
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
      />
    </div>
  );
}

/** 질문은 산문, 답변은 말풍선(§비주얼 §9 §산문과 말풍선 · §13 §질문 쪽은 산문이다 — §2-7 ①).
 *  질문(PM)은 그릇이 없다 — `Message`·`MessageContent`·`Bubble` 셋 다 안 쓰고 헤더 + `<Markdown>`
 *  뿐이다. 답변(사람)은 §13 말풍선 계약 그대로 무수정이다.
 *
 *  `px-3`은 스트림 줄과 **같은 거터다**(§29 ① x=12 — 산문 헤더 `px-0`이 그 위에 얹혀 항목 첫
 *  글자와 나란히 선다). `py-2`가 §13 `gap-4`를 그대로 낸다(말풍선끼리 8+8=16 · 줄과는 8).
 *  **시각을 안 붙인다**: 질문은 자기 파일이 없어 시각이 없고, 지어내지 않기로 한 것이 §2-3 ②다 —
 *  답변에만 붙이면 한 쌍의 헤더가 서로 다른 모양이 된다. 순서는 자리가 말한다.
 *  hover도 펼침도 없다 — 산문·말풍선 둘 다 펼칠 것이 없다(스트림 줄의 `hover:bg-muted/50`은
 *  어포던스다). */
function ThreadRow({ item }: { item: ThreadItem }) {
  if (item.role === "question") {
    return (
      <div className="px-3 py-2">
        {/* 헤더가 자기 본문 첫 글자와 같은 x(12)에 선다(§9) — `px-0`은 항목 껍데기의 `px-3`과
            겹치지 않게 하는 한 클래스다. */}
        <MessageHeader className="px-0">
          {item.heading || "질문"}
          {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
        </MessageHeader>
        {/* 질문은 PM이 감은 절이라 줄바꿈을 안 그린다(§10 면제 — §9와 같은 판정) */}
        <Markdown text={item.text} />
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <Message align="end">
        <MessageContent>
          {/* 헤더는 말풍선 **밖 · 위**다(§13) — 안에 넣으면 본문의 소유자가 `<Markdown>` 하나가
              아니게 되고 §10 루트의 `[&>:first-child]:mt-0`이 거짓이 된다. 앉는 면이 `--card`가
              아니라 `--background`라 `--muted-foreground`가 4.73 / 7.63이다(§29 ① — 병합으로
              한 칸 좋아지는 유일한 자리고, 새로 잰 것이 아니라 §9 표의 1행이다) */}
          <MessageHeader>
            {item.heading || "답변"}
            {item.hash && <span className="ml-2 font-mono">{item.hash}</span>}
          </MessageHeader>
          <Bubble variant="outline" align="end">
            <BubbleContent>
              {/* 답변은 사람이 친 글이라 줄바꿈을 그린다(§10 면제) */}
              <Markdown text={item.text} breaks="all" />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
}

/** §비주얼 §21 실패 4종. **`reason` 코드로 갈린다** — `error` 문장을 되짚으면 문구를 한 자
 *  고치는 날 화면이 조용히 뭉친다. `other`는 §21에 항이 없는 나머지고 제목 한 줄 + 원문이다. */
const FAIL: Record<InterjectReason, { title: string; next?: string }> = {
  ENXIO: {
    title: "보내지 못했습니다 — 세션이 끝났습니다",
    next: "이 티켓엔 더 이상 도는 세션이 없습니다. 위 글을 복사해 새 티켓으로 지시하세요.",
  },
  ENOENT: {
    title: "보내지 못했습니다 — 입구가 없습니다",
    next: "세션이 방금 끝났거나 엔진이 입구를 못 만들었습니다. 한 번 더 보내 보고, 그래도 안 되면 새 티켓으로 지시하세요.",
  },
  "not-wip": {
    title: "보내지 못했습니다 — 진행중이 아닙니다",
    next: "참견은 도는 세션에만 닿습니다. 새 티켓으로 지시하세요.",
  },
  "no-inbox": {
    title: "보내지 못했습니다 — 참견을 받지 못하는 세션입니다",
    next: "옛 세션이거나 입구를 만들지 않는 엔진입니다. 새 티켓으로 지시하세요.",
  },
  other: { title: "보내지 못했습니다" },
};

/** 완료 모드(이어받기)의 실패 2종 — §비주얼 §21 `완료 모드` 실패 표.
 *  **`보내지 못했습니다`로 시작하지 않는다**: 두 모드의 Alert가 같은 문장이면 스크린샷 한 장으로
 *  어느 칸에서 난 실패인지 가리지 못한다. 모드 어긋남에 `새로고침`을 적는 이유는 완료 티켓의
 *  폴링이 1회에 멈춰서다(§2-1) — 화면이 스스로 모드를 고쳐 잡지 않는다. */
const FAIL_DONE: Record<FollowupReason, { title: string; next?: string }> = {
  "not-done": {
    title: "발행하지 못했습니다 — 완료 티켓이 아닙니다",
    next: "이어받기는 완료 티켓의 것입니다. 새로고침하고 다시 보세요 — 도는 세션이면 이 칸이 참견으로 바뀝니다.",
  },
  other: {
    title: "발행하지 못했습니다",
    next: "위 글을 복사해 보드에서 발행하세요.",
  },
};

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
  answerFile?: string;
}) {
  const router = useRouter();
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
  // 무엇을 하는지를 말한다(§2-3 ③). 보드 다이얼로그에서는 `DialogDescription`이 같은 말을 하므로
  // 폼 안에 넣지 않는다 — 넣으면 거기서 두 번 뜬다.
  if (mode === "answer") {
    return answerFile ? (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          답변을 달면 이 티켓이 다시 큐에 뜨고 담당 세션이 이어서 봅니다.
        </p>
        <AnswerForm project={project} hash={stem} answerFile={answerFile} />
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
  // `session_id`와 함께 `inbox`도 비우므로(`tickets.py`) `closed`와 같은 폴링에 동시에 서고,
  // 남은 폼의 입력칸이 `disabled`가 돼 §21이 `readOnly`로 지키려던 선택·복사를 잃는다. §21이
  // 그릇의 흐림을 의도한 자리는 하나뿐이고, 그 화면의 사유는 실패 Alert가 말한다(사유 한 줄도
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
      setFail({ mode, ...FAIL_DONE[r.reason], detail: r.detail });
    } else {
      const r = await sendInterject(project, stem, text, att.paths);
      setSending(false);
      if (r.ok) {
        setText("");
        att.reset(); // 칩은 글과 **같은 타이밍**에 빈다. 올라간 파일은 안 지운다(§8 수명)
        setSent(true);
      } else {
        setFail({ mode, ...FAIL[r.reason], detail: r.detail });
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
          aria-label={followup ? "이어받기" : "참견"}
          aria-describedby={off ? offId : undefined}
          placeholder={followup ? "이어서 무엇을 할지 쓰기" : "도는 세션에 말 걸기"}
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
              <span className="min-w-0 truncate text-xs">새 열린 티켓 1장이 생깁니다</span>
            ) : (
              sent && (
                <span className="min-w-0 truncate text-xs">보냈습니다 · 아래 스트림에 뜹니다</span>
              )
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
                입구가 없을 때(입력칸 `disabled`)로 남기고, 못 누른다는 사실은 이 버튼만 말한다.
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
                  ? "발행 중…"
                  : "이어서 발행"
                : sending
                  ? "보내는 중…"
                  : "보내기"}
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
              이 워커는 그런 워커다. **엔진 이름을 말한다**: 이 자리에 서는 엔진이 codex
              하나가 아니게 됐고(grok도 온다), 이름이 없으면 사람이 어느 쪽인지 모른다. */}
          {noInterject
            ? `이 워커의 엔진은 ${engine}입니다 — 참견은 claude 엔진에서만 됩니다`
            : "이 세션은 참견을 받지 못합니다 — 티켓에 inbox가 없습니다"}
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
const LINE = "px-3 leading-6";

/** 접힌 줄 — `<Marker>` 한 줄. `tool_use`·`thinking`·`tool_result`·세션 프롬프트가 전부 이 모양이다.
 *  고정폭 4열은 (a)가 버렸다(요구 `e3020347`) — 시각(mono 8자)만 세로로 맞고 도구명부터 줄마다
 *  어긋난다. 도구명에 `max-w-[7rem]`만 남은 것이 종전 고정폭이 묶던 흔들림 범위를 대신한다.
 *  Marker 기본값(`flex gap-2 items-center text-sm text-muted-foreground w-full`)은 하나도 안 덮는다. */
function Row({
  e,
  onToggle,
}: {
  e: StreamEvent;
  onToggle: (ev: React.SyntheticEvent<HTMLDetailsElement>) => void;
}) {
  const summary = e.sidechain ? `서브 · ${e.summary}` : e.summary;
  // 시각·도구명은 `shrink-0`이라, 줄이 넘칠 때 줄어드는 칸은 `MarkerContent` 하나다
  // (그 `min-w-0`이 종전 `minmax(0,1fr)`가 하던 일이다).
  const cells = (
    <>
      <span className="shrink-0 font-mono tabular-nums">{localTime(e.ts)}</span>
      {/* mono면 엔진이 실제로 부른 이름이고, sans면 우리가 붙인 이름이다(§9).
          판정은 `kind` 하나다 — 화면이 도구 목록을 다시 갖지 않는다. */}
      <span
        className={cn("max-w-[7rem] shrink-0 truncate", e.kind === "tool_use" && "font-mono")}
        title={e.label}
      >
        {e.label}
      </span>
      <MarkerContent className={cn("truncate", e.summaryMono && "font-mono")} title={summary}>
        {summary}
      </MarkerContent>
    </>
  );
  // 펼칠 것이 없으면 어포던스도 없다(`expandable` — 판정은 `lib/urls.ts` 하나다).
  // 여기 오는 건 본문이 암호화된 `thinking`이다(실측 75/75). 줄 자체는 그대로 흘리고
  // — 빼면 생각하는 동안 화면이 조용해진다 — `MarkerIcon` 칸만 §9대로 **비워서 유지**한다.
  if (!expandable(e)) {
    return (
      <Marker className={LINE}>
        <MarkerIcon />
        {cells}
      </Marker>
    );
  }

  return (
    <details className="group" onToggle={onToggle}>
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
            `size-4`는 Marker 기본 규칙이 준다(§9: 덮지 않는다). */}
        <MarkerIcon>
          <ChevronRight className="group-open:rotate-90" />
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
            <span className="font-mono">replace_all</span> · 일치하는 곳 전부
          </p>
        )}
        <pre className="mt-1 mb-2 ml-6 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
          {e.diff ? (
            /* 색 0(§9) — 갈리는 것은 머리 2칸 `- `/`+ `/`  ` 하나다. 셋이 색·크기·서체·배경까지
               같다. 줄당 `<div>` + 걸이 들여쓰기(`pl-[2ch] -indent-[2ch]`)라 줄바꿈된 이음줄이
               부호 열을 안 밟는다 — 색이 없어서 그 열의 무결성이 이 블록의 전부다. */
            e.diff.map((l, i) => (
              <div key={i} className="pl-[2ch] -indent-[2ch]">
                {l.kind + " " + l.text}
              </div>
            ))
          ) : (
            e.body
          )}
        </pre>
      </div>
    </details>
  );
}

/** 묶음 접힌 줄 — 말풍선 사이 연속 사건은 한 항목이다(§2-6 ② · §비주얼 §9 §묶음 접힌 줄).
 *  접힌 줄과 **같은 그릇**(`<details>` + `<Marker render={<summary />}>`)이라 이 겹은 그릇을 안
 *  늘린다. 시각·도구명 슬롯은 없다 — 묶음 안에 도구가 여럿이라 하나를 골라 세우면 거짓말이다.
 *  `기록 n건`이 그 자리에 선다(sans + `tabular-nums`, `truncate`도 `title`도 없다 — 고정 문구라
 *  안 잘린다). 펼치면 이 절의 사건 줄들이 **그대로** 나온다 — 들여쓰기를 안 늘린다. */
function Bundle({
  events,
  onToggle,
}: {
  events: StreamEvent[];
  onToggle: (ev: React.SyntheticEvent<HTMLDetailsElement>) => void;
}) {
  return (
    <details className="group" onToggle={onToggle}>
      <Marker
        render={<summary />}
        className={cn(
          LINE,
          "cursor-pointer list-none hover:bg-muted/50 hover:text-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        <MarkerIcon>
          <ChevronRight className="group-open:rotate-90" />
        </MarkerIcon>
        <MarkerContent className="tabular-nums">기록 {events.length}건</MarkerContent>
      </Marker>
      {events.map((e) => (
        <Row key={e.key} e={e} onToggle={onToggle} />
      ))}
    </details>
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
function StreamBubble({ e }: { e: StreamEvent }) {
  const session = e.kind === "text";
  const who = session ? "세션" : "사람";
  const header = e.sidechain ? `서브 · ${who}` : who;

  if (session) {
    return (
      <div className="px-3 py-2">
        {/* `px-0` — 항목 껍데기의 `px-3`과 겹치지 않게, 헤더가 산문 첫 글자와 같은 x(12)에
            선다(§9) */}
        <MessageHeader className="px-0">{header}</MessageHeader>
        <Markdown text={e.body} />
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
              <Markdown text={e.body} breaks="all" />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
}
