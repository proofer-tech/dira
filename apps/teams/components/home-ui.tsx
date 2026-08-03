"use client";

/** 홈 대화 뷰 (DESIGN.md §7 · §비주얼 §24) — 묻고 · 답이 그려지고 · 대화를 갈아 끼운다.
 *
 *  **새 그릇을 하나도 안 짓는다**(§24). 말풍선 스레드는 §13(`MessageScroller*` · `Message` ·
 *  `Bubble variant="outline"`), 입력 form은 §21 그대로(`input-group` · `⌘↵` · `aria-disabled`),
 *  진행 표식은 §18 ④의 클래스 목록, 실패는 §6 3요소, 대화 목록은 **좌측 패널의 `button` 목록**
 *  이다(`div` 둘 + `button` — `01e5293b`이 팝오버를 걷었다). 이 파일이 정하는 것은
 *  **무엇을 어디에 쓰느냐**뿐이고 새 컴포넌트 · 새 토큰은 0이다.
 *
 *  **대화가 여럿이다**(§7 — 요구 `c5d22429`). 목록도 `current`도 서버 파일에 있고
 *  (`home-sessions.json`), 화면은 **폴링 응답 하나**로 그 둘과 스레드를 같이 받는다.
 *  라우트는 안 는다 — 대화 선택이 URL이 아니라 그 파일이다. 그래서 `새 대화`는 지우는 버튼이
 *  아니라 **여는 버튼**이고 `alert-dialog` 확인이 없다: 옛 대화가 한 클릭 거리에 남는다.
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
import Link from "next/link";
import { ArrowDown, Check, Copy, Send, TriangleAlert } from "lucide-react";
import {
  askHome,
  clearHome,
  pollHomeAnswer,
  stopHome,
  switchHome,
} from "@/app/p/[project]/home/actions";
import {
  AttachmentButton,
  AttachmentChips,
  AttachmentProblems,
  useAttachments,
} from "@/components/attachment-field";
import { CopyCommand } from "@/components/copy-command";
import { FindBar } from "@/components/find-bar";
import { useKeymap } from "@/components/keymap-provider";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import type { Answer, AnswerReason, Home, HomeChunk, Turn, WorkerSession } from "@/lib/home-agent";
import { formatCombo, matchCombo } from "@/lib/keymap";
import { chatRows } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** 화면이 답할 수 있다고 약속하는 범위가 곧 온보딩 예시 넷이다(§24 — 요구 원문의 예시 +
 *  §7이 스냅샷에 넣기로 한 것). 늘리려면 스냅샷이 먼저 늘어야 한다.
 *
 *  **여기 사는 것은 뒤의 둘뿐이다.** 앞의 둘은 워커 이름을 담아서 이 큐에 실제로 등록된
 *  워커에서 나와야 하고(§24 §앞의 둘은 이 큐에 실제로 등록된 워커 이름), 그 문장은 서버가
 *  만들어 `examples` prop으로 온다 — 워커 0개인 큐에서는 빈 배열이라 예시가 2개다. */
const EXAMPLES = ["답변 대기 티켓이 왜 안 도나", "이 프로젝트의 프로토콜을 요약해 달라"];

/** `새 대화`의 잠금 — **이제 이것 하나다**(§24 §~~잠금 두 자리~~ → 잠금 한 자리. 요구
 *  `4e9e54c5`가 ①을 걷었다: 답이 도는 동안 패널 줄도 이 버튼도 안 잠긴다. 옛 문구
 *  `답이 끝나거나 중지한 뒤에 열 수 있습니다`가 쓰이던 자리가 셋 다 사라져 상수째 걷었다 —
 *  ②는 그 문자열을 안 쓴다. 손잡이 줄 왼쪽의 `<WorkerNote>`가 그 자리다).
 *
 *  지금 대화의 턴이 0건이면 버튼이 **사라지지 않고 자리를 지킨다**(패널에서는 사라짐이 목록을
 *  12px 끌어올린다). **조건이 하나 늘었다**(`1a925a73`) — `턴 0건` **그리고 그 대화에 도는 것이
 *  없다**: 첫 질문 직후는 턴이 아직 0건인데(낙관적 에코가 없다) 그 대화엔 방금 보낸 질문이 있다.
 *  종전에는 걷힌 ①이 이겨서 그 창을 가려 줬고, 그것만 걷으면 화면이 거짓말을 한다. */
const NO_TURNS = "지금 대화가 이미 비어 있습니다 — 여기에 물어보세요";

/** 좌측 패널이 그리는 것 전부 — **`home-sessions.json`의 형식(`Home`) + 큐에서 파생된 워커 세션**
 *  (§7 좌측 패널). 파일 쪽 타입에 워커 목록을 얹지 않는 이유는 저장하지 않기 때문이다: 저건
 *  우리가 쓰는 파일의 모양이고 이 목록은 매 응답 큐에서 다시 파생된다. `current` 한 칸이
 *  둘을 통틀어 가리키고, 그래서 **체크가 패널 전체에 하나다**(§24). */
type Panel = Home & { workers: WorkerSession[] };

/** 폴링 주기 둘과 천장(§7 §답은 흐른다 · §폴링은 서버가 잊어도 안 끊긴다). 자세한 근거는
 *  아래 `useEffect` 머리 주석. 셋 다 이 파일 안에서만 쓴다 — 서버의 `TIMEOUT_MS`는 같은 수지만
 *  같은 값이 될 수 없다(저 모듈은 `node:child_process`를 물고 있어 클라이언트로 못 건너온다). */
const FAST_MS = 500;
const SLOW_MS = 2_000;
const CEILING_MS = 5 * 60_000;

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

