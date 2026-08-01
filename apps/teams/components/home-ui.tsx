"use client";

/** 홈 대화 뷰 (DESIGN.md §7 · §비주얼 §24) — 묻고 · 답이 그려지고 · 새 대화.
 *
 *  **새 그릇을 하나도 안 짓는다**(§24). 말풍선 스레드는 §13(`MessageScroller*` · `Message` ·
 *  `Bubble variant="outline"`), 입력 form은 §21 그대로(`input-group` · `⌘↵` · `aria-disabled`),
 *  진행 표식은 §18 ④의 클래스 목록, 실패는 §6 3요소다. 이 파일이 정하는 것은 **무엇을 어디에
 *  쓰느냐**뿐이고 새 컴포넌트 · 새 토큰은 0이다.
 *
 *  **`<SessionStream>`을 가져오지 않는다**(§7 · §24). 저건 티켓 `stem`에 묶여 있고 참견·이어받기
 *  폼을 달고 있다 — 끌어오면 그 안에 티켓 없는 경로가 하나 더 생긴다. 재사용하는 것은 화면이
 *  아니라 **읽기 코어**(`lib/transcript.ts`)이고, 그건 `lib/home-agent.ts`의 `pollHome`이 부른다.
 *
 *  **낙관적 에코를 그리지 않는다.** 방금 보낸 질문도 폴링이 트랜스크립트에서 읽어 온다 —
 *  화면의 출처가 그 파일 하나여야 새로고침 전후가 같다(§24 "도는 동안만 그렸다 지우는 절충도
 *  안 된다"와 같은 근거). 그래서 이 파일에는 turn을 만드는 코드가 없다.
 *
 *  **역할이 그릇으로 갈린다 — 사람은 §13 말풍선(`align="end"`), 답은 전폭 산문**(§24 개정).
 *  오른쪽에 서는 것이 언제나 이 앱을 쓰는 사람이라는 §13의 판정은 그대로고, 갈린 것은 상대 쪽
 *  그릇뿐이다: 답이 이 화면의 1차 콘텐츠라 `max-w-[80%]`가 읽을 것을 20% 좁힌다.
 *  보이는 라벨 둘(`질문`·`답`)이 사라지므로 **`sr-only`가 협상 대상이 아니다** — 남는 구분이
 *  정렬과 테두리뿐이면 화면을 못 보는 사람에게는 구분이 0이다(§0 "색만으로 의미 전달 금지").
 *
 *  **답 아래 24px 띠는 언제나 하나이고 안이 상태로 갈린다**(§24 개정 ② `51546e85`): 도는 중이면
 *  진행 표식(§18 ④) + `중지`, 끝났으면 `복사` + `다시 답하기`, 중지된 답이면 그 앞에 `중지됨`
 *  한 마디가 더 선다. 상태마다 띠를 따로 세우지 않는 이유는 **답이 끝나는 순간 높이가 안
 *  튀어야** 해서다 — 자동 스크롤이 바닥을 물고 있는 화면에서 24px 점프가 가장 나쁘다(§13). */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Copy, Send, TriangleAlert } from "lucide-react";
import { askHome, clearHome, pollHomeAnswer, stopHome } from "@/app/p/[project]/home/actions";
import { CopyCommand } from "@/components/copy-command";
import { useKeymap } from "@/components/keymap-provider";
import { Markdown } from "@/components/markdown";
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { Answer, AnswerReason, HomeChunk, Turn } from "@/lib/home-agent";
import { formatCombo, matchCombo } from "@/lib/keymap";
import { cn } from "@/lib/utils";

/** 화면이 답할 수 있다고 약속하는 범위가 곧 이 넷이다(§24 — 요구 원문의 예시 +
 *  §7이 스냅샷에 넣기로 한 것). 늘리려면 스냅샷이 먼저 늘어야 한다. */
const EXAMPLES = [
  "w2가 지금 무슨 일을 하고 있나",
  "w4는 어떤 엔진으로 도나",
  "답변 대기 티켓이 왜 안 도나",
  "이 프로젝트의 프로토콜을 요약해 달라",
];

