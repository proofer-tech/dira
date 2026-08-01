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
 *  **역할이 정렬로 갈린다 — 사람은 `end`, 상대는 `start`**(§24). §13은 질문(PM)이 왼쪽이었고
 *  여기는 사람이 묻지만, 두 화면에서 오른쪽에 서는 것은 언제나 **이 앱을 쓰는 사람**이다. */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Send, TriangleAlert } from "lucide-react";
import { askHome, clearHome, pollHomeAnswer } from "@/app/p/[project]/home/actions";
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

/** 화면이 답할 수 있다고 약속하는 범위가 곧 이 넷이다(§24 — 요구 원문의 예시 +
 *  §7이 스냅샷에 넣기로 한 것). 늘리려면 스냅샷이 먼저 늘어야 한다. */
const EXAMPLES = [
  "w2가 지금 무슨 일을 하고 있나",
  "w4는 어떤 엔진으로 도나",
  "답변 대기 티켓이 왜 안 도나",
  "이 큐의 프로토콜을 요약해 달라",
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
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const poll = async () => {
      const r = await pollHomeAnswer(project, session.current, offset.current);
      if (stop) return;
      session.current = r.sessionId;
      offset.current = r.offset;
      // `reset` = 세션이 갈렸다(서버가 0부터 다시 읽었다). 이어붙이면 옛 대화가 두 벌이 된다.
      if (r.reset) setTurns(r.turns);
      else if (r.turns.length) setTurns((prev) => [...prev, ...r.turns]);
      if (r.failed) setFail(r.failed);
      if (!r.running) {
        setRunning(false);
        clearInterval(timer);
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [project, running]);

  const empty = !text.trim();
  const busy = running || starting;

  const send = async () => {
    if (busy || empty) return;
    setStarting(true);
    setFail(null);
    // 보낸 글을 칸에서 비운다 — **다음 질문을 미리 쓸 수 있다는 것이 §24가 입력칸을 안 잠근
    // 이유**다. 실패하면 그 글을 도로 넣는다(§21 실패 규칙: 쓴 글은 남는다). 그 사이에 사람이
    // 다음 질문을 쓰기 시작했으면 **그쪽이 이긴다** — 사람이 방금 친 글을 덮지 않는다.
    const sent = text;
    setText("");
    const r = await askHome(project, sent);
    setStarting(false);
    if (r) {
      setFail(r);
      setText((now) => now || sent);
    } else {
      setRunning(true); // 폴링 효과가 붙는다. 질문 말풍선도 그 첫 응답이 데려온다
    }
    input.current?.focus();
  };

  return (
    // 폭 제한 없음 — §4 폼 규칙의 **셋째 예외**(§24 폭 항, 사람 요청 `bcf8299d`).
    // 여기서는 폼도 같이 넓어진다: 홈에는 폼·산문 밖의 자리가 없어서 앞의 두 예외처럼
    // "페이지만 풀고 폼은 `max-w-3xl`"을 얹으면 화면이 한 픽셀도 안 움직인다.
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
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

      {turns.length === 0 && !busy ? (
        /* 대화 0건 = 이 화면의 온보딩이다(§6 빈 상태 규칙의 셋째 예외 — 한 줄로는 이 에이전트에게
           무엇을 물어볼 수 있는지를 못 알려준다). 스레드 상자는 아예 안 그린다 — 빈 상자가 서는
           순간이 없다(§13). 폼은 그대로 아래에 있다: 온보딩이 폼을 대신하지 않는다. */
        <div className="space-y-2">
          <h2 className="text-sm font-medium">이 큐에 대해 묻는다</h2>
          <p className="text-sm text-muted-foreground">
            티켓 · 워커 · 프로토콜 · repo를 읽고 답합니다. 큐를 고치지는 않습니다.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
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
        </div>
      ) : (
        /* 스레드 상자(§13 그대로). 높이는 **Viewport**에 건다 — 부모 높이가 auto라 위에 걸면
           `h-full`이 풀려 아무 일도 안 한다(§13). `max-h-[32rem]`은 §9가 스크롤 상자에 이미 쓴
           수다(§24 — 한 앱에 스크롤 상자 규격이 둘이 되지 않는다). `max-`인 것이 요건이다:
           대화 한 줄이면 상자도 한 줄이다. `main`에 맡기지 않는 이유는 §24에 있다 — 스레드가
           같이 길어지면 폼이 화면 밖으로 밀린다. */
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport aria-label="대화" className="max-h-[32rem]">
              <MessageScrollerContent>
                {turns.map((t) => {
                  const align = t.role === "question" ? "end" : "start";
                  return (
                    <MessageScrollerItem key={t.key} messageId={t.key}>
                      <Message align={align}>
                        <MessageContent>
                          {/* 헤더는 말풍선 **밖 · 위**다(§13) — 안에 넣으면 본문의 소유자가
                              `<Markdown>` 하나가 아니게 된다. 아바타는 없다(§24가 한 줄로
                              거절했다 — 페르소나 색과 나란히 서면 이 에이전트가 페르소나로 읽힌다). */}
                          <MessageHeader>{t.role === "question" ? "질문" : "답"}</MessageHeader>
                          <Bubble variant="outline" align={align}>
                            <BubbleContent>
                              <Markdown text={t.text} />
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  );
                })}
                {/* 진행 표식(§18 ④) — 상자 **안** 마지막 자식이고 다음에 설 에이전트 말풍선의
                    자리다. 그릇 · 클래스 · 모션 · `aria-hidden`은 그 절 그대로고 문구만 갈린다.
                    `px-3`은 §9의 36px 들여쓰기가 아니라 `MessageHeader`의 그것에 맞는다.
                    **상한 5분을 적는 유일한 자리다**(§24) — 초를 세는 시계를 두지 않는다. */}
                {busy && (
                  <div className="flex items-center gap-2 px-3 text-xs leading-6 text-muted-foreground">
                    <span
                      aria-hidden
                      className="mx-1 size-2 shrink-0 animate-wip-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                    />
                    답을 찾는 중 · 최대 5분
                  </div>
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
          그 절 그대로고 갈리는 것은 이름 둘(`질문` · `이 큐에 대해 묻기`)뿐이다.
          손잡이 줄 왼쪽은 **빈다**: `보냈습니다 · 아래 스트림에 뜹니다`는 여기서 틀린 말이고
          (도착을 말하는 것은 말풍선이다) 상시 문구를 놓을 것도 없다(생기는 파일이 없다). */}
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
            aria-label="질문"
            placeholder="이 큐에 대해 묻기"
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
    </div>
  );
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