export function HomeUI({
  project,
  initial,
  examples,
}: {
  project: string;
  /** 온보딩 예시 **앞의 둘**(§24) — 서버가 `listWorkers`로 만든 문장이고, 워커 0개면 빈 배열이다.
   *  `initial`(폴링 응답)에 안 얹혀 있는 것이 요점이다: 이 값은 페이지를 연 시점에 굳는다. */
  examples: string[];
  initial: HomeChunk;
}) {
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  // **새로고침해도 따라간다**: 서버가 "지금 도는 질문이 있다"를 알고 있어서(§7 실행층의 맵)
  // 이 값이 참으로 시작하면 폴링 효과가 그대로 다시 붙는다.
  const [running, setRunning] = useState(initial.running);
  // **이 프로젝트에서 도는 대화 전부**(§7 §대화마다 따로 돈다 — `runningSessions`). `running`과
  // 다른 값이다: 저건 **보고 있는** 대화 하나고 이건 목록의 어느 줄이 도는가다. 화면에서 둘을
  // 한다 — 패널 줄의 표식(§24 §도는 대화의 표식)과 **폴링을 계속하는 근거**.
  const [runningIds, setRunningIds] = useState<string[]>(initial.runningSessions);
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
  // **대화 목록 + 지금 보는 줄**(§7 §대화가 여럿이다 · §24). 서버가 폴링마다 같이 준다 —
  // 첫 질문이 제목을 파일에 쓰므로(`beginTurn`) 답이 도는 동안 트리거의 `새 대화`가 그 질문의
  // 첫 줄로 갈린다. **`session` ref와 다른 값이 아니다**: 저건 폴링이 offset을 어느 파일의
  // 것으로 볼지 정하는 부기고 이건 화면이 그리는 이름이다. 둘이 갈리는 순간은 하나 —
  // 전환을 누르고 서버 응답이 오기 전, **트리거만 낙관적으로** 바뀐 그 한 프레임이다(§24 로딩 항).
  const [home, setHome] = useState<Panel>({
    conversations: initial.conversations,
    workers: initial.workers,
    current: initial.sessionId,
  });
  // 폴링이 들고 다니는 두 값. 렌더에 안 쓰므로 상태가 아니다(바뀔 때마다 그릴 것이 없다).
  const session = useRef(initial.sessionId);
  const offset = useRef(initial.offset);
  const input = useRef<HTMLTextAreaElement>(null);
  // **`⌘F`가 훑을 자리 하나**(§7 §무엇을 훑나 · §비주얼 §30) — 스레드 뷰포트다. 좌측 패널 ·
  // 입력칸 · 셸 헤더가 이 밖이라 *무엇을 안 훑나*가 이 ref 하나로 참이 된다. 대화 0건(온보딩)
  // 이면 스크롤러 자체가 안 서서 `null`이고, 그래서 그 화면의 결과가 `0/0`이다(§30 ⑥).
  const thread = useRef<HTMLDivElement>(null);
  // 첨부(§8) — 나가는 곳이 `claude`의 argv다. 조립은 서버의 `withAttachments` 하나이고
  // (§8 §표기는 하나다) 파일은 홈 에이전트 cwd 아래라 `Read`가 그대로 연다(§7 도구 셋).
  const att = useAttachments(project);
  // 보내는 키와 손잡이의 `<kbd>`가 **같은 값 하나**에서 나온다(§0-6: 표기를 하드코딩하지 않는다).
  // §24가 이 폼을 §21의 **세 번째 모드**로 못박았으므로 액션도 그 하나를 같이 쓴다 —
  // 키설정에 9번째 줄을 만들지 않는다(§0-6의 액션 8개는 그 화면의 계약이다).
  const sendCombo = useKeymap().bindings["interject.send"];

  // **답이 도는 동안만 돈다**(§7 — 홈은 5초 폴링을 하지 않는다. 큐를 따라가는 화면이 아니다).
  // 끝나는 근거는 **`running`이 아니라 `done`**이다(§7 §폴링은 서버가 잊어도 안 끊긴다 —
  // 요구 `116b3c37`). 판정은 서버 한 줄에 있고(`pollDone`) 여기는 그 값을 읽을 뿐이다:
  // 실행층이 끝을 넘긴 폴링(`answered`)이면 끊고, `running: false`인데 그것도 새 줄도 없으면
  // 그건 끝이 아니라 **맵이 휘발한 것**이라(dev recompile) 안 끊고 트랜스크립트를 더 본다.
  // 종전에는 그 한 번에 끊어서 화면이 질문만 든 채 얼었고, 새로고침만이 살렸다.
  // **그 뒤 `answered`가 첫째 증거가 된 것이 QA `0a284011`이다** — 답 줄을 도는 중의 폴링이
  // 먼저 집어 가므로 마지막 응답의 `turns`는 비어 있고, 그것만 보던 판정은 여기 아래 천장
  // 5분까지 안 끊겼다(실측 295~300초 잠금).
  //
  // **주기가 둘이다.** 도는 동안은 500ms(§7 §답은 흐른다 — SSE를 만들지 않는 대가로 정한 수.
  // 델타 하나가 평균 250ms 늦게 붙고 실측 델타 간격이 480ms라 안 보인다). 서버가 잊은 뒤에는
  // **2초**다(§2-1과 같은 수) — 흐르는 글은 이미 맵과 함께 사라졌고 여기서 기다리는 것은
  // 완성된 답 한 덩어리라 500ms를 유지할 이유가 없다.
  //
  // **천장 5분**(§7 — `ask`의 `TIMEOUT_MS`와 같은 수. 저 값은 서버 모듈에 있어 여기로 못
  // 건너온다 — 클라이언트 번들이 `node:child_process`를 못 문다). 그 뒤로도 답이 없으면 끊고
  // 잠금을 푼다. 무한히 묻는 화면을 만들지 않는다.
  //
  // **앞 왕복이 끝난 뒤에 다음을 예약한다 — `setInterval`이 아니다**(`bcfcdda4`). 저건 왕복
  // 시간을 안 보고 500ms마다 쏘므로, 왕복이 그보다 길어지는 순간 두 `poll`이 동시에 살아
  // **같은 `offset.current`를 읽는다.** 서버는 죄 없이 같은 바이트 구간을 두 벌 주고 둘 다
  // 이어붙어 같은 질문·같은 답이 스레드에 두세 벌 선다(key가 같아 React가 경고까지 찍는다).
  // 파일은 멀쩡하고 새로고침이면 사라지는 **화면만의 고장**이라 더 조용했다. 실측으로 400ms
  // 지연을 주입해 왕복 중앙값을 535ms로 올리면 100% 났다(QA `2ad9906c`).
  //
  // **도는 것이 이 프로젝트에 하나라도 있으면 돈다**(요구 `4e9e54c5`). 종전 조건은 `running`
  // 하나였고 그건 **보고 있는** 대화의 것이라, 옮겨 간 대화에서 폴링이 끊겨 패널의 표식이
  // 죽었다. 끊는 자리도 같이 갈린다 — 보던 대화가 끝나도(`done`) 남이 돌면 안 끊는다.
  // **`running`이 deps에 남아 있는 것이 값이다**: 새 질문이 시작되는 순간 사슬이 통째로
  // 다시 걸려서, 그 전에 떠 있던 왕복(등록 전의 서버를 본 것)이 `stop`에 걸려 죽는다 —
  // 안 그러면 그 응답의 `running: false`가 방금 시작한 답을 화면에서 지운다.
  // **불리언 하나로 좁혀서 deps에 넣는다** — 목록 자체를 넣으면 폴링이 새 배열을 줄 때마다
  // 사슬이 다시 걸려 500ms 주기가 매번 처음부터 선다(같은 값이 든 다른 배열이다).
  const anyRunning = runningIds.length > 0;
  useEffect(() => {
    if (!running && !anyRunning) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // **천장은 답 하나에 5분이다**(무수정). 사슬이 여러 대화를 이어 물게 됐으므로 **처음 보는
    // 세션이 뜰 때마다 그 5분을 다시 센다** — 안 그러면 A가 4분째일 때 시작한 B가 1분 만에
    // 잘린다(그 답은 파일에 서고 새로고침이 데려오지만, 화면은 그동안 얼어 있다).
    const seen = new Set<string>();
    let deadline = Date.now() + CEILING_MS;
    const poll = async () => {
      // 왕복이 통째로 실패하면(catch) 서버가 삐끗한 것이다 — 느린 쪽으로 물러난다.
      let wait = SLOW_MS;
      try {
        const r = await pollHomeAnswer(project, session.current, offset.current);
        if (stop) return;
        session.current = r.sessionId;
        offset.current = r.offset;
        setPartial(r.partial);
        setHome({ conversations: r.conversations, workers: r.workers, current: r.sessionId });
        setRunningIds(r.runningSessions);
        for (const id of r.runningSessions) {
          if (!seen.has(id)) {
            seen.add(id);
            deadline = Date.now() + CEILING_MS; // 처음 보는 답 — 이 사슬의 천장을 다시 센다
          }
        }
        // `reset` = 세션이 갈렸다(서버가 0부터 다시 읽었다). 이어붙이면 옛 대화가 두 벌이 된다.
        setTurns((prev) => {
          const next = r.reset ? r.turns : r.turns.length ? [...prev, ...r.turns] : prev;
          // **중지 표식을 서버 응답에서도 받는다.** 트랜스크립트의 `[Request interrupted by user]`가
          // `toTurns`에서 같은 칸을 채우지만(새로고침이 사는 근거), 그 줄이 이 폴링보다 늦게
          // 쓰이는 창이 있다 — 그때 화면이 `중지됨`을 통째로 놓친다. 두 근거가 같은 칸을 채운다.
          return r.stopped ? markStopped(next) : next;
        });
        if (r.failed) setFail(r.failed);
        if (r.done) {
          setRunning(false);
          // **보던 대화가 끝났다고 사슬을 안 끊는다** — 남이 돌면 패널의 표식이 이 왕복에
          // 매달려 있다(§24 §도는 대화의 표식). 도는 것이 0이 되는 그때가 끊는 자리다.
          if (r.runningSessions.length === 0) return;
        }
        wait = r.running ? FAST_MS : SLOW_MS;
      } catch {
        // 이 왕복 하나만 버린다 — `setInterval`이 한 틱 실패에 안 멈추던 것과 같은 자리다.
        // 여기서 멈추면 서버가 잠깐 삐끗한 대가로 도는 답이 화면에서 영구히 얼어붙는다.
      }
      if (stop) return;
      if (Date.now() >= deadline) {
        // 천장. 답은 못 받았지만 잠금은 푼다 — 5분 뒤에도 잠긴 입력칸은 고장이고, 답이
        // 늦게라도 파일에 서면 새로고침이 데려온다(그 경로는 종전부터 살아 있다).
        setRunning(false);
        return;
      }
      timer = setTimeout(poll, wait);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [project, running, anyRunning]);

  const empty = !text.trim();
  const busy = running || starting;
  // **지금 보는 것이 워커 세션인가**(§7 좌측 패널 — `current`가 대화 목록 밖을 가리킬 수 있다).
  // 이 한 값이 화면에서 셋을 정한다: 패널의 체크가 어느 그룹에 서는지 · 손잡이 줄 왼쪽 문구 ·
  // `보내기`가 잠기는지. 큐에서 사라진 세션이면 서버가 이미 `sessionId: null`로 물러나므로
  // (`pollHome`) 여기서도 `undefined`고 화면은 **대화 0건과 같다**(온보딩) — 실패가 아니다.
  const worker = home.workers.find((w) => w.id === home.current);
  // **도는 세션에는 말을 걸 수 없다**(§24 §잠금 두 자리 ② — 근거는 자리가 아니라 파일이다:
  // 홈이 `--resume`으로 붙으면 한 트랜스크립트에 두 프로세스가 쓴다). 잠기는 것은 `보내기`
  // 하나이고 **입력칸은 아니다** — 쓰던 글이 다른 세션으로 갈아탄 뒤에도 남는 것이 값이다.
  const readOnly = worker?.running === true;

  /** 질문 하나를 띄운다. **입력칸과 `다시 답하기`가 같은 경로다**(§24 — 후자가 하는 일이
   *  "옛 질문을 입력칸에 넣고 보내는 것"과 같다). 갈리는 것은 칸을 비우느냐뿐이라 그쪽은 밖에 둔다. */
  const run = async (question: string, paths: string[] = []) => {
    setStarting(true);
    setFail(null);
    setStopping(false); // 앞 답을 중지한 뒤라도 이번 답의 `중지`는 눌린 적이 없다
    setPartial("");
    // `다시 답하기`는 첨부 없이 부른다(§24 — 그 버튼이 다시 보내는 것은 **옛 질문 한 줄**이고,
    // 그 글에 첨부 경로가 필요했으면 이미 그 안에 적혀 있다).
    const r = await askHome(project, question, paths);
    setStarting(false);
    if (r) setFail(r);
    else setRunning(true); // 폴링 효과가 붙는다. 질문 말풍선도 그 첫 응답이 데려온다
    input.current?.focus();
    return r;
  };

  const send = async () => {
    // `readOnly`가 여기 있는 것이 실효 잠금이다(§24 ② — `보내기`의 `aria-disabled`는 표시다).
    // 서버도 같은 판정을 한 번 더 한다: 이 폼 상태는 새로고침에 풀린다(`startAsk`).
    if (busy || empty || readOnly) return;
    // 보낸 글을 칸에서 비운다 — **다음 질문을 미리 쓸 수 있다는 것이 §24가 입력칸을 안 잠근
    // 이유**다. 실패하면 그 글을 도로 넣는다(§21 실패 규칙: 쓴 글은 남는다). 그 사이에 사람이
    // 다음 질문을 쓰기 시작했으면 **그쪽이 이긴다** — 사람이 방금 친 글을 덮지 않는다.
    const sent = text;
    const paths = att.paths;
    setText("");
    // **칩은 성공에만 빈다** — 실패하면 쓴 글이 돌아오듯 붙인 파일도 그대로 있어야 다시
    // 보낼 수 있다(§21 실패 규칙). 올라간 파일은 어느 쪽이든 안 지운다(§8 수명).
    if (await run(sent, paths)) setText((now) => now || sent);
    else att.reset();
  };

  /** `중지`(§7 §도는 답을 멈춘다) — 서버가 자식 하나에 `SIGTERM`을 보낸다. **여기서 화면을
   *  안 바꾼다**: 받은 글도 `중지됨`도 다음 폴링이 데려온다(낙관적 에코 금지와 같은 축). */
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    await stopHome(project);
  };

  /** **대화 하나를 통째로 갈아 끼운다.** `새 대화`와 전환이 여기서 같은 일이 된다 — 둘 다 서버가
   *  `current`를 바꾸고 그 대화의 트랜스크립트를 읽어 응답 하나로 돌려준다(§24 로딩 항:
   *  스켈레톤이 없는 이유가 이 한 왕복이다. 새 스레드가 도착한 시점에 통째로 바뀐다).
   *  폴링이 들고 다니던 두 값도 여기서 갈린다 — **갈아탄 대화의 파일은 다른 파일**이라 들고 있던
   *  바이트 수가 거기서는 아무 뜻이 없다.
   *
   *  **도는 대화로 돌아오면 흐르던 글이 그 자리에서 이어진다**(요구 `4e9e54c5`) — 누적분은
   *  세션에 매달려 서버에 있으므로(§7 — `runs`의 키가 세션이다) 이 한 왕복이 그것까지 데려온다.
   *  그래서 여기서 갈아 끼우는 것이 스레드만이 아니다: `running`·`partial`이 같이 갈리고,
   *  그 `running`이 폴링 효과를 이 대화에 다시 붙인다. `stopping`도 푼다 — 앞 대화에서 누른 것이다.
   *  **실패 Alert는 지우는 것이 아니라 갈아 끼운다**(`c.failed`): 내가 B를 보는 동안 A가 실패했으면
   *  그 결과 객체가 A를 여는 폴링까지 서버에 남아 있고(`ff3ceda5`), 여기서 버리면 그 실패가
   *  사람에게 **한 번도** 안 보인다. 옛 대화의 실패가 남지 않는 것은 종전과 같다(대개 `null`이다). */
  const apply = (c: HomeChunk) => {
    session.current = c.sessionId;
    offset.current = c.offset;
    setHome({ conversations: c.conversations, workers: c.workers, current: c.sessionId });
    setTurns(c.stopped ? markStopped(c.turns) : c.turns);
    setRunning(c.running);
    setRunningIds(c.runningSessions);
    setPartial(c.partial);
    setStopping(false);
    setFail(c.failed);
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 화면 제목은 낱말 하나다(§24 §화면 제목은 `sr-only`다 — 요구 `e8445560`). 32px 행과
          감싸던 `div`가 통째로 걷혔고 `홈`은 스크린리더에만 남는다. **`gap-6`도 같이 걷었다**:
          `sr-only`는 `position:absolute`라 flex 항목이 아니어서 페이지 루트의 항목이 2단 행
          하나가 되고 gap이 설 사이가 0개다 — 값이 이미 0이라 걷어도 화면이 안 움직이지만,
          남겨 두면 다음 세션이 뺄셈의 24를 찾다가 이 클래스를 근거로 32px 행을 되살린다.
          그래서 스레드가 32 + 24 = **56px을 되찾는다**(§24 §높이 — `창 − 236`). */}
      <h1 className="sr-only">홈</h1>

      {/* 2단 행(§24 세로 배치 표 · §좌측 패널) — 페이지 루트의 **유일한 flex 항목**이라
          `main`의 패딩 안 남은 높이를 통째로 받는다.
          `gap-8`(32)이 세로 리듬 `gap-6`(24)보다 큰 것이 두 단을 한 격자로 안 읽히게 하고,
          그래서 §11처럼 구분선을 안 넣는다. */}
      <div className="flex min-h-0 flex-1 gap-8">
        {/* 좌측 패널 — 그룹이 둘이다(`대화` · `워커 세션`). **대화 0건이면 패널째 안 그린다**
            (§24 §0건 갈래 ① — 워커 세션이 있어도 같이 빠진다: 첫 화면의 정본은 온보딩이고 그
            옆에 세션 목록이 서면 시선이 갈린다. 워커가 무엇을 했는지 보는 자리는 그 전에도 티켓
            상세와 워커 화면이다). 1건에서는 그린다: 패널의 일이 여는 것만이 아니라 **지금 보는
            것의 이름**이고, 그 표시는 1건에서도 참이다(§4-1과 같다). */}
        {home.conversations.length > 0 && (
          <SidePanel
            home={home}
            runningIds={runningIds}
            // `새 대화`의 잠금 하나(§24 §0건) — **`busy`가 두 번째 조각이다**: 첫 질문 직후는
            // 턴이 0건인데도 그 대화가 비어 있지 않다(위 `NO_TURNS` 주석).
            noTurns={turns.length === 0 && !busy}
            onNew={async () => apply(await clearHome(project))}
            onPick={async (id) => {
              setHome((now) => ({ ...now, current: id })); // 체크만 낙관적으로(§24 로딩 항)
              apply(await switchHome(project, id));
            }}
          />
        )}

        {/* 대화 컬럼 — 남은 폭·높이 전부다. **자식이 언제나 셋이고 순서가 안 바뀐다**(§24):
            [0건: 인사 | 그 외: 스레드] · [폼] · [0건: 예시 4개 | 그 외: null].
            조건이 거짓인 자리를 배열에서 빼지 않는 이유는 폼이다 — 같은 인덱스에 남아야 React가
            다시 마운트하지 않고, 그래야 첫 질문을 보낸 순간 포커스와 IME 상태가 안 날아간다(§21).
            0건일 때 `justify-center` 한 클래스가 그 묶음을 세로 가운데로 올린다(§24 온보딩 항) —
            자리 이동은 이 클래스가 사라지는 것으로 끝난다. **`min-w-0`이 없으면** flex 자식
            기본값(`min-width:auto`)이라 답 안의 펜스·표 한 줄이 이 단을 밀어 패널을 찌그러뜨린다
            (세로에서 `min-h-0`이 하는 일을 가로에서 이 클래스가 한다). */}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-2",
            onboarding && "justify-center",
          )}
        >
          {onboarding ? (
            /* 대화 0건 = 이 화면의 온보딩이다(§6 빈 상태 규칙의 셋째 예외 — 한 줄로는 이 에이전트에게
               무엇을 물어볼 수 있는지를 못 알려준다). 스레드 상자는 아예 안 그린다 — 빈 상자가 서는
               순간이 없다(§13). 폼은 이 묶음의 **가운데 줄**이다: 온보딩이 폼을 대신하지 않는다. */
            <div className="space-y-2">
              <h2 className="text-sm font-medium">이 프로젝트에 대해 묻는다</h2>
              <p className="text-sm text-muted-foreground">
                티켓 · 워커 · 프로토콜 · repo를 읽고 답합니다. 고치는 것은 페르소나 · 프로토콜 ·
                워커 스크립트 셋뿐입니다.
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
                <MessageScrollerViewport ref={thread} aria-label="대화" className="flex-1">
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
                              {/* `m-0`이 `sr-only`의 `margin:-1px`을 지운다(`462d90be`). 그 유틸은
                                  절대배치 1×1px 상자를 만드는데, 여기선 `align="end"` 탓에 그 상자가
                                  **오른쪽 끝에** 서서 음수 margin만큼 1px 넘쳤다. 안 보이는 라벨
                                  하나가 스레드 전체에 가로 스크롤바를 세웠다(1440×900 실측) */}
                              <MessageHeader className="sr-only m-0">질문</MessageHeader>
                              <Bubble variant="outline" align="end">
                                <BubbleContent>
                                  {/* 이 자리에 오는 문자열은 **전부 입력칸에서 왔다** — 사람이
                                      친 줄바꿈을 그대로 그린다(§10 면제). 아래 에이전트 답의
                                      `Prose`는 안 켠다: 그건 감아서 쓰는 쪽의 글이다 */}
                                  <Markdown text={t.text} breaks="all" />
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
                                  네 번째를 더하면 끝난 답 20개의 버튼이 같이 흐려진다).
                                  **`ghost`다**(§24 개정 ③ — `복사`와 같은 근거. 그 함수 주석). */}
                              <Button
                                variant="ghost"
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
                        {/* 첫 글자 전에는 산문을 **안 그린다**(§24 흐름 항). 빈 `partial`을 넘기면
                            §10이 `(내용 없음)`을 내는데, 여기만 *끝난 빈 것*이 아니라 *아직 안 온 것*
                            이라 그 문장이 거짓이다(실측 7.6초 동안 읽힌다). 로딩을 말하는 것은
                            아래 띠고, §10도 끝난 답의 렌더도 그대로 둔다. */}
                        {partial !== "" && <Prose text={partial} />}
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
                onPaste={att.onPaste}
                // `⌘↵`로 보낸다. `Enter`는 줄바꿈이다(§21). `matchCombo`가 `isComposing`을 막아
                // 받침을 확정하는 `Enter`에 글이 날아가지 않는다.
                onKeyDown={(e) => {
                  if (matchCombo(e.nativeEvent, sendCombo)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {/* 칩 줄 — 손잡이 addon **위**다(§27 세로 순서). 폭이 1392라 10개가 2줄(62)이고
                  그 62는 여유가 아니라 **스레드**에서 나온다(§27 §24 항 — 스레드가 `flex-1`이다). */}
              <AttachmentChips att={att} />
              <InputGroupAddon align="block-end">
                {/* 손잡이가 줄의 맨 왼쪽이다(§27). 이 줄에는 보조 문구가 없어 셋뿐이다:
                    `첨부 → ml-auto ⌘↵ → 보내기`. 도는 동안에도 안 잠근다 — 입력칸과 같은
                    판단이다(§24: 다음 질문을 미리 쓸 수 있다). */}
                <AttachmentButton att={att} />
                {/* 보조 문구 — `첨부` 다음 · `ml-auto` 앞이 2차 자리다(§27 손잡이 줄 순서).
                    **대화에서는 없다**(§21 표의 `없다`가 거기서는 그대로 참이다). */}
                {worker && <WorkerNote project={project} worker={worker} />}
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
                  aria-disabled={busy || empty || readOnly}
                  className="aria-disabled:opacity-50"
                >
                  <Send aria-hidden />
                  {busy ? "보내는 중…" : "보내기"}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>

            {/* 첨부 실패 사유(§27) — 그룹 **밖** · 폼 안 한 줄이다. 아래 `<Failure>`와 겹쳐 설 수
                있어서 Alert를 안 쓴다. */}
            <AttachmentProblems att={att} />

            {/* 실패는 사유를 삼키지 않는다(§6 3요소 — 제목 · mono 원문 · 다음 행동). 자리는 §21
                그대로 입력칸 아래 · 폼 안이다. ①만 `<CopyCommand>`를 단다: 사람이 실행해야 하는
                명령이 있는 사유가 그것뿐이고, 나머지는 다음 행동이 문장 하나다. */}
            {fail && <Failure fail={fail} />}
          </form>

          {/* 셋째 자리 — 0건이면 예시 4개(워커 0개인 큐에서만 2개), 아니면 `null`이다.
              **자리를 배열에서 빼지 않는다**(위). */}
          {onboarding ? (
            <div className="flex flex-wrap gap-2">
              {[...examples, ...EXAMPLES].map((q) => (
                // **제출하지 않는다**(§24): ① 한 질문이 프로세스 하나고 상한이 5분이다 — 클릭 한 번에
                // 5분짜리를 시작시키지 않는다. ② 예시는 문장을 고쳐 쓰라고 있다(이름은 이제 이 큐의
                // 진짜 워커지만 페이지를 연 뒤 그 워커가 지워지면 낡는다). 채워진 뒤 손잡이의
                // `보내기`가 곧 두 번째 클릭이다.
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

      {/* 찾기 바(§7 §대화 안에서 찾기 · §비주얼 §30) — **화면 컴포넌트의 마지막 자식**이다.
          포털을 안 쓴다: `fixed`가 뷰포트에 붙는 조건은 조상 사슬에 `transform`·`filter`·
          `contain`이 없는 것 하나이고 이 사슬에는 없다. 열림 상태도 `⌘F`도 바가 자기가 든다 —
          **홈에만 있는 컴포넌트라 §0-6 `board.search`의 홈 갈래가 저절로 맞는다**. */}
      <FindBar scope={thread} restore={input} />
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
 *  갈리는 것은 **안에 무엇이 서느냐**뿐이다. 왼쪽부터 채운다(`ml-auto` 없음).
 *
 *  **`mt-2`(8px)가 산문과 이 띠를 가른다**(§24 §산문 ↔ 띠 세로 간격 — `51546e85`가 값을 안 적어
 *  실물이 0px이었다). 아래가 항목 사이 `gap-4`(16)라 위가 그 절반이면 **띠가 위 산문에 속한다는
 *  것이 간격만으로 참**이 된다. 여백을 `<Markdown>`의 `[&>:last-child]:mb-0` 쪽으로 내지 않는
 *  이유는 주인이 달라서다 — 문단 margin으로 내면 띠가 없는 자리(사람 말풍선)까지 같이 움직인다.
 *  띠 **안**의 세로 여백 0은 무수정이다: 그 0이 답이 끝날 때 높이가 안 튀게 하는 수다.
 *  `mt-2`가 띠 자신의 클래스라 도는 답과 끝난 답이 **같이** 받는다. */
function Band({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center gap-2 px-3 text-xs leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

/** `복사` — **원문 마크다운**이다(§7). 렌더된 HTML이 아니다: 사람이 그것을 티켓·문서에 붙인다.
 *
 *  `<CopyCommand>`를 안 쓴다(§24) — 그 그릇은 `font-mono break-all` 블록 + 버튼이고 담는 것이
 *  터미널 한 줄이라, 답 전문을 넣으면 답이 화면에 두 번(두 번째는 mono로) 선다. 빌리는 것은
 *  그 파일의 **관용구**다: 아이콘만 `Check`로 1.5초 바뀌고 글자는 그대로 — 폭이 한 px도 안
 *  움직여서 옆의 `다시 답하기`가 안 밀린다(§4-3). 토스트도 안 띄운다(그건 서버 액션의 것이다).
 *
 *  **`ghost`다**(§24 개정 ③ — 종전 `outline`). `중지`가 `outline`인 근거는 *테두리가 구두점
 *  노릇을 한다*였는데 이 띠에는 잇댈 글자가 없다 — 무테 전폭 산문 아래에서 답 컬럼의 유일한
 *  사각형이 이 버튼 둘이었다. 걷히는 것은 `border` 1px과 `bg-background` 한 겹뿐이고 글자·
 *  아이콘·`h-6` 히트 영역은 그대로다(호버 전용과 갈리는 자리가 정확히 여기다). */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
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

/** 손잡이 줄 왼쪽 문구 — **워커 세션을 볼 때만 선다**(§비주얼 §24 §손잡이 줄 왼쪽 문구).
 *  §21이 이 칸을 `없다`로 둔 판정은 **대화에서 무수정**이고, 갈리는 것은 두 경우뿐이다:
 *
 *  | 보는 것 | 문구 |
 *  |---|---|
 *  | 도는 워커 세션 | `도는 세션에는 여기서 말을 걸 수 없습니다 · 참견은 <해시> 상세에서` |
 *  | 끝난 워커 세션 | `워커 권한 없이 이 세션에 이어 묻습니다 · <해시>` |
 *
 *  **끝난 세션에도 한 줄이 서는 이유는 권한이 눈에 안 보이기 때문이다**(§24): 화면이 `w4`의
 *  세션을 열어 두고 있으면 그 세션의 힘(워크트리 cwd에서 뭐든 고치는 쓰기)이 있다고 읽히는데,
 *  이어 묻는 것은 **홈 에이전트이고 그 힘은 홈의 것**이다(§7 답 1(b) — 실측으로 `--resume`이
 *  이어 묻는 쪽의 플래그를 쓴다). **이 줄은 도구를 안 센다**(§7 §화면 표기): 종전
 *  `읽기 도구 셋으로 …`는 요구 `20e4a6f4`가 쓰기를 열자 한 번에 거짓이 됐다 — 개수를 세는 문구는
 *  홈의 집합이 갈릴 때마다 죽고, 이 자리가 말할 사실은 *누구의 힘이냐* 하나다. 해시는 **링크다**(mono + 링크 — §5 `<Hash>`의
 *  관용구. 이 레포에는 그 컴포넌트가 없고 6개 화면이 같은 세 클래스를 인라인한다). 목적지는
 *  `stem`이고 글자는 `hash`다(§식별자). `min-w-0 truncate`는 §21 텍스트 잘림 그대로다. */
function WorkerNote({ project, worker }: { project: string; worker: WorkerSession }) {
  return (
    <span className="min-w-0 truncate text-xs text-muted-foreground">
      {worker.running ? "도는 세션에는 여기서 말을 걸 수 없습니다 · 참견은 " : "워커 권한 없이 이 세션에 이어 묻습니다 · "}
      <Link
        href={`/p/${project}/tickets/${encodeURIComponent(worker.stem)}`}
        className="rounded-sm font-mono underline"
      >
        {worker.hash}
      </Link>
      {worker.running && " 상세에서"}
    </span>
  );
}

/** 패널 줄 한 벌의 클래스. **두 그룹이 이 문자열을 같이 쓰고 갈리는 것은 정렬 하나다**(§24
 *  한 줄의 모양 표 — `대화`는 `items-center`(1행 36px), `워커 세션`은 `items-start`(2행 52px)).
 *  나머지(폭 · `px-2 py-1.5` · hover · 잠금)가 두 줄에서 같아야 체크 칸이 한 x에 선다. */
/** (`aria-disabled:opacity-50`이 빠졌다 — 두 그룹의 줄에 `aria-disabled`를 거는 자리가
 *  요구 `4e9e54c5`로 사라졌다. 남기면 이 문자열이 없는 잠금을 가리킨다) */
const ROW = "group flex w-full cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted";

/** 줄 오른쪽 끝의 글자 한 겹 — **`대화`의 시각과 도는 줄의 표식이 같은 그릇이다**(§24
 *  §도는 대화의 표식: 그릇 새 요소 0 · 클래스 무수정). 두 그룹이 이 문자열을 같이 써서
 *  표식의 x가 같다. 색도 아이콘도 0이고(`<StatusBadge status="wip">`는 이 패널에서 이미
 *  *티켓이 `.wip`*을 말한다) **모션도 0이다** — 도는 줄이 여럿 설 수 있어 움직임이 아무것도
 *  안 가리킨다. `· 최대 5분`은 안 붙인다: 상한을 적는 자리는 스레드의 띠 하나다. */
const MARK = "shrink-0 text-xs text-muted-foreground tabular-nums group-hover:text-foreground";
const RUNNING = "답하는 중";

/** 좌측 패널 (§비주얼 §24 §좌측 패널 · §7 §좌측 패널) — **`div` 둘 + `button` 목록**이다.
 *
 *  **팝오버가 걷혔다**(`01e5293b`, 요구 `48b13597`). 걷힌 것은 **자리와 그릇 둘뿐**이고 줄의
 *  값은 한 자도 안 갈렸다 — `button` 목록 · 제목 `truncate` · §26 ④ 시각 서식 · 지금 것에
 *  `Check` · 도는 동안 `aria-disabled` + 같은 `title`. 사유는 §7이다: 같은 목록이 두 자리에
 *  서면 어느 쪽이 정본인지 화면이 말을 못 한다.
 *
 *  **`sidebar`를 안 쓴다**(§5 미설치 표) — §4가 그것을 버린 근거(부수 컴포넌트 5개)가 그대로고
 *  여기 필요한 것은 `div` 둘 + `button`이다. `scroll-area`도 안 쓴다(네이티브로 충분하다).
 *  **`command`를 안 쓰는 근거는 팝오버 때보다 세졌다** — 그 그릇이 곧 검색칸인데 이제는 상시
 *  패널이라 §7이 뺀 기능이 늘 화면에 서게 된다.
 *
 *  **스크롤은 패널 자신 하나다**(`overflow-y-auto`). 그룹마다 스크롤러를 두지 않는다 — 256px
 *  안에 스크롤바가 둘이면 어느 쪽이 움직이는지 안 읽힌다(§24).
 *
 *  **그룹이 둘이고 지금 보는 것은 통틀어 하나다**(§24). 워커 세션을 고르면 `대화` 그룹의 체크가
 *  빠진다 — 본문이 그리는 것이 언제나 하나여서다. 이 패널이 빠지는 조건은 여전히 `대화` 0건
 *  하나이고(그 판정은 부르는 쪽에 있다) `워커 세션`은 0건이면 **그룹째** 안 선다(§24 §0건).
 *
 *  **정렬 · 제목 · 시각은 `chatRows`가 정한다**(`lib/urls.ts` — JSX를 `pnpm test`가 못 읽는다).
 *  워커 세션 줄의 순서·상한·값은 서버의 `workerSessions`가 정한다(§7 — `.wip` 전부 + `.done` 10).
 *  `session id`는 안 그린다: UUID 36자이고 사람이 이 화면에서 그 값을 쓸 일이 없다(§6과 같은 자). */
function SidePanel({
  home,
  runningIds,
  noTurns,
  onNew,
  onPick,
}: {
  home: Panel;
  /** 지금 도는 session id 전부 — **줄의 오른쪽 끝을 정하는 값 하나다**(§24 §도는 대화의 표식).
   *  두 그룹이 같은 목록을 본다: 대화 줄은 시각이 자리를 내주고, 워커 줄은 비어 있던 자리다. */
  runningIds: string[];
  /** `새 대화`를 잠글까 — `턴 0건` **그리고** `그 대화에 도는 것이 없다`(§24 §0건 · `1a925a73`).
   *  판정이 스레드 쪽 상태 둘에서 나오므로 `Panel`에 안 얹고 프롭으로 받는다. */
  noTurns: boolean;
  onNew: () => void;
  onPick: (id: string) => void;
}) {
  const rows = chatRows(home.conversations);
  return (
    // 표면 층(§비주얼 §33) — **가르는 쌍에서 드는 것은 목록 쪽 하나다.** 대화 스레드는
    // 무수정이고(산문은 페이지 폭을 그대로 쓴다), 둘 다 얹으면 남는 경계가 `gap-8`뿐이라
    // 시작한 자리로 돌아온다. 경계를 실제로 세우는 것은 면(1.04)이 아니라 `border`(1.21)다.
    // **가로 패딩은 0이다** — 줄이 `px-2`로 그 8px을 이미 들고 있어 면이 더하면 §24가 잰
    // 제목 폭 216px이 16px 줄어 잘리는 자리가 옮겨 간다. 테두리 2px만 먹어 216 → 214다.
    <div className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border bg-surface py-2">
      <div>
        {/* 그룹 머리 — §3 테이블 헤더 행의 세 값 그대로(`text-xs` · `font-medium` ·
            `--muted-foreground`). `sticky`를 안 붙인다: 그룹이 둘뿐이고 줄 모양이 서로 달라
            어느 그룹인지를 줄 자신이 말한다(§24). 붙이면 `bg-*` 한 면이 늘어 대비 표에 잴
            조합이 생긴다.
            **머리가 24px 행이 됐다**(`f1941cab`) — 이 머리가 `새 대화`를 오른쪽에 들어서다.
            두 머리를 다르게 두지 않으므로 `워커 세션`도 같은 `h-6`이다(§24 §그릇·자리 표). */}
        <div className="flex h-6 items-center">
          <span className="px-2 text-xs font-medium text-muted-foreground">대화</span>
          {/* `새 대화` (§24 §`새 대화` — 요구 `6f9dce32`로 `h1` 행에서 여기로 내려왔다).
              **도는 중 잠금이 걷혔다**(요구 `4e9e54c5` — 답이 도는 동안 다른 대화로 옮겨 거기서
              묻는 것이 그 요구의 전부이고, 새 줄을 여는 것이 곧 그 일이다). 남은 잠금은 0건
              하나다. 여는 버튼인 것은 무수정이다(확인 없음). 갈린 값은 자리·그릇·0건 셋이다 —
              `ghost` `size="xs"`(`h-6`·`text-xs`·`px-2`)로 무테 레일에 앉고, 머리 낱말의
              `text-muted-foreground`를 **안 상속해서**(그 클래스가 `span` 쪽에 있다) 왼쪽은
              라벨 · 오른쪽은 컨트롤이 읽힌다. 0건이면 사라지지 않고 자리를 지킨다 —
              사라지면 목록이 12px 뛰는데 그 순간이 하필 첫 질문을 보내는 때다.
              **0건 판정에 조각이 하나 늘었다** — 걷힌 잠금이 가려 주던 창(첫 질문 직후:
              턴 0건인데 그 대화는 안 비었다)을 부르는 쪽이 닫는다(위 `noTurns` 프롭). */}
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto aria-disabled:opacity-50"
            aria-disabled={noTurns || undefined}
            title={noTurns ? NO_TURNS : undefined}
            onClick={() => {
              if (noTurns) return;
              onNew();
            }}
          >
            새 대화
          </Button>
        </div>
        {rows.map((r) => (
          // 줄 사이 간격이 0이다 — 줄이 자기 `py`로 리듬을 만든다(§3 테이블 행과 같은 처리).
          // **도는 동안에도 눌린다**(§24 §잠금 한 자리 — ①이 걷혔다. 요구 `4e9e54c5`):
          // 옮겨 간 대화에서 묻는 것까지 열렸고 흐르던 글도 안 사라진다. 이 줄에 남은 값은
          // 잠금이 아니라 **표식**이고, 그것이 오른쪽 끝 `span` 하나다(아래).
          <button
            key={r.id}
            type="button"
            // `hover:bg-muted`와 보조 글자의 `group-hover:text-foreground`는 **짝이다** —
            // `--muted-foreground` on `--muted`는 §21이 금지한 4.34다. 두 값 다 `ghost` 변종이
            // 이 화면에서 이미 같이 쓰는 것이라(`복사`·`다시 답하기`) 새로 잴 조합이 0이다.
            className={cn(ROW, "items-center")}
            onClick={() => {
              if (r.id !== home.current) onPick(r.id);
            }}
          >
            {/* 체크 칸은 줄마다 항상 있다(폭 16px 고정) — 지금 것에만 아이콘이 든다.
                여기 빈칸은 위·아래 줄의 체크와 짝을 이뤄 *이건 지금 것이 아니다*를 말한다(§24) */}
            <span className="w-4 shrink-0">
              {r.id === home.current && <Check aria-hidden className="size-4" />}
            </span>
            {/* 216px 안쪽이라 제목이 ≈12자에서 잘린다(§24 §폭) — 식별자가 아니라 첫 질문의
                첫 줄이고, 전문을 볼 자리는 그 대화를 열었을 때의 첫 말풍선이다(§6 경로 예외). */}
            <span className="min-w-0 grow truncate text-sm">{r.title}</span>
            {/* **시각이 도는 동안 자리를 내준다**(§24 §도는 대화의 표식) — 같은 `span` · 같은
                클래스 · 갈리는 것은 자식 문자열 하나다. 둘을 같이 세우면 제목이 ≈8자로 내려간다.
                시각은 답이 끝나면 돌아온다(폴링 응답에서 이 목록이 빠지는 순간이다). */}
            <span className={MARK}>{runningIds.includes(r.id) ? RUNNING : r.time}</span>
          </button>
        ))}
      </div>

      {/* `워커 세션` (§24 §좌측 패널 · §7 §워커 세션 목록) — 0건이면 **그룹째** 안 그린다.
          한 줄이 **2행**인 것은 담는 사실이 다섯이라서다(워커 · 제목 · 해시 · 도는지 · 지금 것):
          256px 한 줄에 넣으면 제목이 5자에서 잘려 식별이 안 된다. 시각을 안 그린다 — 이 그룹의
          정렬 근거는 **도는지**이고 그건 배지가 말한다(대화 쪽은 시각 내림차순이라 그 수가
          정렬 근거를 화면에 세운다). §19 워커 칩도 안 쓴다: 저건 *지금 물고 있다*(`.wip` 전용)고
          이 줄은 *이 세션을 돈 워커*라 끝난 줄에도 서야 한다 — `owner`의 원문 표기를 쓴다. */}
      {home.workers.length > 0 && (
        <div>
          {/* `대화` 머리와 같은 `h-6`이다 — 머리 높이는 그룹의 성질이 아니라 패널의 눈금이다(§24). */}
          <div className="flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">
            워커 세션
          </div>
          {home.workers.map((w) => (
            <button
              key={w.id}
              type="button"
              // 갈리는 클래스가 `items-start` 하나다 — 체크가 **윗줄에 정렬**되고 2줄 묶음이
              // 그 오른쪽에 통째로 앉는다(§24 한 줄의 모양 표). 잠금은 여기서도 걷혔다(위).
              className={cn(ROW, "items-start")}
              onClick={() => {
                if (w.id !== home.current) onPick(w.id);
              }}
            >
              <span className="w-4 shrink-0">
                {w.id === home.current && <Check aria-hidden className="size-4" />}
              </span>
              <div className="flex min-w-0 grow flex-col gap-0.5">
                {/* 윗줄 = 티켓 제목. 두 그룹의 1행이 같은 x에서 시작해 세로로 훑는 눈이
                    한 번에 읽는다(§24). ≈15자에서 잘리고 전문은 해시가 가는 상세에 있다.
                    **오른쪽 끝이 표식의 자리다**(§24 §도는 대화의 표식) — 이 그룹은 윗줄에
                    시각을 안 그려 비어 있던 자리이고, 그래서 표식의 x가 `대화` 줄과 같다.
                    도는 줄에서만 `gap-2`가 걸린다(안 서면 제목이 폭 전부를 갖는다 — 무수정). */}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 grow truncate text-sm">{w.title}</span>
                  {runningIds.includes(w.id) && <span className={MARK}>{RUNNING}</span>}
                </div>
                {/* 아랫줄 = 어디 것인가. 워커 이름이 빈 값이면(형식이 아닌 `owner:`) 감춘다 —
                    모르는 것을 `?`로 그리지 않는다. **해시는 여기서 글자다** — 이 줄 전체가
                    `button`이라 안에 링크를 넣으면 상호작용 요소가 겹친다(HTML 위반 · 키보드가
                    두 정거장). 티켓 상세로 가는 길은 고른 뒤 손잡이 줄의 `<Hash>`다(아래
                    `<WorkerNote>`) — 판정 `077d3b2d`: 이대로 둔다. 되돌리려면 §24
                    §줄의 해시는 링크가 아니다가 거절한 셋이 아니라 `button` 그릇째 개정이다 */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground group-hover:text-foreground">
                    {[w.worker, w.hash].filter(Boolean).join(" · ")}
                  </span>
                  {/* 값이 둘뿐인 것은 이 절의 선택이 아니라 **목록의 성질**이다(출처가 `.wip` +
                      `.done`이라 나머지 넷은 파일 상태로 이미 빠진다). 모든 줄에 붙인다 —
                      도는 것에만 붙이면 나머지 줄의 빈 자리가 *모른다*로 읽힌다(§4-3 슬롯 규칙) */}
                  <StatusBadge status={w.running ? "wip" : "done"} className="shrink-0" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