/** §비주얼 §24 실패 5종. **`reason` 코드로 갈린다** — `output` 문장을 되짚으면 문구를 한 자
 *  고치는 날 화면이 조용히 뭉친다(§21 `FAIL` 표와 같은 규약). `other`는 §24에 항이 없는
 *  나머지고 제목 한 줄 + 원문이다. `cmd`가 있는 것은 ① 하나뿐이다. */
const FAIL: Record<AnswerReason, { title: string; next?: string; cmd?: string }> = {
  spawn: {
    title: "답을 받지 못했습니다 — 세션을 띄우지 못했습니다",
    next: "엔진 CLI가 PATH에 있는지 확인하세요",
    cmd: "which claude",
  },
  auth: {
    title: "답을 받지 못했습니다 — Claude 인증이 없습니다",
    next: "헤더 오른쪽 설정에서 장기 토큰을 넣고 다시 물어보세요.",
  },
  timeout: {
    title: "답을 받지 못했습니다 — 5분을 넘겼습니다",
    next: "질문을 좁혀 다시 물어보세요. 쓴 글은 그대로 남아 있습니다.",
  },
  busy: {
    title: "보내지 못했습니다 — 답이 아직 도는 중입니다",
    next: "끝나면 이 칸이 다시 열립니다. 새로고침하지 않아도 됩니다.",
  },
  "no-transcript": {
    title: "답을 찾지 못했습니다 — 트랜스크립트가 없습니다",
    next: "새 대화로 다시 물어보세요.",
  },
  other: { title: "답을 받지 못했습니다" },
};

export function HomeUI({ project, initial }: { project: string; initial: HomeChunk }) {
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  // **새로고침해도 따라간다**: 서버가 "지금 도는 질문이 있다"를 알고 있어서(§7 실행층의 맵)
  // 이 값이 참으로 시작하면 폴링 효과가 그대로 다시 붙는다.
  const [running, setRunning] = useState(initial.running);
  const [starting, setStarting] = useState(false); // `askHome` 왕복 한 번. 도는 것과 다른 값이다
  const [fail, setFail] = useState<Answer | null>(initial.failed);
  const [text, setText] = useState("");
  // **도는 동안 받은 글**(§7 §답은 흐른다). 출처가 `turns`와 다르다 — 이건 자식의 stdout이고
  // 저건 트랜스크립트다. 끝나는 순간 서버가 빈 문자열을 주고 같은 응답의 `turns`가 그 답을
  // 진짜 줄로 데려온다. **한 답이 두 벌로 안 그려지는 자리가 그 교대다** — 여기서 다시 안 막는다.
  const [partial, setPartial] = useState(initial.partial);
  // `중지`를 눌렀다. **낙관적으로 라벨을 안 바꾼다**(§24) — 그 버튼 하나가 `aria-disabled`가
  // 될 뿐이고, 띠가 액션 줄로 바뀌는 것은 서버가 끝을 알린 뒤다.
  const [stopping, setStopping] = useState(false);
  // 폴링이 들고 다니는 두 값. 렌더에 안 쓰므로 상태가 아니다(바뀔 때마다 그릴 것이 없다).
  const session = useRef(initial.sessionId);
  const offset = useRef(initial.offset);
  const input = useRef<HTMLTextAreaElement>(null);
  // 보내는 키와 손잡이의 `<kbd>`가 **같은 값 하나**에서 나온다(§0-6: 표기를 하드코딩하지 않는다).
  // §24가 이 폼을 §21의 **세 번째 모드**로 못박았으므로 액션도 그 하나를 같이 쓴다 —
  // 키설정에 9번째 줄을 만들지 않는다(§0-6의 액션 8개는 그 화면의 계약이다).
  const sendCombo = useKeymap().bindings["interject.send"];

  // **답이 도는 동안만 돈다**(§7 — 홈은 5초 폴링을 하지 않는다. 큐를 따라가는 화면이 아니다).
  // 끝나는 근거는 서버가 돌려주는 `running` 하나고(§2-1의 `live`와 같은 모양), 그 응답이
  // 마지막 사건까지 담고 있다 — 실행층이 **끝났는지를 파일보다 먼저** 읽는 이유가 그것이다.
  //
  // **주기가 500ms다**(§7 §답은 흐른다 — SSE를 만들지 않는 대가로 정한 수). 델타 하나가 평균
  // 250ms 늦게 붙고, 실측 델타 간격이 480ms라 그 지연은 화면에서 안 보인다. 5분을 다 쓰면
  // 왕복 600회이고 한 번이 `readSessionId` + 트랜스크립트 tail이다.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const poll = async () => {
      const r = await pollHomeAnswer(project, session.current, offset.current);
      if (stop) return;
      session.current = r.sessionId;
      offset.current = r.offset;
      setPartial(r.partial);
      // `reset` = 세션이 갈렸다(서버가 0부터 다시 읽었다). 이어붙이면 옛 대화가 두 벌이 된다.
      setTurns((prev) => {
        const next = r.reset ? r.turns : r.turns.length ? [...prev, ...r.turns] : prev;
        // **중지 표식을 서버 응답에서도 받는다.** 트랜스크립트의 `[Request interrupted by user]`가
        // `toTurns`에서 같은 칸을 채우지만(새로고침이 사는 근거), 그 줄이 이 폴링보다 늦게
        // 쓰이는 창이 있다 — 그때 화면이 `중지됨`을 통째로 놓친다. 두 근거가 같은 칸을 채운다.
        return r.stopped ? markStopped(next) : next;
      });
      if (r.failed) setFail(r.failed);
      if (!r.running) {
        setRunning(false);
        clearInterval(timer);
      }
    };
    void poll();
    const timer = setInterval(poll, 500);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [project, running]);

  const empty = !text.trim();
  const busy = running || starting;

  /** 질문 하나를 띄운다. **입력칸과 `다시 답하기`가 같은 경로다**(§24 — 후자가 하는 일이
   *  "옛 질문을 입력칸에 넣고 보내는 것"과 같다). 갈리는 것은 칸을 비우느냐뿐이라 그쪽은 밖에 둔다. */
  const run = async (question: string) => {
    setStarting(true);
    setFail(null);
    setStopping(false); // 앞 답을 중지한 뒤라도 이번 답의 `중지`는 눌린 적이 없다
    setPartial("");
    const r = await askHome(project, question);
    setStarting(false);
    if (r) setFail(r);
    else setRunning(true); // 폴링 효과가 붙는다. 질문 말풍선도 그 첫 응답이 데려온다
    input.current?.focus();
    return r;
  };

  const send = async () => {
    if (busy || empty) return;
    // 보낸 글을 칸에서 비운다 — **다음 질문을 미리 쓸 수 있다는 것이 §24가 입력칸을 안 잠근
    // 이유**다. 실패하면 그 글을 도로 넣는다(§21 실패 규칙: 쓴 글은 남는다). 그 사이에 사람이
    // 다음 질문을 쓰기 시작했으면 **그쪽이 이긴다** — 사람이 방금 친 글을 덮지 않는다.
    const sent = text;
    setText("");
    if (await run(sent)) setText((now) => now || sent);
  };

  /** `중지`(§7 §도는 답을 멈춘다) — 서버가 자식 하나에 `SIGTERM`을 보낸다. **여기서 화면을
   *  안 바꾼다**: 받은 글도 `중지됨`도 다음 폴링이 데려온다(낙관적 에코 금지와 같은 축). */
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    await stopHome(project);
  };

  // 대화 0건 = 온보딩이다. `busy`가 참이면 스레드가 선다 — 그 안에 진행 표식이 있어야 하고,
  // 질문 말풍선도 첫 폴링 응답이 데려온다(낙관적 에코가 없다).
  const onboarding = turns.length === 0 && !busy;

  return (
    // 폭 제한 없음 — §4 폼 규칙의 **셋째 예외**(§24 폭 항, 사람 요청 `bcf8299d`).
    // 여기서는 폼도 같이 넓어진다: 홈에는 폼·산문 밖의 자리가 없어서 앞의 두 예외처럼
    // "페이지만 풀고 폼은 `max-w-3xl`"을 얹으면 화면이 한 픽셀도 안 움직인다.
    //
    // **페이지가 뷰포트를 채운다**(§24 세로 배치 · §4 세로 스크롤 예외의 둘째 자리).
    // `main`이 이미 `flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto`라(§4 셸) 페이지가
    // 그 안에서 `flex-1`로 남은 높이를 받는다. **`min-h-0`이 빠지면** flex 자식 기본값
    // (`min-height:auto`)이 내용만큼 늘어나 `main`이 도로 스크롤하고 폼이 화면 밖으로 밀린다.
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">홈</h1>
        {/* 0건이면 안 그린다 — 비울 것이 없다(§24). 도는 중에는 `aria-disabled`다:
            이건 프로세스를 죽이는 버튼이 아니다(§7 — 이 앱에 취소가 없다). */}
        {turns.length > 0 && (
          <NewChat
            project={project}
            busy={busy}
            onCleared={() => {
              // 다음 질문이 **새 세션**이다 — 옛 파일의 바이트 수를 들고 있으면 새 트랜스크립트의
              // 앞부분을 통째로 건너뛴다. 서버도 같은 판정을 한다(`pollHome`의 `reset`).
              session.current = null;
              offset.current = 0;
              setTurns([]);
              setFail(null);
            }}
          />
        )}
      </div>

      {/* 대화 컬럼 — 남은 높이 전부다. **자식이 언제나 셋이고 순서가 안 바뀐다**(§24):
          [0건: 인사 | 그 외: 스레드] · [폼] · [0건: 예시 4개 | 그 외: null].
          조건이 거짓인 자리를 배열에서 빼지 않는 이유는 폼이다 — 같은 인덱스에 남아야 React가
          다시 마운트하지 않고, 그래야 첫 질문을 보낸 순간 포커스와 IME 상태가 안 날아간다(§21).
          0건일 때 `justify-center` 한 클래스가 그 묶음을 세로 가운데로 올린다(§24 온보딩 항) —
          자리 이동은 이 클래스가 사라지는 것으로 끝난다. */}
      <div className={cn("flex min-h-0 flex-1 flex-col gap-2", onboarding && "justify-center")}>
        {onboarding ? (
          /* 대화 0건 = 이 화면의 온보딩이다(§6 빈 상태 규칙의 셋째 예외 — 한 줄로는 이 에이전트에게
             무엇을 물어볼 수 있는지를 못 알려준다). 스레드 상자는 아예 안 그린다 — 빈 상자가 서는
             순간이 없다(§13). 폼은 이 묶음의 **가운데 줄**이다: 온보딩이 폼을 대신하지 않는다. */
          <div className="space-y-2">
            <h2 className="text-sm font-medium">이 프로젝트에 대해 묻는다</h2>
            <p className="text-sm text-muted-foreground">
              티켓 · 워커 · 프로토콜 · repo를 읽고 답합니다. 프로젝트를 고치지는 않습니다.
            </p>
          </div>
        ) : (
          /* 스레드(§13 그대로). **높이가 확정이라 `flex-1`이다**(§24) — §13이 `max-h`를 못박은
             근거는 부모가 `Card`·`DialogContent`라 높이가 auto라는 것이었고, 여기 부모 사슬은
             뷰포트 → `main` → 페이지 → 대화 컬럼으로 끝까지 flex다. 종전 `max-h-[32rem]`은 §24
             개정이 취소했다(홈은 이제 상자가 아니라 화면이다 — §9의 512는 그 절에서 무수정).
             스크롤하는 요소는 여전히 Viewport 하나고, 화면에서 스크롤하는 것도 그것 하나다. */
          <MessageScrollerProvider autoScroll>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport aria-label="대화" className="flex-1">
                <MessageScrollerContent>
                  {turns.map((t, i) => (
                    <MessageScrollerItem key={t.key} messageId={t.key}>
                      {t.role === "question" ? (
                        /* 사람 질문 — §13 말풍선 그대로(`outline` · `align="end"`). 헤더는 말풍선
                           **밖 · 위**이고(§13) 라벨만 `sr-only`로 내려간다: 클래스 하나로 끝나서
                           새 요소가 아니다. 아바타는 없다(§24가 한 줄로 거절했다 — 페르소나 색과
                           나란히 서면 이 에이전트가 페르소나로 읽힌다). */
                        <Message align="end">
                          <MessageContent>
                            <MessageHeader className="sr-only">질문</MessageHeader>
                            <Bubble variant="outline" align="end">
                              <BubbleContent>
                                <Markdown text={t.text} />
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      ) : (
                        /* 에이전트 답 — **전폭 산문 + 그 아래 띠 하나**(§24). `Bubble`도
                           `Message`도 안 쓴다: 저 한 벌이 주는 것은 좌우 배치 기계장치고 전폭에는
                           쓸 데가 없다. 띠가 이 항목 **안**에 있는 이유는 §24 그대로다 — 도는
                           답이 언제나 마지막이라 보이는 자리가 같고, 답이 끝날 때 높이가 안 튄다. */
                        <>
                          <Prose text={t.text} />
                          <Band>
                            {/* 중지된 답 — **실패가 아니다**(§7). `<StatusBadge>`도 색도 없다:
                                이건 큐의 상태가 아니라 답 하나가 끝난 방식이라 13번째 상태를
                                만들지 않는다(§24). 자리는 진행 표식 문구가 앉던 그 자리다. */}
                            {t.stopped && <span className="text-xs text-muted-foreground">중지됨</span>}
                            <CopyAnswer text={t.text} />
                            {/* **답을 갈아 끼우지 않는다**(§7) — 질문·답이 스레드 끝에 한 벌 더
                                붙는다. 트랜스크립트가 정본이라 거기서 줄을 지울 수 없다.
                                도는 중에 눌러도 여기서 막지 않는다: 서버가 §24 실패 ④로
                                판정하고 그 Alert가 왜 안 갔는지를 말한다(화면의 잠금 셋에
                                네 번째를 더하면 끝난 답 20개의 버튼이 같이 흐려진다). */}
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => void run(questionFor(turns, i))}
                            >
                              다시 답하기
                            </Button>
                          </Band>
                        </>
                      )}
                    </MessageScrollerItem>
                  ))}
                  {/* 도는 답 — **트랜스크립트에 아직 없는 한 항목**이다. 안은 끝난 답과 같은
                      모양이고(산문 + 띠) 띠 안만 진행 표식(§18 ④) + `중지`로 갈린다. 항목이
                      하나라 도착한 조각이 **같은 산문 블록**에 이어 붙는다 — 문단마다 항목을
                      쪼개면 스크롤 위치가 매 폴링마다 튄다(§24).
                      **상한 5분을 적는 유일한 자리다** — 초를 세는 시계를 두지 않는다. */}
                  {busy && (
                    <MessageScrollerItem key="running" messageId="running">
                      <Prose text={partial} />
                      <Band>
                        <span
                          aria-hidden
                          className="mx-1 size-2 shrink-0 animate-wip-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                        />
                        답하는 중 · 최대 5분
                        {/* `ml-auto`가 없다 — 이 화면의 띠는 1440에서 ≈1392px이라 오른쪽 끝으로
                            밀면 버튼이 자기가 멈추는 글자에서 1200px 떨어져 홀로 뜬다
                            (§4-3 예외 2번 — 조작 대상 옆에 있는 것이 위치의 뜻이다). */}
                        <Button
                          variant="outline"
                          size="xs"
                          aria-disabled={stopping}
                          className="aria-disabled:opacity-50"
                          onClick={() => void stop()}
                        >
                          중지
                        </Button>
                      </Band>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              {/* 아래가 가려졌을 때만 뜬다(`data-active`). 라벨을 `sr-only`로 숨기지 않는다(§13) */}
              <MessageScrollerButton>
                <ArrowDown aria-hidden />
                최신으로
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>
        )}

        {/* §21의 세 번째 모드다(§24) — 그릇 · 자람 · `⌘↵` · 포커스 · `aria-disabled` 판정은
            그 절 그대로고 갈리는 것은 이름 둘(`질문` · `이 프로젝트에 대해 묻기`)뿐이다.
            손잡이 줄 왼쪽은 **빈다**: `보냈습니다 · 아래 스트림에 뜹니다`는 여기서 틀린 말이고
            (도착을 말하는 것은 말풍선이다) 상시 문구를 놓을 것도 없다(생기는 파일이 없다).
            **`shrink-0`** — 스레드가 아무리 길어도 이 자리를 잃지 않는다(§24 세로 배치). */}
        <form
          className="shrink-0 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <InputGroup>
            <InputGroupTextarea
              ref={input}
              aria-label="질문"
              placeholder="이 프로젝트에 대해 묻기"
              className="max-h-32"
              value={text}
              // **도는 동안에도 편집 가능한 채로 둔다**(§24): `disabled`면 `:has(:disabled)`가
              // 그릇을 통째로 흐려 placeholder가 §21이 금지한 1.85로 떨어지고, 답이 5분까지
              // 걸리는 화면에서 다음 질문을 미리 쓸 수 없게 된다. 못 보내는 실효는 `send()`의
              // 첫 줄이고, 서버가 한 번 더 판정한다(§24 실패 ④).
              onChange={(e) => setText(e.target.value)}
              // `⌘↵`로 보낸다. `Enter`는 줄바꿈이다(§21). `matchCombo`가 `isComposing`을 막아
              // 받침을 확정하는 `Enter`에 글이 날아가지 않는다.
              onKeyDown={(e) => {
                if (matchCombo(e.nativeEvent, sendCombo)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <InputGroupAddon align="block-end">
              {/* `bg-muted`를 깔지 않는다 — `--muted-foreground`가 라이트 4.34로 AA 미달이다(§21).
                  `ml-auto`가 여기 걸려서 1차 버튼이 줄의 가장 오른쪽이다(§4-3). */}
              <kbd className="ml-auto border px-1 font-mono text-xs text-muted-foreground">
                {formatCombo(sendCombo)}
              </kbd>
              {/* **`disabled`가 아니라 `aria-disabled`다**(§21 실측 — `InputGroup`의 흐림이
                  `:has(:disabled)`라 버튼 하나만 잠가도 그릇이 통째로 흐려진다). */}
              <InputGroupButton
                type="submit"
                variant="default"
                size="xs"
                aria-disabled={busy || empty}
                className="aria-disabled:opacity-50"
              >
                <Send aria-hidden />
                {busy ? "보내는 중…" : "보내기"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>

          {/* 실패는 사유를 삼키지 않는다(§6 3요소 — 제목 · mono 원문 · 다음 행동). 자리는 §21
              그대로 입력칸 아래 · 폼 안이다. ①만 `<CopyCommand>`를 단다: 사람이 실행해야 하는
              명령이 있는 사유가 그것뿐이고, 나머지는 다음 행동이 문장 하나다. */}
          {fail && <Failure fail={fail} />}
        </form>

        {/* 셋째 자리 — 0건이면 예시 4개, 아니면 `null`이다. **자리를 배열에서 빼지 않는다**(위). */}
        {onboarding ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              // **제출하지 않는다**(§24): ① 한 질문이 프로세스 하나고 상한이 5분이다 — 클릭 한 번에
              // 5분짜리를 시작시키지 않는다. ② 예시는 문장을 고쳐 쓰라고 있다(`w2`가 그 큐에 없을 수
              // 있다). 채워진 뒤 손잡이의 `보내기`가 곧 두 번째 클릭이다.
              <Button
                key={q}
                variant="outline"
                size="sm"
                onClick={() => {
                  setText(q);
                  input.current?.focus();
                }}
              >
                {q}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 에이전트 답의 산문 블록 — 도는 답과 끝난 답이 **같은 것을 쓴다**(§24: 답이 끝나는 순간
 *  그릇이 안 갈려야 높이가 안 튄다). `px-3`은 말풍선 안 글자의 `p-3`에 맞춘다 — 두 역할의
 *  글자가 같은 축에 선다. 자 단위 상한을 안 얹는다(요청 `bcf8299d`가 지운 값이 `max-w-3xl`
 *  = 읽는 산문 폭이었다).
 *  `// ponytail: 상한이 필요해지면 여기 `max-w-[70ch]` 한 클래스다.` */
function Prose({ text }: { text: string }) {
  return (
    <div className="px-3">
      <span className="sr-only">답</span>
      <Markdown text={text} />
    </div>
  );
}

/** 산문 아래 **24px 띠**(§비주얼 §24). 클래스는 §18 ④ 진행 표식의 것 그대로이고, 상태에 따라
 *  갈리는 것은 **안에 무엇이 서느냐**뿐이다. 왼쪽부터 채운다(`ml-auto` 없음). */
function Band({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 text-xs leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

/** `복사` — **원문 마크다운**이다(§7). 렌더된 HTML이 아니다: 사람이 그것을 티켓·문서에 붙인다.
 *
 *  `<CopyCommand>`를 안 쓴다(§24) — 그 그릇은 `font-mono break-all` 블록 + 버튼이고 담는 것이
 *  터미널 한 줄이라, 답 전문을 넣으면 답이 화면에 두 번(두 번째는 mono로) 선다. 빌리는 것은
 *  그 파일의 **관용구**다: 아이콘만 `Check`로 1.5초 바뀌고 글자는 그대로 — 폭이 한 px도 안
 *  움직여서 옆의 `다시 답하기`가 안 밀린다(§4-3). 토스트도 안 띄운다(그건 서버 액션의 것이다). */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      복사
    </Button>
  );
}

/** `다시 답하기`가 다시 보낼 글 — **그 답 바로 위의 사람 질문**이다. 가짜 줄 셋은 `toTurns`가
 *  이미 걸렀으므로(§7 실측 ⑷) 뒤로 훑어 처음 만나는 `question`이 곧 그 답을 부른 질문이다.
 *  못 찾으면(우리가 안 만든 세션의 첫 줄이 답인 경우) 빈 문자열이고, `startAsk`가 거절한다. */
function questionFor(turns: Turn[], i: number): string {
  for (let j = i - 1; j >= 0; j--) if (turns[j]?.role === "question") return turns[j].text;
  return "";
}

/** 서버가 `stopped`를 알린 순간의 **마지막 답**에 표식을 옮겨 적는다. 트랜스크립트 쪽 근거
 *  (`toTurns`)와 같은 칸을 채우고, 둘 중 먼저 오는 것이 이긴다. */
function markStopped(turns: Turn[]): Turn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role !== "answer") continue;
    return turns.map((t, j) => (j === i ? { ...t, stopped: true as const } : t));
  }
  return turns;
}

/** 실패 한 장 (§비주얼 §24 실패 5종 · §6 3요소). */
function Failure({ fail }: { fail: Answer }) {
  const f = FAIL[fail.reason ?? "other"];
  // §24 실패 표의 `원인 원문` 열. ③은 `상한 300초 초과 · session <id>`가 그 값이라 세션을
  // 붙인다 — ④는 실행층이 이미 `session <id>` 한 줄로 만들어 보내고, 나머지는 CLI 원문이다.
  const detail =
    fail.reason === "timeout" && fail.sessionId
      ? `${fail.output} · session ${fail.sessionId}`
      : fail.output;
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{f.title}</AlertTitle>
      <AlertDescription>
        <span className="block font-mono text-xs break-all">{detail}</span>
        {f.next && <span className="block text-xs">{f.next}</span>}
        {f.cmd && <CopyCommand cmd={f.cmd} />}
      </AlertDescription>
    </Alert>
  );
}

/** `새 대화` — **확인을 끼운다**(§24). 지우는 것은 GUI가 든 session id 한 줄이지만 사람이 잃는
 *  것은 방금 읽은 답 전부다(이 앱에 대화 목록도 검색도 없다 — §7 안 만드는 것). 이 앱이
 *  되돌릴 수 없는 삭제에 `alert-dialog`를 쓰는 다섯 번째 자리다(§5). */
function NewChat({
  project,
  busy,
  onCleared,
}: {
  project: string;
  busy: boolean;
  onCleared: () => void;
}) {
  const [clearing, setClearing] = useState(false);
  if (busy) {
    // 도는 중에는 다이얼로그를 아예 안 연다. `aria-disabled`인 이유는 §21과 같다 —
    // `disabled`는 포커스를 잃고 `title`도 안 뜬다(왜 못 누르는지 말할 자리가 사라진다).
    return (
      <Button
        variant="outline"
        size="sm"
        aria-disabled
        className="aria-disabled:opacity-50"
        title="답이 도는 동안에는 비울 수 없습니다"
      >
        새 대화
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm">
            새 대화
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>대화를 비웁니다</AlertDialogTitle>
          <AlertDialogDescription>
            지금 대화가 화면에서 사라집니다. 되돌릴 수 없습니다 — 이 앱에 대화 목록이 없습니다.
            트랜스크립트 파일은 그대로 남습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              await clearHome(project);
              setClearing(false);
              onCleared();
            }}
          >
            비우기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
